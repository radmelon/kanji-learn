// Pure payload builder for POST /v1/buddy/meet/complete, split out of
// meet-buddy.store.ts. The store transitively imports react-native (via
// ../lib/api -> ../stores/auth.store), which the pure Jest lane (node env,
// no RN mocks) cannot parse — see meet-buddy-payload.test.ts for the RED
// evidence. Keeping this builder here, with no store/AsyncStorage/zustand
// imports, lets it be unit-tested directly in that lane.

import type { CollectedState } from '@kanji-learn/shared'
import { collectedRuler, transcriptToMessages, type TranscriptItem } from './meeting-state'

export function buildCompletePayload(
  collected: CollectedState,
  transcript: TranscriptItem[],
  outcome: 'conversation' | 'form' | 'skipped',
) {
  return {
    outcome,
    reasons: collected.reasons,
    interests: collected.interests,
    ruler: collectedRuler(collected),
    dailyGoal: collected.dailyGoal,
    buddyDay: collected.buddyDay,
    buddyIntervalWeeks: collected.buddyIntervalWeeks ?? 1,
    transcript: outcome === 'conversation' ? transcriptToMessages(transcript, 60) : null,
  }
}

/** Stashed by finish()/skip() on a failed completion; replayed by
 *  flushPendingMeetBuddy() on the next begin(). */
export interface PendingBundle {
  profilePatch: Record<string, unknown>
  learnerPatch: Record<string, unknown> | null
  completePayload: ReturnType<typeof buildCompletePayload>
}
