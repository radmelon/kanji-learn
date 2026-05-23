#!/usr/bin/env node
/**
 * Replay every user's review_logs through FSRS-5 and write fresh
 * (stability, difficulty, lapses, total_reviews, status, next_review_at,
 * last_reviewed_at) into user_kanji_progress.
 *
 * One-time backfill for the FSRS migration. Idempotent — re-running produces
 * the same end state.
 *
 * Flags:
 *   --dry-run        Print the first 10 users' computed state, write nothing.
 *   --user <uuid>    Restrict to one user (useful for spot-checks).
 *
 * Run AFTER migration 0024 has been applied to the target DB.
 *
 * Usage (from repo root):
 *   DATABASE_URL='<supabase postgres connection string>' \
 *     node --import tsx/esm scripts/replay-srs-fsrs.mjs [--dry-run] [--user <uuid>]
 *
 * tsx must be resolvable — if not on PATH, use the workspace copy:
 *   DATABASE_URL='...' node \
 *     --import ./packages/db/node_modules/tsx/dist/esm/index.cjs \
 *     scripts/replay-srs-fsrs.mjs
 *
 * Runner choice: tsx (via --import tsx/esm) so we can import the shared
 * TypeScript source directly from packages/shared/src/srs.ts without a build
 * step. The postgres client is resolved via createRequire from packages/db,
 * mirroring run-migration-0023.mjs.
 */

import { createRequire } from 'node:module'
import {
  calculateNextReview,
  createNewCard,
  ratingFromQuality,
} from '../packages/shared/src/srs.ts'

// `postgres` is a dependency of packages/db, not the repo root — resolve it there.
const require = createRequire(
  new URL('../packages/db/src/index.ts', import.meta.url),
)
const postgres = require('postgres')

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set — pass your Supabase Postgres connection string. Aborting.',
  )
  process.exit(1)
}

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const userIdx = args.indexOf('--user')
const SINGLE_USER = userIdx >= 0 ? args[userIdx + 1] : null

// SSL: required for Supabase (prod), disabled for local rehearsal DBs. Honor
// sslmode=disable in the URL; default to 'require' for everything else (so the
// production-rollout invocation continues to work without extra config).
const dbUrl = process.env.DATABASE_URL
const sslDisabled = /[?&]sslmode=disable\b/.test(dbUrl)
const sql = postgres(dbUrl, { ssl: sslDisabled ? false : 'require', max: 5 })

async function main() {
  const users = SINGLE_USER
    ? [{ id: SINGLE_USER }]
    : await sql`SELECT id FROM user_profiles ORDER BY id`

  console.log(
    `Replaying ${users.length} user(s)${DRY_RUN ? ' (DRY RUN)' : ''}`,
  )

  let dryPrinted = 0

  for (const user of users) {
    const logs = await sql`
      SELECT kanji_id, quality, reviewed_at
        FROM review_logs
       WHERE user_id = ${user.id}
       ORDER BY reviewed_at ASC
    `

    if (logs.length === 0) continue

    // Group by kanji_id
    const byKanji = new Map()
    for (const log of logs) {
      const arr = byKanji.get(log.kanji_id) ?? []
      arr.push(log)
      byKanji.set(log.kanji_id, arr)
    }

    const updates = []
    for (const [kanjiId, kLogs] of byKanji) {
      let card = createNewCard()
      for (const log of kLogs) {
        const rating = ratingFromQuality(/** @type {0|1|2|3|4|5} */ (log.quality))
        card = calculateNextReview(card, rating, new Date(log.reviewed_at))
      }
      updates.push({
        userId: user.id,
        kanjiId,
        stability: card.stability,
        difficulty: card.difficulty,
        lapses: card.lapses,
        totalReviews: kLogs.length,
        status: card.status,
        nextReviewAt: card.nextReviewAt,
        lastReviewedAt: card.lastReviewedAt,
      })
    }

    if (DRY_RUN) {
      if (dryPrinted < 10) {
        console.log(`\nUser ${user.id} — ${updates.length} card(s):`)
        for (const u of updates.slice(0, 5)) {
          console.log(
            `  kanji ${u.kanjiId}: S=${u.stability.toFixed(2)} D=${u.difficulty.toFixed(2)} lapses=${u.lapses} status=${u.status} next=${u.nextReviewAt?.toISOString().slice(0, 10)}`,
          )
        }
        if (updates.length > 5)
          console.log(`  ... and ${updates.length - 5} more`)
        dryPrinted++
      }
      continue
    }

    // UPSERT each row via the (user_id, kanji_id) unique index.
    // Using UPSERT rather than plain UPDATE so that any progress row that was
    // deleted (or never created for a user who has logs but no progress row)
    // gets inserted rather than silently no-op'd.
    for (const u of updates) {
      await sql`
        INSERT INTO user_kanji_progress
          (user_id, kanji_id, stability, difficulty, lapses, total_reviews,
           status, next_review_at, last_reviewed_at, updated_at)
        VALUES
          (${u.userId}, ${u.kanjiId}, ${u.stability}, ${u.difficulty},
           ${u.lapses}, ${u.totalReviews}, ${u.status},
           ${u.nextReviewAt}, ${u.lastReviewedAt}, NOW())
        ON CONFLICT (user_id, kanji_id)
        DO UPDATE SET
          stability        = EXCLUDED.stability,
          difficulty       = EXCLUDED.difficulty,
          lapses           = EXCLUDED.lapses,
          total_reviews    = EXCLUDED.total_reviews,
          status           = EXCLUDED.status,
          next_review_at   = EXCLUDED.next_review_at,
          last_reviewed_at = EXCLUDED.last_reviewed_at,
          updated_at       = NOW()
      `
    }
    console.log(`User ${user.id}: replayed ${updates.length} card(s)`)
  }

  // Refresh the materialized view that depends on user_kanji_progress.stability.
  // Migration 0024 populates the view inside its transaction (before any replay
  // runs), so without this refresh every row shows interval_days = 0. Skip on
  // dry-run since no writes happened.
  if (!DRY_RUN) {
    await sql`REFRESH MATERIALIZED VIEW kanji_mastery_view`
    console.log('Refreshed kanji_mastery_view.')
  }

  await sql.end()
  console.log(DRY_RUN ? '\nDry run complete.' : '\nReplay complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
