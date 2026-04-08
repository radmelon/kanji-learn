#!/usr/bin/env tsx
/**
 * seed-sentences.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Populates the `example_sentences` JSONB column on every kanji row using
 * sentences sourced from the Tatoeba CC-BY 2.0 corpus (tatoeba.org).
 *
 * Strategy:
 *   1. For each kanji, try each of its exampleVocab words as search queries
 *      against the Tatoeba search API.
 *   2. Score results: prefer short sentences (≤ 30 chars) where the vocab word
 *      appears verbatim in the Japanese text.
 *   3. Store up to 2 sentences as { ja, en, vocab } objects.
 *   4. If no Tatoeba hit is found, fall back to a simple sentence generated
 *      by Claude Haiku so every kanji gets coverage.
 *
 * Usage:
 *   pnpm --filter @kanji-learn/db seed:sentences
 *
 * Prerequisites:
 *   DATABASE_URL      — Supabase Postgres connection string (direct, not pooler)
 *   ANTHROPIC_API_KEY — Only needed for the Claude fallback path
 *
 * Re-run safe: skips kanji that already have sentences unless --force is passed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, sql } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { kanji } from '../schema'

// ─── Config ───────────────────────────────────────────────────────────────────

const CONCURRENCY = 4
const TATOEBA_DELAY_MS = 300     // ~3 req/s to be polite
const RETRY_LIMIT = 3
const BASE_DELAY_MS = 1_500
const MAX_SENTENCE_JP_CHARS = 40 // keep sentences short/learner-friendly
const FORCE = process.argv.includes('--force')

// ─── Clients ──────────────────────────────────────────────────────────────────

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) { console.error('❌  DATABASE_URL is not set'); process.exit(1) }

const anthropicKey = process.env.ANTHROPIC_API_KEY
const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null

const client = postgres(dbUrl, { max: 3 })
const db = drizzle(client)

// ─── Types ────────────────────────────────────────────────────────────────────

interface KanjiRow {
  id: number
  character: string
  jlptLevel: string
  exampleVocab: { word: string; reading: string; meaning: string }[]
  exampleSentences: { ja: string; en: string; vocab: string }[]
}

interface Sentence {
  ja: string
  en: string
  vocab: string
}

// ─── Tatoeba ──────────────────────────────────────────────────────────────────

const TATOEBA_BASE = 'https://tatoeba.org/api_v0/search'

async function fetchTatoeba(query: string): Promise<{ ja: string; en: string }[]> {
  const url = `${TATOEBA_BASE}?from=jpn&to=eng&query=${encodeURIComponent(query)}&sort=relevance&trans_filter=limit&trans_has_audio=no`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'kanji-learn-seed/1.0 (github.com/radmelon/kanji-learn)' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Tatoeba ${res.status}`)
  const json: any = await res.json()
  const results: { ja: string; en: string }[] = []
  for (const result of json.results ?? []) {
    const ja: string = result.text ?? ''
    if (!ja) continue
    // Find the English translation
    const trans = (result.translations ?? []).flat()
    const en: string = trans.find((t: any) => t.lang === 'eng')?.text ?? ''
    if (!en) continue
    results.push({ ja, en })
  }
  return results
}

/**
 * Pick the best 1–2 sentences from Tatoeba results for a given vocab word.
 * Scoring: shorter sentences score higher; must contain vocab verbatim.
 */
function pickSentences(
  results: { ja: string; en: string }[],
  vocabWord: string,
  max = 2
): { ja: string; en: string }[] {
  const hits = results
    .filter((r) => r.ja.includes(vocabWord) && r.ja.length <= MAX_SENTENCE_JP_CHARS)
    .sort((a, b) => a.ja.length - b.ja.length)
  return hits.slice(0, max)
}

// ─── Claude fallback ──────────────────────────────────────────────────────────

async function generateFallback(k: KanjiRow): Promise<Sentence[]> {
  if (!anthropic) return []
  const vocab = k.exampleVocab[0]
  if (!vocab) return []

  const prompt = `Write one short, simple Japanese example sentence (under 30 characters) using the word "${vocab.word}" (${vocab.reading}, meaning: ${vocab.meaning}). The sentence should be appropriate for JLPT ${k.jlptLevel} level learners.

Return ONLY a JSON object with exactly these keys:
{
  "ja": "the Japanese sentence",
  "en": "the English translation"
}
No markdown, no extra text.`

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = (msg.content[0] as any).text?.trim() ?? ''
    const parsed = JSON.parse(text)
    if (parsed.ja && parsed.en) {
      return [{ ja: parsed.ja, en: parsed.en, vocab: vocab.word }]
    }
  } catch {
    // non-fatal
  }
  return []
}

// ─── Per-kanji processing ─────────────────────────────────────────────────────

async function processKanji(k: KanjiRow): Promise<Sentence[]> {
  const sentences: Sentence[] = []
  const seen = new Set<string>()

  for (const vocab of k.exampleVocab.slice(0, 4)) {
    if (sentences.length >= 2) break
    await sleep(TATOEBA_DELAY_MS)

    let results: { ja: string; en: string }[] = []
    for (let attempt = 0; attempt < RETRY_LIMIT; attempt++) {
      try {
        results = await fetchTatoeba(vocab.word)
        break
      } catch (err: any) {
        if (attempt < RETRY_LIMIT - 1) {
          await sleep(BASE_DELAY_MS * 2 ** attempt)
        }
      }
    }

    const picked = pickSentences(results, vocab.word, 2 - sentences.length)
    for (const p of picked) {
      if (!seen.has(p.ja)) {
        seen.add(p.ja)
        sentences.push({ ...p, vocab: vocab.word })
      }
    }
  }

  // Fall back to Claude Haiku if Tatoeba gave us nothing
  if (sentences.length === 0) {
    const fallback = await generateFallback(k)
    sentences.push(...fallback)
  }

  return sentences
}

// ─── Concurrency helper ───────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

async function runPool<T>(items: T[], fn: (item: T) => Promise<void>, concurrency: number) {
  const queue = [...items]
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!
      await fn(item)
    }
  })
  await Promise.all(workers)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n📚  seed-sentences — sourcing example sentences from Tatoeba\n')

  const allKanji = await db.select({
    id: kanji.id,
    character: kanji.character,
    jlptLevel: kanji.jlptLevel,
    exampleVocab: kanji.exampleVocab,
    exampleSentences: kanji.exampleSentences,
  }).from(kanji)

  const todo = FORCE
    ? allKanji
    : allKanji.filter((k) => (k.exampleSentences as any[]).length === 0)

  console.log(`   Total kanji : ${allKanji.length}`)
  console.log(`   Need seeding: ${todo.length}`)
  if (todo.length === 0) {
    console.log('\n🎉  All kanji already have sentences. Pass --force to regenerate.\n')
    await client.end()
    return
  }

  let done = 0
  let tatoeba = 0
  let fallback = 0
  let skipped = 0

  await runPool(todo as KanjiRow[], async (k) => {
    try {
      const sentences = await processKanji(k)
      if (sentences.length === 0) {
        skipped++
        process.stdout.write(`⚠️  ${k.character} — no sentences found\n`)
      } else {
        const source = sentences.some((s) => s.ja && s.en) ? 'tatoeba' : 'claude'
        if (source === 'tatoeba') tatoeba++ ; else fallback++
        await db.update(kanji)
          .set({ exampleSentences: sentences })
          .where(eq(kanji.id, k.id))
      }
    } catch (err: any) {
      skipped++
      process.stdout.write(`❌  ${k.character} — ${err?.message ?? err}\n`)
    }
    done++
    if (done % 50 === 0 || done === todo.length) {
      process.stdout.write(`   Progress: ${done}/${todo.length}\n`)
    }
  }, CONCURRENCY)

  // Summary
  const [countRow] = await db.select({ total: sql<number>`count(*) filter (where jsonb_array_length(example_sentences) > 0)::int` }).from(kanji)
  console.log(`\n✅  Done`)
  console.log(`   Tatoeba sentences : ${tatoeba}`)
  console.log(`   Claude fallback   : ${fallback}`)
  console.log(`   Skipped/failed    : ${skipped}`)
  console.log(`   Total with data   : ${countRow?.total ?? '?'} / ${allKanji.length}\n`)

  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
