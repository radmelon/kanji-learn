import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { DualWriteService } from '../../src/services/buddy/dual-write.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER = '00000000-0000-0000-0000-000000000777'
const TEST_USER_NO_IDENTITY = '00000000-0000-0000-0000-000000000778'
const TEST_CHAR = '持'
let testKanjiId: number
let testSessionId: string

async function ensureFixtures() {
  // user_profiles row for both users (FK target for review_logs/user_kanji_progress)
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES
      (${TEST_USER}, 'DualWrite', 'UTC'),
      (${TEST_USER_NO_IDENTITY}, 'NoIdentity', 'UTC')
    ON CONFLICT DO NOTHING
  `)
  // learner_identity row ONLY for TEST_USER. The second user deliberately
  // has no identity row so the rollback test can force a UKG FK failure.
  await db.execute(sql`
    INSERT INTO learner_identity (learner_id)
    VALUES (${TEST_USER})
    ON CONFLICT DO NOTHING
  `)
  // Test kanji row.
  const kanjiResult = await db.execute(sql`
    INSERT INTO kanji (character, jlpt_level, jlpt_order, stroke_count)
    VALUES (${TEST_CHAR}, 'N4', 9999, 9)
    ON CONFLICT (character) DO UPDATE SET stroke_count = EXCLUDED.stroke_count
    RETURNING id
  `)
  testKanjiId = (kanjiResult[0] as { id: number }).id
  // A review session for the FK on review_logs.session_id.
  const sessionResult = await db.execute(sql`
    INSERT INTO review_sessions (user_id, total_items)
    VALUES (${TEST_USER}, 0)
    RETURNING id
  `)
  testSessionId = (sessionResult[0] as { id: string }).id
}

async function resetWrites() {
  await db.execute(sql`DELETE FROM learner_timeline_events WHERE learner_id IN (${TEST_USER}, ${TEST_USER_NO_IDENTITY})`)
  await db.execute(sql`DELETE FROM learner_knowledge_state WHERE learner_id IN (${TEST_USER}, ${TEST_USER_NO_IDENTITY})`)
  await db.execute(sql`DELETE FROM review_logs WHERE user_id IN (${TEST_USER}, ${TEST_USER_NO_IDENTITY})`)
  await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id IN (${TEST_USER}, ${TEST_USER_NO_IDENTITY})`)
}

describe('DualWriteService.recordReviewSubmission', () => {
  const service = new DualWriteService(db)

  beforeAll(async () => {
    await ensureFixtures()
  })

  beforeEach(async () => {
    await resetWrites()
  })

  function basePayload(overrides: Partial<Parameters<typeof service.recordReviewSubmission>[0]> = {}) {
    return {
      userId: TEST_USER,
      kanjiId: testKanjiId,
      kanjiCharacter: TEST_CHAR,
      sessionId: testSessionId,
      reviewType: 'meaning' as const,
      quality: 4,
      responseTimeMs: 1200,
      prevStatus: 'learning' as const,
      prevInterval: 0,
      progressAfter: {
        status: 'reviewing' as const,
        interval: 3,
        easeFactor: 2.5,
        repetitions: 1,
        nextReviewAt: new Date('2026-04-13T12:00:00Z'),
        readingStage: 0,
      },
      ...overrides,
    }
  }

  it('writes to review_logs, user_kanji_progress, learner_knowledge_state, AND learner_timeline_events in one transaction', async () => {
    await service.recordReviewSubmission(basePayload())

    const logCount = await db.execute(
      sql`SELECT count(*)::int AS n FROM review_logs WHERE user_id = ${TEST_USER}`
    )
    expect((logCount[0] as { n: number }).n).toBe(1)

    const progressCount = await db.execute(
      sql`SELECT count(*)::int AS n FROM user_kanji_progress WHERE user_id = ${TEST_USER} AND kanji_id = ${testKanjiId}`
    )
    expect((progressCount[0] as { n: number }).n).toBe(1)

    const ukgRows = await db.execute(
      sql`SELECT mastery_level::float AS mastery, review_count::int AS rc, status FROM learner_knowledge_state WHERE learner_id = ${TEST_USER} AND subject = ${'kanji:' + TEST_CHAR}`
    )
    expect(ukgRows.length).toBe(1)
    expect((ukgRows[0] as { mastery: number }).mastery).toBeCloseTo(0.6, 3)
    expect((ukgRows[0] as { rc: number }).rc).toBe(1)
    expect((ukgRows[0] as { status: string }).status).toBe('reviewing')

    const timelineRows = await db.execute(
      sql`SELECT event_type, app_source FROM learner_timeline_events WHERE learner_id = ${TEST_USER}`
    )
    expect(timelineRows.length).toBe(1)
    expect((timelineRows[0] as { event_type: string }).event_type).toBe('review_completed')
    expect((timelineRows[0] as { app_source: string }).app_source).toBe('kanji-buddy')
  })

  it('rolls back ALL writes if the UKG insert fails (FK violation)', async () => {
    // TEST_USER_NO_IDENTITY has a user_profiles row but NO learner_identity
    // row. The first two writes (review_logs, user_kanji_progress) succeed,
    // but the learner_knowledge_state insert fails on the FK constraint and
    // the entire transaction must roll back.
    await expect(
      service.recordReviewSubmission(basePayload({ userId: TEST_USER_NO_IDENTITY }))
    ).rejects.toBeTruthy()

    const logCount = await db.execute(
      sql`SELECT count(*)::int AS n FROM review_logs WHERE user_id = ${TEST_USER_NO_IDENTITY}`
    )
    expect((logCount[0] as { n: number }).n).toBe(0)

    const progressCount = await db.execute(
      sql`SELECT count(*)::int AS n FROM user_kanji_progress WHERE user_id = ${TEST_USER_NO_IDENTITY}`
    )
    expect((progressCount[0] as { n: number }).n).toBe(0)

    const ukgCount = await db.execute(
      sql`SELECT count(*)::int AS n FROM learner_knowledge_state WHERE learner_id = ${TEST_USER_NO_IDENTITY}`
    )
    expect((ukgCount[0] as { n: number }).n).toBe(0)
  })

  it('atomically increments review_count on repeat reviews of the same kanji', async () => {
    await service.recordReviewSubmission(basePayload())
    await service.recordReviewSubmission(basePayload())
    await service.recordReviewSubmission(basePayload())

    const rows = await db.execute(
      sql`SELECT review_count::int AS rc FROM learner_knowledge_state WHERE learner_id = ${TEST_USER} AND subject = ${'kanji:' + TEST_CHAR}`
    )
    expect((rows[0] as { rc: number }).rc).toBe(3)

    // The user_kanji_progress upsert collapses to a single row.
    const progressRows = await db.execute(
      sql`SELECT count(*)::int AS n FROM user_kanji_progress WHERE user_id = ${TEST_USER} AND kanji_id = ${testKanjiId}`
    )
    expect((progressRows[0] as { n: number }).n).toBe(1)

    // But every review IS logged.
    const logRows = await db.execute(
      sql`SELECT count(*)::int AS n FROM review_logs WHERE user_id = ${TEST_USER}`
    )
    expect((logRows[0] as { n: number }).n).toBe(3)
  })
})
