import { describe, it, expect, beforeAll } from 'vitest'
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

  it('completing that full run seeds only kanji above the p(knows) threshold and never exceeds the character count asked', async () => {
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

    expect(result.appliedCount).toBeLessThanOrEqual(engine.getAskedKanjiIds().length)
    expect(result.theta).toBeGreaterThan(0) // all-correct run should land a positive ability estimate
  })
})
