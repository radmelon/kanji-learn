import { and, eq, lte, isNull, or, asc, sql } from 'drizzle-orm'
import { userKanjiProgress, kanji, reviewSessions, reviewLogs } from '@kanji-learn/db'
import { calculateNextReview, createNewCard } from '@kanji-learn/shared'
import type { Db } from '@kanji-learn/db'
import type { ReviewResult } from '@kanji-learn/shared'
import { SURPRISE_BURNED_CHECK_RATE } from '@kanji-learn/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReviewQueueItem {
  kanjiId: number
  character: string
  jlptLevel: string
  meanings: string[]
  kunReadings: string[]
  onReadings: string[]
  exampleVocab: { word: string; reading: string; meaning: string }[]
  status: string
  readingStage: number
  reviewType: 'meaning' | 'reading' | 'writing' | 'compound'
}

export interface SessionSummary {
  sessionId: string
  totalItems: number
  correctItems: number
  studyTimeMs: number
  newLearned: number
  burned: number
}

// ─── SRS Service ──────────────────────────────────────────────────────────────

export class SrsService {
  constructor(private db: Db) {}

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
      })
      .from(userKanjiProgress)
      .innerJoin(kanji, eq(userKanjiProgress.kanjiId, kanji.id))
      .where(and(eq(userKanjiProgress.userId, userId), eq(userKanjiProgress.status, 'burned')))
      .orderBy(sql`RANDOM()`)
      .limit(surpriseCount)

    // Combine and assign review types
    const queue: ReviewQueueItem[] = [
      ...dueCards.map((c) => ({
        ...c,
        status: c.status ?? 'learning',
        readingStage: c.readingStage ?? 0,
        reviewType: this.pickReviewType(c.readingStage ?? 0, c.status ?? 'learning'),
      })),
      ...newCards.map((c) => ({
        ...c,
        status: 'unseen' as const,
        readingStage: 0,
        reviewType: 'meaning' as const,
      })),
      ...burnedChecks.map((c) => ({
        ...c,
        status: c.status ?? 'burned',
        readingStage: c.readingStage ?? 4,
        reviewType: this.pickReviewType(c.readingStage ?? 4, 'burned'),
      })),
    ]

    return queue
  }

  // ── Submit a batch of review results ───────────────────────────────────────

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

    // Create session record
    await this.db.insert(reviewSessions).values({
      id: sessionId,
      userId,
      startedAt: new Date(now.getTime() - studyTimeMs),
      totalItems: results.length,
      studyTimeMs,
      sessionType: 'daily',
    })

    for (const result of results) {
      const existing = await this.db.query.userKanjiProgress.findFirst({
        where: and(
          eq(userKanjiProgress.userId, userId),
          eq(userKanjiProgress.kanjiId, result.kanjiId)
        ),
      })

      const prevCard = existing ?? createNewCard()
      const prevStatus = prevCard.status
      const srsResult = calculateNextReview(prevCard, result.quality)

      if (result.quality >= 3) correctItems++
      if (prevStatus === 'unseen' || prevStatus === undefined) newLearned++
      if (srsResult.status === 'burned' && prevStatus !== 'burned') burned++

      // Upsert progress
      if (existing) {
        await this.db
          .update(userKanjiProgress)
          .set({
            status: srsResult.status,
            easeFactor: srsResult.easeFactor,
            interval: srsResult.interval,
            repetitions: srsResult.repetitions,
            nextReviewAt: srsResult.nextReviewAt,
            lastReviewedAt: now,
            updatedAt: now,
            readingStage: this.advanceReadingStage(
              existing.readingStage ?? 0,
              srsResult.status,
              result.quality
            ),
          })
          .where(
            and(
              eq(userKanjiProgress.userId, userId),
              eq(userKanjiProgress.kanjiId, result.kanjiId)
            )
          )
      } else {
        await this.db.insert(userKanjiProgress).values({
          userId,
          kanjiId: result.kanjiId,
          status: srsResult.status,
          easeFactor: srsResult.easeFactor,
          interval: srsResult.interval,
          repetitions: srsResult.repetitions,
          nextReviewAt: srsResult.nextReviewAt,
          lastReviewedAt: now,
          readingStage: 0,
        })
      }

      // Write review log
      await this.db.insert(reviewLogs).values({
        sessionId,
        userId,
        kanjiId: result.kanjiId,
        reviewType: result.reviewType,
        quality: result.quality,
        responseTimeMs: result.responseTimeMs,
        prevStatus: prevStatus as typeof reviewLogs.$inferInsert['prevStatus'],
        nextStatus: srsResult.status,
        prevInterval: prevCard.interval,
        nextInterval: srsResult.interval,
        reviewedAt: now,
      })
    }

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

    return {
      unseen: 0,
      learning: 0,
      reviewing: 0,
      remembered: 0,
      burned: 0,
      ...Object.fromEntries(rows.map((r) => [r.status, r.count])),
    }
  }
}
