import { describe, it, expect } from 'vitest'
import { fitWeights, shouldUseFallback, type FitRow } from './placement-difficulty-fit'
import {
  DEFAULT_DIFFICULTY_WEIGHTS, bPrior, computeFeatureStats, zScore,
  type KanjiFeatures,
} from './placement-difficulty'
import type { JlptLevel } from './types'

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

  // The intercept was the one coefficient this suite did not assert, and it is
  // the only one that carries the SCALE. syntheticRows generates its target as
  // `y + 5` — an FSRS difficulty, because that is what user_kanji_progress
  // stores — so a fit performed on the raw column returns w0 = TRUE.w0 + 5.
  // Every consumer of DifficultyWeights (bPrior → probCorrect, THETA_GRID,
  // bToFsrsDifficulty) treats the output as a logit centred on 0, so w0 must
  // come back on the b scale.
  it('returns an intercept on the b scale, not the FSRS 1-10 scale', () => {
    const fitted = fitWeights(syntheticRows(500))
    expect(fitted.w0).toBeCloseTo(TRUE_WEIGHTS.w0, 1)
  })
})

// ─── The seam: fitWeights → bPrior ──────────────────────────────────────────
//
// Both halves were individually correct and the composition was not, which is
// the failure mode this branch keeps meeting. fitWeights consumed an FSRS-scale
// column; bPrior published a logit. Nothing between them ever compared the two.
//
// This is also the branch the integration suite cannot reach: the local test
// database holds 10 rows against MIN_ROWS = 300, so shouldUseFallback is always
// true there and the fitted path never executes. Live had 945 rows.

const LEVELS: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']

/** A synthetic kanji population spanning all five levels, deterministic. */
function syntheticPopulation(n: number): KanjiFeatures[] {
  return Array.from({ length: n }, (_, i) => ({
    jlptLevel: LEVELS[Math.min(LEVELS.length - 1, Math.floor((i * LEVELS.length) / n))],
    jlptRank: i + 1,
    frequencyRank: 50 + i * 6,
    grade: 1 + Math.floor((i * 8) / n),
    strokeCount: 3 + (i % 18),
    componentsCount: 1 + (i % 4),
    readingCount: 1 + (i % 6),
  }))
}

/** True difficulty on the b scale — no intercept, so a correct fit recovers
 *  w0 ≈ 0 and bPrior comes back centred on 0. */
const TRUE_B = { w1: 0.6, w2: 0.3, w3: 0.2, w4: 0.2, w5: 0.15 }

describe('fitted weights feeding bPrior', () => {
  it('produces b values on the theta scale, inside the [-4, 4] grid', () => {
    const population = syntheticPopulation(400)
    const stats = computeFeatureStats(population)

    const z = (f: KanjiFeatures) => ({
      zJlptRank: zScore(f.jlptRank, stats.jlptRank.mean, stats.jlptRank.sd),
      zLogFreq: zScore(Math.log(f.frequencyRank! + 1), stats.logFrequencyRank.mean, stats.logFrequencyRank.sd),
      zGrade: zScore(f.grade!, stats.grade.mean, stats.grade.sd),
      zStrokeCount: zScore(f.strokeCount, stats.strokeCount.mean, stats.strokeCount.sd),
      zReadingCount: zScore(f.readingCount, stats.readingCount.mean, stats.readingCount.sd),
    })

    // What the database actually holds: an FSRS difficulty, centred on 5,
    // generated from a b-scale truth (the b=0 ↔ FSRS 5 identity that
    // bToFsrsDifficulty documents).
    const rows: FitRow[] = population.map((f) => {
      const zs = z(f)
      const trueB =
        TRUE_B.w1 * zs.zJlptRank + TRUE_B.w2 * zs.zLogFreq + TRUE_B.w3 * zs.zGrade +
        TRUE_B.w4 * zs.zStrokeCount + TRUE_B.w5 * zs.zReadingCount
      return { ...zs, fsrsDifficulty: 5 + trueB }
    })

    const fitted = fitWeights(rows)
    // The fitted branch must be the one under test — otherwise this asserts
    // nothing about it.
    expect(shouldUseFallback(rows, fitted)).toBe(false)

    const bs = population.map((f) => bPrior(f, stats, fitted))
    const mean = bs.reduce((a, b) => a + b, 0) / bs.length

    expect(mean).toBeCloseTo(0, 1)
    // The symptom on live: b averaged 7.5 and only 285 of 2294 kanji landed
    // inside the grid, so no item could ever sit near theta.
    expect(bs.every((b) => b >= -4 && b <= 4)).toBe(true)
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
