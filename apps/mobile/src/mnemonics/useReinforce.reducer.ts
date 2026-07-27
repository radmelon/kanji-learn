import { shouldDeepen } from '@kanji-learn/shared'

/**
 * Pure state machine for the end-of-session reinforce moment (parent spec §4.3).
 *
 * Two taps and one judgement: recall the scene, recall the reading, then a
 * single self-report. The outcome drives the EMA server-side; this reducer only
 * decides what the learner sees next.
 *
 * Split from the hook for the same reason as useCoCreation.reducer — the
 * decisions are worth testing without a React renderer.
 */
export type ReinforceStep = 'scene' | 'reading' | 'self_report' | 'done'

export interface ReinforceState {
  step: ReinforceStep
  /** Set from the server's post-update figures, never guessed locally. */
  shouldOfferDeepen: boolean
  isSubmitting: boolean
}

export type ReinforceAction =
  | { type: 'REVEAL' }
  | { type: 'SUBMITTING' }
  | { type: 'OUTCOME_RECORDED'; reinforcementCount: number; effectivenessScore: number }
  | { type: 'SUBMIT_FAILED' }

export function initialReinforce(): ReinforceState {
  return { step: 'scene', shouldOfferDeepen: false, isSubmitting: false }
}

export function reinforceReducer(
  state: ReinforceState,
  action: ReinforceAction,
): ReinforceState {
  switch (action.type) {
    case 'REVEAL':
      // Only the two recall steps advance on a reveal. At self_report the
      // learner must actually answer — returning `state` keeps the object
      // identical so a stray tap cannot skip the judgement.
      if (state.step === 'scene') return { ...state, step: 'reading' }
      if (state.step === 'reading') return { ...state, step: 'self_report' }
      return state

    case 'SUBMITTING':
      return { ...state, isSubmitting: true }

    case 'OUTCOME_RECORDED':
      // The server owns the EMA (parent spec §6.1) and returns the updated
      // figures, so the gate is evaluated on authoritative numbers.
      return {
        step: 'done',
        isSubmitting: false,
        shouldOfferDeepen: shouldDeepen(action.reinforcementCount, action.effectivenessScore),
      }

    case 'SUBMIT_FAILED':
      // Offline or a 5xx. Drop back so the learner can retry rather than
      // losing the moment — the outcome is cheap to re-send.
      return { step: 'self_report', isSubmitting: false, shouldOfferDeepen: false }

    default:
      return state
  }
}
