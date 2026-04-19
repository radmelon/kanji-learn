import { describe, it, expect } from 'vitest'
import { evaluateReading } from '../../src/services/reading-eval.service'
import type { KanjiReadingsIndex } from '../../src/services/kanji-readings-index'

const fixture: KanjiReadingsIndex = new Map([
  ['感', new Set(['かん', 'かんじる'])],
  ['缶', new Set(['かん'])],
  ['紙', new Set(['かみ', 'し'])],
  ['髪', new Set(['かみ', 'はつ'])],
  ['橋', new Set(['はし', 'きょう'])],
  ['箸', new Set(['はし'])],
  ['動', new Set(['どう', 'うご'])],
])

describe('evaluateReading — homophone workaround', () => {
  it('accepts a kanji transcript when its reading matches a correctReading', () => {
    // User spoke "kan"; iOS returned the kanji 缶. Target is 感's reading かん.
    const result = evaluateReading('缶', ['かん'], false, fixture)
    expect(result.correct).toBe(true)
    expect(result.quality).toBe(5)
  })

  it('accepts a multi-kanji vocab transcript via cartesian expansion', () => {
    // User spoke the vocab 感動; iOS returned 感動. Target is かんどう.
    const result = evaluateReading('感動', ['かんどう'], false, fixture)
    expect(result.correct).toBe(true)
    expect(result.quality).toBe(5)
  })

  it('rejects a kanji transcript with no reading overlap', () => {
    // User somehow produced 髪 transcript for a かん target.
    const result = evaluateReading('髪', ['かん'], false, fixture)
    expect(result.correct).toBe(false)
  })

  it('falls back to plain behavior when the index is not provided', () => {
    // Same as today — kanji transcript is compared as-is, fails.
    const result = evaluateReading('缶', ['かん'])
    expect(result.correct).toBe(false)
  })

  it('still accepts a correct hiragana transcript when the index is provided', () => {
    const result = evaluateReading('かん', ['かん'], false, fixture)
    expect(result.correct).toBe(true)
    expect(result.quality).toBe(5)
  })

  it('handles mixed hiragana+kanji transcripts', () => {
    // Speaker says "kami", iOS returns 紙み (hypothetical mixed transcript)
    const result = evaluateReading('紙み', ['かみみ'], false, fixture)
    expect(result.correct).toBe(true)
  })

  it('accepts a kanji transcript when index stores katakana on-yomi (real DB shape)', () => {
    // Real DB stores on-yomi in katakana; evaluator receives hiragana-normalized
    // correctReadings. Both sides must end up in the same form for comparison.
    const katakanaFixture: KanjiReadingsIndex = new Map([
      ['感', new Set(['カン'])],  // katakana as DB stores it
      ['缶', new Set(['カン'])],
    ])
    const result = evaluateReading('缶', ['カン'], false, katakanaFixture)
    expect(result.correct).toBe(true)
    expect(result.quality).toBe(5)
    expect(result.normalizedSpoken).toBe('かん')
    expect(result.closestCorrect).toBe('かん')
  })
})
