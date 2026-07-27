// apps/api/test/unit/services/reminder-eligibility.test.ts
//
// isEligibleNow is a pure predicate — no database, no Expo, no clock of its
// own. It is the whole of root cause A (BUGS.md, 2026-07-26): reminderHour is
// documented as being in the user's timezone, and was being evaluated against
// UTC, so a 20:00 reminder fired at 1pm PDT.

import { describe, it, expect } from 'vitest'
import { isEligibleNow, localHourAndWeekday } from '../../../src/services/notification.service'

const at = (iso: string) => new Date(iso)

describe('isEligibleNow', () => {
  it('matches the local hour in the user timezone, not UTC', () => {
    // 2026-07-27T03:00Z is 2026-07-26 20:00 in Los Angeles.
    expect(
      isEligibleNow(at('2026-07-27T03:00:00Z'), {
        timezone: 'America/Los_Angeles', reminderHour: 20, restDay: null,
      }),
    ).toBe(true)
  })

  it('does NOT fire at 20:00 UTC for a Los Angeles user with reminderHour 20', () => {
    // This is the shipped bug. Every row carried the 'UTC' default, so 20:00Z
    // — 1pm PDT — is when the reminder actually arrived.
    expect(
      isEligibleNow(at('2026-07-27T20:00:00Z'), {
        timezone: 'America/Los_Angeles', reminderHour: 20, restDay: null,
      }),
    ).toBe(false)
  })

  it('skips the user rest day in local time', () => {
    // 2026-07-26 is a Sunday (day 0), and 03:00Z the next day is still
    // Sunday evening in Los Angeles — the rest day has to be read locally too.
    expect(
      isEligibleNow(at('2026-07-27T03:00:00Z'), {
        timezone: 'America/Los_Angeles', reminderHour: 20, restDay: 0,
      }),
    ).toBe(false)
  })

  it('fires on a non-rest day', () => {
    // Same instant, rest day set to Monday — Sunday is fair game.
    expect(
      isEligibleNow(at('2026-07-27T03:00:00Z'), {
        timezone: 'America/Los_Angeles', reminderHour: 20, restDay: 1,
      }),
    ).toBe(true)
  })

  it('handles local midnight, which ICU renders as hour 24', () => {
    // Verified on this Node build: Intl with hour12:false formats 00:00 as
    // "24". Untreated, a learner who picks midnight never gets a reminder.
    expect(
      isEligibleNow(at('2026-07-27T07:00:00Z'), {
        timezone: 'America/Los_Angeles', reminderHour: 0, restDay: null,
      }),
    ).toBe(true)
  })

  it('falls back to UTC on an invalid timezone rather than throwing', () => {
    expect(
      isEligibleNow(at('2026-07-27T20:00:00Z'), {
        timezone: 'Not/AZone', reminderHour: 20, restDay: null,
      }),
    ).toBe(true)
  })

  it('treats a null timezone as UTC', () => {
    expect(
      isEligibleNow(at('2026-07-27T20:00:00Z'), {
        timezone: null, reminderHour: 20, restDay: null,
      }),
    ).toBe(true)
  })

  it('defaults reminderHour to 20 when unset', () => {
    expect(
      isEligibleNow(at('2026-07-27T20:00:00Z'), {
        timezone: 'UTC', reminderHour: null, restDay: null,
      }),
    ).toBe(true)
    expect(
      isEligibleNow(at('2026-07-27T19:00:00Z'), {
        timezone: 'UTC', reminderHour: null, restDay: null,
      }),
    ).toBe(false)
  })

  it('crosses the date line correctly for a Tokyo user', () => {
    // 2026-07-27T11:00Z is 2026-07-27 20:00 in Tokyo (UTC+9) — the next day
    // relative to a naive UTC read for anyone west of it.
    expect(
      isEligibleNow(at('2026-07-27T11:00:00Z'), {
        timezone: 'Asia/Tokyo', reminderHour: 20, restDay: null,
      }),
    ).toBe(true)
  })
})

// sendRestDaySummaries needs the local weekday as well as the hour — it fires
// ON the rest day, where isEligibleNow deliberately returns false. It read the
// clock with its own copy of the same broken idiom until this was extracted.
describe('localHourAndWeekday', () => {
  it('reports the local hour and weekday, not the UTC ones', () => {
    // 2026-07-27T03:00Z → Sunday 20:00 in Los Angeles, Monday 03:00 in UTC.
    expect(localHourAndWeekday(at('2026-07-27T03:00:00Z'), 'America/Los_Angeles'))
      .toEqual({ hour: 20, weekday: 0 })
  })

  it('normalises ICU’s hour 24 to 0 so midnight is comparable', () => {
    expect(localHourAndWeekday(at('2026-07-27T07:00:00Z'), 'America/Los_Angeles'))
      .toEqual({ hour: 0, weekday: 1 })
  })

  it('falls back to UTC on an unknown timezone', () => {
    expect(localHourAndWeekday(at('2026-07-27T03:00:00Z'), 'Not/AZone'))
      .toEqual({ hour: 3, weekday: 1 })
  })
})
