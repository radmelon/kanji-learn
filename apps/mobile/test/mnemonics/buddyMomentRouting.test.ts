import { pickBuddyMomentAction, type ReviewedCard } from '@kanji-learn/shared'

/**
 * Pins the contract study.tsx's handleFinish depends on. The screen branches
 * on `action.kind` and renders a different sheet per branch, so a change in
 * precedence here silently changes which sheet a learner sees.
 */
const card = (over: Partial<ReviewedCard>): ReviewedCard => ({
  kanjiId: 1, kanji: '持', lapses: 0, hasHook: false, struggledToday: false, ...over,
})

describe('pickBuddyMomentAction — the branch study.tsx renders on', () => {
  it('reinforce outranks create', () => {
    // Both qualify; reinforce must win (parent spec §4.1). If this flips, a
    // learner with a failing hook gets asked to build a second one instead of
    // being helped with the first.
    expect(
      pickBuddyMomentAction([
        card({ kanjiId: 1, hasHook: true, struggledToday: true, lapses: 5 }),
        card({ kanjiId: 2, kanji: '待', hasHook: false, struggledToday: true, lapses: 9 }),
      ]),
    ).toEqual({ kind: 'reinforce', kanjiId: 1 })
  })

  it('falls to create when no hooked kanji struggled', () => {
    expect(
      pickBuddyMomentAction([
        card({ kanjiId: 2, kanji: '待', hasHook: false, struggledToday: true, lapses: 9 }),
      ]),
    ).toEqual({ kind: 'create', kanjiId: 2 })
  })

  it('offers nothing when nothing struggled', () => {
    expect(
      pickBuddyMomentAction([card({ kanjiId: 2, hasHook: false, lapses: 9 })]),
    ).toEqual({ kind: 'none' })
  })

  it('create requires chronic lapses, not just one bad day', () => {
    // A kanji that slipped once is not yet worth interrupting for.
    expect(
      pickBuddyMomentAction([card({ kanjiId: 2, struggledToday: true, lapses: 1 })]),
    ).toEqual({ kind: 'none' })
  })

  it('reinforce does NOT require chronic lapses — the hook itself is the signal', () => {
    expect(
      pickBuddyMomentAction([
        card({ kanjiId: 1, hasHook: true, struggledToday: true, lapses: 0 }),
      ]),
    ).toEqual({ kind: 'reinforce', kanjiId: 1 })
  })

  it('picks the worst offender when several qualify', () => {
    expect(
      pickBuddyMomentAction([
        card({ kanjiId: 2, kanji: '待', struggledToday: true, lapses: 4 }),
        card({ kanjiId: 3, kanji: '寺', struggledToday: true, lapses: 11 }),
      ]),
    ).toEqual({ kind: 'create', kanjiId: 3 })
  })

  it('returns none for an empty session', () => {
    expect(pickBuddyMomentAction([])).toEqual({ kind: 'none' })
  })
})
