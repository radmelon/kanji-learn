// The hourly buddy-day pass — spec §8.1 and §8.3. Roll-forward, push,
// step-down, and the timezone-skip guard (spec §8.5).

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { NotificationService } from '../../src/services/notification.service'
import { CommitmentService } from '../../src/services/buddy/commitment.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER_ID = '00000000-0000-0000-0000-0000000000b4'
const UTC_USER_ID = '00000000-0000-0000-0000-0000000000b5'

beforeAll(async () => {
  await db.insert(schema.userProfiles).values([
    { id: TEST_USER_ID, displayName: 'Pass Fixture', timezone: 'America/Los_Angeles' },
    // Still on the 'UTC' default — must be skipped, not guessed at (spec §8.5).
    { id: UTC_USER_ID, displayName: 'UTC Default Fixture' },
  ]).onConflictDoNothing()
})

beforeEach(async () => {
  for (const id of [TEST_USER_ID, UTC_USER_ID]) {
    await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, id))
  }
})

afterAll(async () => {
  for (const id of [TEST_USER_ID, UTC_USER_ID]) {
    await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, id))
    await db.delete(schema.userProfiles).where(eq(schema.userProfiles.id, id))
  }
  await client.end()
})

/** Set buddy_day and reminder_hour to "right now" in the user's timezone. */
async function scheduleForNow(userId: string, timeZone: string) {
  const local = new Date(new Date().toLocaleString('en-US', { timeZone }))
  await db.update(schema.userProfiles)
    .set({ buddyDay: local.getDay(), reminderHour: local.getHours(), notificationsEnabled: true })
    .where(eq(schema.userProfiles.id, userId))
}

describe('runBuddyDayPass', () => {
  it('ensures a commitment exists for the due period', async () => {
    await scheduleForNow(TEST_USER_ID, 'America/Los_Angeles')

    const service = new NotificationService(db)
    vi.spyOn(service as any, 'sendToUserTokens').mockResolvedValue(undefined)
    await service.runBuddyDayPass()

    const rows = await db.select().from(schema.buddyCommitments)
      .where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('default')
  })

  it('sends exactly one push for a due session', async () => {
    await scheduleForNow(TEST_USER_ID, 'America/Los_Angeles')

    const service = new NotificationService(db)
    const send = vi.spyOn(service as any, 'sendToUserTokens').mockResolvedValue(undefined)
    await service.runBuddyDayPass()

    const calls = send.mock.calls.filter((c) => c[0] === TEST_USER_ID)
    expect(calls).toHaveLength(1)
    expect((calls[0][1] as any).data.type).toBe('buddy_session')
  })

  it('SKIPS a user whose timezone is still the UTC default (spec §8.5)', async () => {
    await db.update(schema.userProfiles)
      .set({ buddyDay: new Date().getUTCDay(), reminderHour: new Date().getUTCHours() })
      .where(eq(schema.userProfiles.id, UTC_USER_ID))

    const service = new NotificationService(db)
    const send = vi.spyOn(service as any, 'sendToUserTokens').mockResolvedValue(undefined)
    await service.runBuddyDayPass()

    expect(send.mock.calls.filter((c) => c[0] === UTC_USER_ID)).toHaveLength(0)
    const rows = await db.select().from(schema.buddyCommitments)
      .where(eq(schema.buddyCommitments.userId, UTC_USER_ID))
    expect(rows).toHaveLength(0)

    // Control assertion: the pass genuinely ran and did work for someone else,
    // so this is not passing because nothing executed.
    await scheduleForNow(TEST_USER_ID, 'America/Los_Angeles')
    await service.runBuddyDayPass()
    expect(send.mock.calls.filter((c) => c[0] === TEST_USER_ID).length).toBeGreaterThan(0)
  })

  it('steps cadence down after three consecutive misses', async () => {
    await scheduleForNow(TEST_USER_ID, 'America/Los_Angeles')
    const commitments = new CommitmentService(db)

    await commitments.setForWeek(TEST_USER_ID, {
      weekStart: '2026-07-06', daysCommitted: 4, dayTargets: null,
      minutesPerDay: 15, focus: null, source: 'session',
    })
    for (const w of ['2026-07-13', '2026-07-20', '2026-07-27']) {
      await commitments.ensureForWeek(TEST_USER_ID, w)
    }

    const service = new NotificationService(db)
    vi.spyOn(service as any, 'sendToUserTokens').mockResolvedValue(undefined)
    await service.runBuddyDayPass()

    const profile = await db.select().from(schema.userProfiles)
      .where(eq(schema.userProfiles.id, TEST_USER_ID))
    expect(profile[0].buddyIntervalWeeks).toBe(2)
  })
})
