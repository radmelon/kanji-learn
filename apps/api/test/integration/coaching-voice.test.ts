// CoachingVoiceService — cache, fallback, and the mechanics_explainer seam.
// Per parent §10, no test here asserts LLM prose: the stub returns a sentinel
// string this file controls, so every assertion is about routing and
// structure, never about wording.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import type { Finding } from '@kanji-learn/shared'
import { CoachingVoiceService } from '../../src/services/buddy/coaching-voice.service'
import { BuddyLLMError } from '../../src/services/llm/types'
import type { BuddyLLMRouter } from '../../src/services/llm/router'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER = '00000000-0000-0000-0000-0000000000c2'
const WEEK = '2026-08-03'
const NOW = '2026-08-03T17:00:00.000Z'
const SENTINEL = 'SENTINEL_UTTERANCE'

const leech: Finding = {
  kind: 'leech',
  magnitude: 0.7,
  confidence: 0.8,
  evidence: [{ label: 'worst kanji', value: '敗', kanjiId: 1, character: '敗' }],
  since: '2026-07-12',
}
const mechanics: Finding = {
  kind: 'mechanics_explainer',
  magnitude: 0.1, confidence: 1, evidence: [], since: null,
}

function stubRouter(impl: (req: unknown) => Promise<unknown>) {
  const route = vi.fn(impl)
  return { router: { route } as unknown as Pick<BuddyLLMRouter, 'route'>, route }
}

function ok(content: string) {
  return async () => ({
    content, finishReason: 'stop', inputTokens: 100, outputTokens: 50,
    providerName: 'groq', latencyMs: 12,
  })
}

/** Same shape as `ok()`, but with the finishReason a real truncated
 *  completion carries — content cut off by the token limit, not by the
 *  model choosing to stop. */
function okTruncated(content: string) {
  return async () => ({
    content, finishReason: 'length', inputTokens: 100, outputTokens: 50,
    providerName: 'groq', latencyMs: 12,
  })
}

const base = {
  userId: USER,
  weekStart: WEEK,
  openerKind: 'strong',
  openerText: 'OPENER_TEXT',
  reckon: 'RECKON_TEXT',
  now: NOW,
}

beforeAll(async () => {
  await db.insert(schema.userProfiles)
    .values({ id: USER, displayName: 'Voice Fixture', timezone: 'America/Los_Angeles' })
    .onConflictDoNothing()
})

beforeEach(async () => {
  await db.delete(schema.buddySessionUtterances)
    .where(eq(schema.buddySessionUtterances.userId, USER))
})

afterAll(async () => {
  await db.delete(schema.buddySessionUtterances)
    .where(eq(schema.buddySessionUtterances.userId, USER))
  await db.delete(schema.userProfiles).where(eq(schema.userProfiles.id, USER))
  await client.end()
})

describe('CoachingVoiceService', () => {
  // MUTATION CAUGHT: calling the LLM to say "nothing much this week". §2 is
  // explicit that no findings is the COMMON case; a call here would spend a
  // tier-3 slot per learner per week producing filler, and put prose in front
  // of a learner exactly when there is nothing to report.
  it('returns null and makes no call when there are no findings', async () => {
    const { router, route } = stubRouter(ok(SENTINEL))
    const svc = new CoachingVoiceService(db, router)
    const result = await svc.utteranceFor({ ...base, findings: [] })
    expect(result).toBeNull()
    expect(route).not.toHaveBeenCalled()
  })

  // MUTATION CAUGHT: reporting source:'llm' unconditionally, which would make
  // §8's observable-fallback guarantee a lie and remove the only signal an
  // integration test can assert without touching prose.
  it('reports source llm and caches the utterance on success', async () => {
    const { router, route } = stubRouter(ok(SENTINEL))
    const svc = new CoachingVoiceService(db, router)
    const result = await svc.utteranceFor({ ...base, findings: [leech] })

    expect(result?.source).toBe('llm')
    expect(result?.text).toContain(SENTINEL)
    expect(route).toHaveBeenCalledTimes(1)

    const rows = await db.select().from(schema.buddySessionUtterances)
      .where(eq(schema.buddySessionUtterances.userId, USER))
    expect(rows).toHaveLength(1)
    expect(rows[0].providerName).toBe('groq')
  })

  // MUTATION CAUGHT: reading the cache but never consulting it before routing
  // — the "Buddy says something different every time you look" defect §6
  // exists to prevent, and the one that makes the cost claim (one call per
  // learner per week) false.
  //
  // Also catches caching the raw completion instead of the composed text
  // (e.g. `text: content,` in the insert values instead of `text,`):
  // `findings` here includes `mechanics`, so the composed text carries the
  // appended mechanics_explainer while the raw completion does not. The
  // first call's return value is built from the local `text` variable before
  // the write, so it would still show the explainer even under that
  // mutation — only the cache-served second call would come back without
  // it, silently stripping the trust-building explainer from every repeat
  // open for the rest of the session period.
  it('serves the second call from cache without routing again', async () => {
    const { router, route } = stubRouter(ok(SENTINEL))
    const svc = new CoachingVoiceService(db, router)
    const first = await svc.utteranceFor({ ...base, findings: [leech, mechanics] })
    const second = await svc.utteranceFor({ ...base, findings: [leech, mechanics] })

    expect(second?.text).toBe(first?.text)
    expect(second?.text).toContain('statistical technique called IRT')
    expect(second?.source).toBe('llm')
    expect(route).toHaveBeenCalledTimes(1)
  })

  // MUTATION CAUGHT: letting BuddyLLMError escape. §9 requires every failure
  // to land on the template — the property that slice 3 cannot regress the
  // weekly session, because its worst case is today's session plus slice 2's
  // findings.
  it('falls back to the template when the router throws', async () => {
    const { router } = stubRouter(async () => { throw new BuddyLLMError('capped') })
    const svc = new CoachingVoiceService(db, router)
    const result = await svc.utteranceFor({ ...base, findings: [leech] })

    expect(result?.source).toBe('template')
    expect(result?.text).toContain('OPENER_TEXT')
    expect(result?.text).toContain('RECKON_TEXT')
  })

  // MUTATION CAUGHT: caching the fallback. A transient outage would then
  // freeze a degraded session for the rest of the period, and the next open
  // would never retry.
  it('does not cache a template fallback', async () => {
    const { router } = stubRouter(async () => { throw new BuddyLLMError('capped') })
    const svc = new CoachingVoiceService(db, router)
    await svc.utteranceFor({ ...base, findings: [leech] })

    const rows = await db.select().from(schema.buddySessionUtterances)
      .where(eq(schema.buddySessionUtterances.userId, USER))
    expect(rows).toHaveLength(0)
  })

  // MUTATION CAUGHT: removing the race between the router call and
  // COACHING_LLM_TIMEOUT_MS (or removing the timeout entirely). Without it, a
  // stalled tier-2 provider holds this call open indefinitely --
  // apps/mobile/src/lib/api.ts aborts a GET at 30s and automatically retries
  // it once, so an unbounded wait here turns one stalled provider into a
  // second forced coaching.refresh, a second LLM call and a second
  // rate-limit slot spent on the same session, ending in an error screen
  // around 61s instead of a template a few seconds in.
  it('falls back to the template when the router call never settles', async () => {
    const { router, route } = stubRouter(() => new Promise<never>(() => {}))
    // A short injected bound, not fake timers: this suite talks to a real
    // Postgres connection, and vi.useFakeTimers() would stall that too.
    // Production never passes this third argument -- it defaults to the
    // exported COACHING_LLM_TIMEOUT_MS.
    const svc = new CoachingVoiceService(db, router, 20)
    const result = await svc.utteranceFor({ ...base, findings: [leech] })

    expect(result?.source).toBe('template')
    expect(route).toHaveBeenCalledTimes(1)
  })

  // MUTATION CAUGHT: treating an empty or whitespace-only completion as
  // success. §9 lists it as a failure mode; without this the learner gets a
  // blank session card and every other test still passes.
  it('falls back when the model returns nothing usable', async () => {
    for (const content of ['', '   \n  ']) {
      await db.delete(schema.buddySessionUtterances)
        .where(eq(schema.buddySessionUtterances.userId, USER))
      const { router } = stubRouter(ok(content))
      const svc = new CoachingVoiceService(db, router)
      const result = await svc.utteranceFor({ ...base, findings: [leech] })
      expect(result?.source).toBe('template')
    }
  })

  // MUTATION CAUGHT: dropping the length bound, letting a runaway completion
  // become the whole session screen.
  it('falls back when the model runs long', async () => {
    const { router } = stubRouter(ok('x'.repeat(5000)))
    const svc = new CoachingVoiceService(db, router)
    const result = await svc.utteranceFor({ ...base, findings: [leech] })
    expect(result?.source).toBe('template')
  })

  // MUTATION CAUGHT: accepting a truncated completion. finishReason: 'length'
  // means the model was cut off mid-sentence by the token limit — that
  // happens well under MAX_UTTERANCE_CHARS, so the character bound does not
  // catch it. Without the finishReason guard, this content is short and
  // non-empty, so it would be returned AND cached, freezing a sentence that
  // stops mid-word for the rest of the learner's session period.
  it('falls back when the completion is truncated', async () => {
    const { router } = stubRouter(
      okTruncated('Your leech rate on 敗 has been climbing for the past three weeks, and'),
    )
    const svc = new CoachingVoiceService(db, router)
    const result = await svc.utteranceFor({ ...base, findings: [leech] })
    expect(result?.source).toBe('template')
  })

  // MUTATION CAUGHT: filtering mechanics_explainer out of the prompt (Task 2)
  // and then forgetting to append it, which would delete the one finding whose
  // purpose is building trust.
  it('appends the mechanics explainer verbatim after the composed utterance', async () => {
    const { router } = stubRouter(ok(SENTINEL))
    const svc = new CoachingVoiceService(db, router)
    const result = await svc.utteranceFor({ ...base, findings: [leech, mechanics] })

    expect(result?.source).toBe('llm')
    expect(result?.text.startsWith(SENTINEL)).toBe(true)
    expect(result?.text).toContain('statistical technique called IRT')
  })

  // MUTATION CAUGHT: calling the router when the ONLY finding is the one kind
  // it may never voice — a paid call with an empty finding list.
  it('does not route when mechanics_explainer is the only finding', async () => {
    const { router, route } = stubRouter(ok(SENTINEL))
    const svc = new CoachingVoiceService(db, router)
    const result = await svc.utteranceFor({ ...base, findings: [mechanics] })

    expect(route).not.toHaveBeenCalled()
    expect(result?.source).toBe('template')
    expect(result?.text).toContain('statistical technique called IRT')
  })

  // MUTATION CAUGHT: requesting tier 3 by forcing userOptedInPremium, or
  // landing on the wrong context string, either of which reverses §5's
  // routing without changing any visible output.
  it('routes on the coaching_utterance context and does not force premium', async () => {
    const { router, route } = stubRouter(ok(SENTINEL))
    const svc = new CoachingVoiceService(db, router)
    await svc.utteranceFor({ ...base, findings: [leech] })

    const request = route.mock.calls[0][0] as Record<string, unknown>
    expect(request.context).toBe('coaching_utterance')
    expect(request.userId).toBe(USER)
    expect(request.userOptedInPremium).toBeUndefined()
  })

  // MUTATION CAUGHT: this is a defence-in-depth, end-to-end check, not a
  // call-site-specific one. It only goes red if BOTH filters are removed at
  // once — the internal re-filter inside buildCoachingPrompt (Task 2) AND the
  // `spoken` (not `input.findings`) argument passed at this call site —
  // because either filter alone is already enough to keep mechanics_explainer
  // out of the outgoing request. On its own, this test cannot tell you which
  // of the two is missing; verified by experiment (Task 4 report) that
  // reverting the call site alone to pass unfiltered findings leaves it green.
  //
  // The second assertion (not.toContain('IRT')) does not add discriminating
  // power against either filter above: describe() in coaching-prompt.ts only
  // renders kind, magnitude, confidence, `since`, and evidence label/value,
  // and the `mechanics` fixture has `evidence: []`, so the prompt would never
  // contain 'IRT' even with both filters removed. It guards a different,
  // hypothetical leak instead — templateCopy's fixed prose (which does
  // contain "IRT") reaching the prompt builder some other way — not the
  // filtering the first assertion covers.
  it('never sends the mechanics explainer to the router', async () => {
    const { router, route } = stubRouter(ok(SENTINEL))
    const svc = new CoachingVoiceService(db, router)
    await svc.utteranceFor({ ...base, findings: [leech, mechanics] })

    const sent = JSON.stringify(route.mock.calls[0][0])
    expect(sent).not.toContain('mechanics_explainer')
    expect(sent).not.toContain('IRT')
  })

  // MUTATION CAUGHT: letting a cache-write failure escape. §9's last row says
  // "return the utterance anyway; log" — a lost write costs one extra call on
  // the next open, while a thrown error costs the whole coaching surface. The
  // unknown user id makes the FK to user_profiles reject the insert for real,
  // rather than mocking the failure the assertion is about.
  it('returns the utterance even when the cache write fails', async () => {
    const { router } = stubRouter(ok(SENTINEL))
    const svc = new CoachingVoiceService(db, router)
    const result = await svc.utteranceFor({
      ...base,
      userId: '00000000-0000-0000-0000-0000000000ff', // no such profile
      findings: [leech],
    })

    expect(result?.source).toBe('llm')
    expect(result?.text).toContain(SENTINEL)
  })

  // MUTATION CAUGHT: removing the try/catch around the cache READ, which
  // would turn a transient database blip into a thrown error out of a
  // service documented never to throw. A failed read must degrade to a MISS
  // and fall through to the router exactly as if no cached row existed —
  // proven here by asserting the router WAS called, not just that the
  // promise resolves. The stub `db` throws synchronously from `select()`
  // (the only method `readCache` calls); `insert()` is stubbed too since the
  // success path that follows a miss reaches the cache write, and the stub
  // chain includes `onConflictDoNothing()` to match the real insert's shape.
  it('degrades to a cache miss and still routes when the cache read fails', async () => {
    const { router, route } = stubRouter(ok(SENTINEL))
    const throwingDb = {
      select: () => { throw new Error('cache read boom') },
      insert: () => ({ values: () => ({ onConflictDoNothing: async () => {} }) }),
    } as unknown as Db
    const svc = new CoachingVoiceService(throwingDb, router)
    const result = await svc.utteranceFor({ ...base, findings: [leech] })

    expect(result?.source).toBe('llm')
    expect(result?.text).toContain(SENTINEL)
    expect(route).toHaveBeenCalledTimes(1)
  })

  // MUTATION CAUGHT: calling analysisBody(findings) without `now`. copy.ts:62
  // reads `if (!now || days >= ESCALATE_AFTER_DAYS)`, so dropping the argument
  // appends "this has been true for a while now" to EVERY finding carrying a
  // `since`, however recent — silently, with no other test failing. `leech`
  // was first seen 2026-07-12 and NOW is 2026-08-03: 22 days, so pick a
  // finding inside the 21-day window to make the two paths differ.
  it('does not escalate a recent finding in the template fallback', async () => {
    const { router } = stubRouter(async () => { throw new BuddyLLMError('capped') })
    const svc = new CoachingVoiceService(db, router)
    const recent: Finding = { ...leech, since: '2026-08-01' }
    const result = await svc.utteranceFor({ ...base, findings: [recent] })

    expect(result?.source).toBe('template')
    expect(result?.text).not.toContain('been true for a while now')
  })

  // MUTATION CAUGHT: dropping readCache's `and(...)` predicate entirely (e.g.
  // simplifying the WHERE clause while touching this code for an unrelated
  // reason), which would let the query return whichever row Postgres happens
  // to scan first regardless of who is asking or which week they mean -- the
  // privacy failure this slice cannot afford. Every other test in this file
  // uses one fixed user and one fixed week and would not notice.
  it('does not serve a cache hit seeded for a different learner and a different week', async () => {
    const OTHER_USER = '00000000-0000-0000-0000-0000000000ca'
    const OTHER_WEEK = '2020-01-06'
    await db.insert(schema.userProfiles)
      .values({ id: OTHER_USER, displayName: 'Other Voice Fixture', timezone: 'America/Los_Angeles' })
      .onConflictDoNothing()
    await db.insert(schema.buddySessionUtterances).values({
      userId: OTHER_USER,
      weekStart: OTHER_WEEK,
      text: 'OTHER_LEARNERS_UTTERANCE',
      providerName: 'groq',
    })

    try {
      const { router, route } = stubRouter(ok(SENTINEL))
      const svc = new CoachingVoiceService(db, router)
      const result = await svc.utteranceFor({ ...base, findings: [leech] })

      expect(route).toHaveBeenCalledTimes(1)
      expect(result?.source).toBe('llm')
      expect(result?.text).toContain(SENTINEL)
      expect(result?.text).not.toContain('OTHER_LEARNERS_UTTERANCE')
    } finally {
      await db.delete(schema.buddySessionUtterances)
        .where(eq(schema.buddySessionUtterances.userId, OTHER_USER))
      await db.delete(schema.userProfiles).where(eq(schema.userProfiles.id, OTHER_USER))
    }
  })
})
