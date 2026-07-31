import { describe, it, expect } from 'vitest'
import {
  validateCommitment,
  rollForward,
  countConsecutiveRolledForward,
  DEFAULT_COMMITMENT,
  type Commitment,
} from './commitment'

const agreed: Commitment = {
  weekStart: '2026-08-03',
  daysCommitted: 4,
  dayTargets: null,
  minutesPerDay: 15,
  focus: null,
  source: 'session',
}

describe('validateCommitment', () => {
  it('accepts a normal commitment', () => {
    expect(validateCommitment({ daysCommitted: 4, minutesPerDay: 15 })).toEqual({ ok: true })
  })

  it('rejects zero days — a commitment to nothing is not a commitment', () => {
    const r = validateCommitment({ daysCommitted: 0, minutesPerDay: 15 })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('days_out_of_range')
  })

  it('rejects more than 7 days', () => {
    expect(validateCommitment({ daysCommitted: 8, minutesPerDay: 15 }).ok).toBe(false)
  })

  it('rejects a non-integer day count', () => {
    expect(validateCommitment({ daysCommitted: 3.5, minutesPerDay: 15 }).ok).toBe(false)
  })

  it('rejects non-positive minutes', () => {
    const r = validateCommitment({ daysCommitted: 4, minutesPerDay: 0 })
    expect(r.ok === false && r.reason).toBe('minutes_out_of_range')
  })

  it('rejects dayTargets that disagree with daysCommitted', () => {
    const r = validateCommitment({ daysCommitted: 4, minutesPerDay: 15, dayTargets: [1, 3] })
    expect(r.ok === false && r.reason).toBe('day_targets_mismatch')
  })

  it('accepts dayTargets that agree', () => {
    expect(validateCommitment({ daysCommitted: 2, minutesPerDay: 15, dayTargets: [1, 3] }).ok).toBe(true)
  })

  it('accepts a null dayTargets', () => {
    expect(validateCommitment({ daysCommitted: 2, minutesPerDay: 15, dayTargets: null }).ok).toBe(true)
  })
})

describe('rollForward', () => {
  it('carries the numbers and re-labels the source', () => {
    const next = rollForward(agreed, '2026-08-10')
    expect(next.weekStart).toBe('2026-08-10')
    expect(next.daysCommitted).toBe(4)
    expect(next.minutesPerDay).toBe(15)
    expect(next.source).toBe('rolled_forward')
  })

  it('rolling forward a rolled-forward commitment stays rolled_forward', () => {
    const once = rollForward(agreed, '2026-08-10')
    const twice = rollForward(once, '2026-08-17')
    expect(twice.source).toBe('rolled_forward')
  })

  it('carries dayTargets', () => {
    const next = rollForward({ ...agreed, daysCommitted: 2, dayTargets: [1, 4] }, '2026-08-10')
    expect(next.dayTargets).toEqual([1, 4])
  })

  it('drops focus — a theme the learner never re-agreed should not persist', () => {
    const next = rollForward({ ...agreed, focus: 'backlog' }, '2026-08-10')
    expect(next.focus).toBeNull()
  })

  it('does not mutate the previous commitment', () => {
    const previous: Commitment = { ...agreed, focus: 'backlog' }
    rollForward(previous, '2026-08-10')
    expect(previous.weekStart).toBe('2026-08-03')
    expect(previous.focus).toBe('backlog')
    expect(previous.source).toBe('session')
  })

  it('seeds from DEFAULT_COMMITMENT when there is no previous', () => {
    const next = rollForward(null, '2026-08-03')
    expect(next.source).toBe('default')
    expect(next.weekStart).toBe('2026-08-03')
    expect(next.daysCommitted).toBe(DEFAULT_COMMITMENT.daysCommitted)
    expect(next.minutesPerDay).toBe(DEFAULT_COMMITMENT.minutesPerDay)
    expect(next.dayTargets).toBeNull()
    expect(next.focus).toBeNull()
  })
})

describe('countConsecutiveRolledForward', () => {
  it('counts an unbroken run from the most recent backwards', () => {
    expect(countConsecutiveRolledForward([
      { weekStart: '2026-08-17', source: 'rolled_forward' },
      { weekStart: '2026-08-10', source: 'rolled_forward' },
      { weekStart: '2026-08-03', source: 'session' },
    ])).toBe(2)
  })

  it('is zero when the most recent was actually agreed', () => {
    expect(countConsecutiveRolledForward([
      { weekStart: '2026-08-17', source: 'session' },
      { weekStart: '2026-08-10', source: 'rolled_forward' },
    ])).toBe(0)
  })

  it('sorts by weekStart rather than trusting input order', () => {
    expect(countConsecutiveRolledForward([
      { weekStart: '2026-08-03', source: 'session' },
      { weekStart: '2026-08-17', source: 'rolled_forward' },
      { weekStart: '2026-08-10', source: 'rolled_forward' },
    ])).toBe(2)
  })

  it('stops at a default row — that is a seed, not a miss', () => {
    expect(countConsecutiveRolledForward([
      { weekStart: '2026-08-10', source: 'rolled_forward' },
      { weekStart: '2026-08-03', source: 'default' },
    ])).toBe(1)
  })

  it('is zero for an empty history', () => {
    expect(countConsecutiveRolledForward([])).toBe(0)
  })

  it('does not mutate the array it was given', () => {
    const rows: Array<{ weekStart: string; source: 'session' | 'rolled_forward' | 'default' }> = [
      { weekStart: '2026-08-03', source: 'session' },
      { weekStart: '2026-08-17', source: 'rolled_forward' },
    ]
    countConsecutiveRolledForward(rows)
    expect(rows[0].weekStart).toBe('2026-08-03')
  })
})
