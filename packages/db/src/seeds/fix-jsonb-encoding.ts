#!/usr/bin/env tsx
/**
 * fix-jsonb-encoding.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Audits and repairs jsonb columns that were stored double-encoded.
 *
 * The bug: drizzle-orm's built-in `jsonb` JSON.stringified the value, and the
 * postgres-js driver JSON.stringified it a SECOND time (the Postgres server
 * reports the bind parameter's type as jsonb, and postgres-js's serializer for
 * that type is JSON.stringify). The column ended up holding a JSON *string*
 * scalar (`jsonb_typeof` = 'string') instead of a real object/array, so SQL
 * path operators (`->`, `#>>`, `@>`) silently return NULL.
 *
 * The write path is now fixed (see packages/db/src/jsonb.ts and the seed
 * scripts). This script repairs rows written before that fix: it finds every
 * jsonb column in the public schema and unwraps each string-typed value with
 * `(col #>> '{}')::jsonb`, repeating until no string-typed rows remain (a value
 * may have been encoded more than twice).
 *
 * Usage:
 *   DATABASE_URL=... tsx src/seeds/fix-jsonb-encoding.ts            # audit only (no writes)
 *   DATABASE_URL=... tsx src/seeds/fix-jsonb-encoding.ts --apply    # perform the repair
 *
 * The repair is idempotent — it only touches rows whose value is still a string
 * scalar — and each column is repaired inside its own transaction, so a failure
 * rolls that column back rather than leaving it half-decoded.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import 'dotenv/config'
import postgres from 'postgres'

const APPLY = process.argv.includes('--apply')
const MAX_PASSES = 8

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('❌  DATABASE_URL is not set')
  process.exit(1)
}

// prepare: false so the script works against Supabase's transaction-mode
// pooler (port 6543) as well as direct / session connections.
const sql = postgres(connectionString, { max: 1, prepare: false })

async function main() {
  console.log(
    `\njsonb encoding ${APPLY ? 'REPAIR (--apply)' : 'AUDIT (dry run — pass --apply to repair)'}\n`
  )

  const columns = await sql<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'jsonb'
    ORDER BY table_name, column_name
  `

  let corruptedColumns = 0
  let totalCorruptRows = 0
  let repairedRows = 0

  for (const { table_name, column_name } of columns) {
    const t = `"${table_name}"`
    const c = `"${column_name}"`
    const label = `${table_name}.${column_name}`

    const [{ n: stringRows }] = await sql.unsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM ${t} WHERE jsonb_typeof(${c}) = 'string'`
    )

    if (stringRows === 0) {
      console.log(`  ok    ${label}`)
      continue
    }

    corruptedColumns++
    totalCorruptRows += stringRows
    console.log(`  FIX   ${label} — ${stringRows} double-encoded row(s)`)

    if (!APPLY) continue

    await sql.begin(async (tx) => {
      let pass = 0
      let remaining = stringRows
      while (remaining > 0 && pass < MAX_PASSES) {
        pass++
        const res = await tx.unsafe(
          `UPDATE ${t} SET ${c} = (${c} #>> '{}')::jsonb WHERE jsonb_typeof(${c}) = 'string'`
        )
        const [{ n }] = await tx.unsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM ${t} WHERE jsonb_typeof(${c}) = 'string'`
        )
        remaining = n
        console.log(`          pass ${pass}: ${res.count} updated, ${remaining} still string-typed`)
      }
      if (remaining > 0) {
        throw new Error(
          `${label}: ${remaining} row(s) still string-typed after ${MAX_PASSES} passes — rolling back`
        )
      }
    })
    repairedRows += stringRows
    console.log(`          ✓ repaired`)
  }

  console.log()
  if (corruptedColumns === 0) {
    console.log('✅  No double-encoded jsonb values found.')
    return
  }
  if (APPLY) {
    console.log(`✅  Repaired ${repairedRows} row(s) across ${corruptedColumns} column(s).`)
  } else {
    console.log(
      `Found ${totalCorruptRows} double-encoded row(s) across ${corruptedColumns} column(s).` +
        '\nRe-run with --apply to repair.'
    )
  }
}

main()
  .catch((err) => {
    console.error('\n❌  Repair failed:', err)
    process.exitCode = 1
  })
  .finally(() => sql.end())
