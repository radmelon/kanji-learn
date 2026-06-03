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
