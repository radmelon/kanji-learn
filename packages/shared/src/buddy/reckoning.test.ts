import { describe, it, expect } from 'vitest'
import { checkPromise, selectOpener, type DayActivity, type PromiseInput } from './reckoning'

// Deliberately NOT importing Commitment: checkPromise reads only three fields,
// so it takes a structural input. A Commitment satisfies this shape, which is
// why callers can pass one unchanged — but reckoning does not depend on the
// commitment module to say so.
const agreed: PromiseInput = { daysCommitted: 4, minutesPerDay: 15, source: 'session' }
const rolled: PromiseInput = { ...agreed, source: 'rolled_forward' }

function days(...minutes: number[]): DayActivity[] {
  return minutes.map((m, i) => ({
    date: `2026-08-0${3 + i}`,
    reviewed: m > 0 ? 10 : 0,
    studyMinutes: m,
  }))
}

describe('checkPromise', () => {
  it('is kept when active days reach the commitment', () => {
    const r = checkPromise(agreed, days(20, 20, 20, 20))
    expect(r.verdict).toBe('kept')
    expect(r.activeDays).toBe(4)
    expect(r.committedDays).toBe(4)
    expect(r.wasPromised).toBe(true)
  })

  it('is kept when active days EXCEED the commitment', () => {
    expect(checkPromise(agreed, days(20, 20, 20, 20, 20)).verdict).toBe('kept')
  })

  it('counts a day active on reviews, not on minutes', () => {
    // Four short days still counts as showing up four times — the commitment
    // is regularity first.
    const r = checkPromise(agreed, days(3, 3, 3, 3))
    expect(r.verdict).toBe('kept')
    expect(r.daysOnTargetMinutes).toBe(0)
  })

  it('is partial at half the commitment', () => {
    expect(checkPromise(agreed, days(20, 20)).verdict).toBe('partial')
  })

  it('is missed below half', () => {
    expect(checkPromise(agreed, days(20)).verdict).toBe('missed')
  })

  it('is missed on an entirely empty week', () => {
    const r = checkPromise(agreed, [])
    expect(r.verdict).toBe('missed')
    expect(r.activeDays).toBe(0)
  })

  it('a rolled-forward commitment is NEVER a broken promise', () => {
    const r = checkPromise(rolled, days(20))
    expect(r.verdict).toBe('not_promised')
    expect(r.wasPromised).toBe(false)
    // Control assertion: the activity was genuinely read, so this is not
    // passing because the fixture was empty.
    expect(r.activeDays).toBe(1)
  })

  it('a default commitment is also not_promised', () => {
    const r = checkPromise({ ...agreed, source: 'default' }, days(20, 20, 20, 20))
    expect(r.verdict).toBe('not_promised')
    // Control assertion: a kept week still reports its real activity.
    expect(r.activeDays).toBe(4)
  })

  it('ignores zero-review days entirely', () => {
    const r = checkPromise(agreed, days(20, 0, 20, 0, 20, 0, 20))
    expect(r.activeDays).toBe(4)
    expect(r.verdict).toBe('kept')
  })

  it('reports days that also hit the minutes target', () => {
    const r = checkPromise(agreed, days(20, 5, 20, 20))
    expect(r.daysOnTargetMinutes).toBe(3)
  })

  it('counts a day exactly on the minutes target as on target', () => {
    expect(checkPromise(agreed, days(15)).daysOnTargetMinutes).toBe(1)
  })

  it('a one-day commitment is kept by one day', () => {
    expect(checkPromise({ ...agreed, daysCommitted: 1 }, days(20)).verdict).toBe('kept')
  })

  it('an odd commitment rounds the partial threshold UP', () => {
    // 5 committed: 3 is partial, 2 is missed. Rounding down would call 2
    // "partial" and flatter a week that was not close.
    const five: PromiseInput = { ...agreed, daysCommitted: 5 }
    expect(checkPromise(five, days(20, 20, 20)).verdict).toBe('partial')
    expect(checkPromise(five, days(20, 20)).verdict).toBe('missed')
  })
})

describe('selectOpener', () => {
  const kept = checkPromise(agreed, days(20, 20, 20, 20))
  const one = checkPromise(agreed, days(20))
  const none = checkPromise(agreed, [])
  const some = checkPromise(agreed, days(20, 20))

  it('first_ever wins over everything', () => {
    expect(selectOpener({ check: none, isFirstSession: true })).toBe('first_ever')
    expect(selectOpener({ check: kept, isFirstSession: true })).toBe('first_ever')
  })

  it('absent when nothing happened at all', () => {
    expect(selectOpener({ check: none, isFirstSession: false })).toBe('absent')
  })

  it('off for a single session — the week to ask about the person', () => {
    expect(selectOpener({ check: one, isFirstSession: false })).toBe('off')
  })

  it('strong when the promise was kept', () => {
    expect(selectOpener({ check: kept, isFirstSession: false })).toBe('strong')
  })

  it('steady in between', () => {
    expect(selectOpener({ check: some, isFirstSession: false })).toBe('steady')
  })

  it('a kept rolled-forward week is steady, not strong — nothing was promised', () => {
    const rolledKept = checkPromise(rolled, days(20, 20, 20, 20))
    expect(selectOpener({ check: rolledKept, isFirstSession: false })).toBe('steady')
  })
})
