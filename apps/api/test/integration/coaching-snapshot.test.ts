import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { CoachingService } from '../../src/services/buddy/coaching.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const USER = '00000000-0000-0000-0000-0000000000c3'
const NOW = '2026-08-02T12:00:00.000Z'

/** The local test DB holds 7 kanji; never hardcode ids. */
async function kanjiIds(n: number): Promise<number[]> {
  const rows = await db.execute(sql`SELECT id FROM kanji ORDER BY id LIMIT ${n}`)
  return rows.map((r: any) => Number(r.id))
}

describe('CoachingService.assembleSnapshot — placement', () => {
  const service = new CoachingService(db)

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'CoachingSnapshotFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })

  const wipe = async () => {
    await db.execute(sql`DELETE FROM placement_sessions WHERE user_id = ${USER}`)
  }
  beforeEach(wipe)
  afterAll(async () => {
    await wipe()
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
  })

  it('returns placement: null when the learner has never completed one', async () => {
    const snap = await service.assembleSnapshot(USER, NOW, [])
    expect(snap.placement).toBeNull()
    expect(snap.now).toBe(NOW)
  })

  it('ignores an INCOMPLETE placement session', async () => {
    await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level)
      VALUES (${USER}, 0.5, 0.4, 'N4')`)
    const snap = await service.assembleSnapshot(USER, NOW, [])
    expect(snap.placement).toBeNull()
  })

  it('builds the snapshot from the latest completed session', async () => {
    const [k1, k2] = await kanjiIds(2)
    const rows = await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${USER}, 0.5, 0.4, 'N4', now()) RETURNING id`)
    const sessionId = (rows[0] as any).id

    await db.execute(sql`INSERT INTO placement_results
      (session_id, kanji_id, jlpt_level, passed, meaning_correct, reading_correct, difficulty_at_ask)
      VALUES (${sessionId}, ${k1}, 'N5', true, true, false, 0.8),
             (${sessionId}, ${k2}, 'N5', true, true, NULL, 1.2)`)

    const snap = await service.assembleSnapshot(USER, NOW, [])
    expect(snap.placement).not.toBeNull()
    expect(snap.placement!.theta).toBeCloseTo(0.5)
    expect(snap.placement!.se).toBeCloseTo(0.4)
    expect(snap.placement!.level).toBe('N4')
    expect(snap.placement!.previous).toBeNull()
    expect(snap.placement!.items).toHaveLength(2)

    const item = snap.placement!.items.find((i) => i.kanjiId === k1)!
    expect(item.meaningCorrect).toBe(true)
    expect(item.readingCorrect).toBe(false)
    expect(item.difficultyAtAsk).toBeCloseTo(0.8)
    expect(typeof item.character).toBe('string')

    // readingCorrect must stay NULL when the reading half was not asked --
    // the contract says "null when the reading half was not asked for this
    // item", and coercing it to false would invent a wrong answer.
    expect(snap.placement!.items.find((i) => i.kanjiId === k2)!.readingCorrect).toBeNull()
  })

  it('the credible interval brackets theta', async () => {
    await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${USER}, 0.5, 0.4, 'N4', now())`)
    const snap = await service.assembleSnapshot(USER, NOW, [])
    expect(snap.placement!.thetaLow).toBeLessThan(0.5)
    expect(snap.placement!.thetaHigh).toBeGreaterThan(0.5)
  })

  it('populates `previous` from the session before the latest', async () => {
    await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${USER}, 0.1, 0.6, 'N5', now() - interval '30 days')`)
    await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${USER}, 0.5, 0.4, 'N4', now())`)

    const snap = await service.assembleSnapshot(USER, NOW, [])
    expect(snap.placement!.theta).toBeCloseTo(0.5)
    expect(snap.placement!.previous).not.toBeNull()
    expect(snap.placement!.previous!.theta).toBeCloseTo(0.1)
  })

  it('passes priorFindings straight through', async () => {
    const priors = [{ kind: 'leech' as const, since: '2026-07-01', lastRaisedAt: '2026-07-20' }]
    const snap = await service.assembleSnapshot(USER, NOW, priors)
    expect(snap.priorFindings).toEqual(priors)
  })
})
