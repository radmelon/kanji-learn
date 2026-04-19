import { describe, it, expect } from 'vitest'
import { containsCJK, expandReadings } from '../../../src/services/kanji-readings-index'

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
  it('returns false for a CJK Compatibility Ideographs character (U+F900)', () => {
    expect(containsCJK('\uF900')).toBe(false)
  })
})

describe('expandReadings', () => {
  const fixture = new Map<string, Set<string>>([
    ['感', new Set(['かん'])],
    ['缶', new Set(['かん'])],
    ['動', new Set(['どう', 'うご'])],
    ['紙', new Set(['かみ', 'し'])],
  ])

  it('expands a single-kanji string to each of its readings', () => {
    expect(expandReadings('感', fixture).sort()).toEqual(['かん'])
  })

  it('leaves pure hiragana strings untouched (returns array with original)', () => {
    expect(expandReadings('かんどう', fixture)).toEqual(['かんどう'])
  })

  it('expands a 2-kanji compound as the cartesian product of readings', () => {
    // 感(かん) × 動(どう|うご) = {かんどう, かんうご}
    const out = expandReadings('感動', fixture).sort()
    expect(out).toEqual(['かんうご', 'かんどう'])
  })

  it('passes through non-CJK characters in mixed input', () => {
    // 紙(かみ|し) + い → {かみい, しい}
    const out = expandReadings('紙い', fixture).sort()
    expect(out).toEqual(['かみい', 'しい'])
  })

  it('returns the original string when a CJK char is not in the index', () => {
    expect(expandReadings('龘', fixture)).toEqual(['龘'])
  })

  it('caps candidate output at MAX_CANDIDATES', () => {
    // Fake index with many readings per char — tests pathological 4-kanji input
    const big = new Map<string, Set<string>>()
    const readings = new Set(['あ', 'い', 'う', 'え', 'お', 'か'])
    for (const ch of '亜伊宇江') big.set(ch, readings)
    const out = expandReadings('亜伊宇江', big)
    expect(out.length).toBeLessThanOrEqual(200)
  })
})
