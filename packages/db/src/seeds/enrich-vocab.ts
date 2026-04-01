#!/usr/bin/env tsx
/**
 * enrich-vocab.ts
 *
 * Populates example_vocab for all kanji that currently have an empty array.
 * Uses Claude Haiku to generate 2 example vocab words per kanji in batches.
 * Safe to re-run — only processes kanji with empty vocab.
 *
 * Usage:
 *   pnpm --filter @kanji-learn/db seed:vocab
 */

import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL not set')

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set')

// Use postgres client directly — bypasses Drizzle to avoid JSONB double-encoding
const sql = postgres(connectionString, { max: 3 })
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

interface VocabItem {
  word: string
  reading: string
  meaning: string
}

interface KanjiRow {
  id: number
  character: string
  meanings: string[]
  kun_readings: string[]
  on_readings: string[]
}

async function generateVocabBatch(batch: KanjiRow[]): Promise<Map<number, VocabItem[]>> {
  const lines = batch.map((k, i) => {
    const readings = [...(k.on_readings ?? []), ...(k.kun_readings ?? []).map((r: string) => r.replace(/[-.]/g, ''))].slice(0, 3).join('、')
    return `${i}. ${k.character} (${readings || '?'}) — ${(k.meanings ?? []).slice(0, 2).join(', ')}`
  }).join('\n')

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `For each kanji below, give exactly 2 common Japanese vocabulary words that use that kanji. Format as JSON array of objects with keys: id (the number before the kanji), word (kanji+kana), reading (hiragana), meaning (English).

Kanji list:
${lines}

Return ONLY a JSON array like:
[{"id":0,"word":"時間","reading":"じかん","meaning":"time"},{"id":0,"word":"時代","reading":"じだい","meaning":"era"},...]

Include exactly 2 entries per kanji id. No markdown, no explanation.`,
    }],
  })

  const text = (message.content[0] as { type: string; text: string }).text.trim()

  let items: { id: number; word: string; reading: string; meaning: string }[]
  try {
    items = JSON.parse(text)
  } catch {
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) {
      console.warn('  ⚠ Could not parse response for batch, skipping')
      return new Map()
    }
    try {
      items = JSON.parse(match[0])
    } catch {
      console.warn('  ⚠ Could not parse extracted JSON, skipping')
      return new Map()
    }
  }

  const result = new Map<number, VocabItem[]>()
  for (const item of items) {
    const batchIdx = Number(item.id)
    if (batchIdx < 0 || batchIdx >= batch.length) continue
    const kanjiId = batch[batchIdx].id
    if (!result.has(kanjiId)) result.set(kanjiId, [])
    result.get(kanjiId)!.push({ word: item.word, reading: item.reading, meaning: item.meaning })
  }
  return result
}

async function main() {
  // Fix any remaining double-encoded rows first
  const fixed = await sql`
    UPDATE kanji SET example_vocab = (example_vocab #>> '{}')::jsonb
    WHERE jsonb_typeof(example_vocab) = 'string'
    RETURNING id
  `
  if (fixed.length > 0) console.log(`Fixed ${fixed.length} double-encoded rows`)

  // Fetch kanji with empty vocab arrays using postgres client directly
  const rows = await sql<KanjiRow[]>`
    SELECT id, character, meanings, kun_readings, on_readings
    FROM kanji
    WHERE jsonb_typeof(example_vocab) = 'array' AND jsonb_array_length(example_vocab) = 0
  `

  console.log(`Found ${rows.length} kanji with no example vocab`)
  if (rows.length === 0) { await sql.end(); return }

  const BATCH_SIZE = 20
  let updated = 0
  let failed = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    process.stdout.write(`  Processing ${i + 1}–${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length}…`)

    try {
      const vocabMap = await generateVocabBatch(batch)

      for (const row of batch) {
        const vocab = vocabMap.get(row.id) ?? []
        if (vocab.length === 0) {
          failed++
          continue
        }
        // Use postgres client directly with ::jsonb cast — no Drizzle involved
        await sql`UPDATE kanji SET example_vocab = ${JSON.stringify(vocab)}::jsonb WHERE id = ${row.id}`
        updated++
      }
      console.log(` ✓ (${vocabMap.size} populated)`)
    } catch (err) {
      console.log(` ✗ ${(err as Error).message}`)
      failed += batch.length
    }

    if (i + BATCH_SIZE < rows.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  console.log(`\nDone. Updated: ${updated}, Failed: ${failed}`)
  await sql.end()
}

main().catch(e => { console.error(e); process.exit(1) })
