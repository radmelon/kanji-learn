/**
 * Whether an incoming "start a session" request should tear down what the
 * Study tab is currently showing.
 *
 * B-226. Expo Router keeps tabs mounted, so leaving Session Complete by tapping
 * another tab leaves `sessionSummary` set and `phase` at 'active'. The
 * Dashboard's "Start Today's Reviews" was only `router.push('/(tabs)/study')`,
 * so a button that promises to *start* a session re-rendered a *finished* one.
 * (This re-opened B123, whose fix covered only the exits that run `onDone`.)
 *
 * Two invariants pull in opposite directions here, which is why this is a
 * function and not an `if` at the call site:
 *
 *  1. **A finished session is stale and must be cleared.** That is the bug.
 *  2. **An in-progress session must survive.** Tapping the Dashboard CTA
 *     mid-session means "take me back to it", not "throw it away". Discarding
 *     a partly-graded queue would be a worse bug than the one being fixed.
 *
 * And a third, inherited from B-216 (see src/lib/study-screen.ts): this must
 * key on an **explicit request**, never on the store looking empty. `reset()`
 * also fires incidentally — a profile PATCH mid-session, sign-out — and
 * dismissing Session Complete on that signal is precisely what stranded
 * learners behind "All caught up!" with 280 cards due.
 */

export interface StudySessionExitInput {
  /** The learner asked for a session from outside the Study tab. One-shot. */
  freshSessionRequested: boolean
  /** A completed session's summary is on screen. */
  hasSessionSummary: boolean
}

export function shouldEndStudySession({
  freshSessionRequested,
  hasSessionSummary,
}: StudySessionExitInput): boolean {
  if (!freshSessionRequested) return false
  // Invariant 2: only a *finished* session is stale.
  return hasSessionSummary
}
