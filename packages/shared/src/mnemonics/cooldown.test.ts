import { describe, it, expect } from 'vitest'
import { snoozedKanjiIds, snoozeUntil, SNOOZE_DAYS } from './cooldown'

const now = new Date('2026-07-26T12:00:00Z')

describe('snoozedKanjiIds', () => {
  it('excludes a kanji still inside its cooldown', () => {
    expect(
      snoozedKanjiIds([{ kanjiId: 1, buddyMomentSnoozedUntil: '2026-07-30T00:00:00Z' }], now),
    ).toEqual([1])
  })

  it('releases a kanji whose cooldown has expired', () => {
    expect(
      snoozedKanjiIds([{ kanjiId: 1, buddyMomentSnoozedUntil: '2026-07-20T00:00:00Z' }], now),
    ).toEqual([])
  })

  it('ignores kanji that were never snoozed', () => {
    expect(snoozedKanjiIds([{ kanjiId: 1, buddyMomentSnoozedUntil: null }], now)).toEqual([])
  })

  it('treats the exact expiry instant as released', () => {
    // A boundary that rounds the wrong way keeps the learner suppressed for an
    // extra session with no way to tell why.
    expect(
      snoozedKanjiIds([{ kanjiId: 1, buddyMomentSnoozedUntil: now.toISOString() }], now),
    ).toEqual([])
  })

  it('treats an unparseable stamp as not snoozed', () => {
    // This runs while deciding whether to offer a Buddy moment. A bad row must
    // not silently suppress the feature forever.
    expect(
      snoozedKanjiIds([{ kanjiId: 1, buddyMomentSnoozedUntil: 'not a date' }], now),
    ).toEqual([])
  })

  it('picks out only the snoozed ones from a mixed session', () => {
    expect(
      snoozedKanjiIds(
        [
          { kanjiId: 1, buddyMomentSnoozedUntil: '2026-07-30T00:00:00Z' },
          { kanjiId: 2, buddyMomentSnoozedUntil: null },
          { kanjiId: 3, buddyMomentSnoozedUntil: '2026-08-01T00:00:00Z' },
          { kanjiId: 4, buddyMomentSnoozedUntil: '2026-07-01T00:00:00Z' },
        ],
        now,
      ),
    ).toEqual([1, 3])
  })

  it('handles an empty session', () => {
    expect(snoozedKanjiIds([], now)).toEqual([])
  })
})

describe('snoozeUntil', () => {
  it('cools down for 7 days', () => {
    expect(SNOOZE_DAYS).toBe(7)
    expect(snoozeUntil(now).toISOString()).toBe('2026-08-02T12:00:00.000Z')
  })

  it('returns a future instant', () => {
    expect(snoozeUntil(now).getTime()).toBeGreaterThan(now.getTime())
  })
})
