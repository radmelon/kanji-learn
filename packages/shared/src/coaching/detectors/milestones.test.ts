import { describe, it, expect } from 'vitest'
import { detectHardestCleared, detectRetestDue } from './milestones'
import type { LearnerSnapshot, PlacementItemOutcome, PlacementSnapshot } from '../types'
import { EVIDENCE_LABELS } from '../types'

function item(o: Partial<PlacementItemOutcome> = {}): PlacementItemOutcome {
  return {
    kanjiId: 1, character: '日',
    meaningCorrect: true, readingCorrect: true,
    readingOffset: 0.3, difficultyAtAsk: 0,
    strokeCount: 4, readingCount: 2,
    ...o,
  }
}

function placement(o: Partial<PlacementSnapshot> = {}): PlacementSnapshot {
  return {
    theta: 0.4, se: 0.3, completedAt: '2026-08-01T00:00:00.000Z',
    level: 'N3', thetaLow: -0.1, thetaHigh: 0.9, levelLow: 'N4', levelHigh: 'N3',
    previous: null, items: [],
    ...o,
  }
}

function snap(p: PlacementSnapshot | null, now = '2026-08-02T00:00:00.000Z'): LearnerSnapshot {
  return {
    now,
    placement: p,
    reviews: { cards: [], quiz: [], windowDays: 30 },
    commitment: null,
    hooks: { count: 0, latestAt: null, sessionDates: [], lapsesWithHook: null, lapsesWithoutHook: null },
    priorFindings: [],
  }
}

describe('detectHardestCleared', () => {
  it('returns null with no placement', () => {
    expect(detectHardestCleared(snap(null))).toBeNull()
  })

  it('returns null when nothing was answered correctly', () => {
    expect(detectHardestCleared(snap(placement({
      items: [item({ meaningCorrect: false, difficultyAtAsk: 1.5 })],
    })))).toBeNull()
  })

  it('names the hardest item answered correctly', () => {
    const f = detectHardestCleared(snap(placement({
      items: [
        item({ kanjiId: 1, character: '一', difficultyAtAsk: -1 }),
        item({ kanjiId: 2, character: '鬱', difficultyAtAsk: 2.1 }),
        item({ kanjiId: 3, character: '三', difficultyAtAsk: 0.2 }),
      ],
    })))!
    const named = f.evidence.find((e) => e.character !== undefined)!
    expect(named.character).toBe('鬱')
  })

  it('ignores a hard item that was answered WRONG', () => {
    const f = detectHardestCleared(snap(placement({
      items: [
        item({ kanjiId: 1, character: '易', difficultyAtAsk: 0.1 }),
        item({ kanjiId: 2, character: '鬱', difficultyAtAsk: 2.5, meaningCorrect: false }),
      ],
    })))!
    expect(f.evidence.find((e) => e.character !== undefined)!.character).toBe('易')
  })

  it('scales with how hard the cleared item was', () => {
    const easy = detectHardestCleared(snap(placement({ items: [item({ difficultyAtAsk: -1 })] })))
    const hard = detectHardestCleared(snap(placement({ items: [item({ difficultyAtAsk: 2.5 })] })))!
    expect(hard.magnitude).toBeGreaterThan(easy?.magnitude ?? 0)
  })

  // MUTATION CAUGHT: omitting the features that justify calling the item hard.
  // Their absence is why a bare superlative invites a JLPT lookup that makes
  // Buddy look wrong: the owner's hardest-cleared was N3 and outranked two N2
  // kanji, because the model weighs strokes and readings too.
  it('carries stroke count, reading count and the test date', () => {
    const f = detectHardestCleared(snap(placement({
      completedAt: '2026-07-29T00:00:00.000Z',
      items: [item({ strokeCount: 19, readingCount: 3, difficultyAtAsk: 1.5 })],
    })))!
    expect(f.evidence).toContainEqual({ label: EVIDENCE_LABELS.STROKE_COUNT, value: 19 })
    expect(f.evidence).toContainEqual({ label: EVIDENCE_LABELS.READING_COUNT, value: 3 })
    expect(f.evidence).toContainEqual({ label: EVIDENCE_LABELS.MEASURED_ON, value: '2026-07-29' })
  })
})

describe('detectRetestDue', () => {
  it('returns null with no placement', () => {
    expect(detectRetestDue(snap(null))).toBeNull()
  })

  it('stays quiet on a fresh, tight estimate', () => {
    expect(detectRetestDue(snap(
      placement({ se: 0.25, completedAt: '2026-08-01T00:00:00.000Z' }),
      '2026-08-02T00:00:00.000Z',
    ))).toBeNull()
  })

  it('fires once the estimate has decayed with time', () => {
    const f = detectRetestDue(snap(
      placement({ se: 0.4, completedAt: '2026-01-01T00:00:00.000Z' }),
      '2026-08-02T00:00:00.000Z',
    ))!
    expect(f.kind).toBe('retest_due')
    expect(f.magnitude).toBeGreaterThan(0)
  })

  it('grows the longer the estimate goes unrefreshed', () => {
    const older = detectRetestDue(snap(placement({ se: 0.4, completedAt: '2025-08-01T00:00:00.000Z' }), '2026-08-02T00:00:00.000Z'))!
    const newer = detectRetestDue(snap(placement({ se: 0.4, completedAt: '2026-02-01T00:00:00.000Z' }), '2026-08-02T00:00:00.000Z'))!
    expect(older.magnitude).toBeGreaterThan(newer.magnitude)
  })

  it('reports the widened interval, not the stale stored one', () => {
    const f = detectRetestDue(snap(placement({ se: 0.4, completedAt: '2026-01-01T00:00:00.000Z' }), '2026-08-02T00:00:00.000Z'))!
    const widened = f.evidence.find((e) => e.label === 'current uncertainty')!
    expect(Number(widened.value)).toBeGreaterThan(0.4)
  })

  it('is always fully confident — this is arithmetic on our own estimate', () => {
    const f = detectRetestDue(snap(placement({ se: 0.4, completedAt: '2026-01-01T00:00:00.000Z' }), '2026-08-02T00:00:00.000Z'))!
    expect(f.confidence).toBe(1)
  })
})
