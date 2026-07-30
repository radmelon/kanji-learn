/**
 * Which of the Journal tab's three mutually-exclusive body states to render.
 *
 * Extracted as a pure decision (mirroring `selectStudyScreen` and
 * `teachingBeat`) because the bug it encodes is a *state* bug, not a styling
 * one, and `journal.tsx` is an Expo Router screen wired to network hooks —
 * the surface docs/local-build-and-test-protocol.md lists as one to avoid
 * rendering in the component lane.
 *
 * B-227: the tab used to gate its empty state on `hasLoaded` so it could not
 * flash "No hooks yet" at someone with plenty — correct, but nothing was put
 * in its place, so a cold load rendered nothing at all. A learner concluded
 * the Journal was unbuilt and stopped opening it. The three states must be
 * exhaustive: there is no valid moment where the body renders empty.
 */
export type JournalListState = 'loading' | 'empty' | 'list'

export interface JournalListInputs {
  /** A kanji is selected, so the body shows that kanji's mnemonics, not hooks. */
  hasSelectedKanji: boolean
  /** A hooks load has completed at least once (success or failure). */
  hooksLoaded: boolean
  /** Hooks currently in hand — populated from cache before the network returns. */
  hookCount: number
}

export function journalListState({
  hasSelectedKanji,
  hooksLoaded,
  hookCount,
}: JournalListInputs): JournalListState {
  // Kanji-detail mode has its own list and its own loading affordance.
  if (hasSelectedKanji) return 'list'
  // Anything to show — cached or fetched — beats a spinner.
  if (hookCount > 0) return 'list'
  // Nothing to show and nothing loaded yet: a genuine cold start.
  if (!hooksLoaded) return 'loading'
  return 'empty'
}
