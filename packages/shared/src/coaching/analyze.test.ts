import { describe, it, expect } from 'vitest'
import { analyze } from './analyze'
import { templateCopy } from './copy'
import { FINDING_PRIORITY, type FindingKind, type LearnerSnapshot } from './types'

const ALL_KINDS = Object.keys(FINDING_PRIORITY) as FindingKind[]

const EMPTY: LearnerSnapshot = {
  now: '2026-08-02T00:00:00.000Z',
  placement: null,
  reviews: { cards: [], quiz: [] },
  commitment: null,
  hooks: { count: 0, latestAt: null, sessionDates: [], lapsesWithHook: null, lapsesWithoutHook: null },
  priorFindings: [],
}

describe('analyze', () => {
  it('THE §10 INVARIANT: absent data produces no finding with confidence > 0', () => {
    for (const f of analyze(EMPTY)) {
      expect(f.confidence).toBe(0)
    }
    expect(analyze(EMPTY)).toEqual([])
  })

  it('returns at most the requested count', () => {
    const rich: LearnerSnapshot = {
      ...EMPTY,
      placement: {
        theta: 0.9, se: 0.9, completedAt: '2026-01-01T00:00:00.000Z',
        level: 'N2', thetaLow: 0, thetaHigh: 1.8, levelLow: 'N3', levelHigh: 'N1',
        previous: { theta: 0.1, se: 0.3, completedAt: '2025-11-01T00:00:00.000Z' },
        items: [
          { kanjiId: 1, character: '鬱', meaningCorrect: true, readingCorrect: false, readingOffset: 0.1, difficultyAtAsk: 2.2 },
          { kanjiId: 2, character: '日', meaningCorrect: true, readingCorrect: false, readingOffset: 0.1, difficultyAtAsk: 0.1 },
          { kanjiId: 3, character: '一', meaningCorrect: true, readingCorrect: false, readingOffset: 0.1, difficultyAtAsk: -0.5 },
        ],
      },
      commitment: { promisedMinutes: 70, actualMinutes: 5, periodStart: '2026-07-26T00:00:00.000Z', periodEnd: '2026-08-02T00:00:00.000Z' },
    }
    expect(analyze(rich, 2).length).toBeLessThanOrEqual(2)
    expect(analyze(rich, 2).length).toBeGreaterThan(0)
  })

  it('is deterministic', () => {
    const first = JSON.stringify(analyze(EMPTY))
    for (let i = 0; i < 3; i++) expect(JSON.stringify(analyze(EMPTY))).toBe(first)
  })

  it('never returns a magnitude or confidence outside 0..1', () => {
    const s: LearnerSnapshot = {
      ...EMPTY,
      commitment: { promisedMinutes: 1, actualMinutes: 0, periodStart: '2026-07-26T00:00:00.000Z', periodEnd: '2026-08-02T00:00:00.000Z' },
    }
    for (const f of analyze(s)) {
      expect(f.magnitude).toBeGreaterThanOrEqual(0)
      expect(f.magnitude).toBeLessThanOrEqual(1)
      expect(f.confidence).toBeGreaterThanOrEqual(0)
      expect(f.confidence).toBeLessThanOrEqual(1)
    }
  })
})

describe('templateCopy — the offline floor (spec §1)', () => {
  it('EVERY kind has copy. This is the non-negotiable one', () => {
    for (const kind of ALL_KINDS) {
      const text = templateCopy({ kind, magnitude: 0.5, confidence: 0.5, evidence: [], since: null })
      expect(text.length, `${kind} has no template copy`).toBeGreaterThan(0)
    }
  })

  it('hedges a low-confidence finding differently from a confident one', () => {
    const low = templateCopy({ kind: 'reading_lag', magnitude: 0.8, confidence: 0.1, evidence: [], since: null })
    const high = templateCopy({ kind: 'reading_lag', magnitude: 0.8, confidence: 0.95, evidence: [], since: null })
    expect(low).not.toBe(high)
  })

  it('escalates a finding that has been true for weeks (spec §4)', () => {
    const fresh = templateCopy({ kind: 'reading_lag', magnitude: 0.8, confidence: 0.9, evidence: [], since: null })
    const persistent = templateCopy({ kind: 'reading_lag', magnitude: 0.8, confidence: 0.9, evidence: [], since: '2026-06-01T00:00:00.000Z' })
    expect(persistent).not.toBe(fresh)
  })
})

/**
 * Sources are read through Vite's `?raw` glob rather than `fs` + `__dirname`.
 * `packages/shared` carries no `@types/node` — by design, it is a pure package
 * — so a filesystem walk here would pass under vitest and then fail
 * `pnpm typecheck`. This form needs no Node types, cannot drift from the
 * directory it lives in, and asserts over exactly the same file set.
 */
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: '?raw'; import: 'default'; eager: true },
    ): Record<string, string>
  }
}

const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }),
  ).filter(([path]) => !path.endsWith('.test.ts')),
)

describe('purity (global constraint)', () => {
  it('sees every non-test source in the directory', () => {
    // Guards the guard: an empty glob would make both checks below vacuous.
    expect(Object.keys(SOURCES).length).toBeGreaterThanOrEqual(12)
    expect(Object.keys(SOURCES)).toContain('./analyze.ts')
    expect(Object.keys(SOURCES)).toContain('./detectors/leech.ts')
  })

  it('imports nothing from apps/', () => {
    for (const [file, src] of Object.entries(SOURCES)) {
      expect(src, `${file} imports from apps/`).not.toMatch(/from ['"].*apps\//)
    }
  })

  it('reads no clock — time enters through snapshot.now', () => {
    for (const [file, src] of Object.entries(SOURCES)) {
      expect(src, `${file} calls Date.now()`).not.toMatch(/Date\.now\(\)/)
      expect(src, `${file} constructs an ambient date`).not.toMatch(/new Date\(\s*\)/)
    }
  })
})
