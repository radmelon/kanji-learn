#!/usr/bin/env tsx
/**
 * seed-sentences.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Populates the `example_sentences` JSONB column on every kanji row using
 * sentences sourced from the Tatoeba CC-BY 2.0 corpus (tatoeba.org).
 *
 * Strategy (bulk download — much faster than the per-query API):
 *   1. Download and cache three TSV files from Tatoeba exports:
 *        jpn_sentences.tsv  — all Japanese sentences
 *        eng_sentences.tsv  — all English sentences
 *        links.tsv          — sentence-pair links (bidirectional)
 *   2. Build in-memory lookup: jpnId → text, engId → text, jpnId → [engIds]
 *   3. For each kanji, find every jpn sentence that contains the character.
 *      Prefer sentences where one of the kanji's exampleVocab words also appears.
 *      Score by length (shorter = better), cap at MAX_JP_CHARS.
 *      Store up to SENTENCES_PER_KANJI results.
 *   4. If no Tatoeba sentence is found, fall back to Claude Haiku.
 *
 * Usage:
 *   pnpm --filter @kanji-learn/db seed:sentences
 *   pnpm --filter @kanji-learn/db seed:sentences --force   # re-seed all
 *   pnpm --filter @kanji-learn/db seed:sentences --no-claude # skip fallback
 *
 * Cached files live in /tmp/tatoeba/ and are reused on subsequent runs.
 * Delete that directory to force a fresh download.
 *
 * Prerequisites:
 *   DATABASE_URL      — Supabase Postgres connection string
 *   ANTHROPIC_API_KEY — Only needed for the Claude fallback path
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { execSync } from 'node:child_process'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, sql, inArray } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { kanji } from '../schema'

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_JP_CHARS        = 60   // max Japanese sentence length to accept
const SENTENCES_PER_KANJI = 5    // how many sentences to store per kanji
const CLAUDE_RETRY_LIMIT  = 3
const CLAUDE_BASE_DELAY   = 2_000
const DB_BATCH_SIZE       = 50   // kanji updated per DB round-trip
const FORCE               = process.argv.includes('--force')
const NO_CLAUDE           = process.argv.includes('--no-claude')

const CACHE_DIR  = '/tmp/tatoeba'
const JPN_FILE   = path.join(CACHE_DIR, 'jpn_sentences.tsv')
const ENG_FILE   = path.join(CACHE_DIR, 'eng_sentences.tsv')
const LINKS_FILE = path.join(CACHE_DIR, 'links.tsv')

const JPN_URL   = 'https://downloads.tatoeba.org/exports/per_language/jpn/jpn_sentences.tsv.bz2'
const ENG_URL   = 'https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2'
const LINKS_URL = 'https://downloads.tatoeba.org/exports/links.tar.bz2'

// ─── Clients ──────────────────────────────────────────────────────────────────

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) { console.error('❌  DATABASE_URL is not set'); process.exit(1) }

const anthropicKey = process.env.ANTHROPIC_API_KEY
const anthropic = (!NO_CLAUDE && anthropicKey) ? new Anthropic({ apiKey: anthropicKey }) : null

const client = postgres(dbUrl, { max: 5 })
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

// ─── Download helpers ─────────────────────────────────────────────────────────

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })
}

function download(url: string, dest: string, label: string) {
  if (fs.existsSync(dest)) {
    console.log(`   ✓ ${label} — cached`)
    return
  }
  process.stdout.write(`   ↓ ${label} — downloading… `)
  if (url.endsWith('.tar.bz2')) {
    // tar.bz2: extract the single file inside and pipe to dest
    execSync(`curl -fsSL "${url}" | tar -xjO > "${dest}"`, { stdio: ['ignore', 'pipe', 'inherit'] })
  } else {
    // plain .bz2
    execSync(`curl -fsSL "${url}" | bzip2 -d > "${dest}"`, { stdio: ['ignore', 'pipe', 'inherit'] })
  }
  const mb = (fs.statSync(dest).size / 1_048_576).toFixed(1)
  console.log(`done (${mb} MB)`)
}

// ─── TSV parsers ──────────────────────────────────────────────────────────────

/** Parse a Tatoeba per-language sentence file → Map<id, text> */
async function parseSentences(file: string): Promise<Map<number, string>> {
  const map = new Map<number, string>()
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  for await (const line of rl) {
    const tab1 = line.indexOf('\t')
    const tab2 = line.indexOf('\t', tab1 + 1)
    if (tab1 < 0 || tab2 < 0) continue
    const id   = parseInt(line.slice(0, tab1), 10)
    const text = line.slice(tab2 + 1)
    if (!isNaN(id) && text) map.set(id, text)
  }
  return map
}

/**
 * Parse links.tsv → Map<jpnId, engId[]>
 * The links file is bidirectional so we check both orderings.
 */
async function parseLinks(
  file: string,
  jpnIds: Set<number>,
  engIds: Set<number>
): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>()
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  for await (const line of rl) {
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const a = parseInt(line.slice(0, tab), 10)
    const b = parseInt(line.slice(tab + 1), 10)
    if (isNaN(a) || isNaN(b)) continue

    if (jpnIds.has(a) && engIds.has(b)) {
      const arr = map.get(a)
      if (arr) arr.push(b)
      else map.set(a, [b])
    } else if (jpnIds.has(b) && engIds.has(a)) {
      const arr = map.get(b)
      if (arr) arr.push(a)
      else map.set(b, [a])
    }
  }
  return map
}

// ─── Sentence selection ───────────────────────────────────────────────────────

/**
 * Defensive validator: ensures a generated sentence actually contains the
 * target kanji character. Tatoeba path already filters via charIndex; this
 * is belt-and-suspenders for the Claude fallback and any future changes.
 */
function validateSentenceContainsKanji(ja: string, kanji: string): boolean {
  return ja.includes(kanji)
}

/**
 * From the full Tatoeba corpus (already in memory), pick the best sentences
 * for a given kanji character.
 *
 * Scoring priority:
 *   1. Contains a vocab word from exampleVocab (preferred)
 *   2. Shorter is better
 *   3. Must be ≤ MAX_JP_CHARS
 */
function pickFromCorpus(
  character: string,
  vocabWords: string[],
  jpnBySentence: Map<number, number[]>,  // jpnId → [engId]
  jpnText: Map<number, string>,
  engText: Map<number, string>,
  charIndex: Map<string, number[]>        // char → [jpnIds]
): Sentence[] {
  const candidateIds = charIndex.get(character) ?? []
  if (candidateIds.length === 0) return []

  interface Scored { ja: string; en: string; vocab: string; score: number }
  const scored: Scored[] = []

  for (const jpnId of candidateIds) {
    const ja = jpnText.get(jpnId)
    if (!ja || ja.length > MAX_JP_CHARS) continue
    const engIds = jpnBySentence.get(jpnId)
    if (!engIds || engIds.length === 0) continue
    const en = engText.get(engIds[0]!)
    if (!en) continue

    // Tag with matching vocab word, or fall back to the kanji character itself
    const matchedVocab = vocabWords.find((w) => ja.includes(w)) ?? character
    const vocabBonus = matchedVocab !== character ? 1000 : 0

    scored.push({ ja, en, vocab: matchedVocab, score: vocabBonus - ja.length })
  }

  // Sort descending by score (higher = better vocab match + shorter)
  scored.sort((a, b) => b.score - a.score)

  // Deduplicate by ja text
  const seen = new Set<string>()
  const result: Sentence[] = []
  for (const s of scored) {
    if (seen.has(s.ja)) continue
    seen.add(s.ja)
    result.push({ ja: s.ja, en: s.en, vocab: s.vocab })
    if (result.length >= SENTENCES_PER_KANJI) break
  }
  return result
}

// ─── Claude fallback ──────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)) }

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

  for (let attempt = 0; attempt < CLAUDE_RETRY_LIMIT; attempt++) {
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
      process.stdout.write(`⚠️  Claude for ${k.character} attempt ${attempt + 1}: unexpected shape\n`)
    } catch (err: any) {
      const isLast = attempt === CLAUDE_RETRY_LIMIT - 1
      process.stdout.write(`⚠️  Claude for ${k.character} attempt ${attempt + 1}: ${err?.message ?? err}\n`)
      if (!isLast) await sleep(CLAUDE_BASE_DELAY * 2 ** attempt)
    }
  }
  return []
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n📚  seed-sentences (bulk) — sourcing from Tatoeba corpus\n')

  // ── Step 1: Download corpus files ─────────────────────────────────────────
  console.log('📥  Checking Tatoeba corpus cache…')
  ensureCacheDir()
  download(JPN_URL,   JPN_FILE,   'jpn_sentences.tsv')
  download(ENG_URL,   ENG_FILE,   'eng_sentences.tsv')
  download(LINKS_URL, LINKS_FILE, 'links.tsv        ')

  // ── Step 2: Parse into memory ──────────────────────────────────────────────
  console.log('\n🔍  Parsing corpus into memory…')
  process.stdout.write('   jpn sentences… ')
  const jpnText = await parseSentences(JPN_FILE)
  console.log(`${jpnText.size.toLocaleString()} sentences`)

  process.stdout.write('   eng sentences… ')
  const engText = await parseSentences(ENG_FILE)
  console.log(`${engText.size.toLocaleString()} sentences`)

  const jpnIds = new Set(jpnText.keys())
  const engIds = new Set(engText.keys())

  process.stdout.write('   links… ')
  const jpnToEng = await parseLinks(LINKS_FILE, jpnIds, engIds)
  console.log(`${jpnToEng.size.toLocaleString()} jpn→eng pairs`)

  // ── Step 3: Build character index ─────────────────────────────────────────
  process.stdout.write('   building character index… ')
  const charIndex = new Map<string, number[]>()
  for (const [id, text] of jpnText) {
    // Only index sentences we actually have English translations for
    if (!jpnToEng.has(id)) continue
    // Index every CJK character in this sentence
    for (const ch of text) {
      if (ch >= '\u4e00' && ch <= '\u9fff') {
        const arr = charIndex.get(ch)
        if (arr) arr.push(id)
        else charIndex.set(ch, [id])
      }
    }
  }
  console.log(`${charIndex.size.toLocaleString()} unique kanji indexed`)

  // ── Step 4: Load kanji from DB ────────────────────────────────────────────
  console.log('\n📖  Loading kanji from database…')
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

  // ── Step 5: Match + write ─────────────────────────────────────────────────
  console.log('\n✍️   Matching sentences and writing to DB…\n')

  let tataoebaCount  = 0
  let claudeCount    = 0
  let skippedCount   = 0
  const updates: { id: number; sentences: Sentence[] }[] = []

  async function flushBatch() {
    if (updates.length === 0) return
    await Promise.all(updates.map(({ id, sentences }) =>
      db.update(kanji)
        .set({ exampleSentences: sentences })
        .where(eq(kanji.id, id))
    ))

    // Post-write sanity check — guards against future jsonb-encoding regressions.
    // If any row wrote as a jsonb string instead of array, log loudly and exit.
    const ids = updates.map(u => u.id)
    const checkRows = await db
      .select({ id: kanji.id, t: sql<string>`jsonb_typeof(example_sentences)` })
      .from(kanji)
      .where(inArray(kanji.id, ids))
    const bad = checkRows.filter(r => r.t !== 'array')
    if (bad.length > 0) {
      console.error(`❌  ${bad.length} rows stored example_sentences as ${bad[0].t}, not array: ${bad.map(r => r.id).join(', ')}`)
      process.exit(1)
    }

    updates.length = 0
  }

  for (let i = 0; i < todo.length; i++) {
    const k = todo[i] as KanjiRow
    const vocabWords = (Array.isArray(k.exampleVocab) ? k.exampleVocab : []).map((v) => v.word)

    let sentences = pickFromCorpus(
      k.character,
      vocabWords,
      jpnToEng,
      jpnText,
      engText,
      charIndex,
    )

    if (sentences.length > 0) {
      tataoebaCount++
    } else {
      // Claude fallback
      sentences = await generateFallback(k)
      if (sentences.length > 0) claudeCount++
      else skippedCount++
    }

    const validated = sentences.filter((s) => {
      const ok = validateSentenceContainsKanji(s.ja, k.character)
      if (!ok) {
        console.warn(`⚠️  Rejected sentence for ${k.character}: "${s.ja}" (does not contain kanji)`)
      }
      return ok
    })

    if (validated.length > 0) {
      updates.push({ id: k.id, sentences: validated })
    }

    if (updates.length >= DB_BATCH_SIZE) await flushBatch()

    if ((i + 1) % 100 === 0 || i + 1 === todo.length) {
      const pct = (((i + 1) / todo.length) * 100).toFixed(1)
      process.stdout.write(`   ${i + 1}/${todo.length} (${pct}%) — tatoeba:${tataoebaCount} claude:${claudeCount} skipped:${skippedCount}\n`)
    }
  }

  await flushBatch()

  // ── Step 6: Summary ───────────────────────────────────────────────────────
  const [countRow] = await db
    .select({ total: sql<number>`count(*) filter (where jsonb_typeof(example_sentences) = 'array' and jsonb_array_length(example_sentences) > 0)::int` })
    .from(kanji)

  console.log(`\n✅  Done!`)
  console.log(`   Tatoeba sentences : ${tataoebaCount}`)
  console.log(`   Claude fallback   : ${claudeCount}`)
  console.log(`   No sentences found: ${skippedCount}`)
  console.log(`   Total with data   : ${countRow?.total ?? '?'} / ${allKanji.length}\n`)

  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
