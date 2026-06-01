import {
  EFFECTIVENESS_ALPHA,
  DEEPEN_MIN_REINFORCEMENTS,
  DEEPEN_SCORE_FLOOR,
} from './types'

/** Exponential moving average update. outcome = 1 (helped / quiz correct) or 0 (didn't). */
export function updateEffectiveness(score: number, outcome: 0 | 1): number {
  return EFFECTIVENESS_ALPHA * outcome + (1 - EFFECTIVENESS_ALPHA) * score
}

/** True when a struggling hook should be offered a deepen pass (never a discard). */
export function shouldDeepen(reinforcementCount: number, effectivenessScore: number): boolean {
  return reinforcementCount >= DEEPEN_MIN_REINFORCEMENTS && effectivenessScore < DEEPEN_SCORE_FLOOR
}
