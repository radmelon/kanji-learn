import { and, desc, eq, gte, isNotNull } from 'drizzle-orm'
import {
  placementSessions, placementResults, kanji, kanjiDifficulty,
} from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import {
  levelBands, inferredLevel, JLPT_LEVELS,
  type JlptLevel, type LearnerSnapshot, type PlacementSnapshot,
  type PlacementItemOutcome, type PriorFinding,
} from '@kanji-learn/shared'

/** Notebook `source->>'kind'` for a coaching analysis. */
export const COACHING_SOURCE_KIND = 'coaching_analysis'

/**
 * Window for CardSnapshot's early/late halves. Slice 1 defined those fields
 * relative to "the window" and never fixed its length -- it is an assembly
 * parameter, and this is the slice that owns it. Split at the midpoint.
 */
export const REVIEW_WINDOW_DAYS = 30

/** A notebook GET re-analyses only when the stored analysis is older than this. */
export const ANALYSIS_STALE_HOURS = 6

/** Two runs closer together than this are one episode -- see refresh(). */
export const COALESCE_WINDOW_MINUTES = 60

/** z for an 80% two-sided interval, matching PlacementSnapshot's contract. */
const Z_80 = 1.2816

export class CoachingService {
  constructor(private readonly db: Db) {}

  async assembleSnapshot(
    userId: string,
    now: string,
    priors: PriorFinding[],
  ): Promise<LearnerSnapshot> {
    return {
      now,
      placement: await this.placement(userId),
      reviews: { cards: [], quiz: [] },
      commitment: null,
      hooks: { count: 0, latestAt: null, sessionDates: [], lapsesWithHook: null, lapsesWithoutHook: null },
      priorFindings: priors,
    }
  }

  private async placement(userId: string): Promise<PlacementSnapshot | null> {
    const sessions = await this.db.select().from(placementSessions)
      .where(and(
        eq(placementSessions.userId, userId),
        isNotNull(placementSessions.completedAt),
      ))
      .orderBy(desc(placementSessions.completedAt))
      .limit(2)

    const latest = sessions[0]
    if (!latest) return null

    // `level` is non-nullable on the contract. A session whose inferredLevel
    // never resolved cannot describe a level, and inventing one would be worse
    // than staying silent -- level_estimate simply does not fire.
    const theta = latest.abilityTheta
    const se = latest.abilitySe
    if (theta === null || se === null || latest.inferredLevel === null) return null

    const items = await this.placementItems(latest.id)
    const { levelLow, levelHigh } = await this.levelInterval(theta, se, latest.inferredLevel as JlptLevel)

    const prev = sessions[1]
    return {
      theta,
      se,
      completedAt: latest.completedAt!.toISOString(),
      level: latest.inferredLevel as JlptLevel,
      thetaLow: theta - Z_80 * se,
      thetaHigh: theta + Z_80 * se,
      levelLow,
      levelHigh,
      previous: prev && prev.abilityTheta !== null && prev.abilitySe !== null
        ? {
          theta: prev.abilityTheta,
          se: prev.abilitySe,
          completedAt: prev.completedAt!.toISOString(),
        }
        : null,
      items,
    }
  }

  private async placementItems(sessionId: string): Promise<PlacementItemOutcome[]> {
    const rows = await this.db
      .select({
        kanjiId: placementResults.kanjiId,
        character: kanji.character,
        meaningCorrect: placementResults.meaningCorrect,
        readingCorrect: placementResults.readingCorrect,
        difficultyAtAsk: placementResults.difficultyAtAsk,
        readingOffset: kanjiDifficulty.readingOffset,
      })
      .from(placementResults)
      .innerJoin(kanji, eq(kanji.id, placementResults.kanjiId))
      .leftJoin(kanjiDifficulty, eq(kanjiDifficulty.kanjiId, placementResults.kanjiId))
      .where(eq(placementResults.sessionId, sessionId))

    return rows.map((r) => ({
      kanjiId: r.kanjiId,
      character: r.character,
      meaningCorrect: r.meaningCorrect ?? false,
      // NOT coerced to false: the contract says null means the reading half
      // was never asked, and reading_lag must not count an unasked item as
      // a wrong answer.
      readingCorrect: r.readingCorrect,
      readingOffset: r.readingOffset ?? 0,
      difficultyAtAsk: r.difficultyAtAsk ?? 0,
    }))
  }

  /**
   * Level labels for the ends of the credible interval.
   *
   * Bands come from the whole difficulty CORPUS, never from the items this
   * test happened to ask -- levelBands' own header records B146, where reading
   * an index out of the full level list while the boundaries described a
   * shorter ladder told strong learners they were N4.
   */
  private async levelInterval(
    theta: number,
    se: number,
    fallback: JlptLevel,
  ): Promise<{ levelLow: JlptLevel; levelHigh: JlptLevel }> {
    const corpus = await this.db
      .select({ b: kanjiDifficulty.b, level: kanji.jlptLevel })
      .from(kanjiDifficulty)
      .innerJoin(kanji, eq(kanji.id, kanjiDifficulty.kanjiId))

    const bands = levelBands(corpus as { b: number; level: JlptLevel | null }[], JLPT_LEVELS)
    if (bands.levels.length === 0) return { levelLow: fallback, levelHigh: fallback }

    return {
      levelLow: inferredLevel(theta - Z_80 * se, bands.boundaries, bands.levels),
      levelHigh: inferredLevel(theta + Z_80 * se, bands.boundaries, bands.levels),
    }
  }
}
