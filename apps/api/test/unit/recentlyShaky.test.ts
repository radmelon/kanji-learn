import { describe, it, expect } from 'vitest'
import { isRecentlyShaky } from '../../src/services/srs.service'

describe('isRecentlyShaky', () => {
  it('flags a kanji with an Again grade in its last 3 reviews', () => {
    expect(isRecentlyShaky([4, 1, 5])).toBe(true)
  })
  it('flags a kanji with a Hard grade in its last 3 reviews', () => {
    expect(isRecentlyShaky([3, 4, 5])).toBe(true)
  })
  it('does not flag a kanji with only Good/Easy in its last 3 reviews', () => {
    expect(isRecentlyShaky([4, 5, 4])).toBe(false)
  })
  it('ignores a Hard grade older than the 3-review window', () => {
    expect(isRecentlyShaky([4, 5, 4, 3])).toBe(false)
  })
  it('returns false for a kanji with no review history', () => {
    expect(isRecentlyShaky([])).toBe(false)
  })
  it('treats legacy quality 0 and 2 as shaky', () => {
    expect(isRecentlyShaky([0])).toBe(true)
    expect(isRecentlyShaky([2])).toBe(true)
  })
})
