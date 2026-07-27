import { describe, it, expect } from 'vitest'
import { isRecallQuizDue, insertRecallQuizFirst } from './quiz-schedule'

const now = new Date('2026-07-27T12:00:00Z')

describe('isRecallQuizDue', () => {
  it('is due when the stamp is in the past', () => {
    expect(isRecallQuizDue({ mnemonicQuizDueAt: '2026-07-27T11:00:00Z' }, now)).toBe(true)
  })

  it('is due at exactly the stamped moment', () => {
    expect(isRecallQuizDue({ mnemonicQuizDueAt: '2026-07-27T12:00:00Z' }, now)).toBe(true)
  })

  it('is not due when the stamp is in the future', () => {
    expect(isRecallQuizDue({ mnemonicQuizDueAt: '2026-07-28T00:00:00Z' }, now)).toBe(false)
  })

  it('is not due once the stamp is cleared', () => {
    // The clear is what stops the quiz firing every session forever — see the
    // recordOutcome change in Task 11. Absent stamp must read as "not due".
    expect(isRecallQuizDue({}, now)).toBe(false)
    expect(isRecallQuizDue({ mnemonicQuizDueAt: undefined }, now)).toBe(false)
  })

  it('treats an unparseable stamp as not due rather than throwing', () => {
    // Bad data must not break queue construction for the whole session.
    expect(isRecallQuizDue({ mnemonicQuizDueAt: 'not-a-date' }, now)).toBe(false)
  })
})

describe('insertRecallQuizFirst', () => {
  it('front-loads a kanji already in the queue', () => {
    expect(insertRecallQuizFirst([5, 6, 7], 7)).toEqual([7, 5, 6])
  })

  it('slots in a kanji that is not otherwise due', () => {
    expect(insertRecallQuizFirst([5, 6], 9)).toEqual([9, 5, 6])
  })

  it('never duplicates', () => {
    expect(insertRecallQuizFirst([7], 7)).toEqual([7])
    expect(insertRecallQuizFirst([7, 7, 8], 7)).toEqual([7, 8])
  })

  it('preserves the order of everything else', () => {
    expect(insertRecallQuizFirst([1, 2, 3, 4], 3)).toEqual([3, 1, 2, 4])
  })

  it('handles an empty queue', () => {
    expect(insertRecallQuizFirst([], 9)).toEqual([9])
  })

  it('does not mutate the queue it was given', () => {
    const q = [1, 2, 3]
    insertRecallQuizFirst(q, 3)
    expect(q).toEqual([1, 2, 3])
  })
})
