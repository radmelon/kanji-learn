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

describe('CoachingService.assembleSnapshot — reviews', () => {
  const service = new CoachingService(db)
  const USER_R = '00000000-0000-0000-0000-0000000000c4'
  let sessionId: string

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER_R}, 'CoachingReviewFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })

  const wipe = async () => {
    await db.execute(sql`DELETE FROM review_logs WHERE user_id = ${USER_R}`)
    await db.execute(sql`DELETE FROM review_sessions WHERE user_id = ${USER_R}`)
    await db.execute(sql`DELETE FROM kl_test_results WHERE user_id = ${USER_R}`)
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${USER_R}`)
  }
  beforeEach(async () => {
    await wipe()
    const rows = await db.execute(sql`INSERT INTO review_sessions (user_id)
      VALUES (${USER_R}) RETURNING id`)
    sessionId = (rows[0] as any).id
  })
  afterAll(async () => {
    await wipe()
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER_R}`)
  })

  it('excludes unseen cards', async () => {
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status)
      VALUES (${USER_R}, ${k1}, 'unseen')`)
    const snap = await service.assembleSnapshot(USER_R, NOW, [])
    expect(snap.reviews.cards).toHaveLength(0)
  })

  it('carries status, lapses and reading stage', async () => {
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress
      (user_id, kanji_id, status, lapses, reading_stage)
      VALUES (${USER_R}, ${k1}, 'learning', 3, 2)`)
    const snap = await service.assembleSnapshot(USER_R, NOW, [])
    expect(snap.reviews.cards).toHaveLength(1)
    expect(snap.reviews.cards[0]).toMatchObject({
      kanjiId: k1, status: 'learning', lapses: 3, readingStage: 2,
    })
  })

  it('splits response time and accuracy into early and late halves', async () => {
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status)
      VALUES (${USER_R}, ${k1}, 'learning')`)
    // Early half: 20 days ago, slow and wrong. Late half: 2 days ago, fast and right.
    await db.execute(sql`INSERT INTO review_logs
      (session_id, user_id, kanji_id, review_type, quality, response_time_ms,
       prev_status, next_status, prev_interval, next_interval, reviewed_at)
      VALUES
       (${sessionId}, ${USER_R}, ${k1}, 'meaning', 1, 20000, 'learning', 'learning', 0, 1, now() - interval '20 days'),
       (${sessionId}, ${USER_R}, ${k1}, 'meaning', 5,  5000, 'learning', 'remembered', 1, 3, now() - interval '2 days')`)

    const card = (await service.assembleSnapshot(USER_R, NOW, [])).reviews.cards[0]
    expect(card.responseMsEarly).toBeCloseTo(20000)
    expect(card.responseMsLate).toBeCloseTo(5000)
    expect(card.accuracyEarly).toBeCloseTo(0)   // quality 1 is a fail
    expect(card.accuracyLate).toBeCloseTo(1)    // quality 5 is a pass
  })

  it('counts a Hard (3) as a FAIL, matching hook-coverage STRUGGLE_QUALITY', async () => {
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status)
      VALUES (${USER_R}, ${k1}, 'learning')`)
    await db.execute(sql`INSERT INTO review_logs
      (session_id, user_id, kanji_id, review_type, quality, response_time_ms,
       prev_status, next_status, prev_interval, next_interval, reviewed_at)
      VALUES (${sessionId}, ${USER_R}, ${k1}, 'meaning', 3, 9000, 'learning', 'learning', 0, 1, now() - interval '2 days')`)
    const card = (await service.assembleSnapshot(USER_R, NOW, [])).reviews.cards[0]
    expect(card.accuracyLate).toBeCloseTo(0)
  })

  it('leaves a half null when it holds no reviews', async () => {
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status)
      VALUES (${USER_R}, ${k1}, 'learning')`)
    await db.execute(sql`INSERT INTO review_logs
      (session_id, user_id, kanji_id, review_type, quality, response_time_ms,
       prev_status, next_status, prev_interval, next_interval, reviewed_at)
      VALUES (${sessionId}, ${USER_R}, ${k1}, 'meaning', 4, 8000, 'learning', 'learning', 0, 1, now() - interval '2 days')`)
    const card = (await service.assembleSnapshot(USER_R, NOW, [])).reviews.cards[0]
    expect(card.responseMsEarly).toBeNull()
    expect(card.responseMsLate).toBeCloseTo(8000)
  })

  it('ignores reviews older than the window', async () => {
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status)
      VALUES (${USER_R}, ${k1}, 'learning')`)
    await db.execute(sql`INSERT INTO review_logs
      (session_id, user_id, kanji_id, review_type, quality, response_time_ms,
       prev_status, next_status, prev_interval, next_interval, reviewed_at)
      VALUES (${sessionId}, ${USER_R}, ${k1}, 'meaning', 4, 8000, 'learning', 'learning', 0, 1, now() - interval '90 days')`)
    const card = (await service.assembleSnapshot(USER_R, NOW, [])).reviews.cards[0]
    expect(card.recentQualities).toEqual([])
    expect(card.responseMsEarly).toBeNull()
    expect(card.responseMsLate).toBeNull()
  })

  it('counts remembered to learning regressions inside the window', async () => {
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status)
      VALUES (${USER_R}, ${k1}, 'learning')`)
    await db.execute(sql`INSERT INTO review_logs
      (session_id, user_id, kanji_id, review_type, quality, response_time_ms,
       prev_status, next_status, prev_interval, next_interval, reviewed_at)
      VALUES (${sessionId}, ${USER_R}, ${k1}, 'meaning', 1, 8000, 'remembered', 'learning', 5, 1, now() - interval '2 days')`)
    const card = (await service.assembleSnapshot(USER_R, NOW, [])).reviews.cards[0]
    expect(card.regressions).toBe(1)
  })

  it('flags a co-created hook, and ignores a system mnemonic', async () => {
    const [k1, k2] = await kanjiIds(2)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status)
      VALUES (${USER_R}, ${k1}, 'learning'), (${USER_R}, ${k2}, 'learning')`)
    await db.execute(sql`INSERT INTO mnemonics (kanji_id, user_id, type, story_text, generation_method)
      VALUES (${k1}, ${USER_R}, 'user', 'mine', 'cocreated'),
             (${k2}, ${USER_R}, 'system', 'theirs', 'system')`)

    const cards = (await service.assembleSnapshot(USER_R, NOW, [])).reviews.cards
    expect(cards.find((c) => c.kanjiId === k1)!.hasCoCreatedHook).toBe(true)
    expect(cards.find((c) => c.kanjiId === k2)!.hasCoCreatedHook).toBe(false)
  })

  it('carries quiz outcomes inside the window', async () => {
    const [k1] = await kanjiIds(1)
    const s = await db.execute(sql`INSERT INTO kl_test_sessions (user_id, test_type)
      VALUES (${USER_R}, 'exit_quiz') RETURNING test_session_id`)
    const testSessionId = (s[0] as any).test_session_id
    await db.execute(sql`INSERT INTO kl_test_results
      (test_session_id, user_id, kanji_id, question_type, correct)
      VALUES (${testSessionId}, ${USER_R}, ${k1}, 'reading_recall', false)`)

    const snap = await service.assembleSnapshot(USER_R, NOW, [])
    expect(snap.reviews.quiz).toHaveLength(1)
    expect(snap.reviews.quiz[0]).toMatchObject({
      kanjiId: k1, questionType: 'reading_recall', correct: false,
    })
  })
})
