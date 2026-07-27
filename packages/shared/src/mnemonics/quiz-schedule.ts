/**
 * When the story→kanji recall quiz fires, and where it sits in the queue
 * (parent spec §8).
 *
 * Both functions are pure and total. `isRecallQuizDue` is called while
 * building the session queue, so a malformed stamp must degrade to "not due"
 * rather than throw — one bad row cannot be allowed to break the whole
 * session's queue construction.
 */

/**
 * Whether this hook is awaiting its recall quiz.
 *
 * The stamp is set on create AND on deepen, and cleared by a correct answer
 * (server-side, in `recordOutcome`). Without that clear the quiz re-fires
 * every session containing the kanji, forever — which is exactly what the
 * plan review caught.
 */
export function isRecallQuizDue(
  context: { mnemonicQuizDueAt?: string },
  now: Date,
): boolean {
  if (!context.mnemonicQuizDueAt) return false
  const due = new Date(context.mnemonicQuizDueAt).getTime()
  if (Number.isNaN(due)) return false
  return due <= now.getTime()
}

/**
 * Front-load the freshly-hooked kanji — parent spec §8 wants the first test
 * "early, while fresh".
 *
 * Adding an item sounds like it inflates the session, but the cost is bounded:
 * at most one Buddy moment fires per session, so at most one hook is ever
 * fresh, so this adds a single tap-item (design spec §7). Returns a new array;
 * the caller's queue is untouched.
 */
export function insertRecallQuizFirst(queue: number[], kanjiId: number): number[] {
  return [kanjiId, ...queue.filter((id) => id !== kanjiId)]
}
