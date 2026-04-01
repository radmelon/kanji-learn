#!/usr/bin/env tsx
import 'dotenv/config'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, { max: 1 })

async function main() {
  // Full type distribution
  const types = await sql`SELECT jsonb_typeof(example_vocab) as type, COUNT(*) FROM kanji GROUP BY jsonb_typeof(example_vocab)`
  console.log('example_vocab type distribution:', types)

  // Sample a kanji where type = 'string' to see what was stored
  const stringSample = await sql`SELECT character, example_vocab FROM kanji WHERE jsonb_typeof(example_vocab) = 'string' LIMIT 2`
  console.log('\nDouble-encoded sample:', JSON.stringify(stringSample, null, 2))

  // Sample correctly stored
  const goodSample = await sql`SELECT character, example_vocab FROM kanji WHERE jsonb_typeof(example_vocab) = 'array' AND jsonb_array_length(example_vocab) > 0 LIMIT 2`
  console.log('\nCorrectly stored sample:', JSON.stringify(goodSample, null, 2))

  await sql.end()
}
main().catch(e => { console.error(e); process.exit(1) })
