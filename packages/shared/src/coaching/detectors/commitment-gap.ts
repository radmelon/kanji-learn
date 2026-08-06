import type { Finding, LearnerSnapshot } from '../types'
import { EVIDENCE_LABELS } from '../types'
import { normaliseLinear } from '../magnitude'

/**
 * Promised minutes versus actual.
 *
 * MAGNITUDE MAPPING (this kind's own scale, per §2): the PROPORTION of the
 * promise missed, linear from 0 at SLACK to 1 at a total miss. Proportional
 * rather than absolute, because missing 5 of 10 promised minutes is the same
 * broken promise as missing 50 of 100 — an absolute scale would only ever
 * raise this for ambitious learners.
 *
 * NOTE ON REGISTER: how bluntly this is said is §8's frankness escalator,
 * which keys on the goal date collected in slice 6. Nothing here decides tone.
 */
const SLACK = 0.05

export function detectCommitmentGap(snapshot: LearnerSnapshot): Finding | null {
  const c = snapshot.commitment
  if (!c || c.promisedMinutes <= 0) return null

  const missed = c.promisedMinutes - c.actualMinutes
  if (missed <= 0) return null

  const proportionMissed = missed / c.promisedMinutes
  const magnitude = normaliseLinear(proportionMissed, SLACK, 1)
  if (magnitude === 0) return null

  return {
    kind: 'commitment_gap',
    magnitude,
    // A promise and a measurement. There is nothing to be uncertain about.
    confidence: 1,
    evidence: [
      { label: EVIDENCE_LABELS.MINUTES_PROMISED, value: c.promisedMinutes },
      { label: EVIDENCE_LABELS.MINUTES_STUDIED, value: c.actualMinutes },
      { label: EVIDENCE_LABELS.PERIOD_START, value: c.periodStart },
      // EXCLUSIVE — the display layer subtracts a day. Emitted as the contract
      // stores it, so the raw value and the snapshot never disagree.
      { label: EVIDENCE_LABELS.PERIOD_END, value: c.periodEnd },
    ],
    since: null,
  }
}
