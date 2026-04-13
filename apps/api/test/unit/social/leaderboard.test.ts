import { describe, it, expect } from 'vitest'
import { computeDailyAverage } from '../../../src/services/social.service.js'

describe('computeDailyAverage', () => {
  it('returns 0 for empty stats', () => {
    expect(computeDailyAverage([])).toBe(0)
  })

  it('returns the single day value for one active day', () => {
    expect(computeDailyAverage([{ date: '2026-04-11', reviewed: 25 }])).toBe(25)
  })

  it('averages across multiple active days', () => {
    const stats = [
      { date: '2026-04-11', reviewed: 30 },
      { date: '2026-04-10', reviewed: 20 },
      { date: '2026-04-09', reviewed: 10 },
    ]
    expect(computeDailyAverage(stats)).toBe(20)
  })

  it('ignores days with zero reviews', () => {
    const stats = [
      { date: '2026-04-11', reviewed: 40 },
      { date: '2026-04-10', reviewed: 0 },
      { date: '2026-04-09', reviewed: 20 },
    ]
    // Only 2 active days: (40 + 20) / 2 = 30
    expect(computeDailyAverage(stats)).toBe(30)
  })

  it('rounds to nearest integer', () => {
    const stats = [
      { date: '2026-04-11', reviewed: 10 },
      { date: '2026-04-10', reviewed: 13 },
    ]
    // (10 + 13) / 2 = 11.5 → rounds to 12
    expect(computeDailyAverage(stats)).toBe(12)
  })
})
