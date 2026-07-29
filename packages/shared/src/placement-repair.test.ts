import { describe, it, expect } from 'vitest'
import { isPlacementDamageSignature } from './placement-repair'

describe('isPlacementDamageSignature', () => {
  it('matches the exact bug signature', () => {
    expect(
      isPlacementDamageSignature({
        status: 'remembered',
        stability: 21,
        difficulty: 5,
        totalReviews: 1,
      })
    ).toBe(true)
  })

  it('rejects a genuine single-review card (different stability/difficulty)', () => {
    expect(
      isPlacementDamageSignature({
        status: 'learning',
        stability: 0.4,
        difficulty: 7.19,
        totalReviews: 1,
      })
    ).toBe(false)
  })

  it('rejects totalReviews other than 1', () => {
    expect(
      isPlacementDamageSignature({
        status: 'remembered',
        stability: 21,
        difficulty: 5,
        totalReviews: 2,
      })
    ).toBe(false)
  })

  it('rejects a near-miss on stability (floating point must not fuzzy-match)', () => {
    expect(
      isPlacementDamageSignature({
        status: 'remembered',
        stability: 21.4,
        difficulty: 5,
        totalReviews: 1,
      })
    ).toBe(false)
  })

  it('rejects status other than remembered', () => {
    expect(
      isPlacementDamageSignature({
        status: 'reviewing',
        stability: 21,
        difficulty: 5,
        totalReviews: 1,
      })
    ).toBe(false)
  })
})
