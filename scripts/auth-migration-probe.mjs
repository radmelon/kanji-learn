#!/usr/bin/env node
/**
 * Compare auth.users and auth.identities between the live project and a
 * migration target. Prints ids, providers and counts — never tokens, never
 * password hashes, never emails.
 *
 * A user arriving in the target with a NEW uuid is the failure this exists to
 * catch: no FK references auth.users (verified 2026-08-06, 0 constraints), so
 * a fresh uuid orphans every row that user owns instead of erroring, and all
 * 11 auth.uid() RLS policies stop matching.
 *
 * Sharpest case, measured on live 2026-08-07: two of the five users have a
 * SINGLE OAuth identity and no password — one google-only, one apple-only.
 * A failed relink for them is not a password reset away; their sign-in
 * silently creates a second account and strands their history behind an
 * unreferenced uuid.
 *
 * Usage:
 *   TARGET_DATABASE_URL='<target uri>' \
 *     ./scripts/with-live-db.sh node \
 *     --import ./packages/db/node_modules/tsx/dist/esm/index.cjs \
 *     scripts/auth-migration-probe.mjs
 *
 * Self-test (compares live against itself, proves the probe can pass):
 *   ./scripts/with-live-db.sh node \
 *     --import ./packages/db/node_modules/tsx/dist/esm/index.cjs \
 *     scripts/auth-migration-probe.mjs --self-test
 */
import { createRequire } from 'node:module'

const require = createRequire(new URL('../packages/db/src/index.ts', import.meta.url))
const postgres = require('postgres')

const SOURCE = process.env.DATABASE_URL
// --self-test compares live against ITSELF, to prove the probe can pass. It
// reads TARGET from the same env var rather than making the operator handle
// the URI: no secret should ever need to be copied to run a check.
const SELF_TEST = process.argv.includes('--self-test')
const TARGET = SELF_TEST ? SOURCE : process.env.TARGET_DATABASE_URL
if (!SOURCE || !TARGET) {
  console.error('DATABASE_URL must be set, and TARGET_DATABASE_URL unless --self-test.')
  process.exit(1)
}

const open = (uri) => postgres(uri, { ssl: 'require', max: 2, prepare: false })

async function snapshot(sql) {
  const users = await sql`SELECT id::text FROM auth.users ORDER BY id`
  const idents = await sql`
    SELECT user_id::text AS user_id, provider FROM auth.identities
     ORDER BY user_id, provider`
  return {
    users: users.map((r) => r.id),
    idents: idents.map((r) => `${r.user_id}:${r.provider}`),
  }
}

// Wrapped, not top-level await: tsx transpiles this to CJS, where top-level
// await is a hard parse error ("Top-level await is currently not supported
// with the cjs output format"). Hit for real on 2026-08-06.
async function main() {
  const src = open(SOURCE)
  const tgt = SELF_TEST ? src : open(TARGET)
  const a = await snapshot(src)
  const b = SELF_TEST ? a : await snapshot(tgt)
  await src.end()
  if (!SELF_TEST) await tgt.end()

  const missing = a.users.filter((id) => !b.users.includes(id))
  const extra = b.users.filter((id) => !a.users.includes(id))
  const identMissing = a.idents.filter((k) => !b.idents.includes(k))

  if (SELF_TEST) console.log('--self-test: comparing live against itself\n')
  console.log(`source users: ${a.users.length}   target users: ${b.users.length}`)
  console.log(`source identities: ${a.idents.length}   target identities: ${b.idents.length}`)
  if (missing.length) console.log(`\nUUIDS MISSING IN TARGET (data would be orphaned):\n  ${missing.join('\n  ')}`)
  if (extra.length) console.log(`\nUNEXPECTED UUIDS IN TARGET:\n  ${extra.join('\n  ')}`)
  if (identMissing.length) console.log(`\nIDENTITIES NOT RELINKED (OAuth sign-in creates a duplicate account):\n  ${identMissing.join('\n  ')}`)

  const ok = missing.length === 0 && extra.length === 0 && identMissing.length === 0
  console.log(`\n${ok ? 'AUTH PRESERVED — migration path is viable' : 'AUTH BROKEN — do not schedule the migration on this method'}`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
