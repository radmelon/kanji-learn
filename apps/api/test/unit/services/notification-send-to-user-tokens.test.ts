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
import { userPushTokens, userProfiles } from '@kanji-learn/db'

// Mock the Expo SDK before importing NotificationService — the service
// module-level `new Expo()` will pick up this fake class. `vi.hoisted` is
// required because `vi.mock` factories are hoisted above top-level `const`s,
// so a plain `const mockFn = vi.fn()` would be TDZ-accessed by the factory.
const { mockSendPushNotificationsAsync } = vi.hoisted(() => ({
  mockSendPushNotificationsAsync: vi.fn(),
}))
vi.mock('expo-server-sdk', () => ({
  Expo: class {
    sendPushNotificationsAsync = mockSendPushNotificationsAsync
    // The real SDK chunks into groups of 100; our tests stay well under that
    // limit, so identity-chunking keeps the assertions on call count simple.
    chunkPushNotifications = (messages: unknown[]) => [messages]
    static isExpoPushToken = (t: string) => /^ExponentPushToken\[.+\]$/.test(t)
  },
}))

import { NotificationService } from '../../../src/services/notification.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const service = new NotificationService(db)

const USER = '00000000-0000-0000-0000-0000000000f1'
const TOKEN_A = 'ExponentPushToken[aaa]'
const TOKEN_B = 'ExponentPushToken[bbb]'
const TOKEN_C = 'ExponentPushToken[ccc]'

beforeEach(async () => {
  mockSendPushNotificationsAsync.mockReset()
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
      { status: 'ok' }, { status: 'ok' }, { status: 'ok' },
    ])

    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b', sound: 'default' })

    expect(mockSendPushNotificationsAsync).toHaveBeenCalledTimes(1)
    const args = mockSendPushNotificationsAsync.mock.calls[0][0]
    expect(args).toHaveLength(3)
    expect(args.map((m: any) => m.to)).toEqual(expect.arrayContaining([TOKEN_A, TOKEN_B, TOKEN_C]))
    expect(args.every((m: any) => m.title === 't' && m.body === 'b')).toBe(true)
    expect(result).toEqual({ sent: 3, pruned: 0 })
  })

  it('returns { sent: 0, pruned: 0 } and skips the Expo call when the user has no tokens', async () => {
    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b' })
    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled()
    expect(result).toEqual({ sent: 0, pruned: 0 })
  })

  it('prunes rows that ticket with DeviceNotRegistered', async () => {
    await db.insert(userPushTokens).values([
      { userId: USER, token: TOKEN_A, platform: 'ios' },
      { userId: USER, token: TOKEN_B, platform: 'ios' },
    ])
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: 'ok' },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
    ])

    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b' })

    expect(result).toEqual({ sent: 2, pruned: 1 })
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
