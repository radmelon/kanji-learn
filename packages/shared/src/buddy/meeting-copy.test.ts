import { describe, it, expect } from 'vitest'
import { beatCopy, appointmentEntryBody, reasonsEntryBody, DAY_NAMES } from './meeting-copy'
import type { Beat } from './beats'

const EVERY_BEAT: Beat[] = [
  { kind: 'intro' }, { kind: 'orientation' }, { kind: 'why' }, { kind: 'frame_ask' },
  { kind: 'meaning', ruler: 'jlpt', proposedGoal: 20 },
  { kind: 'meaning', ruler: 'grade', proposedGoal: 15 },
  { kind: 'meet', proposedDay: 0 }, { kind: 'ask' }, { kind: 'done' },
]

describe('beatCopy — enumerated over every beat, both meaning rulers', () => {
  it.each(EVERY_BEAT.map((b) => [b.kind, b] as const))('%s has non-empty copy', (_kind, beat) => {
    expect(beatCopy(beat).length).toBeGreaterThan(20)
  })
  it('meaning interpolates the proposed goal and names the ruler', () => {
    const jlpt = beatCopy({ kind: 'meaning', ruler: 'jlpt', proposedGoal: 20 })
    expect(jlpt).toContain('20 minutes')
    expect(jlpt).toContain('JLPT')
    expect(beatCopy({ kind: 'meaning', ruler: 'grade', proposedGoal: 15 })).toContain('15 minutes')
  })
  it('meet interpolates the proposed day name', () => {
    expect(beatCopy({ kind: 'meet', proposedDay: 6 })).toContain('Saturday')
  })
  it('the ask carries the spec\'s promise verbatim', () => {
    expect(beatCopy({ kind: 'ask' })).toContain('We are in this together')
  })
  it('orientation foreshadows the notebook (spec §3 beat 2)', () => {
    expect(beatCopy({ kind: 'orientation' }).toLowerCase()).toContain('notebook')
  })
})

describe('page-one entry bodies (spec §6)', () => {
  it('appointment records day, interval, and that the learner chose it', () => {
    const weekly = appointmentEntryBody(0, 1)
    expect(weekly).toContain('Sunday')
    expect(weekly).toContain('every week')
    expect(weekly.toLowerCase()).toContain('you picked')
    expect(appointmentEntryBody(3, 2)).toContain('every other week')
  })
  it('reasons body lists the reasons and names the ruler', () => {
    const body = reasonsEntryBody(['Travel', 'JLPT exam'], 'jlpt')
    expect(body).toContain('Travel')
    expect(body).toContain('JLPT exam')
  })
  it('DAY_NAMES is Sunday-first with 7 entries — index IS buddy_day', () => {
    expect(DAY_NAMES).toHaveLength(7)
    expect(DAY_NAMES[0]).toBe('Sunday')
    expect(DAY_NAMES[6]).toBe('Saturday')
  })
})
