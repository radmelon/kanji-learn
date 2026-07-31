// apps/api/test/integration/user-profile-buddy-fields.test.ts
//
// Guards against a recurrence of the documented "silent strip" failure mode
// (docs/HANDOFF.md, docs/SOP.md): Zod's z.object() strips unknown keys rather
// than rejecting them, so a PATCH field missing from
// `updateProfileSchema` returns 200 while quietly discarding the value.
// Four shipped features went inert this way before. This test PATCHes
// buddyDay / buddyIntervalWeeks through the real route handler and reads the
// row back from Postgres — not the response body — so it fails if the
// schema (or the handler) ever drops these fields again.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { userProfiles } from '@kanji-learn/db'

import { buildTestApp } from '../helpers/test-app'
import { userRoutes } from '../../src/routes/user'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER_A = '00000000-0000-0000-0000-0000000000b1'

let app: Awaited<ReturnType<typeof buildTestApp>>

beforeAll(async () => {
  app = await buildTestApp({ plugin: userRoutes, opts: { prefix: '/v1/user' } })
})

afterAll(async () => {
  await app.close()
  await client.end()
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER_A}`)
  await db.insert(userProfiles).values({ id: USER_A, displayName: 'BuddyFieldsTest', timezone: 'UTC' })
})

describe('PATCH /v1/user/profile — buddyDay / buddyIntervalWeeks', () => {
  it('persists buddyDay and buddyIntervalWeeks to user_profiles', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/user/profile',
      headers: { 'x-test-user-id': USER_A },
      payload: { buddyDay: 3, buddyIntervalWeeks: 2 },
    })
    expect(res.statusCode).toBe(200)

    const row = await db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, USER_A),
    })
    expect(row).toBeDefined()
    expect(row!.buddyDay).toBe(3)
    expect(row!.buddyIntervalWeeks).toBe(2)
  })

  it('persists buddyDay: null — clearing an existing appointment', async () => {
    // Seed the "has an appointment" starting state with a direct DB write
    // (not through the API) so the only way buddyDay can end up null is if
    // the PATCH below actually reaches the database. If buddyDay were
    // stripped by the schema, this row would stay at 5 and the assertion
    // below would catch it — unlike round-tripping null through the API
    // both times, which can't tell "cleared" from "always discarded".
    await db.update(userProfiles).set({ buddyDay: 5, buddyIntervalWeeks: 1 }).where(eq(userProfiles.id, USER_A))

    const clearRes = await app.inject({
      method: 'PATCH',
      url: '/v1/user/profile',
      headers: { 'x-test-user-id': USER_A },
      payload: { buddyDay: null },
    })
    expect(clearRes.statusCode).toBe(200)

    const row = await db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, USER_A),
    })
    expect(row).toBeDefined()
    expect(row!.buddyDay).toBeNull()
    // Untouched by the second PATCH, which only sent buddyDay.
    expect(row!.buddyIntervalWeeks).toBe(1)
  })
})
