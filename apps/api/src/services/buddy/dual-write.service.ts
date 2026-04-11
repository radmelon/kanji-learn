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
 * Wraps every per-app review write in a Drizzle transaction that ALSO
 * mirrors the change into the Universal Knowledge Graph. If any of the
 * four writes fail, the entire transaction rolls back so the app DB and
 * the UKG can never disagree.
 *
 * Phase 0 implements only `recordReviewSubmission`. Phase 1 will add
 * `recordMnemonicCreation`, `recordTestResult`, etc., following the
 * same pattern.
 *
 * **Out of scope:** `buddy_llm_*` telemetry tables are written by their
 * own service (Task 19), not via this wrapper, so a failed telemetry
 * insert never rolls back a user-facing review.
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
}
