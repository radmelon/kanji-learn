import { describe, it, expect } from 'vitest'
import { buildRecallQuizItem } from './recall-quiz'
import type { DistractorKanji } from './distractors'

const target: DistractorKanji = { kanjiId: 100, radicals: ['扌', '寺'], jlpt: 5 }

const pool: DistractorKanji[] = [
  { kanjiId: 101, radicals: ['扌', '木'], jlpt: 5 }, // shares 扌
  { kanjiId: 102, radicals: ['寺', '日'], jlpt: 4 }, // shares 寺
  { kanjiId: 103, radicals: ['水'],       jlpt: 5 }, // same level only
  { kanjiId: 104, radicals: ['火'],       jlpt: 3 }, // neither
]

const STORY = 'At Beppu Station, a hand reaches out and holds a hot can beside a little temple.'

describe('buildRecallQuizItem', () => {
  it('returns the target plus three distractors by default', () => {
    const item = buildRecallQuizItem({ storyText: STORY, target, pool })
    expect(item.choices).toHaveLength(4)
    expect(item.choices).toContain(100)
    expect(item.correctKanjiId).toBe(100)
  })

  it('carries the story through as the prompt', () => {
    expect(buildRecallQuizItem({ storyText: STORY, target, pool }).storyText).toBe(STORY)
  })

  it('never repeats a choice', () => {
    const item = buildRecallQuizItem({ storyText: STORY, target, pool })
    expect(new Set(item.choices).size).toBe(item.choices.length)
  })

  it('prefers component-sharing distractors — the whole point of the item', () => {
    // A quiz whose wrong answers look nothing like the target tests nothing.
    const item = buildRecallQuizItem({ storyText: STORY, target, pool, count: 2 })
    expect(item.choices).toEqual(expect.arrayContaining([101, 102]))
  })

  it('degrades gracefully when the pool is too small', () => {
    const item = buildRecallQuizItem({ storyText: STORY, target, pool: [pool[0]] })
    expect(item.choices).toHaveLength(2)
    expect(item.choices).toContain(100)
    expect(item.correctKanjiId).toBe(100)
  })

  it('still produces a usable item with an empty pool', () => {
    // Degenerate, but it must not throw — a new user has almost no deck.
    const item = buildRecallQuizItem({ storyText: STORY, target, pool: [] })
    expect(item.choices).toEqual([100])
    expect(item.correctKanjiId).toBe(100)
  })

  it('excludes the target even when the pool contains it', () => {
    const item = buildRecallQuizItem({
      storyText: STORY,
      target,
      pool: [...pool, { kanjiId: 100, radicals: ['扌', '寺'], jlpt: 5 }],
    })
    expect(item.choices.filter((id) => id === 100)).toHaveLength(1)
  })

  it('honours an explicit distractor count', () => {
    expect(buildRecallQuizItem({ storyText: STORY, target, pool, count: 4 }).choices).toHaveLength(5)
    expect(buildRecallQuizItem({ storyText: STORY, target, pool, count: 1 }).choices).toHaveLength(2)
  })

  it('is deterministic — same inputs, same item', () => {
    // Shuffling is the renderer's job. Keeping this pure means a failing quiz
    // can be reproduced exactly from its inputs.
    const a = buildRecallQuizItem({ storyText: STORY, target, pool })
    const b = buildRecallQuizItem({ storyText: STORY, target, pool })
    expect(a).toEqual(b)
  })

  it('puts the correct answer first, for the caller to shuffle', () => {
    // Documented so a renderer that forgets to shuffle fails visibly in review
    // rather than silently always highlighting position 1.
    const item = buildRecallQuizItem({ storyText: STORY, target, pool })
    expect(item.choices[0]).toBe(item.correctKanjiId)
  })
})
