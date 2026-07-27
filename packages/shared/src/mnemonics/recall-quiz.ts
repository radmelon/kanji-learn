import { selectDistractors, type DistractorKanji } from './distractors'

/** A story→kanji quiz item (parent spec §8). */
export interface RecallQuizItem {
  /** The hook's story, shown as the prompt. */
  storyText: string
  /** Kanji ids to render as tiles. `correctKanjiId` is FIRST — shuffle before display. */
  choices: number[]
  correctKanjiId: number
}

/** Default distractor count → a 4-tile item. */
export const DEFAULT_DISTRACTOR_COUNT = 3

/**
 * Build the first-test item for a fresh hook (parent spec §8).
 *
 * Deliberately pure and deterministic: no RNG, no clock. Shuffling belongs to
 * the renderer, so a failing item can be reproduced exactly from its inputs.
 * The correct answer is returned first — a renderer that forgets to shuffle
 * then fails obviously in review, rather than silently always highlighting
 * the first tile.
 *
 * Distractor quality is the point of the item: `selectDistractors` prefers
 * kanji sharing a component with the target, which became genuinely useful
 * once migration 0026 backfilled `kanji.components` (and 0028 repaired its
 * encoding). Wrong answers that look nothing like the target test nothing.
 *
 * Degrades rather than throws: a small pool simply yields fewer tiles, which
 * matters for a new learner whose deck is nearly empty.
 */
export function buildRecallQuizItem(args: {
  storyText: string
  target: DistractorKanji
  pool: DistractorKanji[]
  count?: number
}): RecallQuizItem {
  const count = args.count ?? DEFAULT_DISTRACTOR_COUNT
  const distractors = selectDistractors(args.target, args.pool, count)
  return {
    storyText: args.storyText,
    choices: [args.target.kanjiId, ...distractors],
    correctKanjiId: args.target.kanjiId,
  }
}
