// apps/api/test/integration/coaching-triggers.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { buildTestApp } from '../helpers/test-app'
import { notebookRoutes } from '../../src/routes/notebook'
import { placementRoutes } from '../../src/routes/placement'
import { buddySessionRoutes } from '../../src/routes/buddy-session'
import { CoachingService } from '../../src/services/buddy/coaching.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

// NOT '...c7': the brief's own draft used it, but it's already RACE_USER in
// coaching-refresh.test.ts (isUniqueViolation describe block), and
// apps/api/vitest.config.ts sets fileParallelism: false -- so reusing it here
// would be a latent collision, not one that's currently breaking anything.
const USER = '00000000-0000-0000-0000-0000000000d8'

describe('coaching triggers', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  beforeAll(async () => {
    // The brief's draft called `buildTestApp()` with no route specs, which
    // registers nothing (test-app.ts's `for (const spec of routes)` loop is a
    // no-op over an empty array) -- every `app.inject` below would 404 rather
    // than exercising the wiring this task adds. All three touched route
    // plugins are registered here, at their production prefixes (server.ts).
    app = await buildTestApp(
      { plugin: notebookRoutes, opts: { prefix: '/v1/buddy/notebook' } },
      { plugin: placementRoutes, opts: { prefix: '/v1/placement' } },
      { plugin: buddySessionRoutes, opts: { prefix: '/v1/buddy/session' } },
    )
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'CoachingTriggerFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })

  const wipe = async () => {
    await db.execute(sql`DELETE FROM notebook_entries WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM buddy_commitments WHERE user_id = ${USER}`)
    // completePlacement seeds corpus-wide (docs/local-test-db.md: "seeds
    // corpus-wide by design, cleaned up nothing -- leaving 2,283 review_logs
    // and UKG rows" was exactly this kind of leak in another suite). Tests
    // below drive POST /v1/placement/complete for real, so without this the
    // rows leak past this file into whatever runs after it.
    await db.execute(sql`DELETE FROM review_logs WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${USER}`)
    await db.execute(sql`
      DELETE FROM placement_results
       WHERE session_id IN (SELECT id FROM placement_sessions WHERE user_id = ${USER})
    `)
    await db.execute(sql`DELETE FROM placement_sessions WHERE user_id = ${USER}`)
  }
  beforeEach(wipe)
  afterAll(async () => {
    await wipe()
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
    await app.close()
  })

  const coachingRows = async () =>
    db.execute(sql`SELECT body FROM notebook_entries
      WHERE user_id = ${USER} AND source->>'kind' = 'coaching_analysis'
        AND superseded_at IS NULL`)

  /** A completed period the learner missed entirely -- commitment_gap fires. */
  const missedPeriod = () => db.execute(sql`INSERT INTO buddy_commitments
      (user_id, week_start, days_committed, minutes_per_day, source)
      VALUES (${USER}, '2026-07-20', 4, 15, 'session')`)

  it('GET /v1/buddy/notebook still returns 200 and does not write for a learner with no findings', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/buddy/notebook', headers: { 'x-test-user-id': USER },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
    expect((await coachingRows()).length).toBe(0)
  })

  it('GET /v1/buddy/notebook writes the coaching entry when a finding exists', async () => {
    await missedPeriod()

    const res = await app.inject({
      method: 'GET', url: '/v1/buddy/notebook', headers: { 'x-test-user-id': USER },
    })
    expect(res.statusCode).toBe(200)

    const rows = await coachingRows()
    expect(rows.length).toBe(1)
    expect((rows[0] as any).body).toContain('promised')

    // And it renders through the generic section, with no mobile change.
    const observations = res.json().data.sections.find((s: any) => s.key === 'observations')
    const refetched = await app.inject({
      method: 'GET', url: '/v1/buddy/notebook', headers: { 'x-test-user-id': USER },
    })
    const after = refetched.json().data.sections.find((s: any) => s.key === 'observations')
    expect(after.live.some((e: any) => e.body.includes('promised'))).toBe(true)
    expect(observations).toBeDefined()
  })

  it('POST /v1/buddy/session/commitment refreshes coaching', async () => {
    await missedPeriod()

    const res = await app.inject({
      method: 'POST',
      url: '/v1/buddy/session/commitment',
      headers: { 'x-test-user-id': USER },
      payload: { weekStart: '2026-08-01', daysCommitted: 4, minutesPerDay: 15 },
    })
    expect(res.statusCode).toBe(200)
    expect((await coachingRows()).length).toBe(1)
  })

  /**
   * The brief's own test file exercises the notebook GET and the session
   * commitment triggers but never POST /v1/placement/complete -- Step 4's
   * wiring would ship untested. Mirrors the session-commitment test above:
   * same missed-period fixture, same assertion, different call site.
   */
  it('POST /v1/placement/complete refreshes coaching', async () => {
    await missedPeriod()

    const itemsRes = await app.inject({
      method: 'GET', url: '/v1/placement/next-items?theta=0&count=1',
      headers: { 'x-test-user-id': USER },
    })
    const [item] = itemsRes.json().data.items

    const res = await app.inject({
      method: 'POST', url: '/v1/placement/complete',
      headers: { 'x-test-user-id': USER },
      payload: { responses: [{ kanjiId: item.kanjiId, itemType: 'meaning', correct: true }] },
    })
    expect(res.statusCode).toBe(200)
    expect((await coachingRows()).length).toBe(1)
  })

  /**
   * The notebook GET must self-gate on staleness (ANALYSIS_STALE_HOURS), not
   * force every read -- that is the whole point of not passing `force` there.
   * A first-ever analysis can't distinguish forced from gated (there's no
   * prior `analyzedAt` either way), so this seeds an EXISTING recent analysis
   * directly, alongside real underlying data (a missed period) that WOULD
   * produce a different, genuine finding if analysis reran. If the route ever
   * regressed to `refresh(userId, { force: true })`, this sentinel row would
   * get superseded or overwritten by that fresh analysis; surviving untouched
   * proves the gate, not just that an entry exists.
   */
  it('GET /v1/buddy/notebook does not force a re-analysis of a recent entry', async () => {
    await missedPeriod()

    const recentlyAnalyzed = new Date(Date.now() - 5 * 60_000).toISOString() // 5 min ago -- inside the 6h stale window
    const createdLongAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString() // 3h ago -- outside the 60min coalescing window
    const SENTINEL = 'SENTINEL: untouched if the notebook GET is properly stale-gated.'
    await db.execute(sql`
      INSERT INTO notebook_entries (user_id, kind, body, author, source, created_at)
      VALUES (${USER}, 'observation', ${SENTINEL}, 'buddy',
        ${{ kind: 'coaching_analysis', analyzedAt: recentlyAnalyzed, findings: [] }}::jsonb,
        ${createdLongAgo}::timestamptz)
    `)

    const res = await app.inject({
      method: 'GET', url: '/v1/buddy/notebook', headers: { 'x-test-user-id': USER },
    })
    expect(res.statusCode).toBe(200)

    const rows = await coachingRows()
    expect(rows.length).toBe(1)
    expect((rows[0] as any).body).toBe(SENTINEL)
  })

  /**
   * The mirror image of the test above. Placement completion and session
   * completion pass `{ force: true }` specifically so a real event is never
   * silently dropped by the staleness gate -- but a first-ever analysis
   * (no prior `analyzedAt` at all) can't tell forced from gated, since the
   * gate only ever skips when a PRIOR analysis is recent. Both wiring tests
   * above are first-ever analyses, so neither actually proves `force: true`
   * made it into the call. This seeds an existing, fresh (5-minute-old)
   * analysis a non-forced call would skip, and real underlying data (a
   * missed period) that would produce a different finding if analysis did
   * run. The sentinel surviving would mean the call regressed to an
   * unforced `refresh(userId)`.
   */
  it('POST /v1/placement/complete forces a refresh even inside the staleness window', async () => {
    const recentlyAnalyzed = new Date(Date.now() - 5 * 60_000).toISOString()
    const createdLongAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString()
    const SENTINEL = 'SENTINEL: must be replaced -- placement completion forces a refresh.'
    await db.execute(sql`
      INSERT INTO notebook_entries (user_id, kind, body, author, source, created_at)
      VALUES (${USER}, 'observation', ${SENTINEL}, 'buddy',
        ${{ kind: 'coaching_analysis', analyzedAt: recentlyAnalyzed, findings: [] }}::jsonb,
        ${createdLongAgo}::timestamptz)
    `)
    await missedPeriod()

    const itemsRes = await app.inject({
      method: 'GET', url: '/v1/placement/next-items?theta=0&count=1',
      headers: { 'x-test-user-id': USER },
    })
    const [item] = itemsRes.json().data.items

    const res = await app.inject({
      method: 'POST', url: '/v1/placement/complete',
      headers: { 'x-test-user-id': USER },
      payload: { responses: [{ kanjiId: item.kanjiId, itemType: 'meaning', correct: true }] },
    })
    expect(res.statusCode).toBe(200)

    const rows = await coachingRows()
    expect(rows.length).toBe(1)
    expect((rows[0] as any).body).not.toBe(SENTINEL)
    expect((rows[0] as any).body).toContain('promised')
  })

  it('POST /v1/buddy/session/commitment forces a refresh even inside the staleness window', async () => {
    const recentlyAnalyzed = new Date(Date.now() - 5 * 60_000).toISOString()
    const createdLongAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString()
    const SENTINEL = 'SENTINEL: must be replaced -- session completion forces a refresh.'
    await db.execute(sql`
      INSERT INTO notebook_entries (user_id, kind, body, author, source, created_at)
      VALUES (${USER}, 'observation', ${SENTINEL}, 'buddy',
        ${{ kind: 'coaching_analysis', analyzedAt: recentlyAnalyzed, findings: [] }}::jsonb,
        ${createdLongAgo}::timestamptz)
    `)
    await missedPeriod()

    const res = await app.inject({
      method: 'POST',
      url: '/v1/buddy/session/commitment',
      headers: { 'x-test-user-id': USER },
      payload: { weekStart: '2026-08-01', daysCommitted: 4, minutesPerDay: 15 },
    })
    expect(res.statusCode).toBe(200)

    const rows = await coachingRows()
    expect(rows.length).toBe(1)
    expect((rows[0] as any).body).not.toBe(SENTINEL)
    expect((rows[0] as any).body).toContain('promised')
  })

  /**
   * Every call site wraps `refresh()` in try/catch specifically so a coaching
   * failure can never turn the route's real outcome into a 500. Spying on the
   * prototype method (rather than passing a stub) exercises the actual routes
   * exactly as wired -- both `new CoachingService(server.db)` call sites and
   * the one built once in notebook.ts's plugin body resolve `refresh` through
   * the same prototype at call time.
   */
  it('GET /v1/buddy/notebook still returns 200 when coaching refresh throws', async () => {
    const spy = vi.spyOn(CoachingService.prototype, 'refresh').mockRejectedValueOnce(new Error('boom'))
    try {
      const res = await app.inject({
        method: 'GET', url: '/v1/buddy/notebook', headers: { 'x-test-user-id': USER },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.ok).toBe(true)

      // Proves the spy actually intercepted a real call -- without this, the
      // assertions above would pass identically if the route never called
      // refresh() at all. The notebook route calls it unforced (no second
      // argument), unlike placement/session below.
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith(USER)

      // And that the notebook actually rendered through the failure, not
      // merely that the request avoided a 500 -- mirrors the placement/
      // session siblings asserting a primary-output field (data.theta,
      // data.daysCommitted) survived.
      expect(Array.isArray(body.data.sections)).toBe(true)
      const observations = body.data.sections.find((s: any) => s.key === 'observations')
      expect(observations).toBeDefined()
      expect(Array.isArray(observations.live)).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  it('POST /v1/placement/complete still returns 200 and applies when coaching refresh throws', async () => {
    const itemsRes = await app.inject({
      method: 'GET', url: '/v1/placement/next-items?theta=0&count=1',
      headers: { 'x-test-user-id': USER },
    })
    const [item] = itemsRes.json().data.items

    const spy = vi.spyOn(CoachingService.prototype, 'refresh').mockRejectedValueOnce(new Error('boom'))
    try {
      const res = await app.inject({
        method: 'POST', url: '/v1/placement/complete',
        headers: { 'x-test-user-id': USER },
        payload: { responses: [{ kanjiId: item.kanjiId, itemType: 'meaning', correct: true }] },
      })
      expect(res.statusCode).toBe(200)
      expect(typeof res.json().data.theta).toBe('number')

      // Proves the spy actually intercepted a real call, called with the
      // forced contract -- without this, the assertions above would pass
      // identically if the route never called refresh() at all.
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith(USER, { force: true })
    } finally {
      spy.mockRestore()
    }
  })

  it('POST /v1/buddy/session/commitment still returns 200 and saves when coaching refresh throws', async () => {
    const spy = vi.spyOn(CoachingService.prototype, 'refresh').mockRejectedValueOnce(new Error('boom'))
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/buddy/session/commitment',
        headers: { 'x-test-user-id': USER },
        payload: { weekStart: '2026-08-01', daysCommitted: 4, minutesPerDay: 15 },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().data.daysCommitted).toBe(4)

      // Proves the spy actually intercepted a real call, called with the
      // forced contract -- without this, the assertions above would pass
      // identically if the route never called refresh() at all.
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith(USER, { force: true })
    } finally {
      spy.mockRestore()
    }
  })
})
