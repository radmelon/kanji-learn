import {
  buildRecallQuizItem,
  insertRecallQuizFirst,
  isRecallQuizDue,
  type DistractorKanji,
  type ReviewQueueItem,
} from '@kanji-learn/shared'

/**
 * The mobile side of the story→kanji recall quiz (parent spec §8).
 *
 * The shared package owns the rules — which hook is due, where it sits in the
 * queue, which distractors are worth showing. This module owns the two things
 * only the client knows: that a tile needs a *character* and not an id, and
 * that a queue is a list of cards rather than a list of ids.
 *
 * Pure on purpose. This project's jest runs in a `node` environment with no
 * React renderer, so anything worth testing has to live outside the component
 * — the same split as `useReinforce.reducer`.
 */

/** One tappable tile. */
export interface RecallQuizChoice {
  kanjiId: number
  character: string
}

/** A quiz item ready to render: the story, the tiles, and the answer. */
export interface RecallQuizCardItem {
  storyText: string
  /** The correct answer is FIRST — `shuffleChoices` before display. */
  choices: RecallQuizChoice[]
  correctKanjiId: number
}

/**
 * Fewer than two tiles is not a question. A new learner's deck can genuinely
 * be this empty, so the builders return null and their hosts skip the check
 * rather than rendering a card with one inevitable answer.
 */
const MIN_CHOICES = 2

/** Default distractor count → a four-tile item. */
const DEFAULT_COUNT = 3

/** What the queue-backed builder needs off a card. `ReviewQueueItem` satisfies it. */
export interface RecallQuizPoolKanji {
  kanjiId: number
  character: string
  radicals: string[]
  jlptLevel: string
}

/** "N4" → 4. An unrecognised level becomes 0, which simply means "no JLPT tier
 *  match" to `selectDistractors` — it never collides with N1. */
function jlptNumber(level: string): number {
  const n = Number(level.replace(/^N/i, ''))
  return Number.isFinite(n) ? n : 0
}

const toDistractorKanji = (k: RecallQuizPoolKanji): DistractorKanji => ({
  kanjiId: k.kanjiId,
  radicals: k.radicals,
  jlpt: jlptNumber(k.jlptLevel),
})

/** Assemble the final item, or null if there aren't enough tiles to ask with. */
function toCardItem(
  storyText: string,
  target: RecallQuizChoice,
  distractors: RecallQuizChoice[],
): RecallQuizCardItem | null {
  const choices = [target, ...distractors]
  if (choices.length < MIN_CHOICES) return null
  return { storyText, choices, correctKanjiId: target.kanjiId }
}

/**
 * Build the quiz from the session queue itself (the next-session path).
 *
 * The queue is the natural distractor pool: every card carries its radicals
 * and JLPT level, which is exactly what `selectDistractors` ranks on, and
 * every card is one the learner is actually studying. No extra fetch.
 */
export function buildRecallQuizFromQueue(args: {
  storyText: string
  target: RecallQuizPoolKanji
  pool: RecallQuizPoolKanji[]
  count?: number
}): RecallQuizCardItem | null {
  const { choices } = buildRecallQuizItem({
    storyText: args.storyText,
    target: toDistractorKanji(args.target),
    pool: args.pool.map(toDistractorKanji),
    count: args.count ?? DEFAULT_COUNT,
  })

  // `choices` is ids; tiles need characters. The target is choices[0].
  const byId = new Map<number, string>()
  for (const k of [args.target, ...args.pool]) byId.set(k.kanjiId, k.character)

  const distractors = choices
    .slice(1)
    .map((id) => ({ kanjiId: id, character: byId.get(id) ?? '' }))
    .filter((c) => c.character !== '')

  return toCardItem(
    args.storyText,
    { kanjiId: args.target.kanjiId, character: args.target.character },
    distractors,
  )
}

/**
 * Build the quiz from a list the server has already ranked (the immediate
 * quick-check right after a hook is saved).
 *
 * `GET /v1/kanji/:id/related` returns only kanji sharing a component with the
 * target, ordered most-commonly-seen first — that is `selectDistractors`'
 * top tier, computed over the whole kanji table instead of whatever happens to
 * be in this session. Re-ranking it here would mean inventing radical data the
 * endpoint does not return, so this takes the first `count` as given.
 */
export function buildRecallQuizFromRanked(args: {
  storyText: string
  target: RecallQuizChoice
  ranked: RecallQuizChoice[]
  count?: number
}): RecallQuizCardItem | null {
  const distractors = args.ranked
    .filter((k) => k.kanjiId !== args.target.kanjiId)
    .slice(0, args.count ?? DEFAULT_COUNT)

  return toCardItem(args.storyText, args.target, distractors)
}

/**
 * Fisher–Yates over a copy. The correct answer arrives first by design, so a
 * card that skipped this would silently always highlight tile one.
 *
 * `rand` is injectable so the shuffle is testable without a renderer.
 */
export function shuffleChoices<T>(choices: T[], rand: () => number = Math.random): T[] {
  const out = [...choices]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export interface RecallQuizPlan {
  /** The session queue, with the due kanji front-loaded if there is one. */
  queue: ReviewQueueItem[]
  /** The kanji owing a recall quiz this session, or null. At most one. */
  recallKanjiId: number | null
}

/**
 * Decide whether this session opens with a recall quiz, and reorder for it.
 *
 * Bounded at one per session by construction: at most one Buddy moment fires
 * per session, so at most one hook is ever fresh (design spec §7). Taking the
 * first due card rather than all of them keeps that bound even if the server
 * hands back several stamps — two added items would eat into the minutes
 * budget the learner actually chose.
 */
export function planRecallQuiz(queue: ReviewQueueItem[], now: Date): RecallQuizPlan {
  const due = queue.find((item) => isRecallQuizDue(item, now))
  if (!due) return { queue, recallKanjiId: null }

  // insertRecallQuizFirst owns the ordering rule, but it works on ids and
  // dedupes them. A queue can legitimately carry the same kanji twice (a due
  // review plus a surprise burned check), so the items are regrouped by id
  // rather than looked up — reordering a session must never lose a card.
  const buckets = new Map<number, ReviewQueueItem[]>()
  for (const item of queue) {
    const bucket = buckets.get(item.kanjiId)
    if (bucket) bucket.push(item)
    else buckets.set(item.kanjiId, [item])
  }

  const order = insertRecallQuizFirst([...buckets.keys()], due.kanjiId)
  return {
    queue: order.flatMap((id) => buckets.get(id) ?? []),
    recallKanjiId: due.kanjiId,
  }
}
