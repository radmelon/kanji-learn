#!/usr/bin/env tsx
/**
 * One-shot fix: repairs all double-encoded example_vocab rows using the
 * same #>> '{}' technique used for kun_readings/on_readings/meanings.
 */
import 'dotenv/config'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, { max: 1 })

async function main() {
  // Fix double-encoded rows
  const fixed = await sql`
    UPDATE kanji
    SET example_vocab = (example_vocab #>> '{}')::jsonb
    WHERE jsonb_typeof(example_vocab) = 'string'
    RETURNING id
  `
  console.log(`Fixed ${fixed.length} double-encoded example_vocab rows`)

  // Verify
  const types = await sql`SELECT jsonb_typeof(example_vocab) as type, COUNT(*) FROM kanji GROUP BY jsonb_typeof(example_vocab)`
  console.log('After fix, type distribution:', types)

  const empty = await sql`SELECT COUNT(*) FROM kanji WHERE jsonb_typeof(example_vocab) = 'array' AND jsonb_array_length(example_vocab) = 0`
  console.log('Still empty:', empty[0].count, 'kanji need vocab generated')

  await sql.end()
}
main().catch(e => { console.error(e); process.exit(1) })
