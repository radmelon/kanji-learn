import { describe, it, expect } from 'vitest'
import { detectHookCoverage, pickHookCandidate } from './hook-coverage'
import type { CardSnapshot, HookSnapshot, LearnerSnapshot, QuizOutcome } from '../types'

function card(o: Partial<CardSnapshot> = {}): CardSnapshot {
  return {
    kanjiId: 1, character: '日', status: 'reviewing',
    lapses: 0, readingStage: null, regressions: 0,
    responseMsEarly: null, responseMsLate: null,
    accuracyEarly: null, accuracyLate: null,
    recentQualities: [], hasCoCreatedHook: false,
    ...o,
  }
}

const NO_HOOKS: HookSnapshot = {
  count: 0, latestAt: null, sessionDates: [], lapsesWithHook: null, lapsesWithoutHook: null,
}

function snap(hooks: Partial<HookSnapshot>, cards: CardSnapshot[] = [], quiz: QuizOutcome[] = []): LearnerSnapshot {
  return {
    now: '2026-08-02T00:00:00.000Z',
    placement: null,
    reviews: { cards, quiz },
    commitment: null,
    hooks: { ...NO_HOOKS, ...hooks },
    priorFindings: [],
  }
}

const STRUGGLING = card({ kanjiId: 42, character: '難', recentQualities: [1, 1, 3, 1] })

describe('detectHookCoverage — trigger', () => {
  it('fires when the learner has no hooks at all', () => {
    const f = detectHookCoverage(snap({ count: 0 }, [STRUGGLING]))!
    expect(f.kind).toBe('hook_coverage')
  })

  it('THE HALF A ZERO-CHECK MISSES: fires when none is newer than the session-before-last', () => {
    const f = detectHookCoverage(snap({
      count: 3,
      latestAt: '2026-06-01T00:00:00.000Z',
      sessionDates: ['2026-08-01T00:00:00.000Z', '2026-07-25T00:00:00.000Z', '2026-07-18T00:00:00.000Z'],
    }, [STRUGGLING]))!
    expect(f).not.toBeNull()
    expect(f.kind).toBe('hook_coverage')
  })

  it('stays quiet when a hook was built since the session-before-last', () => {
    expect(detectHookCoverage(snap({
      count: 3,
      latestAt: '2026-07-28T00:00:00.000Z',
      sessionDates: ['2026-08-01T00:00:00.000Z', '2026-07-25T00:00:00.000Z', '2026-07-18T00:00:00.000Z'],
    }, [STRUGGLING]))).toBeNull()
  })

  it('stays quiet with hooks and fewer than two sessions to judge against', () => {
    expect(detectHookCoverage(snap({
      count: 2,
      latestAt: '2026-06-01T00:00:00.000Z',
      sessionDates: ['2026-08-01T00:00:00.000Z'],
    }, [STRUGGLING]))).toBeNull()
  })

  it('returns null when there is no struggling kanji to offer — an offer needs a subject', () => {
    expect(detectHookCoverage(snap({ count: 0 }, [card({ recentQualities: [4, 5, 4] })]))).toBeNull()
  })
})

describe('detectHookCoverage — the offer', () => {
  it('names a specific kanji', () => {
    const f = detectHookCoverage(snap({ count: 0 }, [STRUGGLING]))!
    const target = f.evidence.find((e) => e.label === 'suggested kanji')!
    expect(target.character).toBe('難')
    expect(target.kanjiId).toBe(42)
  })

  it('carries the hooks-help evidence when both groups exist', () => {
    const f = detectHookCoverage(snap({
      count: 0, lapsesWithHook: 1.2, lapsesWithoutHook: 3.4,
    }, [STRUGGLING]))!
    const labels = f.evidence.map((e) => e.label)
    expect(labels).toContain('average lapses with a hook')
    expect(labels).toContain('average lapses without one')
  })

  it('omits the comparison rather than inventing it when a group is empty', () => {
    const f = detectHookCoverage(snap({ count: 0, lapsesWithHook: null, lapsesWithoutHook: 3.4 }, [STRUGGLING]))!
    expect(f.evidence.map((e) => e.label)).not.toContain('average lapses with a hook')
  })
})

describe('pickHookCandidate', () => {
  it('returns null when nothing is struggling', () => {
    expect(pickHookCandidate([card({ recentQualities: [4, 5, 5] })], [])).toBeNull()
  })

  it('prefers the kanji with the most Again/Hard grades', () => {
    const cards = [
      card({ kanjiId: 1, character: '一', recentQualities: [1, 4, 4] }),
      card({ kanjiId: 2, character: '二', recentQualities: [1, 1, 1, 3] }),
    ]
    expect(pickHookCandidate(cards, [])!.character).toBe('二')
  })

  it('counts repeated quiz failures too', () => {
    const cards = [
      card({ kanjiId: 1, character: '一', recentQualities: [1, 4] }),
      card({ kanjiId: 2, character: '二', recentQualities: [1, 4] }),
    ]
    const quiz: QuizOutcome[] = [
      { kanjiId: 2, questionType: 'meaning_recall', correct: false, answeredAt: '2026-08-01T00:00:00.000Z' },
      { kanjiId: 2, questionType: 'meaning_recall', correct: false, answeredAt: '2026-07-30T00:00:00.000Z' },
    ]
    expect(pickHookCandidate(cards, quiz)!.character).toBe('二')
  })

  it('never offers a kanji that already has a hook', () => {
    const cards = [card({ kanjiId: 1, character: '一', recentQualities: [1, 1, 1], hasCoCreatedHook: true })]
    expect(pickHookCandidate(cards, [])).toBeNull()
  })

  it('is deterministic on a tie — same input, same kanji, every call', () => {
    const cards = [
      card({ kanjiId: 7, character: '七', recentQualities: [1, 1] }),
      card({ kanjiId: 3, character: '三', recentQualities: [1, 1] }),
    ]
    const first = pickHookCandidate(cards, [])!.kanjiId
    for (let i = 0; i < 5; i++) expect(pickHookCandidate(cards, [])!.kanjiId).toBe(first)
  })
})
