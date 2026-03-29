/**
 * import-kanjidic2.ts
 *
 * One-time enrichment script. Downloads KANJIDIC2 from EDRDG, parses it, and
 * updates every kl_kanji row with JIS code, Nelson indices and Morohashi
 * volume/page/index references.
 *
 * KANJIDIC2 is © James Breen and the Electronic Dictionary Research and
 * Development Group (edrdg.org), distributed under CC BY-SA 4.0.
 * The downloaded XML is NOT committed to the repository.
 *
 * Usage:
 *   pnpm --filter @kanji-learn/db seed:kanjidic2
 */

import 'dotenv/config'
import { XMLParser } from 'fast-xml-parser'
import { createWriteStream, readFileSync, existsSync } from 'fs'
import { pipeline } from 'stream/promises'
import { createGunzip } from 'zlib'
import https from 'https'
import { db } from '../client.js'
import { kanji } from '../schema.js'
import { eq } from 'drizzle-orm'

// ─── Config ───────────────────────────────────────────────────────────────────

const KANJIDIC2_URL = 'https://www.edrdg.org/kanjidic/kanjidic2.xml.gz'
const LOCAL_PATH    = '/tmp/kanjidic2.xml'

// ─── Types ────────────────────────────────────────────────────────────────────

interface KanjiEntry {
  literal:         string
  jisCode:         string | null
  nelsonClassic:   number | null
  nelsonNew:       number | null
  morohashiIndex:  number | null
  morohashiVolume: number | null
  morohashiPage:   number | null
}

// ─── Download ─────────────────────────────────────────────────────────────────

async function download(): Promise<void> {
  if (existsSync(LOCAL_PATH)) {
    console.log(`ℹ  Using cached file at ${LOCAL_PATH}`)
    return
  }
  console.log('⬇  Downloading KANJIDIC2 (~9 MB compressed)…')
  const file = createWriteStream(LOCAL_PATH)
  await new Promise<void>((resolve, reject) => {
    https.get(KANJIDIC2_URL, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching KANJIDIC2`))
        return
      }
      pipeline(res, createGunzip(), file).then(resolve).catch(reject)
    }).on('error', reject)
  })
  console.log('✓  Downloaded and decompressed.')
}

// ─── Parse ────────────────────────────────────────────────────────────────────

function parseKanjidic2(xml: string): Map<string, KanjiEntry> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) =>
      ['cp_value', 'dic_ref', 'reading', 'meaning', 'character'].includes(name),
  })

  const doc = parser.parse(xml)
  const characters: unknown[] = doc?.kanjidic2?.character ?? []
  const map = new Map<string, KanjiEntry>()

  for (const char of characters) {
    const c = char as Record<string, unknown>
    const literal: string = String(c.literal ?? '')
    if (!literal) continue

    // ── JIS X 0208 codepoint ──────────────────────────────────────────────
    const cpValues = ((c.codepoint as Record<string, unknown>)?.cp_value ?? []) as Array<{
      '#text': string | number
      '@_cp_type': string
    }>
    const jisEntry = cpValues.find((v) => v['@_cp_type'] === 'jis208')
    const jisCode  = jisEntry ? String(jisEntry['#text']) : null

    // ── Dictionary references ─────────────────────────────────────────────
    const dicRefs = ((c.dic_number as Record<string, unknown>)?.dic_ref ?? []) as Array<{
      '#text': string | number
      '@_dr_type': string
      '@_m_vol'?: string
      '@_m_page'?: string
    }>

    const nelsonCEntry = dicRefs.find((d) => d['@_dr_type'] === 'nelson_c')
    const nelsonNEntry = dicRefs.find((d) => d['@_dr_type'] === 'nelson_n')
    const moroEntry    = dicRefs.find((d) => d['@_dr_type'] === 'moro')

    // Guard: Number() returns NaN for objects/undefined — map those to null
    const toInt = (v: unknown): number | null => {
      const n = Number(v)
      return isNaN(n) ? null : n
    }

    map.set(literal, {
      literal,
      jisCode,
      nelsonClassic:   nelsonCEntry  ? toInt(nelsonCEntry['#text'])  : null,
      nelsonNew:       nelsonNEntry  ? toInt(nelsonNEntry['#text'])  : null,
      morohashiIndex:  moroEntry     ? toInt(moroEntry['#text'])     : null,
      morohashiVolume: moroEntry?.['@_m_vol']  ? toInt(moroEntry['@_m_vol'])  : null,
      morohashiPage:   moroEntry?.['@_m_page'] ? toInt(moroEntry['@_m_page']) : null,
    })
  }

  console.log(`✓  Parsed ${map.size} entries from KANJIDIC2.`)
  return map
}

// ─── Enrich ───────────────────────────────────────────────────────────────────

async function enrichKanji(entries: Map<string, KanjiEntry>): Promise<void> {
  const allKanji = await db
    .select({ id: kanji.id, character: kanji.character })
    .from(kanji)

  console.log(`\n📝 Enriching ${allKanji.length} kanji rows…`)

  let updated = 0
  let missing = 0

  for (const k of allKanji) {
    const entry = entries.get(k.character)
    if (!entry) {
      missing++
      continue
    }

    await db
      .update(kanji)
      .set({
        jisCode:         entry.jisCode,
        nelsonClassic:   entry.nelsonClassic,
        nelsonNew:       entry.nelsonNew,
        morohashiIndex:  entry.morohashiIndex,
        morohashiVolume: entry.morohashiVolume,
        morohashiPage:   entry.morohashiPage,
      })
      .where(eq(kanji.id, k.id))

    updated++

    if (updated % 100 === 0) {
      process.stdout.write(`\r  ${updated}/${allKanji.length} updated…`)
    }
  }

  console.log(`\n\n✅ Done.`)
  console.log(`   Updated : ${updated}`)
  console.log(`   No entry: ${missing} (kanji not in KANJIDIC2 — expected for rare/non-jouyou)`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  await download()
  const xml = readFileSync(LOCAL_PATH, 'utf-8')
  const entries = parseKanjidic2(xml)
  await enrichKanji(entries)
  process.exit(0)
}

run().catch((err) => {
  console.error('✖ import-kanjidic2 failed:', err)
  process.exit(1)
})
