import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { backfillUniversalKg } from '@kanji-learn/db'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USERS = [
  '00000000-0000-0000-0000-0000000bf001',
  '00000000-0000-0000-0000-0000000bf002',
]
const USER_IDS_SQL = sql`ARRAY[${sql.join(
  TEST_USERS.map((u) => sql`${u}::uuid`),
  sql`, `
)}]`

let kanjiIdIchi: number
let kanjiIdNi: number

async function resetFixtures() {
  // Child → parent order. learner_identity has ON DELETE CASCADE on
  // learner_knowledge_state and learner_timeline_events, but we delete
  // children first so the cleanup is explicit and order-independent of the
  // cascade graph.
  for (const id of TEST_USERS) {
    await db.execute(sql`DELETE FROM learner_timeline_events WHERE learner_id = ${id}`)
    await db.execute(sql`DELETE FROM learner_knowledge_state WHERE learner_id = ${id}`)
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${id}`)
    await db.execute(sql`DELETE FROM learner_identity WHERE learner_id = ${id}`)
    await db.execute(
      sql`INSERT INTO user_profiles (id, display_name, timezone)
          VALUES (${id}, 'Backfill', 'UTC')
          ON CONFLICT DO NOTHING`
    )
  }

  // Seed kanji rows (or reuse existing). jlpt_order uses out-of-band values
  // (9001/9002) to avoid clashing with the real seed data.
  const k1 = await db.execute(
    sql`INSERT INTO kanji (character, jlpt_level, jlpt_order, stroke_count)
        VALUES ('一', 'N5', 9001, 1)
        ON CONFLICT (character) DO UPDATE SET stroke_count = EXCLUDED.stroke_count
        RETURNING id`
  )
  const k2 = await db.execute(
    sql`INSERT INTO kanji (character, jlpt_level, jlpt_order, stroke_count)
        VALUES ('二', 'N5', 9002, 2)
        ON CONFLICT (character) DO UPDATE SET stroke_count = EXCLUDED.stroke_count
        RETURNING id`
  )
  kanjiIdIchi = (k1[0] as { id: number }).id
  kanjiIdNi = (k2[0] as { id: number }).id

  // Seed pre-UKG progress rows. User 0 has two (reviewing + burned); user 1
  // has one (learning).
  await db.execute(sql`
    INSERT INTO user_kanji_progress
      (user_id, kanji_id, status, interval, ease_factor, repetitions, next_review_at, updated_at)
    VALUES
      (${TEST_USERS[0]}, ${kanjiIdIchi}, 'reviewing', 3, 2.5, 1, now() + interval '3 days', now()),
      (${TEST_USERS[0]}, ${kanjiIdNi}, 'burned', 365, 2.6, 10, now() + interval '365 days', now()),
      (${TEST_USERS[1]}, ${kanjiIdIchi}, 'learning', 1, 2.5, 0, now() + interval '1 day', now())
  `)
}

describe('backfillUniversalKg', () => {
  beforeEach(resetFixtures)

  it('creates a learner_identity row for each user with progress', async () => {
    const result = await backfillUniversalKg(db)
    expect(result.identitiesInserted).toBe(2)

    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM learner_identity
          WHERE learner_id = ANY(${USER_IDS_SQL})`
    )
    expect((rows[0] as { n: number }).n).toBe(2)
  })

  it('mirrors every progress row into learner_knowledge_state', async () => {
    await backfillUniversalKg(db)
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM learner_knowledge_state
          WHERE learner_id = ANY(${USER_IDS_SQL})`
    )
    expect((rows[0] as { n: number }).n).toBe(3)
  })

  it('sets mastery_level according to MASTERY_BY_STATUS', async () => {
    await backfillUniversalKg(db)
    const rows = await db.execute(
      sql`SELECT subject, mastery_level::float AS m FROM learner_knowledge_state
          WHERE learner_id = ${TEST_USERS[0]} ORDER BY subject`
    )
    const bySubject = Object.fromEntries(
      rows.map((r) => [(r as { subject: string }).subject, (r as { m: number }).m])
    )
    expect(bySubject['kanji:一']).toBeCloseTo(0.6, 3) // reviewing
    expect(bySubject['kanji:二']).toBeCloseTo(1.0, 3) // burned
  })

  it('stamps app_source as kanji-learn-legacy', async () => {
    await backfillUniversalKg(db)
    const rows = await db.execute(
      sql`SELECT DISTINCT app_source FROM learner_knowledge_state
          WHERE learner_id = ANY(${USER_IDS_SQL})`
    )
    expect(rows.length).toBe(1)
    expect((rows[0] as { app_source: string }).app_source).toBe('kanji-learn-legacy')
  })

  it('creates one legacy_import timeline event per user', async () => {
    const result = await backfillUniversalKg(db)
    expect(result.timelineEventsInserted).toBe(2)

    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM learner_timeline_events
          WHERE learner_id = ANY(${USER_IDS_SQL})
          AND event_type = 'legacy_import'`
    )
    expect((rows[0] as { n: number }).n).toBe(2)
  })

  it('is idempotent — running twice produces the same row counts', async () => {
    await backfillUniversalKg(db)
    const second = await backfillUniversalKg(db)

    // Second run: no new identity rows, no new timeline events.
    expect(second.identitiesInserted).toBe(0)
    expect(second.timelineEventsInserted).toBe(0)

    const knowledgeRows = await db.execute(
      sql`SELECT count(*)::int AS n FROM learner_knowledge_state
          WHERE learner_id = ANY(${USER_IDS_SQL})`
    )
    expect((knowledgeRows[0] as { n: number }).n).toBe(3)

    const timelineRows = await db.execute(
      sql`SELECT count(*)::int AS n FROM learner_timeline_events
          WHERE learner_id = ANY(${USER_IDS_SQL})
          AND event_type = 'legacy_import'`
    )
    expect((timelineRows[0] as { n: number }).n).toBe(2)
  })
})
