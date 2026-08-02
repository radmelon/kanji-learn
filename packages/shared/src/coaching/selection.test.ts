import { describe, it, expect } from 'vitest'
import { novelty, select, DEFAULT_FINDING_COUNT, NOVELTY_FLOOR } from './selection'
import type { Finding, FindingKind, PriorFinding } from './types'

const NOW = '2026-08-02T00:00:00.000Z'

function prior(kind: FindingKind, lastRaisedDaysAgo: number, sinceDaysAgo = lastRaisedDaysAgo): PriorFinding {
  const day = 86_400_000
  return {
    kind,
    since: new Date(Date.parse(NOW) - sinceDaysAgo * day).toISOString(),
    lastRaisedAt: new Date(Date.parse(NOW) - lastRaisedDaysAgo * day).toISOString(),
  }
}

function finding(kind: FindingKind, magnitude: number, confidence = 1): Finding {
  return { kind, magnitude, confidence, evidence: [], since: null }
}

describe('novelty', () => {
  it('is 1 for a kind never raised before', () => {
    expect(novelty('leech', [], NOW)).toBe(1)
  })

  it('PROPERTY 1: monotonically decreasing in how RECENTLY it was raised', () => {
    const ages = [0, 1, 3, 7, 14, 30, 90]
    const values = ages.map((d) => novelty('leech', [prior('leech', d)], NOW))
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!)
    }
  })

  it('PROPERTY 2: never reaches zero, even raised moments ago', () => {
    expect(novelty('leech', [prior('leech', 0)], NOW)).toBeGreaterThan(0)
    expect(novelty('leech', [prior('leech', 0)], NOW)).toBe(NOVELTY_FLOOR)
  })

  it('never exceeds 1', () => {
    expect(novelty('leech', [prior('leech', 3650)], NOW)).toBeLessThanOrEqual(1)
  })

  it('is unaffected by a prior for a DIFFERENT kind', () => {
    expect(novelty('leech', [prior('commitment_gap', 0)], NOW)).toBe(1)
  })
})

describe('select', () => {
  it('returns at most `count`, defaulting to DEFAULT_FINDING_COUNT', () => {
    const findings = (['leech', 'reading_lag', 'commitment_gap', 'hook_coverage', 'retest_due'] as FindingKind[])
      .map((k) => finding(k, 0.8))
    expect(select(findings, [], NOW)).toHaveLength(DEFAULT_FINDING_COUNT)
  })

  it('SPEC §14.1: the count is a parameter, not a constant', () => {
    const findings = (['leech', 'reading_lag', 'commitment_gap'] as FindingKind[]).map((k) => finding(k, 0.8))
    expect(select(findings, [], NOW, 1)).toHaveLength(1)
    expect(select(findings, [], NOW, 2)).toHaveLength(2)
  })

  it('drops findings with zero confidence — absent data must never speak', () => {
    expect(select([finding('leech', 0.9, 0)], [], NOW)).toEqual([])
  })

  it('ranks by magnitude x confidence x novelty', () => {
    const strong = finding('leech', 0.9)
    const weak = finding('retest_due', 0.2)
    expect(select([weak, strong], [], NOW, 1)[0]!.kind).toBe('leech')
  })

  it('a hedged finding loses to a confident one of equal magnitude', () => {
    const sure = finding('leech', 0.6, 1.0)
    const unsure = finding('reading_lag', 0.6, 0.2)
    expect(select([unsure, sure], [], NOW, 1)[0]!.kind).toBe('leech')
  })

  it('demotes — but does NOT silence — a finding raised last week', () => {
    const stale = finding('leech', 0.9)
    const fresh = finding('retest_due', 0.5)
    const priors = [prior('leech', 1)]
    expect(select([stale, fresh], priors, NOW, 1)[0]!.kind).toBe('retest_due')
    expect(select([stale, fresh], priors, NOW, 2).map((f) => f.kind)).toContain('leech')
  })

  it('breaks a tie on priority band — Direct before Orient before Motivate', () => {
    const motivate = finding('retest_due', 0.5)
    const direct = finding('leech', 0.5)
    expect(select([motivate, direct], [], NOW, 1)[0]!.kind).toBe('leech')
  })

  it('stamps `since` from the prior so persistence is visible to the voice', () => {
    const priors = [prior('leech', 2, 40)]
    const out = select([finding('leech', 0.9)], priors, NOW, 1)
    expect(out[0]!.since).toBe(priors[0]!.since)
  })

  it('leaves `since` null for a genuinely new finding', () => {
    expect(select([finding('leech', 0.9)], [], NOW, 1)[0]!.since).toBeNull()
  })

  it('is deterministic — same input, same order, every call', () => {
    const findings = (['leech', 'reading_lag', 'commitment_gap'] as FindingKind[]).map((k) => finding(k, 0.5))
    const first = select(findings, [], NOW).map((f) => f.kind)
    for (let i = 0; i < 5; i++) {
      expect(select(findings, [], NOW).map((f) => f.kind)).toEqual(first)
    }
  })
})
