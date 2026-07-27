import { api } from '../lib/api'
import type { AssemblerSlots, CoCreationContext, ReviewedCard } from '@kanji-learn/shared'

export const assembleCloud = (slots: AssemblerSlots) =>
  api.post<{ storyText: string; generatedBy: 'cloud' }>('/v1/mnemonics/assemble', slots)

export const saveCoCreated = (
  kanjiId: number,
  payload: { storyText: string; context: CoCreationContext; latitude?: number; longitude?: number },
) => api.post<{ id: string }>(`/v1/mnemonics/${kanjiId}/cocreated`, payload)

export const fetchBuddyMomentContext = (kanjiIds: number[]) =>
  api.post<Array<Pick<ReviewedCard, 'kanjiId' | 'kanji' | 'lapses' | 'hasHook'>>>(
    '/v1/mnemonics/buddy-moment-context',
    { kanjiIds },
  )

/**
 * Record a reinforcement or quiz outcome (parent spec §6.1). The server owns
 * the EMA and returns the updated figures, so the deepen gate is evaluated on
 * authoritative numbers rather than a local re-computation.
 * outcome = 1 (👍 / quiz correct) or 0 (👎 / quiz wrong).
 */
export const recordOutcome = (mnemonicId: string, outcome: 0 | 1) =>
  api.post<{ id: string; effectivenessScore: number; reinforcementCount: number }>(
    `/v1/mnemonics/${mnemonicId}/outcome`,
    { outcome },
  )

/**
 * Append a layer to an existing hook (parent spec §6.3). Additive: the server
 * replaces storyText and context wholesale, but the context we send already
 * carries every previous layer, so nothing is lost. Resets effectivenessScore
 * server-side — a deepened hook earns a fresh start.
 */
export const deepenHook = (
  mnemonicId: string,
  payload: { storyText: string; context: CoCreationContext },
) => api.post<{ id: string }>(`/v1/mnemonics/${mnemonicId}/deepen`, payload)
