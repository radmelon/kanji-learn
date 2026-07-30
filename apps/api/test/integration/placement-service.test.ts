import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { selectNextItems } from '../../src/services/placement.service'
import { refreshKanjiDifficulty } from '../../src/services/placement-difficulty.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER = '00000000-0000-0000-0000-0000000000d2'

describe('selectNextItems', () => {
  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${TEST_USER}, 'SelectFixture', 'UTC') ON CONFLICT DO NOTHING
    `)
    await refreshKanjiDifficulty(db)
  })

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${TEST_USER}`)
  })

  it('returns items with finite bMeaning/bReading, bReading > bMeaning', async () => {
    const items = await selectNextItems(db, TEST_USER, 0, [], 5)
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(Number.isFinite(item.bMeaning)).toBe(true)
      expect(item.bReading).toBeGreaterThan(item.bMeaning)
    }
  })

  it('never returns a kanji the user has already reviewed (totalReviews > 0) — the extended never-overwrite exclusion', async () => {
    const [someKanji] = await db.select({ id: schema.kanji.id }).from(schema.kanji).limit(1)
    await db.insert(schema.userKanjiProgress).values({
      userId: TEST_USER, kanjiId: someKanji.id, status: 'learning',
      stability: 1, difficulty: 6, totalReviews: 1,
    })

    const items = await selectNextItems(db, TEST_USER, 0, [], 200) // wide net
    expect(items.some((i) => i.kanjiId === someKanji.id)).toBe(false)
  })

  it('excludes ids passed in `exclude` (already asked this session)', async () => {
    const first = await selectNextItems(db, TEST_USER, 0, [], 3)
    const excludeIds = first.map((i) => i.kanjiId)
    const second = await selectNextItems(db, TEST_USER, 0, excludeIds, 200)
    expect(second.some((i) => excludeIds.includes(i.kanjiId))).toBe(false)
  })

  it('selects kanji with b near the given theta over kanji far from it', async (ctx) => {
    // PRECONDITION: this assertion is only meaningful when the corpus is larger
    // than CANDIDATE_POOL_SIZE (20). selectNextItems orders by ABS(b - theta),
    // takes the nearest 20, then shuffles that pool. If the whole corpus fits
    // inside the pool, every theta returns the same candidate set and the
    // shuffle decides the result — the test would then be measuring noise, and
    // would pass or fail at random. The local test DB currently holds 7 kanji
    // (see docs/local-test-db.md); live holds 2294.
    const [{ n }] = (await db.execute(
      sql`SELECT count(*)::int AS n FROM kanji_difficulty`,
    )) as unknown as { n: number }[]
    if (n <= 20) {
      ctx.skip(
        `corpus is ${n} kanji, not larger than CANDIDATE_POOL_SIZE=20 — theta cannot affect selection, so this assertion would test shuffle noise. Seed a fuller kanji set to make it meaningful.`,
      )
      return
    }

    // theta far into N1 territory should skew results toward N1-range b, not N5.
    const nearN5 = await selectNextItems(db, TEST_USER, -3, [], 5)
    const nearN1 = await selectNextItems(db, TEST_USER, 3, [], 5)
    const avgB = (items: { bMeaning: number }[]) => items.reduce((a, i) => a + i.bMeaning, 0) / items.length
    expect(avgB(nearN1)).toBeGreaterThan(avgB(nearN5))
  })
})
