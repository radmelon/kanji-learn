// GET /v1/buddy/session — the additive `voice` field (slice 3 §§7, 8).
//
// Most tests below use a learner with no placement, no reviews and no
// commitment history, so analyze() yields nothing: the assertion is that the
// route stays exactly as it was, which is §2's common case and the
// backward-compatibility guarantee of §8. The exception seeds a missed
// commitment period so analyze() returns a real `commitment_gap` finding —
// see that test's own comment for what it proves.
//
// Even with that finding, no test in this file exercises a FAILURE of the
// route's outer try/catch, which wraps both coaching.refresh() and
// voiceService.utteranceFor(). The no-findings fixture can't reach it:
// utteranceFor returns null on its first line, before it does anything that
// could throw. The missed-commitment fixture reaches both calls for real, but
// still can't exercise a failure here — coaching.refresh's analysis is plain
// DB work with nothing in this data to make it throw, and utteranceFor never
// throws BY CONTRACT: this file's test app makes the LLM router throw on
// every call, and utteranceFor's own try/catch (proved directly in
// coaching-voice.test.ts) turns that into a normal template return before it
// ever reaches the route. Anyone changing the route's try/catch should know
// it still has no regression net at this level.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { buildTestAppWith } from '../helpers/test-app'
import { buddySessionRoutes } from '../../src/routes/buddy-session'
import { BuddyLLMError } from '../../src/services/llm/types'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER = '00000000-0000-0000-0000-0000000000c3'
let app: Awaited<ReturnType<typeof buildTestAppWith>>

beforeAll(async () => {
  // The default test app's buddyLLM throws BuddyLLMError on every route()
  // call. This fixture has no placement, reviews or commitment history, so
  // analyze() always yields no findings, and CoachingVoiceService.utteranceFor
  // returns before ever calling the router — no test in this file actually
  // reaches the stub. It stays here anyway: the test app must never make a
  // real LLM call, and if a future change did cause this fixture to reach
  // the router, the test would still be exercising a controlled failure
  // rather than a live one. The LLM-outage-survives-as-template path is
  // proved at the service level in
  // apps/api/test/integration/coaching-voice.test.ts, where the router is
  // stubbed to throw and the result asserts `source: 'template'`.
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
  // Cascades to placement_results (FK ON DELETE CASCADE) -- see the
  // many-findings fixture below, which is the only test in this file that
  // seeds a placement session.
  await db.delete(schema.placementSessions).where(eq(schema.placementSessions.userId, USER))
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
  await db.delete(schema.placementSessions).where(eq(schema.placementSessions.userId, USER))
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

/**
 * A learner rich enough that MORE than DEFAULT_FINDING_COUNT (3) kinds fire.
 * Adapted from `manyFindings()` in coaching-refresh.test.ts (same fixture
 * shape; not imported, since this suite's convention is each integration
 * file seeds its own fixtures against its own USER).
 *
 * The missed period fires commitment_gap; the placement session/result fires
 * THREE more on their own regardless of real-world "now" -- level_estimate
 * and hardest_cleared read straight off the stored theta/se/difficulty, and
 * mechanics_explainer fires on any non-null placement at all
 * (detectors/orient.ts: `if (!snapshot.placement) return null`, nothing
 * more). Four kinds minimum, already past DEFAULT_FINDING_COUNT, with no
 * dependency on the day this suite happens to run.
 */
async function manyFindings() {
  await db.execute(sql`INSERT INTO buddy_commitments
      (user_id, week_start, days_committed, minutes_per_day, source)
      VALUES (${USER}, '2026-07-20', 4, 15, 'session')`)
  const sessionRows = await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${USER}, 1.1, 0.5, 'N3', '2026-08-01T00:00:00Z') RETURNING id`)
  const sessionId = (sessionRows[0] as any).id
  const k = await db.execute(sql`SELECT id FROM kanji ORDER BY id LIMIT 1`)
  await db.execute(sql`INSERT INTO placement_results
      (session_id, kanji_id, jlpt_level, passed, meaning_correct, reading_correct, difficulty_at_ask)
      VALUES (${sessionId}, ${Number((k[0] as any).id)}, 'N5', true, true, true, 0.9)`)
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
    // Not `toBeDefined()`: that passes on `null` too. A real field proves an
    // actual commitment object came back, not just a present-but-empty key.
    expect(data.proposedCommitment.daysCommitted).toBe(4)
    expect(data.reckon).toBeNull()
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

  // MUTATION CAUGHT: deleting the `...(voice ? { voice } : {})` spread in
  // buddy-session.ts -- or the whole try block that computes `voice` -- would
  // leave this suite green everywhere else, because both tests above use a
  // no-findings fixture where `voice` is legitimately absent either way. This
  // test seeds a missed commitment period so analyze() returns a real
  // `commitment_gap` finding, which is what makes `voice` non-optional here.
  // It also doubles as the first route-level proof that the template floor
  // reaches the wire: this file's test app always makes the LLM router
  // throw, so `source: 'template'` only appears if the fallback actually ran
  // end to end.
  it('surfaces voice alongside opener and reckon when a finding fires, and forces the coaching refresh', async () => {
    // A recent-but-not-coalescing sentinel analysis: force: true must replace
    // it even though it is well inside ANALYSIS_STALE_HOURS (6h) -- an
    // unforced read (coaching-triggers.test.ts's sibling test) would leave it
    // untouched, which is exactly what would happen if this route regressed
    // to an unforced coaching.refresh(userId).
    const recentlyAnalyzed = new Date(Date.now() - 5 * 60_000).toISOString() // 5 min ago
    const createdLongAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString() // 3h ago -- outside the 60min coalescing window
    const SENTINEL = 'SENTINEL: must be superseded -- the session GET forces a refresh.'
    await db.execute(sql`
      INSERT INTO notebook_entries (user_id, kind, body, author, source, created_at)
      VALUES (${USER}, 'observation', ${SENTINEL}, 'buddy',
        ${{ kind: 'coaching_analysis', analyzedAt: recentlyAnalyzed, findings: [] }}::jsonb,
        ${createdLongAgo}::timestamptz)
    `)
    // A completed period the learner missed entirely -- commitment_gap fires.
    // Same idiom as coaching-triggers.test.ts's missedPeriod().
    await db.execute(sql`INSERT INTO buddy_commitments
        (user_id, week_start, days_committed, minutes_per_day, source)
        VALUES (${USER}, '2026-07-20', 4, 15, 'session')`)

    const res = await get()
    expect(res.statusCode).toBe(200)
    const data = res.json().data

    expect(data.voice).toBeDefined()
    expect(data.voice.source).toBe('template')
    expect(data.voice.text).toContain(data.opener.text)

    // Additive, not replacing (§8): an older client reading only these two
    // fields still gets both, unaffected by voice's arrival.
    expect(typeof data.opener.text).toBe('string')
    expect(typeof data.reckon).toBe('string')

    // force: true reached coaching.refresh. An unforced call would have been
    // staleness-gated -- recentlyAnalyzed is 5 minutes old, well inside the
    // 6h window -- and left the sentinel as the only live row.
    const rows = await db.execute(sql`SELECT body FROM notebook_entries
      WHERE user_id = ${USER} AND source->>'kind' = 'coaching_analysis' AND superseded_at IS NULL`)
    expect(rows).toHaveLength(1)
    expect((rows[0] as any).body).not.toBe(SENTINEL)
    expect((rows[0] as any).body).toContain('promised')
  })

  // Final whole-branch review, Important 2. coaching.refresh() now returns
  // BOTH `findings` (the full Journal ledger, up to ten) and `spoken` (capped
  // at DEFAULT_FINDING_COUNT). buddy-session.ts destructures `spoken` under
  // the local name `findings` specifically so this route can never hand the
  // voice service more than the capped set -- see that destructure's own
  // comment. Reverting it to `const { findings }` (the pre-ledger shape)
  // typechecks cleanly and leaves every other test in this file green, because
  // every other fixture here fires at most one finding, so the capped and
  // uncapped sets are identical everywhere else. This test seeds enough state
  // for more than DEFAULT_FINDING_COUNT findings to fire so the two sets
  // actually diverge, and pins the template-tier voice text -- the one
  // surface with no cap of its own (coaching-voice.service.ts's templateText
  // joins `analysisBody(input.findings)` verbatim) -- to at most
  // DEFAULT_FINDING_COUNT paragraphs.
  it('caps the template-tier voice at DEFAULT_FINDING_COUNT findings even when more fire', async () => {
    await manyFindings()

    const res = await get()
    expect(res.statusCode).toBe(200)
    const data = res.json().data

    expect(data.voice).toBeDefined()
    // This file's test app always makes the LLM router throw (see the
    // beforeAll comment), so this is always the template floor -- exactly the
    // path that joins analysisBody(input.findings) with no cap of its own.
    expect(data.voice.source).toBe('template')
    expect(typeof data.reckon).toBe('string')

    // The template text is [opener, reckon, analysisBody(findings)] joined by
    // '\n\n', and analysisBody itself joins one paragraph per finding with
    // that SAME separator -- so nothing in the string marks "reckon ends,
    // findings begin" except the known length of the opener+reckon prefix.
    // Both are already known exactly (asserted above and in the sibling test
    // as the literal response fields), so stripping that prefix leaves
    // exactly what analysisBody produced.
    const prefix = `${data.opener.text}\n\n${data.reckon}\n\n`
    expect(data.voice.text.startsWith(prefix)).toBe(true)
    const findingParagraphs = data.voice.text.slice(prefix.length).split('\n\n').filter(Boolean)

    // manyFindings() fires at least 4 kinds (commitment_gap, level_estimate,
    // hardest_cleared, mechanics_explainer). The capped `spoken` set holds at
    // most 3 (DEFAULT_FINDING_COUNT) of them, ranked -- this is the assertion
    // a revert to `const { findings }` fails, since the uncapped ledger would
    // put all 4+ into the template text instead.
    expect(findingParagraphs.length).toBeGreaterThan(0)
    expect(findingParagraphs.length).toBeLessThanOrEqual(3)
  })
})
