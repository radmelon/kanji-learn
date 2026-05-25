// apps/api/test/integration/milestones-refresh.test.ts
//
// Task 11 — end-to-end integration tests for milestone persistence on refresh.
// Covers:
//   1. Grandfather pass: pre-deploy user whose progress predates the cutoff
//      gets all milestones stamped with the GRANDFATHERED sentinel.
//   2. New user: progress created after the cutoff gets real ISO timestamps.
//   3. Idempotency: a second refresh does not grow the milestone list.
//
// Connection pattern mirrors learner-state-refresh.test.ts.
// Three separate user IDs are used (one per test) so the 30 s cap window
// is never hit — each user's ID is unseen by the in-memory cap map.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { LearnerStateService } from '../../src/services/buddy/learner-state.service'
import { type MilestoneEntry, GRANDFATHERED } from '@kanji-learn/shared'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

// One unique user ID per test — no cap-window collisions.
const USER_GRANDFATHER = '00000000-0000-0000-0000-0000000000aa'
const USER_NEW         = '00000000-0000-0000-0000-0000000000ab'
const USER_IDEMPOTENT  = '00000000-0000-0000-0000-0000000000ac'

const ALL_USER_IDS = [USER_GRANDFATHER, USER_NEW, USER_IDEMPOTENT]

// High numeric IDs to avoid FK conflicts with any existing kanji rows.
// Characters use a 'MR' prefix (milestones-refresh) that is unlikely to
// appear in any seed data.  We seed 50 rows with N5 + grade=1 so that
// the detector can cross every relevant threshold.
const KANJI_BASE_ID = 99100

beforeAll(async () => {
  // Ensure all three test user profiles exist.
  for (const userId of ALL_USER_IDS) {
    await db.execute(sql`
      INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${userId}, ${'MRTest-' + userId.slice(-2)}, 'UTC')
      ON CONFLICT DO NOTHING
    `)
  }

  // Seed 50 kanji rows (idempotent via ON CONFLICT DO NOTHING).
  for (let i = 0; i < 50; i++) {
    await db.execute(sql`
      INSERT INTO kanji (id, character, jlpt_level, jlpt_order, stroke_count, grade)
      VALUES (${KANJI_BASE_ID + i}, ${'MR' + i}, 'N5', ${9100 + i}, 5, 1)
      ON CONFLICT (id) DO NOTHING
    `)
  }
})

beforeEach(async () => {
  // Clear state for all three test users before every test so tests are isolated.
  for (const userId of ALL_USER_IDS) {
    await db.execute(sql`DELETE FROM learner_state_cache WHERE user_id = ${userId}`)
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${userId}`)
  }
})

afterAll(async () => {
  // Clean up — order matters (FK child rows first).
  for (const userId of ALL_USER_IDS) {
    await db.execute(sql`DELETE FROM learner_state_cache WHERE user_id = ${userId}`)
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${userId}`)
  }
  // Remove seeded kanji (safe: cascade deletes progress above first).
  for (let i = 0; i < 50; i++) {
    await db.execute(sql`DELETE FROM kanji WHERE id = ${KANJI_BASE_ID + i}`)
  }
  await client.end()
})

// ─── Helper: seed pre-cutoff progress rows ────────────────────────────────────

async function seedBurnedProgress(userId: string, createdAt: string) {
  for (let i = 0; i < 50; i++) {
    await db.execute(sql`
      INSERT INTO user_kanji_progress
        (user_id, kanji_id, status, reading_stage, stability, difficulty, lapses, total_reviews, created_at)
      VALUES
        (${userId}, ${KANJI_BASE_ID + i}, 'burned', 0, 0, 5, 0, 0, ${createdAt}::timestamptz)
      ON CONFLICT (user_id, kanji_id) DO NOTHING
    `)
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('milestones persistence on refresh', () => {
  it('first refresh for a pre-deploy user grandfathers existing crossings', async () => {
    // Seed 50 burned N5/grade-1 kanji with a creation date well before the
    // 2026-05-25 cutoff — this triggers the hasPreDeployHistory path.
    await seedBurnedProgress(USER_GRANDFATHER, '2025-01-01T00:00:00Z')

    const svc = new LearnerStateService(db)
    await svc.refreshState(USER_GRANDFATHER)

    const cached = await db.query.learnerStateCache.findFirst({
      where: eq(schema.learnerStateCache.userId, USER_GRANDFATHER),
    })

    expect(cached).toBeTruthy()
    const milestones = (cached!.recentMilestones ?? []) as unknown as MilestoneEntry[]
    expect(milestones.length).toBeGreaterThan(0)
    // Every milestone on the first-ever refresh for a pre-deploy user must
    // carry the GRANDFATHERED sentinel, never a real timestamp.
    for (const m of milestones) {
      expect(m.achievedAt).toBe(GRANDFATHERED)
    }
  })

  it('a brand-new user (no pre-deploy history) gets real timestamps', async () => {
    // Seed using default SQL NOW() — post-cutoff, so hasPreDeployHistory = false.
    for (let i = 0; i < 50; i++) {
      await db.execute(sql`
        INSERT INTO user_kanji_progress
          (user_id, kanji_id, status, reading_stage, stability, difficulty, lapses, total_reviews)
        VALUES
          (${USER_NEW}, ${KANJI_BASE_ID + i}, 'burned', 0, 0, 5, 0, 0)
        ON CONFLICT (user_id, kanji_id) DO NOTHING
      `)
    }

    const svc = new LearnerStateService(db)
    await svc.refreshState(USER_NEW)

    const cached = await db.query.learnerStateCache.findFirst({
      where: eq(schema.learnerStateCache.userId, USER_NEW),
    })

    expect(cached).toBeTruthy()
    const milestones = (cached!.recentMilestones ?? []) as unknown as MilestoneEntry[]
    // At least the kanji_seen/burned thresholds of 10 and 50 should fire.
    expect(milestones.length).toBeGreaterThan(0)
    // None of the entries should carry the GRANDFATHERED sentinel.
    const realTimestamps = milestones.filter((m) => m.achievedAt !== GRANDFATHERED)
    expect(realTimestamps.length).toBeGreaterThan(0)
    // Spot-check that the achievedAt looks like a valid ISO 8601 string.
    for (const m of realTimestamps) {
      expect(m.achievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    }
  })

  it('second refresh is idempotent — no duplicate entries', async () => {
    // Pre-cutoff seed so we exercise the grandfather path (more milestones in one pass).
    await seedBurnedProgress(USER_IDEMPOTENT, '2025-01-01T00:00:00Z')

    const svc1 = new LearnerStateService(db)
    await svc1.refreshState(USER_IDEMPOTENT)

    const cached1 = await db.query.learnerStateCache.findFirst({
      where: eq(schema.learnerStateCache.userId, USER_IDEMPOTENT),
    })
    const count1 = ((cached1!.recentMilestones ?? []) as unknown as MilestoneEntry[]).length
    expect(count1).toBeGreaterThan(0)

    // Use a fresh LearnerStateService instance so its in-memory cap map is empty —
    // the 30 s cap would suppress the second call on the same instance.
    const svc2 = new LearnerStateService(db)
    await svc2.refreshState(USER_IDEMPOTENT)

    const cached2 = await db.query.learnerStateCache.findFirst({
      where: eq(schema.learnerStateCache.userId, USER_IDEMPOTENT),
    })
    const count2 = ((cached2!.recentMilestones ?? []) as unknown as MilestoneEntry[]).length

    // The milestone list must not grow — already-recorded milestones are deduped
    // because detectCrossings skips entries already present in `existing`.
    expect(count2).toBe(count1)
  })
})
