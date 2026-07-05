/**
 * import-kanjidic2.ts
 *
 * One-time enrichment script. Downloads KANJIDIC2 from EDRDG, parses it, and
 * updates every kanji row with JIS code, Nelson/Morohashi references, grade,
 * frequency rank, Hadamitzky-Spahn index, and the COMPLETE on/kun reading
 * lists.
 *
 * KANJIDIC2 is authoritative for readings: ja_on are katakana, ja_kun are
 * hiragana (a deliberate lexicographic convention, not a bug). Earlier seeds
 * (seed-kanji-fetch.ts) truncated each reading array to 5 entries, dropping
 * common readings — this importer overwrites them with the full lists.
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
import { eq, sql, type SQL } from 'drizzle-orm'

// ─── Config ───────────────────────────────────────────────────────────────────

const KANJIDIC2_URL = 'https://www.edrdg.org/kanjidic/kanjidic2.xml.gz'
const LOCAL_PATH    = '/tmp/kanjidic2.xml'

// ─── Types ────────────────────────────────────────────────────────────────────

interface KanjiEntry {
  literal:          string
  jisCode:          string | null
  nelsonClassic:    number | null
  nelsonNew:        number | null
  morohashiIndex:   number | null
  morohashiVolume:  number | null
  morohashiPage:    number | null
  grade:            number | null  // <grade>: 1-6 elementary, 8 other Jouyou, 9-10 Jinmeiyou
  frequencyRank:    number | null  // <freq>: Mainichi Shimbun rank, 1 = most common
  hadamitzkySpahn:  number | null  // <dic_ref dr_type="sh_kk2"> with sh_kk fallback
  onReadings:       string[]       // <reading r_type="ja_on">  — katakana
  kunReadings:      string[]       // <reading r_type="ja_kun"> — hiragana
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
      ['cp_value', 'dic_ref', 'reading', 'meaning', 'character',
       'reading_meaning', 'rmgroup'].includes(name),
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

    // Hadamitzky-Spahn: prefer sh_kk2 (2nd ed), fall back to sh_kk (1st ed)
    const shKk2Entry     = dicRefs.find((d) => d['@_dr_type'] === 'sh_kk2')
    const shKkEntry      = dicRefs.find((d) => d['@_dr_type'] === 'sh_kk')
    const hadamitzkyEntry = shKk2Entry ?? shKkEntry

    // Guard: Number() returns NaN for objects/undefined — map those to null
    const toInt = (v: unknown): number | null => {
      const n = Number(v)
      return isNaN(n) ? null : n
    }

    // ── Misc fields (grade, freq) ─────────────────────────────────────────
    const misc = c.misc as Record<string, unknown> | undefined
    const grade       = misc?.grade != null ? toInt(misc.grade) : null
    const frequencyRank = misc?.freq != null ? toInt(misc.freq) : null

    // ── Readings (ja_on katakana / ja_kun hiragana) ───────────────────────
    // KanjiDic2 lists readings primary-first; preserve that document order
    // (do NOT sort). <nanori> name readings are a separate element and are
    // intentionally excluded. A few kanji split readings across multiple
    // rmgroups, so collect from all and dedupe (first occurrence wins).
    const onReadings: string[] = []
    const kunReadings: string[] = []
    const readingMeaning = (c.reading_meaning ?? []) as Array<Record<string, unknown>>
    for (const rm of readingMeaning) {
      const rmgroups = (rm.rmgroup ?? []) as Array<Record<string, unknown>>
      for (const g of rmgroups) {
        const readings = (g.reading ?? []) as Array<{
          '#text': string | number
          '@_r_type': string
        }>
        for (const r of readings) {
          const text = String(r['#text'] ?? '').trim()
          if (!text) continue
          if (r['@_r_type'] === 'ja_on') {
            if (!onReadings.includes(text)) onReadings.push(text)
          } else if (r['@_r_type'] === 'ja_kun') {
            if (!kunReadings.includes(text)) kunReadings.push(text)
          }
        }
      }
    }

    map.set(literal, {
      literal,
      jisCode,
      nelsonClassic:   nelsonCEntry    ? toInt(nelsonCEntry['#text'])    : null,
      nelsonNew:       nelsonNEntry    ? toInt(nelsonNEntry['#text'])    : null,
      morohashiIndex:  moroEntry       ? toInt(moroEntry['#text'])       : null,
      morohashiVolume: moroEntry?.['@_m_vol']  ? toInt(moroEntry['@_m_vol'])  : null,
      morohashiPage:   moroEntry?.['@_m_page'] ? toInt(moroEntry['@_m_page']) : null,
      grade,
      frequencyRank,
      hadamitzkySpahn: hadamitzkyEntry ? toInt(hadamitzkyEntry['#text']) : null,
      onReadings,
      kunReadings,
    })
  }

  let withGrade = 0, withFreq = 0, withHadamitzky = 0, withReadings = 0
  for (const entry of map.values()) {
    if (entry.grade != null) withGrade++
    if (entry.frequencyRank != null) withFreq++
    if (entry.hadamitzkySpahn != null) withHadamitzky++
    if (entry.onReadings.length > 0 || entry.kunReadings.length > 0) withReadings++
  }
  console.log(`✓  Parsed ${map.size} entries (grade: ${withGrade}, freq: ${withFreq}, sh_kk: ${withHadamitzky}, readings: ${withReadings}).`)
  return map
}

// ─── Enrich ───────────────────────────────────────────────────────────────────

/**
 * Build a jsonb array from a string list, constructed server-side.
 *
 * A raw array, or a JSON string + `::jsonb` cast, both double-encode through
 * the Drizzle/postgres-js layer and land as a quoted jsonb *string* scalar
 * (still readable via Drizzle's jsonb mapper, but breaks jsonb_array_length,
 * containment, etc.). jsonb_build_array builds a genuine array from text
 * params — each element is cast to text so Postgres can resolve its type.
 */
function jsonbArray(values: string[]): SQL {
  return sql`jsonb_build_array(${sql.join(values.map((v) => sql`${v}::text`), sql`, `)})`
}

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
        jisCode:          entry.jisCode,
        nelsonClassic:    entry.nelsonClassic,
        nelsonNew:        entry.nelsonNew,
        morohashiIndex:   entry.morohashiIndex,
        morohashiVolume:  entry.morohashiVolume,
        morohashiPage:    entry.morohashiPage,
        grade:            entry.grade,
        frequencyRank:    entry.frequencyRank,
        hadamitzkySpahn:  entry.hadamitzkySpahn,
        onReadings:       jsonbArray(entry.onReadings),
        kunReadings:      jsonbArray(entry.kunReadings),
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
