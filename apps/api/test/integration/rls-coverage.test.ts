// apps/api/test/integration/rls-coverage.test.ts
//
// CI guard for the RLS-as-default-deny security model.
//
// The project's security posture (established by 0007_rls.sql and extended by
// 0010_rls_phase0_tables.sql) is:
//
//   * The API connects as `postgres` (BYPASSRLS) and is unaffected by RLS.
//   * Every user-owned public table has RLS enabled and forced with NO
//     policies, which yields a default deny for anon and authenticated
//     PostgREST callers.
//   * The only public table that intentionally permits SELECT to anon is
//     `kanji` (the kanji reference dataset).
//
// Drizzle does not model RLS in schema.ts, so a future drizzle-kit-generated
// migration that adds a public table will silently leave it without RLS. This
// test catches that — it asserts every table in `public` has both
// relrowsecurity AND relforcerowsecurity set to true.
//
// If you add a new public table that legitimately should be world-readable,
// add its name to ALLOWED_PUBLIC_READ_TABLES below AND make sure the migration
// that creates it adds an explicit `FOR SELECT TO anon, authenticated USING (true)`
// policy (see kanji's policy in 0007_rls.sql for the pattern).

import { describe, it, expect } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'

// Tables that may exist in `public` without RLS protection. Currently empty —
// even `kanji` has RLS enabled, it just also has an explicit public-SELECT
// policy. This list exists as a documented escape hatch, not because anything
// uses it today.
const ALLOWED_TABLES_WITHOUT_RLS: readonly string[] = []

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client)

describe('RLS coverage — every public table must have ENABLE + FORCE row level security', () => {
  it('has zero unprotected user-data tables in the public schema', async () => {
    const rows = (await db.execute(sql`
      SELECT relname
        FROM pg_class
       WHERE relkind = 'r'
         AND relnamespace = 'public'::regnamespace
         AND (relrowsecurity = false OR relforcerowsecurity = false)
       ORDER BY relname
    `)) as Array<{ relname: string }>

    const unprotected = rows
      .map((r) => r.relname)
      .filter((name) => !ALLOWED_TABLES_WITHOUT_RLS.includes(name))

    if (unprotected.length > 0) {
      // Build a clear failure message that names every offender so a future
      // contributor doesn't have to dig through pg_class to figure out what
      // they forgot to protect.
      const list = unprotected.map((n) => `  - ${n}`).join('\n')
      throw new Error(
        `Found ${unprotected.length} public table(s) without RLS enabled+forced:\n${list}\n\n` +
          `Every user-owned table must include:\n` +
          `  ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;\n` +
          `  ALTER TABLE <name> FORCE  ROW LEVEL SECURITY;\n` +
          `in its creating migration. See packages/db/drizzle/0007_rls.sql or` +
          ` 0010_rls_phase0_tables.sql for the established pattern.`
      )
    }

    expect(unprotected).toEqual([])
  })
})
