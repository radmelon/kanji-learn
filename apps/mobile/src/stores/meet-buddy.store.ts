import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import type { ExtractedPatch } from '@kanji-learn/shared'
import { api } from '../lib/api'
import { refreshProfile } from '../hooks/useProfile'
import { buildCompletePayload, type PendingBundle } from '../lib/meeting-payload'
import {
  initMeeting, initialCollected, meetingReducer, transcriptToMessages,
  type MeetingUiState,
} from '../lib/meeting-state'

// Re-exported so existing/expected callers (tests, Task 12's form path) can
// still `import { buildCompletePayload } from '../../src/stores/meet-buddy.store'`
// — the pure lane just needs the payload test importing the pure module
// directly (see meeting-payload.ts's header comment for why).
export { buildCompletePayload }

export const KEY_PENDING_MEET = 'meetBuddy.pendingComplete'

/** Retry a completion stashed by an offline finish. Returns true when either
 *  nothing was pending or the flush succeeded. */
export async function flushPendingMeetBuddy(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(KEY_PENDING_MEET)
  if (!raw) return true
  try {
    const bundle = JSON.parse(raw) as PendingBundle
    await api.patch('/v1/user/profile', bundle.profilePatch)
    if (bundle.learnerPatch) await api.patch('/v1/user/learner-profile', bundle.learnerPatch)
    await api.post('/v1/buddy/meet/complete', bundle.completePayload)
    await AsyncStorage.removeItem(KEY_PENDING_MEET)
    await refreshProfile()
    return true
  } catch {
    return false // still offline; keep the stash, keep the learner moving
  }
}

interface MeetBuddyState {
  ui: MeetingUiState | null
  error: string | null
  begin: (opts?: { revisit?: boolean }) => Promise<'ready' | 'already_done'>
  sendText: (text: string) => Promise<void>
  answer: (patch: ExtractedPatch) => void
  finish: () => Promise<void>
  skip: () => Promise<void>
}

export const useMeetBuddyStore = create<MeetBuddyState>((set, get) => ({
  ui: null,
  error: null,

  begin: async (opts) => {
    const revisit = opts?.revisit ?? false
    // An offline-completed meeting relaunched offline must not re-run — but
    // an explicit re-entry (F3: Profile's "Meet Buddy" row) still needs any
    // stash flushed first, since a stale local queue must not silently ride
    // along into a fresh conversation.
    if (await AsyncStorage.getItem(KEY_PENDING_MEET)) {
      await flushPendingMeetBuddy()
      if (!revisit) return 'already_done'
    }
    try {
      const [profile, learner] = await Promise.all([
        api.get<{
          onboardingCompletedAt: string | null; dailyGoal: number; timezone: string
          restDay: number | null; buddyDay: number | null; buddyIntervalWeeks: number | null
          metBuddyAt: string | null
        }>('/v1/user/profile'),
        api.get<{ reasonsForLearning: string[]; interests: string[] }>('/v1/user/learner-profile'),
      ])
      // F3 fix (whole-branch review, HIGH): the Profile row was inert
      // because this bail fired for EVERY learner who can see it — anyone
      // with metBuddyAt set. Re-entry skips the bail outright.
      if (profile.metBuddyAt && !revisit) return 'already_done'
      // A learner who met Buddy but never had onboardingCompletedAt stamped
      // (a stale/legacy row, or a conversation outcome — see F5) still has
      // prior data by construction. Coalesce so initialCollected's
      // hadPriorData discriminator sees it and does not re-ask.
      const collected = initialCollected(
        { ...profile, onboardingCompletedAt: profile.onboardingCompletedAt ?? profile.metBuddyAt },
        learner,
      )
      set({ ui: initMeeting({ collected, restDay: profile.restDay, tier: 'cloud' }), error: null })
      return 'ready'
    } catch {
      // Offline first launch: template tier from a blank slate — the floor.
      const collected = initialCollected(
        { onboardingCompletedAt: null, dailyGoal: 15, timezone: 'UTC', buddyDay: null, buddyIntervalWeeks: null },
        { reasonsForLearning: [], interests: [] },
      )
      set({ ui: initMeeting({ collected, restDay: null, tier: 'template' }), error: null })
      return 'ready'
    }
  },

  sendText: async (text) => {
    const { ui } = get()
    if (!ui || ui.busy || ui.tier !== 'cloud') return
    const said = meetingReducer(ui, { type: 'learner_said', text })
    set({ ui: said })
    try {
      const data = await api.post<{ reply?: string; patch?: ExtractedPatch; fallback?: boolean }>(
        '/v1/buddy/meet/turn',
        {
          beat: said.beat.kind,
          collected: said.collected,
          messages: transcriptToMessages(said.transcript),
        },
      )
      const current = get().ui
      if (!current) return
      if (data.fallback || !data.reply) {
        set({ ui: meetingReducer(current, { type: 'cloud_failed' }) })
      } else {
        set({ ui: meetingReducer(current, { type: 'cloud_replied', reply: data.reply, patch: data.patch ?? {} }) })
      }
    } catch {
      const current = get().ui
      if (current) set({ ui: meetingReducer(current, { type: 'cloud_failed' }) })
    }
  },

  answer: (patch) => {
    const { ui } = get()
    if (!ui || ui.busy) return
    set({ ui: meetingReducer(ui, { type: 'answered', patch }) })
  },

  finish: async () => {
    const { ui } = get()
    if (!ui) return
    const c = ui.collected
    const profilePatch: Record<string, unknown> = {}
    if (c.dailyGoal !== null) profilePatch.dailyGoal = c.dailyGoal
    if (c.buddyDay !== null) {
      profilePatch.buddyDay = c.buddyDay
      profilePatch.buddyIntervalWeeks = c.buddyIntervalWeeks ?? 1
    }
    const learnerPatch =
      c.reasons.length > 0 || c.interests.length > 0
        ? { reasonsForLearning: c.reasons, interests: c.interests }
        : null
    const completePayload = buildCompletePayload(c, ui.transcript, 'conversation')
    try {
      if (Object.keys(profilePatch).length > 0) await api.patch('/v1/user/profile', profilePatch)
      if (learnerPatch) await api.patch('/v1/user/learner-profile', learnerPatch)
      await api.post('/v1/buddy/meet/complete', completePayload)
      await refreshProfile()
    } catch {
      // Offline close: stash and move on — never a spinner on first launch.
      await AsyncStorage.setItem(
        KEY_PENDING_MEET,
        JSON.stringify({ profilePatch, learnerPatch, completePayload } satisfies PendingBundle),
      )
    }
  },

  skip: async () => {
    const { ui } = get()
    const payload = buildCompletePayload(
      ui?.collected ?? initialCollected(
        { onboardingCompletedAt: null, dailyGoal: 15, timezone: 'UTC', buddyDay: null, buddyIntervalWeeks: null },
        { reasonsForLearning: [], interests: [] },
      ),
      [],
      'skipped',
    )
    try {
      await api.post('/v1/buddy/meet/complete', payload)
      await refreshProfile()
    } catch {
      await AsyncStorage.setItem(
        KEY_PENDING_MEET,
        JSON.stringify({ profilePatch: {}, learnerPatch: null, completePayload: payload } satisfies PendingBundle),
      )
    }
  },
}))
