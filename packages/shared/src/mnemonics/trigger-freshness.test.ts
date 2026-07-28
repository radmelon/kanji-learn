import { describe, it, expect } from 'vitest'
import { pickBuddyMomentAction } from './trigger'
import type { ReviewedCard } from './types'

/**
 * The reinforce freshness guard (owner decision, 2026-07-28).
 *
 * Observed on-device in B144: the owner built a hook mid-session and the
 * reinforce challenge fired on that same hook at Session Complete minutes
 * later, asking them to recall a story they had just written.
 *
 * Same class of flaw as the immediate quick-check deleted the same day
 * (B-218) — a test with no failure mode, run so soon after creation that it
 * measures nothing, and whose result still feeds effectivenessScore.
 */

const NOW = new Date('2026-07-28T20:00:00Z')

const card = (over: Partial<ReviewedCard>): ReviewedCard => ({
  kanjiId: 1,
  kanji: '暗',
  struggledToday: true,
  lapses: 5,
  hasHook: true,
  ...over,
})

describe('reinforce freshness guard', () => {
  it('does not challenge a hook built minutes ago', () => {
    const fresh = card({ hookCreatedAt: '2026-07-28T19:56:00Z' })
    expect(pickBuddyMomentAction([fresh], [], NOW)).toEqual({ kind: 'none' })
  })

  it('challenges a hook built yesterday', () => {
    const settled = card({ hookCreatedAt: '2026-07-27T19:00:00Z' })
    expect(pickBuddyMomentAction([settled], [], NOW)).toEqual({ kind: 'reinforce', kanjiId: 1 })
  })

  it('treats exactly 24h as settled', () => {
    const boundary = card({ hookCreatedAt: '2026-07-27T20:00:00Z' })
    expect(pickBuddyMomentAction([boundary], [], NOW)).toEqual({ kind: 'reinforce', kanjiId: 1 })
  })

  it('treats an absent timestamp as old enough', () => {
    // An older client omits the field. Failing the other way would silently
    // disable the entire reinforce branch on every build in the wild.
    expect(pickBuddyMomentAction([card({})], [], NOW)).toEqual({ kind: 'reinforce', kanjiId: 1 })
  })

  it('treats an unparseable timestamp as old enough', () => {
    const bad = card({ hookCreatedAt: 'not-a-date' })
    expect(pickBuddyMomentAction([bad], [], NOW)).toEqual({ kind: 'reinforce', kanjiId: 1 })
  })

  it('skips a fresh hook in favour of a settled one', () => {
    const freshWorse = card({ kanjiId: 1, hookCreatedAt: '2026-07-28T19:56:00Z', lapses: 9 })
    const settled = card({ kanjiId: 2, hookCreatedAt: '2026-07-20T10:00:00Z', lapses: 4 })
    // Worst-by-lapses would pick 1; the guard removes it from the pool first.
    expect(pickBuddyMomentAction([freshWorse, settled], [], NOW)).toEqual({
      kind: 'reinforce',
      kanjiId: 2,
    })
  })

  it('still offers to create a hook for a different kanji', () => {
    // The fresh hook is out of the reinforce pool; that must not suppress an
    // unrelated create offer, which is a different kanji entirely.
    const freshHook = card({ kanjiId: 1, hookCreatedAt: '2026-07-28T19:56:00Z' })
    const hookless = card({ kanjiId: 2, hasHook: false, lapses: 4, hookCreatedAt: undefined })
    expect(pickBuddyMomentAction([freshHook, hookless], [], NOW)).toEqual({
      kind: 'create',
      kanjiId: 2,
    })
  })

  it('leaves the cooldown behaviour intact', () => {
    const settled = card({ hookCreatedAt: '2026-07-20T10:00:00Z' })
    expect(pickBuddyMomentAction([settled], [1], NOW)).toEqual({ kind: 'none' })
  })
})
