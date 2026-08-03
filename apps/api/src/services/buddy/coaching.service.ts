import { and, desc, eq, gte, inArray, isNotNull, ne } from 'drizzle-orm'
import {
  placementSessions, placementResults, kanji, kanjiDifficulty,
  userKanjiProgress, reviewLogs, testResults, mnemonics,
} from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import {
  levelBands, inferredLevel, JLPT_LEVELS,
  type JlptLevel, type LearnerSnapshot, type PlacementSnapshot,
  type PlacementItemOutcome, type PriorFinding,
  type CardSnapshot, type QuizOutcome, type ReviewSnapshot, type SrsStatus,
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
      reviews: await this.reviews(userId, now),
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

  /**
   * Grades at or above this are a pass.
   *
   * hook-coverage.ts documents STRUGGLE_QUALITY = 3 as "Again (1) and Hard
   * (3)", so the scale in use is Again=1, Hard=3, Good=4, Easy=5. Counting a
   * Hard as correct here would contradict the struggle definition one file
   * over, and fluency_gain's "faster AND not wronger" guard would be measuring
   * a different thing from the one hook_coverage measures.
   */
  private static readonly PASS_QUALITY = 4

  private async reviews(userId: string, now: string): Promise<ReviewSnapshot> {
    const nowMs = Date.parse(now)
    const windowStart = new Date(nowMs - REVIEW_WINDOW_DAYS * 86_400_000)
    const midpoint = nowMs - (REVIEW_WINDOW_DAYS / 2) * 86_400_000

    const [progress, logs, quiz, hooks] = await Promise.all([
      this.db.select().from(userKanjiProgress)
        .where(and(
          eq(userKanjiProgress.userId, userId),
          ne(userKanjiProgress.status, 'unseen'),
        )),
      this.db.select({
        kanjiId: reviewLogs.kanjiId,
        quality: reviewLogs.quality,
        responseTimeMs: reviewLogs.responseTimeMs,
        prevStatus: reviewLogs.prevStatus,
        nextStatus: reviewLogs.nextStatus,
        reviewedAt: reviewLogs.reviewedAt,
      }).from(reviewLogs)
        .where(and(
          eq(reviewLogs.userId, userId),
          gte(reviewLogs.reviewedAt, windowStart),
        ))
        .orderBy(reviewLogs.reviewedAt),
      this.db.select().from(testResults)
        .where(and(
          eq(testResults.userId, userId),
          gte(testResults.createdAt, windowStart),
        )),
      this.db.select({ kanjiId: mnemonics.kanjiId }).from(mnemonics)
        .where(and(
          eq(mnemonics.userId, userId),
          eq(mnemonics.generationMethod, 'cocreated'),
        )),
    ])

    const hookIds = new Set(hooks.map((h) => h.kanjiId))
    const byKanji = new Map<number, typeof logs>()
    for (const log of logs) {
      const list = byKanji.get(log.kanjiId) ?? []
      list.push(log)
      byKanji.set(log.kanjiId, list)
    }

    const mean = (xs: number[]): number | null =>
      xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length

    const cards: CardSnapshot[] = progress.map((p) => {
      const mine = byKanji.get(p.kanjiId) ?? []
      const early = mine.filter((l) => l.reviewedAt.getTime() < midpoint)
      const late = mine.filter((l) => l.reviewedAt.getTime() >= midpoint)
      const accuracy = (rows: typeof mine) =>
        mean(rows.map((l) => (l.quality >= CoachingService.PASS_QUALITY ? 1 : 0)))

      return {
        kanjiId: p.kanjiId,
        character: '',
        status: p.status as SrsStatus,
        lapses: p.lapses,
        readingStage: p.readingStage,
        regressions: mine.filter(
          (l) => l.prevStatus === 'remembered' && l.nextStatus === 'learning',
        ).length,
        responseMsEarly: mean(early.map((l) => l.responseTimeMs)),
        responseMsLate: mean(late.map((l) => l.responseTimeMs)),
        accuracyEarly: accuracy(early),
        accuracyLate: accuracy(late),
        recentQualities: mine.slice(-10).map((l) => l.quality),
        hasCoCreatedHook: hookIds.has(p.kanjiId),
      }
    })

    await this.fillCharacters(cards)

    return {
      cards,
      quiz: quiz.map((q): QuizOutcome => ({
        kanjiId: q.kanjiId,
        questionType: q.questionType,
        correct: q.correct,
        answeredAt: q.createdAt.toISOString(),
      })),
    }
  }

  /**
   * hook_coverage's evidence names the kanji, so `character` must be real --
   * an empty string would render "want to build a hook for ?" and no test of
   * the detector would notice, because it only checks the field exists.
   */
  private async fillCharacters(cards: CardSnapshot[]): Promise<void> {
    if (cards.length === 0) return
    const rows = await this.db
      .select({ id: kanji.id, character: kanji.character })
      .from(kanji)
      .where(inArray(kanji.id, cards.map((c) => c.kanjiId)))
    const chars = new Map(rows.map((r) => [r.id, r.character]))
    for (const card of cards) card.character = chars.get(card.kanjiId) ?? ''
  }
}
