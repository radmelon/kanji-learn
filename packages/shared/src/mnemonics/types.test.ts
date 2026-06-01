import { describe, it, expect } from 'vitest'
import {
  EFFECTIVENESS_DEFAULT,
  EFFECTIVENESS_ALPHA,
  DEEPEN_MIN_REINFORCEMENTS,
  DEEPEN_SCORE_FLOOR,
  CHRONIC_LAPSE_THRESHOLD,
} from './types'

describe('mnemonics constants', () => {
  it('pin the agreed cadence + trigger thresholds', () => {
    expect(EFFECTIVENESS_DEFAULT).toBe(0.5)
    expect(EFFECTIVENESS_ALPHA).toBe(0.4)
    expect(DEEPEN_MIN_REINFORCEMENTS).toBe(2)
    expect(DEEPEN_SCORE_FLOOR).toBe(0.35)
    expect(CHRONIC_LAPSE_THRESHOLD).toBe(3)
  })
})
