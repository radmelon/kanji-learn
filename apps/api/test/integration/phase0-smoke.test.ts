// apps/api/test/integration/phase0-smoke.test.ts
//
// The Phase 0 gate test. Exercises the full review path:
//
//   SrsService.submitReview  →  DualWriteService.recordReviewSubmission
//                             →  review_logs
//                             →  user_kanji_progress
//                             →  learner_knowledge_state (UKG)
//                             →  learner_timeline_events (UKG)
//
// then a manual LearnerStateService.refreshState(...) to prove the cache
// recomputes from the fresh rows. In Phase 1 the cache refresh will be
// fire-and-forget from the review route; in Phase 0 the method is public
// and called here directly.
//
// We do NOT boot the full Fastify server in this test. The auth plugin
// fetches Supabase JWKS over the network on startup, which can't run in
// tests. Instead we wire SrsService + DualWriteService + LearnerStateService
// against the drizzle client directly — the same three services the review
// route constructs at registration time, so this path mirrors production.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'

import { SrsService } from '../../src/services/srs.service'
import { DualWriteService } from '../../src/services/buddy/dual-write.service'
import { LearnerStateService } from '../../src/services/buddy/learner-state.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER = '00000000-0000-0000-0000-000000000999'
const TEST_CHAR = '新'

const dualWrite = new DualWriteService(db)
const srs = new SrsService(db, dualWrite)
const learnerState = new LearnerStateService(db)

let testKanjiId: number

beforeAll(async () => {
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES (${TEST_USER}, 'Phase0Smoke', 'UTC')
    ON CONFLICT DO NOTHING
  `)
  await db.execute(sql`
    INSERT INTO learner_identity (learner_id)
    VALUES (${TEST_USER})
    ON CONFLICT DO NOTHING
  `)
  const kanjiResult = await db.execute(sql`
    INSERT INTO kanji (character, jlpt_level, jlpt_order, stroke_count)
    VALUES (${TEST_CHAR}, 'N5', 9998, 13)
    ON CONFLICT (character) DO UPDATE SET stroke_count = EXCLUDED.stroke_count
    RETURNING id
  `)
  testKanjiId = (kanjiResult[0] as { id: number }).id
})

afterAll(async () => {
  await client.end()
})

beforeEach(async () => {
  // Scrub everything this user touched so the test is idempotent on re-runs
  // and robust against any cross-file ordering quirks.
  await db.execute(sql`DELETE FROM learner_timeline_events WHERE learner_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM learner_knowledge_state WHERE learner_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM review_logs WHERE user_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM review_sessions WHERE user_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM learner_state_cache WHERE user_id = ${TEST_USER}`)
})

describe('Phase 0 smoke — end-to-end review submission', () => {
  it('records the review across app + UKG tables and refreshes learner state', async () => {
    // One correct meaning review of the test kanji.
    await srs.submitReview(
      TEST_USER,
      [
        {
          kanjiId: testKanjiId,
          quality: 4, // Good — counts as correct (quality >= 3)
          responseTimeMs: 1100,
          reviewType: 'meaning',
        },
      ],
      3000
    )

    // Normally fire-and-forget from the review route in Phase 1; called
    // explicitly here so the test can assert the cache was recomputed.
    await learnerState.refreshState(TEST_USER)

    // 1. review_logs row written
    const reviewLogRows = await db.execute(
      sql`SELECT count(*)::int AS n FROM review_logs WHERE user_id = ${TEST_USER}`
    )
    expect((reviewLogRows[0] as { n: number }).n).toBe(1)

    // 2. user_kanji_progress row written (kanjiId matches our inserted kanji)
    const progressRows = await db.execute(
      sql`SELECT status FROM user_kanji_progress WHERE user_id = ${TEST_USER} AND kanji_id = ${testKanjiId}`
    )
    expect(progressRows.length).toBe(1)
    expect((progressRows[0] as { status: string }).status).toBeDefined()

    // 3. learner_knowledge_state mirrored with subject "kanji:新" and a
    // non-zero mastery level.
    const ukgRows = await db.execute(
      sql`SELECT mastery_level::float AS m, app_source
          FROM learner_knowledge_state
          WHERE learner_id = ${TEST_USER} AND subject = ${'kanji:' + TEST_CHAR}`
    )
    expect(ukgRows.length).toBe(1)
    expect((ukgRows[0] as { m: number }).m).toBeGreaterThan(0)
    expect((ukgRows[0] as { app_source: string }).app_source).toBe('kanji-buddy')

    // 4. learner_timeline_events row written for the review
    const timelineRows = await db.execute(
      sql`SELECT count(*)::int AS n, max(event_type) AS event_type
          FROM learner_timeline_events
          WHERE learner_id = ${TEST_USER}`
    )
    expect((timelineRows[0] as { n: number }).n).toBe(1)
    expect((timelineRows[0] as { event_type: string }).event_type).toBe('review_completed')

    // 5. learner_state_cache row populated by refreshState
    const cacheRows = await db.execute(
      sql`SELECT total_kanji_seen::int AS seen
          FROM learner_state_cache
          WHERE user_id = ${TEST_USER}`
    )
    expect(cacheRows.length).toBe(1)
    expect((cacheRows[0] as { seen: number }).seen).toBeGreaterThan(0)
  })
})
