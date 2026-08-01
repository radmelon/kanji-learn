// Pure payload builder for POST /v1/buddy/meet/complete, split out of
// meet-buddy.store.ts. The store transitively imports react-native (via
// ../lib/api -> ../stores/auth.store), which the pure Jest lane (node env,
// no RN mocks) cannot parse — see meet-buddy-payload.test.ts for the RED
// evidence. Keeping this builder here, with no store/AsyncStorage/zustand
// imports, lets it be unit-tested directly in that lane.

import type { CollectedState } from '@kanji-learn/shared'
import { collectedRuler, transcriptToMessages, type TranscriptItem } from './meeting-state'

// The API's transcript item schema is z.string().max(2000) (meet.ts's
// completeSchema). A message longer than that — no composer maxLength
// enforced that before F4 — would fail server validation forever: a failed
// finish() stashes this exact payload (meet-buddy.store.ts), and the stash
// is replayed byte-for-byte on every future begin() with no way to edit it.
// Clamping here, at the one place every completion payload is built, means
// a stashed payload can never reproduce a 400 it cannot recover from.
const TRANSCRIPT_CONTENT_MAX = 2000

// Same lockout class as above, for reasons/interests: completeSchema caps
// both at z.string().max(80), .max(12) items. The interests free-text input
// has no per-item cap, so a long typed interest (or, defensively, more than
// 12 collected reasons/interests) would 400 /complete forever via the same
// stash-and-replay path. Clamp here so a stashed payload can never reproduce
// a 400 it cannot recover from.
const REASON_INTEREST_MAX_LEN = 80
const REASON_INTEREST_MAX_ITEMS = 12

function clampItems(items: string[]): string[] {
  return items
    .slice(0, REASON_INTEREST_MAX_ITEMS)
    .map((item) => item.slice(0, REASON_INTEREST_MAX_LEN))
    .filter((item) => item.length > 0)
}

export function buildCompletePayload(
  collected: CollectedState,
  transcript: TranscriptItem[],
  outcome: 'conversation' | 'form' | 'skipped',
) {
  const messages = outcome === 'conversation' ? transcriptToMessages(transcript, 60) : null
  return {
    outcome,
    reasons: clampItems(collected.reasons),
    interests: clampItems(collected.interests),
    ruler: collectedRuler(collected),
    dailyGoal: collected.dailyGoal,
    buddyDay: collected.buddyDay,
    buddyIntervalWeeks: collected.buddyIntervalWeeks ?? 1,
    transcript: messages
      ? messages.map((m) => ({ ...m, content: m.content.slice(0, TRANSCRIPT_CONTENT_MAX) }))
      : null,
  }
}

/** Stashed by finish()/skip() on a failed completion; replayed by
 *  flushPendingMeetBuddy() on the next begin(). */
export interface PendingBundle {
  profilePatch: Record<string, unknown>
  learnerPatch: Record<string, unknown> | null
  completePayload: ReturnType<typeof buildCompletePayload>
}
