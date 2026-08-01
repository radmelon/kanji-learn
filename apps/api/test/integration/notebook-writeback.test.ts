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
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { NotebookService } from '../../src/services/notebook.service'

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
