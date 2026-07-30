import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@kanji-learn/db'
import { buildTestApp } from '../helpers/test-app'
import { placementRoutes } from '../../src/routes/placement'
import { refreshKanjiDifficulty } from '../../src/services/placement-difficulty.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const TEST_USER = '00000000-0000-0000-0000-0000000000d5'

describe('placement routes', () => {
  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${TEST_USER}, 'RouteFixture', 'UTC') ON CONFLICT DO NOTHING
    `)
    await refreshKanjiDifficulty(db)
  })

  // Without this the file passes exactly once per database: the POST /complete
  // case below stores a session carrying ability_theta, and on the next run the
  // "fresh user" case above sees it and reports hasPrior = true. Same defect as
  // the getSessionPrior block in placement-service.test.ts — integration state
  // has to be reset per test, not per process.
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM review_logs WHERE user_id = ${TEST_USER}`)
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${TEST_USER}`)
    await db.execute(sql`
      DELETE FROM placement_results
       WHERE session_id IN (SELECT id FROM placement_sessions WHERE user_id = ${TEST_USER})
    `)
    await db.execute(sql`DELETE FROM placement_sessions WHERE user_id = ${TEST_USER}`)
  })

  it('GET /session-prior reports no prior for a fresh user', async () => {
    const app = await buildTestApp({ plugin: placementRoutes, opts: { prefix: '/v1/placement' } })
    const res = await app.inject({
      method: 'GET', url: '/v1/placement/session-prior',
      headers: { 'x-test-user-id': TEST_USER },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.hasPrior).toBe(false)
    await app.close()
  })

  it('GET /next-items returns items given a theta', async () => {
    const app = await buildTestApp({ plugin: placementRoutes, opts: { prefix: '/v1/placement' } })
    const res = await app.inject({
      method: 'GET', url: '/v1/placement/next-items?theta=0&count=3',
      headers: { 'x-test-user-id': TEST_USER },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.items.length).toBeGreaterThan(0)
    await app.close()
  })

  it('POST /complete accepts raw responses and returns theta/inferredLevel', async () => {
    const app = await buildTestApp({ plugin: placementRoutes, opts: { prefix: '/v1/placement' } })
    const itemsRes = await app.inject({
      method: 'GET', url: '/v1/placement/next-items?theta=0&count=1',
      headers: { 'x-test-user-id': TEST_USER },
    })
    const [item] = itemsRes.json().data.items

    const res = await app.inject({
      method: 'POST', url: '/v1/placement/complete',
      headers: { 'x-test-user-id': TEST_USER },
      payload: { responses: [{ kanjiId: item.kanjiId, itemType: 'meaning', correct: true }] },
    })
    expect(res.statusCode).toBe(200)
    expect(typeof res.json().data.theta).toBe('number')
    await app.close()
  })

  it('rejects an unauthenticated request', async () => {
    const app = await buildTestApp({ plugin: placementRoutes, opts: { prefix: '/v1/placement' } })
    const res = await app.inject({ method: 'GET', url: '/v1/placement/session-prior' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
