import { describe, it, expect } from 'vitest'
import { detectReadingLag } from './reading-lag'
import type { LearnerSnapshot, PlacementItemOutcome, QuizOutcome } from '../types'

function item(o: Partial<PlacementItemOutcome> = {}): PlacementItemOutcome {
  return {
    kanjiId: 1, character: '日',
    meaningCorrect: true, readingCorrect: true,
    readingOffset: 0.3, difficultyAtAsk: 0,
    ...o,
  }
}

function snap(items: PlacementItemOutcome[]): LearnerSnapshot {
  return {
    now: '2026-08-02T00:00:00.000Z',
    placement: {
      theta: 0, se: 0.4, completedAt: '2026-08-01T00:00:00.000Z',
      level: 'N3', thetaLow: -0.5, thetaHigh: 0.5, levelLow: 'N4', levelHigh: 'N3',
      previous: null, items,
    },
    reviews: { cards: [], quiz: [] },
    commitment: null,
    hooks: { count: 0, latestAt: null, sessionDates: [], lapsesWithHook: null, lapsesWithoutHook: null },
    priorFindings: [],
  }
}

describe('detectReadingLag', () => {
  it('returns null with no placement at all', () => {
    const s = snap([])
    s.placement = null
    expect(detectReadingLag(s)).toBeNull()
  })

  it('returns null when no item had its reading half asked', () => {
    expect(detectReadingLag(snap([item({ readingCorrect: null })]))).toBeNull()
  })

  it('THE CORE CASE: no finding when the gap is only the population baseline', () => {
    // Readings 3 points better than meanings, i.e. right on
    // POPULATION_PLACEMENT_READING_GAP (-0.033). Excess ~0, no finding.
    const items = [
      ...Array.from({ length: 97 }, (_, i) => item({ kanjiId: i, meaningCorrect: true, readingCorrect: true })),
      ...Array.from({ length: 3 }, (_, i) => item({ kanjiId: 100 + i, meaningCorrect: false, readingCorrect: true })),
    ]
    expect(detectReadingLag(snap(items))).toBeNull()
  })

  it('fires when readings trail by MORE than the population offset', () => {
    const items = [
      ...Array.from({ length: 3 }, (_, i) => item({ kanjiId: i, readingCorrect: true })),
      ...Array.from({ length: 7 }, (_, i) => item({ kanjiId: 100 + i, readingCorrect: false })),
    ]
    const f = detectReadingLag(snap(items))!
    expect(f).not.toBeNull()
    expect(f.kind).toBe('reading_lag')
    expect(f.magnitude).toBeGreaterThan(0)
    expect(f.confidence).toBeGreaterThan(0)
  })

  it('never fires when readings BEAT meanings', () => {
    const items = [
      item({ kanjiId: 1, meaningCorrect: false, readingCorrect: true }),
      item({ kanjiId: 2, meaningCorrect: false, readingCorrect: true }),
      item({ kanjiId: 3, meaningCorrect: true, readingCorrect: true }),
    ]
    expect(detectReadingLag(snap(items))).toBeNull()
  })

  it('carries the two accuracies and the offset as evidence, already labelled', () => {
    const items = [
      ...Array.from({ length: 2 }, (_, i) => item({ kanjiId: i, readingCorrect: true })),
      ...Array.from({ length: 8 }, (_, i) => item({ kanjiId: 100 + i, readingCorrect: false })),
    ]
    const f = detectReadingLag(snap(items))!
    const labels = f.evidence.map((e) => e.label)
    expect(labels).toContain('meaning accuracy')
    expect(labels).toContain('reading accuracy')
    expect(labels).toContain('expected reading penalty')
  })

  it('hedges on thin data — 3 items is far less confident than 30', () => {
    const thin = [
      item({ kanjiId: 1, readingCorrect: false }),
      item({ kanjiId: 2, readingCorrect: false }),
      item({ kanjiId: 3, readingCorrect: false }),
    ]
    const thick = Array.from({ length: 30 }, (_, i) => item({ kanjiId: i, readingCorrect: false }))
    expect(detectReadingLag(snap(thin))!.confidence)
      .toBeLessThan(detectReadingLag(snap(thick))!.confidence)
  })
})

// ─── Quiz evidence (spec §3's second source) ─────────────────────────────────

function quiz(questionType: string, correct: boolean, i = 0): QuizOutcome {
  return { kanjiId: i, questionType, correct, answeredAt: '2026-08-01T00:00:00.000Z' }
}

/** n reading answers and m meaning answers, at the given accuracies. */
function quizRows(readingN: number, readingAcc: number, meaningN: number, meaningAcc: number): QuizOutcome[] {
  const out: QuizOutcome[] = []
  for (let i = 0; i < readingN; i++) out.push(quiz('reading_recall', i < Math.round(readingN * readingAcc), i))
  for (let i = 0; i < meaningN; i++) out.push(quiz('meaning_recall', i < Math.round(meaningN * meaningAcc), 1000 + i))
  return out
}

function quizSnap(rows: QuizOutcome[]): LearnerSnapshot {
  const s = snap([])
  s.placement = null
  s.reviews.quiz = rows
  return s
}

describe('detectReadingLag — quiz evidence', () => {
  it('fires with NO placement at all, on quiz rows alone', () => {
    // The old version returned null here, throwing away 2,204 live rows in
    // favour of a ~13-item test the learner may never have taken.
    const f = detectReadingLag(quizSnap(quizRows(40, 0.4, 40, 0.95)))
    expect(f).not.toBeNull()
    expect(f!.kind).toBe('reading_lag')
  })

  it('does NOT fire when the quiz gap is only the population gap', () => {
    // meaning 0.90, reading 0.827 → gap 0.073, exactly POPULATION_QUIZ_READING_GAP.
    expect(detectReadingLag(quizSnap(quizRows(1000, 0.827, 1000, 0.90)))).toBeNull()
  })

  it('classifies vocab_reading as reading and kanji_from_meaning as meaning', () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => quiz('vocab_reading', false, i)),
      ...Array.from({ length: 20 }, (_, i) => quiz('kanji_from_meaning', true, 100 + i)),
    ]
    const f = detectReadingLag(quizSnap(rows))!
    expect(f).not.toBeNull()
    expect(f.evidence.find((e) => e.label === 'quiz reading answers')!.value).toBe(20)
  })

  it('ignores question types that are neither side', () => {
    const rows = Array.from({ length: 30 }, (_, i) => quiz('kunyomi_voice', false, i))
    expect(detectReadingLag(quizSnap(rows))).toBeNull()
  })

  it('needs both sides — reading answers with no meaning answers prove nothing', () => {
    expect(detectReadingLag(quizSnap(quizRows(30, 0.2, 0, 0)))).toBeNull()
  })

  it('is MORE confident with both sources than with either alone', () => {
    const placementOnly = snap([
      ...Array.from({ length: 2 }, (_, i) => item({ kanjiId: i, readingCorrect: true })),
      ...Array.from({ length: 8 }, (_, i) => item({ kanjiId: 100 + i, readingCorrect: false })),
    ])
    const quizOnly = quizSnap(quizRows(40, 0.4, 40, 0.95))
    const both = snap(placementOnly.placement!.items)
    both.reviews.quiz = quizRows(40, 0.4, 40, 0.95)

    expect(detectReadingLag(both)!.confidence)
      .toBeGreaterThan(detectReadingLag(placementOnly)!.confidence)
    expect(detectReadingLag(both)!.confidence)
      .toBeGreaterThan(detectReadingLag(quizOnly)!.confidence)
  })

  it('reports both sources in evidence so the voice can say which it saw', () => {
    const both = snap([
      ...Array.from({ length: 2 }, (_, i) => item({ kanjiId: i, readingCorrect: true })),
      ...Array.from({ length: 8 }, (_, i) => item({ kanjiId: 100 + i, readingCorrect: false })),
    ])
    both.reviews.quiz = quizRows(40, 0.4, 40, 0.95)
    const labels = detectReadingLag(both)!.evidence.map((e) => e.label)
    expect(labels).toContain('items with a reading asked')
    expect(labels).toContain('quiz reading answers')
  })
})
