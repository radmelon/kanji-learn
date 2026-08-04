import type { Finding, LearnerSnapshot } from '../types'
import { EVIDENCE_LABELS } from '../types'
import { normaliseLinear } from '../magnitude'

/**
 * Where the learner is, stated honestly.
 *
 * §3 is emphatic: θ WITH ITS CREDIBLE INTERVAL — "probably N3, possibly N2".
 * Never a bare label. A point estimate from ~13 items presented as fact is the
 * kind of overclaim that destroys trust the first time it is wrong, and the
 * interval is the whole reason an IRT placement is defensible at that length.
 *
 * MAGNITUDE MAPPING (this kind's own scale, per §2): fixed and low. This
 * orients rather than demands action, and it should not crowd out a Direct
 * finding. Priority banding in selection does most of the work; the low
 * magnitude keeps it honest within its own band.
 */
const LEVEL_ESTIMATE_MAGNITUDE = 0.5
/** SE at or below this is a tight estimate; at or above, barely informative. */
const SE_TIGHT = 0.3
const SE_LOOSE = 1.2

export function detectLevelEstimate(snapshot: LearnerSnapshot): Finding | null {
  const p = snapshot.placement
  if (!p) return null

  // Wide interval → low confidence. Inverted because a LARGE se is LESS certain.
  const confidence = 1 - normaliseLinear(p.se, SE_TIGHT, SE_LOOSE)

  return {
    kind: 'level_estimate',
    magnitude: LEVEL_ESTIMATE_MAGNITUDE,
    confidence,
    evidence: [
      { label: EVIDENCE_LABELS.MOST_LIKELY_LEVEL, value: p.level },
      { label: EVIDENCE_LABELS.LOWER_BOUND, value: p.levelLow },
      { label: EVIDENCE_LABELS.UPPER_BOUND, value: p.levelHigh },
      { label: EVIDENCE_LABELS.ABILITY_ESTIMATE, value: Math.round(p.theta * 100) / 100 },
      { label: EVIDENCE_LABELS.STANDARD_ERROR, value: Math.round(p.se * 100) / 100 },
    ],
    since: null,
  }
}

/**
 * The IRT two-liner plus a pointer to Profile (§7).
 *
 * TEMPLATE, ALWAYS. NEVER LLM. §3: "Buddy must not improvise about his own
 * algorithm." The explanation never changes, so there is nothing for a model
 * to add and everything for it to get wrong. It therefore carries NO evidence
 * — there is no number in it — and the copy layer (Task 10) must emit it
 * verbatim.
 */
const MECHANICS_MAGNITUDE = 0.1

export function detectMechanicsExplainer(snapshot: LearnerSnapshot): Finding | null {
  if (!snapshot.placement) return null
  return {
    kind: 'mechanics_explainer',
    magnitude: MECHANICS_MAGNITUDE,
    confidence: 1,
    evidence: [],
    since: null,
  }
}
