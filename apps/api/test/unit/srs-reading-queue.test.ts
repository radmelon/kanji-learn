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
})
