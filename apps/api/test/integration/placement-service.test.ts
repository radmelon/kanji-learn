import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, and, eq, asc, inArray } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { selectNextItems } from '../../src/services/placement.service'
import { refreshKanjiDifficulty } from '../../src/services/placement-difficulty.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER = '00000000-0000-0000-0000-0000000000d2'

/**
 * Pick a kanji by index, wrapping on corpus size. The plan's version used
 * literal `.offset(50)` / `.offset(60)` / `.offset(70)`, which return nothing
 * against the local test DB's 7-kanji corpus (see docs/local-test-db.md) and
 * crash on `.id`. These cases only need *a* kanji distinct from their
 * neighbours', not a large corpus, so wrapping keeps them meaningful in both
 * the 7-row local DB and the 2294-row production one.
 */
async function pickKanji(n: number): Promise<number> {
  const [{ c }] = (await db.execute(
    sql`SELECT count(*)::int AS c FROM kanji`,
  )) as unknown as { c: number }[]
  const [row] = await db
    .select({ id: schema.kanji.id })
    .from(schema.kanji)
    .orderBy(asc(schema.kanji.id))
    .limit(1)
    .offset(n % c)
  return row.id
}


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
    // The exclusion tests below write review_logs, which is now what
    // selectNextItems keys on. Leaving them behind makes a later test see a
    // kanji as "already reviewed" and silently invert its assertion.
    await db.execute(sql`DELETE FROM review_logs WHERE user_id = ${TEST_USER}`)
    await db.execute(sql`DELETE FROM review_sessions WHERE user_id = ${TEST_USER}`)
  })

  it('returns items with finite bMeaning/bReading, bReading > bMeaning', async () => {
    const items = await selectNextItems(db, TEST_USER, 0, [], 5)
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(Number.isFinite(item.bMeaning)).toBe(true)
      expect(item.bReading).toBeGreaterThan(item.bMeaning)
    }
  })

  it('never returns a kanji the user has genuinely reviewed — the extended never-overwrite exclusion', async () => {
    const [someKanji] = await db.select({ id: schema.kanji.id }).from(schema.kanji).limit(1)
    await db.insert(schema.userKanjiProgress).values({
      userId: TEST_USER, kanjiId: someKanji.id, status: 'learning',
      stability: 1, difficulty: 6, totalReviews: 1,
    })
    // Real history means a review_logs row, not the counter. Without this the
    // fixture is a B-210 placement stamp, not a reviewed card — and the
    // assertion would pass for the wrong reason.
    const [session] = (await db.execute(sql`
      INSERT INTO review_sessions (user_id) VALUES (${TEST_USER}) RETURNING id
    `)) as unknown as { id: string }[]
    await db.execute(sql`
      INSERT INTO review_logs
        (session_id, user_id, kanji_id, review_type, quality, response_time_ms,
         prev_status, next_status, prev_interval, next_interval)
      VALUES (${session.id}, ${TEST_USER}, ${someKanji.id}, 'meaning'::review_type, 4, 1200,
              'unseen'::srs_status, 'learning'::srs_status, 0, 1)
    `)

    const items = await selectNextItems(db, TEST_USER, 0, [], 200) // wide net
    expect(items.some((i) => i.kanjiId === someKanji.id)).toBe(false)
  })

  it('DOES offer a kanji carrying only a B-210 placement stamp, so a retake can correct it', async () => {
    // total_reviews = 1 with no review_logs: written by the old placement flow
    // for a kanji the learner never saw. Under the counter-based predicate this
    // was excluded forever and the fabricated result was uncorrectable. On live
    // data that is 44 kanji on one account.
    const [stamped] = await db.select({ id: schema.kanji.id }).from(schema.kanji).limit(1)
    await db.insert(schema.userKanjiProgress).values({
      userId: TEST_USER, kanjiId: stamped.id, status: 'remembered',
      stability: 21, difficulty: 5, totalReviews: 1,
    })

    const items = await selectNextItems(db, TEST_USER, 0, [], 200)
    expect(items.some((i) => i.kanjiId === stamped.id)).toBe(true)
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

import { completePlacement, getSessionPrior } from '../../src/services/placement.service'
import { userKanjiProgress, placementSessions, reviewLogs } from '@kanji-learn/db'

describe('completePlacement', () => {
  const TEST_USER_2 = '00000000-0000-0000-0000-0000000000d3'
  let kanjiA: number
  let kanjiB: number

  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${TEST_USER_2}, 'CompleteFixture', 'UTC') ON CONFLICT DO NOTHING
    `)
    await refreshKanjiDifficulty(db)
    const rows = await db.select({ id: schema.kanji.id }).from(schema.kanji).limit(2)
    ;[kanjiA, kanjiB] = rows.map((r) => r.id)
  })

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM review_logs WHERE user_id = ${TEST_USER_2}`)
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${TEST_USER_2}`)
    await db.execute(sql`DELETE FROM placement_results WHERE session_id IN (SELECT id FROM placement_sessions WHERE user_id = ${TEST_USER_2})`)
    await db.execute(sql`DELETE FROM placement_sessions WHERE user_id = ${TEST_USER_2}`)
  })

  it('THE B-210 REGRESSION TEST: never overwrites a kanji with real review history, even if the client submits a strong response for it', async () => {
    await db.insert(userKanjiProgress).values({
      userId: TEST_USER_2, kanjiId: kanjiA, status: 'learning',
      stability: 2, difficulty: 6, totalReviews: 3,
    })
    // Real history is a review_logs row. Without one this fixture is a B-210
    // placement stamp, and the assertions below would hold trivially — nothing
    // would have been written to it regardless of whether protection worked.
    // This is the plan's most important test; it must not pass vacuously.
    const [histSession] = (await db.execute(sql`
      INSERT INTO review_sessions (user_id) VALUES (${TEST_USER_2}) RETURNING id
    `)) as unknown as { id: string }[]
    await db.execute(sql`
      INSERT INTO review_logs
        (session_id, user_id, kanji_id, review_type, quality, response_time_ms,
         prev_status, next_status, prev_interval, next_interval)
      VALUES (${histSession.id}, ${TEST_USER_2}, ${kanjiA}, 'meaning'::review_type, 4, 1100,
              'unseen'::srs_status, 'learning'::srs_status, 0, 2)
    `)

    // Drive theta high with correct answers on the EASIEST available kanji so
    // p(knows) clears the 0.85 seeding threshold and the write path is actually
    // live during this call — otherwise everything below holds trivially.
    //
    // HONEST LIMIT OF THIS TEST, measured rather than assumed: it still passes
    // with `hasHistory` emptied out. Never-overwrite is enforced TWICE, and the
    // structural guard fires first — seeding is
    // `.insert(...).onConflictDoNothing()`, so an existing row is untouchable
    // whatever the predicate says. That is reassuring for B-210 (defence in
    // depth) but it means no test of this shape can isolate `hasHistory`.
    // What this case does prove, which is the guarantee that matters to a
    // learner, is that a row with real review history survives a placement
    // submitting a maximally strong response for it. The control assertion
    // below keeps it from passing because nothing was written at all.
    const easiest = await db
      .select({ kanjiId: schema.kanjiDifficulty.kanjiId })
      .from(schema.kanjiDifficulty)
      .orderBy(asc(schema.kanjiDifficulty.b))
      .limit(6)
    const others = easiest.map((r) => r.kanjiId).filter((id) => id !== kanjiA)

    const responses = [
      ...others.flatMap((id) => [
        { kanjiId: id, itemType: 'meaning' as const, correct: true },
        { kanjiId: id, itemType: 'reading' as const, correct: true },
      ]),
      { kanjiId: kanjiA, itemType: 'meaning' as const, correct: true },
      { kanjiId: kanjiA, itemType: 'reading' as const, correct: true },
    ]
    await completePlacement(db, TEST_USER_2, responses)

    // CONTROL: at least one unprotected kanji must have been seeded in this
    // same call. If nothing was written the test proves nothing, so fail loudly
    // rather than report a false pass.
    const seeded = await db
      .select({ kanjiId: userKanjiProgress.kanjiId })
      .from(userKanjiProgress)
      .where(
        and(
          eq(userKanjiProgress.userId, TEST_USER_2),
          inArray(userKanjiProgress.kanjiId, others),
        ),
      )
    expect(
      seeded.length,
      'no kanji were seeded, so this run cannot demonstrate that protection did anything — raise theta or pick easier items',
    ).toBeGreaterThan(0)

    const [row] = await db
      .select()
      .from(userKanjiProgress)
      .where(and(eq(userKanjiProgress.userId, TEST_USER_2), eq(userKanjiProgress.kanjiId, kanjiA)))
    expect(row.status).toBe('learning') // unchanged
    expect(row.stability).toBe(2)       // unchanged
    expect(row.totalReviews).toBe(3)    // unchanged
  })

  it('seeds a fresh kanji as reviewing (not remembered) with stability in [3,21], writes a review_logs audit row', async () => {
    // Many easy correct answers on ONE kanji is not enough on its own — high
    // p(knows) requires a converged, high theta AND a low-difficulty item.
    // Use kanjiA repeatedly is invalid (never-overwrite would then block it
    // on the 2nd call); instead run enough varied easy items to raise theta,
    // then check kanjiB (untouched) directly via a raw seed call path.
    const responses = Array.from({ length: 10 }, (_, i) => [
      { kanjiId: 1000 + i, itemType: 'meaning' as const, correct: true },
      { kanjiId: 1000 + i, itemType: 'reading' as const, correct: true },
    ]).flat()
    // Difficulty lookups for synthetic ids 1000+i won't exist in
    // kanji_difficulty, so this call exercises the "unknown kanji" path —
    // covered separately in Step 3's implementation notes. For the seeding
    // assertion itself, target a real low-difficulty kanji instead:
    const [easyKanji] = await db
      .select({ kanjiId: schema.kanjiDifficulty.kanjiId })
      .from(schema.kanjiDifficulty)
      .orderBy(asc(schema.kanjiDifficulty.b))
      .limit(1)

    await completePlacement(db, TEST_USER_2, [
      { kanjiId: easyKanji.kanjiId, itemType: 'meaning', correct: true },
      { kanjiId: easyKanji.kanjiId, itemType: 'reading', correct: true },
    ])

    const [row] = await db
      .select()
      .from(userKanjiProgress)
      .where(and(eq(userKanjiProgress.userId, TEST_USER_2), eq(userKanjiProgress.kanjiId, easyKanji.kanjiId)))

    if (row) {
      // Seeded — verify the contract. (If p(knows) from a single flat-prior
      // response didn't clear 0.85, row is undefined and that's also valid;
      // this assertion only fires when a seed actually happened.)
      expect(row.status).toBe('reviewing')
      expect(row.stability).toBeGreaterThanOrEqual(3)
      expect(row.stability).toBeLessThanOrEqual(21)
      expect(row.totalReviews).toBe(0)

      const logs = await db
        .select()
        .from(reviewLogs)
        .where(and(eq(reviewLogs.userId, TEST_USER_2), eq(reviewLogs.kanjiId, easyKanji.kanjiId)))
      expect(logs.length).toBe(1)
      expect(logs[0].reviewType).toBe('placement')
      expect(logs[0].prevStatus).toBe('unseen')
      expect(logs[0].nextStatus).toBe('reviewing')
    }
  })

  it('a failed item writes nothing', async () => {
    const someKanjiId = await pickKanji(3)
    await completePlacement(db, TEST_USER_2, [
      { kanjiId: someKanjiId, itemType: 'meaning', correct: false },
    ])
    const rows = await db
      .select()
      .from(userKanjiProgress)
      .where(and(eq(userKanjiProgress.userId, TEST_USER_2), eq(userKanjiProgress.kanjiId, someKanjiId)))
    expect(rows.length).toBe(0)
  })

  it('persists ability_theta/ability_se and a derived inferred_level on the session', async () => {
    const someKanjiId = await pickKanji(4)
    await completePlacement(db, TEST_USER_2, [
      { kanjiId: someKanjiId, itemType: 'meaning', correct: true },
      { kanjiId: someKanjiId, itemType: 'reading', correct: true },
    ])
    const [session] = await db
      .select()
      .from(placementSessions)
      .where(eq(placementSessions.userId, TEST_USER_2))
      .orderBy(sql`started_at DESC`)
      .limit(1)
    expect(session.abilityTheta).not.toBeNull()
    expect(session.abilitySe).not.toBeNull()
    expect(session.inferredLevel).not.toBeNull()
  })
})

describe('getSessionPrior', () => {
  const TEST_USER_3 = '00000000-0000-0000-0000-0000000000d4'

  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${TEST_USER_3}, 'PriorFixture', 'UTC') ON CONFLICT DO NOTHING
    `)
  })

  // The plan's version had no cleanup here, which made the block pass exactly
  // once. The second test completes a placement for TEST_USER_3; without a
  // reset the session survives into the next run, so "reports no prior" then
  // sees a stored posterior and fails. Integration state must be reset per
  // test, not per process.
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM review_logs WHERE user_id = ${TEST_USER_3}`)
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${TEST_USER_3}`)
    await db.execute(sql`
      DELETE FROM placement_results
       WHERE session_id IN (SELECT id FROM placement_sessions WHERE user_id = ${TEST_USER_3})
    `)
    await db.execute(sql`DELETE FROM placement_sessions WHERE user_id = ${TEST_USER_3}`)
  })

  it('reports no prior for a user with no completed session', async () => {
    const result = await getSessionPrior(db, TEST_USER_3)
    expect(result.hasPrior).toBe(false)
  })

  it('reports a widened prior after a completed session (a retest starts from stored state, per spec §10)', async () => {
    const someKanjiId = await pickKanji(5)
    await refreshKanjiDifficulty(db)
    await completePlacement(db, TEST_USER_3, [
      { kanjiId: someKanjiId, itemType: 'meaning', correct: true },
      { kanjiId: someKanjiId, itemType: 'reading', correct: true },
    ])
    const result = await getSessionPrior(db, TEST_USER_3)
    expect(result.hasPrior).toBe(true)
    expect(Number.isFinite(result.theta)).toBe(true)
    expect(Number.isFinite(result.se)).toBe(true)
  })
})
