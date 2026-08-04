import { describe, it, expect } from 'vitest'
import { detectFluencyGain, detectThetaDelta } from './fluency'
import type { CardSnapshot, LearnerSnapshot, PlacementSnapshot } from '../types'

function card(o: Partial<CardSnapshot> = {}): CardSnapshot {
  return {
    kanjiId: 1, character: '日', status: 'reviewing',
    lapses: 0, readingStage: null, regressions: 0,
    responseMsEarly: 4000, responseMsLate: 4000,
    accuracyEarly: 0.8, accuracyLate: 0.8,
    recentQualities: [], hasCoCreatedHook: false,
    ...o,
  }
}

function snap(cards: CardSnapshot[], placement: PlacementSnapshot | null = null): LearnerSnapshot {
  return {
    now: '2026-08-02T00:00:00.000Z',
    placement,
    reviews: { cards, quiz: [], windowDays: 30 },
    commitment: null,
    hooks: { count: 0, latestAt: null, sessionDates: [], lapsesWithHook: null, lapsesWithoutHook: null },
    priorFindings: [],
  }
}

describe('detectFluencyGain', () => {
  it('returns null when nothing has both halves measured', () => {
    expect(detectFluencyGain(snap([card({ responseMsEarly: null })]))).toBeNull()
  })

  it('returns null when response time did not fall', () => {
    expect(detectFluencyGain(snap([card({ responseMsEarly: 3000, responseMsLate: 3500 })]))).toBeNull()
  })

  it('fires when response time falls at flat accuracy', () => {
    const f = detectFluencyGain(snap([
      card({ kanjiId: 1, responseMsEarly: 6000, responseMsLate: 3000 }),
      card({ kanjiId: 2, responseMsEarly: 5000, responseMsLate: 2500 }),
    ]))!
    expect(f.kind).toBe('fluency_gain')
    expect(f.magnitude).toBeGreaterThan(0)
  })

  it('THE TRAP: does NOT fire when they got faster by getting sloppier', () => {
    expect(detectFluencyGain(snap([
      card({ responseMsEarly: 6000, responseMsLate: 2000, accuracyEarly: 0.9, accuracyLate: 0.5 }),
    ]))).toBeNull()
  })

  it('tolerates a small accuracy wobble — flat does not mean identical', () => {
    const f = detectFluencyGain(snap([
      card({ responseMsEarly: 6000, responseMsLate: 3000, accuracyEarly: 0.82, accuracyLate: 0.79 }),
    ]))
    expect(f).not.toBeNull()
  })

  it('still fires when accuracy IMPROVED alongside the speed-up', () => {
    const f = detectFluencyGain(snap([
      card({ responseMsEarly: 6000, responseMsLate: 3000, accuracyEarly: 0.6, accuracyLate: 0.9 }),
    ]))
    expect(f).not.toBeNull()
  })

  it('reports the improvement as a percentage in evidence', () => {
    const f = detectFluencyGain(snap([card({ responseMsEarly: 4000, responseMsLate: 2000 })]))!
    expect(f.evidence.map((e) => e.label)).toContain('percent faster')
  })
})

function placement(o: Partial<PlacementSnapshot> = {}): PlacementSnapshot {
  return {
    theta: 0.8, se: 0.3, completedAt: '2026-08-01T00:00:00.000Z',
    level: 'N2', thetaLow: 0.3, thetaHigh: 1.3, levelLow: 'N3', levelHigh: 'N2',
    previous: { theta: 0.1, se: 0.4, completedAt: '2026-06-01T00:00:00.000Z' },
    items: [],
    ...o,
  }
}

describe('detectThetaDelta', () => {
  it('returns null with no placement', () => {
    expect(detectThetaDelta(snap([], null))).toBeNull()
  })

  it('returns null with only one session — the delta needs two (spec §3)', () => {
    expect(detectThetaDelta(snap([], placement({ previous: null })))).toBeNull()
  })

  it('fires on a real rise', () => {
    const f = detectThetaDelta(snap([], placement()))!
    expect(f.kind).toBe('theta_delta')
    expect(f.magnitude).toBeGreaterThan(0)
  })

  it('returns null when the movement is inside the noise of the two estimates', () => {
    expect(detectThetaDelta(snap([], placement({
      theta: 0.15, se: 0.5,
      previous: { theta: 0.1, se: 0.5, completedAt: '2026-06-01T00:00:00.000Z' },
    })))).toBeNull()
  })

  it('does not fire on a DROP — this is a Motivate finding, not a scolding', () => {
    expect(detectThetaDelta(snap([], placement({
      theta: -0.6,
      previous: { theta: 0.8, se: 0.3, completedAt: '2026-06-01T00:00:00.000Z' },
    })))).toBeNull()
  })
})
