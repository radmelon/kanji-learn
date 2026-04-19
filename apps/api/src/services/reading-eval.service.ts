/**
 * reading-eval.service.ts
 *
 * Evaluates a spoken Japanese reading against one or more correct readings.
 * Uses wanakana to normalise input (romaji / katakana → hiragana) before
 * comparison, and returns an SM-2 quality score (0–5) and human-readable
 * feedback string.
 */

import { toHiragana } from 'wanakana'
import { containsCJK, expandReadings, type KanjiReadingsIndex } from './kanji-readings-index.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export type Quality = 0 | 1 | 2 | 3 | 4 | 5

export interface EvalResult {
  /** Normalised version of what was heard */
  normalizedSpoken:  string
  /** The closest correct reading (for feedback) */
  closestCorrect:    string
  /** Whether the answer is accepted as correct */
  correct:           boolean
  /** SM-2 quality score 0–5 fed back to the SRS engine */
  quality:           Quality
  /** Short human-readable feedback shown to the learner */
  feedback:          string
}

// ─── Levenshtein distance ─────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  // Build (m+1) × (n+1) DP table with base cases
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

// ─── Normalise ────────────────────────────────────────────────────────────────

function normalise(input: string): string {
  // Strip whitespace, lower-case, then convert any romaji / katakana to hiragana
  return toHiragana(input.trim().toLowerCase())
}

// ─── Evaluator ────────────────────────────────────────────────────────────────

/**
 * @param spoken           Raw transcript from the speech recogniser
 * @param correctReadings  Array of accepted hiragana readings (e.g. ['みず', 'すい'])
 * @param strict           If true, near-matches are NOT accepted (used for level checkpoints)
 * @param kanjiIndex       Optional in-memory kanji→readings index. When provided,
 *                         CJK characters in the transcript (iOS recognizer output)
 *                         are expanded to candidate phonetic strings and compared.
 */
export function evaluateReading(
  spoken: string,
  correctReadings: string[],
  strict = false,
  kanjiIndex?: KanjiReadingsIndex,
): EvalResult {
  if (!correctReadings.length) {
    return {
      normalizedSpoken: '',
      closestCorrect:   '',
      correct:          false,
      quality:          0,
      feedback:         'No correct readings provided.',
    }
  }

  const normalizedSpoken = normalise(spoken)

  // ── Exact match ─────────────────────────────────────────────────────────
  if (correctReadings.some((r) => normalise(r) === normalizedSpoken)) {
    return {
      normalizedSpoken,
      closestCorrect: normalizedSpoken,
      correct:        true,
      quality:        5,
      feedback:       'Perfect.',
    }
  }

  // ── Homophone workaround: expand any CJK chars via the kanji index ──────
  // Runs only when the index is provided and the transcript still contains
  // CJK after wanakana normalise. Matches against any correctReading → accept.
  if (kanjiIndex && containsCJK(normalizedSpoken)) {
    const normalizedCorrect = correctReadings.map(normalise)
    const candidates = expandReadings(normalizedSpoken, kanjiIndex)
    for (const raw of candidates) {
      const c = normalise(raw)
      if (normalizedCorrect.includes(c)) {
        return {
          normalizedSpoken: c,
          closestCorrect:   c,
          correct:          true,
          quality:          5,
          feedback:         'Perfect.',
        }
      }
    }
  }

  // ── Find closest reading (for near-match and feedback) ──────────────────
  const { reading: closestCorrect, dist } = correctReadings.reduce<{
    reading: string
    dist: number
  }>(
    (best, r) => {
      const d = levenshtein(normalise(r), normalizedSpoken)
      return d < best.dist ? { reading: r, dist: d } : best
    },
    { reading: correctReadings[0], dist: Infinity }
  )

  // ── Near match: 1-character edit distance ───────────────────────────────
  // Accepted in normal mode; rejected in strict mode (checkpoints)
  if (dist === 1 && !strict) {
    return {
      normalizedSpoken,
      closestCorrect,
      correct:  true,
      quality:  3,
      feedback: 'Close — check your vowel length.',
    }
  }

  // ── Wrong ────────────────────────────────────────────────────────────────
  const heardStr = normalizedSpoken || '(nothing)'
  return {
    normalizedSpoken,
    closestCorrect,
    correct:  false,
    quality:  dist <= 3 ? 2 : 1,
    feedback: `Heard "${heardStr}" — the reading is ${closestCorrect}.`,
  }
}

// ─── Batch helper ─────────────────────────────────────────────────────────────

export interface BatchItem {
  spoken:          string
  correctReadings: string[]
  strict?:         boolean
}

export function evaluateReadingBatch(items: BatchItem[]): EvalResult[] {
  return items.map((item) =>
    evaluateReading(item.spoken, item.correctReadings, item.strict)
  )
}
