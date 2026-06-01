import { describe, it, expect } from 'vitest'
import { selectDistractors, type DistractorKanji } from './distractors'

const target: DistractorKanji = { kanjiId: 100, radicals: ['扌', '寺'], jlpt: 5 }

const pool: DistractorKanji[] = [
  { kanjiId: 101, radicals: ['扌', '木'], jlpt: 5 }, // shares 扌
  { kanjiId: 102, radicals: ['寺', '日'], jlpt: 4 }, // shares 寺
  { kanjiId: 103, radicals: ['水'],       jlpt: 5 }, // same level, no shared radical
  { kanjiId: 104, radicals: ['火'],       jlpt: 3 }, // neither
  { kanjiId: 100, radicals: ['扌', '寺'], jlpt: 5 }, // the target itself — must be excluded
]

describe('selectDistractors', () => {
  it('never includes the target kanji', () => {
    const ids = selectDistractors(target, pool, 3)
    expect(ids).not.toContain(100)
  })

  it('prefers radical-sharers first', () => {
    const ids = selectDistractors(target, pool, 2)
    expect(ids).toEqual([101, 102])
  })

  it('fills from same-JLPT once sharers run out', () => {
    const ids = selectDistractors(target, pool, 3)
    expect(ids).toEqual([101, 102, 103])
  })

  it('falls back to anything to reach count', () => {
    const ids = selectDistractors(target, pool, 4)
    expect(ids).toEqual([101, 102, 103, 104])
  })

  it('returns fewer than count if the pool is too small, without duplicates', () => {
    const ids = selectDistractors(target, [pool[0]], 3)
    expect(ids).toEqual([101])
    expect(new Set(ids).size).toBe(ids.length)
  })
})
