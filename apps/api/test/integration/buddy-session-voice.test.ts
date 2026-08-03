// GET /v1/buddy/session — the additive `voice` field (slice 3 §§7, 8).
//
// This learner has no placement, no reviews and no commitment history, so
// analyze() yields nothing: the assertion is that the route stays exactly as it
// was, which is §2's common case and the backward-compatibility guarantee of §8.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { buildTestAppWith } from '../helpers/test-app'
import { buddySessionRoutes } from '../../src/routes/buddy-session'
import { BuddyLLMError } from '../../src/services/llm/types'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER = '00000000-0000-0000-0000-0000000000c3'
let app: Awaited<ReturnType<typeof buildTestAppWith>>

beforeAll(async () => {
  // The default test app's buddyLLM throws BuddyLLMError on every route() —
  // exactly the outage §9 must survive. Stated explicitly rather than relied
  // on implicitly, so this file still means what it says if the helper's
  // default changes.
  app = await buildTestAppWith(
    { buddyLLM: { route: async () => { throw new BuddyLLMError('stubbed outage') } } },
    { plugin: buddySessionRoutes, opts: { prefix: '/v1/buddy/session' } },
  )
  await db.insert(schema.userProfiles)
    .values({ id: USER, displayName: 'Voice Route Fixture', timezone: 'America/Los_Angeles' })
    .onConflictDoUpdate({
      target: schema.userProfiles.id,
      set: { timezone: 'America/Los_Angeles' },
    })
})

beforeEach(async () => {
  await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, USER))
  await db.delete(schema.notebookEntries).where(eq(schema.notebookEntries.userId, USER))
  await db.delete(schema.buddySessionUtterances)
    .where(eq(schema.buddySessionUtterances.userId, USER))
  const weekday = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
  ).getDay()
  await db.update(schema.userProfiles)
    .set({ buddyDay: weekday, buddyIntervalWeeks: 1 })
    .where(eq(schema.userProfiles.id, USER))
})

afterAll(async () => {
  await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, USER))
  await db.delete(schema.notebookEntries).where(eq(schema.notebookEntries.userId, USER))
  await db.delete(schema.buddySessionUtterances)
    .where(eq(schema.buddySessionUtterances.userId, USER))
  await db.delete(schema.userProfiles).where(eq(schema.userProfiles.id, USER))
  await app.close()
  await client.end()
})

function get() {
  return app.inject({
    method: 'GET',
    url: '/v1/buddy/session',
    headers: { 'x-test-user-id': USER },
  })
}

describe('GET /v1/buddy/session — voice', () => {
  // MUTATION CAUGHT: replacing opener/reckon with `voice` instead of adding
  // alongside them. §8 requires an old client to keep working; a shipped
  // surface would break on deploy, before anyone rebuilt the app.
  it('keeps opener and proposedCommitment in the payload', async () => {
    const res = await get()
    const data = res.json().data
    expect(res.statusCode).toBe(200)
    expect(data.state).toBe('due')
    expect(typeof data.opener.text).toBe('string')
    expect(data.proposedCommitment).toBeDefined()
  })

  // MUTATION CAUGHT: emitting `voice: null` or an empty-text voice when there
  // is nothing to say. §2 requires the field to be ABSENT — the client's
  // preference rule keys off its presence, and a null would spend a tier-3
  // call per learner per week to produce filler if the guard were dropped
  // upstream.
  it('omits voice entirely when the analyzer finds nothing', async () => {
    const data = (await get()).json().data
    expect(data.voice).toBeUndefined()
  })

  // MUTATION CAUGHT: letting a coaching failure escape the try/catch and 500
  // the session. Agreeing the week ahead is the session's one guaranteed
  // outcome; this route must degrade, never fail. Also proves the LLM outage
  // stubbed above does not reach the client as an error.
  it('still serves a due session with the LLM stubbed to throw', async () => {
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.json().data.state).toBe('due')
  })
})
