// apps/api/test/integration/social-mute.test.ts
//
// Verifies per-friendship mute via PATCH /v1/social/friends/:friendId and the
// corresponding notifyOfActivity projection on GET /v1/social/friends.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { userProfiles, friendships } from '@kanji-learn/db'
import { buildTestApp } from '../helpers/test-app'
import { socialRoutes } from '../../src/routes/social'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const REQUESTER = '00000000-0000-0000-0000-0000000000e1'
const ADDRESSEE = '00000000-0000-0000-0000-0000000000e2'

let app: Awaited<ReturnType<typeof buildTestApp>>
let friendshipId: string

beforeAll(async () => {
  app = await buildTestApp({ plugin: socialRoutes, opts: { prefix: '/v1/social' } })
})

afterAll(async () => {
  await app.close()
  await client.end()
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM friendships WHERE requester_id IN (${REQUESTER}, ${ADDRESSEE}) OR addressee_id IN (${REQUESTER}, ${ADDRESSEE})`)
  await db.execute(sql`DELETE FROM user_profiles WHERE id IN (${REQUESTER}, ${ADDRESSEE})`)
  await db.insert(userProfiles).values([
    { id: REQUESTER, displayName: 'Req', timezone: 'UTC' },
    { id: ADDRESSEE, displayName: 'Add', timezone: 'UTC' },
  ])
  const [row] = await db.insert(friendships).values({
    requesterId: REQUESTER, addresseeId: ADDRESSEE, status: 'accepted',
  }).returning({ id: friendships.id })
  friendshipId = row.id
})

describe('PATCH /v1/social/friends/:friendId', () => {
  it('updates the requester\'s side when the caller is the requester', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/social/friends/${ADDRESSEE}`,
      headers: { 'x-test-user-id': REQUESTER },
      payload: { notifyOfActivity: false },
    })
    expect(res.statusCode).toBe(200)
    const [row] = await db.select().from(friendships).where(eq(friendships.id, friendshipId))
    expect(row.requesterNotifyOfActivity).toBe(false)
    expect(row.addresseeNotifyOfActivity).toBe(true)
  })

  it('updates the addressee\'s side when the caller is the addressee', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/social/friends/${REQUESTER}`,
      headers: { 'x-test-user-id': ADDRESSEE },
      payload: { notifyOfActivity: false },
    })
    expect(res.statusCode).toBe(200)
    const [row] = await db.select().from(friendships).where(eq(friendships.id, friendshipId))
    expect(row.addresseeNotifyOfActivity).toBe(false)
    expect(row.requesterNotifyOfActivity).toBe(true)
  })

  it('the two sides are independent', async () => {
    await app.inject({ method: 'PATCH', url: `/v1/social/friends/${ADDRESSEE}`, headers: { 'x-test-user-id': REQUESTER }, payload: { notifyOfActivity: false } })
    await app.inject({ method: 'PATCH', url: `/v1/social/friends/${REQUESTER}`, headers: { 'x-test-user-id': ADDRESSEE }, payload: { notifyOfActivity: true } })
    const [row] = await db.select().from(friendships).where(eq(friendships.id, friendshipId))
    expect(row.requesterNotifyOfActivity).toBe(false)
    expect(row.addresseeNotifyOfActivity).toBe(true)
  })

  it('returns 404 when no accepted friendship exists', async () => {
    const STRANGER = '00000000-0000-0000-0000-0000000000e9'
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/social/friends/${STRANGER}`,
      headers: { 'x-test-user-id': REQUESTER },
      payload: { notifyOfActivity: false },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 when the friendship is pending, not accepted', async () => {
    await db.update(friendships).set({ status: 'pending' }).where(eq(friendships.id, friendshipId))
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/social/friends/${ADDRESSEE}`,
      headers: { 'x-test-user-id': REQUESTER },
      payload: { notifyOfActivity: false },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 401 without the test auth header', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/social/friends/${ADDRESSEE}`,
      payload: { notifyOfActivity: false },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /v1/social/friends — notifyOfActivity projection', () => {
  it('returns notifyOfActivity from the caller\'s perspective', async () => {
    await db.update(friendships).set({ requesterNotifyOfActivity: false, addresseeNotifyOfActivity: true }).where(eq(friendships.id, friendshipId))

    const reqRes = await app.inject({ method: 'GET', url: '/v1/social/friends', headers: { 'x-test-user-id': REQUESTER } })
    expect(reqRes.statusCode).toBe(200)
    const reqBody = reqRes.json().data
    expect(reqBody[0].userId).toBe(ADDRESSEE)
    expect(reqBody[0].notifyOfActivity).toBe(false)

    const addRes = await app.inject({ method: 'GET', url: '/v1/social/friends', headers: { 'x-test-user-id': ADDRESSEE } })
    const addBody = addRes.json().data
    expect(addBody[0].userId).toBe(REQUESTER)
    expect(addBody[0].notifyOfActivity).toBe(true)
  })
})
