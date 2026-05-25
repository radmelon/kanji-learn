// apps/api/test/integration/buddy-push-trigger.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { NudgeService, type BuddyNotifier } from '../../src/services/buddy/nudge.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER_A = '00000000-0000-0000-0000-0000000000d1'

beforeAll(async () => {
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES (${USER_A}, 'PushTriggerTest', 'UTC') ON CONFLICT DO NOTHING
  `)
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM buddy_nudges WHERE user_id = ${USER_A}`)
})

afterAll(async () => {
  await client.end()
})

describe('NudgeService.maybeFireMilestoneNudges (push path)', () => {
  it('inserts dashboard row + fires push on milestone day', async () => {
    const spy = vi.fn().mockResolvedValue(undefined)
    const notifier: BuddyNotifier = { sendBuddyNudgePush: spy }
    const service = new NudgeService(db, notifier)

    await service.maybeFireMilestoneNudges(USER_A, { currentStreakDays: 30 })

    expect(spy).toHaveBeenCalledTimes(1)
    const inserted = await db.execute(
      sql`SELECT screen, nudge_type FROM buddy_nudges WHERE user_id = ${USER_A}`,
    )
    const rows = inserted as unknown as Array<{ screen: string; nudge_type: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0].screen).toBe('dashboard')
    expect(rows[0].nudge_type).toBe('streak')
  })

  it('does not fire on non-milestone days', async () => {
    const spy = vi.fn().mockResolvedValue(undefined)
    const notifier: BuddyNotifier = { sendBuddyNudgePush: spy }
    const service = new NudgeService(db, notifier)

    await service.maybeFireMilestoneNudges(USER_A, { currentStreakDays: 4 })
    expect(spy).not.toHaveBeenCalled()
  })

  it('does not double-fire if milestone already recorded', async () => {
    const spy = vi.fn().mockResolvedValue(undefined)
    const notifier: BuddyNotifier = { sendBuddyNudgePush: spy }
    const service = new NudgeService(db, notifier)

    await service.maybeFireMilestoneNudges(USER_A, { currentStreakDays: 30 })
    spy.mockClear()
    await service.maybeFireMilestoneNudges(USER_A, { currentStreakDays: 30 })

    expect(spy).not.toHaveBeenCalled()
  })
})
