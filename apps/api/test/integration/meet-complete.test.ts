// apps/api/test/integration/meet-complete.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@kanji-learn/db'
import { buildTestApp } from '../helpers/test-app'
import { meetRoutes } from '../../src/routes/meet'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const USER = '00000000-0000-0000-0000-0000000000f8'
let app: Awaited<ReturnType<typeof buildTestApp>>

const CONVERSATION_PAYLOAD = {
  outcome: 'conversation',
  reasons: ['Travel', 'JLPT exam'],
  interests: ['cooking'],
  ruler: 'jlpt',
  dailyGoal: 20,
  buddyDay: 0,
  buddyIntervalWeeks: 1,
  transcript: [
    { role: 'assistant', content: "Hi — I'm Buddy." },
    { role: 'user', content: 'Hi Buddy.' },
  ],
}

async function post(payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST', url: '/v1/buddy/meet/complete',
    headers: { 'x-test-user-id': USER }, payload,
  })
}

describe('POST /v1/buddy/meet/complete', () => {
  beforeAll(async () => {
    app = await buildTestApp({ plugin: meetRoutes, opts: { prefix: '/v1/buddy/meet' } })
  })
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM notebook_entries WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM buddy_conversations WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'MeetFixture', 'America/Los_Angeles')`)
  })
  afterAll(async () => {
    await db.execute(sql`DELETE FROM notebook_entries WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM buddy_conversations WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
    await app.close()
    await client.end()
  })

  it('conversation outcome writes page one: intro, appointment, reasons — every field read back', async () => {
    const res = await post(CONVERSATION_PAYLOAD)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.metBuddyAt).toBeTruthy()

    const entries = await db.query.notebookEntries.findMany({
      where: (t, { eq }) => eq(t.userId, USER),
    })
    const byKind = (k: string) => entries.find((e) => (e.source as { kind: string }).kind === k)

    // Enumerate the three page-one entries — never count.
    const intro = byKind('first_open')!
    expect(intro).toBeDefined()
    expect(intro.author).toBe('buddy')
    expect(intro.kind).toBe('decision')

    const appointment = byKind('onboarding_appointment')!
    expect(appointment.body).toBe('We meet on Sundays, every week. You picked the day.')
    expect(appointment.author).toBe('buddy')
    expect(appointment.kind).toBe('decision')

    const reasons = byKind('onboarding_reasons')!
    expect(reasons.body).toContain('Travel, JLPT exam')
    expect(reasons.body).toContain('JLPT level')

    // The stamp, read back from the table — not from the response alone.
    const [profile] = await db.execute(sql`SELECT met_buddy_at FROM user_profiles WHERE id = ${USER}`)
    expect(profile.met_buddy_at).not.toBeNull()

    // The transcript, archived for slice 2's mining pass.
    const convs = await db.query.buddyConversations.findMany({
      where: (t, { eq }) => eq(t.userId, USER),
    })
    expect(convs).toHaveLength(1)
    expect(convs[0]!.context).toBe('onboarding_conversation')
    expect(convs[0]!.turnCount).toBe(2)
    expect(convs[0]!.messages).toEqual(CONVERSATION_PAYLOAD.transcript)
  })

  it('re-completing supersedes page one instead of duplicating it', async () => {
    await post(CONVERSATION_PAYLOAD)
    const first = await post(CONVERSATION_PAYLOAD)
    const firstStamp = first.json().data.metBuddyAt
    await post({ ...CONVERSATION_PAYLOAD, buddyDay: 3, buddyIntervalWeeks: 2 })

    const live = await db.query.notebookEntries.findMany({
      where: (t, { and, eq, isNull }) => and(eq(t.userId, USER), isNull(t.supersededAt)),
    })
    const liveAppointments = live.filter((e) => (e.source as { kind: string }).kind === 'onboarding_appointment')
    expect(liveAppointments).toHaveLength(1)
    expect(liveAppointments[0]!.body).toContain('Wednesdays')
    expect(liveAppointments[0]!.body).toContain('every other week')

    // met_buddy_at is first-wins: re-meeting does not move the date we met.
    const again = await post(CONVERSATION_PAYLOAD)
    expect(again.json().data.metBuddyAt).toBe(firstStamp)
  })

  it('form and skipped outcomes stamp met_buddy_at and write NO notebook entries', async () => {
    for (const outcome of ['form', 'skipped'] as const) {
      await db.execute(sql`DELETE FROM notebook_entries WHERE user_id = ${USER}`)
      await db.execute(sql`UPDATE user_profiles SET met_buddy_at = NULL WHERE id = ${USER}`)
      const res = await post({ outcome })
      expect(res.statusCode).toBe(200)
      expect(res.json().data.metBuddyAt).toBeTruthy()
      const entries = await db.query.notebookEntries.findMany({ where: (t, { eq }) => eq(t.userId, USER) })
      expect(entries).toEqual([])
    }
  })

  it('appointment entry is skipped when buddyDay is null (opt-in appointment)', async () => {
    const res = await post({ ...CONVERSATION_PAYLOAD, buddyDay: null })
    expect(res.statusCode).toBe(200)
    const entries = await db.query.notebookEntries.findMany({ where: (t, { eq }) => eq(t.userId, USER) })
    expect(entries.some((e) => (e.source as { kind: string }).kind === 'onboarding_appointment')).toBe(false)
    expect(entries.some((e) => (e.source as { kind: string }).kind === 'onboarding_reasons')).toBe(true)
  })

  it('404s for a user with no profile row', async () => {
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
    const res = await post({ outcome: 'skipped' })
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('NOT_FOUND')
  })

  it('rejects unknown keys outright — .strict(), not silent stripping', async () => {
    const res = await post({ ...CONVERSATION_PAYLOAD, metBuddyAt: '2020-01-01T00:00:00Z' })
    expect(res.statusCode).toBe(400)
  })
})
