// The hourly buddy-day pass — spec §8.1 and §8.3. Roll-forward, push,
// step-down, and the timezone-skip guard (spec §8.5).

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { addDays } from '@kanji-learn/shared'
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
    // Reset the pass's own bookkeeping columns too — otherwise a push or
    // step-down recorded by one test's runBuddyDayPass() call suppresses the
    // next test's, since both dedupe guards are keyed off these timestamps
    // rather than the (test-local) buddy_commitments rows just cleared above.
    // Also reset cadence to weekly — the step-down tests flip it to
    // fortnightly (or null) via the pass itself, and nothing else resets it.
    await db.update(schema.userProfiles)
      .set({ buddyLastInvitedAt: null, buddyCadenceChangedAt: null, buddyIntervalWeeks: 1 })
      .where(eq(schema.userProfiles.id, id))
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

/** The learner's local calendar date in America/Los_Angeles, as YYYY-MM-DD.
 * Matches buddy-session.ts's own localDateFor. With buddyDay set to today's
 * weekday (via scheduleForNow), this IS the due period's anchor/weekStart. */
function localDateInLA(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
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

  // Weekly-buddy-review pre-merge review, fixes 2-5: nothing recorded that
  // the pass had already acted, which made the fortnightly tier unreachable,
  // let the step-down push ignore reminderHour, stepped a learner down
  // before their third appointment rather than after it, and re-sent the
  // same invitation on every day of the due window.
  describe('cadence and invitation bookkeeping', () => {
    it('does NOT step down after only two completed misses (FIX 4 boundary)', async () => {
      await scheduleForNow(TEST_USER_ID, 'America/Los_Angeles')
      const commitments = new CommitmentService(db)
      const todayStr = localDateInLA(new Date())

      await commitments.setForWeek(TEST_USER_ID, {
        weekStart: addDays(todayStr, -21), daysCommitted: 4, dayTargets: null,
        minutesPerDay: 15, focus: null, source: 'session',
      })
      // Two COMPLETED misses. The current (today) period is created by the
      // pass itself via ensureForWeek and must not count as a third.
      for (const w of [addDays(todayStr, -14), addDays(todayStr, -7)]) {
        await commitments.ensureForWeek(TEST_USER_ID, w)
      }

      const service = new NotificationService(db)
      vi.spyOn(service as any, 'sendToUserTokens').mockResolvedValue(undefined)
      await service.runBuddyDayPass()

      const profile = await db.select().from(schema.userProfiles)
        .where(eq(schema.userProfiles.id, TEST_USER_ID))
      expect(profile[0].buddyIntervalWeeks).toBe(1)
      expect(profile[0].buddyDay).not.toBeNull()
    })

    it('DOES step down after three completed misses (FIX 4 boundary)', async () => {
      await scheduleForNow(TEST_USER_ID, 'America/Los_Angeles')
      const commitments = new CommitmentService(db)
      const todayStr = localDateInLA(new Date())

      await commitments.setForWeek(TEST_USER_ID, {
        weekStart: addDays(todayStr, -28), daysCommitted: 4, dayTargets: null,
        minutesPerDay: 15, focus: null, source: 'session',
      })
      // Three COMPLETED misses this time — the boundary the spec means.
      for (const w of [addDays(todayStr, -21), addDays(todayStr, -14), addDays(todayStr, -7)]) {
        await commitments.ensureForWeek(TEST_USER_ID, w)
      }

      const service = new NotificationService(db)
      vi.spyOn(service as any, 'sendToUserTokens').mockResolvedValue(undefined)
      await service.runBuddyDayPass()

      const profile = await db.select().from(schema.userProfiles)
        .where(eq(schema.userProfiles.id, TEST_USER_ID))
      expect(profile[0].buddyIntervalWeeks).toBe(2)
    })

    it('does not step down a second time on the immediately following hourly pass (FIX 2)', async () => {
      await scheduleForNow(TEST_USER_ID, 'America/Los_Angeles')
      const commitments = new CommitmentService(db)
      const todayStr = localDateInLA(new Date())

      await commitments.setForWeek(TEST_USER_ID, {
        weekStart: addDays(todayStr, -28), daysCommitted: 4, dayTargets: null,
        minutesPerDay: 15, focus: null, source: 'session',
      })
      for (const w of [addDays(todayStr, -21), addDays(todayStr, -14), addDays(todayStr, -7)]) {
        await commitments.ensureForWeek(TEST_USER_ID, w)
      }

      const service = new NotificationService(db)
      const send = vi.spyOn(service as any, 'sendToUserTokens').mockResolvedValue(undefined)

      await service.runBuddyDayPass()
      let profile = (await db.select().from(schema.userProfiles)
        .where(eq(schema.userProfiles.id, TEST_USER_ID)))[0]
      expect(profile.buddyIntervalWeeks).toBe(2) // stepped down once, to fortnightly

      // Simulate the very next hourly invocation. evaluateAppointment's due
      // window widens with the new intervalWeeks, so the SAME period is
      // still 'due' here. Without resetting the miss count on cadence
      // change, this would re-count the same rolled_forward rows and step
      // the learner down a second time, straight to buddyDay: null.
      await service.runBuddyDayPass()
      profile = (await db.select().from(schema.userProfiles)
        .where(eq(schema.userProfiles.id, TEST_USER_ID)))[0]
      expect(profile.buddyDay).not.toBeNull()
      expect(profile.buddyIntervalWeeks).toBe(2)

      const stepDownCalls = send.mock.calls.filter(
        (c) => c[0] === TEST_USER_ID && (c[1] as any).data.type === 'buddy_step_down',
      )
      expect(stepDownCalls).toHaveLength(1)
    })

    it('gates the step-down push on reminderHour, same as the invitation (FIX 3)', async () => {
      await scheduleForNow(TEST_USER_ID, 'America/Los_Angeles')
      const commitments = new CommitmentService(db)
      const todayStr = localDateInLA(new Date())

      // Force a mismatch between "now" and the learner's chosen hour, so the
      // period is due well before their reminderHour arrives — reproducing
      // "fires on the first hourly pass after local midnight".
      const nowHour = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
      ).getHours()
      await db.update(schema.userProfiles)
        .set({ reminderHour: (nowHour + 5) % 24 })
        .where(eq(schema.userProfiles.id, TEST_USER_ID))

      await commitments.setForWeek(TEST_USER_ID, {
        weekStart: addDays(todayStr, -28), daysCommitted: 4, dayTargets: null,
        minutesPerDay: 15, focus: null, source: 'session',
      })
      for (const w of [addDays(todayStr, -21), addDays(todayStr, -14), addDays(todayStr, -7)]) {
        await commitments.ensureForWeek(TEST_USER_ID, w)
      }

      const service = new NotificationService(db)
      const send = vi.spyOn(service as any, 'sendToUserTokens').mockResolvedValue(undefined)
      await service.runBuddyDayPass()

      expect(send.mock.calls.filter((c) => c[0] === TEST_USER_ID)).toHaveLength(0)
      const profile = (await db.select().from(schema.userProfiles)
        .where(eq(schema.userProfiles.id, TEST_USER_ID)))[0]
      // Not stepped down yet — it isn't the learner's chosen hour.
      expect(profile.buddyIntervalWeeks).toBe(1)
    })

    it('pushes the weekly invitation only once per due period, not every day of the window (FIX 5)', async () => {
      await scheduleForNow(TEST_USER_ID, 'America/Los_Angeles')

      const service = new NotificationService(db)
      const send = vi.spyOn(service as any, 'sendToUserTokens').mockResolvedValue(undefined)

      await service.runBuddyDayPass()
      // Simulate the next hourly pass within the same multi-day due window.
      await service.runBuddyDayPass()

      const calls = send.mock.calls.filter(
        (c) => c[0] === TEST_USER_ID && (c[1] as any).data.type === 'buddy_session',
      )
      expect(calls).toHaveLength(1)
    })
  })
})
