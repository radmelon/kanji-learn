#!/usr/bin/env tsx
/**
 * seed-kanji.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Seeds the `kanji` table with all 2,136 Jōyō kanji ordered N5 → N1.
 *
 * Usage:
 *   pnpm --filter @kanji-learn/db seed:kanji
 *
 * Prerequisites:
 *   DATABASE_URL env var pointing at your Supabase Postgres instance.
 *
 * Behaviour:
 *   - Upserts on `character` (conflict-safe — safe to re-run).
 *   - Assigns `jlpt_order` as the 1-based index within each JLPT level.
 *   - Logs progress per level and a final summary.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import { kanji } from '../schema'
import type { KanjiSeedEntry } from './types'
import { n5Kanji } from './data/n5'
import { n4Kanji } from './data/n4'
import { n3Kanji } from './data/n3'
import { n2Kanji } from './data/n2'
import { n1Kanji } from './data/n1'

// ─── Database connection ──────────────────────────────────────────────────────

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('❌  DATABASE_URL is not set')
  process.exit(1)
}

const client = postgres(connectionString, { max: 1 })
const db = drizzle(client)

// ─── Helpers ──────────────────────────────────────────────────────────────────

type JlptLevel = 'N5' | 'N4' | 'N3' | 'N2' | 'N1'

interface LevelBatch {
  level: JlptLevel
  entries: KanjiSeedEntry[]
}

async function upsertBatch(
  entries: KanjiSeedEntry[],
  level: JlptLevel,
  startOrder: number
): Promise<number> {
  let inserted = 0

  // Process in chunks of 50 to avoid oversized parameterised queries
  const CHUNK = 50
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK)
    const rows = chunk.map((entry, idx) => ({
      character: entry.character,
      jlptLevel: level,
      jlptOrder: startOrder + i + idx,
      strokeCount: entry.strokeCount,
      meanings: JSON.stringify(entry.meanings),
      kunReadings: JSON.stringify(entry.kunReadings),
      onReadings: JSON.stringify(entry.onReadings),
      exampleVocab: JSON.stringify(entry.exampleVocab),
      radicals: JSON.stringify(entry.radicals),
    }))

    // Drizzle raw upsert — ON CONFLICT DO UPDATE so re-runs are idempotent
    for (const row of rows) {
      await db.execute(sql`
        INSERT INTO kanji
          (character, jlpt_level, jlpt_order, stroke_count,
           meanings, kun_readings, on_readings, example_vocab, radicals)
        VALUES (
          ${row.character},
          ${row.jlptLevel}::jlpt_level,
          ${row.jlptOrder},
          ${row.strokeCount},
          ${row.meanings}::jsonb,
          ${row.kunReadings}::jsonb,
          ${row.onReadings}::jsonb,
          ${row.exampleVocab}::jsonb,
          ${row.radicals}::jsonb
        )
        ON CONFLICT (character)
        DO UPDATE SET
          jlpt_level   = EXCLUDED.jlpt_level,
          jlpt_order   = EXCLUDED.jlpt_order,
          stroke_count = EXCLUDED.stroke_count,
          meanings     = EXCLUDED.meanings,
          kun_readings = EXCLUDED.kun_readings,
          on_readings  = EXCLUDED.on_readings,
          example_vocab = EXCLUDED.example_vocab,
          radicals     = EXCLUDED.radicals
      `)
      inserted++
    }

    process.stdout.write(
      `\r  ${level} — ${Math.min(i + CHUNK, entries.length)} / ${entries.length}`
    )
  }

  process.stdout.write('\n')
  return inserted
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🌸  Kanji-Learn — Jōyō Kanji Seed Script')
  console.log('━'.repeat(50))

  const levels: LevelBatch[] = [
    { level: 'N5', entries: n5Kanji },
    { level: 'N4', entries: n4Kanji },
    { level: 'N3', entries: n3Kanji },
    { level: 'N2', entries: n2Kanji },
    { level: 'N1', entries: n1Kanji },
  ]

  let totalInserted = 0
  let grandTotal = 0

  for (const { level, entries } of levels) {
    grandTotal += entries.length
    console.log(`\n📚  ${level}  (${entries.length} kanji)`)
    const count = await upsertBatch(entries, level, 1)
    totalInserted += count
    console.log(`  ✅  ${count} rows upserted`)
  }

  console.log('\n' + '━'.repeat(50))
  console.log(`🎉  Done! ${totalInserted} / ${grandTotal} kanji seeded.\n`)

  // Print a breakdown table
  const breakdown = await db.execute(sql`
    SELECT jlpt_level, COUNT(*) AS cnt
    FROM kanji
    GROUP BY jlpt_level
    ORDER BY jlpt_level
  `)

  console.log('📊  Database totals:')
  for (const row of breakdown) {
    console.log(`   ${(row as Record<string, unknown>).jlpt_level}  →  ${(row as Record<string, unknown>).cnt} kanji`)
  }
  console.log()
}

main()
  .catch((err) => {
    console.error('\n❌  Seed failed:', err)
    process.exit(1)
  })
  .finally(() => client.end())
