// Pure spine of the meeting-Buddy conversation. Mirrors the
// useCoCreation.reducer pattern: every decision here, I/O in the store,
// rendering in components. Beat-transition bubbles come from beatCopy on BOTH
// tiers — the template floor is the cloud path minus free text.

import {
  beatCopy, mergeExtracted, resolveFrame, selectBeat,
  type Beat, type BeatKind, type CollectedState, type ExtractedPatch, type Ruler,
} from '@kanji-learn/shared'
import type { UserProfile } from '../hooks/useProfile'

export type MeetingTier = 'cloud' | 'template'

export interface TranscriptItem {
  id: string
  who: 'buddy' | 'learner'
  text: string
}

export interface MeetingUiState {
  tier: MeetingTier
  beat: Beat
  seen: BeatKind[]
  collected: CollectedState
  transcript: TranscriptItem[]
  busy: boolean
  restDay: number | null
}

export type MeetingAction =
  | { type: 'learner_said'; text: string }
  | { type: 'cloud_replied'; reply: string; patch: ExtractedPatch }
  | { type: 'cloud_failed' }
  | { type: 'answered'; patch: ExtractedPatch }

/** Append-only transcript → the next id is derived, keeping the reducer pure. */
function bubble(s: MeetingUiState, who: 'buddy' | 'learner', text: string): TranscriptItem {
  return { id: `m${s.transcript.length}`, who, text }
}

function withBubble(s: MeetingUiState, who: 'buddy' | 'learner', text: string): MeetingUiState {
  return { ...s, transcript: [...s.transcript, bubble(s, who, text)] }
}

/** Advance to the next beat if collected state now warrants one; append its
 *  prompt bubble. Same-beat means no transition and no duplicate bubble. */
function advance(s: MeetingUiState): MeetingUiState {
  const next = selectBeat(s.collected, s.seen, s.restDay)
  if (next.kind === s.beat.kind) return s
  const moved = { ...s, beat: next, seen: [...s.seen, next.kind] }
  return withBubble(moved, 'buddy', beatCopy(next))
}

export function initMeeting(input: {
  collected: CollectedState
  restDay: number | null
  tier: MeetingTier
}): MeetingUiState {
  const beat = selectBeat(input.collected, [], input.restDay)
  const base: MeetingUiState = {
    tier: input.tier, beat, seen: [beat.kind], collected: input.collected,
    transcript: [], busy: false, restDay: input.restDay,
  }
  return withBubble(base, 'buddy', beatCopy(beat))
}

export function meetingReducer(s: MeetingUiState, a: MeetingAction): MeetingUiState {
  switch (a.type) {
    case 'learner_said':
      return { ...withBubble(s, 'learner', a.text), busy: true }
    case 'cloud_replied': {
      const replied = withBubble({ ...s, busy: false }, 'buddy', a.reply)
      return advance({ ...replied, collected: mergeExtracted(replied.collected, a.patch) })
    }
    case 'cloud_failed': {
      // Permanent for this session: the floor is not something to bounce off.
      const grounded = { ...s, tier: 'template' as const, busy: false }
      return withBubble(grounded, 'buddy', beatCopy(grounded.beat))
    }
    case 'answered': {
      const merged = { ...s, busy: false, collected: mergeExtracted(s.collected, a.patch) }
      return advance(merged)
    }
  }
}

export function initialCollected(
  profile: Pick<UserProfile, 'onboardingCompletedAt' | 'dailyGoal' | 'timezone'> & {
    buddyDay: number | null
    buddyIntervalWeeks: number | null
  },
  learner: { reasonsForLearning: string[]; interests: string[] },
): CollectedState {
  const hadPriorData = profile.onboardingCompletedAt !== null
  return {
    // A DB default is not an answer: only prior-onboarded users carry values in.
    reasons: hadPriorData ? learner.reasonsForLearning : [],
    interests: hadPriorData ? learner.interests : [],
    explicitRuler: null,
    dailyGoal: hadPriorData ? profile.dailyGoal : null,
    buddyDay: profile.buddyDay,
    buddyIntervalWeeks: profile.buddyDay !== null ? profile.buddyIntervalWeeks : null,
    timezone: profile.timezone,
    hadPriorData,
  }
}

export function transcriptToMessages(
  items: TranscriptItem[],
  cap = 24,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return items
    .slice(-cap)
    .map((t) => ({ role: t.who === 'learner' ? 'user' as const : 'assistant' as const, content: t.text }))
}

export function collectedRuler(s: CollectedState): Ruler | null {
  const frame = resolveFrame({ explicitRuler: s.explicitRuler, reasons: s.reasons })
  return frame.kind === 'ask' ? null : frame.ruler
}
