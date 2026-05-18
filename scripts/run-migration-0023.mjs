// Apply migration 0023 (daily_goal → minutes) to the live database.
//
// Usage, from the kanji-learn repo root:
//   DATABASE_URL='<supabase postgres connection string>' node scripts/run-migration-0023.mjs
//
// The SQL lives in packages/db/supabase/migrations/0023_daily_goal_minutes.sql
// and is wrapped in BEGIN/COMMIT — it either fully applies or fully rolls back.
// It changes the user_profiles.daily_goal DEFAULT to 15 and resets EVERY existing
// row to 15 (pre-launch testers re-pick their goal in Profile). Safe to re-run.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// `postgres` is a dependency of packages/db, not the repo root — resolve it there.
const require = createRequire(
  '/Users/rdennis/Documents/projects/kanji-learn/packages/db/src/index.ts'
)
const postgres = require('postgres')

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — pass your Supabase Postgres connection string. Aborting.')
  process.exit(1)
}

const migrationSql = readFileSync(
  new URL('../packages/db/supabase/migrations/0023_daily_goal_minutes.sql', import.meta.url),
  'utf8',
)

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 })

try {
  // .simple() — the file is a multi-statement script (BEGIN/…/COMMIT).
  await sql.unsafe(migrationSql).simple()
  const [col] = await sql`
    SELECT column_default FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'daily_goal'
  `
  console.log(`Migration 0023 applied ✓  (daily_goal is now minutes; column_default = ${col?.column_default})`)
} catch (err) {
  console.error('Migration 0023 FAILED — the BEGIN/COMMIT transaction rolled back, nothing changed.')
  console.error(err)
  process.exitCode = 1
} finally {
  await sql.end()
}
