// apps/api/test/integration/notebook-route.test.ts
//
// GET /v1/buddy/notebook, POST /v1/buddy/notebook/entries,
// PATCH/DELETE /v1/buddy/notebook/entries/:id — auth via the bare
// x-test-user-id header (this repo's convention; see helpers/test-app.ts).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { buildTestApp } from '../helpers/test-app'
import { notebookRoutes } from '../../src/routes/notebook'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER = '00000000-0000-0000-0000-0000000000e3'
let app: Awaited<ReturnType<typeof buildTestApp>>

describe('notebook routes', () => {
  beforeAll(async () => {
    app = await buildTestApp({ plugin: notebookRoutes, opts: { prefix: '/v1/buddy/notebook' } })
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'RouteFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })

  afterAll(async () => {
    await db.execute(sql`DELETE FROM notebook_entries WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
    await app.close()
    await client.end()
  })

  it('GET returns a notebook view', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/buddy/notebook', headers: { 'x-test-user-id': USER },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveProperty('sections')
  })

  it('POST stores EVERY field it accepts and reads them back', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/buddy/notebook/entries',
      headers: { 'x-test-user-id': USER },
      payload: {
        kind: 'decision',
        body: 'No Japanese before coffee',
        weekStart: '2026-08-03',
        source: { kind: 'manual' },
      },
    })
    expect(res.statusCode).toBe(200)
    const id = res.json().data.id

    // z.object() STRIPS unknown keys and still returns 200. Asserting the status
    // is what missed this twice before — read the values back.
    const [row] = await db.select().from(schema.notebookEntries)
      .where(eq(schema.notebookEntries.id, id))
    expect(row.body).toBe('No Japanese before coffee')
    expect(String(row.weekStart)).toContain('2026-08-03')
    expect(row.source).toEqual({ kind: 'manual' })
  })

  it('PATCH supersedes and returns the replacement id', async () => {
    const created = await app.inject({
      method: 'POST', url: '/v1/buddy/notebook/entries',
      headers: { 'x-test-user-id': USER },
      payload: { kind: 'observation', body: 'first' },
    })
    const id = created.json().data.id

    const res = await app.inject({
      method: 'PATCH', url: `/v1/buddy/notebook/entries/${id}`,
      headers: { 'x-test-user-id': USER },
      payload: { body: 'second' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.id).not.toBe(id)

    const [replacement] = await db.select().from(schema.notebookEntries)
      .where(eq(schema.notebookEntries.id, res.json().data.id))
    expect(replacement.body).toBe('second')
  })

  it('rejects an unknown kind rather than silently coercing it', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/buddy/notebook/entries',
      headers: { 'x-test-user-id': USER },
      payload: { kind: 'nonsense', body: 'x' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('DELETE supersedes with no replacement', async () => {
    const created = await app.inject({
      method: 'POST', url: '/v1/buddy/notebook/entries',
      headers: { 'x-test-user-id': USER },
      payload: { kind: 'observation', body: 'to be deleted' },
    })
    const id = created.json().data.id

    const res = await app.inject({
      method: 'DELETE', url: `/v1/buddy/notebook/entries/${id}`,
      headers: { 'x-test-user-id': USER },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.id).toBeNull()

    const [row] = await db.select().from(schema.notebookEntries)
      .where(eq(schema.notebookEntries.id, id))
    expect(row.supersededAt).not.toBeNull()
  })

  it('PATCHing an already-superseded entry returns 409, not 404 — a conflict is not a missing resource', async () => {
    const created = await app.inject({
      method: 'POST', url: '/v1/buddy/notebook/entries',
      headers: { 'x-test-user-id': USER },
      payload: { kind: 'observation', body: 'superseded once' },
    })
    const id = created.json().data.id

    const first = await app.inject({
      method: 'PATCH', url: `/v1/buddy/notebook/entries/${id}`,
      headers: { 'x-test-user-id': USER },
      payload: { body: 'edited once' },
    })
    expect(first.statusCode).toBe(200)

    const second = await app.inject({
      method: 'PATCH', url: `/v1/buddy/notebook/entries/${id}`,
      headers: { 'x-test-user-id': USER },
      payload: { body: 'edited twice' },
    })
    expect(second.statusCode).toBe(409)
    expect(second.json().code).toBe('ALREADY_SUPERSEDED')
  })

  it('PATCHing a nonexistent entry returns 404', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/v1/buddy/notebook/entries/00000000-0000-0000-0000-000000000000',
      headers: { 'x-test-user-id': USER },
      payload: { body: 'nope' },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('NOT_FOUND')
  })
})
