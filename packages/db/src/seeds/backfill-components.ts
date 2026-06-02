/**
 * backfill-components.ts
 *
 * Fills `kanji.components` with the FIRST-LEVEL structural decomposition
 * (e.g. 持 → [扌, 寺]) from IDS (cjkvi-ids). Distinct from `kanji.radicals`
 * (single classifying Kangxi radical). IDS is UTF-8 — no encoding step.
 *
 * Source: https://github.com/cjkvi/cjkvi-ids (CHISE/free-licensed).
 *
 * Usage:
 *   pnpm --filter @kanji-learn/db seed:backfill-components
 */

import 'dotenv/config'
import { createWriteStream, readFileSync, existsSync } from 'fs'
import https from 'https'
import { fileURLToPath } from 'node:url'

const IDS_URL = 'https://raw.githubusercontent.com/cjkvi/cjkvi-ids/master/ids.txt'
const LOCAL_PATH = '/tmp/cjkvi-ids.txt'

// ─── Pure parser (unit-tested) ────────────────────────────────────────────────

/**
 * Parse cjkvi-ids `ids.txt` → Map<kanji, first-level components[]>.
 * Each line: `U+XXXX<TAB>字<TAB><IDS>[<TAB>variant IDS…]`. We take the first
 * IDS column, drop any `[region]` tag, strip Ideographic Description Characters
 * (U+2FF0–U+2FFF) and entity markers, and keep the remaining component chars.
 * A char that decomposes only to itself (atomic) maps to [].
 */
export function parseIds(text: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const cols = line.split('\t')
    if (cols.length < 3) continue
    const char = cols[1]
    if (!char || [...char].length !== 1) continue
    // Strip region tags ([GTJ…]) AND whole entity references (&CDP-8BBF; / &U-XXXX;)
    // for components lacking a Unicode codepoint — otherwise the entity body
    // (C, D, P, -, 8…) would leak through as spurious single-char components.
    const ids = cols[2].replace(/\[[^\]]*\]/g, '').replace(/&[^;]*;/g, '').trim()
    const components = [...ids].filter((ch) => {
      const cp = ch.codePointAt(0)!
      if (cp >= 0x2ff0 && cp <= 0x2fff) return false // IDCs ⿰⿱⿲…
      if (ch === '〾' || ch === '？' || ch === '?' || ch === '&' || ch === ';') return false
      return true
    })
    if (components.length === 0) continue
    if (components.length === 1 && components[0] === char) { map.set(char, []); continue }
    map.set(char, components)
  }
  return map
}

// ─── Download (UTF-8, no decode) ───────────────────────────────────────────────

async function download(): Promise<string> {
  if (existsSync(LOCAL_PATH)) {
    console.log(`ℹ  Using cached IDS at ${LOCAL_PATH}`)
    return readFileSync(LOCAL_PATH, 'utf-8')
  }
  console.log('⬇  Downloading cjkvi-ids ids.txt…')
  const text: string = await new Promise((resolve, reject) => {
    https
      .get(IDS_URL, (res) => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
        let buf = ''
        res.setEncoding('utf-8')
        res.on('data', (c) => (buf += c))
        res.on('end', () => resolve(buf))
      })
      .on('error', reject)
  })
  createWriteStream(LOCAL_PATH).end(text)
  console.log('✓  Downloaded.')
  return text
}

// ─── Backfill (DB imports are lazy so the parser stays test-importable) ────────

async function backfill(map: Map<string, string[]>): Promise<void> {
  const { db } = await import('../client.js')
  const { kanji } = await import('../schema.js')
  const { eq } = await import('drizzle-orm')

  const rows = await db.select({ id: kanji.id, character: kanji.character }).from(kanji)
  console.log(`\n📝 ${rows.length} kanji in DB — backfilling components…`)

  let updated = 0
  let missing = 0
  for (const row of rows) {
    const components = map.get(row.character)
    if (!components) { missing++; continue }
    await db
      .update(kanji)
      .set({ components: JSON.stringify(components) as unknown as string[] })
      .where(eq(kanji.id, row.id))
    updated++
    if (updated % 100 === 0) process.stdout.write(`\r  ${updated}/${rows.length}…`)
  }

  console.log(`\n\n✅ Done.  Updated: ${updated}   No IDS entry: ${missing}`)
  const [mochi] = await db.select().from(kanji).where(eq(kanji.character, '持'))
  console.log(`   Spot-check 持 components: ${JSON.stringify(mochi?.components)}`)
}

async function run(): Promise<void> {
  const text = await download()
  const map = parseIds(text)
  console.log(`✓  Parsed ${map.size} IDS entries.`)
  await backfill(map)
  process.exit(0)
}

// Only run as a CLI, never on test import.
const isCli = process.argv[1] === fileURLToPath(import.meta.url)
if (isCli) {
  run().catch((err) => {
    console.error('✖ backfill-components failed:', err)
    process.exit(1)
  })
}
