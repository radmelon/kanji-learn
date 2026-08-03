import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { levelBands, inferredLevel, JLPT_LEVELS, type JlptLevel } from '@kanji-learn/shared'
import { CoachingService } from '../../src/services/buddy/coaching.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const USER = '00000000-0000-0000-0000-0000000000c3'
/** Second fixture learner -- only used where a test needs two independent
 *  completed sessions to compare against each other (same-user sessions
 *  collapse to `latest`/`previous`, which isn't what those tests need). */
const WIDE_USER = '00000000-0000-0000-0000-0000000000c4'
const NOW = '2026-08-02T12:00:00.000Z'

/** JLPT difficulty order, N5 (easiest) .. N1 (hardest) -- alphabetical order
 *  is NOT difficulty order, so bracket/width comparisons rank through this
 *  map rather than comparing the strings directly. */
const LEVEL_RANK: Record<JlptLevel, number> = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4 }

/** The local test DB holds ~2,286 kanji; never hardcode ids. */
async function kanjiIds(n: number): Promise<number[]> {
  const rows = await db.execute(sql`SELECT id FROM kanji ORDER BY id LIMIT ${n}`)
  return rows.map((r: any) => Number(r.id))
}

/**
 * The same corpus levelInterval() reads (kanji_difficulty joined to kanji's
 * jlpt_level), reduced to bands with the shared pure function. Used to make
 * a fixture's `inferred_level` consistent with what the real corpus says a
 * given theta means, so the bracket test below checks real behaviour
 * instead of a hardcoded literal that may not match today's corpus stats.
 */
async function corpusLevelBands() {
  const rows = await db.execute(sql`
    SELECT kd.b AS b, k.jlpt_level AS level
    FROM kanji_difficulty kd
    JOIN kanji k ON k.id = kd.kanji_id
  `)
  return levelBands(
    rows.map((r: any) => ({ b: Number(r.b), level: r.level as JlptLevel | null })),
    JLPT_LEVELS,
  )
}

describe('CoachingService.assembleSnapshot — placement', () => {
  const service = new CoachingService(db)

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'CoachingSnapshotFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${WIDE_USER}, 'CoachingSnapshotFixtureWide', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })

  const wipe = async () => {
    await db.execute(sql`DELETE FROM placement_sessions WHERE user_id IN (${USER}, ${WIDE_USER})`)
  }
  beforeEach(wipe)
  afterAll(async () => {
    await wipe()
    await db.execute(sql`DELETE FROM user_profiles WHERE id IN (${USER}, ${WIDE_USER})`)
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

  it('levelLow and levelHigh bracket level in JLPT order', async () => {
    // `level` alone is a bare label; `levelLow`/`levelHigh` are what make
    // level_estimate defensible (PlacementSnapshot's own contract comment).
    // No committed test read either field before this one. `level` is set
    // to whatever the real corpus says `theta` means, via the same shared
    // banding function the service uses, so the bracket check exercises
    // real behaviour rather than a hardcoded literal that may not match
    // today's corpus stats.
    const bands = await corpusLevelBands()
    const theta = 0.5
    const se = 0.4
    const level = inferredLevel(theta, bands.boundaries, bands.levels)

    await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${USER}, ${theta}, ${se}, ${level}, now())`)

    const snap = await service.assembleSnapshot(USER, NOW, [])
    const p = snap.placement!

    expect(LEVEL_RANK[p.levelLow]).toBeLessThanOrEqual(LEVEL_RANK[p.level])
    expect(LEVEL_RANK[p.levelHigh]).toBeGreaterThanOrEqual(LEVEL_RANK[p.level])
    for (const lvl of [p.levelLow, p.level, p.levelHigh]) {
      expect(JLPT_LEVELS).toContain(lvl)
    }
  })

  it('a larger ability_se produces a credible interval at least as wide', async () => {
    // Same theta, two learners, only ability_se differs -- isolates se's
    // effect on both the theta interval and the level labels at its ends.
    // Same-user sessions won't do here: assembleSnapshot only ever exposes
    // levelLow/levelHigh for the LATEST session, so comparing two se values
    // needs two independently "latest" sessions, i.e. two learners.
    const theta = 0
    await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${USER}, ${theta}, 0.1, 'N3', now())`)
    await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${WIDE_USER}, ${theta}, 1.0, 'N3', now())`)

    const narrow = (await service.assembleSnapshot(USER, NOW, [])).placement!
    const wide = (await service.assembleSnapshot(WIDE_USER, NOW, [])).placement!

    expect(wide.thetaHigh - wide.thetaLow).toBeGreaterThan(narrow.thetaHigh - narrow.thetaLow)
    // "At least as wide" in rank terms: the wide interval's low end must be
    // the same JLPT level or easier, and its high end the same or harder.
    expect(LEVEL_RANK[wide.levelLow]).toBeLessThanOrEqual(LEVEL_RANK[narrow.levelLow])
    expect(LEVEL_RANK[wide.levelHigh]).toBeGreaterThanOrEqual(LEVEL_RANK[narrow.levelHigh])
    for (const lvl of [narrow.levelLow, narrow.levelHigh, wide.levelLow, wide.levelHigh]) {
      expect(JLPT_LEVELS).toContain(lvl)
    }
  })

  // `level` is non-nullable on PlacementSnapshot's contract (coaching.service.ts's
  // own comment: "inventing one would be worse than staying silent"), so a
  // completed session that never resolved theta/se/level must collapse the
  // WHOLE placement to null rather than embed a null into a typed field.
  // Every INSERT elsewhere in this file supplies concrete non-null values,
  // so this guard was previously never exercised by the committed suite.

  it('returns placement: null when ability_theta is null on a completed session', async () => {
    await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${USER}, NULL, 0.4, 'N4', now())`)
    const snap = await service.assembleSnapshot(USER, NOW, [])
    expect(snap.placement).toBeNull()
  })

  it('returns placement: null when ability_se is null on a completed session', async () => {
    await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${USER}, 0.5, NULL, 'N4', now())`)
    const snap = await service.assembleSnapshot(USER, NOW, [])
    expect(snap.placement).toBeNull()
  })

  it('returns placement: null when inferred_level is null on a completed session', async () => {
    await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${USER}, 0.5, 0.4, NULL, now())`)
    const snap = await service.assembleSnapshot(USER, NOW, [])
    expect(snap.placement).toBeNull()
  })
})
