// apps/api/test/integration/mnemonics-list-route.test.ts
//
// B-211 adds GET /v1/mnemonics — the first route on this prefix with no path
// segment of its own. This file exists because mnemonics.ts is the exact place
// this repo has been bitten by routing before: the parametric GET/POST
// /:kanjiId silently swallow /refresh, /assemble and /buddy-moment-context,
// which is why those return 401 on ANY build and why a rollout was once
// reported "verified" against a six-week-old image (SOP.md).
//
// Asserts on the route TABLE rather than a response, so it needs no database:
// the question here is whether the route is registered at the path the client
// calls, not what it returns. A 404 from this route would be invisible in the
// app — useUserHooks swallows the error and leaves the cached list on screen,
// so the Journal would simply look unchanged.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp } from '../helpers/test-app'
import { mnemonicRoutes } from '../../src/routes/mnemonics'

let app: Awaited<ReturnType<typeof buildTestApp>>

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app = await buildTestApp({ plugin: mnemonicRoutes, opts: { prefix: '/v1/mnemonics' } } as any)
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('GET /v1/mnemonics (B-211)', () => {
  it('is registered at the bare prefix', () => {
    expect(app.hasRoute({ method: 'GET', url: '/v1/mnemonics' })).toBe(true)
  })

  it('is distinct from the parametric per-kanji read', () => {
    // Both must exist. If the list route were ever folded into /:kanjiId it
    // would parse '' as a kanji id and 400 — the failure mode this prefix
    // already has three times over.
    expect(app.hasRoute({ method: 'GET', url: '/v1/mnemonics/:kanjiId' })).toBe(true)
    expect(app.hasRoute({ method: 'GET', url: '/v1/mnemonics' })).toBe(true)
  })

  it('has not displaced the deprecated B143 stub', () => {
    // /refresh must keep resolving to its own handler — B143 is shipped and
    // cannot be changed, and DO NOT DELETE is written on that stub for a
    // reason. Adding a bare '/' route must not disturb it.
    expect(app.hasRoute({ method: 'GET', url: '/v1/mnemonics/refresh' })).toBe(true)
  })

  it('requires authentication', async () => {
    // No x-test-user-id → the preHandler must reject before any DB access,
    // so this stays a routing test rather than becoming a schema-dependent one.
    const res = await app.inject({ method: 'GET', url: '/v1/mnemonics' })
    expect(res.statusCode).toBe(401)
  })
})
