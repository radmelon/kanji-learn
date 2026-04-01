#!/usr/bin/env tsx
/**
 * enrich-vocab.ts
 *
 * Populates example_vocab for all kanji that currently have an empty array.
 * Uses Claude Haiku to generate 2 example vocab words per kanji in batches.
 *
 * Usage:
 *   pnpm --filter @kanji-learn/db seed:vocab
 */

import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import postgres from 'postgres'
import { sql as rawSql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '../schema.js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL not set')

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set')

const client = postgres(connectionString, { max: 3 })
const db = drizzle(client, { schema })
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
  kunReadings: string[]
  onReadings: string[]
}

// Ask Claude Haiku for 2 example vocab words for a batch of kanji
async function generateVocabBatch(batch: KanjiRow[]): Promise<Map<number, VocabItem[]>> {
  const prompt = batch.map((k) => {
    const readings = [...k.onReadings, ...k.kunReadings.map(r => r.replace(/[-.]/g, ''))].slice(0, 3).join('、')
    return `${k.character} (${readings || '?'}) — ${k.meanings.slice(0, 2).join(', ')}`
  }).join('\n')

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `For each kanji below, give exactly 2 common Japanese vocabulary words that use that kanji. Format as JSON array of objects with keys: id (the number before the kanji), word (kanji+kana), reading (hiragana), meaning (English).

Kanji list (id. character readings — meanings):
${batch.map((k, i) => `${i}. ` + prompt.split('\n')[i]).join('\n')}

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
    // Try to extract JSON from the response
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) {
      console.warn('  ⚠ Could not parse response for batch, skipping')
      return new Map()
    }
    items = JSON.parse(match[0])
  }

  const result = new Map<number, VocabItem[]>()
  for (const item of items) {
    const batchIdx = item.id
    if (batchIdx < 0 || batchIdx >= batch.length) continue
    const kanjiId = batch[batchIdx].id
    if (!result.has(kanjiId)) result.set(kanjiId, [])
    result.get(kanjiId)!.push({ word: item.word, reading: item.reading, meaning: item.meaning })
  }
  return result
}

async function main() {
  // Fetch all kanji missing vocab
  const rows = await db
    .select({
      id: schema.kanji.id,
      character: schema.kanji.character,
      meanings: schema.kanji.meanings,
      kunReadings: schema.kanji.kunReadings,
      onReadings: schema.kanji.onReadings,
    })
    .from(schema.kanji)
    .where(rawSql`example_vocab IS NULL OR jsonb_typeof(example_vocab) != 'array' OR jsonb_array_length(example_vocab) = 0`)

  console.log(`Found ${rows.length} kanji with no example vocab`)

  const BATCH_SIZE = 20
  let updated = 0
  let failed = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE) as KanjiRow[]
    process.stdout.write(`  Processing ${i + 1}–${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length}…`)

    try {
      const vocabMap = await generateVocabBatch(batch)

      // Update each kanji in the batch
      for (const row of batch) {
        const vocab = vocabMap.get(row.id) ?? []
        if (vocab.length === 0) {
          failed++
          continue
        }
        await db
          .update(schema.kanji)
          .set({ exampleVocab: vocab })
          .where(rawSql`id = ${row.id}`)
        updated++
      }
      console.log(` ✓ (${vocabMap.size} populated)`)
    } catch (err) {
      console.log(` ✗ ${(err as Error).message}`)
      failed += batch.length
    }

    // Small delay to avoid rate limits
    if (i + BATCH_SIZE < rows.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  console.log(`\nDone. Updated: ${updated}, Failed: ${failed}`)
  await client.end()
}

main().catch(e => { console.error(e); process.exit(1) })
