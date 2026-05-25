// apps/api/test/integration/learner-state-cap.test.ts
//
// Phase 0a Task 2 — confirms `LearnerStateService.refreshState()` enforces
// a per-user frequency cap. Two `submitReview()` calls inside the cap window
// should produce exactly one cache-persist call (not two). Currently fails
// because `SrsService` doesn't yet invoke `LearnerStateService` — Task 3
// wires it up.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { SrsService } from '../../src/services/srs.service'
import { DualWriteService } from '../../src/services/buddy/dual-write.service'
import { LearnerStateService } from '../../src/services/buddy/learner-state.service'
import { NudgeService } from '../../src/services/buddy/nudge.service'
import type { ReviewResult } from '@kanji-learn/shared'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER_ID = '00000000-0000-0000-0000-0000000000a2'
let testKanjiId: number

beforeAll(async () => {
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES (${TEST_USER_ID}, 'Phase0aCapTest', 'UTC')
    ON CONFLICT DO NOTHING
  `)

  const rows = await db.execute(sql`SELECT id FROM kanji ORDER BY id LIMIT 1`)
  if (rows.length === 0) {
    throw new Error('Test DB has no kanji rows. See learner-state-refresh.test.ts for setup hint.')
  }
  testKanjiId = (rows[0] as { id: number }).id
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM learner_state_cache WHERE user_id = ${TEST_USER_ID}`)
})

afterAll(async () => {
  await client.end()
})

describe('LearnerStateService frequency cap', () => {
  it('two submitReviews within the cap window result in exactly one persist', async () => {
    const dualWrite = new DualWriteService(db)
    const learnerState = new LearnerStateService(db)
    // Spy on the private `persist()` seam so we count actual cache writes.
    // The cap allows `refreshState` to return early without writing — what we
    // care about is "the DB was written once," not "refreshState was called
    // once." Casting via `unknown` lets us reach the private member.
    const persistSpy = vi.spyOn(learnerState as unknown as { persist: () => Promise<void> }, 'persist')

    const nudgeService = new NudgeService(db, { sendBuddyNudgePush: async () => {} } as any)
    const srs = new SrsService(db, dualWrite, learnerState, nudgeService)

    const results: ReviewResult[] = [
      { kanjiId: testKanjiId, quality: 3, responseTimeMs: 1500, reviewType: 'meaning' },
    ]

    // Two rapid submits inside the 30s cap window.
    await srs.submitReview(TEST_USER_ID, results, 5_000)
    await srs.submitReview(TEST_USER_ID, results, 5_000)

    // Flush setImmediate'd refresh callbacks and let their awaited
    // persist() (if any) complete.
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(persistSpy).toHaveBeenCalledTimes(1)
  })
})
