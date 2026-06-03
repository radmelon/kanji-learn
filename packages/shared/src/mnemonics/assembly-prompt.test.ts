import { describe, it, expect } from 'vitest'
import { buildAssemblyPrompt, COCREATION_SYSTEM_PROMPT } from './assembly-prompt'
import type { AssemblerSlots } from './types'

const slots: AssemblerSlots = {
  kanji: '持', kanjiMeaning: 'hold', reading: 'もつ',
  components: [{ char: '扌', name: 'tehen', meaning: 'hand', imageKeyword: 'a hand grasping' }],
  locationName: 'Beppu Station', anchor: 'a yellow vending machine',
}

describe('buildAssemblyPrompt', () => {
  it('includes kanji, meaning, reading, components, place, and anchor', () => {
    const p = buildAssemblyPrompt(slots)
    expect(p).toContain('持')
    expect(p).toContain('hold')
    expect(p).toContain('もつ')
    expect(p).toContain('扌 (hand)')
    expect(p).toContain('Beppu Station')
    expect(p).toContain('a yellow vending machine')
  })
  it('notes "no mapped components" when components is empty', () => {
    expect(buildAssemblyPrompt({ ...slots, components: [] })).toContain('no mapped components')
  })
  it('appends optional personal detail + reading wordplay when present', () => {
    const p = buildAssemblyPrompt({ ...slots, personalDetail: 'a blue scarf', readingPlay: 'motsu→motorbike' })
    expect(p).toContain('a blue scarf')
    expect(p).toContain('motsu→motorbike')
  })
  it('has a non-empty system prompt', () => {
    expect(COCREATION_SYSTEM_PROMPT.length).toBeGreaterThan(0)
  })
})
