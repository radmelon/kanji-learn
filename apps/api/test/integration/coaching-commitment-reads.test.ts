import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { CommitmentService } from '../../src/services/buddy/commitment.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const USER = '00000000-0000-0000-0000-0000000000c2'

async function commitment(weekStart: string, source: string, days = 4, minutes = 15) {
  await db.execute(sql`INSERT INTO buddy_commitments
    (user_id, week_start, days_committed, minutes_per_day, source)
    VALUES (${USER}, ${weekStart}, ${days}, ${minutes}, ${source})`)
}

describe('CommitmentService — coaching reads', () => {
  const service = new CommitmentService(db)

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'CoachingCommitFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })

  const wipe = async () => {
    await db.execute(sql`DELETE FROM buddy_commitments WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM daily_stats WHERE user_id = ${USER}`)
  }
  beforeEach(wipe)
  afterAll(async () => {
    await wipe()
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
  })

  it('getSessionDates returns only source=session, newest first', async () => {
    await commitment('2026-07-06', 'session')
    await commitment('2026-07-13', 'rolled_forward')
    await commitment('2026-07-20', 'session')
    await commitment('2026-07-27', 'default')

    expect(await service.getSessionDates(USER)).toEqual(['2026-07-20', '2026-07-06'])
  })

  it('getSessionDates respects the limit', async () => {
    await commitment('2026-07-06', 'session')
    await commitment('2026-07-20', 'session')
    expect(await service.getSessionDates(USER, 1)).toEqual(['2026-07-20'])
  })

  it('returns null when the only commitment period has NOT ended', async () => {
    // The defect this whole rule exists for: at the instant a commitment is
    // agreed, actual is 0 and the promise is unmet, so commitment_gap would
    // score 1.0 x 1.0 x 1.0 -- the maximum any finding can score.
    await commitment('2026-08-01', 'session')
    const result = await service.getLastCompletedPeriod(USER, '2026-08-02T12:00:00.000Z', 1)
    expect(result).toBeNull()
  })

  it('returns the most recent period that HAS ended', async () => {
    await commitment('2026-07-13', 'session')
    await commitment('2026-07-20', 'session')   // ends 2026-07-27
    await commitment('2026-08-01', 'session')   // still running
    const result = await service.getLastCompletedPeriod(USER, '2026-08-02T12:00:00.000Z', 1)
    expect(result!.weekStart).toBe('2026-07-20')
    expect(result!.periodStart).toBe('2026-07-20')
    expect(result!.periodEnd).toBe('2026-07-27')
    expect(result!.promisedMinutes).toBe(60)    // 4 days x 15 minutes
  })

  it('excludes source=default — the learner agreed nothing', async () => {
    await commitment('2026-07-20', 'default')
    const result = await service.getLastCompletedPeriod(USER, '2026-08-02T12:00:00.000Z', 1)
    expect(result).toBeNull()
  })

  it('includes source=rolled_forward', async () => {
    await commitment('2026-07-20', 'rolled_forward')
    const result = await service.getLastCompletedPeriod(USER, '2026-08-02T12:00:00.000Z', 1)
    expect(result!.weekStart).toBe('2026-07-20')
  })

  it('uses intervalWeeks for the period length, not a hardcoded 7', async () => {
    // A fortnightly learner's 2026-07-20 period ends 2026-08-03, so on
    // 2026-08-02 it has NOT completed.
    await commitment('2026-07-20', 'session')
    const weekly = await service.getLastCompletedPeriod(USER, '2026-08-02T12:00:00.000Z', 1)
    const fortnightly = await service.getLastCompletedPeriod(USER, '2026-08-02T12:00:00.000Z', 2)
    expect(weekly).not.toBeNull()
    expect(fortnightly).toBeNull()
  })
})
