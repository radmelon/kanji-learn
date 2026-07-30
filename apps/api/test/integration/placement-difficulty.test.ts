import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, eq } from 'drizzle-orm'
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

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM kanji_difficulty`)
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${TEST_USER}`)
    // The evidence-rule test below writes review_logs/review_sessions too.
    // Files share one Postgres instance (vitest fileParallelism: false), so
    // leaving those behind would leak this fixture into other suites.
    await db.execute(sql`DELETE FROM review_logs WHERE user_id = ${TEST_USER}`)
    await db.execute(sql`DELETE FROM review_sessions WHERE user_id = ${TEST_USER}`)
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
    // Target a kanji that genuinely has no progress rows. The plan's version
    // took an unordered `.limit(1)`, which asserts observed_n === 0 on whatever
    // row Postgres happened to return first — in a test DB carrying fixture
    // progress rows that is a coin flip, not a test.
    const [free] = (await db.execute(sql`
      SELECT k.id FROM kanji k
       WHERE NOT EXISTS (SELECT 1 FROM user_kanji_progress p WHERE p.kanji_id = k.id)
       ORDER BY k.id LIMIT 1
    `)) as unknown as { id: number }[]
    expect(free, 'need a kanji with no progress rows in the test DB').toBeDefined()

    await refreshKanjiDifficulty(db)
    const [row] = await db
      .select().from(schema.kanjiDifficulty)
      .where(eq(schema.kanjiDifficulty.kanjiId, free.id))
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
    // Pick kanji no OTHER user has progress on. observed_n is SUM(total_reviews)
    // across all learners, so a kanji carrying fixture rows from other users
    // would fold their review counts into this assertion — the first two kanji
    // by id do exactly that in the shared test DB. beforeEach clears TEST_USER's
    // own rows, so "no progress rows at all" means clean at this point.
    const kanjiRows = (await db.execute(sql`
      SELECT k.id FROM kanji k
       WHERE NOT EXISTS (SELECT 1 FROM user_kanji_progress p WHERE p.kanji_id = k.id)
       ORDER BY k.id LIMIT 2
    `)) as unknown as { id: number }[]
    expect(
      kanjiRows.length,
      'need 2 kanji with no existing progress rows; rebuild the local test DB (docs/local-test-db.md)',
    ).toBe(2)
    const [reviewed, stampedOnly] = [kanjiRows[0].id, kanjiRows[1].id]

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
