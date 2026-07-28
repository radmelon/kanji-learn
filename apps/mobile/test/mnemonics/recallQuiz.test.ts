import type { ReviewQueueItem } from '@kanji-learn/shared'
import {
  planRecallQuiz,
  buildRecallQuizFromQueue,
  shuffleChoices,
} from '../../src/mnemonics/recallQuiz'

/**
 * The mobile half of the recall quiz (parent spec §8). Everything decidable
 * without a renderer lives here, because this project's jest runs in a `node`
 * environment — same split as useReinforce.reducer.
 */

const item = (over: Partial<ReviewQueueItem> & { kanjiId: number }): ReviewQueueItem =>
  ({
    character: '持',
    reviewType: 'meaning',
    jlptLevel: 'N4',
    meanings: ['hold'],
    kunReadings: [],
    onReadings: [],
    exampleVocab: [],
    exampleSentences: [],
    status: 'learning',
    readingStage: 0,
    strokeCount: 9,
    radicals: ['扌', '寺'],
    nelsonClassic: null,
    nelsonNew: null,
    morohashiIndex: null,
    morohashiVolume: null,
    morohashiPage: null,
    ...over,
  }) as ReviewQueueItem

const NOW = new Date('2026-07-27T12:00:00Z')
const PAST = '2026-07-27T11:00:00Z'
const FUTURE = '2026-07-28T00:00:00Z'

describe('planRecallQuiz', () => {
  it('front-loads the kanji whose hook owes its first test', () => {
    const queue = [item({ kanjiId: 5 }), item({ kanjiId: 6 }), item({ kanjiId: 7, mnemonicQuizDueAt: PAST })]

    const plan = planRecallQuiz(queue, NOW)

    expect(plan.recallKanjiId).toBe(7)
    expect(plan.queue.map((i) => i.kanjiId)).toEqual([7, 5, 6])
  })

  it('leaves the queue untouched when no hook is due', () => {
    const queue = [item({ kanjiId: 5 }), item({ kanjiId: 6 })]

    const plan = planRecallQuiz(queue, NOW)

    expect(plan.recallKanjiId).toBeNull()
    expect(plan.queue).toBe(queue)
  })

  it('ignores a stamp that has not come round yet', () => {
    const plan = planRecallQuiz([item({ kanjiId: 5, mnemonicQuizDueAt: FUTURE })], NOW)

    expect(plan.recallKanjiId).toBeNull()
  })

  it('picks exactly one even when several are due', () => {
    // Design spec §7 bounds this at one added item per session. Two recall
    // quizzes in one session would eat the minutes budget the learner chose.
    const queue = [
      item({ kanjiId: 5 }),
      item({ kanjiId: 6, mnemonicQuizDueAt: PAST }),
      item({ kanjiId: 7, mnemonicQuizDueAt: PAST }),
    ]

    const plan = planRecallQuiz(queue, NOW)

    expect(plan.recallKanjiId).toBe(6)
    expect(plan.queue.map((i) => i.kanjiId)).toEqual([6, 5, 7])
  })

  it('never drops a card while reordering', () => {
    // The queue IS the session. A reorder that loses an entry costs the
    // learner reviews they were scheduled to do.
    const queue = [item({ kanjiId: 5 }), item({ kanjiId: 6 }), item({ kanjiId: 7, mnemonicQuizDueAt: PAST })]

    const plan = planRecallQuiz(queue, NOW)

    expect(plan.queue).toHaveLength(queue.length)
    expect(new Set(plan.queue)).toEqual(new Set(queue))
  })

  it('keeps both entries when the same kanji appears twice', () => {
    // A due review and a surprise burned check can collide on one kanji.
    // Deduping the ids must not dedupe the cards.
    const queue = [item({ kanjiId: 5 }), item({ kanjiId: 7, mnemonicQuizDueAt: PAST }), item({ kanjiId: 7 })]

    const plan = planRecallQuiz(queue, NOW)

    expect(plan.queue.map((i) => i.kanjiId)).toEqual([7, 7, 5])
  })

  it('treats an unparseable stamp as not due rather than throwing', () => {
    // planRecallQuiz runs while building the session queue — one bad row must
    // not cost the learner the whole session.
    const plan = planRecallQuiz([item({ kanjiId: 5, mnemonicQuizDueAt: 'not a date' })], NOW)

    expect(plan.recallKanjiId).toBeNull()
  })

  it('handles an empty queue', () => {
    expect(planRecallQuiz([], NOW)).toEqual({ queue: [], recallKanjiId: null })
  })
})

describe('buildRecallQuizFromQueue', () => {
  const target = item({ kanjiId: 1, character: '持', radicals: ['扌', '寺'], jlptLevel: 'N4' })
  const pool = [
    item({ kanjiId: 2, character: '待', radicals: ['彳', '寺'], jlptLevel: 'N4' }),
    item({ kanjiId: 3, character: '日', radicals: ['日'], jlptLevel: 'N5' }),
    item({ kanjiId: 4, character: '木', radicals: ['木'], jlptLevel: 'N2' }),
    item({ kanjiId: 5, character: '打', radicals: ['扌'], jlptLevel: 'N3' }),
  ]

  it('returns the target plus three distractors, each with its character', () => {
    const built = buildRecallQuizFromQueue({ storyText: 'a story', target, pool })

    expect(built).not.toBeNull()
    expect(built!.storyText).toBe('a story')
    expect(built!.correctKanjiId).toBe(1)
    expect(built!.choices).toHaveLength(4)
    expect(built!.choices.map((c) => c.character)).not.toContain('')
  })

  it('prefers the distractors that share a component', () => {
    // Wrong answers that look nothing like the target test nothing.
    const built = buildRecallQuizFromQueue({ storyText: 's', target, pool, count: 2 })

    expect(built!.choices.map((c) => c.kanjiId).sort()).toEqual([1, 2, 5])
  })

  it('never repeats a kanji', () => {
    const built = buildRecallQuizFromQueue({ storyText: 's', target, pool: [...pool, target] })

    const ids = built!.choices.map((c) => c.kanjiId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('drops the target out of the pool', () => {
    const built = buildRecallQuizFromQueue({ storyText: 's', target, pool: [target] })

    // One tile is not a quiz — nothing to choose between.
    expect(built).toBeNull()
  })

  it('returns null rather than a one-tile quiz for a nearly empty deck', () => {
    expect(buildRecallQuizFromQueue({ storyText: 's', target, pool: [] })).toBeNull()
  })

  it('degrades to fewer tiles when the pool is small', () => {
    const built = buildRecallQuizFromQueue({ storyText: 's', target, pool: [pool[0]!] })

    expect(built!.choices).toHaveLength(2)
    expect(built!.choices.map((c) => c.kanjiId)).toContain(1)
  })
})

describe('shuffleChoices', () => {
  const choices = [
    { kanjiId: 1, character: '持' },
    { kanjiId: 2, character: '待' },
    { kanjiId: 3, character: '侍' },
    { kanjiId: 4, character: '特' },
  ]

  it('keeps every choice', () => {
    const shuffled = shuffleChoices(choices, () => 0.5)

    expect(shuffled).toHaveLength(4)
    expect(new Set(shuffled.map((c) => c.kanjiId))).toEqual(new Set([1, 2, 3, 4]))
  })

  it('moves the correct answer off tile one', () => {
    // buildRecallQuizItem deliberately returns the answer FIRST, so a card
    // that forgets to shuffle always highlights tile one.
    const shuffled = shuffleChoices(choices, () => 0)

    expect(shuffled[0]!.kanjiId).not.toBe(1)
  })

  it('does not mutate the input', () => {
    const original = [...choices]
    shuffleChoices(choices, () => 0.7)

    expect(choices).toEqual(original)
  })
})
