import { describe, it, expect } from 'vitest'
import { carryForward, selectionsMatch } from './persistence'
import type { Finding, FindingKind, PriorFinding } from './types'

function finding(kind: FindingKind): Finding {
  return { kind, magnitude: 0.5, confidence: 1, evidence: [], since: null }
}

const NOW = '2026-08-02T12:00:00.000Z'

describe('carryForward', () => {
  it('stamps both dates with now for a kind that was not selected before', () => {
    const result = carryForward([], [finding('reading_lag')], NOW)
    expect(result).toEqual([
      { kind: 'reading_lag', since: NOW, lastRaisedAt: NOW },
    ])
  })

  it('preserves BOTH stamps for a kind that stays selected', () => {
    // This is the whole point: a finding on display keeps its lastRaisedAt,
    // so its novelty RECOVERS rather than being re-floored every run.
    const priors: PriorFinding[] = [
      { kind: 'reading_lag', since: '2026-07-01', lastRaisedAt: '2026-07-20' },
    ]
    const result = carryForward(priors, [finding('reading_lag')], NOW)
    expect(result).toEqual([
      { kind: 'reading_lag', since: '2026-07-01', lastRaisedAt: '2026-07-20' },
    ])
  })

  it('restamps only on a transition from absent to selected', () => {
    const priors: PriorFinding[] = [
      { kind: 'leech', since: '2026-07-01', lastRaisedAt: '2026-07-20' },
    ]
    const result = carryForward(priors, [finding('leech'), finding('reading_lag')], NOW)
    expect(result).toEqual([
      { kind: 'leech', since: '2026-07-01', lastRaisedAt: '2026-07-20' },
      { kind: 'reading_lag', since: NOW, lastRaisedAt: NOW },
    ])
  })

  it('drops kinds that are no longer selected', () => {
    const priors: PriorFinding[] = [
      { kind: 'leech', since: '2026-07-01', lastRaisedAt: '2026-07-20' },
    ]
    const result = carryForward(priors, [finding('reading_lag')], NOW)
    expect(result.map((p) => p.kind)).toEqual(['reading_lag'])
  })

  it('starts a NEW episode when a kind returns after dropping out', () => {
    // `since` deliberately does not survive a gap — priors only ever carry the
    // immediately preceding analysis, so a returning kind is a new episode.
    const priors: PriorFinding[] = []
    const result = carryForward(priors, [finding('leech')], NOW)
    expect(result[0].since).toBe(NOW)
  })

  it('returns an empty array for an empty selection', () => {
    expect(carryForward([], [], NOW)).toEqual([])
  })
})

describe('selectionsMatch', () => {
  it('is true when the same kinds are selected, regardless of order', () => {
    const priors: PriorFinding[] = [
      { kind: 'leech', since: NOW, lastRaisedAt: NOW },
      { kind: 'reading_lag', since: NOW, lastRaisedAt: NOW },
    ]
    expect(selectionsMatch(priors, [finding('reading_lag'), finding('leech')])).toBe(true)
  })

  it('is false when a kind is added', () => {
    const priors: PriorFinding[] = [{ kind: 'leech', since: NOW, lastRaisedAt: NOW }]
    expect(selectionsMatch(priors, [finding('leech'), finding('reading_lag')])).toBe(false)
  })

  it('is false when a kind is removed', () => {
    const priors: PriorFinding[] = [
      { kind: 'leech', since: NOW, lastRaisedAt: NOW },
      { kind: 'reading_lag', since: NOW, lastRaisedAt: NOW },
    ]
    expect(selectionsMatch(priors, [finding('leech')])).toBe(false)
  })

  it('is true for two empty selections', () => {
    expect(selectionsMatch([], [])).toBe(true)
  })
})
