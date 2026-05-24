// apps/api/test/integration/learner-state-refresh.test.ts
//
// Phase 0a Task 2 — confirms `LearnerStateService.refreshState()` fires
// after a successful `submitReview()`, persisting a row to
// `learner_state_cache`. Currently fails because `SrsService` doesn't yet
// invoke `LearnerStateService` — Task 3 wires it up.
//
// Mirrors the fixture pattern in `llm-telemetry.test.ts`: connect via
// `TEST_DATABASE_URL`, seed a known test user, clean up that user's rows
// before each test.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { SrsService } from '../../src/services/srs.service'
import { DualWriteService } from '../../src/services/buddy/dual-write.service'
import { LearnerStateService } from '../../src/services/buddy/learner-state.service'
import type { ReviewResult } from '@kanji-learn/shared'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER_ID = '00000000-0000-0000-0000-0000000000a1'
let testKanjiId: number

beforeAll(async () => {
  // submitReview() upserts user_profiles + learner_identity itself, but
  // having the user pre-seeded with a known display_name avoids noise.
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES (${TEST_USER_ID}, 'Phase0aRefreshTest', 'UTC')
    ON CONFLICT DO NOTHING
  `)

  // Pick any seeded kanji id. The test DB is expected to have kanji rows
  // (seeded via `pnpm -F db seed`); if not, the test fails fast with a
  // clear message rather than the misleading FK violation that would
  // come from passing kanji_id=1 against an empty kanji table.
  const rows = await db.execute(sql`SELECT id FROM kanji ORDER BY id LIMIT 1`)
  if (rows.length === 0) {
    throw new Error(
      'Test DB has no kanji rows. Seed the test DB before running: ' +
        'DATABASE_URL=$TEST_DATABASE_URL pnpm -F @kanji-learn/db seed:kanji'
    )
  }
  testKanjiId = (rows[0] as { id: number }).id
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM learner_state_cache WHERE user_id = ${TEST_USER_ID}`)
})

afterAll(async () => {
  await client.end()
})

describe('LearnerStateService refresh hook', () => {
  it('populates learner_state_cache after a successful submitReview', async () => {
    const dualWrite = new DualWriteService(db)
    const learnerState = new LearnerStateService(db)
    // Task 3 will change SrsService's constructor to accept LearnerStateService
    // as the third arg. This call currently fails (constructor mismatch) —
    // that's the TDD red state.
    const srs = new SrsService(db, dualWrite, learnerState)

    const results: ReviewResult[] = [
      { kanjiId: testKanjiId, quality: 3, responseTimeMs: 1500, reviewType: 'meaning' },
    ]
    await srs.submitReview(TEST_USER_ID, results, /* studyTimeMs */ 5_000)

    // Refresh is non-blocking via setImmediate; flush the microtask queue
    // (one tick is enough — setImmediate runs in the same event loop turn).
    await new Promise((resolve) => setImmediate(resolve))
    // Also yield to allow the awaited persist() inside refreshState to finish.
    await new Promise((resolve) => setTimeout(resolve, 50))

    const cached = await db.query.learnerStateCache.findFirst({
      where: eq(schema.learnerStateCache.userId, TEST_USER_ID),
    })
    expect(cached).toBeTruthy()
    expect(cached?.userId).toBe(TEST_USER_ID)
  })
})
