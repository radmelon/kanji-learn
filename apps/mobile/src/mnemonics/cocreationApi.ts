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
 * The co-created hook for a kanji, or null if there isn't one.
 *
 * `buddy-moment-context` reports `hasHook` but not which mnemonic it is, so
 * the reinforce path needs this second read to get the id and story text.
 * Reuses the existing kanji-scoped list endpoint — no new API surface.
 * `generationMethod === 'cocreated'` is the same discriminator kanji detail
 * uses, so the two screens can never disagree about what counts as a hook.
 */
export const fetchCoCreatedHook = async (
  kanjiId: number,
): Promise<{ id: string; storyText: string } | null> => {
  const rows = await api.get<Array<{ id: string; storyText: string; generationMethod?: string }>>(
    `/v1/mnemonics/${kanjiId}`,
  )
  const hook = rows.find((m) => m.generationMethod === 'cocreated')
  return hook ? { id: hook.id, storyText: hook.storyText } : null
}

/**
 * Kanji sharing a component with this one, most-commonly-seen first.
 *
 * The distractor pool for the immediate quick-check (parent spec §8). The
 * co-creation sheet has no session queue to draw on, and this endpoint already
 * ranks over the whole kanji table by exactly the property `selectDistractors`
 * prefers — a shared component. Wrong answers that look nothing like the
 * target test nothing.
 */
export const fetchRelatedKanji = (kanjiId: number) =>
  api.get<Array<{ id: number; character: string }>>(`/v1/kanji/${kanjiId}/related`)

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
