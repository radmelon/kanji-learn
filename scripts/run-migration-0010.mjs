// Run from the kanji-learn root:
// DATABASE_URL=... node --import tsx/esm scripts/run-migration-0010.mjs
// Or: node scripts/run-migration-0010.mjs (reads DATABASE_URL from env)

import { createRequire } from 'module'
const require = createRequire(
  '/Users/rdennis/Documents/projects/kanji-learn/packages/db/src/index.ts'
)
const postgres = require('postgres')

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 })

await sql`
  ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS reminder_hour SMALLINT NOT NULL DEFAULT 20,
    ADD COLUMN IF NOT EXISTS push_token    TEXT
`
console.log('Migration 0010 applied ✓  (reminder_hour + push_token columns added)')
await sql.end()
