import type { CardSnapshot, Evidence, Finding, LearnerSnapshot, QuizOutcome } from '../types'
import { confidenceFromCount } from '../magnitude'

/**
 * Hook coverage — reframed by the owner on 2026-08-02 (spec §14.4).
 *
 * The spec originally asked how to PHRASE "you've built no hooks" so it
 * invites rather than scores. The owner's answer was not to say it at all:
 * the finding carries a NAMED KANJI the learner is actually failing and
 * becomes an offer to co-author a hook. That is why this is a Direct finding
 * (priority 1) and not a Motivate one — it changes behaviour and says what to
 * do next.
 *
 * TRIGGER, both halves:
 *   1. no hooks at all, OR
 *   2. none newer than the session-before-last — the learner who built three
 *      in week one and stopped, whom a pure zero-check never fires for.
 *
 * MAGNITUDE MAPPING (this kind's own scale, per §2): 1.0 with no hooks at all,
 * STALE_MAGNITUDE when hooks exist but have gone stale. A learner who has
 * never used the feature needs the offer more than one who has drifted.
 */
const NO_HOOKS_MAGNITUDE = 1
const STALE_MAGNITUDE = 0.6
/** Grades at or below this count as struggling — Again (1) and Hard (3). */
const STRUGGLE_QUALITY = 3
const MIN_STRUGGLE_SIGNALS = 2
const CONFIDENCE_SCALE = 10

/**
 * The kanji to offer. Ranked by struggle evidence: Again/Hard grades plus
 * failed quiz answers. Ties break on `kanjiId` so the same snapshot always
 * yields the same offer — a coach that suggests a different kanji each time
 * you reload is not a coach.
 */
export function pickHookCandidate(
  cards: CardSnapshot[],
  quiz: QuizOutcome[],
): CardSnapshot | null {
  const quizFailures = new Map<number, number>()
  for (const q of quiz) {
    if (q.correct) continue
    quizFailures.set(q.kanjiId, (quizFailures.get(q.kanjiId) ?? 0) + 1)
  }

  const scored = cards
    // Offering a hook for a kanji that already has one is not an offer.
    .filter((c) => !c.hasCoCreatedHook)
    .map((c) => ({
      card: c,
      score:
        c.recentQualities.filter((q) => q <= STRUGGLE_QUALITY).length +
        (quizFailures.get(c.kanjiId) ?? 0),
    }))
    .filter((s) => s.score >= MIN_STRUGGLE_SIGNALS)

  if (scored.length === 0) return null

  scored.sort((a, b) => b.score - a.score || a.card.kanjiId - b.card.kanjiId)
  return scored[0]!.card
}

/** True when no hook has been built since the session before last. */
function hooksHaveGoneStale(snapshot: LearnerSnapshot): boolean {
  const { latestAt, sessionDates } = snapshot.hooks
  // Needs two sessions to have a "session before last" to measure against.
  const sessionBeforeLast = sessionDates[1]
  if (!sessionBeforeLast) return false
  if (!latestAt) return true
  return Date.parse(latestAt) < Date.parse(sessionBeforeLast)
}

export function detectHookCoverage(snapshot: LearnerSnapshot): Finding | null {
  const hasNone = snapshot.hooks.count === 0
  const isStale = hooksHaveGoneStale(snapshot)
  if (!hasNone && !isStale) return null

  // An offer needs a subject. With nothing to work on, say nothing —
  // "you've built no hooks" with no kanji attached is the scoring sentence
  // §14.4 exists to remove.
  const candidate = pickHookCandidate(snapshot.reviews.cards, snapshot.reviews.quiz)
  if (!candidate) return null

  const evidence: Evidence[] = [
    { label: 'hooks built', value: snapshot.hooks.count },
    {
      label: 'suggested kanji',
      value: candidate.character,
      kanjiId: candidate.kanjiId,
      character: candidate.character,
    },
  ]

  // Only claim hooks help when both sides of the comparison exist.
  const { lapsesWithHook, lapsesWithoutHook } = snapshot.hooks
  if (lapsesWithHook !== null && lapsesWithoutHook !== null) {
    evidence.push(
      { label: 'average lapses with a hook', value: lapsesWithHook },
      { label: 'average lapses without one', value: lapsesWithoutHook },
    )
  }

  return {
    kind: 'hook_coverage',
    magnitude: hasNone ? NO_HOOKS_MAGNITUDE : STALE_MAGNITUDE,
    confidence: confidenceFromCount(snapshot.reviews.cards.length, CONFIDENCE_SCALE),
    evidence,
    since: null,
  }
}
