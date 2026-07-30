import { JLPT_KANJI_COUNTS } from './constants'
import type { JlptLevel } from './types'

// ─── JLPT global rank ───────────────────────────────────────────────────────

const JLPT_LEVEL_ORDER: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']

/** Cumulative kanji count of every level BEFORE the given level, in N5→N1 order. */
function levelOffset(level: JlptLevel): number {
  let offset = 0
  for (const l of JLPT_LEVEL_ORDER) {
    if (l === level) return offset
    offset += JLPT_KANJI_COUNTS[l]
  }
  return offset
}

/** A single global ordinal across all 5 JLPT levels, N5=1..79, N4=80..245, etc. */
export function computeJlptRank(level: JlptLevel, jlptOrder: number): number {
  return levelOffset(level) + jlptOrder
}

// ─── z-scoring ──────────────────────────────────────────────────────────────

export function zScore(value: number, mean: number, sd: number): number {
  if (sd === 0) return 0
  return (value - mean) / sd
}

// ─── Feature model ──────────────────────────────────────────────────────────

export interface KanjiFeatures {
  jlptLevel: JlptLevel
  jlptRank: number
  frequencyRank: number | null
  grade: number | null
  strokeCount: number
  componentsCount: number
  readingCount: number
}

interface MeanSd { mean: number; sd: number }

export interface FeatureStats {
  jlptRank: MeanSd
  logFrequencyRank: MeanSd
  grade: MeanSd
  strokeCount: MeanSd
  readingCount: MeanSd
  /** Per-level means, used to fill null grade/frequencyRank (spec §6.3). */
  levelMeans: Record<JlptLevel, { grade: number; frequencyRank: number }>
}

function meanSd(values: number[]): MeanSd {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length
  return { mean, sd: Math.sqrt(variance) }
}

export function computeFeatureStats(all: KanjiFeatures[]): FeatureStats {
  const logFreq = (f: KanjiFeatures) => Math.log((f.frequencyRank ?? 2500) + 1)

  const levelMeans = {} as Record<JlptLevel, { grade: number; frequencyRank: number }>
  for (const level of JLPT_LEVEL_ORDER) {
    const rows = all.filter((f) => f.jlptLevel === level)
    const grades = rows.map((f) => f.grade).filter((g): g is number => g != null)
    const freqs = rows.map((f) => f.frequencyRank).filter((r): r is number => r != null)
    levelMeans[level] = {
      grade: grades.length > 0 ? grades.reduce((a, b) => a + b, 0) / grades.length : 5,
      frequencyRank: freqs.length > 0 ? freqs.reduce((a, b) => a + b, 0) / freqs.length : 1000,
    }
  }

  const resolvedGrade = (f: KanjiFeatures) => f.grade ?? levelMeans[f.jlptLevel].grade
  const resolvedFreq = (f: KanjiFeatures) => f.frequencyRank ?? levelMeans[f.jlptLevel].frequencyRank

  return {
    jlptRank: meanSd(all.map((f) => f.jlptRank)),
    logFrequencyRank: meanSd(all.map((f) => Math.log(resolvedFreq(f) + 1))),
    grade: meanSd(all.map((f) => resolvedGrade(f))),
    strokeCount: meanSd(all.map((f) => f.strokeCount)),
    readingCount: meanSd(all.map((f) => f.readingCount)),
    levelMeans,
  }
}

/** Six regression weights: intercept + one per feature (spec §6.3). */
export interface DifficultyWeights {
  w0: number // intercept
  w1: number // jlptRank
  w2: number // log frequencyRank
  w3: number // grade
  w4: number // strokeCount
  w5: number // readingCount
}

/**
 * Hand-set fallback (spec §6.3's fallback rule). All five feature weights are
 * positive: rarer, later-grade, more-stroke, more-reading kanji are harder.
 * jlptRank dominates (0.6) since JLPT level is the primary difficulty signal;
 * the rest are secondary correlates.
 */
export const DEFAULT_DIFFICULTY_WEIGHTS: DifficultyWeights = {
  w0: 0,
  w1: 0.6,
  w2: 0.3,
  w3: 0.2,
  w4: 0.2,
  w5: 0.15,
}

export function bPrior(
  features: KanjiFeatures,
  stats: FeatureStats,
  weights: DifficultyWeights,
): number {
  const grade = features.grade ?? stats.levelMeans[features.jlptLevel].grade
  const freq = features.frequencyRank ?? stats.levelMeans[features.jlptLevel].frequencyRank
  const logFreq = Math.log(freq + 1)

  return (
    weights.w0 +
    weights.w1 * zScore(features.jlptRank, stats.jlptRank.mean, stats.jlptRank.sd) +
    weights.w2 * zScore(logFreq, stats.logFrequencyRank.mean, stats.logFrequencyRank.sd) +
    weights.w3 * zScore(grade, stats.grade.mean, stats.grade.sd) +
    weights.w4 * zScore(features.strokeCount, stats.strokeCount.mean, stats.strokeCount.sd) +
    weights.w5 * zScore(features.readingCount, stats.readingCount.mean, stats.readingCount.sd)
  )
}

// ─── Blending (spec §6.2) ───────────────────────────────────────────────────

export function blend(bPriorValue: number, bObserved: number, n: number, k: number): number {
  if (n === 0) return bPriorValue
  return (n * bObserved + k * bPriorValue) / (n + k)
}

// ─── FSRS mapping ───────────────────────────────────────────────────────────

/**
 * b and FSRS difficulty share a common center (b=0 ↔ FSRS midpoint 5) but
 * different scales — b is a roughly [-4,4] logit, FSRS difficulty is [1,10].
 * A direct 1:1 offset from the shared center needs no invented scale factor
 * and is defensible for the range of b values placement items actually
 * produce (items are selected near θ, not at the extremes).
 */
export function bToFsrsDifficulty(b: number): number {
  return Math.min(10, Math.max(1, 5 + b))
}

// ─── Seeding (spec §8) ──────────────────────────────────────────────────────

export interface PlacementSeed {
  status: 'reviewing'
  stabilityDays: number
  fsrsDifficulty: number
}

const SEED_THRESHOLD = 0.85
const SEED_STABILITY_MIN = 3
const SEED_STABILITY_MAX = 21

export function seedFromProbability(p: number, b: number): PlacementSeed | null {
  if (p < SEED_THRESHOLD) return null
  const stabilityDays =
    SEED_STABILITY_MIN +
    (SEED_STABILITY_MAX - SEED_STABILITY_MIN) * ((p - SEED_THRESHOLD) / (1 - SEED_THRESHOLD))
  return { status: 'reviewing', stabilityDays, fsrsDifficulty: bToFsrsDifficulty(b) }
}

// ─── Retest staleness (spec §10) ────────────────────────────────────────────

const DEFAULT_DRIFT = 0.004 // logits/day — see spec §10 for the reasoning

export function widenForStaleness(se: number, daysElapsed: number, drift = DEFAULT_DRIFT): number {
  return Math.sqrt(se ** 2 + (drift * daysElapsed) ** 2)
}
