// Schema guarantees for buddy_session_utterances (slice 3 §6).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER = '00000000-0000-0000-0000-0000000000c1'
const WEEK = '2026-08-03'

beforeAll(async () => {
  await db.insert(schema.userProfiles)
    .values({ id: USER, displayName: 'Utterance Fixture', timezone: 'America/Los_Angeles' })
    .onConflictDoNothing()
})

beforeEach(async () => {
  await db.delete(schema.buddySessionUtterances)
    .where(eq(schema.buddySessionUtterances.userId, USER))
})

afterAll(async () => {
  await db.delete(schema.buddySessionUtterances)
    .where(eq(schema.buddySessionUtterances.userId, USER))
  await db.delete(schema.userProfiles).where(eq(schema.userProfiles.id, USER))
  await client.end()
})

describe('buddy_session_utterances', () => {
  // MUTATION CAUGHT: shipping the table without the unique index. Task 4's
  // cache would then accumulate one row per app open on a Buddy day — the
  // exact "Buddy says something different every time you look" failure §6
  // exists to prevent — and the read would pick an arbitrary row.
  it('permits one utterance per (user, week) and rejects a duplicate', async () => {
    await db.insert(schema.buddySessionUtterances)
      .values({ userId: USER, weekStart: WEEK, text: 'first', providerName: 'groq' })

    await expect(
      db.insert(schema.buddySessionUtterances)
        .values({ userId: USER, weekStart: WEEK, text: 'second', providerName: 'groq' }),
    ).rejects.toThrow()

    const rows = await db.select().from(schema.buddySessionUtterances)
      .where(eq(schema.buddySessionUtterances.userId, USER))
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe('first')
  })

  // MUTATION CAUGHT: a different week_start colliding — proves the unique key
  // is (user_id, week_start) and not user_id alone, which would make the
  // cache hold one utterance ever rather than one per period.
  it('allows a second utterance in a different period', async () => {
    await db.insert(schema.buddySessionUtterances)
      .values({ userId: USER, weekStart: WEEK, text: 'first', providerName: 'groq' })
    await db.insert(schema.buddySessionUtterances)
      .values({ userId: USER, weekStart: '2026-08-10', text: 'next', providerName: 'groq' })

    const rows = await db.select().from(schema.buddySessionUtterances)
      .where(eq(schema.buddySessionUtterances.userId, USER))
    expect(rows).toHaveLength(2)
  })
})
