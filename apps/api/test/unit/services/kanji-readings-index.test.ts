import { describe, it, expect } from 'vitest'
import { containsCJK } from '../../../src/services/kanji-readings-index'

describe('containsCJK', () => {
  it('returns true for a CJK Unified Ideographs character', () => {
    expect(containsCJK('感')).toBe(true)
  })
  it('returns true for a string containing any CJK char', () => {
    expect(containsCJK('かんどう感')).toBe(true)
  })
  it('returns false for pure hiragana', () => {
    expect(containsCJK('かんどう')).toBe(false)
  })
  it('returns false for pure katakana', () => {
    expect(containsCJK('カンドウ')).toBe(false)
  })
  it('returns false for an empty string', () => {
    expect(containsCJK('')).toBe(false)
  })
})
