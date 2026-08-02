import { describe, it, expect } from 'vitest'
import { detectCommitmentGap } from './commitment-gap'
import type { CommitmentSnapshot, LearnerSnapshot } from '../types'

function snap(commitment: CommitmentSnapshot | null): LearnerSnapshot {
  return {
    now: '2026-08-02T00:00:00.000Z',
    placement: null,
    reviews: { cards: [], quiz: [] },
    commitment,
    hooks: { count: 0, latestAt: null, sessionDates: [], lapsesWithHook: null, lapsesWithoutHook: null },
    priorFindings: [],
  }
}

const period = { periodStart: '2026-07-26T00:00:00.000Z', periodEnd: '2026-08-02T00:00:00.000Z' }

describe('detectCommitmentGap', () => {
  it('returns null when no commitment was made', () => {
    expect(detectCommitmentGap(snap(null))).toBeNull()
  })

  it('returns null when the commitment was met', () => {
    expect(detectCommitmentGap(snap({ promisedMinutes: 70, actualMinutes: 70, ...period }))).toBeNull()
  })

  it('returns null when the commitment was BEATEN — that is not a gap', () => {
    expect(detectCommitmentGap(snap({ promisedMinutes: 70, actualMinutes: 120, ...period }))).toBeNull()
  })

  it('returns null for a rounding-error shortfall', () => {
    expect(detectCommitmentGap(snap({ promisedMinutes: 70, actualMinutes: 68, ...period }))).toBeNull()
  })

  it('fires on a real shortfall and scales with the PROPORTION missed', () => {
    const half = detectCommitmentGap(snap({ promisedMinutes: 70, actualMinutes: 35, ...period }))!
    const none = detectCommitmentGap(snap({ promisedMinutes: 70, actualMinutes: 0, ...period }))!
    expect(half.kind).toBe('commitment_gap')
    expect(none.magnitude).toBeGreaterThan(half.magnitude)
  })

  it('treats a proportion, not an absolute — 5 of 10 minutes is as bad as 50 of 100', () => {
    const small = detectCommitmentGap(snap({ promisedMinutes: 10, actualMinutes: 5, ...period }))!
    const large = detectCommitmentGap(snap({ promisedMinutes: 100, actualMinutes: 50, ...period }))!
    expect(small.magnitude).toBeCloseTo(large.magnitude, 6)
  })

  it('is fully confident — this is a promise and a measurement, not an inference', () => {
    const f = detectCommitmentGap(snap({ promisedMinutes: 70, actualMinutes: 10, ...period }))!
    expect(f.confidence).toBe(1)
  })

  it('handles a zero promise without dividing by zero', () => {
    expect(detectCommitmentGap(snap({ promisedMinutes: 0, actualMinutes: 0, ...period }))).toBeNull()
  })

  it('carries promised and actual as evidence', () => {
    const f = detectCommitmentGap(snap({ promisedMinutes: 70, actualMinutes: 10, ...period }))!
    expect(f.evidence).toEqual(
      expect.arrayContaining([
        { label: 'minutes promised', value: 70 },
        { label: 'minutes studied', value: 10 },
      ]),
    )
  })
})
