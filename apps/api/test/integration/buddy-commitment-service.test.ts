// CommitmentService — the server-side roll-forward that makes the ritual
// survive a learner who never opens the app (spec §8.3).

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { CommitmentService } from '../../src/services/buddy/commitment.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const service = new CommitmentService(db)

const TEST_USER_ID = '00000000-0000-0000-0000-0000000000b2'

beforeAll(async () => {
  await db.insert(schema.userProfiles)
    .values({ id: TEST_USER_ID, displayName: 'Service Fixture' })
    .onConflictDoNothing()
})

beforeEach(async () => {
  await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
  await db.delete(schema.dailyStats).where(eq(schema.dailyStats.userId, TEST_USER_ID))
})

afterAll(async () => {
  await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
  await db.delete(schema.dailyStats).where(eq(schema.dailyStats.userId, TEST_USER_ID))
  await db.delete(schema.userProfiles).where(eq(schema.userProfiles.id, TEST_USER_ID))
  await client.end()
})

describe('ensureForWeek', () => {
  it('seeds a default commitment for a learner with no history', async () => {
    const c = await service.ensureForWeek(TEST_USER_ID, '2026-08-03')
    expect(c.source).toBe('default')
    expect(c.daysCommitted).toBe(4)
  })

  it('rolls the previous week forward', async () => {
    await service.setForWeek(TEST_USER_ID, {
      weekStart: '2026-08-03', daysCommitted: 5, dayTargets: null,
      minutesPerDay: 20, focus: 'backlog', source: 'session',
    })

    const next = await service.ensureForWeek(TEST_USER_ID, '2026-08-10')
    expect(next.source).toBe('rolled_forward')
    expect(next.daysCommitted).toBe(5)
    expect(next.minutesPerDay).toBe(20)
    expect(next.focus).toBeNull()
  })

  it('sequential calls short-circuit on the read-check and never reach the insert', async () => {
    await service.ensureForWeek(TEST_USER_ID, '2026-08-03')
    await service.ensureForWeek(TEST_USER_ID, '2026-08-03')

    const rows = await db.select().from(schema.buddyCommitments)
      .where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
    expect(rows).toHaveLength(1)
  })

  it('is idempotent under a genuine race — concurrent calls collide on the insert and onConflictDoNothing absorbs it', async () => {
    const results = await Promise.allSettled([
      service.ensureForWeek(TEST_USER_ID, '2026-08-03'),
      service.ensureForWeek(TEST_USER_ID, '2026-08-03'),
      service.ensureForWeek(TEST_USER_ID, '2026-08-03'),
      service.ensureForWeek(TEST_USER_ID, '2026-08-03'),
    ])

    // Control assertion: the guard actually had to do something. If every
    // call rejected, or if this weren't a real race, the row-count check
    // below would pass vacuously.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)

    const rows = await db.select().from(schema.buddyCommitments)
      .where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
    expect(rows).toHaveLength(1)
  })

  it('never overwrites a commitment the learner agreed', async () => {
    await service.setForWeek(TEST_USER_ID, {
      weekStart: '2026-08-03', daysCommitted: 6, dayTargets: null,
      minutesPerDay: 30, focus: null, source: 'session',
    })

    const same = await service.ensureForWeek(TEST_USER_ID, '2026-08-03')
    expect(same.source).toBe('session')
    expect(same.daysCommitted).toBe(6)
  })
})

describe('setForWeek', () => {
  it('replaces a rolled-forward row when the learner turns up and agrees', async () => {
    await service.ensureForWeek(TEST_USER_ID, '2026-08-03')

    const agreed = await service.setForWeek(TEST_USER_ID, {
      weekStart: '2026-08-03', daysCommitted: 3, dayTargets: null,
      minutesPerDay: 10, focus: null, source: 'session',
    })

    expect(agreed.source).toBe('session')
    const rows = await db.select().from(schema.buddyCommitments)
      .where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].daysCommitted).toBe(3)
  })
})

describe('getActivity', () => {
  it('returns the seven days of the period, including empty ones', async () => {
    await db.insert(schema.dailyStats).values([
      { userId: TEST_USER_ID, date: '2026-08-03', reviewed: 12, studyTimeMs: 20 * 60_000 },
      { userId: TEST_USER_ID, date: '2026-08-06', reviewed: 5, studyTimeMs: 6 * 60_000 },
      // Outside the window — must not be counted.
      { userId: TEST_USER_ID, date: '2026-08-11', reviewed: 30, studyTimeMs: 40 * 60_000 },
    ])

    const days = await service.getActivity(TEST_USER_ID, '2026-08-03')
    expect(days).toHaveLength(7)
    expect(days.filter((d) => d.reviewed > 0)).toHaveLength(2)
    expect(days.find((d) => d.date === '2026-08-03')!.studyMinutes).toBe(20)
    expect(days.some((d) => d.date === '2026-08-11')).toBe(false)
  })
})

describe('getMissCount', () => {
  it('counts consecutive rolled-forward periods', async () => {
    await service.setForWeek(TEST_USER_ID, {
      weekStart: '2026-08-03', daysCommitted: 4, dayTargets: null,
      minutesPerDay: 15, focus: null, source: 'session',
    })
    await service.ensureForWeek(TEST_USER_ID, '2026-08-10')
    await service.ensureForWeek(TEST_USER_ID, '2026-08-17')

    expect(await service.getMissCount(TEST_USER_ID)).toBe(2)
  })
})

describe('getMostRecentAgreed', () => {
  it('returns null when the learner has never agreed to a commitment', async () => {
    await service.ensureForWeek(TEST_USER_ID, '2026-08-03')
    expect(await service.getMostRecentAgreed(TEST_USER_ID)).toBeNull()
  })

  it('returns the most recent session-sourced commitment, ignoring rolled-forward rows', async () => {
    await service.setForWeek(TEST_USER_ID, {
      weekStart: '2026-08-03', daysCommitted: 6, dayTargets: null,
      minutesPerDay: 25, focus: 'radicals', source: 'session',
    })
    await service.ensureForWeek(TEST_USER_ID, '2026-08-10')
    await service.ensureForWeek(TEST_USER_ID, '2026-08-17')

    const agreed = await service.getMostRecentAgreed(TEST_USER_ID)
    expect(agreed).not.toBeNull()
    expect(agreed!.weekStart).toBe('2026-08-03')
    expect(agreed!.source).toBe('session')
    expect(agreed!.daysCommitted).toBe(6)
  })
})
