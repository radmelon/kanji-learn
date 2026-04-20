#!/usr/bin/env tsx
/**
 * enrich-vocab.ts
 *
 * Populates example_vocab for kanji, using Claude Haiku to generate entries
 * then merging Kanjium pitch-accent data. Validates that every generated word
 * actually contains the target kanji (closes B4).
 *
 * Usage:
 *   pnpm --filter @kanji-learn/db seed:vocab
 *   pnpm --filter @kanji-learn/db seed:vocab --force             # re-process all kanji
 *   pnpm --filter @kanji-learn/db seed:vocab --allow-below-floor # skip floor gate
 */

import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import postgres from 'postgres'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { execSync } from 'node:child_process'

// ─── Constants ────────────────────────────────────────────────────────────────

const TARGET_VOCAB_PER_KANJI = 5
const FLOOR = 3
const BATCH_SIZE = 20

const FORCE = process.argv.includes('--force')
const ALLOW_BELOW_FLOOR = process.argv.includes('--allow-below-floor')

// ─── DB / API clients ─────────────────────────────────────────────────────────

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL not set')

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set')

// Use postgres client directly — bypasses Drizzle to avoid JSONB double-encoding
const sql = postgres(connectionString, { max: 3 })
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

// ─── Types ────────────────────────────────────────────────────────────────────

interface VocabItem {
  word: string
  reading: string
  meaning: string
  pitchPattern?: number[]
}

interface KanjiRow {
  id: number
  character: string
  meanings: string[]
  kun_readings: string[]
  on_readings: string[]
}

interface RejectionRecord {
  kanji: string
  rejectedWord: string
  reason: string
}

interface BelowFloorRecord {
  kanji: string
  vocabCount: number
  reason: string
}

// ─── Pure helper functions (exported for testing) ─────────────────────────────

/**
 * Validates that a vocab entry's word contains the target kanji character.
 * Closes B4 (kanji doesn't contain itself).
 */
export function validateVocabContainsKanji(word: string, kanji: string): boolean {
  return word.includes(kanji)
}

/**
 * Count morae in a hiragana reading. Small kana (ゃゅょ and their katakana
 * equivalents) attach to the preceding mora and don't count separately.
 * Sokuon (っ), hatsuon (ん), and chouon (ー) are each their own mora.
 */
export function countMorae(reading: string): number {
  const smallKana = new Set('ゃゅょゃゅょャュョ')  // hiragana + katakana small y-kana
  let n = 0
  for (const ch of reading) {
    if (!smallKana.has(ch)) n++
  }
  return n
}

/**
 * Convert a Kanjium accent digit to our mora-flag array representation.
 * Flags: 0 = low mora, 1 = high mora. Array length equals moraCount.
 *
 * Patterns:
 *   accent === 0 (heiban):     L H H H ... H   → [0, 1, 1, ..., 1]
 *   accent === 1 (atamadaka):  H L L L ... L   → [1, 0, 0, ..., 0]
 *   accent >= 2 (nakadaka/odaka): L H ... H(accent) L ... L
 *     → [0, 1, ..., 1 at positions 1..accent-1, 0, ..., 0]
 *
 * Verify: accent=2 moraCount=3 → [0, 1, 0] (nakadaka, drop after mora 2)
 *         accent=3 moraCount=3 → [0, 1, 1] (odaka)
 *         accent=3 moraCount=4 → [0, 1, 1, 0] (nakadaka)
 */
export function accentToPattern(accent: number, moraCount: number): number[] {
  if (moraCount <= 0) return []
  if (accent === 0) {
    return Array.from({ length: moraCount }, (_, i) => (i === 0 ? 0 : 1))
  }
  if (accent === 1) {
    return Array.from({ length: moraCount }, (_, i) => (i === 0 ? 1 : 0))
  }
  return Array.from({ length: moraCount }, (_, i) => (i >= 1 && i < accent ? 1 : 0))
}

/**
 * Parse a single Kanjium accents.txt line. Format: word<TAB>reading<TAB>accent-spec
 * where accent-spec may be a single digit or comma-separated digits. Returns
 * the key+value for the lookup map, or null if malformed.
 *
 * Multiple patterns: we take the first (dictionary-primary, Tokyo-standard)
 * per the Build 3-C design decision on dialectal variants.
 */
export function parseKanjiumLine(
  line: string,
): { key: string; accent: number } | null {
  const parts = line.split('\t')
  if (parts.length !== 3) return null
  const [word, reading, accentSpec] = parts
  const first = accentSpec.split(',')[0].trim()
  const accent = Number(first)
  if (!Number.isFinite(accent) || accent < 0) return null
  return { key: `${word}|${reading}`, accent }
}

// ─── Kanjium loader ───────────────────────────────────────────────────────────

function loadKanjiumIndex(): Map<string, number> {
  const here = dirname(fileURLToPath(import.meta.url))
  const accentsPath = resolve(here, '../../data/kanjium/accents.txt')
  const content = readFileSync(accentsPath, 'utf-8')
  const index = new Map<string, number>()
  for (const line of content.split('\n')) {
    if (!line) continue
    const parsed = parseKanjiumLine(line)
    if (parsed) index.set(parsed.key, parsed.accent)
  }
  return index
}

// ─── Claude generation ────────────────────────────────────────────────────────

async function generateVocabBatch(batch: KanjiRow[]): Promise<Map<number, VocabItem[]>> {
  const lines = batch.map((k, i) => {
    const readings = [
      ...(k.on_readings ?? []),
      ...(k.kun_readings ?? []).map((r: string) => r.replace(/[-.]/g, '')),
    ].slice(0, 3).join('、')
    return `${i}. ${k.character} (${readings || '?'}) — ${(k.meanings ?? []).slice(0, 2).join(', ')}`
  }).join('\n')

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `For each kanji below, give exactly ${TARGET_VOCAB_PER_KANJI} common Japanese vocabulary words that use that kanji. Format as JSON array of objects with keys: id (the number before the kanji), word (kanji+kana), reading (hiragana), meaning (English).

Kanji list:
${lines}

Return ONLY a JSON array like:
[{"id":0,"word":"時間","reading":"じかん","meaning":"time"},{"id":0,"word":"時代","reading":"じだい","meaning":"era"},...]

Include exactly ${TARGET_VOCAB_PER_KANJI} entries per kanji id. No markdown, no explanation.`,
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

// ─── Seed-output helpers ──────────────────────────────────────────────────────

function getSeedOutputDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../../seed-output')
}

function getGitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}

function getDateString(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Loading Kanjium pitch-accent index…')
  const kanjiumIndex = loadKanjiumIndex()
  console.log(`  Loaded ${kanjiumIndex.size} pitch-accent entries`)

  // Fix any remaining double-encoded rows first
  const fixed = await sql`
    UPDATE kanji SET example_vocab = (example_vocab #>> '{}')::jsonb
    WHERE jsonb_typeof(example_vocab) = 'string'
    RETURNING id
  `
  if (fixed.length > 0) console.log(`Fixed ${fixed.length} double-encoded rows`)

  // Fetch kanji — skip populated unless --force
  const rows = FORCE
    ? await sql<KanjiRow[]>`
        SELECT id, character, meanings, kun_readings, on_readings
        FROM kanji
        ORDER BY id
      `
    : await sql<KanjiRow[]>`
        SELECT id, character, meanings, kun_readings, on_readings
        FROM kanji
        WHERE jsonb_typeof(example_vocab) = 'array' AND jsonb_array_length(example_vocab) = 0
        ORDER BY id
      `

  console.log(`Found ${rows.length} kanji to process${FORCE ? ' (--force)' : ''}`)
  if (rows.length === 0) {
    console.log('Nothing to do. Pass --force to re-process all kanji.')
    await sql.end()
    return
  }

  let updated = 0
  let failed = 0
  let totalAccepted = 0
  let totalRejected = 0
  let totalMissingPitch = 0

  const rejections: RejectionRecord[] = []
  const belowFloor: BelowFloorRecord[] = []

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    process.stdout.write(
      `  Processing ${i + 1}–${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length}…`
    )

    try {
      const vocabMap = await generateVocabBatch(batch)

      for (const row of batch) {
        const rawVocab = vocabMap.get(row.id) ?? []

        if (rawVocab.length === 0) {
          failed++
          belowFloor.push({
            kanji: row.character,
            vocabCount: 0,
            reason: 'Claude returned no entries for this kanji',
          })
          continue
        }

        // Self-containment validator (closes B4)
        const accepted: VocabItem[] = []
        for (const entry of rawVocab) {
          if (validateVocabContainsKanji(entry.word, row.character)) {
            accepted.push(entry)
          } else {
            totalRejected++
            rejections.push({
              kanji: row.character,
              rejectedWord: entry.word,
              reason: 'word does not contain target kanji',
            })
          }
        }

        // Kanjium pitch merge
        const withPitch: VocabItem[] = accepted.map(entry => {
          const key = `${entry.word}|${entry.reading}`
          const accent = kanjiumIndex.get(key)
          if (accent === undefined) {
            totalMissingPitch++
            return entry
          }
          const moraCount = countMorae(entry.reading)
          const pitchPattern = accentToPattern(accent, moraCount)
          return { ...entry, pitchPattern }
        })

        totalAccepted += withPitch.length

        // Floor gate check
        if (withPitch.length < FLOOR) {
          belowFloor.push({
            kanji: row.character,
            vocabCount: withPitch.length,
            reason: `fewer than ${FLOOR} accepted entries`,
          })
        }

        // Write to DB using postgres client directly — no Drizzle, no double-encoding
        // Use sql.json() so postgres.js serializes the value correctly as jsonb (not double-encoded text)
        await sql`UPDATE kanji SET example_vocab = ${sql.json(withPitch as unknown as postgres.JSONValue)} WHERE id = ${row.id}`

        // Post-write sanity check — guards against future jsonb-encoding regressions
        const [verify] = await sql<{ t: string }[]>`
          SELECT jsonb_typeof(example_vocab) AS t FROM kanji WHERE id = ${row.id}
        `
        if (verify?.t !== 'array') {
          console.error(`  ❌ Row ${row.id} (${row.character}) stored as ${verify?.t}, not array!`)
          failed++
          continue
        }

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

  // ─── Write seed-warnings JSON ──────────────────────────────────────────────

  const seedOutputDir = getSeedOutputDir()
  mkdirSync(seedOutputDir, { recursive: true })

  const outputPath = resolve(seedOutputDir, `seed-warnings-${getDateString()}.json`)
  const warningsOutput = {
    seedRunAt: new Date().toISOString(),
    gitSha: getGitSha(),
    summary: {
      kanjiProcessed: rows.length,
      vocabAccepted: totalAccepted,
      vocabRejected: totalRejected,
      kanjiBelowFloor: belowFloor.length,
      kanjiMissingPitch: totalMissingPitch,
    },
    rejections,
    belowFloor,
  }

  writeFileSync(outputPath, JSON.stringify(warningsOutput, null, 2), 'utf-8')

  // ─── Console summary ───────────────────────────────────────────────────────

  console.log('\n─────────────────────────────────────────')
  console.log('Seed run complete')
  console.log(`  Kanji processed:     ${rows.length}`)
  console.log(`  Kanji updated:       ${updated}`)
  console.log(`  Kanji failed:        ${failed}`)
  console.log(`  Vocab accepted:      ${totalAccepted}`)
  console.log(`  Vocab rejected:      ${totalRejected}  (B4 validator)`)
  console.log(`  Kanji below floor:   ${belowFloor.length}  (< ${FLOOR} accepted entries)`)
  console.log(`  Entries w/o pitch:   ${totalMissingPitch}`)
  console.log(`  Warnings written:    ${outputPath}`)
  console.log('─────────────────────────────────────────')

  await sql.end()

  // ─── Floor gate ────────────────────────────────────────────────────────────

  if (belowFloor.length > 0) {
    if (ALLOW_BELOW_FLOOR) {
      console.warn(`WARNING: ${belowFloor.length} kanji below floor. Continuing because --allow-below-floor was set.`)
    } else {
      console.error(`ERROR: ${belowFloor.length} kanji have fewer than ${FLOOR} accepted vocab entries.`)
      console.error('Re-run with --allow-below-floor to skip this gate during development.')
      process.exit(1)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
