import { describe, it, expect } from 'vitest'
import { nextRequirement, mergeExtracted, type CollectedState } from './meeting'

const full: CollectedState = {
  reasons: ['JLPT exam'], interests: ['cooking'], explicitRuler: null,
  dailyGoal: 15, buddyDay: 0, buddyIntervalWeeks: 1,
  timezone: 'America/Los_Angeles', hadPriorData: false,
}

describe('nextRequirement — the completeness check (spec §4)', () => {
  it('returns null only when everything required is present', () => {
    expect(nextRequirement(full)).toBeNull()
  })
  it('walks the requirements in order', () => {
    expect(nextRequirement({ ...full, reasons: [] })).toBe('reasons')
    expect(nextRequirement({ ...full, interests: [] })).toBe('interests')
    expect(nextRequirement({ ...full, dailyGoal: null })).toBe('daily_goal')
    expect(nextRequirement({ ...full, buddyDay: null })).toBe('buddy_day')
  })
  it('requires the frame when reasons resolve to ask (both groups present)', () => {
    expect(nextRequirement({ ...full, reasons: ['JLPT exam', 'Heritage'] })).toBe('frame')
  })
  it('an explicit ruler answer satisfies the frame requirement', () => {
    expect(nextRequirement({ ...full, reasons: ['JLPT exam', 'Heritage'], explicitRuler: 'jlpt' }))
      .toBeNull()
  })
  it('does NOT require timezone — the deviceTimezone() sync owns it (spec §4)', () => {
    expect(nextRequirement({ ...full, timezone: null })).toBeNull()
  })
})

describe('mergeExtracted', () => {
  it('unions arrays case-insensitively and never drops what was already collected', () => {
    const out = mergeExtracted(full, { reasons: ['jlpt EXAM', 'Travel'], interests: [] })
    expect(out.reasons).toEqual(['JLPT exam', 'Travel'])
    expect(out.interests).toEqual(['cooking'])
  })
  it('caps arrays at 12', () => {
    const out = mergeExtracted(full, { interests: Array.from({ length: 20 }, (_, i) => `i${i}`) })
    expect(out.interests).toHaveLength(12)
  })
  it('scalar fields: the patch wins when present, otherwise state is kept', () => {
    const out = mergeExtracted(full, { dailyGoal: 20, explicitRuler: 'grade' })
    expect(out.dailyGoal).toBe(20)
    expect(out.explicitRuler).toBe('grade')
    expect(out.buddyDay).toBe(0)
  })
})
