import { describe, it, expect } from 'vitest'
import {
  EFFECTIVENESS_DEFAULT,
  EFFECTIVENESS_ALPHA,
  DEEPEN_MIN_REINFORCEMENTS,
  DEEPEN_SCORE_FLOOR,
  CHRONIC_LAPSE_THRESHOLD,
} from './types'
import type { CoCreationContext } from './types'

describe('mnemonics constants', () => {
  it('pin the agreed cadence + trigger thresholds', () => {
    expect(EFFECTIVENESS_DEFAULT).toBe(0.5)
    expect(EFFECTIVENESS_ALPHA).toBe(0.4)
    expect(DEEPEN_MIN_REINFORCEMENTS).toBe(2)
    expect(DEEPEN_SCORE_FLOOR).toBe(0.35)
    expect(CHRONIC_LAPSE_THRESHOLD).toBe(3)
  })
})

describe('CoCreationContext', () => {
  it('accepts a fully-populated layered context', () => {
    const ctx: CoCreationContext = {
      layers: [
        { questions: ['Look around — what catches your eye?'], answers: ['a yellow vending machine'], anchor: 'a yellow vending machine', source: 'environment' },
        { questions: ['What does this connect to?'], answers: ['my old bike'], source: 'known_knowledge' },
      ],
      layerCount: 2,
      locationName: 'Beppu Station',
      components: [{ char: '扌', meaning: 'hand' }, { char: '寺', meaning: 'temple' }],
      generatedBy: 'cloud',
      mnemonicQuizDueAt: '2026-06-01T00:00:00.000Z',
      timeOfDay: 'evening',
    }
    expect(ctx.layerCount).toBe(ctx.layers.length)
    expect(ctx.components.map((c) => c.char)).toEqual(['扌', '寺'])
    expect(ctx.generatedBy).toBe('cloud')
  })
})
