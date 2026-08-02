import type { Finding, LearnerSnapshot } from './types'
import { select, DEFAULT_FINDING_COUNT } from './selection'
import { detectReadingLag } from './detectors/reading-lag'
import { detectLeech } from './detectors/leech'
import { detectCommitmentGap } from './detectors/commitment-gap'
import { detectHookCoverage } from './detectors/hook-coverage'
import { detectLevelEstimate, detectMechanicsExplainer } from './detectors/orient'
import { detectFluencyGain, detectThetaDelta } from './detectors/fluency'
import { detectHardestCleared, detectRetestDue } from './detectors/milestones'

/**
 * The whole analyzer (spec §1). Pure: no I/O, no LLM, no clock.
 *
 * Every number the coaching feature will ever show a learner is computed
 * behind this function, which is why it is testable in the shared lane with
 * no database, sub-second, in CI today.
 */
const DETECTORS: ((s: LearnerSnapshot) => Finding | null)[] = [
  detectReadingLag,
  detectLeech,
  detectCommitmentGap,
  detectHookCoverage,
  detectLevelEstimate,
  detectMechanicsExplainer,
  detectFluencyGain,
  detectThetaDelta,
  detectHardestCleared,
  detectRetestDue,
]

export function analyze(
  snapshot: LearnerSnapshot,
  count: number = DEFAULT_FINDING_COUNT,
): Finding[] {
  const found = DETECTORS
    .map((detect) => detect(snapshot))
    .filter((f): f is Finding => f !== null)

  return select(found, snapshot.priorFindings, snapshot.now, count)
}
