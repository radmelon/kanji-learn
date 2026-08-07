import { describe, it, expect } from 'vitest'
import { detectFluencyGain, detectThetaDelta } from './fluency'
import type { CardSnapshot, LearnerSnapshot, PlacementSnapshot } from '../types'
import { EVIDENCE_LABELS } from '../types'

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

  // MUTATION CAUGHT: dropping the window, which leaves "faster than before"
  // with no period attached — unfalsifiable praise, and the copy would have to
  // inline 30 days to say anything, hardcoding a constant it does not own.
  it('carries the window it measured over', () => {
    const f = detectFluencyGain(snap([card({ responseMsEarly: 4000, responseMsLate: 2000 })]))!
    expect(f.evidence).toContainEqual({ label: EVIDENCE_LABELS.WINDOW_DAYS, value: 30 })
  })

  // ── B-231 ─────────────────────────────────────────────────────────────────
  // These use LIVE numbers, not round ones. The defect shipped because every
  // fixture here was plausible by construction: 4000ms and 6000ms are what a
  // person does, and no test asked what happens when the phone was in a pocket.
  describe('B-231: a backgrounded app is not a fast learner', () => {
    it('excludes a card whose early mean is a backgrounded session', () => {
      // 21.5 hours — the real worst per-card early mean on 2026-05-21.
      expect(detectFluencyGain(snap([
        card({ responseMsEarly: 77_456_900, responseMsLate: 345_700 }),
      ]))).toBeNull()
    })

    it('excludes a card whose LATE mean is implausible, not just the early one', () => {
      expect(detectFluencyGain(snap([
        card({ responseMsEarly: 6000, responseMsLate: 1_026_300 }),
      ]))).toBeNull()
    })

    it('THE DEFECT: the live 1026.3s → 345.7s "66% faster" no longer fires', () => {
      expect(detectFluencyGain(snap([
        card({ kanjiId: 1, responseMsEarly: 1_026_300, responseMsLate: 345_700 }),
        card({ kanjiId: 2, responseMsEarly: 1_437_300, responseMsLate: 93_000 }),
      ]))).toBeNull()
    })

    it('a poisoned card cannot drag honest cards into a false claim', () => {
      // Card 2 alone is flat (no speed-up). Before the bound, card 1's 21-hour
      // early mean dominated the cross-card average and manufactured one.
      expect(detectFluencyGain(snap([
        card({ kanjiId: 1, responseMsEarly: 77_456_900, responseMsLate: 20_000 }),
        card({ kanjiId: 2, responseMsEarly: 20_000, responseMsLate: 20_000 }),
      ]))).toBeNull()
    })

    it('still fires on a real speed-up at live-plausible magnitudes', () => {
      // 33.8s → 19.6s, the only sane pair found across live windows.
      const f = detectFluencyGain(snap([card({ responseMsEarly: 33_800, responseMsLate: 19_600 })]))!
      expect(f.kind).toBe('fluency_gain')
      expect(f.magnitude).toBeGreaterThan(0)
    })

    it('keeps a slow-but-real answer just under the bound', () => {
      expect(detectFluencyGain(snap([
        card({ responseMsEarly: 119_000, responseMsLate: 60_000 }),
      ]))).not.toBeNull()
    })
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

  // ── B-232 ─────────────────────────────────────────────────────────────────
  // The live rows, not invented ones: b8503589 sat three placements on
  // 2026-08-01 at 01:38, 17:40 and 22:53. Every fixture above puts its two
  // sessions two months apart, which is why none of them could catch this.
  describe('B-232: two tests hours apart are not two measurements', () => {
    it('does not fire for the live same-day retake (01:38 → 17:40)', () => {
      expect(detectThetaDelta(snap([], placement({
        theta: 1.06744, se: 0.429168, completedAt: '2026-08-01T17:40:24.057Z',
        previous: { theta: 0.227545, se: 0.546214, completedAt: '2026-08-01T01:38:15.887Z' },
      })))).toBeNull()
    })

    it('does not fire just under the gap, however large the rise', () => {
      expect(detectThetaDelta(snap([], placement({
        theta: 2.0, se: 0.3, completedAt: '2026-08-08T00:00:00.000Z',
        previous: { theta: 0.0, se: 0.3, completedAt: '2026-08-01T00:00:01.000Z' },
      })))).toBeNull()
    })

    it('fires once the two sittings are far enough apart to mean something', () => {
      const f = detectThetaDelta(snap([], placement({
        theta: 1.14527, se: 0.351137, completedAt: '2026-08-01T22:53:42.092Z',
        previous: { theta: 0.227545, se: 0.546214, completedAt: '2026-06-01T00:00:00.000Z' },
      })))!
      expect(f.kind).toBe('theta_delta')
      expect(f.magnitude).toBeGreaterThan(0)
    })

    it('the two dates it reports can never be the same day', () => {
      const f = detectThetaDelta(snap([], placement()))!
      const then = f.evidence.find((e) => e.label === EVIDENCE_LABELS.PREVIOUSLY_MEASURED_ON)!
      const now = f.evidence.find((e) => e.label === EVIDENCE_LABELS.MEASURED_ON)!
      expect(then.value).not.toBe(now.value)
    })
  })
})
