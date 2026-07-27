// apps/api/test/unit/services/notification-send-to-user-tokens.test.ts
//
// Unit-ish tests for NotificationService.sendToUserTokens. The Expo SDK is
// mocked via vi.mock so we can drive ticket responses from the test; the
// database calls hit the real test Postgres so we can observe pruning.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { userPushTokens, userProfiles, friendships } from '@kanji-learn/db'

// Mock the Expo SDK before importing NotificationService — the service
// module-level `new Expo()` will pick up this fake class. `vi.hoisted` is
// required because `vi.mock` factories are hoisted above top-level `const`s,
// so a plain `const mockFn = vi.fn()` would be TDZ-accessed by the factory.
const { mockSendPushNotificationsAsync, mockGetPushNotificationReceiptsAsync } = vi.hoisted(() => ({
  mockSendPushNotificationsAsync: vi.fn(),
  mockGetPushNotificationReceiptsAsync: vi.fn(),
}))
vi.mock('expo-server-sdk', () => ({
  Expo: class {
    sendPushNotificationsAsync = mockSendPushNotificationsAsync
    getPushNotificationReceiptsAsync = mockGetPushNotificationReceiptsAsync
    // The real SDK chunks into groups of 100; our tests stay well under that
    // limit, so identity-chunking keeps the assertions on call count simple.
    chunkPushNotifications = (messages: unknown[]) => [messages]
    chunkPushNotificationReceiptIds = (ids: string[]) => (ids.length > 0 ? [ids] : [])
    static isExpoPushToken = (t: string) => /^ExponentPushToken\[.+\]$/.test(t)
  },
}))

import { NotificationService, mateNotifyCache } from '../../../src/services/notification.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const service = new NotificationService(db)

const USER = '00000000-0000-0000-0000-0000000000f1'
const TOKEN_A = 'ExponentPushToken[aaa]'
const TOKEN_B = 'ExponentPushToken[bbb]'
const TOKEN_C = 'ExponentPushToken[ccc]'

const SUBMITTER = '00000000-0000-0000-0000-0000000000f2'
const RECIPIENT = '00000000-0000-0000-0000-0000000000f3'

beforeEach(async () => {
  mockSendPushNotificationsAsync.mockReset()
  // Default: no receipts are ready yet. That is the honest production default —
  // Expo generates receipts asynchronously — so a test that wants `delivered`
  // counted has to say so explicitly.
  mockGetPushNotificationReceiptsAsync.mockReset()
  mockGetPushNotificationReceiptsAsync.mockResolvedValue({})
  await db.execute(sql`DELETE FROM user_push_tokens WHERE user_id = ${USER}`)
  await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
  await db.insert(userProfiles).values({ id: USER, displayName: 'F', timezone: 'UTC' })
})

describe('sendToUserTokens', () => {
  it('fans out to every token in a single Expo batch call', async () => {
    await db.insert(userPushTokens).values([
      { userId: USER, token: TOKEN_A, platform: 'ios' },
      { userId: USER, token: TOKEN_B, platform: 'ios' },
      { userId: USER, token: TOKEN_C, platform: 'android' },
    ])
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: 'ok', id: 'r1' }, { status: 'ok', id: 'r2' }, { status: 'ok', id: 'r3' },
    ])
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      r1: { status: 'ok' }, r2: { status: 'ok' }, r3: { status: 'ok' },
    })

    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b', sound: 'default' })

    expect(mockSendPushNotificationsAsync).toHaveBeenCalledTimes(1)
    const args = mockSendPushNotificationsAsync.mock.calls[0][0]
    expect(args).toHaveLength(3)
    expect(args.map((m: any) => m.to)).toEqual(expect.arrayContaining([TOKEN_A, TOKEN_B, TOKEN_C]))
    expect(args.every((m: any) => m.title === 't' && m.body === 'b')).toBe(true)
    expect(result).toEqual({ sent: 3, pruned: 0, accepted: 3 })
  })

  it('returns zeroes and skips the Expo call when the user has no tokens', async () => {
    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b' })
    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled()
    expect(result).toEqual({ sent: 0, pruned: 0, accepted: 0 })
  })

  it('prunes rows that ticket with DeviceNotRegistered', async () => {
    await db.insert(userPushTokens).values([
      { userId: USER, token: TOKEN_A, platform: 'ios' },
      { userId: USER, token: TOKEN_B, platform: 'ios' },
    ])
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: 'ok', id: 'r1' },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
    ])
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({ r1: { status: 'ok' } })

    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b' })

    expect(result).toEqual({ sent: 1, pruned: 1, accepted: 1 })
    const remaining = await db.select().from(userPushTokens).where(eq(userPushTokens.userId, USER))
    expect(remaining).toHaveLength(1)
    expect(remaining[0].token).toBe(TOKEN_A)
  })

  it('prunes rows that ticket with InvalidCredentials or MessageTooBig', async () => {
    await db.insert(userPushTokens).values([
      { userId: USER, token: TOKEN_A, platform: 'ios' },
      { userId: USER, token: TOKEN_B, platform: 'ios' },
    ])
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: 'error', details: { error: 'InvalidCredentials' } },
      { status: 'error', details: { error: 'MessageTooBig' } },
    ])

    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b' })
    expect(result.pruned).toBe(2)
    const remaining = await db.select().from(userPushTokens).where(eq(userPushTokens.userId, USER))
    expect(remaining).toHaveLength(0)
  })

  it('leaves rows intact on other error types (e.g. rate limit)', async () => {
    await db.insert(userPushTokens).values({ userId: USER, token: TOKEN_A, platform: 'ios' })
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: 'error', details: { error: 'MessageRateExceeded' } },
    ])

    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b' })
    expect(result.pruned).toBe(0)
    const remaining = await db.select().from(userPushTokens).where(eq(userPushTokens.userId, USER))
    expect(remaining).toHaveLength(1)
  })
})

// ─── Receipt polling (BUGS.md root cause C, 2026-07-26) ──────────────────────
//
// A ticket is Expo's synchronous *acceptance*, not delivery. The real outcome —
// InvalidCredentials, DeviceNotRegistered, MessageRateExceeded — only ever
// appears in a receipt, and nothing polled for one. That is why two live bugs
// stayed invisible for three months behind a log line reading "sent=1".
describe('sendToUserTokens — receipt polling', () => {
  beforeEach(async () => {
    await db.insert(userPushTokens).values({ userId: USER, token: TOKEN_A, platform: 'ios' })
  })

  it('does NOT count a message as sent when the receipt says the credentials are bad', async () => {
    // The exact shape of the shipped bug: a ticket-only implementation
    // reported sent=1 here while nothing reached the device.
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok', id: 'r1' }])
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      r1: { status: 'error', details: { error: 'InvalidCredentials' } },
    })

    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b' })

    expect(result.accepted).toBe(1)
    expect(result.sent).toBe(0)
  })

  it('keeps the token when the receipt blames OUR credentials, not the device', async () => {
    // InvalidCredentials means our APNs/FCM key is wrong. Pruning on it would
    // delete every push token in the system the first time a certificate
    // expires — and only a reinstall re-registers them.
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok', id: 'r1' }])
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      r1: { status: 'error', details: { error: 'InvalidCredentials' } },
    })

    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b' })

    expect(result.pruned).toBe(0)
    const remaining = await db.select().from(userPushTokens).where(eq(userPushTokens.userId, USER))
    expect(remaining).toHaveLength(1)
  })

  it('counts a delivered receipt as sent', async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok', id: 'r2' }])
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({ r2: { status: 'ok' } })

    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b' })

    expect(result.sent).toBe(1)
  })

  it('prunes a token whose receipt says DeviceNotRegistered', async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok', id: 'r3' }])
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      r3: { status: 'error', details: { error: 'DeviceNotRegistered' } },
    })

    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b' })

    expect(result.pruned).toBe(1)
    const remaining = await db.select().from(userPushTokens).where(eq(userPushTokens.userId, USER))
    expect(remaining).toHaveLength(0)
  })

  it('still reports accepted when the receipt is not ready yet', async () => {
    // Expo generates receipts asynchronously — an immediate poll usually
    // returns nothing. "Not yet known" must read as accepted-but-unconfirmed,
    // never as a failure, or every healthy send would look broken.
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok', id: 'r4' }])
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({})

    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b' })

    expect(result).toEqual({ sent: 0, pruned: 0, accepted: 1 })
  })

  it('survives a receipt fetch that throws', async () => {
    // Receipts are diagnostics. Losing them must never turn a successful send
    // into a thrown request.
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok', id: 'r5' }])
    mockGetPushNotificationReceiptsAsync.mockRejectedValue(new Error('502 from Expo'))

    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b' })

    expect(result).toEqual({ sent: 0, pruned: 0, accepted: 1 })
  })

  it('does not ask for receipts when no ticket carried an id', async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: 'error', details: { error: 'MessageRateExceeded' } },
    ])

    await service.sendToUserTokens(USER, { title: 't', body: 'b' })

    expect(mockGetPushNotificationReceiptsAsync).not.toHaveBeenCalled()
  })
})

describe('notifyStudyMates — per-friendship mute', () => {
  beforeEach(async () => {
    // Clear the module-level frequency cap so each test starts clean —
    // otherwise the first successful send leaves a cache entry that blocks
    // every subsequent test using the same SUBMITTER:RECIPIENT pair.
    mateNotifyCache.clear()
    await db.execute(sql`DELETE FROM friendships WHERE requester_id IN (${SUBMITTER}, ${RECIPIENT}) OR addressee_id IN (${SUBMITTER}, ${RECIPIENT})`)
    await db.execute(sql`DELETE FROM user_push_tokens WHERE user_id IN (${SUBMITTER}, ${RECIPIENT})`)
    await db.execute(sql`DELETE FROM user_profiles WHERE id IN (${SUBMITTER}, ${RECIPIENT})`)
    await db.insert(userProfiles).values([
      { id: SUBMITTER, displayName: 'Submitter', timezone: 'UTC', notificationsEnabled: true },
      { id: RECIPIENT, displayName: 'Recipient', timezone: 'UTC', notificationsEnabled: true },
    ])
    await db.insert(userPushTokens).values({ userId: RECIPIENT, token: TOKEN_A, platform: 'ios' })
  })

  it('sends to the recipient when they have not muted the submitter', async () => {
    await db.insert(friendships).values({
      requesterId: SUBMITTER,
      addresseeId: RECIPIENT,
      status: 'accepted',
      requesterNotifyOfActivity: true,   // submitter's preference (irrelevant here)
      addresseeNotifyOfActivity: true,   // recipient wants to hear
    })
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok' }])

    await service.notifyStudyMates(SUBMITTER, 12)

    expect(mockSendPushNotificationsAsync).toHaveBeenCalledTimes(1)
    const args = mockSendPushNotificationsAsync.mock.calls[0][0]
    expect(args).toHaveLength(1)
    expect(args[0].to).toBe(TOKEN_A)
    expect(args[0].title).toContain('Submitter')
  })

  it('suppresses when recipient has muted on their side (addresseeNotifyOfActivity=false)', async () => {
    await db.insert(friendships).values({
      requesterId: SUBMITTER,
      addresseeId: RECIPIENT,
      status: 'accepted',
      requesterNotifyOfActivity: true,
      addresseeNotifyOfActivity: false,
    })
    await service.notifyStudyMates(SUBMITTER, 12)
    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled()
  })

  it('suppresses when recipient is the requester and has muted (requesterNotifyOfActivity=false)', async () => {
    await db.insert(friendships).values({
      requesterId: RECIPIENT,
      addresseeId: SUBMITTER,
      status: 'accepted',
      requesterNotifyOfActivity: false,  // recipient's side
      addresseeNotifyOfActivity: true,
    })
    await service.notifyStudyMates(SUBMITTER, 12)
    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled()
  })

  it('fires for recipient even if submitter\'s own side is muted — mute is directional', async () => {
    await db.insert(friendships).values({
      requesterId: SUBMITTER,
      addresseeId: RECIPIENT,
      status: 'accepted',
      requesterNotifyOfActivity: false,  // submitter's preference — irrelevant when submitter studied
      addresseeNotifyOfActivity: true,
    })
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok' }])
    await service.notifyStudyMates(SUBMITTER, 12)
    expect(mockSendPushNotificationsAsync).toHaveBeenCalledTimes(1)
  })

  it('still respects notificationsEnabled=false as a master switch', async () => {
    await db.update(userProfiles).set({ notificationsEnabled: false }).where(eq(userProfiles.id, RECIPIENT))
    await db.insert(friendships).values({
      requesterId: SUBMITTER,
      addresseeId: RECIPIENT,
      status: 'accepted',
      requesterNotifyOfActivity: true,
      addresseeNotifyOfActivity: true,
    })
    await service.notifyStudyMates(SUBMITTER, 12)
    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled()
  })

  it('fans out to all of the recipient\'s tokens', async () => {
    await db.insert(userPushTokens).values({ userId: RECIPIENT, token: TOKEN_B, platform: 'android' })
    await db.insert(friendships).values({
      requesterId: SUBMITTER,
      addresseeId: RECIPIENT,
      status: 'accepted',
      requesterNotifyOfActivity: true,
      addresseeNotifyOfActivity: true,
    })
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok' }, { status: 'ok' }])
    await service.notifyStudyMates(SUBMITTER, 12)
    const args = mockSendPushNotificationsAsync.mock.calls[0][0]
    expect(args).toHaveLength(2)
  })
})

describe('sendDailyReminders — multi-device', () => {
  const REMINDER_USER = '00000000-0000-0000-0000-0000000000f4'

  beforeEach(async () => {
    mockSendPushNotificationsAsync.mockReset()
    // Bound the fixture universe: the preceding notifyStudyMates describe
    // leaves SUBMITTER + RECIPIENT (notificationsEnabled=true, default
    // reminderHour=20) in the DB, and RECIPIENT carries two tokens. Without
    // broader cleanup, running this suite at UTC 20:00 would let RECIPIENT
    // qualify for sendDailyReminders and pollute the captured calls.
    await db.execute(sql`
      DELETE FROM user_push_tokens WHERE user_id IN (
        ${USER}, ${REMINDER_USER}, ${SUBMITTER}, ${RECIPIENT}
      )
    `)
    await db.execute(sql`
      DELETE FROM user_profiles WHERE id IN (
        ${USER}, ${REMINDER_USER}, ${SUBMITTER}, ${RECIPIENT}
      )
    `)
  })

  it('fans the reminder out to all of the user\'s tokens', async () => {
    const hourNow = new Date().getUTCHours()
    await db.insert(userProfiles).values({
      id: REMINDER_USER,
      displayName: 'R',
      timezone: 'UTC',
      reminderHour: hourNow,
      notificationsEnabled: true,
    })
    await db.insert(userPushTokens).values([
      { userId: REMINDER_USER, token: TOKEN_A, platform: 'ios' },
      { userId: REMINDER_USER, token: TOKEN_B, platform: 'ios' },
    ])
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok' }, { status: 'ok' }])

    await service.sendDailyReminders()

    const allTos = mockSendPushNotificationsAsync.mock.calls.flatMap((c) => c[0]).map((m: any) => m.to)
    expect(allTos).toEqual(expect.arrayContaining([TOKEN_A, TOKEN_B]))
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${REMINDER_USER}`)
  })
})

describe('sendRestDaySummaries — multi-device', () => {
  const REST_USER = '00000000-0000-0000-0000-0000000000f5'

  beforeEach(async () => {
    mockSendPushNotificationsAsync.mockReset()
    // Same bounded-universe cleanup as sendDailyReminders — keep the fixture
    // state deterministic regardless of what prior describes left behind.
    await db.execute(sql`
      DELETE FROM user_push_tokens WHERE user_id IN (
        ${USER}, ${REST_USER}, ${SUBMITTER}, ${RECIPIENT}
      )
    `)
    await db.execute(sql`
      DELETE FROM user_profiles WHERE id IN (
        ${USER}, ${REST_USER}, ${SUBMITTER}, ${RECIPIENT}
      )
    `)
  })

  it('fans the rest-day summary out to all of the user\'s tokens', async () => {
    const now = new Date()
    const hourNow = now.getUTCHours()
    const weekdayNow = now.getUTCDay()
    await db.insert(userProfiles).values({
      id: REST_USER,
      displayName: 'S',
      timezone: 'UTC',
      reminderHour: hourNow,
      restDay: weekdayNow,
      notificationsEnabled: true,
    })
    await db.insert(userPushTokens).values([
      { userId: REST_USER, token: TOKEN_A, platform: 'ios' },
      { userId: REST_USER, token: TOKEN_B, platform: 'ios' },
    ])
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok' }, { status: 'ok' }])

    await service.sendRestDaySummaries()

    const allTos = mockSendPushNotificationsAsync.mock.calls.flatMap((c) => c[0]).map((m: any) => m.to)
    expect(allTos).toEqual(expect.arrayContaining([TOKEN_A, TOKEN_B]))
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${REST_USER}`)
  })
})
