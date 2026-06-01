import { describe, it, expect } from 'vitest'
import { updateEffectiveness, shouldDeepen } from './cadence'
import { EFFECTIVENESS_DEFAULT } from './types'

describe('updateEffectiveness (EMA, alpha=0.4)', () => {
  it('moves a fresh 0.5 score down to 0.30 on a miss', () => {
    expect(updateEffectiveness(EFFECTIVENESS_DEFAULT, 0)).toBeCloseTo(0.30, 5)
  })
  it('moves a fresh 0.5 score up to 0.70 on a hit', () => {
    expect(updateEffectiveness(EFFECTIVENESS_DEFAULT, 1)).toBeCloseTo(0.70, 5)
  })
  it('two misses in a row reach 0.18', () => {
    const afterOne = updateEffectiveness(EFFECTIVENESS_DEFAULT, 0)
    expect(updateEffectiveness(afterOne, 0)).toBeCloseTo(0.18, 5)
  })
})

describe('shouldDeepen (>=2 reinforcements AND score < 0.35)', () => {
  it('is false after a single miss (count 1)', () => {
    expect(shouldDeepen(1, 0.30)).toBe(false)
  })
  it('is true after two misses (count 2, score 0.18)', () => {
    expect(shouldDeepen(2, 0.18)).toBe(true)
  })
  it('is false when the score has recovered above the floor', () => {
    expect(shouldDeepen(3, 0.40)).toBe(false)
  })
  it('is false exactly at the floor (strict <)', () => {
    expect(shouldDeepen(2, 0.35)).toBe(false)
  })
})
