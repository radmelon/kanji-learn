import { describe, it, expect } from 'vitest'
import { detectLeech } from './leech'
import type { CardSnapshot, LearnerSnapshot } from '../types'

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

function snap(cards: CardSnapshot[]): LearnerSnapshot {
  return {
    now: '2026-08-02T00:00:00.000Z',
    placement: null,
    reviews: { cards, quiz: [] },
    commitment: null,
    hooks: { count: 0, latestAt: null, sessionDates: [], lapsesWithHook: null, lapsesWithoutHook: null },
    priorFindings: [],
  }
}

describe('detectLeech', () => {
  it('returns null with no cards', () => {
    expect(detectLeech(snap([]))).toBeNull()
  })

  it('returns null when nothing has lapsed at all', () => {
    expect(detectLeech(snap([card(), card({ kanjiId: 2 })]))).toBeNull()
  })

  /**
   * THE CASE THAT KILLED THE FIRST VERSION. Live data has a maximum of 4
   * lapses on one card and zero regressions ever, so `lapses >= 4` fired for
   * nobody. A single lapsed card in a small deck must register.
   */
  it('fires on ONE lapsed card when the deck is small — relative, not absolute', () => {
    const cards = [card({ kanjiId: 1, character: '難', lapses: 1 }), card({ kanjiId: 2 }), card({ kanjiId: 3 })]
    const f = detectLeech(snap(cards))!
    expect(f).not.toBeNull()
    expect(f.kind).toBe('leech')
  })

  it('stays quiet when trouble is a negligible share of a large deck', () => {
    // 1 troubled card in 200 = 0.5%, below TROUBLE_FLOOR (2%).
    const cards = [
      card({ kanjiId: 1, lapses: 3 }),
      ...Array.from({ length: 199 }, (_, i) => card({ kanjiId: 100 + i })),
    ]
    expect(detectLeech(snap(cards))).toBeNull()
  })

  it('scales with the FRACTION of the deck in trouble, not the raw count', () => {
    const smallDeckBadly = snap([
      ...Array.from({ length: 5 }, (_, i) => card({ kanjiId: i, lapses: 2 })),
      ...Array.from({ length: 15 }, (_, i) => card({ kanjiId: 100 + i })),
    ]) // 25%
    const bigDeckMildly = snap([
      ...Array.from({ length: 5 }, (_, i) => card({ kanjiId: i, lapses: 2 })),
      ...Array.from({ length: 495 }, (_, i) => card({ kanjiId: 100 + i })),
    ]) // 1%
    expect(detectLeech(smallDeckBadly)!.magnitude)
      .toBeGreaterThan(detectLeech(bigDeckMildly)?.magnitude ?? 0)
  })

  it('counts a remembered→learning regression as trouble too', () => {
    const cards = [card({ kanjiId: 9, character: '難', regressions: 1 }), card({ kanjiId: 2 }), card({ kanjiId: 3 })]
    expect(detectLeech(snap(cards))).not.toBeNull()
  })

  it('names the worst offenders, worst first, capped at 3', () => {
    const cards = [
      card({ kanjiId: 1, character: '一', lapses: 1 }),
      card({ kanjiId: 2, character: '二', lapses: 4 }),
      card({ kanjiId: 3, character: '三', lapses: 3 }),
      card({ kanjiId: 4, character: '四', lapses: 2 }),
    ]
    const named = detectLeech(snap(cards))!.evidence.filter((e) => e.character !== undefined)
    expect(named).toHaveLength(3)
    expect(named[0]!.character).toBe('二')
    expect(named[1]!.character).toBe('三')
  })

  it('ignores burned and unseen cards in BOTH the numerator and the denominator', () => {
    expect(detectLeech(snap([card({ lapses: 8, status: 'burned' })]))).toBeNull()
    expect(detectLeech(snap([card({ lapses: 8, status: 'unseen' })]))).toBeNull()
  })

  it('is deterministic on a tie', () => {
    const cards = [
      card({ kanjiId: 7, character: '七', lapses: 2 }),
      card({ kanjiId: 3, character: '三', lapses: 2 }),
      card({ kanjiId: 9 }),
    ]
    const first = detectLeech(snap(cards))!.evidence.filter((e) => e.character).map((e) => e.character)
    for (let i = 0; i < 3; i++) {
      expect(detectLeech(snap(cards))!.evidence.filter((e) => e.character).map((e) => e.character)).toEqual(first)
    }
  })
})
