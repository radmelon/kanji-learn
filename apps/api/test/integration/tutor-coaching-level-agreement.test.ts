import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { CoachingService } from '../../src/services/buddy/coaching.service'
import { TutorReportService } from '../../src/services/tutor-report.service'
import { loadLevelBands, deriveLevel } from '../../src/services/level-bands'

/**
 * B-233 — the tutor and the Journal must never state different levels for the
 * same placement session.
 *
 * They did, and it was reported repeatedly from 2026-08-04: the tutor read
 * `placement_sessions.inferred_level` while `CoachingService` recomputed from
 * `ability_theta`. Migration 0037 corrected the three live rows a pre-B146
 * build had written wrong, which fixed the symptom and not the cause —
 * `kanji_difficulty` is a recalibrating table, so the next recalibration would
 * have reopened it with no bug to blame.
 *
 * THE LOAD-BEARING TEST IS THE THIRD ONE. Agreement alone would still pass if
 * both sides happened to read the same stored column; only writing a stored
 * value that CONTRADICTS theta proves the tutor derives rather than reads.
 */
const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER = '00000000-0000-0000-0000-0000000000d1'
const NOW = '2026-08-02T12:00:00.000Z'
/** buildReport takes a uuid; nothing in these assertions depends on it. */
const SHARE_ID = '00000000-0000-0000-0000-0000000000d2'

describe('B-233: tutor and coaching agree on level', () => {
  const coaching = new CoachingService(db)
  const tutor = new TutorReportService(db)

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'LevelAgreementFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })

  const wipe = async () => {
    await db.execute(sql`DELETE FROM placement_sessions WHERE user_id = ${USER}`)
  }
  beforeEach(wipe)
  afterAll(async () => {
    await wipe()
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
    await client.end()
  })

  /** The level today's corpus says a theta means — computed independently of
   *  both services, so this file is not grading either one against itself. */
  const expectedFor = async (theta: number) =>
    deriveLevel(await loadLevelBands(db), theta)

  it('reports the same level from both paths', async () => {
    await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${USER}, 1.14527, 0.351137, 'N3', now())`)

    const snap = await coaching.assembleSnapshot(USER, NOW, [])
    const report = await tutor.buildReport(USER, SHARE_ID)

    expect(snap.placement!.level).toBe(await expectedFor(1.14527))
    expect(report.placement.sessions[0].inferredLevel).toBe(snap.placement!.level)
  })

  it('agrees across a range of abilities, not just one fixture', async () => {
    for (const theta of [-2.5, -1.0, 0.227545, 1.06744, 3.5]) {
      await wipe()
      await db.execute(sql`INSERT INTO placement_sessions
        (user_id, ability_theta, ability_se, inferred_level, completed_at)
        VALUES (${USER}, ${theta}, 0.4, 'N5', now())`)

      const snap = await coaching.assembleSnapshot(USER, NOW, [])
      const report = await tutor.buildReport(USER, SHARE_ID)
      expect(report.placement.sessions[0].inferredLevel, `theta=${theta}`)
        .toBe(snap.placement!.level)
    }
  })

  it('THE POINT: a stored level contradicting theta does not change what the tutor says', async () => {
    const theta = 1.14527
    const expected = await expectedFor(theta)

    // Deliberately store something the corpus does NOT derive — the state a
    // recalibration, or the pre-B146 bug, leaves behind. Chosen relative to the
    // corpus rather than hardcoded: this same theta derives N3 against live and
    // N1 against the test database, so any literal here would assert a fact
    // about whichever corpus happened to be loaded.
    const wrong = (['N5', 'N4', 'N3', 'N2', 'N1'] as const).find((l) => l !== expected)!
    await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${USER}, ${theta}, 0.351137, ${wrong}, now())`)

    const report = await tutor.buildReport(USER, SHARE_ID)
    expect(report.placement.sessions[0].inferredLevel).toBe(expected)
    expect(report.placement.sessions[0].inferredLevel).not.toBe(wrong)
  })

  it('says nothing rather than repeating a stored label when theta is null', async () => {
    // Two live sessions are in exactly this state (2026-04-17, 2026-07-07).
    // Coaching already declines to describe those learners; the tutor used to
    // print the stored label, which has nothing behind it.
    await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${USER}, NULL, NULL, 'N1', now())`)

    const report = await tutor.buildReport(USER, SHARE_ID)
    expect(report.placement.sessions[0].inferredLevel).toBeNull()

    const snap = await coaching.assembleSnapshot(USER, NOW, [])
    expect(snap.placement).toBeNull()
  })
})
