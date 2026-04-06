/**
 * backfill-radicals.ts
 *
 * Fills in missing `radicals` data for kanji whose array is empty.
 * Uses the KANJIDIC2 classical radical number (1–214) to derive the
 * lookup radical character, then writes it back to the DB.
 *
 * The KANJIDIC2 file is downloaded if not already cached at /tmp/kanjidic2.xml.
 *
 * Usage:
 *   pnpm --filter @kanji-learn/db seed:backfill-radicals
 */

import 'dotenv/config'
import { XMLParser } from 'fast-xml-parser'
import { createWriteStream, readFileSync, existsSync } from 'fs'
import { pipeline } from 'stream/promises'
import { createGunzip } from 'zlib'
import https from 'https'
import { db } from '../client.js'
import { kanji } from '../schema.js'
import { eq, sql } from 'drizzle-orm'

// ─── Config ───────────────────────────────────────────────────────────────────

const KANJIDIC2_URL = 'https://www.edrdg.org/kanjidic/kanjidic2.xml.gz'
const LOCAL_PATH    = '/tmp/kanjidic2.xml'

// ─── 214 Kangxi radicals (1-indexed) ─────────────────────────────────────────
// Source: Unicode Kangxi Radicals block + CJK Radicals Supplement

const KANGXI_RADICALS: string[] = [
  '',    // 0 — placeholder (radicals are 1-indexed)
  '一',  // 1
  '丨',  // 2
  '丶',  // 3
  '丿',  // 4
  '乙',  // 5
  '亅',  // 6
  '二',  // 7
  '亠',  // 8
  '人',  // 9
  '儿',  // 10
  '入',  // 11
  '八',  // 12
  '冂',  // 13
  '冖',  // 14
  '冫',  // 15
  '几',  // 16
  '凵',  // 17
  '刀',  // 18
  '力',  // 19
  '勺',  // 20
  '匕',  // 21
  '匚',  // 22
  '匸',  // 23
  '十',  // 24
  '卜',  // 25
  '卩',  // 26
  '厂',  // 27
  '厶',  // 28
  '又',  // 29
  '口',  // 30
  '囗',  // 31
  '土',  // 32
  '士',  // 33
  '夂',  // 34
  '夊',  // 35
  '夕',  // 36
  '大',  // 37
  '女',  // 38
  '子',  // 39
  '宀',  // 40
  '寸',  // 41
  '小',  // 42
  '尢',  // 43
  '尸',  // 44
  '屮',  // 45
  '山',  // 46
  '巛',  // 47
  '工',  // 48
  '己',  // 49
  '巾',  // 50
  '干',  // 51
  '幺',  // 52
  '广',  // 53
  '廴',  // 54
  '廾',  // 55
  '弋',  // 56
  '弓',  // 57
  '彐',  // 58
  '彡',  // 59
  '彳',  // 60
  '心',  // 61
  '戈',  // 62
  '戸',  // 63
  '手',  // 64
  '支',  // 65
  '攴',  // 66
  '文',  // 67
  '斗',  // 68
  '斤',  // 69
  '方',  // 70
  '无',  // 71
  '日',  // 72
  '曰',  // 73
  '月',  // 74
  '木',  // 75
  '欠',  // 76
  '止',  // 77
  '歹',  // 78
  '殳',  // 79
  '毋',  // 80
  '比',  // 81
  '毛',  // 82
  '氏',  // 83
  '气',  // 84
  '水',  // 85
  '火',  // 86
  '爪',  // 87
  '父',  // 88
  '爻',  // 89
  '爿',  // 90
  '片',  // 91
  '牙',  // 92
  '牛',  // 93
  '犬',  // 94
  '玄',  // 95
  '玉',  // 96
  '瓜',  // 97
  '瓦',  // 98
  '甘',  // 99
  '生',  // 100
  '用',  // 101
  '田',  // 102
  '疋',  // 103
  '疒',  // 104
  '癶',  // 105
  '白',  // 106
  '皮',  // 107
  '皿',  // 108
  '目',  // 109
  '矛',  // 110
  '矢',  // 111
  '石',  // 112
  '示',  // 113
  '禸',  // 114
  '禾',  // 115
  '穴',  // 116
  '立',  // 117
  '竹',  // 118
  '米',  // 119
  '糸',  // 120
  '缶',  // 121
  '网',  // 122
  '羊',  // 123
  '羽',  // 124
  '老',  // 125
  '而',  // 126
  '耒',  // 127
  '耳',  // 128
  '聿',  // 129
  '肉',  // 130
  '臣',  // 131
  '自',  // 132
  '至',  // 133
  '臼',  // 134
  '舌',  // 135
  '舛',  // 136
  '舟',  // 137
  '艮',  // 138
  '色',  // 139
  '艸',  // 140
  '虍',  // 141
  '虫',  // 142
  '血',  // 143
  '行',  // 144
  '衣',  // 145
  '覀',  // 146
  '見',  // 147
  '角',  // 148
  '言',  // 149
  '谷',  // 150
  '豆',  // 151
  '豕',  // 152
  '豸',  // 153
  '貝',  // 154
  '赤',  // 155
  '走',  // 156
  '足',  // 157
  '身',  // 158
  '車',  // 159
  '辛',  // 160
  '辰',  // 161
  '辵',  // 162
  '邑',  // 163
  '酉',  // 164
  '釆',  // 165
  '里',  // 166
  '金',  // 167
  '長',  // 168
  '門',  // 169
  '阜',  // 170
  '隶',  // 171
  '隹',  // 172
  '雨',  // 173
  '青',  // 174
  '非',  // 175
  '面',  // 176
  '革',  // 177
  '韋',  // 178
  '韭',  // 179
  '音',  // 180
  '頁',  // 181
  '風',  // 182
  '飛',  // 183
  '食',  // 184
  '首',  // 185
  '香',  // 186
  '馬',  // 187
  '骨',  // 188
  '髟',  // 189
  '鬥',  // 190
  '鬯',  // 191
  '鬲',  // 192
  '鬼',  // 193
  '魚',  // 194
  '鳥',  // 195
  '鹵',  // 196
  '鹿',  // 197
  '麥',  // 198
  '麻',  // 199
  '黃',  // 200
  '黍',  // 201
  '黒',  // 202
  '黹',  // 203
  '黽',  // 204
  '鼎',  // 205
  '鼓',  // 206
  '鼠',  // 207
  '鼻',  // 208
  '齊',  // 209
  '齒',  // 210
  '龍',  // 211
  '龜',  // 212
  '龠',  // 213
]

// ─── Download ─────────────────────────────────────────────────────────────────

async function download(): Promise<void> {
  if (existsSync(LOCAL_PATH)) {
    console.log(`ℹ  Using cached KANJIDIC2 at ${LOCAL_PATH}`)
    return
  }
  console.log('⬇  Downloading KANJIDIC2 (~9 MB compressed)…')
  const file = createWriteStream(LOCAL_PATH)
  await new Promise<void>((resolve, reject) => {
    https.get(KANJIDIC2_URL, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      pipeline(res, createGunzip(), file).then(resolve).catch(reject)
    }).on('error', reject)
  })
  console.log('✓  Downloaded and decompressed.')
}

// ─── Parse KANJIDIC2 → Map<char, classicalRadicalChar> ───────────────────────

function parseRadicals(xml: string): Map<string, string> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    // radical is a single element; rad_value may appear multiple times; character is always an array
    isArray: (name) => ['rad_value', 'character', 'cp_value', 'dic_ref', 'reading', 'meaning'].includes(name),
  })

  const doc  = parser.parse(xml)
  const chars: unknown[] = doc?.kanjidic2?.character ?? []
  const map  = new Map<string, string>()

  for (const entry of chars) {
    const c = entry as Record<string, unknown>
    const literal = String(c.literal ?? '')
    if (!literal) continue

    // `radical` is a single object with a `rad_value` array
    const radBlock = c.radical as Record<string, unknown> | undefined
    if (!radBlock) continue

    // rad_value can be a single object or an array; normalise to array
    const rawRV = radBlock.rad_value
    const radValues = (Array.isArray(rawRV) ? rawRV : rawRV ? [rawRV] : []) as Array<{
      '#text'?: string | number
      '@_rad_type'?: string
    }>

    // Prefer classical Kangxi radical; fall back to nelson_c
    const classical = radValues.find((v) => v['@_rad_type'] === 'classical')
    const nelson    = radValues.find((v) => v['@_rad_type'] === 'nelson_c')
    const chosen    = classical ?? nelson
    if (!chosen) continue

    const num = Number(chosen['#text'])
    if (isNaN(num) || num < 1 || num > 213) continue

    const radChar = KANGXI_RADICALS[num]
    if (radChar) map.set(literal, radChar)
  }

  console.log(`✓  Parsed radical data for ${map.size} kanji.`)
  return map
}

// ─── Backfill ─────────────────────────────────────────────────────────────────

async function backfill(radMap: Map<string, string>): Promise<void> {
  // Only update kanji with empty radicals array
  const rows = await db
    .select({ id: kanji.id, character: kanji.character })
    .from(kanji)
    .where(sql`${kanji.radicals} = '[]'::jsonb`)

  console.log(`\n📝 Found ${rows.length} kanji with empty radicals — backfilling…`)

  let updated = 0
  let missing = 0

  for (const row of rows) {
    const radChar = radMap.get(row.character)
    if (!radChar) {
      missing++
      continue
    }

    await db
      .update(kanji)
      .set({ radicals: JSON.stringify([radChar]) as unknown as string[] })
      .where(eq(kanji.id, row.id))

    updated++

    if (updated % 50 === 0) {
      process.stdout.write(`\r  ${updated}/${rows.length} updated…`)
    }
  }

  console.log(`\n\n✅ Done.`)
  console.log(`   Updated : ${updated}`)
  console.log(`   No entry: ${missing}`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  await download()
  const xml = readFileSync(LOCAL_PATH, 'utf-8')
  const radMap = parseRadicals(xml)
  await backfill(radMap)
  process.exit(0)
}

run().catch((err) => {
  console.error('✖ backfill-radicals failed:', err)
  process.exit(1)
})
