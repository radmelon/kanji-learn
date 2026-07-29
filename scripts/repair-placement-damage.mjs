#!/usr/bin/env node
/**
 * Repair user_kanji_progress rows B-210 overwrote (see
 * scripts/detect-placement-damage.mjs for the detection query this reuses).
 * For each damaged (user_id, kanji_id): replay its review_logs through
 * FSRS-5 from scratch — same functions and UPSERT pattern as
 * scripts/replay-srs-fsrs.mjs — and write the reconstructed state.
 *
 * Idempotent — re-running produces the same end state.
 *
 * Defensive branch: if a row matches the damage signature but has ZERO
 * review_logs at repair time (should not happen — the detector requires
 * >=1 — but data can change between detect and repair runs), it is
 * reverted to 'unseen' rather than left with a fabricated 21-day stability,
 * and reported separately as unrepairable.
 *
 * Flags:
 *   --dry-run        Print what would change, write nothing.
 *   --user <uuid>    Restrict to one user.
 *
 * Usage (from repo root):
 *   DATABASE_URL='<postgres connection string>' \
 *     node --import tsx/esm scripts/repair-placement-damage.mjs [--dry-run] [--user <uuid>]
 *
 * tsx must be resolvable — if not on PATH, use the workspace copy:
 *   DATABASE_URL='...' node \
 *     --import ./packages/db/node_modules/tsx/dist/esm/index.cjs \
 *     scripts/repair-placement-damage.mjs
 *
 * Prefer running against live data via the safety wrapper:
 *   ./scripts/with-live-db.sh node --import tsx/esm scripts/repair-placement-damage.mjs
 *
 * ...or, with the workspace tsx fallback:
 *   ./scripts/with-live-db.sh node \
 *     --import ./packages/db/node_modules/tsx/dist/esm/index.cjs \
 *     scripts/repair-placement-damage.mjs
 *
 * ALWAYS run --dry-run first and review the output before a live run.
 * ALWAYS take a safety dump before a live (non-dry-run) run — see
 * scripts/with-live-db.sh and docs/HANDOFF.md's safety-dump precedent.
 */

import { createRequire } from 'node:module'
import {
  calculateNextReview,
  createNewCard,
  ratingFromQuality,
} from '../packages/shared/src/srs.ts'
import { isPlacementDamageSignature } from '../packages/shared/src/placement-repair.ts'

const require = createRequire(
  new URL('../packages/db/src/index.ts', import.meta.url),
)
const postgres = require('postgres')

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Aborting.')
  process.exit(1)
}

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const userIdx = args.indexOf('--user')
const SINGLE_USER = userIdx >= 0 ? args[userIdx + 1] : null

const dbUrl = process.env.DATABASE_URL
const sslDisabled = /[?&]sslmode=disable\b/.test(dbUrl)
const sql = postgres(dbUrl, { ssl: sslDisabled ? false : 'require', max: 5 })

async function main() {
  const candidates = await sql`
    SELECT p.user_id, p.kanji_id, p.status, p.stability, p.difficulty,
           p.total_reviews AS "totalReviews"
      FROM user_kanji_progress p
     WHERE p.total_reviews = 1
       ${SINGLE_USER ? sql`AND p.user_id = ${SINGLE_USER}` : sql``}
  `

  const damaged = candidates.filter((row) =>
    isPlacementDamageSignature({
      status: row.status,
      stability: Number(row.stability),
      difficulty: Number(row.difficulty),
      totalReviews: Number(row.totalReviews),
    }),
  )

  console.log(
    `${DRY_RUN ? '[DRY RUN] ' : ''}Repairing ${damaged.length} damaged row(s)`,
  )

  let repaired = 0
  let reverted = 0

  for (const row of damaged) {
    const logs = await sql`
      SELECT quality, reviewed_at FROM review_logs
       WHERE user_id = ${row.user_id} AND kanji_id = ${row.kanji_id}
       ORDER BY reviewed_at ASC
    `

    if (logs.length === 0) {
      // Matched the signature but nothing to replay — unrepairable. Revert
      // to the honest state rather than keep the fabricated one.
      console.log(
        `  UNREPAIRABLE user=${row.user_id} kanji=${row.kanji_id} — 0 review_logs, reverting to unseen`,
      )
      if (!DRY_RUN) {
        await sql`
          UPDATE user_kanji_progress
             SET status = 'unseen', stability = 0, difficulty = 5,
                 total_reviews = 0, next_review_at = NULL,
                 last_reviewed_at = NULL, updated_at = NOW()
           WHERE user_id = ${row.user_id} AND kanji_id = ${row.kanji_id}
        `
      }
      reverted++
      continue
    }

    let card = createNewCard()
    for (const log of logs) {
      const rating = ratingFromQuality(log.quality)
      card = calculateNextReview(card, rating, new Date(log.reviewed_at))
    }

    console.log(
      `  REPAIR user=${row.user_id} kanji=${row.kanji_id}: ` +
        `S=${card.stability.toFixed(2)} D=${card.difficulty.toFixed(2)} ` +
        `status=${card.status} (from ${logs.length} logged review(s))`,
    )

    if (!DRY_RUN) {
      await sql`
        UPDATE user_kanji_progress
           SET status = ${card.status}, stability = ${card.stability},
               difficulty = ${card.difficulty}, lapses = ${card.lapses},
               total_reviews = ${logs.length},
               next_review_at = ${card.nextReviewAt},
               last_reviewed_at = ${card.lastReviewedAt}, updated_at = NOW()
         WHERE user_id = ${row.user_id} AND kanji_id = ${row.kanji_id}
      `
    }
    repaired++
  }

  console.log(
    `\n${DRY_RUN ? '[DRY RUN] ' : ''}Done. Repaired ${repaired}, reverted-to-unseen ${reverted}.`,
  )

  await sql.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
