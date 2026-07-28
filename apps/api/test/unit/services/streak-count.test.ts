import { describe, it, expect } from 'vitest'
import { computeStreak } from '../../../src/services/notification.service'

/**
 * B-222 — the daily push under-counted the streak by one for anyone who had
 * already studied that day.
 *
 * The reported case: Buddy studied 2026-07-27 and 2026-07-28, and the 8:54am
 * push read "✅ Nice work today! — 7 kanji done" (buildMessage's streak < 2
 * branch) instead of "⚡ Nice — 2 days in a row". The copy thanked them for
 * today while the streak feeding it started counting at yesterday.
 */

describe('computeStreak', () => {
  it('counts today when the learner has already studied (B-222)', () => {
    expect(computeStreak(['2026-07-28', '2026-07-27'], '2026-07-28')).toBe(2)
  })

  it('still counts a streak not yet continued today', () => {
    // 9am, hasn't studied yet. Yesterday and the day before both count, so the
    // reminder can honestly say "3 days in a row — don't stop now".
    expect(computeStreak(['2026-07-27', '2026-07-26', '2026-07-25'], '2026-07-28')).toBe(3)
  })

  it('breaks on a gap', () => {
    expect(computeStreak(['2026-07-28', '2026-07-27', '2026-07-25'], '2026-07-28')).toBe(2)
  })

  it('is zero when the last study day is older than yesterday', () => {
    expect(computeStreak(['2026-07-20'], '2026-07-28')).toBe(0)
  })

  it('is zero with no history', () => {
    expect(computeStreak([], '2026-07-28')).toBe(0)
  })

  it('counts a single day studied today', () => {
    expect(computeStreak(['2026-07-28'], '2026-07-28')).toBe(1)
  })

  it('crosses a month boundary', () => {
    expect(computeStreak(['2026-08-01', '2026-07-31', '2026-07-30'], '2026-08-01')).toBe(3)
  })

  it('crosses a year boundary', () => {
    expect(computeStreak(['2027-01-01', '2026-12-31'], '2027-01-01')).toBe(2)
  })

  it('handles a leap day', () => {
    expect(computeStreak(['2028-03-01', '2028-02-29', '2028-02-28'], '2028-03-01')).toBe(3)
  })

  it('does not drift across a DST transition', () => {
    // The old implementation walked dates with local-time setDate + toISOString,
    // so a US DST boundary could shift the computed day. UTC arithmetic cannot.
    expect(computeStreak(['2026-11-02', '2026-11-01', '2026-10-31'], '2026-11-02')).toBe(3)
  })
})
