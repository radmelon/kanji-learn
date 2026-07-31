import { describe, it, expect } from 'vitest'
import {
  evaluateAppointment,
  shouldStepDown,
  nextCadence,
  defaultBuddyDay,
  addDays,
  weekdayOf,
  STEP_DOWN_AFTER_MISSES,
} from './appointment'

// 2026-08-03 is a Monday (weekday 1). Every date below is stated with its
// weekday so a reader can check the arithmetic by hand.
const MON = '2026-08-03'
const TUE = '2026-08-04'
const THU = '2026-08-06'
const FRI = '2026-08-07'
const NEXT_MON = '2026-08-10'

describe('date helpers', () => {
  it('weekdayOf reads a UTC-anchored ISO date', () => {
    expect(weekdayOf(MON)).toBe(1)
    expect(weekdayOf('2026-08-09')).toBe(0) // Sunday
  })

  it('addDays crosses a month boundary', () => {
    expect(addDays('2026-08-30', 3)).toBe('2026-09-02')
  })

  it('addDays accepts negatives', () => {
    expect(addDays(NEXT_MON, -7)).toBe(MON)
  })
})

describe('evaluateAppointment', () => {
  const base = { buddyDay: 1, intervalWeeks: 1, lastSessionDate: null }

  it('is not_scheduled when buddyDay is null', () => {
    expect(evaluateAppointment({ ...base, buddyDay: null, localDate: MON }).kind)
      .toBe('not_scheduled')
  })

  it('is due on the buddy day itself', () => {
    const s = evaluateAppointment({ ...base, localDate: MON })
    expect(s.kind).toBe('due')
    expect(s.kind === 'due' && s.weekStart).toBe(MON)
  })

  it('is still due one day late — the window has not closed', () => {
    const s = evaluateAppointment({ ...base, localDate: TUE })
    expect(s.kind).toBe('due')
    expect(s.kind === 'due' && s.weekStart).toBe(MON)
  })

  it('is due at the last day of the window (3 days after, weekly)', () => {
    const s = evaluateAppointment({ ...base, localDate: THU })
    expect(s.kind).toBe('due')
    expect(s.kind === 'due' && s.weekStart).toBe(MON)
  })

  it('past the window it is waiting for the NEXT buddy day, not the missed one', () => {
    const s = evaluateAppointment({ ...base, localDate: FRI })
    expect(s.kind).toBe('waiting')
    expect(s.kind === 'waiting' && s.nextDue).toBe(NEXT_MON)
  })

  it('is not due again once this week is already done', () => {
    const s = evaluateAppointment({ ...base, localDate: TUE, lastSessionDate: MON })
    expect(s.kind).toBe('waiting')
    expect(s.kind === 'waiting' && s.nextDue).toBe(NEXT_MON)
  })

  it('fortnightly is not due on the off week', () => {
    const s = evaluateAppointment({
      buddyDay: 1, intervalWeeks: 2, lastSessionDate: MON, localDate: NEXT_MON,
    })
    expect(s.kind).toBe('waiting')
    expect(s.kind === 'waiting' && s.nextDue).toBe('2026-08-17')
  })

  it('fortnightly is due again after two weeks', () => {
    const s = evaluateAppointment({
      buddyDay: 1, intervalWeeks: 2, lastSessionDate: MON, localDate: '2026-08-17',
    })
    expect(s.kind).toBe('due')
  })
})

describe('step-down', () => {
  it('does not fire below the threshold', () => {
    expect(shouldStepDown(STEP_DOWN_AFTER_MISSES - 1)).toBe(false)
  })

  it('fires at the threshold', () => {
    expect(shouldStepDown(STEP_DOWN_AFTER_MISSES)).toBe(true)
  })

  it('weekly steps down to fortnightly, keeping the day', () => {
    expect(nextCadence({ buddyDay: 1, intervalWeeks: 1 }))
      .toEqual({ buddyDay: 1, intervalWeeks: 2 })
  })

  it('fortnightly steps down to no appointment at all', () => {
    expect(nextCadence({ buddyDay: 1, intervalWeeks: 2 }))
      .toEqual({ buddyDay: null, intervalWeeks: 2 })
  })

  it('already stepped all the way down is a no-op', () => {
    expect(nextCadence({ buddyDay: null, intervalWeeks: 2 }))
      .toEqual({ buddyDay: null, intervalWeeks: 2 })
  })
})

describe('defaultBuddyDay', () => {
  it('is the day after the rest day', () => {
    expect(defaultBuddyDay(0)).toBe(1)
  })

  it('wraps around the week', () => {
    expect(defaultBuddyDay(6)).toBe(0)
  })

  it('is null when there is no rest day — Buddy proposes rather than picking silently', () => {
    expect(defaultBuddyDay(null)).toBeNull()
  })
})
