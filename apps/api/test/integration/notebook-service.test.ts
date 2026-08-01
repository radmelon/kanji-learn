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
    await expect(service.supersedeEntry(other, id, 'theirs')).rejects.toThrow()
  })
})
