import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, eq, inArray } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { refreshKanjiDifficulty } from '../../src/services/placement-difficulty.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER = '00000000-0000-0000-0000-0000000000d1'

describe('refreshKanjiDifficulty', () => {
  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${TEST_USER}, 'DifficultyFixture', 'UTC')
      ON CONFLICT DO NOTHING
    `)
  })

  // The two kanji this file reserves. Chosen as the highest ids so they don't
  // collide with the `.limit(1)` / ORDER BY id patterns other suites use.
  let reserved: number[] = []

  beforeEach(async () => {
    const rows = (await db.execute(sql`
      SELECT id FROM kanji ORDER BY id DESC LIMIT 2
    `)) as unknown as { id: number }[]
    reserved = rows.map((r) => r.id)

    await db.execute(sql`DELETE FROM kanji_difficulty`)
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${TEST_USER}`)
    // The evidence-rule test below writes review_logs/review_sessions too.
    // Files share one Postgres instance (vitest fileParallelism: false), so
    // leaving those behind would leak this fixture into other suites.
    await db.execute(sql`DELETE FROM review_logs WHERE user_id = ${TEST_USER}`)
    await db.execute(sql`DELETE FROM review_sessions WHERE user_id = ${TEST_USER}`)

    // Clear the reserved kanji across ALL users. Earlier this file hunted for
    // kanji with zero progress rows, which made it depend on a resource other
    // suites consume: the local corpus is 7 kanji, and Tasks 9/12's fixtures
    // claim several, so those tests started failing purely on file order.
    // Rows left behind by other suites are their own leftovers, not seeded
    // fixtures — each suite inserts what it needs in its own setup.
    await db.delete(schema.reviewLogs).where(inArray(schema.reviewLogs.kanjiId, reserved))
    await db
      .delete(schema.userKanjiProgress)
      .where(inArray(schema.userKanjiProgress.kanjiId, reserved))
  })

  it('populates one row per kanji in the table, all with a finite b', async () => {
    const result = await refreshKanjiDifficulty(db)
    const rows = await db.select().from(schema.kanjiDifficulty)

    expect(rows.length).toBe(result.kanjiCount)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(Number.isFinite(row.b)).toBe(true)
      expect(Number.isFinite(row.bPrior)).toBe(true)
    }
  })

  it('a kanji with no review history gets b === bPrior (blend at n=0)', async () => {
    // Use a reserved kanji, which beforeEach guarantees has no progress rows.
    // The plan's version took an unordered `.limit(1)` and asserted
    // observed_n === 0 on whatever row Postgres returned first — in a test DB
    // carrying leftover progress rows that is a coin flip, not a test.
    const freeId = reserved[0]

    await refreshKanjiDifficulty(db)
    const [row] = await db
      .select().from(schema.kanjiDifficulty)
      .where(eq(schema.kanjiDifficulty.kanjiId, freeId))
    expect(row.observedN).toBe(0)
    expect(row.b).toBeCloseTo(row.bPrior, 6)
  })

  it('falls back to DEFAULT_DIFFICULTY_WEIGHTS with fewer than 300 pooled rows (this fixture has ~0)', async () => {
    const result = await refreshKanjiDifficulty(db)
    expect(result.usedFallback).toBe(true)
  })

  it('is idempotent — re-running produces the same kanjiCount and no duplicate rows', async () => {
    await refreshKanjiDifficulty(db)
    const first = await db.select().from(schema.kanjiDifficulty)
    await refreshKanjiDifficulty(db)
    const second = await db.select().from(schema.kanjiDifficulty)
    expect(second.length).toBe(first.length)
  })

  // ─── evidence rule ────────────────────────────────────────────────────────
  // Observed difficulty must come from rows with a real review_logs entry, NOT
  // from total_reviews > 0. The old placement flow (B-210) wrote progress rows
  // with total_reviews = 1 for kanji the learner never reviewed; on live data
  // 44 of 984 rows are exactly that, and 40 kanji would otherwise have had
  // their observed difficulty derived from nothing but those fabricated rows.
  it('counts a progress row WITH review history and ignores one without', async () => {
    // observed_n is SUM(total_reviews) across ALL learners, so any row another
    // suite left on these kanji would fold its review counts into the
    // assertion. beforeEach clears the reserved pair for every user, which is
    // what makes the exact numbers below meaningful.
    expect(reserved.length, 'need at least 2 kanji in the test DB').toBe(2)
    const [reviewed, stampedOnly] = reserved

    // Row A — genuine history: difficulty 8, three reviews, one review_logs row.
    await db.execute(sql`
      INSERT INTO user_kanji_progress (user_id, kanji_id, status, stability, difficulty, total_reviews)
      VALUES (${TEST_USER}, ${reviewed}, 'reviewing'::srs_status, 10, 8, 3)
    `)
    const [session] = (await db.execute(sql`
      INSERT INTO review_sessions (user_id) VALUES (${TEST_USER}) RETURNING id
    `)) as unknown as { id: string }[]
    await db.execute(sql`
      INSERT INTO review_logs
        (session_id, user_id, kanji_id, review_type, quality, response_time_ms,
         prev_status, next_status, prev_interval, next_interval)
      VALUES (${session.id}, ${TEST_USER}, ${reviewed}, 'meaning'::review_type, 4, 1200,
              'learning'::srs_status, 'reviewing'::srs_status, 1, 10)
    `)

    // Row B — the B-210 signature: total_reviews = 1 but no review_logs at all.
    await db.execute(sql`
      INSERT INTO user_kanji_progress (user_id, kanji_id, status, stability, difficulty, total_reviews)
      VALUES (${TEST_USER}, ${stampedOnly}, 'remembered'::srs_status, 21, 5, 1)
    `)

    await refreshKanjiDifficulty(db)

    const [withHistory] = await db
      .select().from(schema.kanjiDifficulty)
      .where(eq(schema.kanjiDifficulty.kanjiId, reviewed))
    const [withoutHistory] = await db
      .select().from(schema.kanjiDifficulty)
      .where(eq(schema.kanjiDifficulty.kanjiId, stampedOnly))

    // A contributes: n = SUM(total_reviews) = 3, b_observed = AVG(difficulty) - 5 = 3.
    expect(withHistory.observedN).toBe(3)
    expect(withHistory.bObserved).toBeCloseTo(3, 6)
    expect(withHistory.b).not.toBeCloseTo(withHistory.bPrior, 6)

    // B is invisible: no evidence, so b stays exactly the feature-derived prior.
    expect(withoutHistory.observedN).toBe(0)
    expect(withoutHistory.bObserved).toBeNull()
    expect(withoutHistory.b).toBeCloseTo(withoutHistory.bPrior, 6)
  })
})
