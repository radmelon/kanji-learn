import { describe, it, expect } from 'vitest'
import { pickBuddyMomentAction } from './trigger'
import type { ReviewedCard } from './types'

const card = (over: Partial<ReviewedCard>): ReviewedCard => ({
  kanjiId: 1,
  kanji: '一',
  struggledToday: false,
  lapses: 0,
  hasHook: false,
  ...over,
})

describe('pickBuddyMomentAction', () => {
  it('returns none when nothing struggled', () => {
    expect(pickBuddyMomentAction([card({ struggledToday: false, lapses: 9 })])).toEqual({ kind: 'none' })
  })

  it('reinforces a hooked kanji that struggled today', () => {
    const cards = [card({ kanjiId: 10, struggledToday: true, hasHook: true, lapses: 1 })]
    expect(pickBuddyMomentAction(cards)).toEqual({ kind: 'reinforce', kanjiId: 10 })
  })

  it('reinforce outranks create even when the create candidate lapses more', () => {
    const cards = [
      card({ kanjiId: 10, struggledToday: true, hasHook: true, lapses: 1 }), // reinforce
      card({ kanjiId: 20, struggledToday: true, hasHook: false, lapses: 8 }), // create
    ]
    expect(pickBuddyMomentAction(cards)).toEqual({ kind: 'reinforce', kanjiId: 10 })
  })

  it('creates for a hookless chronic kanji that struggled today', () => {
    const cards = [card({ kanjiId: 20, struggledToday: true, hasHook: false, lapses: 4 })]
    expect(pickBuddyMomentAction(cards)).toEqual({ kind: 'create', kanjiId: 20 })
  })

  it('does NOT create when lapses are below the chronic threshold', () => {
    const cards = [card({ kanjiId: 20, struggledToday: true, hasHook: false, lapses: 2 })]
    expect(pickBuddyMomentAction(cards)).toEqual({ kind: 'none' })
  })

  it('picks the single worst (highest lapses) among create candidates', () => {
    const cards = [
      card({ kanjiId: 20, struggledToday: true, hasHook: false, lapses: 4 }),
      card({ kanjiId: 21, struggledToday: true, hasHook: false, lapses: 7 }),
    ]
    expect(pickBuddyMomentAction(cards)).toEqual({ kind: 'create', kanjiId: 21 })
  })

  it('picks the worst (highest lapses) among multiple reinforce candidates', () => {
    const cards = [
      card({ kanjiId: 10, struggledToday: true, hasHook: true, lapses: 2 }),
      card({ kanjiId: 11, struggledToday: true, hasHook: true, lapses: 5 }),
      card({ kanjiId: 12, struggledToday: true, hasHook: true, lapses: 3 }),
    ]
    expect(pickBuddyMomentAction(cards)).toEqual({ kind: 'reinforce', kanjiId: 11 })
  })

  it('returns none when cards array is empty', () => {
    expect(pickBuddyMomentAction([])).toEqual({ kind: 'none' })
  })

  it('excludes create candidates in the cooldown set', () => {
    const cards = [card({ kanjiId: 21, struggledToday: true, hasHook: false, lapses: 7 })]
    expect(pickBuddyMomentAction(cards, [21])).toEqual({ kind: 'none' })
  })
})
