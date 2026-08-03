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
    const later = '2026-08-02T20:00:00.000Z'  // 8 hours later
    const result = await service.refresh(USER, { now: later })
    expect(result.written).toBe('updated')
  })

  it('reads priors back across a DELETED entry — memory survives', async () => {
    await missedPeriod()
    await service.refresh(USER, { force: true, now: NOW })
    const row = await notebook.readLatestKeyed(USER, 'coaching_analysis')
    await notebook.supersedeEntry(USER, row!.id, null)   // the delete path

    const later = '2026-08-10T12:00:00.000Z'
    await service.refresh(USER, { force: true, now: later })

    const source = ((await liveEntries())[0] as any).source
    // `since` is carried from the superseded row, NOT reset to `later`.
    expect(source.findings[0].since).toBe(NOW)
  })

  it('records a correction when the learner edited the entry', async () => {
    await missedPeriod()
    await service.refresh(USER, { force: true, now: NOW })
    const row = await notebook.readLatestKeyed(USER, 'coaching_analysis')
    await notebook.supersedeEntry(USER, row!.id, 'I was travelling that week.')

    const later = '2026-08-10T12:00:00.000Z'
    await service.refresh(USER, { force: true, now: later })

    const source = ((await liveEntries())[0] as any).source
    expect(source.correction).toBeDefined()
    expect(source.correction.kinds).toContain('commitment_gap')
  })

  it('coalesces two runs inside the window into ONE chain entry', async () => {
    await missedPeriod()
    await service.refresh(USER, { force: true, now: NOW })
    const tenMinutesLater = '2026-08-02T12:10:00.000Z'
    const result = await service.refresh(USER, { force: true, now: tenMinutesLater })

    expect(result.written).toBe('updated')
    expect((await allEntries()).length).toBe(1)
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
    await notebook.supersedeEntry(USER, rowAId, null)

    // Row B: live, the "previous" entry the upcoming refresh will coalesce
    // with. Its own `since` for commitment_gap is deliberately different from
    // row A's, so the assertion below can tell which one was actually read.
    // created_at is forced strictly later than row A's so ORDER BY created_at
    // DESC is deterministic rather than dependent on clock resolution -- the
    // same technique as "readLatestKeyed can skip to the row before the
    // latest" in coaching-notebook-store.test.ts.
    await db.execute(sql`INSERT INTO notebook_entries (user_id, kind, body, author, source, created_at)
      VALUES (${USER}, 'observation', 'B', 'buddy',
        ${{
          kind: 'coaching_analysis',
          analyzedAt: NOW,
          findings: [{ kind: 'commitment_gap', since: '2026-07-30T00:00:00.000Z', lastRaisedAt: NOW }],
        }}::jsonb,
        now() + interval '1 second')`)

    const soon = '2026-08-02T12:10:00.000Z'   // 10 min after row B's analyzedAt -- inside the 60min coalescing window
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
   *  coaching-notebook-store.test.ts already proved for this same index. */
  const provokeRealRejection = async (sourceKind: string): Promise<unknown> => {
    await db.execute(sql`INSERT INTO notebook_entries (user_id, kind, body, author, source)
      VALUES (${RACE_USER}, 'observation', 'One', 'buddy', ${{ kind: sourceKind }}::jsonb)`)
    try {
      await db.execute(sql`INSERT INTO notebook_entries (user_id, kind, body, author, source)
        VALUES (${RACE_USER}, 'observation', 'Two', 'buddy', ${{ kind: sourceKind }}::jsonb)`)
      throw new Error('expected the second insert to violate the unique index, but it succeeded')
    } catch (err) {
      return err
    }
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
