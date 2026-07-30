import { sql } from 'drizzle-orm'
import { kanji, kanjiDifficulty } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import {
  computeJlptRank, computeFeatureStats, bPrior, blend,
  DEFAULT_DIFFICULTY_WEIGHTS, type KanjiFeatures, type DifficultyWeights,
} from '@kanji-learn/shared'
import { fitWeights, shouldUseFallback, type FitRow } from '@kanji-learn/shared'

const SHRINKAGE_K = 20
/** Fixed global constant, not per-kanji — a per-kanji reading offset is
 *  exactly the parameter five accounts cannot support (spec §5/§6.3). This
 *  starting value (positive: reading is harder than meaning) is a hand-set
 *  default pending calibration from review_logs' meaning/reading split;
 *  that calibration is deliberately deferred (spec §9.1) and not built here. */
const DEFAULT_READING_OFFSET = 0.4

export interface RefreshResult {
  kanjiCount: number
  usedFallback: boolean
  observedRows: number
}

export async function refreshKanjiDifficulty(db: Db): Promise<RefreshResult> {
  const kanjiRows = await db
    .select({
      id: kanji.id,
      jlptLevel: kanji.jlptLevel,
      jlptOrder: kanji.jlptOrder,
      grade: kanji.grade,
      frequencyRank: kanji.frequencyRank,
      strokeCount: kanji.strokeCount,
      components: kanji.components,
      onReadings: kanji.onReadings,
      kunReadings: kanji.kunReadings,
    })
    .from(kanji)

  const featuresById = new Map<number, KanjiFeatures>()
  for (const k of kanjiRows) {
    const onCount = (k.onReadings as string[]).length
    const kunCount = (k.kunReadings as string[]).length
    featuresById.set(k.id, {
      jlptLevel: k.jlptLevel,
      jlptRank: computeJlptRank(k.jlptLevel, k.jlptOrder),
      frequencyRank: k.frequencyRank,
      grade: k.grade,
      strokeCount: k.strokeCount,
      componentsCount: (k.components as string[]).length,
      readingCount: onCount + kunCount,
    })
  }

  const stats = computeFeatureStats(Array.from(featuresById.values()))

  // Pooled fit rows: one per (user, kanji) progress row with real review
  // history — spec §6.3, "pooled across all learners".
  //
  // Evidence is a review_logs row, NOT total_reviews > 0. The old placement
  // flow (B-210) wrote progress rows with total_reviews = 1 for kanji the
  // learner never reviewed, so that counter can be incremented by a write
  // rather than by an actual review. On live data 44 of 984 rows (4.5%) are
  // exactly this, and they would contribute a fabricated difficulty of 5.0
  // (b = 0, the population mean) with real weight — 40 kanji would have had
  // their observed difficulty derived from nothing else at all.
  //
  // review_logs is the same predicate scripts/detect-placement-damage.mjs
  // uses to separate genuine history from a placement stamp. The current
  // placement flow (Task 8) writes total_reviews = 0, so this also stops the
  // model's own seeds from ever feeding back in as evidence.
  const fitSourceRows = await db.execute(sql`
    SELECT p.kanji_id AS "kanjiId", p.difficulty AS "fsrsDifficulty"
      FROM user_kanji_progress p
     WHERE EXISTS (
       SELECT 1 FROM review_logs l
        WHERE l.user_id = p.user_id AND l.kanji_id = p.kanji_id
     )
  `)

  const fitRows: FitRow[] = []
  for (const row of fitSourceRows as unknown as { kanjiId: number; fsrsDifficulty: number }[]) {
    const features = featuresById.get(row.kanjiId)
    if (!features) continue
    const grade = features.grade ?? stats.levelMeans[features.jlptLevel].grade
    const freq = features.frequencyRank ?? stats.levelMeans[features.jlptLevel].frequencyRank
    fitRows.push({
      zJlptRank: (features.jlptRank - stats.jlptRank.mean) / (stats.jlptRank.sd || 1),
      zLogFreq: (Math.log(freq + 1) - stats.logFrequencyRank.mean) / (stats.logFrequencyRank.sd || 1),
      zGrade: (grade - stats.grade.mean) / (stats.grade.sd || 1),
      zStrokeCount: (features.strokeCount - stats.strokeCount.mean) / (stats.strokeCount.sd || 1),
      zReadingCount: (features.readingCount - stats.readingCount.mean) / (stats.readingCount.sd || 1),
      fsrsDifficulty: row.fsrsDifficulty,
    })
  }

  let weights: DifficultyWeights = DEFAULT_DIFFICULTY_WEIGHTS
  let usedFallback = true
  if (fitRows.length > 0) {
    const fitted = fitWeights(fitRows)
    usedFallback = shouldUseFallback(fitRows, fitted)
    if (!usedFallback) weights = fitted
  }

  // b_observed: mean FSRS difficulty per kanji, mapped back onto the b scale
  // via the inverse of bToFsrsDifficulty (b = fsrsDifficulty - 5). n_i is the
  // total review count for that kanji across all learners (spec §6.2).
  // Same evidence rule as the fit query above — see the note there.
  const observedByKanji = await db.execute(sql`
    SELECT p.kanji_id AS "kanjiId",
           AVG(p.difficulty) AS "avgDifficulty",
           SUM(p.total_reviews) AS "totalReviews"
      FROM user_kanji_progress p
     WHERE EXISTS (
       SELECT 1 FROM review_logs l
        WHERE l.user_id = p.user_id AND l.kanji_id = p.kanji_id
     )
     GROUP BY p.kanji_id
  `)
  const observedMap = new Map<number, { bObserved: number; n: number }>()
  for (const row of observedByKanji as unknown as { kanjiId: number; avgDifficulty: string; totalReviews: string }[]) {
    observedMap.set(row.kanjiId, {
      bObserved: Number(row.avgDifficulty) - 5,
      n: Number(row.totalReviews),
    })
  }

  const upsertValues = kanjiRows.map((k) => {
    const features = featuresById.get(k.id)!
    const prior = bPrior(features, stats, weights)
    const observed = observedMap.get(k.id)
    const n = observed?.n ?? 0
    const blended = n > 0 ? blend(prior, observed!.bObserved, n, SHRINKAGE_K) : prior
    return {
      kanjiId: k.id,
      bPrior: prior,
      bObserved: observed?.bObserved ?? null,
      observedN: n,
      b: blended,
      readingOffset: DEFAULT_READING_OFFSET,
    }
  })

  for (const row of upsertValues) {
    await db
      .insert(kanjiDifficulty)
      .values({ ...row, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: kanjiDifficulty.kanjiId,
        set: {
          bPrior: row.bPrior, bObserved: row.bObserved, observedN: row.observedN,
          b: row.b, readingOffset: row.readingOffset, updatedAt: new Date(),
        },
      })
  }

  return { kanjiCount: upsertValues.length, usedFallback, observedRows: fitRows.length }
}
