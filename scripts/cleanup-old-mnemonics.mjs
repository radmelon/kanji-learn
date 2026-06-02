#!/usr/bin/env node
// cleanup-old-mnemonics.mjs
// Phase 5 §10.5: discard ALL pre-Phase-5 mnemonic rows (system + user).
// Operator confirmed 2026-05-31. Nothing co-created has shipped, so this is
// effectively every current row. RUN ONLY AFTER a pg_dump safety dump (runbook).
//
// Usage:
//   node scripts/cleanup-old-mnemonics.mjs --dry-run   # count only
//   node scripts/cleanup-old-mnemonics.mjs             # delete

import { createRequire } from 'node:module'

// `postgres` is a dependency of packages/db, not the repo root — resolve it there.
const require = createRequire(
  new URL('../packages/db/src/index.ts', import.meta.url),
)
const postgres = require('postgres')

const DRY = process.argv.includes('--dry-run')
const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL required'); process.exit(1) }

const sql = postgres(url, { ssl: url.includes('sslmode=disable') ? false : 'require', max: 1 })

const [{ count }] = await sql`SELECT count(*)::int AS count FROM mnemonics`
console.log(`Found ${count} mnemonic rows.`)

if (DRY) {
  console.log('[dry-run] no rows deleted.')
} else {
  const deleted = await sql`DELETE FROM mnemonics RETURNING id`
  console.log(`✅ Deleted ${deleted.length} rows.`)
}

await sql.end()
process.exit(0)
