import { describe, it, expect } from 'vitest'
import { detectLevelEstimate, detectMechanicsExplainer } from './orient'
import type { LearnerSnapshot, PlacementSnapshot } from '../types'

function placement(o: Partial<PlacementSnapshot> = {}): PlacementSnapshot {
  return {
    theta: 0.4, se: 0.35, completedAt: '2026-08-01T00:00:00.000Z',
    level: 'N3', thetaLow: -0.1, thetaHigh: 0.9,
    levelLow: 'N4', levelHigh: 'N2',
    previous: null, items: [],
    ...o,
  }
}

function snap(p: PlacementSnapshot | null): LearnerSnapshot {
  return {
    now: '2026-08-02T00:00:00.000Z',
    placement: p,
    reviews: { cards: [], quiz: [] },
    commitment: null,
    hooks: { count: 0, latestAt: null, sessionDates: [], lapsesWithHook: null, lapsesWithoutHook: null },
    priorFindings: [],
  }
}

describe('detectLevelEstimate', () => {
  it('returns null with no placement', () => {
    expect(detectLevelEstimate(snap(null))).toBeNull()
  })

  it('ALWAYS carries the interval, never a bare label (spec §3)', () => {
    const f = detectLevelEstimate(snap(placement()))!
    const labels = f.evidence.map((e) => e.label)
    expect(labels).toContain('most likely level')
    expect(labels).toContain('lower bound')
    expect(labels).toContain('upper bound')
  })

  it('reports a tight estimate more confidently than a wide one', () => {
    const tight = detectLevelEstimate(snap(placement({ se: 0.2, levelLow: 'N3', levelHigh: 'N3' })))!
    const wide = detectLevelEstimate(snap(placement({ se: 1.1, levelLow: 'N5', levelHigh: 'N1' })))!
    expect(tight.confidence).toBeGreaterThan(wide.confidence)
  })

  it('is low magnitude — orienting, not urgent', () => {
    expect(detectLevelEstimate(snap(placement()))!.magnitude).toBeLessThan(0.6)
  })
})

describe('detectMechanicsExplainer', () => {
  it('is present whenever a placement exists — the learner has seen the machinery', () => {
    expect(detectMechanicsExplainer(snap(placement()))).not.toBeNull()
  })

  it('returns null with no placement — nothing to explain yet', () => {
    expect(detectMechanicsExplainer(snap(null))).toBeNull()
  })

  it('carries NO computed evidence — it is template copy, never LLM (spec §3)', () => {
    const f = detectMechanicsExplainer(snap(placement()))!
    expect(f.evidence).toEqual([])
  })

  it('is always fully confident and lowest magnitude — it never competes for a slot', () => {
    const f = detectMechanicsExplainer(snap(placement()))!
    expect(f.confidence).toBe(1)
    expect(f.magnitude).toBeLessThan(0.2)
  })
})
