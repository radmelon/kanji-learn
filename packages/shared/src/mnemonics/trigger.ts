import { CHRONIC_LAPSE_THRESHOLD, type BuddyMomentAction, type ReviewedCard } from './types'

const worstByLapses = (cards: ReviewedCard[]): ReviewedCard | undefined =>
  cards.reduce<ReviewedCard | undefined>(
    (worst, c) => (worst === undefined || c.lapses > worst.lapses ? c : worst),
    undefined,
  )

/**
 * Picks at most one action for the post-session Buddy moment.
 * Reinforce (a hooked kanji that struggled today) outranks Create
 * (a hookless, chronically-lapsing kanji that struggled today).
 */
export function pickBuddyMomentAction(
  cards: ReviewedCard[],
  cooldownKanjiIds: number[] = [],
): BuddyMomentAction {
  const reinforce = worstByLapses(cards.filter((c) => c.hasHook && c.struggledToday))
  if (reinforce) return { kind: 'reinforce', kanjiId: reinforce.kanjiId }

  const cooldown = new Set(cooldownKanjiIds)
  const create = worstByLapses(
    cards.filter(
      (c) =>
        !c.hasHook &&
        c.struggledToday &&
        c.lapses >= CHRONIC_LAPSE_THRESHOLD &&
        !cooldown.has(c.kanjiId),
    ),
  )
  if (create) return { kind: 'create', kanjiId: create.kanjiId }

  return { kind: 'none' }
}
