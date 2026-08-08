import { describe, it, expect } from 'vitest'
import { EVENT_SURFACES, RECORD_SURFACES, ROUTING, SURFACE_CAP, routableTo } from './routing'
import type { Finding, FindingKind } from './types'
import { FINDING_PRIORITY } from './types'

describe('surface vocabulary', () => {
  it('separates event surfaces from record surfaces with no overlap', () => {
    const overlap = EVENT_SURFACES.filter((s) => (RECORD_SURFACES as readonly string[]).includes(s))
    expect(overlap).toEqual([])
  })

  it('names the four event surfaces from spec §3.1', () => {
    expect([...EVENT_SURFACES].sort()).toEqual(
      ['placement', 'progress', 'session_complete', 'weekly'],
    )
  })

  it('names the two record surfaces from spec §3.1', () => {
    expect([...RECORD_SURFACES].sort()).toEqual(['journal', 'tutor_report'])
  })
})

describe('the routing table', () => {
  it('covers every finding kind', () => {
    expect(Object.keys(ROUTING).sort()).toEqual(Object.keys(FINDING_PRIORITY).sort())
  })

  it('gives every kind at least one event surface', () => {
    const orphans = Object.entries(ROUTING)
      .filter(([, rule]) => rule.events.length === 0)
      .map(([kind]) => kind)
    expect(orphans).toEqual([])
  })

  it('gives every kind at least one audience', () => {
    const mute = Object.entries(ROUTING)
      .filter(([, rule]) => rule.audiences.length === 0)
      .map(([kind]) => kind)
    expect(mute).toEqual([])
  })

  it('records a non-empty anchor rationale on every row', () => {
    for (const [kind, rule] of Object.entries(ROUTING)) {
      expect(rule.anchor.length, `${kind} has no anchor`).toBeGreaterThan(0)
    }
  })

  it('routes only to surfaces that exist', () => {
    for (const [kind, rule] of Object.entries(ROUTING)) {
      for (const s of rule.events) {
        expect(EVENT_SURFACES, `${kind} routes to unknown surface ${s}`).toContain(s)
      }
    }
  })

  // Spec §3.2 — two kinds are learner-only for DIFFERENT reasons, and the spec
  // is explicit that revisiting the consent call must move only commitment_gap.
  it('withholds mechanics_explainer from tutors — its subject is the app', () => {
    expect(ROUTING.mechanics_explainer.audiences).toEqual(['learner'])
  })

  it('withholds commitment_gap from tutors — consent, not subject', () => {
    expect(ROUTING.commitment_gap.audiences).toEqual(['learner'])
  })

  it('shares every other kind with tutors', () => {
    const shared = Object.entries(ROUTING)
      .filter(([kind]) => kind !== 'mechanics_explainer' && kind !== 'commitment_gap')
    for (const [kind, rule] of shared) {
      expect(rule.audiences, `${kind} should be tutor-visible`).toContain('tutor')
    }
  })

  // Spec §4.1 — commitment_gap is barred from Session Complete on purpose.
  it('never routes commitment_gap to Session Complete', () => {
    expect(ROUTING.commitment_gap.events).not.toContain('session_complete')
  })
})

function f(kind: FindingKind): Finding {
  return { kind, magnitude: 0.5, confidence: 1, evidence: [], since: null }
}

describe('per-surface caps', () => {
  it('leaves record surfaces uncapped — they are the ledger', () => {
    expect(SURFACE_CAP.journal).toBe(Infinity)
    expect(SURFACE_CAP.tutor_report).toBe(Infinity)
  })

  it('caps Session Complete at one — the learner is leaving', () => {
    expect(SURFACE_CAP.session_complete).toBe(1)
  })

  it('caps placement at three', () => {
    expect(SURFACE_CAP.placement).toBe(3)
  })
})

describe('routableTo', () => {
  it('keeps only kinds the table routes to that event surface', () => {
    const out = routableTo([f('hardest_cleared'), f('leech')], 'placement', 'learner')
    expect(out.map((x) => x.kind)).toEqual(['hardest_cleared'])
  })

  it('sends every audience-permitted kind to a record surface', () => {
    const out = routableTo([f('hardest_cleared'), f('leech')], 'journal', 'learner')
    expect(out.map((x) => x.kind).sort()).toEqual(['hardest_cleared', 'leech'])
  })

  it('withholds learner-only kinds from a tutor even on a record surface', () => {
    const out = routableTo(
      [f('commitment_gap'), f('mechanics_explainer'), f('leech')],
      'tutor_report',
      'tutor',
    )
    expect(out.map((x) => x.kind)).toEqual(['leech'])
  })

  it('preserves input order — selection already ranked these', () => {
    const out = routableTo([f('retest_due'), f('level_estimate')], 'progress', 'learner')
    expect(out.map((x) => x.kind)).toEqual(['retest_due', 'level_estimate'])
  })

  it('does not apply the cap — that is the caller\'s decision', () => {
    const out = routableTo([f('leech'), f('hook_coverage')], 'session_complete', 'learner')
    expect(out).toHaveLength(2)
  })
})
