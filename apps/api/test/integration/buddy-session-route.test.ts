// GET /v1/buddy/session and POST /v1/buddy/session/commitment — auth via the
// bare x-test-user-id header (this repo's convention; see helpers/test-app.ts).

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { addDays } from '@kanji-learn/shared'
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
  await db.delete(schema.dailyStats).where(eq(schema.dailyStats.userId, TEST_USER_ID))
  await db.update(schema.userProfiles)
    .set({ buddyDay: null, buddyIntervalWeeks: 1 })
    .where(eq(schema.userProfiles.id, TEST_USER_ID))
})

afterAll(async () => {
  await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
  await db.delete(schema.dailyStats).where(eq(schema.dailyStats.userId, TEST_USER_ID))
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

/** Mirrors buddy-session.ts's own localDateFor — the test needs to predict
 * the due week's anchor date WITHOUT hitting the route first, since hitting
 * it prematurely would call ensureForWeek and insert a commitment row before
 * the fixture has seeded the previous period it needs. */
function localDateInLA(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
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
    expect(dueRes.json().data.state).toBe('due')
    const weekStart = dueRes.json().data.weekStart as string
    await postCommitment({
      weekStart, daysCommitted: 5, minutesPerDay: 20, dayTargets: null, focus: null,
    })

    const res = await get()
    const data = res.json().data
    expect(data.state).toBe('waiting')
    expect(typeof data.nextDue).toBe('string')
  })

  it('opens in the strong register with the real active-day count on a SECOND appointment cycle', async () => {
    // This is the one test that would catch a regression to the original
    // defect: computing a fresh zeroed PromiseCheck for the openerCopy call
    // instead of reusing the check that decided selectOpener. Every other
    // `due` test is the first-ever-session case, where selectOpener always
    // returns 'first_ever' and openerCopy('first_ever', check) never reads
    // `check` at all — so those tests pass unchanged even if the route
    // recomputes a bogus zeroed check for the copy. Here isFirstSession is
    // false (there IS a previous, session-sourced commitment), so 'strong'
    // is only reachable — and its "N days this week" text only reads the
    // seeded number — if the SAME check object flows to both calls.
    const todayWeekday = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
    ).getDay()
    await db.update(schema.userProfiles)
      .set({ buddyDay: todayWeekday })
      .where(eq(schema.userProfiles.id, TEST_USER_ID))

    // Predict the due week's anchor the same way the route will, WITHOUT
    // calling the route first — an early GET would call ensureForWeek and
    // insert a commitment for this week before we've seeded last week's.
    const weekStart = localDateInLA(new Date())
    const previousWeekStart = addDays(weekStart, -7)
    const ACTIVE_DAYS = 6 // deliberately not 4 (default daysCommitted) or 15
    // (default minutesPerDay), so a match on "6" in opener.text could not be
    // coincidental.

    await db.insert(schema.buddyCommitments).values({
      userId: TEST_USER_ID,
      weekStart: previousWeekStart,
      daysCommitted: 5,
      dayTargets: null,
      minutesPerDay: 20,
      focus: null,
      source: 'session',
    })

    await db.insert(schema.dailyStats).values(
      Array.from({ length: ACTIVE_DAYS }, (_, i) => ({
        userId: TEST_USER_ID,
        date: addDays(previousWeekStart, i),
        reviewed: 3,
        studyTimeMs: 20 * 60_000,
      }))
    )

    try {
      const res = await get()
      const data = res.json().data

      expect(data.state).toBe('due')
      expect(data.opener.kind).toBe('strong')
      expect(data.opener.text).toContain(`${ACTIVE_DAYS}`)
    } finally {
      await db.delete(schema.dailyStats).where(eq(schema.dailyStats.userId, TEST_USER_ID))
    }
  })

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/buddy/session' })
    expect(res.statusCode).toBe(401)
  })

  // Weekly-buddy-review pre-merge review, FIX 6: runBuddyDayPass skips a
  // learner still on the 'UTC' default (schema.ts:171) because their
  // buddy_day has no reliable local meaning — but this read path had no
  // matching guard, so it served a fabricated "due" session, wrote
  // rolled_forward rows, and accumulated miss counts the pass would never
  // see (its own query filters these users out entirely).
  it('reports not_scheduled for a learner still on the UTC default timezone, even with a buddy_day set (FIX 6)', async () => {
    await db.update(schema.userProfiles)
      .set({ timezone: 'UTC', buddyDay: new Date().getUTCDay() })
      .where(eq(schema.userProfiles.id, TEST_USER_ID))

    try {
      const res = await get()
      expect(res.statusCode).toBe(200)
      expect(res.json().data.state).toBe('not_scheduled')

      // Control: no commitment row should have been fabricated for this
      // learner — before the fix, the due path ran and called ensureForWeek.
      const rows = await db.select().from(schema.buddyCommitments)
        .where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
      expect(rows).toHaveLength(0)
    } finally {
      await db.update(schema.userProfiles)
        .set({ timezone: 'America/Los_Angeles' })
        .where(eq(schema.userProfiles.id, TEST_USER_ID))
    }
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
