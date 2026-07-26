// apps/api/test/integration/deprecated-refresh-stubs.test.ts
//
// Plan 2 retired the 30-day refresh nudge (parent spec §10.4), deleting
// GET /v1/mnemonics/refresh and POST /v1/mnemonics/:id/refresh/dismiss.
// Shipped build B143 still calls both. These stubs answer successfully and
// write nothing, so an old client can never 404 against a new API.
//
// This test is the gate protecting a build we can no longer change. It
// deliberately touches NO database: the stubs perform no queries, so
// requiring schema here would only couple the gate to unrelated setup.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp } from '../helpers/test-app'
import { mnemonicRoutes } from '../../src/routes/mnemonics'

const USER_A = '00000000-0000-0000-0000-0000000000d1'
const ANY_ID = '00000000-0000-0000-0000-000000000000'

let app: Awaited<ReturnType<typeof buildTestApp>>

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app = await buildTestApp({ plugin: mnemonicRoutes, opts: { prefix: '/v1/mnemonics' } } as any)
})

afterAll(async () => {
  await app.close()
})

describe('deprecated refresh stubs (B143 compatibility)', () => {
  it('GET /v1/mnemonics/refresh returns an empty list, not 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/mnemonics/refresh',
      headers: { 'x-test-user-id': USER_A },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, data: [] })
  })

  it('POST /v1/mnemonics/:id/refresh/dismiss returns 200 and writes nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/mnemonics/${ANY_ID}/refresh/dismiss`,
      headers: { 'x-test-user-id': USER_A },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('dismiss succeeds for an id that does not exist (old clients must never 404)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/mnemonics/11111111-1111-1111-1111-111111111111/refresh/dismiss',
      headers: { 'x-test-user-id': USER_A },
    })
    expect(res.statusCode).toBe(200)
  })

  it('both stubs still require auth', async () => {
    const get = await app.inject({ method: 'GET', url: '/v1/mnemonics/refresh' })
    expect(get.statusCode).toBe(401)

    const post = await app.inject({
      method: 'POST',
      url: `/v1/mnemonics/${ANY_ID}/refresh/dismiss`,
    })
    expect(post.statusCode).toBe(401)
  })

  it('the literal /refresh path is not swallowed by GET /:kanjiId', async () => {
    // Fastify prefers static segments over parametric ones, and the stubs are
    // registered above /:kanjiId so the intent survives reordering. If this
    // regressed, /refresh would be parsed as a kanji id and 400 on validation.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/mnemonics/refresh',
      headers: { 'x-test-user-id': USER_A },
    })
    expect(res.statusCode).not.toBe(400)
    expect(res.json()).toEqual({ ok: true, data: [] })
  })
})
