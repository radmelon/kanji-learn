import { fsrsDifficultyToB, type DifficultyWeights } from './placement-difficulty'

/** One (user, kanji) progress row, pre-resolved to z-scored features — the
 *  unit of the pooled regression (spec §6.3: "pooled across all learners"). */
export interface FitRow {
  zJlptRank: number
  zLogFreq: number
  zGrade: number
  zStrokeCount: number
  zReadingCount: number
  fsrsDifficulty: number // the target — user_kanji_progress.difficulty
}

const MIN_ROWS = 300
const MIN_R_SQUARED = 0.15

/** 6x6 Gauss-Jordan solve — small enough to hand-implement rather than add a
 *  linear-algebra dependency for six parameters. */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])

  for (let col = 0; col < n; col++) {
    let pivotRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivotRow][col])) pivotRow = row
    }
    ;[M[col], M[pivotRow]] = [M[pivotRow], M[col]]

    const pivot = M[col][col]
    if (Math.abs(pivot) < 1e-12) continue // singular column — leave as 0
    for (let k = col; k <= n; k++) M[col][k] /= pivot

    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = M[row][col]
      for (let k = col; k <= n; k++) M[row][k] -= factor * M[col][k]
    }
  }

  return M.map((row) => row[n])
}

export function fitWeights(rows: FitRow[]): DifficultyWeights {
  // Design matrix X (intercept + 5 features), target y. Normal equations:
  // (X^T X) w = X^T y.
  const X = rows.map((r) => [1, r.zJlptRank, r.zLogFreq, r.zGrade, r.zStrokeCount, r.zReadingCount])
  // The target is converted to the b scale, because the DifficultyWeights this
  // returns are consumed by bPrior, whose output is a logit centred on 0.
  // Fitting the raw FSRS column puts its ~5 midpoint into the intercept.
  const y = rows.map((r) => fsrsDifficultyToB(r.fsrsDifficulty))

  const p = 6
  const XtX: number[][] = Array.from({ length: p }, () => Array(p).fill(0))
  const Xty: number[] = Array(p).fill(0)

  for (let i = 0; i < rows.length; i++) {
    for (let a = 0; a < p; a++) {
      Xty[a] += X[i][a] * y[i]
      for (let bIdx = 0; bIdx < p; bIdx++) {
        XtX[a][bIdx] += X[i][a] * X[i][bIdx]
      }
    }
  }

  const [w0, w1, w2, w3, w4, w5] = solveLinearSystem(XtX, Xty)
  return { w0, w1, w2, w3, w4, w5 }
}

function rSquared(rows: FitRow[], weights: DifficultyWeights): number {
  // Same scale as fitWeights' target — a prediction on the b scale compared
  // against a raw FSRS value would inflate ssRes by the 5-point offset and
  // send R² sharply negative, tripping the fallback on a healthy fit.
  const ys = rows.map((r) => fsrsDifficultyToB(r.fsrsDifficulty))
  const yMean = ys.reduce((a, y) => a + y, 0) / ys.length
  let ssRes = 0
  let ssTot = 0
  rows.forEach((r, i) => {
    const predicted =
      weights.w0 + weights.w1 * r.zJlptRank + weights.w2 * r.zLogFreq +
      weights.w3 * r.zGrade + weights.w4 * r.zStrokeCount + weights.w5 * r.zReadingCount
    ssRes += (ys[i] - predicted) ** 2
    ssTot += (ys[i] - yMean) ** 2
  })
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot
}

/**
 * Spec §6.3's explicit fallback rule: fewer than 300 pooled rows, adjusted
 * R² < 0.15, or any weight whose sign contradicts domain expectation (rarer,
 * later-grade, more-stroke, more-reading must all make a kanji HARDER —
 * every feature weight must be non-negative). Checked explicitly because a
 * wrong-signed weight would quietly corrupt every seeded card.
 */
export function shouldUseFallback(rows: FitRow[], fitted: DifficultyWeights): boolean {
  if (rows.length < MIN_ROWS) return true
  if (rSquared(rows, fitted) < MIN_R_SQUARED) return true
  if (fitted.w1 < 0 || fitted.w2 < 0 || fitted.w3 < 0 || fitted.w4 < 0 || fitted.w5 < 0) return true
  return false
}
