// apps/api/test/integration/nudge-rule-engine.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { NudgeService } from '../../src/services/buddy/nudge.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER_A = '00000000-0000-0000-0000-0000000000b1'

// Stub NotificationService — never fires real push in these tests.
const stubNotifier = { sendBuddyNudgePush: async () => {} } as any

beforeAll(async () => {
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES (${USER_A}, 'NudgeRuleTest', 'UTC') ON CONFLICT DO NOTHING
  `)
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM buddy_nudges WHERE user_id = ${USER_A}`)
  await db.execute(sql`DELETE FROM learner_state_cache WHERE user_id = ${USER_A}`)
})

afterAll(async () => {
  await client.end()
})

async function seedCacheState(streakDays: number) {
  await db.execute(sql`
    INSERT INTO learner_state_cache
      (user_id, updated_at, current_streak_days, longest_streak_days,
       velocity_trend, total_kanji_seen, total_kanji_burned, active_leech_count,
       leech_kanji_ids, weakest_modality, recent_accuracy,
       avg_daily_reviews, avg_session_duration_ms, days_since_last_session,
       days_since_first_session, quiz_vs_srs_gap_high, recent_milestones,
       study_patterns, buddy_mood, scaffold_level, friends_count,
       active_friends_today, friends_ahead_on_burn, friends_behind_on_burn,
       friends_ahead_on_streak, friends_behind_on_streak,
       user_strengths_vs_friends, device_distribution)
    VALUES (${USER_A}, NOW(), ${streakDays}, ${streakDays},
      'steady', 100, 10, 0, '[]'::jsonb, 'meaning', 0.85,
      5, 120000, 0, 30, false, '[]'::jsonb, '{}'::jsonb,
      'supportive', 'medium', 0, 0,
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      '{}'::jsonb, '{}'::jsonb)
    ON CONFLICT (user_id) DO UPDATE SET current_streak_days = EXCLUDED.current_streak_days
  `)
}

describe('NudgeService — streak rule', () => {
  it('inserts a streak row on milestone day (pull path)', async () => {
    await seedCacheState(7)
    const service = new NudgeService(db, stubNotifier)

    const nudges = await service.evaluateNudgesForScreen(USER_A, 'dashboard')

    // Both streak and Meet Buddy fire on Dashboard for a brand-new user on
    // a milestone day. The Task 4 "stack priority" test pins the ordering;
    // here we focus on the streak row's contents using find().
    const streak = nudges.find((n) => n.nudgeType === 'streak')
    expect(streak).toBeDefined()
    expect((streak?.actionPayload as any)?.milestone).toBe(7)
    expect(streak?.content).toBe('A full week. Buddy noticed.')
  })

  it('does not insert a streak row on a non-milestone day', async () => {
    await seedCacheState(5)
    const service = new NudgeService(db, stubNotifier)
    const nudges = await service.evaluateNudgesForScreen(USER_A, 'dashboard')
    // Dashboard still returns the Meet Buddy nudge; just no streak row.
    expect(nudges.filter((n) => n.nudgeType === 'streak')).toHaveLength(0)
  })

  it('dedupes: a second evaluate on the same milestone returns the same streak row', async () => {
    await seedCacheState(7)
    const service = new NudgeService(db, stubNotifier)
    const first = await service.evaluateNudgesForScreen(USER_A, 'dashboard')
    const second = await service.evaluateNudgesForScreen(USER_A, 'dashboard')
    const firstStreak = first.filter((n) => n.nudgeType === 'streak')
    const secondStreak = second.filter((n) => n.nudgeType === 'streak')
    expect(firstStreak).toHaveLength(1)
    expect(secondStreak).toHaveLength(1)
    expect(firstStreak[0]?.id).toBe(secondStreak[0]?.id)
  })

  it('inserts mirror streak row on Study Ready independently', async () => {
    await seedCacheState(7)
    const service = new NudgeService(db, stubNotifier)
    const dashRows = await service.evaluateNudgesForScreen(USER_A, 'dashboard')
    const studyRows = await service.evaluateNudgesForScreen(USER_A, 'study')
    const dashStreak = dashRows.filter((n) => n.nudgeType === 'streak')
    const studyStreak = studyRows.filter((n) => n.nudgeType === 'streak')
    expect(dashStreak).toHaveLength(1)
    expect(studyStreak).toHaveLength(1)
    expect(dashStreak[0]?.id).not.toBe(studyStreak[0]?.id)
  })

  it('does NOT fire on the Progress screen', async () => {
    await seedCacheState(7)
    const service = new NudgeService(db, stubNotifier)
    const rows = await service.evaluateNudgesForScreen(USER_A, 'progress')
    expect(rows).toHaveLength(0)
  })

  it('handles concurrent inserts cleanly (partial unique index enforces dedupe)', async () => {
    await seedCacheState(7)
    const service = new NudgeService(db, stubNotifier)
    const [a, b] = await Promise.all([
      service.evaluateNudgesForScreen(USER_A, 'dashboard'),
      service.evaluateNudgesForScreen(USER_A, 'dashboard'),
    ])
    const aStreak = a.filter((n) => n.nudgeType === 'streak')
    const bStreak = b.filter((n) => n.nudgeType === 'streak')
    expect(aStreak).toHaveLength(1)
    expect(bStreak).toHaveLength(1)
    expect(aStreak[0]?.id).toBe(bStreak[0]?.id)
  })
})

describe('NudgeService — Meet Buddy rule', () => {
  it('inserts a meet-buddy row on first dashboard request', async () => {
    await seedCacheState(0)
    const service = new NudgeService(db, stubNotifier)
    const rows = await service.evaluateNudgesForScreen(USER_A, 'dashboard')
    expect(rows.some((r) => r.nudgeType === 'encouragement')).toBe(true)
  })

  it('dedupes meet-buddy across requests', async () => {
    await seedCacheState(0)
    const service = new NudgeService(db, stubNotifier)
    await service.evaluateNudgesForScreen(USER_A, 'dashboard')
    const second = await service.evaluateNudgesForScreen(USER_A, 'dashboard')
    const mb = second.filter((r) => r.nudgeType === 'encouragement')
    expect(mb).toHaveLength(1)
  })

  it('does NOT fire on Study Ready or Progress', async () => {
    await seedCacheState(0)
    const service = new NudgeService(db, stubNotifier)
    const study = await service.evaluateNudgesForScreen(USER_A, 'study')
    const progress = await service.evaluateNudgesForScreen(USER_A, 'progress')
    expect(study.some((r) => r.nudgeType === 'encouragement')).toBe(false)
    expect(progress.some((r) => r.nudgeType === 'encouragement')).toBe(false)
  })

  it('stack priority: Meet Buddy comes before streak on Dashboard', async () => {
    await seedCacheState(7)
    const service = new NudgeService(db, stubNotifier)
    const rows = await service.evaluateNudgesForScreen(USER_A, 'dashboard')
    expect(rows[0]?.nudgeType).toBe('encouragement')
    expect(rows[1]?.nudgeType).toBe('streak')
  })
})
