import { api } from '../lib/api'
import type { AssemblerSlots, CoCreationContext, ReviewedCard } from '@kanji-learn/shared'

export const assembleCloud = (slots: AssemblerSlots) =>
  api.post<{ storyText: string; generatedBy: 'cloud' }>('/v1/mnemonics/assemble', slots)

export const saveCoCreated = (
  kanjiId: number,
  payload: { storyText: string; context: CoCreationContext; latitude?: number; longitude?: number },
) => api.post<{ id: string }>(`/v1/mnemonics/${kanjiId}/cocreated`, payload)

export const fetchBuddyMomentContext = (kanjiIds: number[]) =>
  api.post<
    Array<
      Pick<ReviewedCard, 'kanjiId' | 'kanji' | 'lapses' | 'hasHook'> & {
        buddyMomentSnoozedUntil: string | null
        /** Null on an API that predates the reinforce freshness guard, which
         *  the guard reads as "old enough" — the previous behaviour. */
        hookCreatedAt?: string | null
      }
    >
  >('/v1/mnemonics/buddy-moment-context', { kanjiIds })

/**
 * "Not now" — suppress Buddy moments for THIS kanji for 7 days (parent spec
 * §11). Plan 3b closed the sheet and forgot, so the same offer could return
 * the very next session.
 *
 * `snoozed: false` clears it, which is what accepting an offer does.
 */
export const snoozeBuddyMoment = (kanjiId: number, snoozed = true) =>
  api.patch<{ snoozedUntil: string | null }>(
    `/v1/kanji/${kanjiId}/snooze-buddy-moment`,
    { snoozed },
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
 * Append a layer to an existing hook (parent spec §6.3). Additive: the server
 * replaces storyText and context wholesale, but the context we send already
 * carries every previous layer, so nothing is lost. Resets effectivenessScore
 * server-side — a deepened hook earns a fresh start.
 */
export const deepenHook = (
  mnemonicId: string,
  payload: { storyText: string; context: CoCreationContext },
) => api.post<{ id: string }>(`/v1/mnemonics/${mnemonicId}/deepen`, payload)
