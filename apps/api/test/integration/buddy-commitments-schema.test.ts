// Confirms migration 0030's columns, table and constraints exist and behave.
// Fixture pattern mirrors learner-state-refresh.test.ts.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER_ID = '00000000-0000-0000-0000-0000000000b1'

beforeAll(async () => {
  await db
    .insert(schema.userProfiles)
    .values({ id: TEST_USER_ID, displayName: 'Commitment Fixture' })
    .onConflictDoNothing()
})

beforeEach(async () => {
  await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
})

afterAll(async () => {
  await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
  await db.delete(schema.userProfiles).where(eq(schema.userProfiles.id, TEST_USER_ID))
  await client.end()
})

describe('buddy_commitments schema', () => {
  it('stores a commitment, and buddy_day defaults to null with weekly cadence', async () => {
    await db.insert(schema.buddyCommitments).values({
      userId: TEST_USER_ID,
      weekStart: '2026-08-03',
      daysCommitted: 4,
      minutesPerDay: 15,
      source: 'session',
    })

    const rows = await db
      .select()
      .from(schema.buddyCommitments)
      .where(eq(schema.buddyCommitments.userId, TEST_USER_ID))

    expect(rows).toHaveLength(1)
    expect(rows[0].daysCommitted).toBe(4)
    expect(rows[0].source).toBe('session')
    expect(rows[0].method).toBeNull()
    expect(rows[0].experimentUntil).toBeNull()

    const profile = await db
      .select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.id, TEST_USER_ID))

    // NULL buddy_day is meaningful: "no appointment yet", and the correct
    // state for every row predating this migration.
    expect(profile[0].buddyDay).toBeNull()
    expect(profile[0].buddyIntervalWeeks).toBe(1)
  })

  it('rejects a second commitment for the same week', async () => {
    await db.insert(schema.buddyCommitments).values({
      userId: TEST_USER_ID,
      weekStart: '2026-08-03',
      daysCommitted: 4,
      minutesPerDay: 15,
      source: 'session',
    })

    await expect(
      db.insert(schema.buddyCommitments).values({
        userId: TEST_USER_ID,
        weekStart: '2026-08-03',
        daysCommitted: 2,
        minutesPerDay: 10,
        source: 'rolled_forward',
      })
    ).rejects.toThrow()
  })

  it('rejects an out-of-range source', async () => {
    await expect(
      db.insert(schema.buddyCommitments).values({
        userId: TEST_USER_ID,
        weekStart: '2026-08-10',
        daysCommitted: 4,
        minutesPerDay: 15,
        source: 'invented',
      })
    ).rejects.toThrow()
  })

  it('rejects a days_committed outside 1-7', async () => {
    await expect(
      db.insert(schema.buddyCommitments).values({
        userId: TEST_USER_ID,
        weekStart: '2026-08-17',
        daysCommitted: 0,
        minutesPerDay: 15,
        source: 'session',
      })
    ).rejects.toThrow()
  })

  it('rejects a buddy_day outside 0-6', async () => {
    await expect(
      db
        .update(schema.userProfiles)
        .set({ buddyDay: 9 })
        .where(eq(schema.userProfiles.id, TEST_USER_ID))
    ).rejects.toThrow()
  })

  // Migration 0031.
  it('rejects a minutes_per_day outside 1-600', async () => {
    await expect(
      db.insert(schema.buddyCommitments).values({
        userId: TEST_USER_ID,
        weekStart: '2026-08-24',
        daysCommitted: 4,
        minutesPerDay: 601,
        source: 'session',
      })
    ).rejects.toThrow()

    await expect(
      db.insert(schema.buddyCommitments).values({
        userId: TEST_USER_ID,
        weekStart: '2026-08-31',
        daysCommitted: 4,
        minutesPerDay: 0,
        source: 'session',
      })
    ).rejects.toThrow()
  })
})
