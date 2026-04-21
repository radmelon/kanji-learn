// apps/api/test/integration/push-tokens.test.ts
//
// Verifies POST/DELETE /v1/push-tokens register and remove per-device tokens.
// The schema is (user_id, token) unique — duplicate POSTs are idempotent.
//
// Uses the minimal test-app helper to avoid booting the production auth
// plugin (which fetches Supabase JWKS at startup). Auth is stubbed via the
// `x-test-user-id` header.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { userPushTokens, userProfiles } from '@kanji-learn/db'

import { buildTestApp } from '../helpers/test-app'
import { pushTokensRoute } from '../../src/routes/push-tokens'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER_A = '00000000-0000-0000-0000-000000000aa1'
const USER_B = '00000000-0000-0000-0000-000000000bb2'
const EXPO_IOS = 'ExponentPushToken[test-ios-token-a1]'
const EXPO_ANDROID = 'ExponentPushToken[test-and-token-a2]'

let app: Awaited<ReturnType<typeof buildTestApp>>

beforeAll(async () => {
  app = await buildTestApp(pushTokensRoute)
})

afterAll(async () => {
  await app.close()
  await client.end()
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM user_push_tokens WHERE user_id IN (${USER_A}, ${USER_B})`)
  await db.execute(sql`DELETE FROM user_profiles WHERE id IN (${USER_A}, ${USER_B})`)
  await db.insert(userProfiles).values({ id: USER_A, displayName: 'A', timezone: 'UTC' })
})

describe('POST /v1/push-tokens', () => {
  it('creates a token row on first call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/push-tokens',
      headers: { 'x-test-user-id': USER_A },
      payload: { token: EXPO_IOS, platform: 'ios' },
    })
    expect(res.statusCode).toBe(201)
    const rows = await db.select().from(userPushTokens).where(eq(userPushTokens.userId, USER_A))
    expect(rows).toHaveLength(1)
    expect(rows[0].token).toBe(EXPO_IOS)
    expect(rows[0].platform).toBe('ios')
  })

  it('is idempotent — duplicate (user_id, token) returns 200 without duplicating', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/v1/push-tokens',
      headers: { 'x-test-user-id': USER_A },
      payload: { token: EXPO_IOS, platform: 'ios' },
    })
    expect(first.statusCode).toBe(201)
    const second = await app.inject({
      method: 'POST',
      url: '/v1/push-tokens',
      headers: { 'x-test-user-id': USER_A },
      payload: { token: EXPO_IOS, platform: 'ios' },
    })
    expect(second.statusCode).toBe(200)
    const rows = await db.select().from(userPushTokens).where(eq(userPushTokens.userId, USER_A))
    expect(rows).toHaveLength(1)
  })

  it('allows the same user to register multiple different tokens', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/push-tokens',
      headers: { 'x-test-user-id': USER_A },
      payload: { token: EXPO_IOS, platform: 'ios' },
    })
    await app.inject({
      method: 'POST',
      url: '/v1/push-tokens',
      headers: { 'x-test-user-id': USER_A },
      payload: { token: EXPO_ANDROID, platform: 'android' },
    })
    const rows = await db.select().from(userPushTokens).where(eq(userPushTokens.userId, USER_A))
    expect(rows).toHaveLength(2)
  })

  it('rejects a malformed token with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/push-tokens',
      headers: { 'x-test-user-id': USER_A },
      payload: { token: 'not-a-real-token', platform: 'ios' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an unknown platform with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/push-tokens',
      headers: { 'x-test-user-id': USER_A },
      payload: { token: EXPO_IOS, platform: 'windows' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 401 without a JWT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/push-tokens',
      payload: { token: EXPO_IOS, platform: 'ios' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('DELETE /v1/push-tokens/:token', () => {
  it('removes the row when it exists', async () => {
    await db.insert(userPushTokens).values({ userId: USER_A, token: EXPO_IOS, platform: 'ios' })
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/push-tokens/${encodeURIComponent(EXPO_IOS)}`,
      headers: { 'x-test-user-id': USER_A },
    })
    expect(res.statusCode).toBe(204)
    const rows = await db.select().from(userPushTokens).where(eq(userPushTokens.userId, USER_A))
    expect(rows).toHaveLength(0)
  })

  it('returns 204 when the token does not exist (idempotent)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/push-tokens/${encodeURIComponent(EXPO_IOS)}`,
      headers: { 'x-test-user-id': USER_A },
    })
    expect(res.statusCode).toBe(204)
  })

  it("does not delete another user's token", async () => {
    await db.insert(userProfiles).values({ id: USER_B, displayName: 'B', timezone: 'UTC' })
    await db.insert(userPushTokens).values({ userId: USER_B, token: EXPO_IOS, platform: 'ios' })
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/push-tokens/${encodeURIComponent(EXPO_IOS)}`,
      headers: { 'x-test-user-id': USER_A }, // userA trying to delete userB's token
    })
    expect(res.statusCode).toBe(204)
    const bRows = await db.select().from(userPushTokens).where(eq(userPushTokens.userId, USER_B))
    expect(bRows).toHaveLength(1) // userB's row untouched
  })

  it('returns 401 without a JWT', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/push-tokens/${encodeURIComponent(EXPO_IOS)}`,
    })
    expect(res.statusCode).toBe(401)
  })
})
