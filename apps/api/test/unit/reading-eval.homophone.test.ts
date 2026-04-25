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

  it('accepts sokuon assimilation in a compound (まつ + たん → まったん)', () => {
    // Real B130 case. iOS speech recognizer transcribes "mattan" as the kanji
    // 末端. Per-character expansion gives "まつたん" (no sokuon) — the index
    // can't produce the assimilated form. 1-edit-distance acceptance closes
    // the gap.
    const idx: KanjiReadingsIndex = new Map([
      ['末', new Set(['まつ', 'すえ', 'ばつ'])],
      ['端', new Set(['たん', 'はし'])],
    ])
    const result = evaluateReading('末端', ['まったん'], false, idx)
    expect(result.correct).toBe(true)
    expect(result.quality).toBe(3)
    expect(result.feedback).toMatch(/check your vowel length or small kana/)
  })

  it('accepts an okurigana transcript via near-match expansion (貸し付け → かしつけ)', () => {
    // iOS recognizer returns the verbal stem with okurigana 貸し付け. Per-char
    // expansion produces "かししつけ" (extra し from the literal okurigana char).
    // Levenshtein 1 vs target "かしつけ" → accept.
    const idx: KanjiReadingsIndex = new Map([
      ['貸', new Set(['かし', 'たい'])],
      ['付', new Set(['つ', 'ふ'])],
    ])
    const result = evaluateReading('貸し付け', ['かしつけ'], false, idx)
    expect(result.correct).toBe(true)
    expect(result.quality).toBe(3)
  })

  it('strict mode REJECTS the near-match expansion path', () => {
    // Level checkpoints set strict=true. The near-match acceptance must NOT
    // fire there — only exact expansion matches.
    const idx: KanjiReadingsIndex = new Map([
      ['末', new Set(['まつ'])],
      ['端', new Set(['たん'])],
    ])
    const result = evaluateReading('末端', ['まったん'], true /* strict */, idx)
    expect(result.correct).toBe(false)
  })

  it('still rejects when no expanded candidate is within 1 edit', () => {
    const idx: KanjiReadingsIndex = new Map([
      ['髪', new Set(['かみ', 'はつ'])],
    ])
    const result = evaluateReading('髪', ['たんすい'], false, idx)
    expect(result.correct).toBe(false)
  })

  it('accepts a digit-prefixed transcript by mapping digits → kanji (7じ → しちじ)', () => {
    // iOS recognizer renders "shichi-ji" as "7じ" (digit + hiragana). Without
    // digit substitution, containsCJK is false and the expansion path skips,
    // leaving Levenshtein on "7じ" vs "しちじ" — dist 2, rejected. Substituting
    // 7→七 lets expansion produce {しちじ, ななじ}, exact match wins.
    const idx: KanjiReadingsIndex = new Map([
      ['七', new Set(['しち', 'なな'])],
      ['時', new Set(['とき', 'ジ'])],
    ])
    const result = evaluateReading('7じ', ['しちじ'], false, idx)
    expect(result.correct).toBe(true)
    expect(result.quality).toBe(5)
  })

  it('accepts digit + full kanji transcript (7時 → しちじ)', () => {
    const idx: KanjiReadingsIndex = new Map([
      ['七', new Set(['しち', 'なな'])],
      ['時', new Set(['とき', 'ジ'])],
    ])
    const result = evaluateReading('7時', ['しちじ'], false, idx)
    expect(result.correct).toBe(true)
  })

  it('accepts a kun reading reduced to its STEM by the index loader (優れる)', () => {
    // kanjidic stores kun readings as "<stem>.<okurigana>" (e.g. "すぐ.れる").
    // The index loader keeps only the stem so concatenation with literal
    // okurigana from the transcript reconstructs the full form.
    // Transcript "優れる" → expand 優+れ+る. With stem "すぐ" in the index,
    // the candidate is "すぐ"+"れ"+"る" = "すぐれる" — exact match.
    const idx: KanjiReadingsIndex = new Map([
      ['優', new Set(['すぐ', 'やさ', 'ゆう'])],  // stems only after strip
    ])
    const result = evaluateReading('優れる', ['すぐれる'], false, idx)
    expect(result.correct).toBe(true)
  })

  it('still matches a single-kanji transcript against its stem in correctReadings', () => {
    // Legacy kanji-level prompts: mobile already strips okurigana from kun
    // readings before sending as correctReadings. e.g. for 優 the
    // correctReadings include 'すぐ', 'やさ', 'ゆう'. With stems in the index,
    // a transcript of just "優" expands to those same stems → exact match.
    const idx: KanjiReadingsIndex = new Map([
      ['優', new Set(['すぐ', 'やさ', 'ゆう'])],
    ])
    const result = evaluateReading('優', ['すぐ', 'やさ', 'ゆう'], false, idx)
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
