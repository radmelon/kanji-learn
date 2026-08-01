// What the meeting screen shows, decided in one place.
//
// Mirrors selectSessionBody (buddy-session-state.ts) deliberately: same shape,
// same rule that no input combination may render nothing. The weekly session
// screen was hardened this way after B-227; the meeting screen was not, and
// shipped the same defect in B147 — `if (!ui) return <SafeAreaView />`, an
// empty view covering the whole of begin()'s network round-trip.

export type MeetingScreen =
  | { kind: 'loading' }
  | { kind: 'pending_offline' }
  | { kind: 'error' }
  | { kind: 'meeting' }

export interface MeetingScreenInput {
  /** begin() has resolved — success or otherwise. */
  settled: boolean
  /** The store holds a meeting to render. */
  hasUi: boolean
  /** begin() reported a stuck offline completion. */
  pendingOffline: boolean
  /** begin() returned 'already_done'; a router.replace is in flight. */
  leaving: boolean
}

export function selectMeetingScreen(input: MeetingScreenInput): MeetingScreen {
  // An explicit outcome, and it owns the screen the moment it is known — it
  // carries its own retry, so it must not be masked by the loader below.
  if (input.pendingOffline) return { kind: 'pending_offline' }

  if (!input.settled) return { kind: 'loading' }

  // 'already_done' never sets ui; it navigates instead. Hold the loader over
  // that gap rather than flashing an error at a learner who is on their way out.
  if (input.leaving) return { kind: 'loading' }

  if (input.hasUi) return { kind: 'meeting' }

  // Settled, not leaving, no stash, and still no meeting. This is the state
  // that used to render an empty view — a working app indistinguishable from a
  // dead one. Say something instead.
  return { kind: 'error' }
}
