import { describe, it, expect } from 'vitest'
import { fitWeights, shouldUseFallback, type FitRow } from './placement-difficulty-fit'
import { DEFAULT_DIFFICULTY_WEIGHTS } from './placement-difficulty'

// Synthetic rows generated from a KNOWN weight vector plus tiny noise, so a
// correct OLS implementation should recover something close to it.
const TRUE_WEIGHTS = { w0: 1, w1: 0.8, w2: 0.4, w3: 0.3, w4: 0.25, w5: 0.2 }

function syntheticRows(n: number): FitRow[] {
  const rows: FitRow[] = []
  for (let i = 0; i < n; i++) {
    const z = [
      Math.sin(i) * 2, Math.cos(i) * 2, Math.sin(i * 0.5) * 2,
      Math.cos(i * 0.7) * 2, Math.sin(i * 0.3) * 2,
    ]
    const y =
      TRUE_WEIGHTS.w0 +
      TRUE_WEIGHTS.w1 * z[0] + TRUE_WEIGHTS.w2 * z[1] + TRUE_WEIGHTS.w3 * z[2] +
      TRUE_WEIGHTS.w4 * z[3] + TRUE_WEIGHTS.w5 * z[4] +
      (((i * 9301 + 49297) % 233280) / 233280 - 0.5) * 0.05 // deterministic tiny noise
    rows.push({ zJlptRank: z[0], zLogFreq: z[1], zGrade: z[2], zStrokeCount: z[3], zReadingCount: z[4], fsrsDifficulty: y + 5 })
  }
  return rows
}

describe('fitWeights', () => {
  it('recovers weights close to the generating vector on clean synthetic data', () => {
    const fitted = fitWeights(syntheticRows(500))
    expect(fitted.w1).toBeCloseTo(TRUE_WEIGHTS.w1, 1)
    expect(fitted.w2).toBeCloseTo(TRUE_WEIGHTS.w2, 1)
  })
})

describe('shouldUseFallback', () => {
  it('is true below 300 rows', () => {
    expect(shouldUseFallback(syntheticRows(299), DEFAULT_DIFFICULTY_WEIGHTS)).toBe(true)
  })
  it('is false at 300+ rows with well-signed weights', () => {
    const rows = syntheticRows(500)
    const fitted = fitWeights(rows)
    expect(shouldUseFallback(rows, fitted)).toBe(false)
  })
  it('is true when any weight has the wrong sign (would make a rarer kanji easier)', () => {
    const wrongSigned = { ...DEFAULT_DIFFICULTY_WEIGHTS, w1: -0.6 }
    expect(shouldUseFallback(syntheticRows(500), wrongSigned)).toBe(true)
  })
})
