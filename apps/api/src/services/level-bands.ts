import { eq } from 'drizzle-orm'
import { kanjiDifficulty, kanji } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import {
  levelBands, inferredLevel, JLPT_LEVELS,
  type JlptLevel, type LevelBands,
} from '@kanji-learn/shared'

/**
 * The one place a JLPT level is derived from an ability estimate.
 *
 * ─── WHY THIS FILE EXISTS (B-233) ───────────────────────────────────────────
 * `placement_sessions.inferred_level` is a CACHED DERIVATION, not an
 * independent fact. Migration 0029 says so on the column next to it:
 *
 *   "Posterior mean ability estimate. inferred_level is now DERIVED from this
 *    (spec §7.5) rather than computed independently."
 *
 * It was nonetheless being read as authoritative by the tutor while
 * `CoachingService` recomputed its own, so the two told the same learner
 * different levels — reported repeatedly from 2026-08-04. Migration 0037
 * corrected the stored rows, which fixed the symptom on the day and fixed
 * nothing structurally: `kanji_difficulty` is a recalibrating table
 * (`refreshKanjiDifficulty` upserts all 2,294 rows, and
 * `placement_results.difficulty_at_ask` exists precisely "so a session is
 * replayable after kanji_difficulty is recalibrated"). The next recalibration
 * would have reopened the gap with no bug to blame.
 *
 * Deriving on read makes the two agree by construction rather than by
 * discipline. The stored column stays as an audit trail of what each learner
 * was told at the time; nothing reads it to answer "what level is this?".
 *
 * ⚠️ Bands come from the whole difficulty CORPUS, never from the items a test
 * happened to ask. `levelBands`' own header records B146, where reading an
 * index out of the full level list while the boundaries described a shorter
 * ladder told strong learners they were N4 — item selection maximises Fisher
 * information, so a strong learner is never asked an N5 item and N5 drops out.
 */
export async function loadLevelBands(db: Db): Promise<LevelBands> {
  const corpus = await db
    .select({ b: kanjiDifficulty.b, level: kanji.jlptLevel })
    .from(kanjiDifficulty)
    .innerJoin(kanji, eq(kanji.id, kanjiDifficulty.kanjiId))

  return levelBands(corpus as { b: number; level: JlptLevel | null }[], JLPT_LEVELS)
}

/**
 * `null` when the level cannot be stated: no theta (the session never resolved
 * one) or no bands (an empty corpus).
 *
 * Returning null rather than a fallback is the point for callers that have no
 * better answer. A session with no theta has nothing behind a level, and
 * printing the stored one there is exactly the "number with nothing behind it"
 * this file exists to stop. Callers that DO have a meaningful fallback —
 * `CoachingService.levelInterval` needs a non-nullable level on its contract —
 * apply it themselves, visibly.
 */
export function deriveLevel(bands: LevelBands, theta: number | null): JlptLevel | null {
  if (theta === null || bands.levels.length === 0) return null
  return inferredLevel(theta, bands.boundaries, bands.levels)
}
