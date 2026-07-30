#!/usr/bin/env node
/**
 * Find user_kanji_progress rows B-210 overwrote: rows matching the exact
 * placement-write signature (status='remembered', stability=21,
 * difficulty=5, totalReviews=1) that ALSO have at least one real
 * review_logs row — proof the card had genuine history before placement
 * stamped over it. A matching row with zero logs was never studied before;
 * that is not what this script reports (see plan §Global Constraints).
 *
 * Read-only. Writes nothing. Safe to run against live data without a dump.
 *
 * Usage (from repo root):
 *   DATABASE_URL='<postgres connection string>' \
 *     node --import tsx/esm scripts/detect-placement-damage.mjs [--user <uuid>]
 *
 * tsx must be resolvable — if not on PATH, use the workspace copy:
 *   DATABASE_URL='...' node \
 *     --import ./packages/db/node_modules/tsx/dist/esm/index.cjs \
 *     scripts/detect-placement-damage.mjs
 *
 * Prefer running against live data via the safety wrapper:
 *   ./scripts/with-live-db.sh node --import tsx/esm scripts/detect-placement-damage.mjs
 *
 * ...or, with the workspace tsx fallback:
 *   ./scripts/with-live-db.sh node \
 *     --import ./packages/db/node_modules/tsx/dist/esm/index.cjs \
 *     scripts/detect-placement-damage.mjs
 */

import { createRequire } from 'node:module'
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
const userIdx = args.indexOf('--user')
const SINGLE_USER = userIdx >= 0 ? args[userIdx + 1] : null

const dbUrl = process.env.DATABASE_URL
const sslDisabled = /[?&]sslmode=disable\b/.test(dbUrl)
const sql = postgres(dbUrl, { ssl: sslDisabled ? false : 'require', max: 5 })

async function main() {
  // Candidates: total_reviews = 1 is the only cheap index-friendly filter;
  // the exact signature and the log-count check happen after fetch.
  const candidates = await sql`
    SELECT p.user_id, p.kanji_id, p.status, p.stability, p.difficulty,
           p.total_reviews AS "totalReviews",
           (SELECT count(*) FROM review_logs l
             WHERE l.user_id = p.user_id AND l.kanji_id = p.kanji_id) AS logged_reviews
      FROM user_kanji_progress p
     WHERE p.total_reviews = 1
       ${SINGLE_USER ? sql`AND p.user_id = ${SINGLE_USER}` : sql``}
  `

  const damaged = candidates.filter(
    (row) =>
      isPlacementDamageSignature({
        status: row.status,
        stability: Number(row.stability),
        difficulty: Number(row.difficulty),
        totalReviews: Number(row.totalReviews),
      }) && Number(row.logged_reviews) >= 1,
  )

  console.log(`Scanned ${candidates.length} candidate row(s).`)
  console.log(`Found ${damaged.length} damaged row(s):\n`)

  for (const row of damaged) {
    console.log(
      `  user=${row.user_id} kanji=${row.kanji_id} logged_reviews=${row.logged_reviews}`,
    )
  }

  if (damaged.length > 0) {
    const byUser = new Map()
    for (const row of damaged) {
      byUser.set(row.user_id, (byUser.get(row.user_id) ?? 0) + 1)
    }
    console.log(`\nAffected accounts (${byUser.size}):`)
    for (const [userId, count] of byUser) {
      console.log(`  ${userId}: ${count} kanji`)
    }
  }

  await sql.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
