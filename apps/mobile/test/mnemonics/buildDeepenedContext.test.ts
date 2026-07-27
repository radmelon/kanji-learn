import {
  buildDeepenedContext,
  THREAD_PROMPTS,
} from '../../src/mnemonics/buildDeepenedContext'
import type { CoCreationContext } from '@kanji-learn/shared'

const base: CoCreationContext = {
  layers: [
    {
      questions: ['Look around — what is one thing that catches your eye?'],
      answers: ['a yellow vending machine'],
      anchor: 'a yellow vending machine',
      source: 'environment',
    },
  ],
  layerCount: 1,
  locationName: 'Beppu Station',
  components: [
    { char: '扌', meaning: 'hand' },
    { char: '寺', meaning: 'temple' },
  ],
  generatedBy: 'template',
  mnemonicQuizDueAt: '2026-07-01T00:00:00Z',
}

const NOW = '2026-07-27T12:00:00Z'

describe('buildDeepenedContext — additive, never destructive (parent spec §6.3)', () => {
  it('appends a layer rather than replacing', () => {
    const next = buildDeepenedContext(base, 'known_knowledge', 'my old flat in Osaka', 'cloud', NOW)
    expect(next.layers).toHaveLength(2)
    expect(next.layerCount).toBe(2)
  })

  it('leaves the original layer byte-for-byte intact', () => {
    const next = buildDeepenedContext(base, 'known_knowledge', 'x', 'cloud', NOW)
    expect(next.layers[0]).toEqual(base.layers[0])
  })

  it('tags the new layer with the chosen thread source', () => {
    const known = buildDeepenedContext(base, 'known_knowledge', 'x', 'cloud', NOW)
    expect(known.layers[1].source).toBe('known_knowledge')

    const env = buildDeepenedContext(base, 'environment', 'a yellow shirt', 'cloud', NOW)
    expect(env.layers[1].source).toBe('environment')
  })

  it('records the question that was actually asked', () => {
    const next = buildDeepenedContext(base, 'known_knowledge', 'my old flat', 'cloud', NOW)
    expect(next.layers[1].questions).toEqual([THREAD_PROMPTS.known_knowledge])
    expect(next.layers[1].answers).toEqual(['my old flat'])
  })

  it('re-stamps mnemonicQuizDueAt — a deepened hook earns a fresh quick-check', () => {
    // The stale 2026-07-01 stamp must not survive; parent spec §8 stamps on
    // create OR deepen, and the plan originally missed the deepen half.
    const next = buildDeepenedContext(base, 'known_knowledge', 'x', 'cloud', NOW)
    expect(next.mnemonicQuizDueAt).toBe(NOW)
  })

  it('records the tier that produced THIS layer, not the original', () => {
    const next = buildDeepenedContext(base, 'known_knowledge', 'x', 'on_device', NOW)
    expect(next.generatedBy).toBe('on_device')
    expect(base.generatedBy).toBe('template') // input untouched
  })

  it('preserves components and locationName — the API requires them', () => {
    const next = buildDeepenedContext(base, 'known_knowledge', 'x', 'cloud', NOW)
    expect(next.components).toEqual(base.components)
    expect(next.locationName).toBe('Beppu Station')
  })

  it('does not mutate the context it was given', () => {
    const snapshot = JSON.parse(JSON.stringify(base))
    buildDeepenedContext(base, 'environment', 'x', 'cloud', NOW)
    expect(base).toEqual(snapshot)
  })

  it('keeps stacking across repeated deepens', () => {
    let ctx = buildDeepenedContext(base, 'known_knowledge', 'first', 'cloud', NOW)
    ctx = buildDeepenedContext(ctx, 'environment', 'second', 'template', NOW)
    expect(ctx.layerCount).toBe(3)
    expect(ctx.layers.map((l) => l.source)).toEqual([
      'environment', 'known_knowledge', 'environment',
    ])
  })

  it('offers a distinct prompt per thread', () => {
    expect(THREAD_PROMPTS.environment).not.toBe(THREAD_PROMPTS.known_knowledge)
    // Copy discipline: additive language only, never rebuild/replace/discard.
    for (const p of Object.values(THREAD_PROMPTS)) {
      expect(p.toLowerCase()).not.toMatch(/rebuild|replace|discard|start over/)
    }
  })
})
