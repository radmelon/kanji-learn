import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { levelBands, inferredLevel, JLPT_LEVELS, type JlptLevel } from '@kanji-learn/shared'
import { CoachingService, REVIEW_WINDOW_DAYS } from '../../src/services/buddy/coaching.service'

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

  // MUTATION CAUGHT: shipping hardest_cleared's copy without the features it
  // cites. The sentence claims the test "weighs stroke count and number of
  // readings alongside JLPT level"; if assembly does not supply them the
  // formatter degrades to the vague base string forever, and no shared-lane
  // test would notice because the detector's own fixtures are hand-built.
  // ALSO CAUGHT: summing only ONE of the two reading arrays (e.g.
  // `kunReadings?.length ?? 0` alone, dropping onReadings from the sum).
  // That mutation still yields a plausible positive number, so a
  // `toBeGreaterThan(0)` check stays green while telling a learner a kanji
  // has fewer readings than it actually does -- readingCount is quoted
  // straight into Task 6's hardest_cleared copy ("has 19 strokes and three
  // readings"), so an undercount here is a false statement to a user, not
  // just an internal miscount. The fixture kanji is picked for an
  // ASYMMETRIC kun/on split (counts unequal): with an equal split (e.g. 2
  // and 2), dropping either array produces the SAME wrong total, so the
  // test could pass while being unable to tell you which array was
  // dropped. An unequal split makes the two possible undercounts distinct
  // values, neither of which equals the pinned expectation below.
  it('carries stroke count and reading count on each placement item', async () => {
    const kanjiRows = await db.execute(sql`
      SELECT id, stroke_count AS "strokeCount", kun_readings AS "kunReadings", on_readings AS "onReadings"
      FROM kanji
      WHERE jsonb_array_length(kun_readings) <> jsonb_array_length(on_readings)
      ORDER BY id LIMIT 1
    `)
    const kanjiRow = kanjiRows[0] as any
    const k1 = Number(kanjiRow.id)
    const expectedStrokeCount = Number(kanjiRow.strokeCount)
    const expectedReadingCount =
      (kanjiRow.kunReadings as string[]).length + (kanjiRow.onReadings as string[]).length

    const rows = await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${USER}, 0.5, 0.4, 'N4', now()) RETURNING id`)
    const sessionId = (rows[0] as any).id
    await db.execute(sql`INSERT INTO placement_results
      (session_id, kanji_id, jlpt_level, passed, meaning_correct, reading_correct, difficulty_at_ask)
      VALUES (${sessionId}, ${k1}, 'N5', true, true, false, 0.8)`)

    const snap = await service.assembleSnapshot(USER, NOW, [])
    const item = snap.placement!.items.find((i) => i.kanjiId === k1)!
    // Pinned to the row's own values, not merely "> 0" -- see comment above.
    expect(item.strokeCount).toBe(expectedStrokeCount)
    expect(item.readingCount).toBe(expectedReadingCount)
  })
})

describe('CoachingService.assembleSnapshot — reviews', () => {
  const service = new CoachingService(db)
  // Own UUID -- must NOT collide with WIDE_USER (...c4) above. It worked
  // before only because Vitest runs top-level `describe` blocks sequentially
  // in declaration order, so the placement block's `afterAll` tore the c4 row
  // down before this block's `beforeAll` re-inserted it via `ON CONFLICT DO
  // NOTHING`. That coupling was undocumented and not something a future
  // reorder of these blocks (or a switch to per-file parallelism) should be
  // trusted to preserve.
  const USER_R = '00000000-0000-0000-0000-0000000000c8'
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

  it('carries status, lapses, reading stage, and the real character', async () => {
    const [k1] = await kanjiIds(1)
    // Looked up from the corpus rather than hardcoded, so this can't drift.
    const rows = await db.execute(sql`SELECT character FROM kanji WHERE id = ${k1}`)
    const character = (rows[0] as any).character as string

    await db.execute(sql`INSERT INTO user_kanji_progress
      (user_id, kanji_id, status, lapses, reading_stage)
      VALUES (${USER_R}, ${k1}, 'learning', 3, 2)`)
    const snap = await service.assembleSnapshot(USER_R, NOW, [])
    expect(snap.reviews.cards).toHaveLength(1)
    // `character` is filled by a batched SECOND query (fillCharacters), not
    // by the mapping above it -- hook-coverage.ts puts this field straight
    // into user-facing evidence as the "suggested kanji" (a broken join key
    // would ship a hook offer with a blank subject), so it must be pinned to
    // the real value, not just asserted present.
    expect(snap.reviews.cards[0]).toMatchObject({
      kanjiId: k1, status: 'learning', lapses: 3, readingStage: 2, character,
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

  it('counts a Good (4) as a PASS, pinning the >= 4 boundary from the other side', async () => {
    // Paired with the Hard(3) test above: together they pin the exact
    // boundary the brief specifies (`quality >= 4`) rather than leaving the
    // pass side of the threshold to be inferred from quality-5 fixtures
    // elsewhere in this file, which cannot distinguish `>= 4` from `> 4`.
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status)
      VALUES (${USER_R}, ${k1}, 'learning')`)
    await db.execute(sql`INSERT INTO review_logs
      (session_id, user_id, kanji_id, review_type, quality, response_time_ms,
       prev_status, next_status, prev_interval, next_interval, reviewed_at)
      VALUES (${sessionId}, ${USER_R}, ${k1}, 'meaning', 4, 9000, 'learning', 'learning', 0, 1, now() - interval '2 days')`)
    const card = (await service.assembleSnapshot(USER_R, NOW, [])).reviews.cards[0]
    expect(card.accuracyLate).toBeCloseTo(1)
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
    // An empty half must read as "no data" (null), not "answered everything
    // wrong" (0) -- those are different claims. The late half isn't empty
    // here, so it should hold a real value (quality 4 passes), for contrast.
    expect(card.accuracyEarly).toBeNull()
    expect(card.accuracyLate).toBeCloseTo(1)
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

  it('caps recentQualities at 10, keeping the newest, oldest-to-newest', async () => {
    // The contract (CardSnapshot's own comment) is "recent grades, newest
    // last" -- i.e. `mine.slice(-10)` over logs already ordered ascending by
    // reviewedAt. pickHookCandidate (hook-coverage.ts) counts struggle
    // signals only within this array, so a regression to `.slice(0, 10)`
    // (oldest 10) or a reversed order would silently change which kanji the
    // coach flags as struggling for any heavily-reviewed kanji.
    //
    // 12 reviews inside the window, one per day, oldest first. `quality`
    // doubles as a position marker (0..11 in insertion/time order) so the
    // returned slice's content and order can both be checked directly,
    // without leaning on the 0-5 SM-2 domain for a value that only needs to
    // be distinguishable here.
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status)
      VALUES (${USER_R}, ${k1}, 'learning')`)

    const total = 12
    const nowMs = Date.parse(NOW)
    for (let i = 0; i < total; i++) {
      const daysAgo = total - i // 12, 11, ..., 1 -- strictly oldest to newest
      const reviewedAt = new Date(nowMs - daysAgo * 86_400_000).toISOString()
      await db.execute(sql`INSERT INTO review_logs
        (session_id, user_id, kanji_id, review_type, quality, response_time_ms,
         prev_status, next_status, prev_interval, next_interval, reviewed_at)
        VALUES (${sessionId}, ${USER_R}, ${k1}, 'meaning', ${i}, 1000,
                'learning', 'learning', 0, 1, ${reviewedAt})`)
    }

    const card = (await service.assembleSnapshot(USER_R, NOW, [])).reviews.cards[0]

    // Cap: catches a regression that drops the cap entirely (e.g. all 12).
    expect(card.recentQualities).toHaveLength(10)
    // Newest 10, not oldest: order-independent set check, so this catches
    // `.slice(0, 10)` (would keep {0..9}) without also being sensitive to
    // ordering -- kept orthogonal to the order assertion below.
    expect([...card.recentQualities].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    // Ordered oldest-to-newest within the slice: catches a reversed order
    // (e.g. newest-first), which the set check above cannot distinguish from
    // this correct order since both share the same members.
    expect(card.recentQualities).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
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

  it('ignores quiz rows outside the window', async () => {
    // kl_test_results uses the same gte(..., windowStart) filter as
    // review_logs (see 'ignores reviews older than the window' above), but
    // nothing exercised it on the quiz side.
    const [k1] = await kanjiIds(1)
    const s = await db.execute(sql`INSERT INTO kl_test_sessions (user_id, test_type)
      VALUES (${USER_R}, 'exit_quiz') RETURNING test_session_id`)
    const testSessionId = (s[0] as any).test_session_id
    const outside = new Date(Date.parse(NOW) - 90 * 86_400_000).toISOString()
    await db.execute(sql`INSERT INTO kl_test_results
      (test_session_id, user_id, kanji_id, question_type, correct, created_at)
      VALUES (${testSessionId}, ${USER_R}, ${k1}, 'reading_recall', false, ${outside})`)

    const snap = await service.assembleSnapshot(USER_R, NOW, [])
    expect(snap.reviews.quiz).toHaveLength(0)
  })

  // MUTATION CAUGHT: hardcoding "a month" in fluency_gain's copy instead of
  // reading the window. REVIEW_WINDOW_DAYS is documented as an assembly
  // parameter; a copy string that inlines it becomes a lie the first time it
  // changes, and nothing else would fail.
  it('carries the review window length on the review snapshot', async () => {
    const snap = await service.assembleSnapshot(USER_R, NOW, [])
    expect(snap.reviews.windowDays).toBe(REVIEW_WINDOW_DAYS)
  })
})

describe('CoachingService.assembleSnapshot — commitment and hooks', () => {
  const service = new CoachingService(db)
  const USER_C = '00000000-0000-0000-0000-0000000000c5'

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone, buddy_interval_weeks)
      VALUES (${USER_C}, 'CoachingCommitSnap', 'America/Los_Angeles', 1) ON CONFLICT DO NOTHING`)
  })

  const wipe = async () => {
    await db.execute(sql`DELETE FROM buddy_commitments WHERE user_id = ${USER_C}`)
    await db.execute(sql`DELETE FROM daily_stats WHERE user_id = ${USER_C}`)
    await db.execute(sql`DELETE FROM mnemonics WHERE user_id = ${USER_C}`)
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${USER_C}`)
  }
  beforeEach(wipe)
  afterAll(async () => {
    await wipe()
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER_C}`)
  })

  it('commitment is null when the current period has not ended', async () => {
    // The defect in spec §1: at this instant commitment_gap would otherwise
    // score the maximum possible and greet a new learner with "you studied
    // less than you promised".
    await db.execute(sql`INSERT INTO buddy_commitments
      (user_id, week_start, days_committed, minutes_per_day, source)
      VALUES (${USER_C}, '2026-08-01', 4, 15, 'session')`)
    const snap = await service.assembleSnapshot(USER_C, NOW, [])
    expect(snap.commitment).toBeNull()
  })

  it('sums daily_stats study time over a completed period', async () => {
    await db.execute(sql`INSERT INTO buddy_commitments
      (user_id, week_start, days_committed, minutes_per_day, source)
      VALUES (${USER_C}, '2026-07-20', 4, 15, 'session')`)
    // 600000 ms = 10 minutes, inside the period; the third row is outside it.
    await db.execute(sql`INSERT INTO daily_stats (user_id, date, study_time_ms)
      VALUES (${USER_C}, '2026-07-21', 600000),
             (${USER_C}, '2026-07-22', 600000),
             (${USER_C}, '2026-07-28', 600000)`)

    const snap = await service.assembleSnapshot(USER_C, NOW, [])
    expect(snap.commitment).not.toBeNull()
    expect(snap.commitment!.promisedMinutes).toBe(60)
    expect(snap.commitment!.actualMinutes).toBeCloseTo(20)
    expect(snap.commitment!.periodStart).toBe('2026-07-20')
    expect(snap.commitment!.periodEnd).toBe('2026-07-27')
  })

  it('counts only co-created hooks, newest first', async () => {
    const [k1, k2] = await kanjiIds(2)
    await db.execute(sql`INSERT INTO mnemonics (kanji_id, user_id, type, story_text, generation_method, created_at)
      VALUES (${k1}, ${USER_C}, 'user', 'a', 'cocreated', '2026-07-10T00:00:00Z'),
             (${k2}, ${USER_C}, 'system', 'b', 'system', '2026-07-20T00:00:00Z')`)
    const snap = await service.assembleSnapshot(USER_C, NOW, [])
    expect(snap.hooks.count).toBe(1)
    expect(snap.hooks.latestAt).toBe('2026-07-10T00:00:00.000Z')
  })

  it('sessionDates come from session-sourced commitments, newest first', async () => {
    await db.execute(sql`INSERT INTO buddy_commitments
      (user_id, week_start, days_committed, minutes_per_day, source)
      VALUES (${USER_C}, '2026-07-06', 4, 15, 'session'),
             (${USER_C}, '2026-07-13', 4, 15, 'rolled_forward'),
             (${USER_C}, '2026-07-20', 4, 15, 'session')`)
    const snap = await service.assembleSnapshot(USER_C, NOW, [])
    expect(snap.hooks.sessionDates).toEqual(['2026-07-20', '2026-07-06'])
  })

  it('lapse means are null unless BOTH groups exist', async () => {
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status, lapses)
      VALUES (${USER_C}, ${k1}, 'learning', 2)`)
    const snap = await service.assembleSnapshot(USER_C, NOW, [])
    expect(snap.hooks.lapsesWithHook).toBeNull()
    expect(snap.hooks.lapsesWithoutHook).toBeNull()
  })

  it('computes both lapse means when both groups exist', async () => {
    const [k1, k2] = await kanjiIds(2)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status, lapses)
      VALUES (${USER_C}, ${k1}, 'learning', 1), (${USER_C}, ${k2}, 'learning', 5)`)
    await db.execute(sql`INSERT INTO mnemonics (kanji_id, user_id, type, story_text, generation_method)
      VALUES (${k1}, ${USER_C}, 'user', 'a', 'cocreated')`)
    const snap = await service.assembleSnapshot(USER_C, NOW, [])
    expect(snap.hooks.lapsesWithHook).toBeCloseTo(1)
    expect(snap.hooks.lapsesWithoutHook).toBeCloseTo(5)
  })

  // Self-review additions below -- each closes a boundary the tests above
  // don't pin, per Task 8's brief.

  it('excludes a daily_stats row exactly on periodEnd, but keeps the day before it', async () => {
    // "sums daily_stats study time over a completed period" above puts its
    // out-of-range row a full day PAST periodEnd (2026-07-28 vs periodEnd
    // 2026-07-27), so it can't tell `lt` from `lte` -- both would exclude
    // that row. This pins the exact exclusive boundary: 07-26 is the
    // period's last real day (must count), 07-27 is periodEnd itself
    // (must NOT count, since periodEnd is exclusive).
    await db.execute(sql`INSERT INTO buddy_commitments
      (user_id, week_start, days_committed, minutes_per_day, source)
      VALUES (${USER_C}, '2026-07-20', 4, 15, 'session')`)
    await db.execute(sql`INSERT INTO daily_stats (user_id, date, study_time_ms)
      VALUES (${USER_C}, '2026-07-26', 600000),
             (${USER_C}, '2026-07-27', 600000)`)

    const snap = await service.assembleSnapshot(USER_C, NOW, [])
    expect(snap.commitment!.actualMinutes).toBeCloseTo(10)
  })

  it('lapse means are also null when only the WITH-hook group has data', async () => {
    // Mirror of "lapse means are null unless BOTH groups exist": that test
    // only ever populates the WITHOUT group, so a mutant that computed
    // `bothExist` from `without.length > 0` alone (dropping the withHook
    // check) would still pass it. This leaves WITHOUT empty instead, to
    // pin the other half of the AND.
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status, lapses)
      VALUES (${USER_C}, ${k1}, 'learning', 4)`)
    await db.execute(sql`INSERT INTO mnemonics (kanji_id, user_id, type, story_text, generation_method)
      VALUES (${k1}, ${USER_C}, 'user', 'a', 'cocreated')`)

    const snap = await service.assembleSnapshot(USER_C, NOW, [])
    expect(snap.hooks.lapsesWithHook).toBeNull()
    expect(snap.hooks.lapsesWithoutHook).toBeNull()
  })

  it('latestAt is the NEWEST co-created hook, not just any one', async () => {
    // "counts only co-created hooks, newest first" above has exactly ONE
    // co-created row, so it can't distinguish a real `ORDER BY created_at
    // DESC` from a query that returns whatever row it finds first. Two
    // co-created rows here, older inserted first, so a missing/wrong sort
    // would surface the older timestamp and fail this assertion.
    const [k1, k2] = await kanjiIds(2)
    await db.execute(sql`INSERT INTO mnemonics (kanji_id, user_id, type, story_text, generation_method, created_at)
      VALUES (${k1}, ${USER_C}, 'user', 'older', 'cocreated', '2026-07-10T00:00:00Z'),
             (${k2}, ${USER_C}, 'user', 'newer', 'cocreated', '2026-07-25T00:00:00Z')`)

    const snap = await service.assembleSnapshot(USER_C, NOW, [])
    expect(snap.hooks.count).toBe(2)
    expect(snap.hooks.latestAt).toBe('2026-07-25T00:00:00.000Z')
  })

  it('sessionDates excludes source=default as well as rolled_forward', async () => {
    // "sessionDates come from session-sourced commitments" above only pairs
    // 'session' against 'rolled_forward'. hooks() delegates the whole read
    // to CommitmentService.getSessionDates (already covered for 'default'
    // in coaching-commitment-reads.test.ts), so this is defense in depth
    // against a future reimplementation at this layer, not a mutation of
    // the current delegated code.
    await db.execute(sql`INSERT INTO buddy_commitments
      (user_id, week_start, days_committed, minutes_per_day, source)
      VALUES (${USER_C}, '2026-07-20', 4, 15, 'session'),
             (${USER_C}, '2026-07-27', 4, 15, 'default')`)

    const snap = await service.assembleSnapshot(USER_C, NOW, [])
    expect(snap.hooks.sessionDates).toEqual(['2026-07-20'])
  })

  it('all five HookSnapshot fields sit at their empty-state values together', async () => {
    // Every hooks() test above pins ONE field against a partially-populated
    // fixture. beforeEach(wipe) already leaves USER_C with no mnemonics, no
    // buddy_commitments, and no user_kanji_progress rows, so a bare
    // assembleSnapshot call here is the learner with nothing at all -- the
    // one case that proves all five fields collapse to their empty state
    // together, not just individually.
    const snap = await service.assembleSnapshot(USER_C, NOW, [])
    expect(snap.hooks).toEqual({
      count: 0,
      latestAt: null,
      sessionDates: [],
      lapsesWithHook: null,
      lapsesWithoutHook: null,
    })
  })
})

describe('CoachingService.assembleSnapshot — commitment: buddyIntervalWeeks passthrough', () => {
  // Own fixture, own interval. Every test in the block above pins
  // buddy_interval_weeks=1 on USER_C -- the only occurrence of that column
  // in this file before this block -- so a regression that dropped
  // commitment()'s `profile?.buddyIntervalWeeks ?? 1` read (hardcoding 1
  // regardless of the profile) would pass every one of them. This learner's
  // profile carries buddy_interval_weeks=2, and the assertions below are
  // built to distinguish a real 14-day period from the 7-day period that
  // read would silently fall back to.
  const service = new CoachingService(db)
  const USER_I = '00000000-0000-0000-0000-0000000000d7'

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone, buddy_interval_weeks)
      VALUES (${USER_I}, 'CoachingIntervalFixture', 'America/Los_Angeles', 2) ON CONFLICT DO NOTHING`)
  })

  afterAll(async () => {
    await db.execute(sql`DELETE FROM buddy_commitments WHERE user_id = ${USER_I}`)
    await db.execute(sql`DELETE FROM daily_stats WHERE user_id = ${USER_I}`)
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER_I}`)
  })

  it('threads buddy_interval_weeks=2 into a 14-day commitment period, not 7', async () => {
    await db.execute(sql`INSERT INTO buddy_commitments
      (user_id, week_start, days_committed, minutes_per_day, source)
      VALUES (${USER_I}, '2026-07-13', 4, 15, 'session')`)
    // 2026-07-22 falls inside the correct 14-day window [07-13, 07-27) but
    // OUTSIDE the 7-day window [07-13, 07-20) that a hardcoded intervalWeeks
    // of 1 would produce from this same commitment row -- so actualMinutes
    // distinguishes the two behaviours as well as periodEnd does. 900000 ms
    // = 15 minutes.
    await db.execute(sql`INSERT INTO daily_stats (user_id, date, study_time_ms)
      VALUES (${USER_I}, '2026-07-22', 900000)`)

    const snap = await service.assembleSnapshot(USER_I, NOW, [])
    expect(snap.commitment).not.toBeNull()
    expect(snap.commitment!.periodStart).toBe('2026-07-13')
    // 14 days past periodStart -- unambiguously not the 7-day fallback.
    expect(snap.commitment!.periodEnd).toBe('2026-07-27')
    expect(snap.commitment!.promisedMinutes).toBe(60)
    expect(snap.commitment!.actualMinutes).toBeCloseTo(15)
  })
})
