import { describe, it, expect } from 'vitest'
import {
  MASTERY_BY_STATUS,
  LEECH_LAPSE_THRESHOLD,
  SCAFFOLD_LEVELS,
  scaffoldForSignals,
  isLeech,
} from '../../../src/services/buddy/constants'

describe('MASTERY_BY_STATUS', () => {
  it('maps every SRS status to a 0–1 mastery value', () => {
    expect(MASTERY_BY_STATUS.unseen).toBe(0)
    expect(MASTERY_BY_STATUS.learning).toBe(0.25)
    expect(MASTERY_BY_STATUS.reviewing).toBe(0.6)
    expect(MASTERY_BY_STATUS.remembered).toBe(0.85)
    expect(MASTERY_BY_STATUS.burned).toBe(1.0)
  })
})

describe('isLeech', () => {
  it('is true when lapseCount ≥ threshold and status is not burned', () => {
    expect(isLeech({ lapseCount: LEECH_LAPSE_THRESHOLD, status: 'reviewing' })).toBe(true)
    expect(isLeech({ lapseCount: LEECH_LAPSE_THRESHOLD + 1, status: 'learning' })).toBe(true)
  })

  it('is false when burned, regardless of lapseCount', () => {
    expect(isLeech({ lapseCount: 10, status: 'burned' })).toBe(false)
  })

  it('is false when under threshold', () => {
    expect(isLeech({ lapseCount: LEECH_LAPSE_THRESHOLD - 1, status: 'reviewing' })).toBe(false)
  })
})

describe('scaffoldForSignals', () => {
  it('returns "heavy" when accuracy is low and consecutive failures are high', () => {
    expect(
      scaffoldForSignals({ recentAccuracy: 0.4, consecutiveFailures: 4, streakDays: 1 })
    ).toBe('heavy')
  })

  it('returns "medium" for mid-range signals', () => {
    expect(
      scaffoldForSignals({ recentAccuracy: 0.7, consecutiveFailures: 1, streakDays: 5 })
    ).toBe('medium')
  })

  it('returns "light" for strong signals', () => {
    expect(
      scaffoldForSignals({ recentAccuracy: 0.92, consecutiveFailures: 0, streakDays: 20 })
    ).toBe('light')
  })

  it('returns one of the known SCAFFOLD_LEVELS', () => {
    const level = scaffoldForSignals({
      recentAccuracy: 0.5,
      consecutiveFailures: 0,
      streakDays: 0,
    })
    expect(SCAFFOLD_LEVELS).toContain(level)
  })
})
