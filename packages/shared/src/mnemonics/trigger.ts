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
  // Hoisted above BOTH branches. It used to be built after the reinforce
  // lookup had already returned, so "Not now" on a reinforce offer did nothing
  // — and reinforce outranks create, making that the offer most likely to
  // repeat: a hook that keeps slipping keeps qualifying. Parent spec §11 draws
  // no create/reinforce distinction, so neither does this.
  const cooldown = new Set(cooldownKanjiIds)

  const reinforce = worstByLapses(
    cards.filter((c) => c.hasHook && c.struggledToday && !cooldown.has(c.kanjiId)),
  )
  if (reinforce) return { kind: 'reinforce', kanjiId: reinforce.kanjiId }

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
