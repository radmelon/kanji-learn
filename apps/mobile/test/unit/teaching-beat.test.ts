import { teachingBeat } from '../../src/lib/teaching-beat'

/**
 * B-217 — the teaching beat printed the literal placeholder "this part".
 *
 * The radical dictionary holds 20 entries; measured against live data, 2,166
 * of 2,187 kanji with components (99%) have at least one component outside it.
 * So the placeholder was the default rendering, not an edge case, and it read
 * as a broken template to the learner who reported it.
 */

const kanji = (character: string, components: string[]) =>
  ({ character, components }) as never

describe('teachingBeat', () => {
  it('falls back to the glyph, not "this part", for unmapped components', () => {
    // 説 = 言 (in the dictionary) + 兑 (not in it). The reported case.
    const beat = teachingBeat(kanji('説', ['言', '兑']))
    expect(beat).not.toContain('this part')
    expect(beat).toBe('説 is 言 (speech) beside 兑.')
  })

  it('still names components the dictionary knows', () => {
    expect(teachingBeat(kanji('持', ['扌', '寺']))).toBe('持 is 扌 (hand) beside 寺 (temple).')
  })

  it('reads correctly when nothing is mapped', () => {
    // Worst case pre-fix: "X is this part beside this part." Now both glyphs.
    const beat = teachingBeat(kanji('兜', ['白', '儿']))
    expect(beat).not.toContain('this part')
    expect(beat).toBe('兜 is 白 beside 儿.')
  })

  it('handles a single component without the "beside" clause', () => {
    expect(teachingBeat(kanji('明', ['日']))).toBe('明 is 日 (sun).')
  })

  it('returns nothing when there are no components to teach', () => {
    expect(teachingBeat(kanji('一', []))).toBe('')
  })
})
