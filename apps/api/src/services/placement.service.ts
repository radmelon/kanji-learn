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
  pKnows, inferredLevel as deriveInferredLevel, levelBands,
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

  // The whole difficulty corpus, with each kanji's level attached. Loaded once
  // and reused three times below: the per-response `b`, the level bands, and
  // seeding. Seeding already read the full table unconditionally further down,
  // so this is one query where there were three — not a new cost.
  const [corpus, prior] = await Promise.all([
    db
      .select({
        kanjiId: kanjiDifficulty.kanjiId,
        b: kanjiDifficulty.b,
        readingOffset: kanjiDifficulty.readingOffset,
        level: kanji.jlptLevel,
      })
      .from(kanjiDifficulty)
      .innerJoin(kanji, eq(kanji.id, kanjiDifficulty.kanjiId)),
    getSessionPrior(db, userId),
  ])
  const difficultyById = new Map(corpus.map((r) => [r.kanjiId, r]))

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

  // ── Level bands come from the CORPUS, not the asked items (B147) ─────────
  //
  // Same mistake, same file, one function over from the seeding bug 2cab737
  // fixed. These means were computed from the ~10 items the test asked, then
  // `.filter()`ed to drop levels with no representative — leaving boundaries
  // for a SHORTER ladder while the label was still read out of the full
  // five-level list. The index and the labels disagreed by however many levels
  // had dropped out below.
  //
  // Item selection maximises Fisher information, so it asks near the learner's
  // ability: a strong learner is never asked an N5 item, so N5/N4 drop out,
  // and their index-1 band — really N2 — was reported as N4. The stronger the
  // learner, the fewer easy levels survive, the lower the level they are told.
  // That is the B146 device report ("N4 even though I got most correct"), and
  // it is inverted, not merely noisy.
  //
  // levelBands returns boundaries and labels as one aligned pair so the two
  // cannot be sourced separately again. Bands are a property of the corpus;
  // deriving them from an adaptive sample makes each learner's yardstick their
  // own answers.
  const bands = levelBands(corpus, JLPT_LEVELS)
  const level = bands.levels.length > 0 ? deriveInferredLevel(theta, bands.boundaries, bands.levels) : null

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
    jlptLevel: difficultyById.get(kanjiId)?.level ?? 'N5',
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

  // ── Seeding runs over the CORPUS, not the asked items (B146) ─────────────
  //
  // This loop used to iterate `byKanji` — the ~10 kanji the test asked about.
  // But selectNextItems maximises Fisher information, which peaks at b ≈ theta,
  // while seedFromProbability requires p(knows) >= 0.85, i.e. b <= theta - 1.386.
  // Those sets are disjoint, so an adaptive test could never seed anything, for
  // any learner, at any ability.
  //
  // Found on device: a real session's asked difficulties ran -0.39..+0.10 against
  // a bar of b <= -1.16, while 151 corpus kanji cleared that bar unasked. The
  // learner was told "0 kanji recognized" in the same response that inferred N4.
  //
  // The ability estimate generalises across the corpus by construction — that is
  // what a latent-trait model is for — so the posterior is the right thing to
  // evaluate every kanji against, not just the sample that produced it.
  // `corpus`, loaded once at the top — this used to be a second full-table read.

  // Everything the learner already has, not just the asked set. Stricter than
  // the reviewLogs predicate above and it subsumes it: a row is protected
  // whether or not it carries history, which is what onConflictDoNothing
  // enforced structurally anyway.
  const owned = await db
    .select({ kanjiId: userKanjiProgress.kanjiId })
    .from(userKanjiProgress)
    .where(eq(userKanjiProgress.userId, userId))
  const alreadyHas = new Set<number>(owned.map((r) => r.kanjiId))
  for (const k of hasHistory) alreadyHas.add(k)

  const seedsByKanji = new Map<number, ReturnType<typeof seedFromProbability>>()
  for (const diff of corpus) {
    if (alreadyHas.has(diff.kanjiId)) continue
    const seed = seedFromProbability(pKnows(posterior, diff.b), diff.b)
    if (seed) seedsByKanji.set(diff.kanjiId, seed)
  }

  // Batched. Row-at-a-time cost ~400ms against the transaction pooler, so a
  // strong learner seeding 150 kanji would have held the request open for a
  // minute.
  const now = Date.now()
  const inserted =
    seedsByKanji.size === 0
      ? []
      : await db
          .insert(userKanjiProgress)
          .values(
            Array.from(seedsByKanji.entries()).map(([kanjiId, seed]) => ({
              userId, kanjiId, status: 'reviewing' as const,
              stability: seed!.stabilityDays, difficulty: seed!.fsrsDifficulty,
              totalReviews: 0,
              nextReviewAt: new Date(now + seed!.stabilityDays * 86_400_000),
              lastReviewedAt: null, readingStage: 0, updatedAt: new Date(),
            })),
          )
          .onConflictDoNothing() // guards the race between the read above and this write
          .returning({ kanjiId: userKanjiProgress.kanjiId })

  // Count what was actually written. The old counter incremented before an
  // onConflictDoNothing that may have skipped the row, so for any returning
  // learner it reported writes that never happened.
  const appliedCount = inserted.length

  if (inserted.length > 0) {
    await db.insert(reviewLogs).values(
      inserted.map(({ kanjiId }) => {
        const seed = seedsByKanji.get(kanjiId)!
        return {
          sessionId: session_.id, userId, kanjiId, reviewType: 'placement' as const,
          quality: 4, responseTimeMs: 0,
          prevStatus: 'unseen' as const, nextStatus: 'reviewing' as const,
          prevInterval: 0, nextInterval: Math.round(seed.stabilityDays),
          prevStability: 0, nextStability: seed.stabilityDays,
          prevDifficulty: 5, nextDifficulty: seed.fsrsDifficulty,
          reviewedAt: new Date(),
        }
      }),
    )
  }

  return { appliedCount, inferredLevel: level, theta, se }
}
