// apps/api/test/integration/notebook-writeback.test.ts
//
// Buddy writes the notebook itself in two places: a first-open introduction
// (NotebookService.ensureFirstOpen, called from the GET route) and an
// observation each time the learner agrees a weekly commitment (POST
// /v1/buddy/session/commitment). Fixture style mirrors
// notebook-service.test.ts.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { NotebookService } from '../../src/services/notebook.service'
import { buildTestApp } from '../helpers/test-app'
import { buddySessionRoutes } from '../../src/routes/buddy-session'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const USER = '00000000-0000-0000-0000-0000000000e4'

describe('NotebookService write-back', () => {
  const service = new NotebookService(db)

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'WritebackFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })

  const wipe = async () => {
    await db.execute(sql`DELETE FROM notebook_entries WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM buddy_commitments WHERE user_id = ${USER}`)
  }
  beforeEach(wipe)
  afterAll(async () => {
    await wipe()
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
  })

  it('writes a Buddy introduction on first open and never a second time', async () => {
    await service.ensureFirstOpen(USER)
    await service.ensureFirstOpen(USER)

    const view = await service.getNotebook(USER)
    const settled = view.sections.find((s) => s.key === 'settled')!
    const intros = settled.live.filter((e) => e.author === 'buddy')
    expect(intros).toHaveLength(1)
  })

  // ensureFirstOpen is findFirst-then-insert with no transaction or lock
  // between the two steps. Two sequential awaited calls only prove the
  // `if (existing) return` guard works — they never overlap, so they can't
  // exercise the race. This fires several calls concurrently, the way two
  // devices' GET /v1/buddy/notebook requests genuinely can, and checks what
  // actually landed in the database: idempotence here is enforced by the
  // partial unique index notebook_entries_first_open_unique (migration
  // 0032), not by the findFirst guard.
  it('tolerates concurrent first opens and writes exactly one introduction', async () => {
    await Promise.all([
      service.ensureFirstOpen(USER),
      service.ensureFirstOpen(USER),
      service.ensureFirstOpen(USER),
    ])

    const rows = await db.execute(sql`
      SELECT id FROM notebook_entries
      WHERE user_id = ${USER} AND source->>'kind' = 'first_open'
    `)
    expect(rows).toHaveLength(1)
  })

  it('writes an observation when a commitment is agreed', async () => {
    await service.createEntry(USER, {
      kind: 'observation', body: 'Agreed 4 days, 15 minutes.', author: 'buddy',
      weekStart: '2026-08-03', source: { kind: 'commitment' },
    })
    const view = await service.getNotebook(USER)
    expect(view.sections.find((s) => s.key === 'observations')!.live).toHaveLength(1)
  })
})

// setForWeek (commitment.service.ts) is an idempotent upsert keyed on
// (user_id, week_start) — saving twice in one session just updates the same
// commitment row. The notebook write-back beside it in buddy-session.ts was
// a bare createEntry insert with no such guard, so saving twice left two
// live observations ("Agreed 4 days, 15 minutes." and "Agreed 5 days, 20
// minutes.") both rendered, the stale one never superseded.
describe('POST /v1/buddy/session/commitment — notebook write-back idempotence', () => {
  const notebookService = new NotebookService(db)
  let app: Awaited<ReturnType<typeof buildTestApp>>

  beforeAll(async () => {
    app = await buildTestApp({ plugin: buddySessionRoutes, opts: { prefix: '/v1/buddy/session' } })
    // The sibling "NotebookService write-back" describe above deletes the
    // USER profile in its own afterAll (fixtures clean up including
    // user_profiles — see CLAUDE.md), and Vitest runs sibling describes'
    // hooks in file order, so it is gone by the time this suite starts.
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'WritebackRouteFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })
  afterAll(async () => {
    await app.close()
    await db.execute(sql`DELETE FROM notebook_entries WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM buddy_commitments WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
  })

  async function postCommitment(payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST', url: '/v1/buddy/session/commitment',
      headers: { 'x-test-user-id': USER }, payload,
    })
  }

  it('re-saving a commitment for the same week supersedes the stale observation instead of appending a second', async () => {
    const first = await postCommitment({
      weekStart: '2026-08-03', daysCommitted: 4, minutesPerDay: 15, dayTargets: null, focus: null,
    })
    expect(first.statusCode).toBe(200)

    const second = await postCommitment({
      weekStart: '2026-08-03', daysCommitted: 5, minutesPerDay: 20, dayTargets: null, focus: null,
    })
    expect(second.statusCode).toBe(200)

    const view = await notebookService.getNotebook(USER)
    const commitmentObservations = view.sections.find((s) => s.key === 'observations')!.live
      .filter((e) => e.body.startsWith('Agreed'))
    expect(commitmentObservations).toHaveLength(1)
    expect(commitmentObservations[0].body).toBe('Agreed 5 days, 20 minutes.')

    const rows = await db.select().from(schema.notebookEntries).where(eq(schema.notebookEntries.userId, USER))
    const liveCommitmentRows = rows.filter(
      (r) => r.supersededAt === null && (r.source as { kind?: string } | null)?.kind === 'commitment',
    )
    expect(liveCommitmentRows).toHaveLength(1)
    expect(liveCommitmentRows[0].body).toBe('Agreed 5 days, 20 minutes.')
  })
})
