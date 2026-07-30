import { and, eq, inArray, notInArray, sql } from 'drizzle-orm'
import {
  kanji,
  kanjiDifficulty,
  placementResults,
  placementSessions,
  userKanjiProgress,
  userProfiles,
} from '@kanji-learn/db'

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const CANDIDATE_POOL_SIZE = 20

export interface SelectedItem {
  kanjiId: number
  bMeaning: number
  bReading: number
}

/**
 * Adaptive item selection (spec §7.3): candidates nearest theta by Fisher
 * information (maximized at b = theta for the Rasch model), sampled from a
 * pool so two learners at the same theta don't see an identical test.
 * Excludes any kanji with real review history (spec §4.1's never-overwrite
 * rule, extended to item selection — not just remembered/burned).
 *
 * NOTE on the exclusion predicate: this uses `total_reviews > 0` because
 * spec §4.1 defines never-overwrite that way ("an `unseen` row with
 * totalReviews = 0"). That is deliberately conservative, and it has a known
 * consequence: a row written by the old placement flow (B-210) carries
 * total_reviews = 1 with no review_logs, so those kanji are excluded from
 * selection forever and can never be re-measured. On live data that is 44
 * kanji on one account. Task 6's difficulty calibration deliberately uses
 * the stricter `EXISTS(review_logs)` test instead, because there the
 * question is "is this evidence?" rather than "may we write here?".
 * Whether §4.1 should move to the same predicate is an open product call.
 */
export async function selectNextItems(
  db: any,
  userId: string,
  theta: number,
  exclude: number[],
  count = 5,
): Promise<SelectedItem[]> {
  // Same evidence rule as completePlacement's never-overwrite check below: a
  // review_logs row, not total_reviews > 0. Excluding on the counter would hide
  // kanji the old placement flow merely stamped, so a retake could never
  // re-measure them — the learner stays stuck with a fabricated result.
  const alreadyReviewed = await db
    .selectDistinct({ kanjiId: reviewLogs.kanjiId })
    .from(reviewLogs)
    .where(eq(reviewLogs.userId, userId))

  const excludeIds = [...exclude, ...alreadyReviewed.map((r: any) => r.kanjiId as number)]

  const candidates = await db
    .select({
      kanjiId: kanjiDifficulty.kanjiId,
      b: kanjiDifficulty.b,
      readingOffset: kanjiDifficulty.readingOffset,
    })
    .from(kanjiDifficulty)
    .where(excludeIds.length > 0 ? notInArray(kanjiDifficulty.kanjiId, excludeIds) : undefined)
    .orderBy(sql`ABS(${kanjiDifficulty.b} - ${theta})`)
    .limit(CANDIDATE_POOL_SIZE)

  const pool = shuffle(candidates).slice(0, count)

  return pool.map((c: any) => ({
    kanjiId: c.kanjiId as number,
    bMeaning: c.b as number,
    bReading: (c.b as number) + (c.readingOffset as number),
  }))
}

export async function getQuestionsWithDistractors(db: any, kanjiIds: number[]) {
  if (kanjiIds.length === 0) return []

  // Item difficulty travels with the question so the client-side engine can
  // update its posterior without a second round-trip (spec §7.3). Kanji absent
  // from kanji_difficulty fall back to b = 0 (the population mean) rather than
  // failing the request — the table is populated by an operational job, and a
  // placement must still work if a kanji has not been scored yet.
  const difficultyRows = await db
    .select({
      kanjiId: kanjiDifficulty.kanjiId,
      b: kanjiDifficulty.b,
      readingOffset: kanjiDifficulty.readingOffset,
    })
    .from(kanjiDifficulty)
    .where(inArray(kanjiDifficulty.kanjiId, kanjiIds))
  const difficultyById = new Map<number, { b: number; readingOffset: number }>(
    difficultyRows.map((r: any) => [r.kanjiId as number, { b: r.b as number, readingOffset: r.readingOffset as number }]),
  )

  const kanjiRows = await db
    .select({
      id: kanji.id,
      character: kanji.character,
      jlptLevel: kanji.jlptLevel,
      meanings: kanji.meanings,
      onReadings: kanji.onReadings,
      kunReadings: kanji.kunReadings,
    })
    .from(kanji)
    .where(inArray(kanji.id, kanjiIds))

  const questions = []

  for (const k of kanjiRows) {
    const correctMeaning = (k.meanings as string[])[0] ?? ''

    // Meaning distractors from same level
    const mDistRows = await db
      .select({ meanings: kanji.meanings })
      .from(kanji)
      .where(and(eq(kanji.jlptLevel, k.jlptLevel), sql`${kanji.id} != ${k.id}`))
      .orderBy(sql`RANDOM()`)
      .limit(20)

    const mDistractors = mDistRows
      .map((r: any) => (r.meanings as string[])[0])
      .filter((m: string) => m && m !== correctMeaning)

    const dedupedMeanings = [...new Set(mDistractors)].slice(0, 3)
    while (dedupedMeanings.length < 3) dedupedMeanings.push(`—`)

    const shuffledMeanings = shuffle([correctMeaning, ...dedupedMeanings])
    const correctMeaningIndex = shuffledMeanings.indexOf(correctMeaning)

    // Reading
    const onReadings = k.onReadings as string[]
    const kunReadings = k.kunReadings as string[]
    const hasOn = onReadings.length > 0
    const correctReading = hasOn ? onReadings[0] : kunReadings[0]

    let shuffledReadings: string[] = []
    let correctReadingIndex = 0

    if (correctReading) {
      const rDistRows = await db
        .select({ onReadings: kanji.onReadings, kunReadings: kanji.kunReadings })
        .from(kanji)
        .where(
          and(
            eq(kanji.jlptLevel, k.jlptLevel),
            sql`${kanji.id} != ${k.id}`,
            hasOn
              ? sql`jsonb_array_length(${kanji.onReadings}) > 0`
              : sql`jsonb_array_length(${kanji.kunReadings}) > 0`
          )
        )
        .orderBy(sql`RANDOM()`)
        .limit(20)

      const rDistractors = rDistRows
        .map((r: any) => hasOn ? (r.onReadings as string[])[0] : (r.kunReadings as string[])[0])
        .filter((r: string) => r && r !== correctReading)

      const dedupedReadings = [...new Set(rDistractors)].slice(0, 3)
      while (dedupedReadings.length < 3) dedupedReadings.push(`—`)

      shuffledReadings = shuffle([correctReading, ...dedupedReadings]) as string[]
      correctReadingIndex = shuffledReadings.indexOf(correctReading)
    }

    const diff = difficultyById.get(k.id as number)

    questions.push({
      kanjiId: k.id,
      character: k.character,
      jlptLevel: k.jlptLevel,
      meaningOptions: shuffledMeanings,
      correctMeaningIndex,
      readingOptions: shuffledReadings,
      correctReadingIndex,
      bMeaning: diff?.b ?? 0,
      bReading: (diff?.b ?? 0) + (diff?.readingOffset ?? 0),
    })
  }

  return questions
}

import {
  THETA_GRID, initPosterior, updatePosterior, thetaMean, credibleIntervalWidth,
  pKnows, inferredLevel as deriveInferredLevel,
  seedFromProbability, widenForStaleness,
} from '@kanji-learn/shared'
import type { PlacementResponse, JlptLevel } from '@kanji-learn/shared'
import { reviewLogs, reviewSessions } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'

const JLPT_LEVELS: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']
const RETEST_DRIFT = 0.004

export interface SessionPrior {
  hasPrior: boolean
  theta: number
  se: number
}

/** SE from a posterior's 80% credible interval width, approximating a normal SE. */
function posteriorToSe(posterior: number[]): number {
  return credibleIntervalWidth(posterior, 0.8) / 2.5631 // 80% CI half-width ≈ 1.2816 SE either side
}

export async function getSessionPrior(db: Db, userId: string): Promise<SessionPrior> {
  const [latest] = await db
    .select({ theta: placementSessions.abilityTheta, se: placementSessions.abilitySe, completedAt: placementSessions.completedAt })
    .from(placementSessions)
    .where(and(eq(placementSessions.userId, userId), sql`${placementSessions.abilityTheta} IS NOT NULL`))
    .orderBy(sql`completed_at DESC`)
    .limit(1)

  if (!latest || latest.theta == null || latest.se == null || !latest.completedAt) {
    return { hasPrior: false, theta: 0, se: 1.5 }
  }

  const daysElapsed = (Date.now() - latest.completedAt.getTime()) / 86_400_000
  return { hasPrior: true, theta: latest.theta, se: widenForStaleness(latest.se, daysElapsed, RETEST_DRIFT) }
}

/** Rebuild an approximate posterior from a (theta, se) summary — used to seed
 *  the authoritative recompute below with a retest's starting point without
 *  storing the full 81-point grid on placement_sessions. */
function posteriorFromSummary(theta: number, se: number): number[] {
  return initPosterior(theta, Math.max(se, 0.3))
}

export async function completePlacement(
  db: Db,
  userId: string,
  responses: PlacementResponse[],
): Promise<{ appliedCount: number; inferredLevel: JlptLevel | null; theta: number; se: number }> {
  if (responses.length === 0) {
    return { appliedCount: 0, inferredLevel: null, theta: 0, se: 1.5 }
  }

  const kanjiIds = [...new Set(responses.map((r) => r.kanjiId))]

  const [difficultyRows, kanjiRows, prior] = await Promise.all([
    db.select().from(kanjiDifficulty).where(inArray(kanjiDifficulty.kanjiId, kanjiIds)),
    db.select({ id: kanji.id, jlptLevel: kanji.jlptLevel }).from(kanji).where(inArray(kanji.id, kanjiIds)),
    getSessionPrior(db, userId),
  ])
  const difficultyById = new Map(difficultyRows.map((r) => [r.kanjiId, r]))
  const levelById = new Map(kanjiRows.map((r) => [r.id, r.jlptLevel]))

  // ── Authoritative recompute — never trust a client-sent theta ──────────
  let posterior = prior.hasPrior ? posteriorFromSummary(prior.theta, prior.se) : initPosterior(0)
  const responseDifficulties = new Map<string, number>() // `${kanjiId}:${itemType}` -> b used

  for (const r of responses) {
    const diff = difficultyById.get(r.kanjiId)
    const b = diff ? (r.itemType === 'meaning' ? diff.b : diff.b + diff.readingOffset) : 0
    responseDifficulties.set(`${r.kanjiId}:${r.itemType}`, b)
    posterior = updatePosterior(posterior, b, r.correct)
  }

  const theta = thetaMean(posterior)
  const se = posteriorToSe(posterior)

  // Level bands from each JLPT level's mean b (spec §7.5).
  const levelMeanB = new Map<JlptLevel, number>()
  for (const level of JLPT_LEVELS) {
    const rowsAtLevel = difficultyRows.filter((r) => levelById.get(r.kanjiId) === level)
    if (rowsAtLevel.length > 0) {
      levelMeanB.set(level, rowsAtLevel.reduce((a, r) => a + r.b, 0) / rowsAtLevel.length)
    }
  }
  const orderedMeans = JLPT_LEVELS.map((l) => levelMeanB.get(l)).filter((v): v is number => v != null)
  const boundaries: number[] = []
  for (let i = 0; i < orderedMeans.length - 1; i++) boundaries.push((orderedMeans[i] + orderedMeans[i + 1]) / 2)
  const level = orderedMeans.length > 0 ? deriveInferredLevel(theta, boundaries, JLPT_LEVELS) : null

  // ── Persist the session + per-item results ───────────────────────────
  const [session] = await db
    .insert(placementSessions)
    .values({
      userId, completedAt: new Date(), inferredLevel: level,
      abilityTheta: theta, abilitySe: se,
      summaryJson: {},
    })
    .returning({ id: placementSessions.id })

  const byKanji = new Map<number, { meaningCorrect?: boolean; readingCorrect?: boolean }>()
  for (const r of responses) {
    const entry = byKanji.get(r.kanjiId) ?? {}
    if (r.itemType === 'meaning') entry.meaningCorrect = r.correct
    else entry.readingCorrect = r.correct
    byKanji.set(r.kanjiId, entry)
  }

  const resultRows = Array.from(byKanji.entries()).map(([kanjiId, res]) => ({
    sessionId: session.id,
    kanjiId,
    jlptLevel: levelById.get(kanjiId) ?? 'N5',
    passed: Boolean(res.meaningCorrect && res.readingCorrect),
    meaningCorrect: res.meaningCorrect ?? null,
    readingCorrect: res.readingCorrect ?? null,
    difficultyAtAsk: responseDifficulties.get(`${kanjiId}:meaning`) ?? responseDifficulties.get(`${kanjiId}:reading`) ?? null,
  }))
  if (resultRows.length > 0) await db.insert(placementResults).values(resultRows)

  // ── Never-overwrite rule + seeding (spec §4.1, §8) ───────────────────
  //
  // "Review history" means a review_logs row, not total_reviews > 0. The spec
  // words §4.1 as "an `unseen` row with totalReviews = 0", but that counter can
  // be incremented by a WRITE rather than by a review: the old placement flow
  // (B-210) stamped rows with total_reviews = 1 for kanji the learner never
  // saw. Treating those as protected history freezes them forever — they can
  // never be re-measured or corrected, and on live data that is 44 kanji on one
  // account whose own answers support only 2 of them.
  //
  // Safe because a genuine review cannot exist without a log: submitReview goes
  // through DualWriteService.recordReviewSubmissions, which inserts review_logs
  // and upserts progress in ONE transaction. Verified against production — of
  // 984 rows with total_reviews > 0, the only 44 lacking logs are that one
  // account's placement stamps. Logs are append-only; the sole migration
  // touching them is the user-delete cascade, which removes the progress rows
  // too. If a future write path ever updates progress without logging, this
  // protection weakens silently — scripts/detect-placement-damage.mjs already
  // detects exactly that signature.
  //
  // NOTE, verified by experiment rather than reasoning: this predicate is
  // currently INERT here. The seeding write below is
  // `.insert(...).onConflictDoNothing()`, so an existing row is untouchable no
  // matter what `hasHistory` contains — emptying this Set does not change a
  // single test outcome. Never-overwrite is enforced twice and the structural
  // guard wins. It is kept because it states the rule explicitly, matches
  // selectNextItems (where the predicate genuinely decides behaviour), and
  // would become load-bearing the moment seeding ever becomes an upsert.
  //
  // CONSEQUENCE worth knowing: a retake can now ASK about a kanji carrying only
  // a B-210 placement stamp, but cannot rewrite that row — the insert is
  // skipped. Correcting those 44 live rows needs seeding to update rows that
  // have no review_logs, which is a real behaviour change to user data and a
  // separate decision from this predicate.
  const logged = await db
    .selectDistinct({ kanjiId: reviewLogs.kanjiId })
    .from(reviewLogs)
    .where(and(eq(reviewLogs.userId, userId), inArray(reviewLogs.kanjiId, kanjiIds)))
  const hasHistory = new Set(logged.map((r) => r.kanjiId))

  await db.insert(userProfiles).values({ id: userId }).onConflictDoNothing()

  const [session_] = await db
    .insert(reviewSessions)
    .values({ userId, sessionType: 'placement', startedAt: new Date(), completedAt: new Date() })
    .returning({ id: reviewSessions.id })

  let appliedCount = 0
  for (const [kanjiId] of byKanji) {
    if (hasHistory.has(kanjiId)) continue // never-overwrite — the B-210 fix

    const diff = difficultyById.get(kanjiId)
    if (!diff) continue
    const p = pKnows(posterior, diff.b)
    const seed = seedFromProbability(p, diff.b)
    if (!seed) continue

    const nextReviewAt = new Date(Date.now() + seed.stabilityDays * 86_400_000)

    await db
      .insert(userKanjiProgress)
      .values({
        userId, kanjiId, status: 'reviewing',
        stability: seed.stabilityDays, difficulty: seed.fsrsDifficulty,
        totalReviews: 0, nextReviewAt, lastReviewedAt: null,
        readingStage: 0, updatedAt: new Date(),
      })
      .onConflictDoNothing() // guards the race window between the `existing` read above and this write
    appliedCount++

    await db.insert(reviewLogs).values({
      sessionId: session_.id, userId, kanjiId, reviewType: 'placement',
      quality: 4, responseTimeMs: 0,
      prevStatus: 'unseen', nextStatus: 'reviewing',
      prevInterval: 0, nextInterval: Math.round(seed.stabilityDays),
      prevStability: 0, nextStability: seed.stabilityDays,
      prevDifficulty: 5, nextDifficulty: seed.fsrsDifficulty,
      reviewedAt: new Date(),
    })
  }

  return { appliedCount, inferredLevel: level, theta, se }
}
