import { and, eq, lte, gte, isNull, or, asc, desc, gt, inArray, sql } from 'drizzle-orm'
import {
  userKanjiProgress,
  kanji,
  reviewSessions,
  reviewLogs,
  userProfiles,
  learnerIdentity,
} from '@kanji-learn/db'
import { calculateNextReview, createNewCard } from '@kanji-learn/shared'
import type { Db } from '@kanji-learn/db'
import type { ReviewResult } from '@kanji-learn/shared'
import { SURPRISE_BURNED_CHECK_RATE } from '@kanji-learn/shared'
import { DualWriteService, type ReviewSubmissionInput } from './buddy/dual-write.service'
import type { SrsStatus } from './buddy/constants'

// ─── Types ────────────────────────────────────────────────────────────────────

export type { ReviewQueueItem, VoicePrompt, VoicePromptVocab } from '@kanji-learn/shared'
import type { ReviewQueueItem, VoicePrompt } from '@kanji-learn/shared'

export interface SessionSummary {
  sessionId: string
  totalItems: number
  correctItems: number
  studyTimeMs: number
  newLearned: number
  burned: number
}

type ExampleVocabEntry = {
  word: string
  reading: string
  meaning: string
  pitchPattern?: number[]
}

export function selectVoicePrompt(
  exampleVocab: ExampleVocabEntry[] | null,
  reviewCount: number,
  targetKanji: string,
): VoicePrompt {
  if (!exampleVocab?.length) return { type: 'kanji' }
  const idx = (reviewCount ?? 0) % exampleVocab.length
  return { type: 'vocab', ...exampleVocab[idx], targetKanji }
}

// ─── SRS Service ──────────────────────────────────────────────────────────────

export class SrsService {
  constructor(
    private db: Db,
    private readonly dualWrite: DualWriteService
  ) {}

  // ── Build daily review queue ────────────────────────────────────────────────

  async getReviewQueue(userId: string, limit = 20): Promise<ReviewQueueItem[]> {
    const now = new Date()

    // 1. Due reviews: next_review_at <= now
    const dueCards = await this.db
      .select({
        kanjiId: userKanjiProgress.kanjiId,
        status: userKanjiProgress.status,
        readingStage: userKanjiProgress.readingStage,
        character: kanji.character,
        jlptLevel: kanji.jlptLevel,
        meanings: kanji.meanings,
        kunReadings: kanji.kunReadings,
        onReadings: kanji.onReadings,
        exampleVocab: kanji.exampleVocab,
        exampleSentences: kanji.exampleSentences,
        strokeCount: kanji.strokeCount,
        radicals: kanji.radicals,
        nelsonClassic: kanji.nelsonClassic,
        nelsonNew: kanji.nelsonNew,
        morohashiIndex: kanji.morohashiIndex,
        morohashiVolume: kanji.morohashiVolume,
        morohashiPage: kanji.morohashiPage,
      })
      .from(userKanjiProgress)
      .innerJoin(kanji, eq(userKanjiProgress.kanjiId, kanji.id))
      .where(
        and(
          eq(userKanjiProgress.userId, userId),
          lte(userKanjiProgress.nextReviewAt, now),
          or(
            eq(userKanjiProgress.status, 'learning'),
            eq(userKanjiProgress.status, 'reviewing'),
            eq(userKanjiProgress.status, 'remembered')
          )
        )
      )
      .orderBy(asc(userKanjiProgress.nextReviewAt))
      .limit(limit)

    // 2. New unseen cards to fill remaining slots
    const remaining = limit - dueCards.length
    const newCards =
      remaining > 0
        ? await this.db
            .select({
              kanjiId: kanji.id,
              character: kanji.character,
              jlptLevel: kanji.jlptLevel,
              meanings: kanji.meanings,
              kunReadings: kanji.kunReadings,
              onReadings: kanji.onReadings,
              exampleVocab: kanji.exampleVocab,
        exampleSentences: kanji.exampleSentences,
              strokeCount: kanji.strokeCount,
              radicals: kanji.radicals,
              nelsonClassic: kanji.nelsonClassic,
              nelsonNew: kanji.nelsonNew,
              morohashiIndex: kanji.morohashiIndex,
              morohashiVolume: kanji.morohashiVolume,
              morohashiPage: kanji.morohashiPage,
            })
            .from(kanji)
            .where(
              sql`${kanji.id} NOT IN (
                SELECT kanji_id FROM user_kanji_progress WHERE user_id = ${userId}
              )`
            )
            .orderBy(asc(kanji.jlptLevel), asc(kanji.jlptOrder))
            .limit(remaining)
        : []

    // 3. Surprise burned checks (~12%)
    const surpriseCount = Math.ceil(limit * SURPRISE_BURNED_CHECK_RATE)
    const burnedChecks = await this.db
      .select({
        kanjiId: userKanjiProgress.kanjiId,
        status: userKanjiProgress.status,
        readingStage: userKanjiProgress.readingStage,
        character: kanji.character,
        jlptLevel: kanji.jlptLevel,
        meanings: kanji.meanings,
        kunReadings: kanji.kunReadings,
        onReadings: kanji.onReadings,
        exampleVocab: kanji.exampleVocab,
        exampleSentences: kanji.exampleSentences,
        strokeCount: kanji.strokeCount,
        radicals: kanji.radicals,
        nelsonClassic: kanji.nelsonClassic,
        nelsonNew: kanji.nelsonNew,
        morohashiIndex: kanji.morohashiIndex,
        morohashiVolume: kanji.morohashiVolume,
        morohashiPage: kanji.morohashiPage,
      })
      .from(userKanjiProgress)
      .innerJoin(kanji, eq(userKanjiProgress.kanjiId, kanji.id))
      .where(and(eq(userKanjiProgress.userId, userId), eq(userKanjiProgress.status, 'burned')))
      .orderBy(sql`RANDOM()`)
      .limit(surpriseCount)

    // Combine and assign review types.
    // kunReadings/onReadings/exampleVocab/exampleSentences are null-coalesced here
    // so the client never receives null for array fields — accessing .length on null
    // throws a JS TypeError that React Native reports as RCTFatal.
    // Array.isArray() guards are required here — `?? []` only catches null/undefined.
    // If a jsonb column contains a non-array value (e.g. a string) `??` passes it
    // through, and the client then calls .map()/.join() on a string → RCTFatal.
    const toArr = <T,>(v: unknown): T[] => Array.isArray(v) ? v as T[] : []

    const queue: ReviewQueueItem[] = [
      ...dueCards.map((c) => ({
        ...c,
        status: c.status ?? 'learning',
        readingStage: c.readingStage ?? 0,
        reviewType: this.pickReviewType(c.readingStage ?? 0, c.status ?? 'learning'),
        meanings: toArr<string>(c.meanings),
        kunReadings: toArr<string>(c.kunReadings),
        onReadings: toArr<string>(c.onReadings),
        radicals: toArr<string>(c.radicals),
        exampleVocab: toArr<{ word: string; reading: string; meaning: string }>(c.exampleVocab),
        exampleSentences: toArr<{ ja: string; en: string; vocab: string }>(c.exampleSentences),
      })),
      ...newCards.map((c) => ({
        ...c,
        status: 'unseen' as const,
        readingStage: 0,
        reviewType: 'meaning' as const,
        meanings: toArr<string>(c.meanings),
        kunReadings: toArr<string>(c.kunReadings),
        onReadings: toArr<string>(c.onReadings),
        radicals: toArr<string>(c.radicals),
        exampleVocab: toArr<{ word: string; reading: string; meaning: string }>(c.exampleVocab),
        exampleSentences: toArr<{ ja: string; en: string; vocab: string }>(c.exampleSentences),
      })),
      ...burnedChecks.map((c) => ({
        ...c,
        status: c.status ?? 'burned',
        readingStage: c.readingStage ?? 4,
        reviewType: this.pickReviewType(c.readingStage ?? 4, 'burned'),
        meanings: toArr<string>(c.meanings),
        kunReadings: toArr<string>(c.kunReadings),
        onReadings: toArr<string>(c.onReadings),
        radicals: toArr<string>(c.radicals),
        exampleVocab: toArr<{ word: string; reading: string; meaning: string }>(c.exampleVocab),
        exampleSentences: toArr<{ ja: string; en: string; vocab: string }>(c.exampleSentences),
      })),
    ]

    return queue
  }

  // ── Submit a batch of review results ───────────────────────────────────────

  /**
   * Submit a batch of review results.
   *
   * Transaction boundary is PER SESSION. All writes (review_logs,
   * user_kanji_progress, learner_knowledge_state, learner_timeline_events)
   * for the whole session are committed or rolled back together via
   * `DualWriteService.recordReviewSubmissions`.
   *
   * Previously the service ran one transaction per review result, which
   * produced ~7 DB round-trips per card. On cross-region Postgres (us-east-1
   * API ↔ ap-southeast-2 Supabase) this compounded to ~45 seconds for a
   * 20-card session. The batched path collapses it to ~6 round-trips for
   * the whole session regardless of size.
   *
   * Atomicity trade-off: if ANY row fails, the whole session rolls back
   * (the singular per-review path is still available via
   * `DualWriteService.recordReviewSubmission` for callers that need
   * per-review atomicity). The mobile client already retries at the session
   * level via an offline queue, so session-rollback is transparent in
   * practice — and kanjiId validation runs before any write, catching the
   * most likely failure mode before it can abort the session.
   */
  async submitReview(
    userId: string,
    results: ReviewResult[],
    studyTimeMs: number
  ): Promise<SessionSummary> {
    const sessionId = crypto.randomUUID()
    const now = new Date()
    let newLearned = 0
    let burned = 0
    let correctItems = 0

    // Cap study time per session to protect against client-side timer bugs
    // (e.g. app backgrounded mid-session and clock kept running). Clamp to
    // 30 seconds per reviewed item with a hard ceiling of 60 min. Legitimate
    // study almost never exceeds ~10s/card; this cap only kicks in on outliers.
    const MAX_MS_PER_ITEM = 30_000
    const MAX_SESSION_MS = 60 * 60_000 // 60 minutes
    const perItemCap = Math.max(results.length, 1) * MAX_MS_PER_ITEM
    const cap = Math.min(perItemCap, MAX_SESSION_MS)
    if (studyTimeMs > cap) {
      console.warn(`[srs.submitReview] capping studyTimeMs for userId=${userId}: ${studyTimeMs}ms → ${cap}ms (${results.length} items)`)
      studyTimeMs = cap
    }

    // Ensure user profile row exists (created on first review submission)
    await this.db
      .insert(userProfiles)
      .values({ id: userId })
      .onConflictDoNothing()

    // Ensure learner_identity row exists. The dual-write below mirrors into
    // learner_knowledge_state which has an FK on learner_identity.learner_id;
    // creating it here makes submitReview self-sufficient regardless of
    // whether the Phase 0 backfill (Task 20) has run for this user.
    await this.db
      .insert(learnerIdentity)
      .values({ learnerId: userId })
      .onConflictDoNothing()

    // Create session record
    await this.db.insert(reviewSessions).values({
      id: sessionId,
      userId,
      startedAt: new Date(now.getTime() - studyTimeMs),
      totalItems: results.length,
      studyTimeMs,
      sessionType: 'daily',
    })

    const kanjiIds = results.map((r) => r.kanjiId)

    // Batch-fetch the kanji characters for all results in one query so the
    // dual-write call can construct UKG "kanji:<character>" subjects without
    // a per-iteration lookup.
    const kanjiRows = kanjiIds.length > 0
      ? await this.db
          .select({ id: kanji.id, character: kanji.character })
          .from(kanji)
          .where(inArray(kanji.id, kanjiIds))
      : []
    const charById = new Map(kanjiRows.map((r) => [r.id, r.character]))

    // Batch-fetch all existing UKG rows in ONE query (instead of N findFirst
    // calls inside the loop). For a 20-card session this alone saves 19
    // cross-region round trips.
    const existingRows = kanjiIds.length > 0
      ? await this.db
          .select()
          .from(userKanjiProgress)
          .where(
            and(
              eq(userKanjiProgress.userId, userId),
              inArray(userKanjiProgress.kanjiId, kanjiIds),
            )
          )
      : []
    const existingByKanjiId = new Map(existingRows.map((r) => [r.kanjiId, r]))

    // Compute SRS math in-memory for every review, then hand the full batch
    // to the plural dual-write for a single-transaction persist.
    const submissionInputs: ReviewSubmissionInput[] = []
    for (const result of results) {
      const existing = existingByKanjiId.get(result.kanjiId)
      const prevCard = existing ?? createNewCard()
      const prevStatus = prevCard.status
      const srsResult = calculateNextReview(prevCard, result.quality)

      // quality 4 (Good) and 5 (Easy) = confident recall; quality 3 (Hard) = remembered but with difficulty (not counted as "correct" for accuracy display)
      if (result.quality >= 4) correctItems++
      if (prevStatus === 'unseen' || prevStatus === undefined) newLearned++
      if (srsResult.status === 'burned' && prevStatus !== 'burned') burned++

      const prevReadingStage = existing?.readingStage ?? 0
      const nextReadingStage = this.advanceReadingStage(
        prevReadingStage,
        srsResult.status,
        result.quality
      )

      const character = charById.get(result.kanjiId)
      if (!character) {
        // Defensive — would indicate the client sent a kanjiId that doesn't
        // exist in the kanji table. Fail loud BEFORE opening the transaction
        // so the whole-session rollback is never triggered by a validation
        // miss (it's triggered only by real DB failures).
        throw new Error(`SrsService.submitReview: unknown kanjiId ${result.kanjiId}`)
      }

      submissionInputs.push({
        userId,
        kanjiId: result.kanjiId,
        kanjiCharacter: character,
        sessionId,
        reviewType: result.reviewType,
        quality: result.quality,
        responseTimeMs: result.responseTimeMs,
        prevStatus: (prevStatus ?? 'unseen') as SrsStatus,
        prevInterval: prevCard.interval,
        progressAfter: {
          status: srsResult.status,
          interval: srsResult.interval,
          easeFactor: srsResult.easeFactor,
          repetitions: srsResult.repetitions,
          nextReviewAt: srsResult.nextReviewAt,
          readingStage: nextReadingStage,
        },
      })
    }

    // Single transaction with four bulk statements — O(1) round-trips
    // regardless of session size.
    await this.dualWrite.recordReviewSubmissions(submissionInputs)

    // Mark session complete
    await this.db
      .update(reviewSessions)
      .set({ completedAt: now, correctItems, totalItems: results.length })
      .where(eq(reviewSessions.id, sessionId))

    return { sessionId, totalItems: results.length, correctItems, studyTimeMs, newLearned, burned }
  }

  // ── Determine review type from reading stage ────────────────────────────────

  private pickReviewType(
    readingStage: number,
    status: string
  ): 'meaning' | 'reading' | 'writing' | 'compound' {
    if (status === 'unseen' || readingStage === 0) return 'meaning'
    if (readingStage === 1) return 'reading'
    if (readingStage === 2) return 'reading'
    if (readingStage === 3) return 'writing'
    return 'compound'
  }

  // ── Advance reading stage on successful reviews ─────────────────────────────

  private advanceReadingStage(current: number, newStatus: string, quality: number): number {
    if (quality < 4) return current // only advance on strong pass (4–5)
    if (newStatus === 'reviewing' && current < 1) return 1
    if (newStatus === 'remembered' && current < 2) return 2
    if (newStatus === 'remembered' && current < 3) return 3
    if (newStatus === 'burned' && current < 4) return 4
    return current
  }

  // ── Get writing practice queue ─────────────────────────────────────────────
  // Returns kanji the user has already studied (repetitions > 0), most recent first.

  async getWritingQueue(userId: string, limit: number) {
    const rows = await this.db
      .select({
        kanjiId: userKanjiProgress.kanjiId,
        character: kanji.character,
        meanings: kanji.meanings,
        jlptLevel: kanji.jlptLevel,
        strokeCount: kanji.strokeCount,
        kunReadings: kanji.kunReadings,
        onReadings: kanji.onReadings,
        status: userKanjiProgress.status,
        lastReviewedAt: userKanjiProgress.lastReviewedAt,
      })
      .from(userKanjiProgress)
      .innerJoin(kanji, eq(userKanjiProgress.kanjiId, kanji.id))
      .where(
        and(
          eq(userKanjiProgress.userId, userId),
          gt(userKanjiProgress.repetitions, 0)
        )
      )
      .orderBy(desc(userKanjiProgress.lastReviewedAt))
      .limit(limit)

    return rows
  }

  // ── Get reading practice queue ──────────────────────────────────────────────
  // Returns kanji with at least one reading, most recently reviewed first.

  async getReadingQueue(userId: string, limit: number) {
    const rows = await this.db
      .select({
        kanjiId: userKanjiProgress.kanjiId,
        character: kanji.character,
        meanings: kanji.meanings,
        jlptLevel: kanji.jlptLevel,
        kunReadings: kanji.kunReadings,
        onReadings: kanji.onReadings,
        exampleVocab: kanji.exampleVocab,
        status: userKanjiProgress.status,
        lastReviewedAt: userKanjiProgress.lastReviewedAt,
        repetitions: userKanjiProgress.repetitions,
      })
      .from(userKanjiProgress)
      .innerJoin(kanji, eq(userKanjiProgress.kanjiId, kanji.id))
      .where(
        and(
          eq(userKanjiProgress.userId, userId),
          gt(userKanjiProgress.repetitions, 0)
        )
      )
      .orderBy(desc(userKanjiProgress.lastReviewedAt))
      .limit(limit)

    const toArr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

    return rows
      .filter((r) => r.kunReadings.length > 0 || r.onReadings.length > 0)
      .map((r) => {
        const exampleVocab = toArr<ExampleVocabEntry>(r.exampleVocab)
        // `repetitions` is SM-2's consecutive-success counter (resets on failure).
        // Used here as the rotation index — a true total-review counter would require
        // a new column or correlated reviewLogs subquery. Good-enough variety for now.
        return {
          ...r,
          exampleVocab,
          voicePrompt: selectVoicePrompt(exampleVocab, r.repetitions, r.character),
        }
      })
  }

  // ── Weak kanji drill queue ─────────────────────────────────────────────────
  // Returns kanji where recent accuracy is below the threshold, worst first.

  async getWeakKanjiQueue(userId: string, limit = 20, threshold = 65, minAttempts = 3): Promise<ReviewQueueItem[]> {
    const since = new Date()
    since.setDate(since.getDate() - 30)

    // Find kanji IDs with low accuracy in the last 30 days
    const weakRows = await this.db
      .select({
        kanjiId: reviewLogs.kanjiId,
        accuracyPct: sql<number>`ROUND(
          COUNT(*) FILTER (WHERE ${reviewLogs.quality} >= 3)::numeric / COUNT(*) * 100
        )::int`,
      })
      .from(reviewLogs)
      .where(and(eq(reviewLogs.userId, userId), gte(reviewLogs.reviewedAt, since)))
      .groupBy(reviewLogs.kanjiId)
      .having(
        and(
          gte(sql<number>`COUNT(*)`, minAttempts),
          sql`ROUND(COUNT(*) FILTER (WHERE ${reviewLogs.quality} >= 3)::numeric / COUNT(*) * 100) < ${threshold}`
        )
      )
      .orderBy(sql`ROUND(COUNT(*) FILTER (WHERE ${reviewLogs.quality} >= 3)::numeric / COUNT(*) * 100) ASC`)
      .limit(limit)

    if (weakRows.length === 0) return []

    const kanjiIds = weakRows.map((r) => r.kanjiId)

    const rows = await this.db
      .select({
        kanjiId: userKanjiProgress.kanjiId,
        status: userKanjiProgress.status,
        readingStage: userKanjiProgress.readingStage,
        character: kanji.character,
        jlptLevel: kanji.jlptLevel,
        meanings: kanji.meanings,
        kunReadings: kanji.kunReadings,
        onReadings: kanji.onReadings,
        exampleVocab: kanji.exampleVocab,
        exampleSentences: kanji.exampleSentences,
        strokeCount: kanji.strokeCount,
        radicals: kanji.radicals,
        nelsonClassic: kanji.nelsonClassic,
        nelsonNew: kanji.nelsonNew,
        morohashiIndex: kanji.morohashiIndex,
        morohashiVolume: kanji.morohashiVolume,
        morohashiPage: kanji.morohashiPage,
      })
      .from(userKanjiProgress)
      .innerJoin(kanji, eq(userKanjiProgress.kanjiId, kanji.id))
      .where(
        and(
          eq(userKanjiProgress.userId, userId),
          sql`${userKanjiProgress.kanjiId} = ANY(ARRAY[${sql.join(kanjiIds.map((id) => sql`${id}`), sql`, `)}]::int[])`
        )
      )

    // Sort by accuracy ascending (worst first) matching weakRows order
    const accuracyMap = new Map(weakRows.map((r) => [r.kanjiId, r.accuracyPct]))
    rows.sort((a, b) => (accuracyMap.get(a.kanjiId) ?? 0) - (accuracyMap.get(b.kanjiId) ?? 0))

    const toArr = <T,>(v: unknown): T[] => Array.isArray(v) ? v as T[] : []

    return rows.map((c) => ({
      ...c,
      status: c.status ?? 'learning',
      readingStage: c.readingStage ?? 0,
      reviewType: this.pickReviewType(c.readingStage ?? 0, c.status ?? 'learning'),
      meanings: toArr<string>(c.meanings),
      kunReadings: toArr<string>(c.kunReadings),
      onReadings: toArr<string>(c.onReadings),
      radicals: toArr<string>(c.radicals),
      exampleVocab: toArr(c.exampleVocab),
      exampleSentences: toArr(c.exampleSentences),
    }))
  }

  // ── Get user's current status counts ───────────────────────────────────────

  async getStatusCounts(userId: string) {
    const rows = await this.db
      .select({
        status: userKanjiProgress.status,
        count: sql<number>`count(*)::int`,
      })
      .from(userKanjiProgress)
      .where(eq(userKanjiProgress.userId, userId))
      .groupBy(userKanjiProgress.status)

    // Cards with nextReviewAt <= now (due for review)
    const [dueRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(userKanjiProgress)
      .where(
        and(
          eq(userKanjiProgress.userId, userId),
          lte(userKanjiProgress.nextReviewAt, new Date()),
        )
      )

    // Unseen kanji not yet in user_kanji_progress (available as new cards)
    const [unseenRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(kanji)
      .where(
        sql`${kanji.id} NOT IN (
          SELECT kanji_id FROM user_kanji_progress WHERE user_id = ${userId}
        )`
      )

    const dueCards = dueRow?.count ?? 0

    return {
      unseen: 0,
      learning: 0,
      reviewing: 0,
      remembered: 0,
      burned: 0,
      ...Object.fromEntries(rows.map((r) => [r.status, r.count])),
      // Only SRS-due reviews count — unseen kanji are always available and
      // have no urgency, so including them would mislead the watch complication.
      dueCount: dueCards,
    }
  }
}
