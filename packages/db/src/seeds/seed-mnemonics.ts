#!/usr/bin/env tsx
/**
 * seed-mnemonics.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pre-seeds the `mnemonics` table with AI-generated system mnemonics for every
 * kanji in the database using Claude Haiku.
 *
 * Usage:
 *   pnpm --filter @kanji-learn/db seed:mnemonics
 *
 * Prerequisites:
 *   DATABASE_URL  — Supabase Postgres connection string
 *   ANTHROPIC_API_KEY — Anthropic API key
 *
 * Behaviour:
 *   - Fetches all kanji from the `kanji` table.
 *   - Skips kanji that already have a system mnemonic (safe to re-run).
 *   - Calls claude-haiku-4-5 with a structured prompt to produce:
 *       • storyText  — vivid story connecting meaning + reading + radical
 *       • imagePrompt — concise DALL-E-style prompt for a scene illustration
 *   - Processes up to CONCURRENCY kanji in parallel to stay within rate limits.
 *   - Backs off and retries on 429 / 5xx errors.
 *   - Sets refreshPromptAt = now + 30 days for each inserted row.
 *   - Logs progress and a final summary.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, and, isNull, sql } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { kanji, mnemonics } from '../schema'

// ─── Config ───────────────────────────────────────────────────────────────────

const CONCURRENCY = 3        // parallel requests to Haiku (50 req/min limit)
const INTER_REQUEST_MS = 1_500 // min pause between requests per worker (~36 req/min total)
const RETRY_LIMIT = 5        // max retries per kanji
const BASE_DELAY_MS = 2_000  // 2 s base for exponential backoff
const REFRESH_DAYS = 30      // days before re-generation nudge

// ─── Clients ──────────────────────────────────────────────────────────────────

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) { console.error('❌  DATABASE_URL is not set'); process.exit(1) }

const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) { console.error('❌  ANTHROPIC_API_KEY is not set'); process.exit(1) }

const client = postgres(dbUrl, { max: 5 })
const db = drizzle(client)
const anthropic = new Anthropic({ apiKey, timeout: 60_000 })

// ─── Types ────────────────────────────────────────────────────────────────────

interface KanjiRow {
  id: number
  character: string
  meanings: string[]
  onReadings: string[]
  kunReadings: string[]
  radicals: string[]
  jlptLevel: string
}

interface MnemonicResult {
  storyText: string
  imagePrompt: string
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(k: KanjiRow): string {
  const meanings = k.meanings.slice(0, 3).join(', ')
  const on = k.onReadings.slice(0, 2).join(', ') || '—'
  const kun = k.kunReadings.slice(0, 2).join(', ') || '—'
  const radicals = k.radicals.slice(0, 4).join(', ') || '—'

  return `You are a Japanese kanji mnemonic expert. Create a memorable mnemonic for the kanji "${k.character}" (JLPT ${k.jlptLevel}).

Kanji info:
- Primary meanings: ${meanings}
- On'yomi readings: ${on}
- Kun'yomi readings: ${kun}
- Radicals / components: ${radicals}

Return ONLY a JSON object (no markdown, no extra text) with exactly these two keys:
{
  "storyText": "A vivid 2–4 sentence mnemonic story that weaves together the meaning, a reading hook (use the sound of the on'yomi or kun'yomi as a memorable word/phrase), and the visual shape of the kanji or its radicals. Make it imaginative and concrete so it sticks.",
  "imagePrompt": "A short, vivid DALL-E-style image prompt (max 25 words) depicting the core scene from the story above."
}`
}

// ─── API call with retry ───────────────────────────────────────────────────────

async function generateMnemonic(k: KanjiRow): Promise<MnemonicResult> {
  let lastError: unknown

  for (let attempt = 0; attempt <= RETRY_LIMIT; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 500
      await sleep(delay)
    }

    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        messages: [{ role: 'user', content: buildPrompt(k) }],
      })

      const raw = response.content.find(b => b.type === 'text')?.text ?? ''
      // Strip markdown code fences if the model wraps its response (e.g. ```json … ```)
      const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

      let parsed: MnemonicResult | null = null

      // 1. Try clean JSON parse first
      try {
        parsed = JSON.parse(text) as MnemonicResult
      } catch {
        // 2. Try extracting from the largest {...} block (handles surrounding text)
        const jsonBlock = text.match(/\{[\s\S]*\}/)
        if (jsonBlock) {
          try { parsed = JSON.parse(jsonBlock[0]) as MnemonicResult } catch { /* fall through */ }
        }
      }

      // 3. Regex fallback — pull the two string values directly from the raw text
      if (!parsed?.storyText || !parsed?.imagePrompt) {
        const storyMatch = raw.match(/"storyText"\s*:\s*"((?:[^"\\]|\\.)*)"/)
        const imageMatch = raw.match(/"imagePrompt"\s*:\s*"((?:[^"\\]|\\.)*)"/)
        if (storyMatch && imageMatch) {
          parsed = {
            storyText: storyMatch[1].replace(/\\"/g, '"'),
            imagePrompt: imageMatch[1].replace(/\\"/g, '"'),
          }
        }
      }

      if (!parsed?.storyText || !parsed?.imagePrompt) {
        throw new Error(`Unparseable response for ${k.character}: ${text.slice(0, 120)}`)
      }

      // Pace requests: small mandatory pause after each success to stay under rate limit
      await sleep(INTER_REQUEST_MS)
      return parsed
    } catch (err: unknown) {
      lastError = err

      // Retry on rate limit, server errors, or timeouts.
      // Note: Use status-code / name checks instead of instanceof — ESM/CJS boundary can make
      // Anthropic error classes resolve as non-objects, breaking instanceof at runtime.
      const status = (err as { status?: number })?.status
      const errName = (err as { name?: string })?.name ?? ''
      const errMsg = (err as Error)?.message ?? ''
      const isRetryable =
        status === 429 ||
        (status !== undefined && status >= 500) ||
        errName === 'APIConnectionTimeoutError' ||
        errName === 'APIConnectionError' ||
        errMsg.toLowerCase().includes('timed out') ||
        errMsg.toLowerCase().includes('timeout') ||
        errMsg.toLowerCase().includes('econnreset') ||
        errMsg.toLowerCase().includes('econnrefused') ||
        errMsg.toLowerCase().includes('socket hang up') ||
        errMsg.toLowerCase().includes('network')

      if (isRetryable) continue

      // Non-retryable error — rethrow
      throw err
    }
  }

  throw lastError
}

// ─── Concurrency pool ─────────────────────────────────────────────────────────

async function runConcurrent<T>(
  items: T[],
  fn: (item: T, index: number) => Promise<void>,
  concurrency: number
): Promise<void> {
  let index = 0

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++
      await fn(items[i], i)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function refreshDate(): Date {
  const d = new Date()
  d.setDate(d.getDate() + REFRESH_DAYS)
  return d
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🧠  Kanji-Learn — Mnemonic Pre-Seed Script (Claude Haiku)')
  console.log('━'.repeat(55))

  // 1. Fetch all kanji
  const allKanji = await db
    .select({
      id: kanji.id,
      character: kanji.character,
      meanings: kanji.meanings,
      onReadings: kanji.onReadings,
      kunReadings: kanji.kunReadings,
      radicals: kanji.radicals,
      jlptLevel: kanji.jlptLevel,
    })
    .from(kanji)
    .orderBy(kanji.jlptLevel, kanji.jlptOrder)

  console.log(`\n📚  Found ${allKanji.length} kanji in database`)

  // 2. Find which kanji already have a system mnemonic
  const existingRows = await db
    .select({ kanjiId: mnemonics.kanjiId })
    .from(mnemonics)
    .where(
      and(
        eq(mnemonics.type, 'system'),
        isNull(mnemonics.userId)
      )
    )

  const existingSet = new Set(existingRows.map(r => r.kanjiId))
  const pending = (allKanji as KanjiRow[]).filter(k => !existingSet.has(k.id))

  console.log(`✅  Already seeded: ${existingSet.size}`)
  console.log(`⏳  Pending:        ${pending.length}`)

  if (pending.length === 0) {
    console.log('\n🎉  All kanji already have system mnemonics. Nothing to do.\n')
    return
  }

  // 3. Generate + insert
  let done = 0
  let errors = 0
  const startTime = Date.now()

  await runConcurrent(pending, async (k, _i) => {
    try {
      const result = await generateMnemonic(k)

      await db.insert(mnemonics).values({
        kanjiId: k.id,
        userId: null,
        type: 'system',
        storyText: result.storyText,
        imagePrompt: result.imagePrompt,
        refreshPromptAt: refreshDate(),
      })

      done++

      // Progress line every 10 completions or on last item
      if (done % 10 === 0 || done + errors === pending.length) {
        const pct = ((done + errors) / pending.length * 100).toFixed(1)
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
        process.stdout.write(
          `\r  ${done + errors}/${pending.length} (${pct}%)  ✓ ${done}  ✗ ${errors}  ${elapsed}s`
        )
      }
    } catch (err) {
      errors++
      console.error(`\n  ✗  Failed for "${k.character}" (id ${k.id}):`, (err as Error).message)
    }
  }, CONCURRENCY)

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  console.log('\n\n' + '━'.repeat(55))
  console.log(`🎉  Done in ${elapsed}s!`)
  console.log(`   ✓  Inserted: ${done}`)
  console.log(`   ✗  Errors:   ${errors}`)

  // 4. Final totals
  const totals = await db.execute(sql`
    SELECT jlpt_level, COUNT(*) AS cnt
    FROM kanji k
    JOIN mnemonics m ON m.kanji_id = k.id AND m.type = 'system' AND m.user_id IS NULL
    GROUP BY jlpt_level
    ORDER BY jlpt_level
  `)

  console.log('\n📊  System mnemonics by level:')
  for (const row of totals) {
    const r = row as Record<string, unknown>
    console.log(`   ${r.jlpt_level}  →  ${r.cnt} mnemonics`)
  }
  console.log()
}

main()
  .catch(err => {
    console.error('\n❌  Seed failed:', err)
    process.exit(1)
  })
  .finally(() => client.end())
