import { useReducer, useCallback } from 'react'
import { reinforceReducer, initialReinforce } from './useReinforce.reducer'
import { recordOutcome } from './cocreationApi'

export * from './useReinforce.reducer'

/** Dependency seam so the hook's async effect is mockable. */
export interface ReinforceDeps {
  record: typeof recordOutcome
}
const defaultDeps: ReinforceDeps = { record: recordOutcome }

/**
 * End-of-session reinforce moment for a hooked kanji that slipped today
 * (parent spec §4.3). Reveal the scene, reveal the reading, then one
 * self-report — 👍 or "Not really" — which drives the EMA server-side.
 *
 * When the deepen gate trips (§6.2) the caller renders the deepen offer
 * instead of closing. Nothing is ever discarded; deepen only adds.
 */
export function useReinforce(mnemonicId: string, deps: ReinforceDeps = defaultDeps) {
  const [state, dispatch] = useReducer(reinforceReducer, undefined, initialReinforce)

  const reveal = useCallback(() => dispatch({ type: 'REVEAL' }), [])

  const submitOutcome = useCallback(
    async (outcome: 0 | 1) => {
      // Double-tap guard: the self-report buttons are large and end-of-session
      // taps are sloppy. A second send would double-count the EMA.
      if (state.isSubmitting || state.step === 'done') return
      dispatch({ type: 'SUBMITTING' })
      try {
        const updated = await deps.record(mnemonicId, outcome)
        dispatch({
          type: 'OUTCOME_RECORDED',
          reinforcementCount: updated.reinforcementCount,
          effectivenessScore: updated.effectivenessScore,
        })
      } catch {
        // Offline or 5xx — drop back to self_report so the learner can retry.
        // Losing one outcome is cheap; losing the moment is not.
        dispatch({ type: 'SUBMIT_FAILED' })
      }
    },
    [deps, mnemonicId, state.isSubmitting, state.step],
  )

  return { state, reveal, submitOutcome }
}
