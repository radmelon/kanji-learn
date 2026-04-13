// apps/api/test/integration/learner-profile.test.ts
//
// Integration tests for the learner_profiles upsert logic.
// Mirrors the PATCH /v1/user/learner-profile route handler behaviour
// (insert().onConflictDoUpdate()) and the GET route's null-safe defaults,
// exercised directly against the drizzle client (no Fastify boot required).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { learnerProfiles } from '@kanji-learn/db'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER = '00000000-0000-0000-0000-000000000888'

beforeAll(async () => {
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES (${TEST_USER}, 'LearnerProfileTest', 'UTC')
    ON CONFLICT DO NOTHING
  `)
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM learner_profiles WHERE user_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM user_profiles WHERE id = ${TEST_USER}`)
  await client.end()
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM learner_profiles WHERE user_id = ${TEST_USER}`)
})

describe('learner_profiles upsert logic', () => {
  it('creates a row on first upsert', async () => {
    await db
      .insert(learnerProfiles)
      .values({
        userId: TEST_USER,
        country: 'AU',
        reasonsForLearning: ['Travel'],
        interests: ['Anime / Manga'],
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: learnerProfiles.userId,
        set: {
          country: 'AU',
          reasonsForLearning: ['Travel'],
          interests: ['Anime / Manga'],
          updatedAt: new Date(),
        },
      })

    const row = await db.query.learnerProfiles.findFirst({
      where: (lp, { eq }) => eq(lp.userId, TEST_USER),
    })

    expect(row).toBeDefined()
    expect(row!.userId).toBe(TEST_USER)
    expect(row!.country).toBe('AU')
    expect(row!.reasonsForLearning).toEqual(['Travel'])
    expect(row!.interests).toEqual(['Anime / Manga'])
  })

  it('partial update preserves unchanged fields', async () => {
    // First insert a full row
    await db
      .insert(learnerProfiles)
      .values({
        userId: TEST_USER,
        country: 'JP',
        reasonsForLearning: ['Travel'],
        interests: ['Gaming'],
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: learnerProfiles.userId,
        set: {
          country: 'JP',
          reasonsForLearning: ['Travel'],
          interests: ['Gaming'],
          updatedAt: new Date(),
        },
      })

    // Second upsert — only interests in the set clause (mimics PATCH with partial body)
    await db
      .insert(learnerProfiles)
      .values({
        userId: TEST_USER,
        interests: ['Gaming', 'Film'],
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: learnerProfiles.userId,
        set: {
          interests: ['Gaming', 'Film'],
          updatedAt: new Date(),
        },
      })

    const row = await db.query.learnerProfiles.findFirst({
      where: (lp, { eq }) => eq(lp.userId, TEST_USER),
    })

    expect(row).toBeDefined()
    expect(row!.country).toBe('JP')
    expect(row!.reasonsForLearning).toEqual(['Travel'])
    expect(row!.interests).toEqual(['Gaming', 'Film'])
  })

  it('GET returns null-safe defaults when no row exists', async () => {
    // No insert — row should not exist after beforeEach cleanup
    const row = await db.query.learnerProfiles.findFirst({
      where: (lp, { eq }) => eq(lp.userId, TEST_USER),
    })

    // Mirrors the GET route handler's null-safe response construction
    const data = {
      country: row?.country ?? null,
      reasonsForLearning: row?.reasonsForLearning ?? [],
      interests: row?.interests ?? [],
    }

    expect(data.country).toBeNull()
    expect(data.reasonsForLearning).toEqual([])
    expect(data.interests).toEqual([])
  })

  it('stores null country when set to null', async () => {
    await db
      .insert(learnerProfiles)
      .values({
        userId: TEST_USER,
        country: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: learnerProfiles.userId,
        set: {
          country: null,
          updatedAt: new Date(),
        },
      })

    const row = await db.query.learnerProfiles.findFirst({
      where: (lp, { eq }) => eq(lp.userId, TEST_USER),
    })

    expect(row).toBeDefined()
    expect(row!.country).toBeNull()
  })
})
