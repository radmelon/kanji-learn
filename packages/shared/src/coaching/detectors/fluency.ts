import type { CardSnapshot, Finding, LearnerSnapshot } from '../types'
import { EVIDENCE_LABELS } from '../types'
import { confidenceFromCount, normaliseLinear } from '../magnitude'

/**
 * Getting faster without getting worse.
 *
 * §3 calls this "the finding most likely to exist in a thin week", which is
 * exactly why it must be strict: it will be reached for often, and praise
 * that is not earned is worse than silence.
 *
 * THE TRAP: §3 says response time falling AT CONSTANT ACCURACY. Faster and
 * wronger is guessing, and congratulating it trains the behaviour. Accuracy
 * must not have fallen by more than ACCURACY_SLACK; a RISE is fine.
 *
 * MAGNITUDE MAPPING (this kind's own scale, per §2): the proportional drop in
 * mean response time, linear from 0 at SPEEDUP_FLOOR to 1 at SPEEDUP_CEILING.
 */
const ACCURACY_SLACK = 0.05
/**
 * ⚠️ Measured 2026-08-02: review `response_time_ms` on live runs p25 7.7s,
 * p50 15.8s, p75 30.4s. That spread is wide enough that a 10% shift in a
 * per-card mean is well inside noise for a card with few reviews. The
 * confidence scale below is the hedge — a fluency claim from 3 cards must not
 * be spoken like one from 50 — but if this finding turns out to fire on
 * nothing but jitter, RAISE THE FLOOR rather than adding cleverness.
 */
const SPEEDUP_FLOOR = 0.1
const SPEEDUP_CEILING = 0.5
const CONFIDENCE_SCALE = 15

function hasBothHalves(c: CardSnapshot): boolean {
  return (
    c.responseMsEarly !== null && c.responseMsLate !== null &&
    c.responseMsEarly > 0 && c.responseMsLate > 0
  )
}

function accuracyHeld(c: CardSnapshot): boolean {
  if (c.accuracyEarly === null || c.accuracyLate === null) return false
  return c.accuracyLate >= c.accuracyEarly - ACCURACY_SLACK
}

export function detectFluencyGain(snapshot: LearnerSnapshot): Finding | null {
  const measurable = snapshot.reviews.cards.filter(hasBothHalves)
  if (measurable.length === 0) return null

  // Faster-but-sloppier cards are excluded outright rather than averaged in,
  // so a genuinely improving card cannot be cancelled by a guessed one.
  const honest = measurable.filter(accuracyHeld)
  if (honest.length === 0) return null

  const early = honest.reduce((s, c) => s + c.responseMsEarly!, 0) / honest.length
  const late = honest.reduce((s, c) => s + c.responseMsLate!, 0) / honest.length
  if (late >= early) return null

  const proportionFaster = (early - late) / early
  const magnitude = normaliseLinear(proportionFaster, SPEEDUP_FLOOR, SPEEDUP_CEILING)
  if (magnitude === 0) return null

  return {
    kind: 'fluency_gain',
    magnitude,
    confidence: confidenceFromCount(honest.length, CONFIDENCE_SCALE),
    evidence: [
      { label: EVIDENCE_LABELS.PERCENT_FASTER, value: Math.round(proportionFaster * 100) },
      { label: EVIDENCE_LABELS.AVG_SECONDS_BEFORE, value: Math.round(early / 100) / 10 },
      { label: EVIDENCE_LABELS.AVG_SECONDS_NOW, value: Math.round(late / 100) / 10 },
      { label: EVIDENCE_LABELS.KANJI_MEASURED, value: honest.length },
      { label: EVIDENCE_LABELS.WINDOW_DAYS, value: snapshot.reviews.windowDays },
    ],
    since: null,
  }
}

/**
 * Ability movement between the two most recent placements (§3: needs ≥2).
 *
 * MAGNITUDE MAPPING (this kind's own scale, per §2): the rise in logits,
 * linear from 0 at the combined noise of the two estimates to 1 at
 * DELTA_CEILING. Requiring the movement to clear the noise floor is what stops
 * this congratulating someone for measurement error.
 *
 * Rises only. This sits in the Motivate band — a drop is real information, but
 * delivering it as a "reason to come back" is the wrong instrument, and
 * `retest_due` already covers a decayed estimate.
 */
const DELTA_CEILING = 1.5

export function detectThetaDelta(snapshot: LearnerSnapshot): Finding | null {
  const p = snapshot.placement
  if (!p?.previous) return null

  const rise = p.theta - p.previous.theta
  if (rise <= 0) return null

  // Combined standard error of the difference of two independent estimates.
  const noise = Math.sqrt(p.se * p.se + p.previous.se * p.previous.se)
  const magnitude = normaliseLinear(rise, noise, DELTA_CEILING)
  if (magnitude === 0) return null

  return {
    kind: 'theta_delta',
    magnitude,
    confidence: 1 - normaliseLinear(noise, 0.3, 1.5),
    evidence: [
      { label: EVIDENCE_LABELS.ABILITY_THEN, value: Math.round(p.previous.theta * 100) / 100 },
      { label: EVIDENCE_LABELS.ABILITY_NOW, value: Math.round(p.theta * 100) / 100 },
      { label: EVIDENCE_LABELS.MEASURED_ON, value: p.completedAt.slice(0, 10) },
      { label: EVIDENCE_LABELS.PREVIOUSLY_MEASURED_ON, value: p.previous.completedAt.slice(0, 10) },
    ],
    since: null,
  }
}
