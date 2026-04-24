import { describe, it, expect } from 'vitest'
import { selectVoicePrompt } from '../../src/services/srs.service'

describe('selectVoicePrompt', () => {
  const vocab = [
    { word: '息子', reading: 'むすこ', meaning: 'son' },
    { word: '休息', reading: 'きゅうそく', meaning: 'rest' },
    { word: '息', reading: 'いき', meaning: 'breath' },
  ]

  it('returns {type:"kanji"} when exampleVocab is null', () => {
    expect(selectVoicePrompt(null, 0, '息')).toEqual({ type: 'kanji' })
  })

  it('returns {type:"kanji"} when exampleVocab is an empty array', () => {
    expect(selectVoicePrompt([], 5, '息')).toEqual({ type: 'kanji' })
  })

  it('returns the first entry with targetKanji when reviewCount is 0', () => {
    expect(selectVoicePrompt(vocab, 0, '息')).toEqual({
      type: 'vocab',
      word: '息子',
      reading: 'むすこ',
      meaning: 'son',
      targetKanji: '息',
    })
  })

  it('round-robins by reviewCount % vocab.length and preserves targetKanji', () => {
    const wordAt = (n: number) => {
      const p = selectVoicePrompt(vocab, n, '息')
      if (p.type !== 'vocab') throw new Error('expected vocab prompt')
      expect(p.targetKanji).toBe('息')
      return p.word
    }
    expect(wordAt(1)).toBe('休息')
    expect(wordAt(2)).toBe('息')
    expect(wordAt(3)).toBe('息子')
    expect(wordAt(7)).toBe('休息')
  })

  it('preserves pitchPattern when present on the selected entry', () => {
    const withPitch = [
      { word: '感動', reading: 'かんどう', meaning: 'emotion', pitchPattern: [0, 1, 1, 1] },
    ]
    const result = selectVoicePrompt(withPitch, 0, '感')
    expect(result).toEqual({
      type: 'vocab',
      word: '感動',
      reading: 'かんどう',
      meaning: 'emotion',
      pitchPattern: [0, 1, 1, 1],
      targetKanji: '感',
    })
  })

  it('handles single-entry vocab regardless of reviewCount', () => {
    const single = [{ word: '息', reading: 'いき', meaning: 'breath' }]
    const a = selectVoicePrompt(single, 0, '息')
    const b = selectVoicePrompt(single, 99, '息')
    if (a.type !== 'vocab' || b.type !== 'vocab') throw new Error('expected vocab prompts')
    expect(a.word).toBe('息')
    expect(a.targetKanji).toBe('息')
    expect(b.word).toBe('息')
    expect(b.targetKanji).toBe('息')
  })

  it('function param targetKanji overrides any targetKanji present in the vocab entry', () => {
    const withCollision = [
      { word: '息子', reading: 'むすこ', meaning: 'son', targetKanji: 'WRONG' } as any,
    ]
    const result = selectVoicePrompt(withCollision, 0, '息')
    if (result.type !== 'vocab') throw new Error('expected vocab prompt')
    expect(result.targetKanji).toBe('息')
  })

  describe('malformed-reading defense (B130 bug)', () => {
    it('skips entries whose reading contains kanji', () => {
      // Real symptom from B130: Haiku enrichment returned the kanji form as
      // the reading value, e.g. {word:"貸付", reading:"貸付"}. The eval then
      // compared transcripts against the kanji string and rejected every
      // native-speaker attempt.
      const mixed = [
        { word: '貸付', reading: '貸付',   meaning: 'loan' },     // BAD — kanji in reading
        { word: '貸金', reading: 'かしきん', meaning: 'loaned funds' }, // GOOD
      ]
      const result = selectVoicePrompt(mixed, 0, '貸')
      if (result.type !== 'vocab') throw new Error('expected vocab prompt')
      expect(result.reading).toBe('かしきん')
      expect(result.word).toBe('貸金')
    })

    it('skips entries with mixed kanji+kana in reading', () => {
      const mixed = [
        { word: '貸付け', reading: '貸し付け', meaning: 'loan' },  // BAD — has kanji 貸付
        { word: '貸金',   reading: 'かしきん', meaning: 'loaned funds' },
      ]
      const result = selectVoicePrompt(mixed, 0, '貸')
      if (result.type !== 'vocab') throw new Error('expected vocab prompt')
      expect(result.reading).toBe('かしきん')
    })

    it('falls back to {type:"kanji"} when every entry has a kanji reading', () => {
      const allBad = [
        { word: '末端', reading: '末端', meaning: 'extremity' },
        { word: '末日', reading: '末日', meaning: 'last day of month' },
      ]
      expect(selectVoicePrompt(allBad, 0, '末')).toEqual({ type: 'kanji' })
    })

    it('accepts katakana, prolonged-sound mark, and small kana in readings', () => {
      const ok = [
        { word: 'コーヒー', reading: 'コーヒー', meaning: 'coffee' },          // katakana + ー
        { word: '小さい',   reading: 'ちいさい',   meaning: 'small' },          // hiragana
        { word: '一っ子',   reading: 'いっこ',     meaning: 'one (child)' },    // small っ
      ]
      // Round-robin proves all three are kept (none filtered out).
      expect(selectVoicePrompt(ok, 0, 'X').type).toBe('vocab')
      expect(selectVoicePrompt(ok, 1, 'X').type).toBe('vocab')
      expect(selectVoicePrompt(ok, 2, 'X').type).toBe('vocab')
    })

    it('round-robin index is computed against the FILTERED list, not the original', () => {
      const mixed = [
        { word: '貸付', reading: '貸付',   meaning: 'loan' },        // BAD, dropped
        { word: '貸金', reading: 'かしきん', meaning: 'loaned funds' }, // index 0 of filtered
        { word: '貸家', reading: 'かしや',   meaning: 'house for rent' }, // index 1 of filtered
      ]
      const a = selectVoicePrompt(mixed, 0, '貸')
      const b = selectVoicePrompt(mixed, 1, '貸')
      if (a.type !== 'vocab' || b.type !== 'vocab') throw new Error('expected vocab prompts')
      expect(a.word).toBe('貸金')
      expect(b.word).toBe('貸家')
    })
  })
})
