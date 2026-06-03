import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { kanji, userProfiles } from '@kanji-learn/db'
import { buildTestApp } from '../helpers/test-app'
import { kanjiRoutes } from '../../src/routes/kanji'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const USER = '00000000-0000-0000-0000-0000000ca501'

afterAll(async () => { await client.end() })

describe('GET /v1/kanji/:id — components field', () => {
  let id: number

  beforeAll(async () => {
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
    await db.insert(userProfiles).values({ id: USER, displayName: 'K', timezone: 'UTC' })
    const [k] = await db.select({ id: kanji.id }).from(kanji).limit(1)
    id = k.id
    await db.execute(sql`UPDATE kanji SET components = '["扌","寺"]'::jsonb WHERE id = ${id}`)
  })

  it('returns the components array', async () => {
    const app = await buildTestApp({ plugin: kanjiRoutes, opts: { prefix: '/v1/kanji' } })
    const res = await app.inject({
      method: 'GET',
      url: `/v1/kanji/${id}`,
      headers: { 'x-test-user-id': USER },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.components).toEqual(['扌', '寺'])
    await app.close()
  })
})
