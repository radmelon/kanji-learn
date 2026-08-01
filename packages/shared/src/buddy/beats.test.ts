import { describe, it, expect } from 'vitest'
import { selectBeat, proposeDailyGoal, type BeatKind } from './beats'
import type { CollectedState } from './meeting'

const empty: CollectedState = {
  reasons: [], interests: [], explicitRuler: null, dailyGoal: null,
  buddyDay: null, buddyIntervalWeeks: null, timezone: 'UTC', hadPriorData: false,
}
const onFile: CollectedState = {
  ...empty, hadPriorData: true,
  reasons: ['Travel', 'JLPT exam'], interests: ['games'], dailyGoal: 15,
}

describe('selectBeat', () => {
  it('opens with intro then orientation, before any requirement', () => {
    expect(selectBeat(empty, [], null)).toEqual({ kind: 'intro' })
    expect(selectBeat(empty, ['intro'], null)).toEqual({ kind: 'orientation' })
  })
  it('a new learner walks intro → orientation → why', () => {
    expect(selectBeat(empty, ['intro', 'orientation'], null)).toEqual({ kind: 'why' })
  })
  it('does not re-ask what it already has: prior-data learner goes straight to meet', () => {
    // Spec §3/§5 — reasons, interests, goal on file; frame resolves from reasons.
    expect(selectBeat(onFile, ['intro', 'orientation'], null)).toEqual({
      kind: 'meet', proposedDay: 0,
    })
  })
  it('everyone sees orientation — even with everything on file (owner decision)', () => {
    expect(selectBeat({ ...onFile, buddyDay: 2, buddyIntervalWeeks: 1 }, ['intro'], null))
      .toEqual({ kind: 'orientation' })
  })
  it('routes to frame_ask when reasons are ambiguous', () => {
    const s = { ...onFile, reasons: ['JLPT exam', 'Heritage'] }
    expect(selectBeat(s, ['intro', 'orientation'], null)).toEqual({ kind: 'frame_ask' })
  })
  it('meaning carries the resolved ruler and a proposed goal', () => {
    const s = { ...onFile, dailyGoal: null }
    expect(selectBeat(s, ['intro', 'orientation'], null)).toEqual({
      kind: 'meaning', ruler: 'jlpt', proposedGoal: 20,
    })
  })
  it('meaning: the proposed goal follows the ruler the learner disambiguated to', () => {
    const s = {
      ...onFile,
      reasons: ['JLPT exam', 'Heritage'], // ambiguous on their own
      explicitRuler: 'jlpt' as const,     // resolved via frame_ask
      dailyGoal: null,
    }
    expect(selectBeat(s, ['intro', 'orientation'], null)).toEqual({
      kind: 'meaning', ruler: 'jlpt', proposedGoal: 20,
    })
  })
  it('meet proposes the day after the rest day, or Sunday without one', () => {
    expect(selectBeat(onFile, ['intro', 'orientation'], 5)).toEqual({ kind: 'meet', proposedDay: 6 })
    expect(selectBeat(onFile, ['intro', 'orientation'], null)).toEqual({ kind: 'meet', proposedDay: 0 })
  })
  it('closes with ask exactly once, then done', () => {
    const complete = { ...onFile, buddyDay: 3, buddyIntervalWeeks: 1 }
    const seen: BeatKind[] = ['intro', 'orientation', 'meet']
    expect(selectBeat(complete, seen, null)).toEqual({ kind: 'ask' })
    expect(selectBeat(complete, [...seen, 'ask'], null)).toEqual({ kind: 'done' })
  })
})

describe('proposeDailyGoal', () => {
  it('proposes 20 minutes for exam/work learners, 15 otherwise', () => {
    expect(proposeDailyGoal(['JLPT exam'])).toBe(20)
    expect(proposeDailyGoal(['Work / Business'])).toBe(20)
    expect(proposeDailyGoal(['Travel'])).toBe(15)
    expect(proposeDailyGoal([])).toBe(15)
  })
})
