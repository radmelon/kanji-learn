import { describe, it, expect } from 'vitest'
import { allowedGradesAfterHint, isGradeAllowedAfterHint, HINT_REVEAL_DELAY_MS } from './hint-grade'

describe('allowedGradesAfterHint', () => {
  it('caps at Hard once the hint was taken', () => {
    expect(allowedGradesAfterHint(true)).toEqual(['again', 'hard'])
  })

  it('allows every grade when the learner answered unaided', () => {
    expect(allowedGradesAfterHint(false)).toEqual(['again', 'hard', 'good', 'easy'])
  })

  it('always leaves a way to grade', () => {
    // A cap that disabled everything would strand the learner on the card.
    expect(allowedGradesAfterHint(true).length).toBeGreaterThan(0)
  })
})

describe('isGradeAllowedAfterHint', () => {
  it('permits Again and Hard after a hint', () => {
    expect(isGradeAllowedAfterHint('again', true)).toBe(true)
    expect(isGradeAllowedAfterHint('hard', true)).toBe(true)
  })

  it('blocks Good and Easy after a hint', () => {
    // The data-integrity case: hint, then grade Easy, and a card the learner
    // could not actually recall gets pushed out three weeks.
    expect(isGradeAllowedAfterHint('good', true)).toBe(false)
    expect(isGradeAllowedAfterHint('easy', true)).toBe(false)
  })

  it('blocks nothing when no hint was taken', () => {
    for (const g of allowedGradesAfterHint(false)) {
      expect(isGradeAllowedAfterHint(g, false)).toBe(true)
    }
  })
})

describe('HINT_REVEAL_DELAY_MS', () => {
  it('is a named constant so it can be tuned after the walkthrough', () => {
    expect(typeof HINT_REVEAL_DELAY_MS).toBe('number')
    expect(HINT_REVEAL_DELAY_MS).toBeGreaterThan(0)
  })

  it('is long enough to force a real attempt', () => {
    // The delay IS the mechanism — it enforces an unaided attempt without
    // nagging copy. Anything under a couple of seconds is decoration.
    expect(HINT_REVEAL_DELAY_MS).toBeGreaterThanOrEqual(3_000)
  })
})
