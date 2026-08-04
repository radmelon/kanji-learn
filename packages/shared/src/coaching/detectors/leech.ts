import type { CardSnapshot, Evidence, Finding, LearnerSnapshot } from '../types'
import { EVIDENCE_LABELS } from '../types'
import { confidenceFromCount, normaliseLinear } from '../magnitude'

/**
 * Cards that keep falling over.
 *
 * ⚠️ THIS WAS REWRITTEN AFTER MEASURING LIVE (2026-08-02). The first version
 * used `lapses >= 4` OR `regressions >= 2`. Against production both are
 * unfirable: the maximum lapse count in the entire database is **4, on one
 * card**, p50 through p95 are all **0**, and there have been **zero**
 * `remembered→learning` regressions ever. That detector would have passed
 * every unit test — its fixtures used lapses of 5, 6 and 9 — and then never
 * spoken, which is indistinguishable from a healthy detector with nothing to
 * report.
 *
 * An ABSOLUTE threshold is the wrong instrument here. Tuned for today's data
 * it fires on noise; tuned for a mature deck it is dead. A RELATIVE rule has a
 * sensible answer at any data volume, and it is what a coach actually means:
 * *"these are the ones giving you trouble."*
 *
 * MAGNITUDE MAPPING (this kind's own scale, per §2): the FRACTION of the
 * learner's active deck that is giving trouble, linear from TROUBLE_FLOOR to
 * TROUBLE_CEILING. On live today that is 32/995 ≈ 3.2%, which lands just above
 * the floor — the finding fires quietly, which is correct: there is mild
 * trouble and it deserves a mention, not an alarm.
 */
/** Any lapse or regression at all makes a card a candidate. */
const MIN_TROUBLE_SCORE = 1
/** Below this share of the deck, trouble is noise. */
const TROUBLE_FLOOR = 0.02
/** A quarter of the active deck lapsing is a serious study-strategy problem. */
const TROUBLE_CEILING = 0.25
const CONFIDENCE_SCALE = 8
const MAX_NAMED = 3

function troubleScore(c: CardSnapshot): number {
  return c.lapses + c.regressions
}

/** A burned card is out of rotation; its history is not actionable advice. */
function isActive(c: CardSnapshot): boolean {
  return c.status !== 'unseen' && c.status !== 'burned'
}

export function detectLeech(snapshot: LearnerSnapshot): Finding | null {
  const active = snapshot.reviews.cards.filter(isActive)
  if (active.length === 0) return null

  const troubled = active.filter((c) => troubleScore(c) >= MIN_TROUBLE_SCORE)
  if (troubled.length === 0) return null

  const troubledFraction = troubled.length / active.length
  const magnitude = normaliseLinear(troubledFraction, TROUBLE_FLOOR, TROUBLE_CEILING)
  if (magnitude === 0) return null

  const worst = [...troubled].sort(
    (a, b) => troubleScore(b) - troubleScore(a) || a.kanjiId - b.kanjiId,
  )

  const evidence: Evidence[] = [
    { label: EVIDENCE_LABELS.KANJI_GIVING_TROUBLE, value: troubled.length },
    { label: EVIDENCE_LABELS.ACTIVE_KANJI, value: active.length },
    ...worst.slice(0, MAX_NAMED).map((c): Evidence => ({
      label: EVIDENCE_LABELS.LAPSES,
      value: c.lapses,
      kanjiId: c.kanjiId,
      character: c.character,
    })),
  ]

  return {
    kind: 'leech',
    magnitude,
    confidence: confidenceFromCount(active.length, CONFIDENCE_SCALE),
    evidence,
    since: null,
  }
}
