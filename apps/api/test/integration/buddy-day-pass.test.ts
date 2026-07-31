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
// Second due learner for the per-user isolation test below — needs its own
// id so it can be seeded/torn down independently of TEST_USER_ID.
const ISOLATION_USER_ID = '00000000-0000-0000-0000-0000000000b6'

beforeAll(async () => {
  await db.insert(schema.userProfiles).values([
    { id: TEST_USER_ID, displayName: 'Pass Fixture', timezone: 'America/Los_Angeles' },
    // Still on the 'UTC' default — must be skipped, not guessed at (spec §8.5).
    { id: UTC_USER_ID, displayName: 'UTC Default Fixture' },
    { id: ISOLATION_USER_ID, displayName: 'Isolation Fixture', timezone: 'America/Los_Angeles' },
  ]).onConflictDoNothing()
})

beforeEach(async () => {
  for (const id of [TEST_USER_ID, UTC_USER_ID, ISOLATION_USER_ID]) {
    await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, id))
  }
})

afterAll(async () => {
  for (const id of [TEST_USER_ID, UTC_USER_ID, ISOLATION_USER_ID]) {
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

  it('isolates a per-user failure so the other due learner still gets rolled forward and pushed, and logs it', async () => {
    await scheduleForNow(TEST_USER_ID, 'America/Los_Angeles')
    await scheduleForNow(ISOLATION_USER_ID, 'America/Los_Angeles')

    const service = new NotificationService(db)
    const send = vi.spyOn(service as any, 'sendToUserTokens').mockResolvedValue(undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Make whichever learner the loop reaches FIRST throw while being
    // processed — a stand-in for a malformed profile row / unexpected null /
    // transient DB error. The users query has no ORDER BY, so we key off call
    // order rather than a specific user id: the isolation property must hold
    // no matter which of the two is actually processed first.
    const original = CommitmentService.prototype.getMostRecentAgreed
    let calls = 0
    let failingUserId: string | null = null
    const throwSpy = vi.spyOn(CommitmentService.prototype, 'getMostRecentAgreed')
      .mockImplementation(function (this: CommitmentService, userId: string) {
        calls++
        if (calls === 1) {
          failingUserId = userId
          throw new Error('synthetic per-user failure')
        }
        return original.call(this, userId)
      })

    let errorMessages: string[]
    try {
      await service.runBuddyDayPass()
    } finally {
      // Capture before restoring — mockRestore() also clears mock.calls
      // (same as mockReset()), so reading it after restore would see nothing.
      errorMessages = errorSpy.mock.calls.map((c) => String(c[0]))
      throwSpy.mockRestore()
      errorSpy.mockRestore()
    }

    expect(failingUserId).not.toBeNull()
    const okUserId = failingUserId === TEST_USER_ID ? ISOLATION_USER_ID : TEST_USER_ID

    // The failing learner's roll-forward never happened — the throw hit
    // before `ensureForWeek` ran for them.
    const failingRows = await db.select().from(schema.buddyCommitments)
      .where(eq(schema.buddyCommitments.userId, failingUserId!))
    expect(failingRows).toHaveLength(0)

    // The OTHER learner was not collateral damage: rolled forward AND pushed,
    // exactly as if the failure never happened.
    const okRows = await db.select().from(schema.buddyCommitments)
      .where(eq(schema.buddyCommitments.userId, okUserId))
    expect(okRows).toHaveLength(1)
    expect(send.mock.calls.filter((c) => c[0] === okUserId)).toHaveLength(1)

    // The failure was logged with the offending user id...
    expect(
      errorMessages.some((m) => m.includes('[BuddyDay] failed for user') && m.includes(failingUserId!)),
    ).toBe(true)
    // ...and the pass-level summary line fired — the one thing an operator
    // could plausibly alert on.
    expect(errorMessages.some((m) => m.includes('pass completed with 1 user failure'))).toBe(true)
  })
})
