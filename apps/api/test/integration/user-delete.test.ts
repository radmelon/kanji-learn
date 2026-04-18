// apps/api/test/integration/user-delete.test.ts
//
// Verifies that deleting a user_profiles row cascades through every
// user-keyed table. Mirrors what supabaseAdmin.auth.admin.deleteUser()
// triggers in production via the auth.users -> user_profiles FK chain.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import {
  userProfiles,
  learnerProfiles,
  userKanjiProgress,
  learnerIdentity,
  learnerProfileUniversal,
} from '@kanji-learn/db'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER = '00000000-0000-0000-0000-000000000777'

beforeAll(async () => {
  await db.execute(sql`DELETE FROM user_profiles WHERE id = ${TEST_USER}`)
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM user_profiles WHERE id = ${TEST_USER}`)
  await client.end()
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM user_profiles WHERE id = ${TEST_USER}`)
})

describe('user_profiles delete cascade', () => {
  it('removes downstream rows when user_profiles is deleted', async () => {
    await db.insert(userProfiles).values({
      id: TEST_USER,
      displayName: 'CascadeTest',
      timezone: 'UTC',
    })
    await db.insert(learnerProfiles).values({
      userId: TEST_USER,
      country: 'AU',
      reasonsForLearning: ['Travel'],
      interests: [],
    })
    await db.insert(userKanjiProgress).values({
      userId: TEST_USER,
      kanjiId: 1,
    })
    // learner_identity gained an FK to user_profiles in migration 0016 so its
    // PII (email, display_name) cascades on delete. Cover it here so future
    // schema regressions surface immediately.
    await db.insert(learnerIdentity).values({
      learnerId: TEST_USER,
      displayName: 'CascadeTest',
      email: 'cascade@example.com',
    })
    await db.insert(learnerProfileUniversal).values({
      learnerId: TEST_USER,
      interests: ['Anime / Manga'],
    })

    const learnerBefore = await db.query.learnerProfiles.findFirst({
      where: eq(learnerProfiles.userId, TEST_USER),
    })
    expect(learnerBefore).toBeTruthy()

    await db.delete(userProfiles).where(eq(userProfiles.id, TEST_USER))

    const learnerAfter = await db.query.learnerProfiles.findFirst({
      where: eq(learnerProfiles.userId, TEST_USER),
    })
    const progressAfter = await db.query.userKanjiProgress.findFirst({
      where: eq(userKanjiProgress.userId, TEST_USER),
    })
    const identityAfter = await db.query.learnerIdentity.findFirst({
      where: eq(learnerIdentity.learnerId, TEST_USER),
    })
    const universalAfter = await db.query.learnerProfileUniversal.findFirst({
      where: eq(learnerProfileUniversal.learnerId, TEST_USER),
    })
    expect(learnerAfter).toBeUndefined()
    expect(progressAfter).toBeUndefined()
    expect(identityAfter).toBeUndefined()
    expect(universalAfter).toBeUndefined()
  })
})
