// apps/api/test/integration/coaching-notebook-store.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { NotebookService } from '../../src/services/notebook.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const USER = '00000000-0000-0000-0000-0000000000c1'

describe('NotebookService — coaching payload storage', () => {
  const service = new NotebookService(db)

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'CoachingStoreFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })

  const wipe = async () => {
    await db.execute(sql`DELETE FROM notebook_entries WHERE user_id = ${USER}`)
  }
  beforeEach(wipe)
  afterAll(async () => {
    await wipe()
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
  })

  it('round-trips a source payload alongside the kind', async () => {
    await service.writeKeyedEntry(USER, {
      sourceKind: 'coaching_analysis',
      kind: 'observation',
      body: 'Readings are trailing.',
      sourcePayload: {
        analyzedAt: '2026-08-02T12:00:00.000Z',
        findings: [{ kind: 'reading_lag', since: '2026-08-01', lastRaisedAt: '2026-08-01' }],
      },
    })

    const row = await service.readLatestKeyed(USER, 'coaching_analysis')
    expect(row).not.toBeNull()
    expect(row!.source.kind).toBe('coaching_analysis')
    expect(row!.source.analyzedAt).toBe('2026-08-02T12:00:00.000Z')
    expect(row!.source.findings).toEqual([
      { kind: 'reading_lag', since: '2026-08-01', lastRaisedAt: '2026-08-01' },
    ])
  })

  it('readLatestKeyed returns a SUPERSEDED row when it is the most recent', async () => {
    // This is what makes the memory survive a learner deleting the entry:
    // supersedeEntry marks the row, it never removes it.
    const { id } = await service.createEntry(USER, {
      kind: 'observation', body: 'First', author: 'buddy',
      source: { kind: 'coaching_analysis', analyzedAt: 'A', findings: [] },
    })
    await service.supersedeEntry(USER, id, null)

    const row = await service.readLatestKeyed(USER, 'coaching_analysis')
    expect(row).not.toBeNull()
    expect(row!.supersededAt).not.toBeNull()
    expect(row!.source.analyzedAt).toBe('A')
  })

  it('readLatestKeyed can skip to the row before the latest', async () => {
    const { id: olderId } = await service.createEntry(USER, {
      kind: 'observation', body: 'Older', author: 'buddy',
      source: { kind: 'coaching_analysis', analyzedAt: 'OLD', findings: [] },
    })
    // Migration 0034 allows only one LIVE coaching_analysis row per learner
    // (notebook_entries_coaching_unique), so "Older" must be superseded
    // before "Newer" is inserted below — two simultaneously-live rows here
    // would 23505 the same way the reorder regression test does. This is
    // exactly why readLatestKeyed does not filter on supersededAt (see its
    // doc comment): the now-superseded row must still be reachable via
    // skip=1.
    await service.supersedeEntry(USER, olderId, null)
    // created_at defaults to now(); force a later timestamp so ordering is
    // deterministic rather than dependent on clock resolution.
    //
    // Pass the plain object, not JSON.stringify(...): postgres.js sees the
    // literal `::jsonb` cast after this placeholder and stringifies the bound
    // value itself. Pre-stringifying here double-encodes, so the column would
    // hold a jsonb STRING ('"{\"kind\":...}"') rather than an object —
    // source->>'kind' is NULL against a jsonb string, which would silently
    // drop this row out of readLatestKeyed's WHERE filter below.
    await db.execute(sql`INSERT INTO notebook_entries (user_id, kind, body, author, source, created_at)
      VALUES (${USER}, 'observation', 'Newer', 'buddy',
              ${{ kind: 'coaching_analysis', analyzedAt: 'NEW', findings: [] }}::jsonb,
              now() + interval '1 second')`)

    const latest = await service.readLatestKeyed(USER, 'coaching_analysis')
    const before = await service.readLatestKeyed(USER, 'coaching_analysis', 1)
    expect(latest!.source.analyzedAt).toBe('NEW')
    expect(before!.source.analyzedAt).toBe('OLD')
  })

  it('updateEntryInPlace changes body and source WITHOUT creating a new row', async () => {
    await service.writeKeyedEntry(USER, {
      sourceKind: 'coaching_analysis', kind: 'observation', body: 'Before',
      sourcePayload: { analyzedAt: 'A', findings: [] },
    })
    const row = await service.readLatestKeyed(USER, 'coaching_analysis')

    await service.updateEntryInPlace(USER, row!.id, 'After', {
      kind: 'coaching_analysis', analyzedAt: 'B', findings: [],
    })

    const rows = await db.execute(
      sql`SELECT body, source->>'analyzedAt' AS a FROM notebook_entries WHERE user_id = ${USER}`,
    )
    expect(rows.length).toBe(1)
    expect(rows[0].body).toBe('After')
    expect(rows[0].a).toBe('B')
  })

  it('writeKeyedEntry SUPERSEDES rather than colliding on the second call', async () => {
    // THE REGRESSION TEST FOR THIS TASK'S REORDER.
    //
    // writeKeyedEntry used to insert the replacement BEFORE superseding the
    // original (notebook.service.ts:137 before :143). With migration 0034's
    // partial unique index in place, both rows satisfy the predicate at that
    // instant, so this second call failed with 23505 — on the ordinary path,
    // single-threaded, no race required. supersedeEntry documents the same
    // hazard at :181-186 and orders itself the other way.
    await service.writeKeyedEntry(USER, {
      sourceKind: 'coaching_analysis', kind: 'observation', body: 'First',
      sourcePayload: { analyzedAt: 'A', findings: [] },
    })
    await service.writeKeyedEntry(USER, {
      sourceKind: 'coaching_analysis', kind: 'observation', body: 'Second',
      sourcePayload: { analyzedAt: 'B', findings: [] },
    })

    const rows = await db.execute(
      sql`SELECT id, body, superseded_at, superseded_by FROM notebook_entries
          WHERE user_id = ${USER} AND source->>'kind' = 'coaching_analysis'
          ORDER BY created_at`,
    )
    expect(rows.length).toBe(2)
    const [older, newer] = rows as any[]
    expect(older.body).toBe('First')
    expect(newer.body).toBe('Second')
    // The old row is superseded AND linked to its replacement. The link is a
    // third statement, because supersededBy needs the new row's id — which is
    // why the reorder is supersede -> insert -> link, not just a swap.
    expect(older.superseded_at).not.toBeNull()
    expect(older.superseded_by).toBe(newer.id)
    expect(newer.superseded_at).toBeNull()
  })

  it('the partial unique index permits only one LIVE coaching row', async () => {
    await service.writeKeyedEntry(USER, {
      sourceKind: 'coaching_analysis', kind: 'observation', body: 'One',
      sourcePayload: { analyzedAt: 'A', findings: [] },
    })
    // Plain object, not JSON.stringify(...) — see the comment in the "skip"
    // test above. Double-encoding here would store a jsonb STRING, which
    // never matches the partial index's `source->>'kind' = 'coaching_analysis'`
    // predicate, and this insert would wrongly succeed instead of colliding.
    await expect(
      db.execute(sql`INSERT INTO notebook_entries (user_id, kind, body, author, source)
        VALUES (${USER}, 'observation', 'Two', 'buddy',
                ${{ kind: 'coaching_analysis' }}::jsonb)`),
    ).rejects.toThrow()
  })
})
