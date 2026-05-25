// apps/api/test/integration/buddy-nudges-route.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { buildTestApp } from '../helpers/test-app'
import { buddyNudgesRoutes } from '../../src/routes/buddy-nudges'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER_A = '00000000-0000-0000-0000-0000000000c1'
let app: Awaited<ReturnType<typeof buildTestApp>>

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app = await buildTestApp({ plugin: buddyNudgesRoutes, opts: { prefix: '/v1/buddy/nudges' } } as any)
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES (${USER_A}, 'NudgeRouteTest', 'UTC') ON CONFLICT DO NOTHING
  `)
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM buddy_nudges WHERE user_id = ${USER_A}`)
  await db.execute(sql`DELETE FROM learner_state_cache WHERE user_id = ${USER_A}`)
})

afterAll(async () => {
  await app.close()
  await client.end()
})

describe('GET /v1/buddy/nudges', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/buddy/nudges?screen=dashboard' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 on missing screen query param', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/buddy/nudges',
      headers: { 'x-test-user-id': USER_A },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 on invalid screen value', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/buddy/nudges?screen=bogus',
      headers: { 'x-test-user-id': USER_A },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns an array (possibly empty) on valid auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/buddy/nudges?screen=dashboard',
      headers: { 'x-test-user-id': USER_A },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
  })
})

describe('POST /v1/buddy/nudges/:id/dismiss', () => {
  async function seedDashboardMeetBuddy(): Promise<string> {
    const expiresAt = new Date(Date.now() + 365 * 86_400_000).toISOString()
    const row = await db.execute(sql`
      INSERT INTO buddy_nudges
        (user_id, screen, nudge_type, content, action_type, action_payload,
         priority, delivery_target, expires_at, generated_by, social_framing)
      VALUES (${USER_A}, 'dashboard', 'encouragement', 'hi', 'dismiss',
        '{"kind":"meet_buddy"}'::jsonb, 10, 'app', ${expiresAt}, 'template', false)
      RETURNING id
    `)
    return (row as unknown as Array<{ id: string }>)[0].id
  }

  it('marks dismissed_at and returns 200', async () => {
    const id = await seedDashboardMeetBuddy()
    const res = await app.inject({
      method: 'POST',
      url: `/v1/buddy/nudges/${id}/dismiss`,
      headers: { 'x-test-user-id': USER_A },
    })
    expect(res.statusCode).toBe(200)
    const after = await db.execute(
      sql`SELECT dismissed_at FROM buddy_nudges WHERE id = ${id}`,
    )
    const rows = after as unknown as Array<{ dismissed_at: string | null }>
    expect(rows[0].dismissed_at).not.toBeNull()
  })

  it('is idempotent (second dismiss is 200, dismissed_at unchanged)', async () => {
    const id = await seedDashboardMeetBuddy()
    await app.inject({
      method: 'POST', url: `/v1/buddy/nudges/${id}/dismiss`,
      headers: { 'x-test-user-id': USER_A },
    })
    const firstRows = (await db.execute(
      sql`SELECT dismissed_at FROM buddy_nudges WHERE id = ${id}`,
    )) as unknown as Array<{ dismissed_at: string }>
    const firstTs = firstRows[0].dismissed_at

    const res = await app.inject({
      method: 'POST', url: `/v1/buddy/nudges/${id}/dismiss`,
      headers: { 'x-test-user-id': USER_A },
    })
    expect(res.statusCode).toBe(200)
    const secondRows = (await db.execute(
      sql`SELECT dismissed_at FROM buddy_nudges WHERE id = ${id}`,
    )) as unknown as Array<{ dismissed_at: string }>
    expect(secondRows[0].dismissed_at).toBe(firstTs)
  })

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/buddy/nudges/00000000-0000-0000-0000-000000000000/dismiss`,
      headers: { 'x-test-user-id': USER_A },
    })
    expect(res.statusCode).toBe(404)
  })

  it("returns 404 dismissing another user's nudge", async () => {
    const id = await seedDashboardMeetBuddy()
    const res = await app.inject({
      method: 'POST',
      url: `/v1/buddy/nudges/${id}/dismiss`,
      headers: { 'x-test-user-id': '00000000-0000-0000-0000-0000000000c9' },
    })
    expect(res.statusCode).toBe(404)
  })
})
