import { describe, it, expect } from 'vitest'
import { rankGlosses, glossKey, glossesOverlap, GLOSS_SET_SEPARATOR } from './gloss'

/**
 * Real rows from the live corpus, verbatim (2026-08-02). `meanings` is stored
 * alphabetically, so `meanings[0]` — what both instruments used to key on —
 * is a clock hour or a proper noun for the most common kanji in the language.
 * These are the exact seven in B-229's table.
 */
const LIVE = {
  土: ['Turkey', 'earth', 'ground', 'soil'],
  子: ['11PM-1AM', 'child', 'first sign of Chinese zodiac', 'sign of the rat'],
  日: ['Japan', 'counter for days', 'day', 'sun'],
  午: ['11AM-1PM', 'noon', 'seventh sign of Chinese zodiac', 'sign of the horse'],
  名: ['distinguished', 'name', 'noted', 'reputation'],
  休: ['day off', 'rest', 'retire', 'sleep'],
  来: ['become', 'cause', 'come', 'due', 'next'],
  毛: ['down', 'feather', 'fur', 'hair'],
} as const

describe('rankGlosses', () => {
  it('demotes glosses that lead with a digit or a capital', () => {
    expect(rankGlosses(LIVE.土)[0]).not.toBe('Turkey')
    expect(rankGlosses(LIVE.子)[0]).not.toBe('11PM-1AM')
    expect(rankGlosses(LIVE.日)[0]).not.toBe('Japan')
  })

  it('keeps every gloss — demotion is not removal', () => {
    expect(rankGlosses(LIVE.土).sort()).toEqual([...LIVE.土].sort())
  })

  it('orders shorter before longer within a tier', () => {
    expect(rankGlosses(LIVE.毛)).toEqual(['fur', 'down', 'hair', 'feather'])
  })

  it('preserves stored order as the final tiebreak', () => {
    expect(rankGlosses(['bbb', 'aaa'])).toEqual(['bbb', 'aaa'])
  })

  it('drops blanks and case-insensitive duplicates', () => {
    expect(rankGlosses(['earth', '  ', 'Earth', 'soil'])).toEqual(['soil', 'earth'])
  })

  it('falls back to the artifact glosses when they are all there is', () => {
    expect(rankGlosses(['Japan', 'Tokyo'])).toEqual(['Japan', 'Tokyo'])
  })
})

describe('glossKey', () => {
  it('renders a set containing the sense a learner would actually name', () => {
    expect(glossKey(LIVE.土)).toContain('earth')
    expect(glossKey(LIVE.子)).toContain('child')
    expect(glossKey(LIVE.日)).toContain('day')
    expect(glossKey(LIVE.午)).toContain('noon')
    expect(glossKey(LIVE.名)).toContain('name')
    expect(glossKey(LIVE.休)).toContain('rest')
    expect(glossKey(LIVE.来)).toContain('come')
    expect(glossKey(LIVE.毛)).toContain('hair')
  })

  it('never renders the alphabetical artifact as the whole answer', () => {
    expect(glossKey(LIVE.土)).not.toBe('Turkey')
    expect(glossKey(LIVE.子)).not.toBe('11PM-1AM')
  })

  /**
   * B-229's verification criterion #2, as a unit assertion: an item may only be
   * keyed on a `^[0-9A-Z]` gloss when every gloss for that kanji is one.
   */
  it('never leads with a digit/capital gloss unless every gloss is one', () => {
    for (const meanings of Object.values(LIVE)) {
      const key = glossKey(meanings)
      const allArtifact = meanings.every((m) => /^[0-9A-Z]/.test(m))
      if (!allArtifact) expect(key).not.toMatch(/^[0-9A-Z]/)
    }
    expect(glossKey(['Japan', 'Tokyo'])).toMatch(/^[0-9A-Z]/)
  })

  it('caps the set at three glosses so the option stays readable', () => {
    expect(glossKey(LIVE.来).split(GLOSS_SET_SEPARATOR)).toHaveLength(3)
  })

  it('stops early rather than exceed the length budget', () => {
    const key = glossKey(LIVE.子)
    expect(key).toBe('child / sign of the rat')
    expect(key.length).toBeLessThanOrEqual(48)
  })

  it('always keeps at least one gloss, however long', () => {
    const long = 'a'.repeat(120)
    expect(glossKey([long])).toBe(long)
  })

  it('returns empty string for a kanji with no usable glosses', () => {
    expect(glossKey([])).toBe('')
    expect(glossKey(['', '   '])).toBe('')
  })
})

describe('glossesOverlap', () => {
  it('detects a shared sense so the distractor can be rejected', () => {
    expect(glossesOverlap(LIVE.土, ['ground', 'floor'])).toBe(true)
  })

  it('ignores case and surrounding whitespace', () => {
    expect(glossesOverlap(['earth'], [' EARTH '])).toBe(true)
  })

  it('is false for genuinely distinct kanji', () => {
    expect(glossesOverlap(LIVE.土, LIVE.毛)).toBe(false)
  })

  it('is false when either side is empty', () => {
    expect(glossesOverlap([], LIVE.土)).toBe(false)
    expect(glossesOverlap(LIVE.土, [])).toBe(false)
  })
})
