import { describe, it, expect } from 'vitest'
import { parseIds } from './backfill-components'

// IDS format: `U+XXXX\t字\t<ids>`, tab-separated. Lines starting with # are comments.
// IDS strings use Ideographic Description Characters (⿰⿱…, U+2FF0–U+2FFF) which
// are stripped to leave the first-level component characters. A char that
// decomposes only to itself (atomic) maps to [].
const SAMPLE = [
  '#comment',
  'U+6301\t持\t⿰扌寺',
  'U+6797\t林\t⿰木木',
  'U+8A9E\t語\t⿰言吾',
  'U+4E00\t一\t一',                    // atomic → []
  'U+5840\t塀\t⿰土屏[GTV]\t⿰土屏[J]', // variant columns + region tag → take first
  'U+247FF\t𤟿\t⿰&CDP-8BBF;寺',        // entity ref for a no-codepoint component → drop it
  '',
].join('\n')

describe('parseIds', () => {
  it('strips IDCs to first-level components (the teaching-beat split)', () => {
    const map = parseIds(SAMPLE)
    expect(map.get('持')).toEqual(['扌', '寺'])
    expect(map.get('語')).toEqual(['言', '吾'])
  })

  it('keeps repeated components (林 = two trees)', () => {
    expect(parseIds(SAMPLE).get('林')).toEqual(['木', '木'])
  })

  it('maps an atomic kanji to [] (decomposes only to itself)', () => {
    expect(parseIds(SAMPLE).get('一')).toEqual([])
  })

  it('takes the first IDS variant and drops region tags', () => {
    expect(parseIds(SAMPLE).get('塀')).toEqual(['土', '屏'])
  })

  it('skips comment and blank lines', () => {
    expect(parseIds(SAMPLE).has('#comment')).toBe(false)
  })

  it('strips &…; entity references (no-codepoint components) — no garbage chars', () => {
    // ⿰&CDP-8BBF;寺 must yield only [寺], never [C,D,P,-,8,B,B,F,寺].
    expect(parseIds(SAMPLE).get('𤟿')).toEqual(['寺'])
  })
})
