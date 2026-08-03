// apps/api/test/integration/coaching-refresh.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { CoachingService, isUniqueViolation } from '../../src/services/buddy/coaching.service'
import { NotebookService } from '../../src/services/notebook.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const USER = '00000000-0000-0000-0000-0000000000c6'

/** A commitment period that ended, with zero study time -> commitment_gap fires. */
async function missedPeriod() {
  await db.execute(sql`INSERT INTO buddy_commitments
    (user_id, week_start, days_committed, minutes_per_day, source)
    VALUES (${USER}, '2026-07-20', 4, 15, 'session')`)
}

/**
 * Force a row's `created_at` onto the test's own fictional timeline.
 *
 * Coalescing is now decided from `created_at` (Critical 2), and every write
 * path here that inserts a row (`writeKeyedEntry`, `createEntry`,
 * `supersedeEntry`'s replacement) leaves `created_at` at the column default
 * `now()` -- real wall-clock at whatever instant the test happens to run --
 * because none of them take a `now` parameter. Only `source.analyzedAt` is
 * stamped to the fictional `now` these tests script. Left unstamped,
 * `created_at` and the `now` arguments passed to `service.refresh()` are two
 * unrelated clocks, and whether a scenario reads as "10 minutes later" or
 * "10 minutes ago" to createdAt-based coalescing depends on the real time of
 * day the suite happens to run -- not on anything the test describes. This
 * pins `created_at` to the fictional clock so createdAt-based coalescing
 * exercises the scenario the test actually names.
 */
async function stampCreatedAt(id: string, at: string) {
  await db.execute(sql`UPDATE notebook_entries SET created_at = ${at}::timestamptz WHERE id = ${id}`)
}

describe('CoachingService.refresh', () => {
  const service = new CoachingService(db)
  const notebook = new NotebookService(db)
  const NOW = '2026-08-02T12:00:00.000Z'

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'CoachingRefreshFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })

  const wipe = async () => {
    await db.execute(sql`DELETE FROM notebook_entries WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM buddy_commitments WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM daily_stats WHERE user_id = ${USER}`)
  }
  beforeEach(wipe)
  afterAll(async () => {
    await wipe()
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
  })

  const liveEntries = async () =>
    db.execute(sql`SELECT body, source FROM notebook_entries
      WHERE user_id = ${USER} AND source->>'kind' = 'coaching_analysis'
        AND superseded_at IS NULL`)

  const allEntries = async () =>
    db.execute(sql`SELECT id FROM notebook_entries
      WHERE user_id = ${USER} AND source->>'kind' = 'coaching_analysis'`)

  it('writes NOTHING for a learner with no findings', async () => {
    const result = await service.refresh(USER, { force: true, now: NOW })
    expect(result.written).toBe('skipped')
    expect(result.findings).toEqual([])
    expect((await allEntries()).length).toBe(0)
  })

  it('inserts an entry when a finding exists, and stamps the payload', async () => {
    await missedPeriod()
    const result = await service.refresh(USER, { force: true, now: NOW })
    expect(result.written).toBe('inserted')
    expect(result.findings.map((f) => f.kind)).toContain('commitment_gap')

    const rows = await liveEntries()
    expect(rows.length).toBe(1)
    expect((rows[0] as any).body).toContain('promised')
    const source = (rows[0] as any).source
    expect(source.analyzedAt).toBe(NOW)
    expect(source.findings.find((f: any) => f.kind === 'commitment_gap')).toMatchObject({
      since: NOW, lastRaisedAt: NOW,
    })
  })

  it('an UNCHANGED selection updates in place — no second row', async () => {
    await missedPeriod()
    await service.refresh(USER, { force: true, now: NOW })
    const inserted = await notebook.readLatestKeyed(USER, 'coaching_analysis')
    await stampCreatedAt(inserted!.id, NOW)   // pins coalescing's clock to this scenario's own
    const later = '2026-08-03T12:00:00.000Z'
    const result = await service.refresh(USER, { force: true, now: later })

    expect(result.written).toBe('updated')
    expect((await allEntries()).length).toBe(1)

    const source = ((await liveEntries())[0] as any).source
    expect(source.analyzedAt).toBe(later)
    // The stamp must NOT move: the finding stayed selected, so its novelty
    // recovers on display rather than being re-floored.
    expect(source.findings[0].lastRaisedAt).toBe(NOW)
  })

  it('the staleness gate skips a non-forced refresh inside the window', async () => {
    await missedPeriod()
    await service.refresh(USER, { force: true, now: NOW })
    const soon = '2026-08-02T13:00:00.000Z'   // 1 hour later, inside 6h
    const result = await service.refresh(USER, { now: soon })
    expect(result.written).toBe('skipped')
    expect(((await liveEntries())[0] as any).source.analyzedAt).toBe(NOW)
  })

  it('a non-forced refresh past the staleness window does run', async () => {
    await missedPeriod()
    await service.refresh(USER, { force: true, now: NOW })
    const inserted = await notebook.readLatestKeyed(USER, 'coaching_analysis')
    await stampCreatedAt(inserted!.id, NOW)   // pins coalescing's clock to this scenario's own
    const later = '2026-08-02T20:00:00.000Z'  // 8 hours later
    const result = await service.refresh(USER, { now: later })
    expect(result.written).toBe('updated')
  })

  it('reads priors back across a DELETED entry — memory survives', async () => {
    await missedPeriod()
    await service.refresh(USER, { force: true, now: NOW })
    const row = await notebook.readLatestKeyed(USER, 'coaching_analysis')
    await stampCreatedAt(row!.id, NOW)
    await notebook.supersedeEntry(USER, row!.id, null)   // the delete path

    const later = '2026-08-10T12:00:00.000Z'
    await service.refresh(USER, { force: true, now: later })

    const source = ((await liveEntries())[0] as any).source
    // `since` is carried from the superseded row, NOT reset to `later`.
    expect(source.findings[0].since).toBe(NOW)
  })

  /**
   * Important 3. The test above proves canUpdate=false with coalescing=false
   * (8 days later). Nothing exercised canUpdate=false TOGETHER WITH
   * coalescing=true -- the learner deletes the entry, then a session
   * completes minutes later, not days later. That combination hits the
   * null-priors path from the row (deleted, but still `latest` by
   * created_at) rather than from `latest` in the ordinary non-coalescing
   * sense above, so it is a genuinely different code path, not a
   * restatement of the 8-days-later case.
   */
  it('the learner deletes the entry, then a session completes 10 minutes later — finding memory still survives', async () => {
    await missedPeriod()
    await service.refresh(USER, { force: true, now: NOW })
    const row = await notebook.readLatestKeyed(USER, 'coaching_analysis')
    await stampCreatedAt(row!.id, NOW)
    await notebook.supersedeEntry(USER, row!.id, null)   // the delete path

    const tenMinutesLater = '2026-08-02T12:10:00.000Z'   // inside the 60min coalescing window
    const result = await service.refresh(USER, { force: true, now: tenMinutesLater })

    // canUpdate is false (the live row is gone) regardless of coalescing, so
    // this always inserts -- the interesting question is only what `since`
    // comes out as.
    expect(result.written).toBe('inserted')
    const source = ((await liveEntries())[0] as any).source
    // `since` is carried from the deleted row, NOT reset to `tenMinutesLater`.
    // Only the `?? latest` fallback (skip=1 finds nothing -- the deleted row
    // is the only row that ever existed) gets this right; without it priors
    // would be [] and this would read `tenMinutesLater`.
    expect(source.findings[0].since).toBe(NOW)
  })

  it('records a correction when the learner edited the entry', async () => {
    await missedPeriod()
    await service.refresh(USER, { force: true, now: NOW })
    const row = await notebook.readLatestKeyed(USER, 'coaching_analysis')
    // Both the original row AND its learner-authored replacement need an
    // explicit stamp, not just the replacement: readLatestKeyed orders by
    // created_at DESC, and an unstamped original left at its real wall-clock
    // default can sort AFTER a fictionally-stamped replacement once real
    // "today" has passed the fictional date, making the ORIGINAL (dead) row
    // `latest` instead of the learner's -- which silently drops `correction`
    // below, since that branch only fires when `latest.author === 'learner'`.
    await stampCreatedAt(row!.id, NOW)
    const learnerEdits = '2026-08-02T12:01:00.000Z'   // shortly after NOW -- must sort after it, not tie
    const { id: learnerRowId } = await notebook.supersedeEntry(USER, row!.id, 'I was travelling that week.')
    await stampCreatedAt(learnerRowId!, learnerEdits)

    const later = '2026-08-10T12:00:00.000Z'
    await service.refresh(USER, { force: true, now: later })

    const source = ((await liveEntries())[0] as any).source
    expect(source.correction).toBeDefined()
    expect(source.correction.kinds).toContain('commitment_gap')
  })

  /**
   * Critical 1. The test above only proves `source.correction` gets set --
   * true whether the write inserted or overwrote in place, since both paths
   * build `source` the same way before branching. It says nothing about what
   * happened to the learner's own row. Concrete failure this guards against:
   * the learner edits Buddy's observation 5 minutes after it was written,
   * then a session completes 20 minutes after THAT (still well inside the
   * 60-minute coalescing window) -- `canUpdate` must not be true for a
   * learner-authored latest, or `updateEntryInPlace` overwrites the
   * learner's words with Buddy's new analysis while `author` stays
   * 'learner' in the row, and their text exists nowhere afterward.
   */
  it("a learner's correction survives a later coalescing refresh — superseded, not overwritten", async () => {
    await missedPeriod()
    await service.refresh(USER, { force: true, now: NOW })
    const row = await notebook.readLatestKeyed(USER, 'coaching_analysis')
    // The original row needs its own explicit stamp too, not just the
    // replacement below: readLatestKeyed orders by created_at DESC, and an
    // unstamped original left at its real wall-clock default can sort AFTER
    // a fictionally-stamped replacement once real "today" has passed the
    // fictional date, making the ORIGINAL (dead) row `latest` instead of the
    // learner's -- at which point `canUpdate` is false for the wrong reason
    // (a superseded `latest`, not a learner-authored one) and this test would
    // stop exercising what it claims to.
    await stampCreatedAt(row!.id, NOW)
    // Learner edits 5 minutes later; session completes 20 minutes after that
    // -- 25 minutes total, inside COALESCE_WINDOW_MINUTES, which is exactly
    // what drove the in-place overwrite before the fix. `learnerEdits` is
    // stamped explicitly: left at the column default, this row's created_at
    // would be real wall-clock time, and whether that happens to land within
    // COALESCE_WINDOW_MINUTES of sessionCompletes would depend on the actual
    // instant the suite runs, not on the 5-minutes-later scenario this
    // comment names.
    const learnerEdits = '2026-08-02T12:05:00.000Z'
    const { id: learnerRowId } = await notebook.supersedeEntry(USER, row!.id, 'I was travelling that week.')
    await stampCreatedAt(learnerRowId!, learnerEdits)
    const sessionCompletes = '2026-08-02T12:25:00.000Z'
    const result = await service.refresh(USER, { force: true, now: sessionCompletes })

    // A learner-authored latest can never be updated in place, so this must
    // insert (and supersede the learner's row) regardless of coalescing.
    expect(result.written).toBe('inserted')

    const rows = await db.execute(sql`SELECT author, body, superseded_at FROM notebook_entries
      WHERE user_id = ${USER} AND source->>'kind' = 'coaching_analysis' ORDER BY created_at ASC`) as
      unknown as { author: string; body: string; superseded_at: string | null }[]
    // Three rows in the chain: Buddy's original (superseded by the learner's
    // edit), the learner's correction (superseded by this refresh), and
    // Buddy's new analysis (live).
    expect(rows.length).toBe(3)

    const learnerRow = rows.find((r) => r.author === 'learner')!
    // The learner's words still exist, on their own (now superseded) row --
    // not silently replaced by Buddy's new analysis.
    expect(learnerRow.body).toBe('I was travelling that week.')
    expect(learnerRow.superseded_at).not.toBeNull()

    const liveRow = rows.find((r) => r.superseded_at === null)!
    // The new analysis is Buddy's, on its own live row -- not masquerading
    // as learner-authored the way an in-place overwrite would leave it.
    expect(liveRow.author).toBe('buddy')
  })

  it('coalesces two runs inside the window into ONE chain entry', async () => {
    await missedPeriod()
    await service.refresh(USER, { force: true, now: NOW })
    const inserted = await notebook.readLatestKeyed(USER, 'coaching_analysis')
    await stampCreatedAt(inserted!.id, NOW)
    const tenMinutesLater = '2026-08-02T12:10:00.000Z'
    const result = await service.refresh(USER, { force: true, now: tenMinutesLater })

    expect(result.written).toBe('updated')
    expect((await allEntries()).length).toBe(1)

    // This run hits the null-priors path: the row it coalesces with (the one
    // just inserted above) is the ONLY row that has ever existed, so skip=1
    // finds nothing before it. Without the `?? latest` fallback, priors would
    // resolve to [] and commitment_gap's `since` would reset to
    // tenMinutesLater instead of carrying the ten minutes it already had.
    const source = ((await liveEntries())[0] as any).source
    const finding = source.findings.find((f: any) => f.kind === 'commitment_gap')
    expect(finding.since).toBe(NOW)
  })

  /**
   * SELF-REVIEW GAP. The brief's own "coalesces two runs..." test above only
   * has ONE prior row ever, so `readLatestKeyed(..., 1)` (skip=1) and
   * `latest` (skip=0) both resolve to "nothing before it" / "the only row" in
   * a way that doesn't distinguish the two -- it would still pass if
   * coalescing wrongly read priors from `latest` instead of the row before
   * it. Confirmed empirically: reverting `priorRow` to always equal `latest`
   * left the full suite green. This test seeds a THIRD row (a distinct row
   * before the "previous" one) with its own, different stamp, so the two
   * candidate prior sources disagree and only the correct one satisfies the
   * assertion.
   */
  it('a coalescing run reads priors from the row BEFORE the previous one, not the previous one itself', async () => {
    await missedPeriod()

    // Row A: older, already superseded -- this is what skip=1 should find.
    // created_at is stamped explicitly (matching its own analyzedAt) rather
    // than left at the defaultNow() real wall-clock: coalescing is decided
    // from created_at now, so it must sit on the SAME fictional timeline as
    // row B below, or whichever real instant the suite happens to run at
    // would decide the ordering instead of the scenario this test names.
    const { id: rowAId } = await notebook.createEntry(USER, {
      kind: 'observation', author: 'buddy', body: 'A',
      source: {
        kind: 'coaching_analysis',
        analyzedAt: '2026-07-01T00:00:00.000Z',
        findings: [{
          kind: 'commitment_gap',
          since: '2026-01-01T00:00:00.000Z',
          lastRaisedAt: '2026-07-01T00:00:00.000Z',
        }],
      },
    })
    await stampCreatedAt(rowAId, '2026-07-01T00:00:00.000Z')
    await notebook.supersedeEntry(USER, rowAId, null)

    // Row B: live, the "previous" entry the upcoming refresh will coalesce
    // with. Its own `since` for commitment_gap is deliberately different from
    // row A's, so the assertion below can tell which one was actually read.
    // created_at is stamped to NOW (matching its own analyzedAt), which also
    // gives the required ordering for free: NOW is after row A's 2026-07-01,
    // so ORDER BY created_at DESC is deterministic.
    const { id: rowBId } = await notebook.createEntry(USER, {
      kind: 'observation', author: 'buddy', body: 'B',
      source: {
        kind: 'coaching_analysis',
        analyzedAt: NOW,
        findings: [{ kind: 'commitment_gap', since: '2026-07-30T00:00:00.000Z', lastRaisedAt: NOW }],
      },
    })
    await stampCreatedAt(rowBId, NOW)

    const soon = '2026-08-02T12:10:00.000Z'   // 10 min after row B's created_at -- inside the 60min coalescing window
    const result = await service.refresh(USER, { force: true, now: soon })

    expect(result.written).toBe('updated')
    expect((await allEntries()).length).toBe(2)   // row A (superseded) + row B (updated in place) -- no 3rd row
    const source = ((await liveEntries())[0] as any).source
    const finding = source.findings.find((f: any) => f.kind === 'commitment_gap')
    // Row A's stamp -- not row B's ('2026-07-30...') and not a fresh `since:
    // soon` -- proves priors came from skip=1, not from `latest` itself.
    expect(finding.since).toBe('2026-01-01T00:00:00.000Z')
  })

  /**
   * Critical 2, the steady-state trace from the brief. A row that has sat
   * live for a long time, picking up in-place updates on every unchanged
   * re-analysis, is the PRE-episode state -- not a fresh coalescing partner
   * -- even when its most recent in-place update landed minutes ago.
   * `analyzedAt` moves on every one of those updates; `created_at` never
   * does, which is exactly the distinction Critical 2 turns on.
   *
   * FIX PASS 2 -- this test used to prove nothing. With only the ONE row it
   * seeded, reverting the basis to `analyzedAt` still makes `coalescing` true
   * at the final call below, but `readLatestKeyed(..., 1)` then finds NOTHING
   * -- there is no row before the only row -- so `?? latest` falls back to
   * the exact same row the fixed, createdAt-based `coalescing = false` would
   * have read directly anyway. Both bases landed on the same priors, so
   * `since` survived either way and the assertion could not tell them apart.
   * Confirmed empirically: reverting only the basis left the full suite
   * green. Fixed the same way as the two-row-chain test above -- seed an
   * older, ALREADY-SUPERSEDED row before the live one, so skip=1 finds a REAL
   * row under the reverted basis instead of nothing.
   *
   * That seed row holds `hook_coverage`, deliberately NOT `commitment_gap`,
   * the kind under test. `readLatestKeyed` returns the most recent row
   * regardless of `superseded_at` (see its own doc comment), so the seed is
   * `latest` for this test's very first refresh call, before the live row
   * exists -- and coalescing is false there under EITHER basis (the seed's
   * own created_at and analyzedAt agree, huge gap either way). If the seed
   * carried a `commitment_gap` finding too, `carryForward` would inherit ITS
   * `since` into the live row at that first call, and from then on both the
   * correct lineage (the live row's own history) and the wrong one (the seed
   * row itself) would carry the identical value forward forever -- the two
   * bases would still be indistinguishable, just via a different mechanism
   * than the single-row version above. A different kind sidesteps that: the
   * live row's `since` starts fresh, at its own creation, so the two
   * candidate priors at the final call actually disagree.
   */
  it('a row updated in place minutes ago, but created long ago, is NOT a coalescing episode — since survives', async () => {
    await missedPeriod()

    // The seed: older, already superseded, holding an UNRELATED finding kind
    // -- see the comment above for why. This is what a reverted basis wrongly
    // hands skip=1 below, instead of null.
    const seedTime = '2026-01-01T00:00:00.000Z'
    const { id: seedId } = await notebook.createEntry(USER, {
      kind: 'observation', author: 'buddy', body: 'An older, unrelated finding.',
      source: {
        kind: 'coaching_analysis',
        analyzedAt: seedTime,
        findings: [{ kind: 'hook_coverage', since: '2025-06-01T00:00:00.000Z', lastRaisedAt: seedTime }],
      },
    })
    await stampCreatedAt(seedId, seedTime)
    await notebook.supersedeEntry(USER, seedId, null)

    // missedPeriod's week_start is 2026-07-20 with the default 1-week
    // interval, so the period itself does not COMPLETE (and commitment_gap
    // does not fire) until 2026-07-27 -- `created` must be on or after that,
    // not merely "long before NOW", or this refresh finds nothing at all.
    const created = '2026-07-28T09:00:00.000Z'   // long before NOW (2026-08-02), after the period completes
    await service.refresh(USER, { force: true, now: created })
    const row = await notebook.readLatestKeyed(USER, 'coaching_analysis')
    await stampCreatedAt(row!.id, created)

    // An unforced re-analysis, well past the staleness gate, that finds the
    // same selection and so updates the SAME row in place -- `created_at`
    // does not move. Stands in for "days of unforced GETs" in the brief's
    // trace; one is enough to move analyzedAt away from created_at.
    const recentUpdate = '2026-08-02T11:40:00.000Z'   // 20 min before NOW
    const midResult = await service.refresh(USER, { now: recentUpdate })
    expect(midResult.written).toBe('updated')

    // A forced run 20 minutes after that update -- inside the 60-minute
    // window measured from `analyzedAt` (the pre-fix, buggy basis) but 5
    // days outside it measured from `created_at` (the fix). Under the buggy
    // basis, `readLatestKeyed(..., 1)` now finds the seed row above -- a REAL
    // row, not null -- so `?? latest` never engages and priors come from the
    // wrong row.
    const finalResult = await service.refresh(USER, { force: true, now: NOW })
    expect(finalResult.written).toBe('updated')
    expect((await allEntries()).length).toBe(2)   // seed (superseded) + the live row -- never a 3rd

    const source = ((await liveEntries())[0] as any).source
    const finding = source.findings.find((f: any) => f.kind === 'commitment_gap')
    // `since` traces back to the live row's own creation 5 days ago -- not
    // to `recentUpdate`, and not reset to `NOW`, which is what the buggy
    // basis produces: it reads priors from the seed row above, which holds
    // no commitment_gap entry for carryForward to match, so `since` re-floors
    // to `now` (the pre-fix bug, restated for a chain with real history
    // instead of an empty one).
    expect(finding.since).toBe(created)
  })

  /**
   * SELF-REVIEW GAP. "writes NOTHING for a learner with no findings" only
   * proves nothing gets CREATED from an empty notebook. It says nothing about
   * whether an ALREADY-EXISTING entry is left alone when a later run finds
   * nothing -- rule 4 is "writes nothing and supersedes nothing", and the
   * second half was untested.
   */
  it('an existing entry SURVIVES untouched when a later refresh finds nothing to say', async () => {
    await missedPeriod()
    await service.refresh(USER, { force: true, now: NOW })
    const before = (await liveEntries())[0] as any

    // The commitment period fixture is gone, so a later analysis has nothing
    // to find -- same blank state as the "no findings" test, just reached
    // from an existing entry instead of an empty notebook.
    await db.execute(sql`DELETE FROM buddy_commitments WHERE user_id = ${USER}`)

    const later = '2026-08-10T12:00:00.000Z'
    const result = await service.refresh(USER, { force: true, now: later })

    expect(result.written).toBe('skipped')
    expect(result.findings).toEqual([])
    expect((await allEntries()).length).toBe(1)
    const after = (await liveEntries())[0] as any
    expect(after.body).toBe(before.body)
    expect(after.source).toEqual(before.source)
  })

  /**
   * SELF-REVIEW GAP, closing the loop on `isUniqueViolation`. The dedicated
   * describe block below proves the HELPER matches a real 23505. It does not
   * prove refresh()'s own try/catch actually reaches that helper with what
   * `writeKeyedEntry` throws and returns 'skipped' rather than letting the
   * rejection propagate. Racing two first-ever refreshes for one learner is
   * the scenario the doc comment on refresh() names directly.
   *
   * `Promise.all`, not `allSettled`: if the catch here ever regressed to
   * rethrowing, this test should fail via an unhandled rejection, not pass
   * quietly. The specific interleaving (true race vs. one call's read seeing
   * the other's already-committed row) is scheduling-dependent and not
   * pinned -- both are legitimate, so the assertions check the invariant that
   * holds under either: exactly one call reports 'inserted', the other is
   * 'updated' or 'skipped' but never a second 'inserted', and exactly one
   * live row exists afterward.
   */
  it('two concurrent first-time refreshes: the loser is reported skipped, never thrown', async () => {
    await missedPeriod()

    const [a, b] = await Promise.all([
      service.refresh(USER, { force: true, now: NOW }),
      service.refresh(USER, { force: true, now: NOW }),
    ])

    const outcomes = [a.written, b.written]
    expect(outcomes.filter((w) => w === 'inserted').length).toBe(1)
    const other = outcomes.find((w) => w !== 'inserted')
    expect(other === 'updated' || other === 'skipped').toBe(true)
    expect((await liveEntries()).length).toBe(1)
  })
})

/**
 * Task 9's brief flags `isUniqueViolation`'s `constraint_name` field as an
 * assumption, not a confirmed fact, and asks for a test against a REAL
 * rejection rather than a synthetic error object — a hand-built
 * `{ code: '23505', constraint_name: '...' }` would pass even if postgres.js
 * actually surfaces the name somewhere else (e.g. only inside `.message`),
 * because the synthetic object trivially matches whatever shape the helper
 * expects. Only a genuine driver-thrown error can falsify that.
 *
 * Uses its own fixture user (…c7) rather than sharing `USER` above: the outer
 * describe block's `afterAll` deletes `user_profiles` for `USER`, and running
 * after that would make these inserts fail on the FK rather than the unique
 * index this test is actually targeting.
 */
describe('isUniqueViolation — verified against a real driver rejection', () => {
  const RACE_USER = '00000000-0000-0000-0000-0000000000c7'

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${RACE_USER}, 'UniqueViolationFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM notebook_entries WHERE user_id = ${RACE_USER}`)
  })
  afterAll(async () => {
    await db.execute(sql`DELETE FROM notebook_entries WHERE user_id = ${RACE_USER}`)
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${RACE_USER}`)
  })

  /** Two raw live inserts under the same partial-unique predicate. No
   *  concurrency needed: a single connection inserting the second row
   *  deterministically collides with the first, exactly as the
   *  'the partial unique index permits only one LIVE coaching row' test in
   *  coaching-notebook-store.test.ts already proved for this same index.
   *
   * Minor 4. The sentinel "expected to violate, but it succeeded" throw used
   * to live INSIDE the try whose catch returns the error under test -- if the
   * index ever stopped firing, that catch would swallow the sentinel right
   * back and hand it out as though it were the real rejection, and a negative
   * assertion downstream (e.g. "does NOT match a different constraint") would
   * pass for a completely wrong reason: not because the constraint names
   * differed, but because no rejection happened at all. A flag set inside the
   * try and checked after it keeps the sentinel throw outside any catch that
   * could recapture it -- an index that stops firing now fails the `it()`
   * outright instead of producing a falsely-passing negative assertion. */
  const provokeRealRejection = async (sourceKind: string): Promise<unknown> => {
    await db.execute(sql`INSERT INTO notebook_entries (user_id, kind, body, author, source)
      VALUES (${RACE_USER}, 'observation', 'One', 'buddy', ${{ kind: sourceKind }}::jsonb)`)
    let violated = false
    let caught: unknown
    try {
      await db.execute(sql`INSERT INTO notebook_entries (user_id, kind, body, author, source)
        VALUES (${RACE_USER}, 'observation', 'Two', 'buddy', ${{ kind: sourceKind }}::jsonb)`)
    } catch (err) {
      violated = true
      caught = err
    }
    if (!violated) {
      throw new Error('expected the second insert to violate the unique index, but it succeeded')
    }
    return caught
  }

  it('the real error carries the constraint name in `constraint_name`, not just in the message', async () => {
    const err = await provokeRealRejection('coaching_analysis')
    // Pin the raw shape independently of the helper, so a future change to
    // this assertion and a future change to the helper can't both drift the
    // same way and still agree with each other.
    expect((err as any).code).toBe('23505')
    expect((err as any).constraint_name).toBe('notebook_entries_coaching_unique')
  })

  it('matches a REAL 23505 raised by notebook_entries_coaching_unique', async () => {
    const err = await provokeRealRejection('coaching_analysis')
    expect(isUniqueViolation(err, 'notebook_entries_coaching_unique')).toBe(true)
  })

  it('does NOT match a real 23505 raised by a DIFFERENT constraint', async () => {
    // first_open has its own partial unique index (migration 0032) — a real
    // 23505 that must not be swallowed by the coaching-specific catch in
    // refresh(), per isUniqueViolation's own doc comment.
    const err = await provokeRealRejection('first_open')
    expect(isUniqueViolation(err, 'notebook_entries_coaching_unique')).toBe(false)
    // Sanity check that this err is a genuine unique violation and the
    // mismatch above is about the constraint name, not a bad fixture.
    expect(isUniqueViolation(err, 'notebook_entries_first_open_unique')).toBe(true)
  })

  it('does NOT match a non-postgres error, even one with a matching-looking code', async () => {
    expect(isUniqueViolation(new Error('boom'), 'notebook_entries_coaching_unique')).toBe(false)
    expect(isUniqueViolation(null, 'notebook_entries_coaching_unique')).toBe(false)
    expect(isUniqueViolation({ code: '23505' }, 'notebook_entries_coaching_unique')).toBe(false)
  })
})
