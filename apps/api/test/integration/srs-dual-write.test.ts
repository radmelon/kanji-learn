import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { SrsService } from '../../src/services/srs.service'
import { DualWriteService } from '../../src/services/buddy/dual-write.service'
import { MASTERY_BY_STATUS } from '../../src/services/buddy/constants'
import { calculateNextReview, createNewCard } from '@kanji-learn/shared'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER = '00000000-0000-0000-0000-000000000888'
const TEST_CHAR = '学'
let testKanjiId: number

async function ensureFixtures() {
  // user_profiles row — same pattern as DualWriteService test fixture.
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES (${TEST_USER}, 'SrsDualWrite', 'UTC')
    ON CONFLICT DO NOTHING
  `)
  // learner_identity row — required by FK on learner_knowledge_state.
  // SrsService.submitReview is also responsible for creating this on first
  // call, but we seed it here too so the fixture is independent of that.
  await db.execute(sql`
    INSERT INTO learner_identity (learner_id)
    VALUES (${TEST_USER})
    ON CONFLICT DO NOTHING
  `)
  // Test kanji row.
  const kanjiResult = await db.execute(sql`
    INSERT INTO kanji (character, jlpt_level, jlpt_order, stroke_count)
    VALUES (${TEST_CHAR}, 'N5', 9998, 8)
    ON CONFLICT (character) DO UPDATE SET stroke_count = EXCLUDED.stroke_count
    RETURNING id
  `)
  testKanjiId = (kanjiResult[0] as { id: number }).id
}

async function resetFixtures() {
  await db.execute(sql`DELETE FROM learner_timeline_events WHERE learner_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM learner_knowledge_state WHERE learner_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM review_logs WHERE user_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM review_sessions WHERE user_id = ${TEST_USER}`)
}

describe('SrsService.submitReview routes through DualWriteService', () => {
  const dualWrite = new DualWriteService(db)
  const srs = new SrsService(db, dualWrite)

  beforeAll(async () => {
    await ensureFixtures()
  })

  beforeEach(async () => {
    await resetFixtures()
  })

  it('writes review_logs, user_kanji_progress, learner_knowledge_state, AND learner_timeline_events for a single review', async () => {
    const summary = await srs.submitReview(
      TEST_USER,
      [
        {
          kanjiId: testKanjiId,
          reviewType: 'meaning',
          quality: 4,
          responseTimeMs: 1500,
        },
      ],
      5000
    )

    expect(summary.totalItems).toBe(1)
    expect(summary.correctItems).toBe(1)

    const logCount = await db.execute(
      sql`SELECT count(*)::int AS n FROM review_logs WHERE user_id = ${TEST_USER}`
    )
    expect((logCount[0] as { n: number }).n).toBe(1)

    const progressRows = await db.execute(
      sql`SELECT count(*)::int AS n FROM user_kanji_progress WHERE user_id = ${TEST_USER} AND kanji_id = ${testKanjiId}`
    )
    expect((progressRows[0] as { n: number }).n).toBe(1)

    const ukgRows = await db.execute(
      sql`SELECT mastery_level::float AS mastery, review_count::int AS rc, status FROM learner_knowledge_state WHERE learner_id = ${TEST_USER} AND subject = ${'kanji:' + TEST_CHAR}`
    )
    expect(ukgRows.length).toBe(1)

    // Compute the expected mastery from the SRS algorithm rather than
    // hardcoding — quality 4 on a fresh card produces interval=1 which
    // deriveStatus maps to 'learning' (mastery = 0.25).
    const expected = calculateNextReview(createNewCard(), 4)
    const expectedMastery = MASTERY_BY_STATUS[expected.status]
    expect((ukgRows[0] as { mastery: number }).mastery).toBeCloseTo(expectedMastery, 3)
    expect((ukgRows[0] as { rc: number }).rc).toBe(1)
    expect((ukgRows[0] as { status: string }).status).toBe(expected.status)

    const timelineRows = await db.execute(
      sql`SELECT count(*)::int AS n, max(event_type) AS event_type, max(app_source) AS app_source FROM learner_timeline_events WHERE learner_id = ${TEST_USER}`
    )
    expect((timelineRows[0] as { n: number }).n).toBe(1)
    expect((timelineRows[0] as { event_type: string }).event_type).toBe('review_completed')
    expect((timelineRows[0] as { app_source: string }).app_source).toBe('kanji-buddy')
  })

  it('creates the learner_identity row if it is missing before the UKG write', async () => {
    // Wipe identity to simulate a brand new user whose identity row has not
    // been backfilled yet. submitReview must create it before the dual-write.
    await db.execute(sql`DELETE FROM learner_identity WHERE learner_id = ${TEST_USER}`)

    await srs.submitReview(
      TEST_USER,
      [
        {
          kanjiId: testKanjiId,
          reviewType: 'meaning',
          quality: 4,
          responseTimeMs: 1500,
        },
      ],
      5000
    )

    const identity = await db.execute(
      sql`SELECT count(*)::int AS n FROM learner_identity WHERE learner_id = ${TEST_USER}`
    )
    expect((identity[0] as { n: number }).n).toBe(1)

    const ukgRows = await db.execute(
      sql`SELECT count(*)::int AS n FROM learner_knowledge_state WHERE learner_id = ${TEST_USER}`
    )
    expect((ukgRows[0] as { n: number }).n).toBe(1)
  })
})
