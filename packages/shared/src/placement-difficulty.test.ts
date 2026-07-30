import { describe, it, expect } from 'vitest'
import {
  computeJlptRank, zScore, computeFeatureStats, bPrior, blend,
  bToFsrsDifficulty, seedFromProbability, widenForStaleness,
  DEFAULT_DIFFICULTY_WEIGHTS,
  type KanjiFeatures,
} from './placement-difficulty'

describe('computeJlptRank', () => {
  it('N5 starts at rank 1', () => {
    expect(computeJlptRank('N5', 1)).toBe(1)
  })
  it('N4 continues after all of N5 (79 kanji)', () => {
    expect(computeJlptRank('N4', 1)).toBe(80)
  })
  it('N1 continues after N5+N4+N3+N2 (79+166+370+371=986)', () => {
    expect(computeJlptRank('N1', 1)).toBe(987)
  })
  it('is monotonic within a level', () => {
    expect(computeJlptRank('N3', 10)).toBeGreaterThan(computeJlptRank('N3', 5))
  })
})

describe('zScore', () => {
  it('is 0 at the mean', () => {
    expect(zScore(5, 5, 2)).toBe(0)
  })
  it('is 1 one sd above the mean', () => {
    expect(zScore(7, 5, 2)).toBe(1)
  })
  it('returns 0 when sd is 0 (guards divide-by-zero)', () => {
    expect(zScore(10, 5, 0)).toBe(0)
  })
})

const FEATURES: KanjiFeatures[] = [
  { jlptLevel: 'N5', jlptRank: 1, frequencyRank: 10, grade: 1, strokeCount: 3, componentsCount: 1, readingCount: 2 },
  { jlptLevel: 'N5', jlptRank: 2, frequencyRank: 50, grade: 1, strokeCount: 5, componentsCount: 2, readingCount: 2 },
  { jlptLevel: 'N1', jlptRank: 1000, frequencyRank: 2200, grade: 8, strokeCount: 20, componentsCount: 4, readingCount: 4 },
  { jlptLevel: 'N1', jlptRank: 1001, frequencyRank: null, grade: null, strokeCount: 18, componentsCount: 3, readingCount: 3 },
]

describe('computeFeatureStats + bPrior', () => {
  const stats = computeFeatureStats(FEATURES)

  it('a rarer, later-grade, more-stroke, more-reading kanji scores strictly harder under the fallback weights', () => {
    const easy = bPrior(FEATURES[0], stats, DEFAULT_DIFFICULTY_WEIGHTS)
    const hard = bPrior(FEATURES[2], stats, DEFAULT_DIFFICULTY_WEIGHTS)
    expect(hard).toBeGreaterThan(easy)
  })

  it('null grade/frequencyRank fall back to that kanji\'s level mean, not the global mean', () => {
    // FEATURES[3] has null grade/frequencyRank but is otherwise similar to FEATURES[2] (both N1).
    // Its b should be close to FEATURES[2]'s, not pulled toward the N5 rows' means.
    const withNulls = bPrior(FEATURES[3], stats, DEFAULT_DIFFICULTY_WEIGHTS)
    const n5Mean = bPrior(FEATURES[0], stats, DEFAULT_DIFFICULTY_WEIGHTS)
    const n1Reference = bPrior(FEATURES[2], stats, DEFAULT_DIFFICULTY_WEIGHTS)
    expect(Math.abs(withNulls - n1Reference)).toBeLessThan(Math.abs(withNulls - n5Mean))
  })
})

describe('blend', () => {
  it('n=0 returns exactly the prior', () => {
    expect(blend(1.5, 3.0, 0, 20)).toBe(1.5)
  })
  it('large n approaches the observed value', () => {
    const result = blend(1.5, 3.0, 100_000, 20)
    expect(result).toBeCloseTo(3.0, 2)
  })
  it('at n=k, the blend is the midpoint', () => {
    expect(blend(0, 4, 20, 20)).toBe(2)
  })
})

describe('bToFsrsDifficulty', () => {
  it('maps b=0 to the FSRS midpoint, 5', () => {
    expect(bToFsrsDifficulty(0)).toBe(5)
  })
  it('clamps at the low end', () => {
    expect(bToFsrsDifficulty(-10)).toBe(1)
  })
  it('clamps at the high end', () => {
    expect(bToFsrsDifficulty(10)).toBe(10)
  })
})

describe('seedFromProbability', () => {
  it('returns null below the 0.85 threshold', () => {
    expect(seedFromProbability(0.84, 0)).toBeNull()
  })
  it('returns stability=3 exactly at the threshold', () => {
    expect(seedFromProbability(0.85, 0)?.stabilityDays).toBe(3)
  })
  it('returns stability=21 (the ceiling) at p=1.0', () => {
    expect(seedFromProbability(1.0, 0)?.stabilityDays).toBe(21)
  })
  it('is linear in between', () => {
    const result = seedFromProbability(0.925, 0) // halfway from 0.85 to 1.0
    expect(result?.stabilityDays).toBeCloseTo(12, 1) // halfway from 3 to 21
  })
})

describe('widenForStaleness', () => {
  it('returns the original SE at 0 days elapsed', () => {
    expect(widenForStaleness(1.0, 0)).toBe(1.0)
  })
  it('grows monotonically with days elapsed', () => {
    expect(widenForStaleness(1.0, 365)).toBeGreaterThan(widenForStaleness(1.0, 30))
  })
  it('matches the sqrt(SE^2 + (drift*days)^2) formula exactly', () => {
    const se = 1.0, days = 100, drift = 0.004
    expect(widenForStaleness(se, days, drift)).toBeCloseTo(
      Math.sqrt(se ** 2 + (drift * days) ** 2), 10,
    )
  })
})
