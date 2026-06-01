import { describe, it, expect } from 'vitest'
import { RADICAL_DICTIONARY, lookupComponents } from './radical-dictionary'

describe('RADICAL_DICTIONARY integrity', () => {
  it('every entry has a non-empty name, meaning, and imageKeyword', () => {
    for (const [char, e] of Object.entries(RADICAL_DICTIONARY)) {
      expect(e.char, `char field matches key for ${char}`).toBe(char)
      expect(e.name.length, `name for ${char}`).toBeGreaterThan(0)
      expect(e.meaning.length, `meaning for ${char}`).toBeGreaterThan(0)
      expect(e.imageKeyword.length, `imageKeyword for ${char}`).toBeGreaterThan(0)
    }
  })

  it('covers a baseline set of high-frequency radicals', () => {
    // These appear across early N5 kanji and are exercised by the assembler tests.
    const required = ['人', '亻', '扌', '寺', '水', '氵', '木', '火', '日', '口', '心', '忄']
    for (const r of required) {
      expect(RADICAL_DICTIONARY[r], `missing required radical ${r}`).toBeDefined()
    }
  })
})

describe('lookupComponents', () => {
  it('maps known chars to entries and drops unknown ones', () => {
    const out = lookupComponents(['扌', '寺', '〇unknown'])
    expect(out.map((e) => e.char)).toEqual(['扌', '寺'])
  })

  it('returns [] when nothing maps (assembler must degrade gracefully)', () => {
    expect(lookupComponents(['〇zzz'])).toEqual([])
  })
})
