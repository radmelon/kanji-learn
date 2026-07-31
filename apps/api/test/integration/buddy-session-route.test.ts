// GET /v1/buddy/session and POST /v1/buddy/session/commitment — auth via the
// bare x-test-user-id header (this repo's convention; see helpers/test-app.ts).

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { buildTestApp } from '../helpers/test-app'
import { buddySessionRoutes } from '../../src/routes/buddy-session'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER_ID = '00000000-0000-0000-0000-0000000000b3'
let app: Awaited<ReturnType<typeof buildTestApp>>

beforeAll(async () => {
  app = await buildTestApp({ plugin: buddySessionRoutes, opts: { prefix: '/v1/buddy/session' } })
  await db.insert(schema.userProfiles)
    .values({ id: TEST_USER_ID, displayName: 'Route Fixture', timezone: 'America/Los_Angeles' })
    .onConflictDoUpdate({
      target: schema.userProfiles.id,
      set: { timezone: 'America/Los_Angeles' },
    })
})

beforeEach(async () => {
  await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
  await db.update(schema.userProfiles)
    .set({ buddyDay: null, buddyIntervalWeeks: 1 })
    .where(eq(schema.userProfiles.id, TEST_USER_ID))
})

afterAll(async () => {
  await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
  await db.delete(schema.userProfiles).where(eq(schema.userProfiles.id, TEST_USER_ID))
  await app.close()
  await client.end()
})

function get() {
  return app.inject({
    method: 'GET',
    url: '/v1/buddy/session',
    headers: { 'x-test-user-id': TEST_USER_ID },
  })
}

async function postCommitment(payload: Record<string, unknown>) {
  return await app.inject({
    method: 'POST',
    url: '/v1/buddy/session/commitment',
    headers: { 'x-test-user-id': TEST_USER_ID },
    payload,
  })
}

describe('GET /v1/buddy/session', () => {
  it('reports not_scheduled when the learner has no buddy_day', async () => {
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.json().data.state).toBe('not_scheduled')
  })

  it('returns an opener and a proposed commitment when a session is due', async () => {
    // Set buddy_day to today in the learner's timezone so the session is due.
    const todayWeekday = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
    ).getDay()
    await db.update(schema.userProfiles)
      .set({ buddyDay: todayWeekday })
      .where(eq(schema.userProfiles.id, TEST_USER_ID))

    const res = await get()
    const data = res.json().data

    expect(data.state).toBe('due')
    expect(data.opener.kind).toBe('first_ever')
    expect(typeof data.opener.text).toBe('string')
    expect(data.proposedCommitment.daysCommitted).toBe(4)
    expect(data.proposedCommitment.source).toBe('default')
  })

  it('reports waiting with a nextDue date when a session was just held', async () => {
    const todayWeekday = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
    ).getDay()
    await db.update(schema.userProfiles)
      .set({ buddyDay: todayWeekday })
      .where(eq(schema.userProfiles.id, TEST_USER_ID))

    // Agree a commitment for the due session, then ask again — the same
    // period should now read as "waiting", not "due" a second time.
    const dueRes = await get()
    const weekStart = dueRes.json().data.weekStart as string
    await postCommitment({
      weekStart, daysCommitted: 5, minutesPerDay: 20, dayTargets: null, focus: null,
    })

    const res = await get()
    const data = res.json().data
    expect(data.state).toBe('waiting')
    expect(typeof data.nextDue).toBe('string')
  })

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/buddy/session' })
    expect(res.statusCode).toBe(401)
  })
})

describe('POST /v1/buddy/session/commitment', () => {
  it('records the agreed commitment and persists it as a "session"-sourced row', async () => {
    const res = await postCommitment({
      weekStart: '2026-08-03',
      daysCommitted: 5,
      minutesPerDay: 20,
      dayTargets: null,
      focus: 'kanken prep',
    })
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data.source).toBe('session')
    expect(data.daysCommitted).toBe(5)
    expect(data.focus).toBe('kanken prep')

    const rows = await db.select().from(schema.buddyCommitments)
      .where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('session')
    expect(rows[0].weekStart).toBe('2026-08-03')
  })

  it('rejects an invalid commitment', async () => {
    const res = await postCommitment({
      weekStart: '2026-08-03',
      daysCommitted: 9,
      minutesPerDay: 20,
    })
    expect(res.statusCode).toBe(400)
  })

  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/buddy/session/commitment',
      payload: { weekStart: '2026-08-03', daysCommitted: 4, minutesPerDay: 15 },
    })
    expect(res.statusCode).toBe(401)
  })
})
