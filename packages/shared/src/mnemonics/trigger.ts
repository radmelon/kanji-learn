import {
  CHRONIC_LAPSE_THRESHOLD,
  HOOK_REINFORCE_MIN_AGE_MS,
  type BuddyMomentAction,
  type ReviewedCard,
} from './types'

const worstByLapses = (cards: ReviewedCard[]): ReviewedCard | undefined =>
  cards.reduce<ReviewedCard | undefined>(
    (worst, c) => (worst === undefined || c.lapses > worst.lapses ? c : worst),
    undefined,
  )

/**
 * Whether a hook is old enough that recalling it measures retention rather
 * than working memory.
 *
 * An absent or unparseable timestamp counts as old enough. The guard exists to
 * suppress a test that cannot be failed, not to withhold offers whenever the
 * client happens not to know a creation date — failing the other way would
 * silently disable the whole reinforce branch on any client that omits it.
 */
function hookIsSettled(card: ReviewedCard, now: Date): boolean {
  if (!card.hookCreatedAt) return true
  const created = Date.parse(card.hookCreatedAt)
  if (Number.isNaN(created)) return true
  return now.getTime() - created >= HOOK_REINFORCE_MIN_AGE_MS
}

/**
 * Picks at most one action for the post-session Buddy moment.
 * Reinforce (a hooked kanji that struggled today, whose hook has had time to
 * settle) outranks Create (a hookless, chronically-lapsing kanji that
 * struggled today).
 */
export function pickBuddyMomentAction(
  cards: ReviewedCard[],
  cooldownKanjiIds: number[] = [],
  now: Date = new Date(),
): BuddyMomentAction {
  // Hoisted above BOTH branches. It used to be built after the reinforce
  // lookup had already returned, so "Not now" on a reinforce offer did nothing
  // — and reinforce outranks create, making that the offer most likely to
  // repeat: a hook that keeps slipping keeps qualifying. Parent spec §11 draws
  // no create/reinforce distinction, so neither does this.
  const cooldown = new Set(cooldownKanjiIds)

  const reinforce = worstByLapses(
    cards.filter(
      (c) =>
        c.hasHook &&
        c.struggledToday &&
        !cooldown.has(c.kanjiId) &&
        // Freshness guard. Without it, building a hook for a kanji you just
        // graded Again made it eligible for its own reinforce challenge in the
        // same session — asking the learner to recall a story they wrote
        // minutes ago, and feeding that non-result into effectivenessScore.
        hookIsSettled(c, now),
    ),
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
