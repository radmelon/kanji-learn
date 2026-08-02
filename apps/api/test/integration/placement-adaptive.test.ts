import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { PlacementEngine } from '@kanji-learn/shared'
import { selectNextItems, getQuestionsWithDistractors, completePlacement } from '../../src/services/placement.service'
import { refreshKanjiDifficulty } from '../../src/services/placement-difficulty.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const TEST_USER = '00000000-0000-0000-0000-0000000000d6'

describe('the adaptive loop end-to-end', () => {
  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${TEST_USER}, 'AdaptiveFixture', 'UTC') ON CONFLICT DO NOTHING
    `)
    await refreshKanjiDifficulty(db)
  })

  // This suite is the heaviest writer in the whole test database, and it used
  // to leave everything behind. `completePlacement` seeds corpus-wide by design
  // (2cab737), so against the real 2,294-kanji corpus one run of the second
  // test below left **2,283** review_logs and user_kanji_progress rows for this
  // user — permanently, and growing no further only because it is idempotent.
  //
  // Three suites broke on the NEXT run, none of them obviously related:
  //   - the first test here: selectNextItems excludes any kanji with a
  //     review_log for the user, so the candidate pool collapsed from 2,294 to
  //     ~11 and the loop exhausted it at 6 characters, below the floor of 8 —
  //     which reads exactly like a convergence failure.
  //   - placement-difficulty's "fewer than 300 pooled rows" test: it saw 2,283.
  //   - backfill's suite, which iterates EVERY user_kanji_progress row.
  //
  // None of this was visible while the test DB held 7 kanji, because seeding
  // 7 rows is invisible. It was never idempotent across runs; the corpus just
  // made the leak big enough to notice.
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM review_logs WHERE user_id = ${TEST_USER}`)
    await db.execute(sql`DELETE FROM review_sessions WHERE user_id = ${TEST_USER}`)
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${TEST_USER}`)
    await db.execute(sql`DELETE FROM placement_results WHERE session_id IN (
      SELECT id FROM placement_sessions WHERE user_id = ${TEST_USER})`)
    await db.execute(sql`DELETE FROM placement_sessions WHERE user_id = ${TEST_USER}`)
  })

  afterAll(async () => {
    // Leave the database as we found it, so the NEXT suite in the run — and the
    // next run of this one — starts from the same state we did.
    await db.execute(sql`DELETE FROM review_logs WHERE user_id = ${TEST_USER}`)
    await db.execute(sql`DELETE FROM review_sessions WHERE user_id = ${TEST_USER}`)
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${TEST_USER}`)
    await db.execute(sql`DELETE FROM placement_results WHERE session_id IN (
      SELECT id FROM placement_sessions WHERE user_id = ${TEST_USER})`)
    await db.execute(sql`DELETE FROM placement_sessions WHERE user_id = ${TEST_USER}`)
  })

  it('a consistently-correct learner stops between the floor (8) and cap (24) characters', async (ctx) => {
    // PRECONDITION: the corpus must exceed the cap (24). selectNextItems never
    // returns a kanji already asked, so with a smaller corpus the loop runs out
    // of items and breaks below the floor — locally it stops at 7 characters
    // against a floor of 8, which looks like a convergence failure but is just
    // an empty candidate set. Testing "stops before the cap" also requires more
    // than 24 available characters, or the bound is satisfied trivially.
    // The local test DB holds 7 kanji; production holds 2294. See
    // docs/local-test-db.md.
    const [{ n }] = (await db.execute(
      sql`SELECT count(*)::int AS n FROM kanji_difficulty`,
    )) as unknown as { n: number }[]
    if (n <= 24) {
      ctx.skip(
        `corpus is ${n} kanji, not more than capCharacters=24 — the adaptive loop exhausts the candidate pool before it can converge, so neither bound is testable. Seed a fuller kanji set to make this meaningful.`,
      )
      return
    }

    const engine = new PlacementEngine({
      floorCharacters: 8, capCharacters: 24, bandWidth: 1.5, readingOffset: 0.4, priorMean: 0,
    })

    let iterations = 0
    while (!engine.isDone() && iterations < 30) {
      iterations++
      const theta = engine.getThetaHat()
      const items = await selectNextItems(db, TEST_USER, theta, engine.getAskedKanjiIds(), 5)
      if (items.length === 0) break

      const kanjiIds = items.map((i) => i.kanjiId)
      const questions = await getQuestionsWithDistractors(db, kanjiIds)

      for (const q of questions) {
        engine.recordItemResult(q.kanjiId, 'meaning', q.bMeaning, true)
        engine.recordItemResult(q.kanjiId, 'reading', q.bReading, true)
        if (engine.isDone()) break
      }
    }

    const charactersAsked = engine.getAskedKanjiIds().length
    expect(charactersAsked).toBeGreaterThanOrEqual(8)
    expect(charactersAsked).toBeLessThanOrEqual(24)
    expect(iterations).toBeLessThan(30) // did not hit the test's own safety valve
  })

  it('completing that full run seeds every kanji above the p(knows) threshold, not just the ones asked', async () => {
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${TEST_USER}`)
    await db.execute(sql`DELETE FROM review_logs WHERE user_id = ${TEST_USER}`)

    const engine = new PlacementEngine({
      floorCharacters: 8, capCharacters: 24, bandWidth: 1.5, readingOffset: 0.4, priorMean: 0,
    })
    let iterations = 0
    while (!engine.isDone() && iterations < 30) {
      iterations++
      const items = await selectNextItems(db, TEST_USER, engine.getThetaHat(), engine.getAskedKanjiIds(), 5)
      if (items.length === 0) break
      const questions = await getQuestionsWithDistractors(db, items.map((i) => i.kanjiId))
      for (const q of questions) {
        engine.recordItemResult(q.kanjiId, 'meaning', q.bMeaning, true)
        engine.recordItemResult(q.kanjiId, 'reading', q.bReading, true)
        if (engine.isDone()) break
      }
    }

    const responses = engine.getAskedItems().map((i) => ({ kanjiId: i.kanjiId, itemType: i.itemType, correct: i.correct }))
    const result = await completePlacement(db, TEST_USER, responses)

    expect(result.theta).toBeGreaterThan(0) // all-correct run should land a positive ability estimate

    // This assertion used to be `appliedCount <= askedKanjiIds.length`, which
    // is the PRE-2cab737 rule: seeding scoped to the items actually asked.
    // 2cab737 deliberately moved seeding onto the whole corpus — a learner who
    // demonstrably knows kanji at difficulty b should not have to be shown
    // every easier one individually — and placement-service.test.ts asserts
    // exactly that, requiring a NEVER-ASKED easy kanji to be seeded.
    //
    // The two tests contradicted each other and both passed, because the local
    // corpus was 7 kanji and 7 <= 9 asked. Against the real 2,294 it seeded
    // 2,283 and this one finally failed. The old assertion was the wrong one.
    const [{ total }] = (await db.execute(
      sql`SELECT count(*)::int AS total FROM kanji_difficulty`,
    )) as unknown as { total: number }[]

    expect(result.appliedCount).toBeGreaterThan(engine.getAskedKanjiIds().length)
    // ...but the 0.85 threshold must still exclude the hardest items. Seeding
    // the entire corpus off one all-correct run would mean the gate is dead.
    expect(result.appliedCount).toBeLessThan(total)
  })
})
