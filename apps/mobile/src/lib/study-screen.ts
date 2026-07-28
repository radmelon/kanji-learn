/**
 * Which screen the Study tab should render.
 *
 * This used to be a sequence of early returns inside `study.tsx`. It is a pure
 * function now because the order of those returns was itself the bug (B-216):
 * the empty-queue branch sat above the Session Complete branch, and Session
 * Complete's `onDone` holds the only `setPhase('ready')` in the file. Any path
 * that emptied the queue therefore unmounted the sole exit from the 'active'
 * phase, stranding the learner behind a cheerful "All caught up!" until they
 * force-quit — with, in the reported case, 280 cards actually due.
 *
 * Ordering rules worth keeping straight, because each one was earned:
 *
 *  - **Session Complete outranks everything.** A finished session is a fact;
 *    an empty queue underneath it is not evidence that the deck is done.
 *  - **`isLoading` outranks an empty queue**, or every Begin tap flashes
 *    "All caught up!" for a frame while the fetch is in flight.
 *  - **An empty queue means different things** depending on whether it ever
 *    held cards. Never populated = the deck really is clear. Emptied after
 *    being populated = we lost the session, which is an unknown state and must
 *    offer a way back rather than congratulating the learner.
 */

export type StudyScreen =
  /** Pre-session screen carrying the Begin button. */
  | 'ready'
  /** Queue fetch in flight. */
  | 'loading'
  /** Queue fetch failed; offers Retry. */
  | 'error'
  /** Post-session summary. Hosts the Buddy moment and the only route to 'ready'. */
  | 'sessionComplete'
  /** Queue vanished mid-session. Recoverable — offers a fresh start. */
  | 'sessionLost'
  /** Deck genuinely exhausted. */
  | 'empty'
  /** Session submit in flight. */
  | 'saving'
  /** Complete, but the summary has not been assembled yet. */
  | 'finishing'
  /** The ordinary case: render the current card. */
  | 'cards'

export type StudyScreenInput = {
  phase: 'ready' | 'active'
  isLoading: boolean
  error: string | null
  queueLength: number
  hasSessionSummary: boolean
  /**
   * Whether the queue has held at least one card since the current session
   * began. This is what separates "you're done" from "we lost your session" —
   * the two states are otherwise identical from the store's point of view.
   */
  queueEverPopulated: boolean
  isSaving: boolean
  isComplete: boolean
}

export function selectStudyScreen(s: StudyScreenInput): StudyScreen {
  // First, because a completed session must survive anything that empties the
  // queue beneath it — including a profile PATCH firing the store's reset.
  if (s.hasSessionSummary) return 'sessionComplete'

  if (s.phase === 'ready') return 'ready'
  if (s.isLoading) return 'loading'
  if (s.error) return 'error'

  if (s.queueLength === 0) {
    return s.queueEverPopulated ? 'sessionLost' : 'empty'
  }

  if (s.isSaving) return 'saving'
  if (s.isComplete) return 'finishing'
  return 'cards'
}
