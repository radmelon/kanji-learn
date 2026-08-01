// apps/api/test/integration/met-buddy-at.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@kanji-learn/db'
import { buildTestApp } from '../helpers/test-app'
import { userRoutes } from '../../src/routes/user'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const USER = '00000000-0000-0000-0000-0000000000f7'
let app: Awaited<ReturnType<typeof buildTestApp>>

describe('met_buddy_at', () => {
  beforeAll(async () => {
    app = await buildTestApp({ plugin: userRoutes, opts: { prefix: '/v1/user' } })
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'MetBuddyFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })
  afterAll(async () => {
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
    await app.close()
    await client.end()
  })

  it('GET /v1/user/profile returns metBuddyAt, null for a fresh row', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/user/profile', headers: { 'x-test-user-id': USER },
    })
    expect(res.statusCode).toBe(200)
    // Read the KEY, not just the status — the field must exist and be null.
    expect(res.json().data).toHaveProperty('metBuddyAt', null)
  })

  it('PATCH cannot write metBuddyAt — z.object() strips it, HERE deliberately', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/v1/user/profile', headers: { 'x-test-user-id': USER },
      payload: { metBuddyAt: '2026-01-01T00:00:00.000Z', dailyGoal: 25 },
    })
    expect(res.statusCode).toBe(200)
    // Read back: the legitimate key landed, the guarded key did not.
    expect(res.json().data.dailyGoal).toBe(25)
    expect(res.json().data.metBuddyAt).toBeNull()
  })
})
