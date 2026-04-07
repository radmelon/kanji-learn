#!/usr/bin/env tsx
/**
 * seed-kanji-fetch.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches ALL 2,136 Jōyō kanji from kanjiapi.dev and upserts them into the
 * `kanji` table. Safe to re-run — uses ON CONFLICT DO UPDATE.
 *
 * Run after db:migrate:
 *   pnpm --filter @kanji-learn/db seed:kanji:fetch
 *
 * Data source: https://kanjiapi.dev (free, no API key)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'

// ─── DB ───────────────────────────────────────────────────────────────────────

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) { console.error('❌  DATABASE_URL is not set'); process.exit(1) }
const client = postgres(dbUrl, { max: 5 })
const db = drizzle(client)

// ─── kanjiapi.dev types ───────────────────────────────────────────────────────

interface KanjiApiResponse {
  kanji: string
  grade: number | null
  stroke_count: number
  meanings: string[]
  kun_readings: string[]
  on_readings: string[]
  jlpt: number | null   // 1–5, or null
}

// ─── JLPT level ordering (N5 = most common → N1 = least common) ───────────────

const JLPT_LEVELS = [5, 4, 3, 2, 1] as const
const LEVEL_MAP: Record<number, string> = { 5: 'N5', 4: 'N4', 3: 'N3', 2: 'N2', 1: 'N1' }

// ─── Fetch helpers ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return res
      if (res.status === 429) {
        await sleep(2000 * (i + 1))
        continue
      }
      throw new Error(`HTTP ${res.status} for ${url}`)
    } catch (err) {
      if (i === retries) throw err
      await sleep(500 * (i + 1))
    }
  }
  throw new Error(`Failed to fetch ${url} after ${retries} retries`)
}

async function fetchKanjiList(jlptLevel: number): Promise<string[]> {
  const res = await fetchWithRetry(`https://kanjiapi.dev/v1/kanji/jlpt-${jlptLevel}`)
  return res.json() as Promise<string[]>
}

async function fetchKanjiDetail(char: string): Promise<KanjiApiResponse> {
  const encoded = encodeURIComponent(char)
  const res = await fetchWithRetry(`https://kanjiapi.dev/v1/kanji/${encoded}`)
  return res.json() as Promise<KanjiApiResponse>
}

// ─── Concurrency pool ─────────────────────────────────────────────────────────

async function runConcurrent<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<Array<R | Error>> {
  const results: Array<R | Error> = new Array(items.length)
  let idx = 0

  async function worker() {
    while (idx < items.length) {
      const i = idx++
      try {
        results[i] = await fn(items[i])
      } catch (err) {
        results[i] = err instanceof Error ? err : new Error(String(err))
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  )
  return results
}

// ─── Upsert single kanji ──────────────────────────────────────────────────────

async function upsertKanji(
  detail: KanjiApiResponse,
  jlptLevel: string,
  jlptOrder: number
): Promise<void> {
  const meanings = JSON.stringify(detail.meanings.slice(0, 6))
  const onReadings = JSON.stringify(detail.on_readings.slice(0, 5))
  const kunReadings = JSON.stringify(detail.kun_readings.slice(0, 5))
  const radicals = JSON.stringify([])   // kanjiapi.dev doesn't return radicals
  const exampleVocab = JSON.stringify([])

  await db.execute(sql`
    INSERT INTO kanji (
      character, jlpt_level, jlpt_order, stroke_count,
      meanings, kun_readings, on_readings, example_vocab, radicals
    ) VALUES (
      ${detail.kanji},
      ${jlptLevel}::jlpt_level,
      ${jlptOrder},
      ${detail.stroke_count},
      ${meanings}::jsonb,
      ${kunReadings}::jsonb,
      ${onReadings}::jsonb,
      ${exampleVocab}::jsonb,
      ${radicals}::jsonb
    )
    ON CONFLICT (character) DO UPDATE SET
      jlpt_level   = EXCLUDED.jlpt_level,
      jlpt_order   = EXCLUDED.jlpt_order,
      stroke_count = EXCLUDED.stroke_count,
      meanings     = EXCLUDED.meanings,
      kun_readings = EXCLUDED.kun_readings,
      on_readings  = EXCLUDED.on_readings
  `)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n📖  Kanji-Learn — Full Kanji Fetch Seed (kanjiapi.dev)')
  console.log('━'.repeat(52))

  let globalOrder = 0
  let totalInserted = 0
  let totalErrors = 0
  const startTime = Date.now()

  for (const level of JLPT_LEVELS) {
    const levelLabel = LEVEL_MAP[level]
    process.stdout.write(`\n${levelLabel}  fetching list…`)

    const chars = await fetchKanjiList(level)
    process.stdout.write(` ${chars.length} kanji → fetching details`)

    let levelDone = 0
    let levelErrors = 0
    const levelStart = globalOrder

    // Fetch all detail records concurrently (3 at a time, polite to the API)
    const details = await runConcurrent(
      chars,
      (char) => fetchKanjiDetail(char),
      3
    )

    // Upsert in order
    for (let i = 0; i < chars.length; i++) {
      const result = details[i]
      globalOrder++

      if (result instanceof Error) {
        console.error(`\n  ✗  ${chars[i]}: ${result.message}`)
        levelErrors++
        totalErrors++
        continue
      }

      try {
        await upsertKanji(result, levelLabel, globalOrder)
        levelDone++
        totalInserted++
      } catch (err) {
        console.error(`\n  ✗  DB error for ${chars[i]}:`, (err as Error).message)
        levelErrors++
        totalErrors++
      }

      // Progress every 50
      if ((levelDone + levelErrors) % 50 === 0) {
        process.stdout.write('.')
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`\n  ✓  ${levelLabel}: ${levelDone} inserted, ${levelErrors} errors  [${elapsed}s]`)
  }

  // ─── Final summary ──────────────────────────────────────────────────────────

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log('\n' + '━'.repeat(52))
  console.log(`🎉  Done in ${elapsed}s — ${totalInserted} kanji upserted, ${totalErrors} errors`)

  const breakdown = await db.execute(sql`
    SELECT jlpt_level, COUNT(*) AS cnt
    FROM kanji
    GROUP BY jlpt_level
    ORDER BY jlpt_level
  `)

  console.log('\n📊  Database totals:')
  let grandTotal = 0
  for (const row of breakdown) {
    const r = row as Record<string, unknown>
    console.log(`   ${r.jlpt_level}  →  ${r.cnt}`)
    grandTotal += Number(r.cnt)
  }
  console.log(`   ────────────────`)
  console.log(`   Total  →  ${grandTotal}`)
  console.log()
}

main()
  .catch(err => { console.error('\n❌  Seed failed:', err); process.exit(1) })
  .finally(() => client.end())
