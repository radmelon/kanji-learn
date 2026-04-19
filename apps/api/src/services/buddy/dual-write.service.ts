import { sql } from 'drizzle-orm'
import {
  reviewLogs,
  userKanjiProgress,
  learnerKnowledgeState,
  learnerTimelineEvents,
} from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import { MASTERY_BY_STATUS, type SrsStatus } from './constants'

/**
 * Input to a single review-submission dual-write. The caller (Task 18,
 * SrsService.submitReview) supplies BOTH the integer FK (kanjiId, used by
 * the app tables) and the string character (used to construct the UKG
 * "kanji:<character>" subject). This avoids a redundant lookup inside
 * the transaction.
 */
export interface ReviewSubmissionInput {
  userId: string
  kanjiId: number
  kanjiCharacter: string
  sessionId: string
  reviewType: 'meaning' | 'reading' | 'writing' | 'compound'
  quality: number // SM-2 0-5; quality >= 3 is "correct"
  responseTimeMs: number
  prevStatus: SrsStatus
  prevInterval: number
  /** Post-SRS-update progress, written to user_kanji_progress and mirrored to UKG. */
  progressAfter: {
    status: SrsStatus
    interval: number
    easeFactor: number
    repetitions: number
    nextReviewAt: Date | null
    readingStage: number
  }
}

/**
 * Row-sets produced by the pure transformation `buildBatchedRowSets`.
 * Exposed as a type so the plural `recordReviewSubmissions` method and its
 * unit tests share a single source of truth.
 */
export interface BatchedRowSets {
  reviewLogs: Array<{
    sessionId: string
    userId: string
    kanjiId: number
    reviewType: 'meaning' | 'reading' | 'writing' | 'compound'
    quality: number
    responseTimeMs: number
    prevStatus: SrsStatus
    nextStatus: SrsStatus
    prevInterval: number
    nextInterval: number
  }>
  userKanjiProgress: Array<{
    userId: string
    kanjiId: number
    status: SrsStatus
    readingStage: number
    easeFactor: number
    interval: number
    repetitions: number
    nextReviewAt: Date | null
    lastReviewedAt: Date
    updatedAt: Date
  }>
  learnerKnowledgeState: Array<{
    learnerId: string
    subject: string
    masteryLevel: number
    status: string
    reviewCount: number
    firstSeenAt: Date
    lastReviewedAt: Date
    appSource: string
  }>
  learnerTimelineEvents: Array<{
    learnerId: string
    eventType: string
    subject: string
    appSource: string
    payload: Record<string, unknown>
  }>
}

/**
 * Pure transformation: given an array of per-review inputs + a single
 * "now" timestamp, produce the four row-sets that need to be written for
 * the whole session. No DB access, no side effects — directly unit-testable.
 *
 * The plural `recordReviewSubmissions` method below wraps this in a single
 * transaction with four bulk statements. Session-size latency goes from
 * O(N) round-trips to O(1).
 */
export function buildBatchedRowSets(
  inputs: ReviewSubmissionInput[],
  now: Date
): BatchedRowSets {
  const rows: BatchedRowSets = {
    reviewLogs: [],
    userKanjiProgress: [],
    learnerKnowledgeState: [],
    learnerTimelineEvents: [],
  }

  for (const input of inputs) {
    const subject = `kanji:${input.kanjiCharacter}`
    const mastery = MASTERY_BY_STATUS[input.progressAfter.status]
    const wasCorrect = input.quality >= 3

    rows.reviewLogs.push({
      sessionId: input.sessionId,
      userId: input.userId,
      kanjiId: input.kanjiId,
      reviewType: input.reviewType,
      quality: input.quality,
      responseTimeMs: input.responseTimeMs,
      prevStatus: input.prevStatus,
      nextStatus: input.progressAfter.status,
      prevInterval: input.prevInterval,
      nextInterval: input.progressAfter.interval,
    })

    rows.userKanjiProgress.push({
      userId: input.userId,
      kanjiId: input.kanjiId,
      status: input.progressAfter.status,
      readingStage: input.progressAfter.readingStage,
      easeFactor: input.progressAfter.easeFactor,
      interval: input.progressAfter.interval,
      repetitions: input.progressAfter.repetitions,
      nextReviewAt: input.progressAfter.nextReviewAt,
      lastReviewedAt: now,
      updatedAt: now,
    })

    rows.learnerKnowledgeState.push({
      learnerId: input.userId,
      subject,
      masteryLevel: mastery,
      status: input.progressAfter.status,
      reviewCount: 1,
      firstSeenAt: now,
      lastReviewedAt: now,
      appSource: 'kanji-buddy',
    })

    rows.learnerTimelineEvents.push({
      learnerId: input.userId,
      eventType: 'review_completed',
      subject,
      appSource: 'kanji-buddy',
      payload: {
        reviewType: input.reviewType,
        quality: input.quality,
        wasCorrect,
        responseTimeMs: input.responseTimeMs,
        newStatus: input.progressAfter.status,
      },
    })
  }

  return rows
}

/**
 * Wraps every per-app review write in a Drizzle transaction that ALSO
 * mirrors the change into the Universal Knowledge Graph. If any of the
 * four writes fail, the entire transaction rolls back so the app DB and
 * the UKG can never disagree.
 *
 * The singular `recordReviewSubmission` preserves per-review atomicity —
 * one bad kanjiId in a batch of 20 discards only the one bad review,
 * the other 19 commit. Kept for callers that need that granularity.
 *
 * The plural `recordReviewSubmissions` is the hot path used by
 * `SrsService.submitReview`. It collapses the per-review transaction
 * loop (~7 RTTs per review at ~300ms cross-region = ~45s for a 20-card
 * session) into a single transaction with four bulk statements (~6 RTTs
 * total, regardless of session size). Trade-off: session-level atomicity
 * replaces per-review atomicity — if ANY row fails, the whole session
 * rolls back. The mobile offline queue handles session-level retry, so
 * the trade-off is invisible to users.
 *
 * **Out of scope:** `buddy_llm_*` telemetry tables are written by their
 * own service, not via this wrapper, so a failed telemetry insert never
 * rolls back a user-facing review.
 */
export class DualWriteService {
  constructor(private readonly db: Db) {}

  async recordReviewSubmission(input: ReviewSubmissionInput): Promise<void> {
    const subject = `kanji:${input.kanjiCharacter}`
    const mastery = MASTERY_BY_STATUS[input.progressAfter.status]
    const now = new Date()
    const wasCorrect = input.quality >= 3

    await this.db.transaction(async (tx) => {
      // 1. App write — review_logs
      await tx.insert(reviewLogs).values({
        sessionId: input.sessionId,
        userId: input.userId,
        kanjiId: input.kanjiId,
        reviewType: input.reviewType,
        quality: input.quality,
        responseTimeMs: input.responseTimeMs,
        prevStatus: input.prevStatus,
        nextStatus: input.progressAfter.status,
        prevInterval: input.prevInterval,
        nextInterval: input.progressAfter.interval,
      })

      // 2. App write — user_kanji_progress upsert. Conflict target is the
      // (user_id, kanji_id) unique index.
      await tx
        .insert(userKanjiProgress)
        .values({
          userId: input.userId,
          kanjiId: input.kanjiId,
          status: input.progressAfter.status,
          readingStage: input.progressAfter.readingStage,
          easeFactor: input.progressAfter.easeFactor,
          interval: input.progressAfter.interval,
          repetitions: input.progressAfter.repetitions,
          nextReviewAt: input.progressAfter.nextReviewAt,
          lastReviewedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [userKanjiProgress.userId, userKanjiProgress.kanjiId],
          set: {
            status: input.progressAfter.status,
            readingStage: input.progressAfter.readingStage,
            easeFactor: input.progressAfter.easeFactor,
            interval: input.progressAfter.interval,
            repetitions: input.progressAfter.repetitions,
            nextReviewAt: input.progressAfter.nextReviewAt,
            lastReviewedAt: now,
            updatedAt: now,
          },
        })

      // 3. UKG write — learner_knowledge_state upsert. Increments review_count
      // on conflict via raw SQL so we get an atomic counter bump (no read-
      // modify-write race).
      await tx
        .insert(learnerKnowledgeState)
        .values({
          learnerId: input.userId,
          subject,
          masteryLevel: mastery,
          status: input.progressAfter.status,
          reviewCount: 1,
          firstSeenAt: now,
          lastReviewedAt: now,
          appSource: 'kanji-buddy',
        })
        .onConflictDoUpdate({
          target: [learnerKnowledgeState.learnerId, learnerKnowledgeState.subject],
          set: {
            masteryLevel: mastery,
            status: input.progressAfter.status,
            reviewCount: sql`${learnerKnowledgeState.reviewCount} + 1`,
            lastReviewedAt: now,
            updatedAt: now,
          },
        })

      // 4. UKG write — learner_timeline_events. Always insert; no upsert.
      await tx.insert(learnerTimelineEvents).values({
        learnerId: input.userId,
        eventType: 'review_completed',
        subject,
        appSource: 'kanji-buddy',
        payload: {
          reviewType: input.reviewType,
          quality: input.quality,
          wasCorrect,
          responseTimeMs: input.responseTimeMs,
          newStatus: input.progressAfter.status,
        },
      })
    })
  }

  /**
   * Batched equivalent of `recordReviewSubmission`. Writes all four tables
   * in ONE transaction with bulk statements. See the class-level docstring
   * for the atomicity trade-off.
   *
   * Round-trip cost breakdown vs. cross-region RTT:
   *   - 1 findMany (caller's pre-fetch, not in this method)
   *   - 1 BEGIN
   *   - 1 bulk insert review_logs
   *   - 1 bulk upsert user_kanji_progress
   *   - 1 bulk upsert learner_knowledge_state
   *   - 1 bulk insert learner_timeline_events
   *   - 1 COMMIT
   *   = 6 round-trips per session, independent of session size.
   */
  async recordReviewSubmissions(inputs: ReviewSubmissionInput[]): Promise<void> {
    if (inputs.length === 0) return

    const now = new Date()
    const rows = buildBatchedRowSets(inputs, now)

    await this.db.transaction(async (tx) => {
      // 1. Bulk insert review_logs (no conflict target).
      await tx.insert(reviewLogs).values(rows.reviewLogs)

      // 2. Bulk upsert user_kanji_progress. The `set` clause pulls per-row
      // values from the pseudo-table `excluded` so each proposed row's own
      // post-SRS state is applied on conflict.
      await tx
        .insert(userKanjiProgress)
        .values(rows.userKanjiProgress)
        .onConflictDoUpdate({
          target: [userKanjiProgress.userId, userKanjiProgress.kanjiId],
          set: {
            status: sql`excluded.status`,
            readingStage: sql`excluded.reading_stage`,
            easeFactor: sql`excluded.ease_factor`,
            interval: sql`excluded.interval`,
            repetitions: sql`excluded.repetitions`,
            nextReviewAt: sql`excluded.next_review_at`,
            lastReviewedAt: sql`excluded.last_reviewed_at`,
            updatedAt: sql`excluded.updated_at`,
          },
        })

      // 3. Bulk upsert learner_knowledge_state. `reviewCount` bumps the
      // EXISTING value (not `excluded`) so the counter stays atomic across
      // concurrent writers. All other fields pull from `excluded`.
      await tx
        .insert(learnerKnowledgeState)
        .values(rows.learnerKnowledgeState)
        .onConflictDoUpdate({
          target: [learnerKnowledgeState.learnerId, learnerKnowledgeState.subject],
          set: {
            masteryLevel: sql`excluded.mastery_level`,
            status: sql`excluded.status`,
            reviewCount: sql`${learnerKnowledgeState.reviewCount} + 1`,
            lastReviewedAt: sql`excluded.last_reviewed_at`,
            updatedAt: sql`NOW()`,
          },
        })

      // 4. Bulk insert learner_timeline_events (no conflict target).
      await tx.insert(learnerTimelineEvents).values(rows.learnerTimelineEvents)
    })
  }
}
