import { describe, it, expect } from 'vitest'
import {
  computeLearnerState,
  type RawLearnerInputs,
} from '../../../src/services/buddy/learner-state.service'

function baseInputs(overrides: Partial<RawLearnerInputs> = {}): RawLearnerInputs {
  return {
    userId: 'user-1',
    currentStreakDays: 3,
    longestStreakDays: 5,
    totalKanjiSeen: 50,
    totalKanjiBurned: 10,
    reviewsLast7Days: [8, 9, 10, 11, 12, 13, 14], // accelerating
    reviewsPrev7Days: [5, 5, 5, 5, 5, 5, 5],
    recentAccuracy: {
      meaning: 0.85,
      reading: 0.7,
      writing: 0.5, // weakest
      voice: 0.8,
      compound: 0.9,
    },
    activeLeechCount: 2,
    consecutiveFailures: 0,
    lastSessionAt: new Date('2026-04-09T22:00:00Z'),
    ...overrides,
  }
}

describe('computeLearnerState', () => {
  it('picks velocityTrend=accelerating when last week > prev week by 20%+', () => {
    const state = computeLearnerState(baseInputs())
    expect(state.velocityTrend).toBe('accelerating')
  })

  it('picks velocityTrend=decelerating when last week < prev week by 20%+', () => {
    const state = computeLearnerState(
      baseInputs({
        reviewsLast7Days: [2, 2, 2, 2, 2, 2, 2],
        reviewsPrev7Days: [10, 10, 10, 10, 10, 10, 10],
      })
    )
    expect(state.velocityTrend).toBe('decelerating')
  })

  it('picks velocityTrend=steady when within ±20%', () => {
    const state = computeLearnerState(
      baseInputs({
        reviewsLast7Days: [10, 10, 10, 10, 10, 10, 10],
        reviewsPrev7Days: [10, 10, 10, 10, 10, 10, 10],
      })
    )
    expect(state.velocityTrend).toBe('steady')
  })

  it('picks velocityTrend=inactive when last week is zero', () => {
    const state = computeLearnerState(
      baseInputs({
        reviewsLast7Days: [0, 0, 0, 0, 0, 0, 0],
      })
    )
    expect(state.velocityTrend).toBe('inactive')
  })

  it('picks weakestModality as the lowest accuracy', () => {
    const state = computeLearnerState(baseInputs())
    expect(state.weakestModality).toBe('writing')
  })

  it('derives scaffoldLevel from the helper', () => {
    const struggling = computeLearnerState(
      baseInputs({
        recentAccuracy: {
          meaning: 0.4,
          reading: 0.4,
          writing: 0.4,
          voice: 0.4,
          compound: 0.4,
        },
        consecutiveFailures: 4,
      })
    )
    expect(struggling.scaffoldLevel).toBe('heavy')
  })

  it('exposes the active leech count', () => {
    const state = computeLearnerState(baseInputs({ activeLeechCount: 7 }))
    expect(state.activeLeechCount).toBe(7)
  })
})
