import type { Finding, LearnerSnapshot } from '../types'
import { EVIDENCE_LABELS } from '../types'
import { normaliseLinear } from '../magnitude'
import { widenForStaleness } from '../../placement-difficulty'

/**
 * The hardest item the learner actually got right — §3: "concrete, earned
 * praise". Specific beats generic: naming the kanji is the whole value, so a
 * correct answer is required and difficulty alone is not enough.
 *
 * MAGNITUDE MAPPING (this kind's own scale, per §2): the cleared item's
 * difficulty in logits, linear from 0 at PRAISE_FLOOR to 1 at PRAISE_CEILING.
 * Below the floor, clearing it is not news.
 */
const PRAISE_FLOOR = -1
// Measured 2026-08-02: difficulty_at_ask maxes at 2.00 on live, p90 = 1.17.
// A ceiling of 2.5 would have made full marks unreachable.
const PRAISE_CEILING = 2.0

export function detectHardestCleared(snapshot: LearnerSnapshot): Finding | null {
  const p = snapshot.placement
  if (!p) return null

  const cleared = p.items.filter((i) => i.meaningCorrect)
  if (cleared.length === 0) return null

  const hardest = cleared.reduce((a, b) => (b.difficultyAtAsk > a.difficultyAtAsk ? b : a))

  return {
    kind: 'hardest_cleared',
    magnitude: normaliseLinear(hardest.difficultyAtAsk, PRAISE_FLOOR, PRAISE_CEILING),
    confidence: 1,
    evidence: [
      {
        label: EVIDENCE_LABELS.HARDEST_KANJI_CLEARED,
        value: hardest.character,
        kanjiId: hardest.kanjiId,
        character: hardest.character,
      },
      { label: EVIDENCE_LABELS.ITEM_DIFFICULTY, value: Math.round(hardest.difficultyAtAsk * 100) / 100 },
      { label: EVIDENCE_LABELS.STROKE_COUNT, value: hardest.strokeCount },
      { label: EVIDENCE_LABELS.READING_COUNT, value: hardest.readingCount },
      { label: EVIDENCE_LABELS.MEASURED_ON, value: p.completedAt.slice(0, 10) },
    ],
    since: null,
  }
}

/**
 * The estimate has decayed enough that repeating the test is worth something.
 *
 * §3: this is the mechanism behind "revisit periodically" — Buddy suggests a
 * retake AT THE STATISTICALLY RIGHT MOMENT rather than on a calendar, framed
 * as the owner framed it: THE VALUE OF THE TEST INCREASES IF IT IS REPEATED,
 * not "please take a test". The copy layer owns that framing; this owns when.
 *
 * Reuses `widenForStaleness` (packages/shared/src/placement-difficulty.ts),
 * which is already what `getSessionPrior` uses to age a stored SE.
 *
 * MAGNITUDE MAPPING (this kind's own scale, per §2): the WIDENED se, linear
 * from 0 at RETEST_FLOOR to 1 at RETEST_CEILING. Keyed on the widened value,
 * not elapsed days, so a learner whose estimate was already loose is prompted
 * sooner than one whose was tight — which is the point.
 */
const RETEST_FLOOR = 0.5
const RETEST_CEILING = 1.2

export function detectRetestDue(snapshot: LearnerSnapshot): Finding | null {
  const p = snapshot.placement
  if (!p) return null

  const daysElapsed = Math.max(
    0,
    (Date.parse(snapshot.now) - Date.parse(p.completedAt)) / 86_400_000,
  )
  const widened = widenForStaleness(p.se, daysElapsed)

  const magnitude = normaliseLinear(widened, RETEST_FLOOR, RETEST_CEILING)
  if (magnitude === 0) return null

  return {
    kind: 'retest_due',
    magnitude,
    confidence: 1,
    evidence: [
      { label: EVIDENCE_LABELS.CURRENT_UNCERTAINTY, value: Math.round(widened * 100) / 100 },
      { label: EVIDENCE_LABELS.UNCERTAINTY_WHEN_MEASURED, value: Math.round(p.se * 100) / 100 },
      { label: EVIDENCE_LABELS.DAYS_SINCE_THE_TEST, value: Math.round(daysElapsed) },
    ],
    since: null,
  }
}
