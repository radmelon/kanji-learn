import { describe, it, expect } from 'vitest'
import { selectVoicePrompt } from '../../src/services/srs.service'

describe('selectVoicePrompt', () => {
  const vocab = [
    { word: '息子', reading: 'むすこ', meaning: 'son' },
    { word: '休息', reading: 'きゅうそく', meaning: 'rest' },
    { word: '息', reading: 'いき', meaning: 'breath' },
  ]

  it('returns {type:"kanji"} when exampleVocab is null', () => {
    expect(selectVoicePrompt(null, 0)).toEqual({ type: 'kanji' })
  })

  it('returns {type:"kanji"} when exampleVocab is an empty array', () => {
    expect(selectVoicePrompt([], 5)).toEqual({ type: 'kanji' })
  })

  it('returns the first entry when reviewCount is 0', () => {
    expect(selectVoicePrompt(vocab, 0)).toEqual({
      type: 'vocab',
      word: '息子',
      reading: 'むすこ',
      meaning: 'son',
    })
  })

  it('round-robins by reviewCount % vocab.length', () => {
    const wordAt = (n: number) => {
      const p = selectVoicePrompt(vocab, n)
      if (p.type !== 'vocab') throw new Error('expected vocab prompt')
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
    const result = selectVoicePrompt(withPitch, 0)
    expect(result).toEqual({
      type: 'vocab',
      word: '感動',
      reading: 'かんどう',
      meaning: 'emotion',
      pitchPattern: [0, 1, 1, 1],
    })
  })

  it('handles single-entry vocab regardless of reviewCount', () => {
    const single = [{ word: '息', reading: 'いき', meaning: 'breath' }]
    const a = selectVoicePrompt(single, 0)
    const b = selectVoicePrompt(single, 99)
    if (a.type !== 'vocab' || b.type !== 'vocab') throw new Error('expected vocab prompts')
    expect(a.word).toBe('息')
    expect(b.word).toBe('息')
  })
})
