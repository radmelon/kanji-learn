// Unit tests for the pure batching transformation that powers
// DualWriteService.recordReviewSubmissions (plural). These verify that a
// batched call produces the same per-row shapes the legacy per-review
// recordReviewSubmission would have produced — so the perf refactor
// (collapsing ~7 RTTs per review down to ~6 RTTs per session) is
// semantically equivalent to the old path.

import { describe, it, expect } from 'vitest'
import {
  buildBatchedRowSets,
  type ReviewSubmissionInput,
} from '../../../src/services/buddy/dual-write.service'
import { MASTERY_BY_STATUS } from '../../../src/services/buddy/constants'

const now = new Date('2026-04-18T23:00:00Z')
const userId = '00000000-0000-0000-0000-000000000001'
const sessionId = '11111111-1111-1111-1111-111111111111'

function makeInput(overrides: Partial<ReviewSubmissionInput> = {}): ReviewSubmissionInput {
  return {
    userId,
    kanjiId: 42,
    kanjiCharacter: '漢',
    sessionId,
    reviewType: 'meaning',
    quality: 5,
    responseTimeMs: 3500,
    prevStatus: 'unseen',
    prevInterval: 0,
    progressAfter: {
      status: 'learning',
      interval: 1,
      easeFactor: 2.5,
      repetitions: 1,
      nextReviewAt: new Date('2026-04-19T23:00:00Z'),
      readingStage: 1,
    },
    ...overrides,
  }
}

describe('buildBatchedRowSets', () => {
  it('returns empty arrays for an empty batch', () => {
    const rows = buildBatchedRowSets([], now)
    expect(rows.reviewLogs).toHaveLength(0)
    expect(rows.userKanjiProgress).toHaveLength(0)
    expect(rows.learnerKnowledgeState).toHaveLength(0)
    expect(rows.learnerTimelineEvents).toHaveLength(0)
  })

  it('builds review_logs rows with per-review fields', () => {
    const input = makeInput()
    const rows = buildBatchedRowSets([input], now)
    expect(rows.reviewLogs).toHaveLength(1)
    expect(rows.reviewLogs[0]).toMatchObject({
      sessionId,
      userId,
      kanjiId: 42,
      reviewType: 'meaning',
      quality: 5,
      responseTimeMs: 3500,
      prevStatus: 'unseen',
      nextStatus: 'learning',
      prevInterval: 0,
      nextInterval: 1,
    })
  })

  it('builds user_kanji_progress rows with the post-SRS state and now-stamped timestamps', () => {
    const input = makeInput()
    const rows = buildBatchedRowSets([input], now)
    expect(rows.userKanjiProgress).toHaveLength(1)
    expect(rows.userKanjiProgress[0]).toMatchObject({
      userId,
      kanjiId: 42,
      status: 'learning',
      readingStage: 1,
      easeFactor: 2.5,
      interval: 1,
      repetitions: 1,
      nextReviewAt: input.progressAfter.nextReviewAt,
      lastReviewedAt: now,
      updatedAt: now,
    })
  })

  it('builds learner_knowledge_state rows with subject = kanji:<char> and reviewCount = 1', () => {
    const input = makeInput()
    const rows = buildBatchedRowSets([input], now)
    expect(rows.learnerKnowledgeState).toHaveLength(1)
    expect(rows.learnerKnowledgeState[0]).toMatchObject({
      learnerId: userId,
      subject: 'kanji:漢',
      masteryLevel: MASTERY_BY_STATUS.learning,
      status: 'learning',
      reviewCount: 1,
      firstSeenAt: now,
      lastReviewedAt: now,
      appSource: 'kanji-buddy',
    })
  })

  it('builds learner_timeline_events rows with wasCorrect=true for quality >= 3', () => {
    const rows = buildBatchedRowSets([makeInput({ quality: 5 })], now)
    expect(rows.learnerTimelineEvents).toHaveLength(1)
    expect(rows.learnerTimelineEvents[0]).toMatchObject({
      learnerId: userId,
      eventType: 'review_completed',
      subject: 'kanji:漢',
      appSource: 'kanji-buddy',
      payload: {
        reviewType: 'meaning',
        quality: 5,
        wasCorrect: true,
        responseTimeMs: 3500,
        newStatus: 'learning',
      },
    })
  })

  it('sets wasCorrect=false for quality < 3 (e.g. Again=1)', () => {
    const rows = buildBatchedRowSets([makeInput({ quality: 1 })], now)
    const payload = rows.learnerTimelineEvents[0].payload as Record<string, unknown>
    expect(payload.wasCorrect).toBe(false)
  })

  it('sets wasCorrect=true for quality=3 (Hard) — matches legacy boundary', () => {
    const rows = buildBatchedRowSets([makeInput({ quality: 3 })], now)
    const payload = rows.learnerTimelineEvents[0].payload as Record<string, unknown>
    expect(payload.wasCorrect).toBe(true)
  })

  it('produces one of each row per input in a multi-review batch, preserving order', () => {
    const inputs = [
      makeInput({ kanjiId: 42, kanjiCharacter: '漢', quality: 5 }),
      makeInput({ kanjiId: 100, kanjiCharacter: '字', quality: 4 }),
      makeInput({ kanjiId: 101, kanjiCharacter: '本', quality: 3 }),
      makeInput({ kanjiId: 102, kanjiCharacter: '学', quality: 1 }),
    ]
    const rows = buildBatchedRowSets(inputs, now)
    expect(rows.reviewLogs).toHaveLength(4)
    expect(rows.userKanjiProgress).toHaveLength(4)
    expect(rows.learnerKnowledgeState).toHaveLength(4)
    expect(rows.learnerTimelineEvents).toHaveLength(4)

    expect(rows.reviewLogs.map((r) => r.kanjiId)).toEqual([42, 100, 101, 102])
    expect(rows.userKanjiProgress.map((r) => r.kanjiId)).toEqual([42, 100, 101, 102])
    expect(rows.learnerKnowledgeState.map((r) => r.subject)).toEqual([
      'kanji:漢',
      'kanji:字',
      'kanji:本',
      'kanji:学',
    ])
    expect(rows.learnerTimelineEvents.map((r) => r.subject)).toEqual([
      'kanji:漢',
      'kanji:字',
      'kanji:本',
      'kanji:学',
    ])
  })
})
