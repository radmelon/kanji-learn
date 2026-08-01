// apps/api/test/integration/notebook-service.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { NotebookService } from '../../src/services/notebook.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const USER = '00000000-0000-0000-0000-0000000000e1'

describe('NotebookService', () => {
  const service = new NotebookService(db)

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'NotebookFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
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

  it('returns an empty notebook for a learner with no history', async () => {
    const view = await service.getNotebook(USER)
    expect(view.isEmpty).toBe(true)
    expect(view.agreement).toBeNull()
  })

  it('round-trips an entry body — not just a 200', async () => {
    const { id } = await service.createEntry(USER, {
      kind: 'decision', body: 'Writing is the priority', author: 'learner',
    })
    const view = await service.getNotebook(USER)
    const settled = view.sections.find((s) => s.key === 'settled')!
    expect(settled.live.map((e) => e.id)).toContain(id)
    expect(settled.live.find((e) => e.id === id)!.body).toBe('Writing is the priority')
  })

  it('superseding stamps the old row and links the replacement', async () => {
    const { id } = await service.createEntry(USER, {
      kind: 'observation', body: 'Hooks are landing', author: 'buddy',
    })
    const { id: replacement } = await service.supersedeEntry(USER, id, 'Hooks are not landing')

    const rows = await db.select().from(schema.notebookEntries).where(eq(schema.notebookEntries.userId, USER))
    const old = rows.find((r) => r.id === id)!
    expect(old.supersededAt).not.toBeNull()
    expect(old.supersededBy).toBe(replacement)

    const view = await service.getNotebook(USER)
    const obs = view.sections.find((s) => s.key === 'observations')!
    expect(obs.live.map((e) => e.body)).toEqual(['Hooks are not landing'])
    expect(obs.archived.map((e) => e.body)).toEqual(['Hooks are landing'])
  })

  it('deleting supersedes with no replacement', async () => {
    const { id } = await service.createEntry(USER, {
      kind: 'observation', body: 'gone', author: 'buddy',
    })
    const { id: replacement } = await service.supersedeEntry(USER, id, null)
    expect(replacement).toBeNull()

    const view = await service.getNotebook(USER)
    expect(view.sections.find((s) => s.key === 'observations')!.live).toHaveLength(0)
  })

  it("refuses to supersede another learner's entry", async () => {
    const { id } = await service.createEntry(USER, {
      kind: 'observation', body: 'mine', author: 'buddy',
    })
    const other = '00000000-0000-0000-0000-0000000000e2'
    await expect(service.supersedeEntry(other, id, 'theirs')).rejects.toThrow('NOT_FOUND')

    const rows = await db.select().from(schema.notebookEntries)
      .where(eq(schema.notebookEntries.userId, USER))
    const mine = rows.find((r) => r.id === id)!
    expect(mine.supersededAt).toBeNull()
    expect(mine.supersededBy).toBeNull()
  })

  it('superseding the seeded first-open intro replaces it rather than 23505ing on the partial unique index', async () => {
    const { id } = await service.createEntry(USER, {
      kind: 'decision', author: 'buddy',
      body: "This is where we'll keep track of what we decide together.",
      source: { kind: 'first_open' },
    })

    const { id: replacement } = await service.supersedeEntry(USER, id, 'Edited intro text')
    expect(replacement).not.toBeNull()

    const rows = await db.select().from(schema.notebookEntries).where(eq(schema.notebookEntries.userId, USER))
    const old = rows.find((r) => r.id === id)!
    expect(old.supersededAt).not.toBeNull()
    expect(old.supersededBy).toBe(replacement)

    const replacementRow = rows.find((r) => r.id === replacement)!
    expect(replacementRow.body).toBe('Edited intro text')
    expect(replacementRow.supersededAt).toBeNull()
  })

  it('two concurrent supersedes of the same entry: exactly one wins, no orphaned replacement', async () => {
    const { id } = await service.createEntry(USER, {
      kind: 'observation', body: 'racy', author: 'buddy',
    })

    const results = await Promise.allSettled([
      service.supersedeEntry(USER, id, 'winner A'),
      service.supersedeEntry(USER, id, 'winner B'),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason.message).toBe('ALREADY_SUPERSEDED')

    const rows = await db.select().from(schema.notebookEntries)
      .where(eq(schema.notebookEntries.userId, USER))

    // No orphans: every non-superseded row other than the original supersede
    // target must be reachable — i.e. it's either the original (now
    // superseded) or is pointed at by some row's supersededBy.
    const supersededByTargets = new Set(rows.map((r) => r.supersededBy).filter(Boolean))
    const live = rows.filter((r) => r.supersededAt === null)
    for (const row of live) {
      const isOriginalEntry = row.id === id
      const isReachableReplacement = supersededByTargets.has(row.id)
      expect(isOriginalEntry || isReachableReplacement).toBe(true)
    }

    // Exactly one replacement row should exist for this original entry.
    const original = rows.find((r) => r.id === id)!
    expect(original.supersededAt).not.toBeNull()
    const replacementRows = rows.filter((r) => r.id !== id)
    expect(replacementRows).toHaveLength(1)
    expect(replacementRows[0].id).toBe(original.supersededBy)
  })
})
