import { describe, it, expect } from 'vitest'
import { assembleTemplate } from './assembler'
import { lookupComponents } from './radical-dictionary'
import type { AssemblerSlots } from './types'

const mochi: AssemblerSlots = {
  kanji: '持',
  kanjiMeaning: 'hold',
  reading: 'もつ',
  components: lookupComponents(['扌', '寺']),
  locationName: 'Beppu Station',
  anchor: 'a yellow vending machine',
}

describe('assembleTemplate', () => {
  it('includes the location, anchor, reading, and every component meaning', () => {
    const story = assembleTemplate(mochi)
    expect(story).toContain('Beppu Station')
    expect(story).toContain('a yellow vending machine')
    expect(story).toContain('もつ')
    expect(story).toContain('hand')   // 扌
    expect(story).toContain('temple') // 寺
    expect(story).toContain('持')
  })

  it('is deterministic for the same slots', () => {
    expect(assembleTemplate(mochi)).toBe(assembleTemplate(mochi))
  })

  it('uses different frames for different kanji (no mad-libs sameness)', () => {
    const other: AssemblerSlots = { ...mochi, kanji: '林', kanjiMeaning: 'woods', reading: 'はやし' }
    // Frame choice is a function of the kanji char; these two chars must select different frames.
    const a = assembleTemplate(mochi).replace(/持/g, 'X').replace(/もつ/g, 'Y').replace('hold', 'Z')
    const b = assembleTemplate(other).replace(/林/g, 'X').replace(/はやし/g, 'Y').replace('woods', 'Z')
    expect(a).not.toBe(b)
  })

  it('degrades gracefully when no components map', () => {
    const story = assembleTemplate({ ...mochi, components: [] })
    expect(story).toContain('Beppu Station')
    expect(story).toContain('もつ')
    expect(story).toContain('持')
    expect(story.length).toBeGreaterThan(0)
  })
})
