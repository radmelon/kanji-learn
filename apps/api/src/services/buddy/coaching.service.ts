import { and, desc, eq, gte, inArray, isNotNull, lt, ne, sum } from 'drizzle-orm'
import {
  placementSessions, placementResults, kanji, kanjiDifficulty,
  userKanjiProgress, reviewLogs, testResults, mnemonics,
  dailyStats, userProfiles,
} from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import { CommitmentService } from './commitment.service'
import { NotebookService } from '../notebook.service'
import {
  levelBands, inferredLevel, JLPT_LEVELS,
  analyze, carryForward, selectionsMatch, analysisBody,
  type JlptLevel, type LearnerSnapshot, type PlacementSnapshot,
  type PlacementItemOutcome, type PriorFinding,
  type CardSnapshot, type QuizOutcome, type ReviewSnapshot, type SrsStatus,
  type CommitmentSnapshot, type HookSnapshot,
  type Finding, type FindingKind,
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

export interface CoachingAnalysisSource {
  kind: string
  analyzedAt: string
  findings: PriorFinding[]
  correction?: { at: string; kinds: FindingKind[] }
}

export interface RefreshResult {
  written: 'inserted' | 'updated' | 'skipped'
  findings: Finding[]
}

/**
 * A Postgres unique-violation on a named constraint.
 *
 * `postgres.js` surfaces the SQLSTATE as `code` and the index name as
 * `constraint_name`. Matching the name rather than the bare `23505` matters:
 * a different unique violation from the same statement is a real bug and must
 * not be swallowed as "someone else won the race".
 *
 * Exported (the brief's version was module-private) so
 * `coaching-refresh.test.ts` can verify it directly against a real driver
 * rejection rather than a synthetic error object -- see that file for why the
 * synthetic form would not have caught a wrong property name.
 */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: unknown; constraint_name?: unknown }
  return e.code === '23505' && e.constraint_name === constraint
}

export class CoachingService {
  private readonly commitments: CommitmentService
  private readonly notebook: NotebookService

  constructor(private readonly db: Db) {
    this.commitments = new CommitmentService(db)
    this.notebook = new NotebookService(db)
  }

  async assembleSnapshot(
    userId: string,
    now: string,
    priors: PriorFinding[],
  ): Promise<LearnerSnapshot> {
    return {
      now,
      placement: await this.placement(userId),
      reviews: await this.reviews(userId, now),
      commitment: await this.commitment(userId, now),
      hooks: await this.hooks(userId),
      priorFindings: priors,
    }
  }

  /**
   * Analyse and write the notebook entry.
   *
   * `force` is for real events (placement completion, session completion).
   * The notebook GET passes no force and is gated on staleness, so assembling
   * seven tables does not ride on every read.
   *
   * ⚠️ CONCURRENCY, established in Task 4: `writeKeyedEntry` now fails LOUDLY
   * rather than silently when it loses a race. Two concurrent refreshes for one
   * learner mean the loser's insert collides with
   * `notebook_entries_coaching_unique` and rejects with 23505. That is the
   * correct outcome — the winner's analysis landed and one live row exists —
   * but it must not surface as an error, because a benign race is not a
   * failure. Catch the unique-violation and return `'skipped'`; let every other
   * error propagate to the caller's try/catch.
   */
  async refresh(
    userId: string,
    opts: { force?: boolean; now?: string } = {},
  ): Promise<RefreshResult> {
    const now = opts.now ?? new Date().toISOString()
    const latest = await this.notebook.readLatestKeyed(userId, COACHING_SOURCE_KIND)
    const latestSource = latest?.source as CoachingAnalysisSource | undefined
    const analyzedAt = latestSource?.analyzedAt ?? null
    const sinceLastMs = analyzedAt === null ? Infinity : Date.parse(now) - Date.parse(analyzedAt)

    if (!opts.force && sinceLastMs < ANALYSIS_STALE_HOURS * 3_600_000) {
      return { written: 'skipped', findings: [] }
    }

    // COALESCING. Two triggers can fire minutes apart -- the first Buddy
    // session suggests taking the placement test, so session-completion and
    // placement-completion are adjacent by design. Treat the previous entry as
    // part of THIS episode: read priors from the row before it, and update it
    // in place rather than superseding, so the chain gains no spurious link
    // for an entry nobody had time to read.
    //
    // Keyed on the row's OWN `createdAt`, NOT `analyzedAt`. Rule 3 below
    // updates a row in place forever while its selection stays unchanged, so
    // `analyzedAt` moves on every steady-state re-analysis while `createdAt`
    // never does. A row created many days ago that merely got refreshed in
    // place 20 minutes ago is the PRE-episode state, not part of a new one --
    // keying off `analyzedAt` would treat every such row as a fresh
    // coalescing partner and reset every finding's `since` to now, on every
    // run, forever.
    const coalescing = latest !== null
      && Date.parse(now) - Date.parse(latest.createdAt) < COALESCE_WINDOW_MINUTES * 60_000
    // `?? latest`: skip=1 reads PAST the row this run would otherwise
    // coalesce with, on the theory that an even earlier row holds the real
    // pre-episode state. When there is no earlier row -- this is the very
    // first analysis ever, or a coalescing chain that runs out of history --
    // skip=1 finds nothing, and falling through to empty priors would erase
    // the findings that row was already holding, just because a learner
    // triggered two events close together early on. The row itself is the
    // best available prior then, exactly as it is when not coalescing.
    const priorRow = coalescing
      ? (await this.notebook.readLatestKeyed(userId, COACHING_SOURCE_KIND, 1)) ?? latest
      : latest
    const priors = (priorRow?.source as CoachingAnalysisSource | undefined)?.findings ?? []

    const snapshot = await this.assembleSnapshot(userId, now, priors)
    const findings = analyze(snapshot)

    // Nothing worth reporting: write nothing and supersede nothing. Any
    // existing entry stands until there is something better to say. (§5's
    // companion mode is slices 3-4's answer; slice 2's answer is silence.)
    if (findings.length === 0) return { written: 'skipped', findings }

    const correction = latest?.author === 'learner'
      ? { at: latest.createdAt, kinds: (latestSource?.findings ?? []).map((f) => f.kind) }
      : latestSource?.correction

    const source: CoachingAnalysisSource = {
      kind: COACHING_SOURCE_KIND,
      analyzedAt: now,
      findings: carryForward(priors, findings, now),
      ...(correction ? { correction } : {}),
    }
    const body = analysisBody(findings, now)

    // Update in place when this says the same thing, or when it coalesces with
    // a run moments earlier. Both require the row to still be LIVE -- a
    // superseded row must never be resurrected by an UPDATE -- and
    // buddy-authored: a learner-authored latest holds words nobody else
    // wrote. The superseded chain is the ONLY place a replaced entry's text
    // survives, and that chain only grows on the INSERT path below, so a
    // learner-authored latest must always take that path -- it supersedes
    // their row instead of silently overwriting their words in place.
    const canUpdate = latest !== null && latest.supersededAt === null && latest.author === 'buddy'
    const unchanged = selectionsMatch(priors, findings)
    if (canUpdate && (coalescing || unchanged)) {
      // Spread into a fresh object rather than passing `source` directly:
      // `updateEntryInPlace` takes `Record<string, unknown>`, and a named
      // interface (CoachingAnalysisSource has no index signature) is not
      // structurally assignable to that even though every property trivially
      // is -- the same reason `payload` below works untouched, since object
      // rest destructuring already produces a fresh, indexable object type.
      const { rowCount } = await this.notebook.updateEntryInPlace(userId, latest!.id, body, { ...source })
      if (rowCount > 0) return { written: 'updated', findings }

      // 0 rows: updateEntryInPlace's supersededAt-IS-NULL guard found the row
      // no longer live. A concurrent supersedeEntry(userId, id, null) -- the
      // delete path -- won the race between readLatestKeyed above and this
      // update, so canUpdate's premise (that `latest` was still live) was
      // already stale by the time we acted on it. The analysis computed
      // above has not been written anywhere: reporting 'updated' would be a
      // lie, and returning here with 'skipped' would drop it on the floor
      // even though there is something worth saying. Deliberately no
      // `return` -- fall through to the same insert path a `latest` that had
      // correctly read as superseded would have taken. writeKeyedEntry
      // re-derives "is there a live row" for itself from the database, not
      // from anything decided above, so it is safe to call regardless of why
      // canUpdate's premise went stale.
    }

    const { kind: _kind, ...payload } = source
    try {
      await this.notebook.writeKeyedEntry(userId, {
        sourceKind: COACHING_SOURCE_KIND,
        kind: 'observation',
        body,
        sourcePayload: payload,
      })
    } catch (err) {
      // A concurrent refresh for the same learner already wrote its analysis,
      // and notebook_entries_coaching_unique rejected ours. One live row
      // exists and it is current — that is success, not failure. Anything
      // else is a real error and belongs to the caller.
      if (isUniqueViolation(err, 'notebook_entries_coaching_unique')) {
        return { written: 'skipped', findings }
      }
      throw err
    }
    return { written: 'inserted', findings }
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
    // than staying silent -- level_estimate simply does not fire. The stored
    // value gates that check and backstops levelInterval's own no-bands case;
    // it is not what ends up in `level` below -- levelInterval recomputes
    // that from today's corpus so it can never disagree with levelLow/
    // levelHigh (Finding 1, coaching-copy-floor final review).
    const theta = latest.abilityTheta
    const se = latest.abilitySe
    if (theta === null || se === null || latest.inferredLevel === null) return null

    const items = await this.placementItems(latest.id)
    const { level, levelLow, levelHigh } = await this.levelInterval(theta, se, latest.inferredLevel as JlptLevel)

    const prev = sessions[1]
    return {
      theta,
      se,
      completedAt: latest.completedAt!.toISOString(),
      level,
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
        strokeCount: kanji.strokeCount,
        kunReadings: kanji.kunReadings,
        onReadings: kanji.onReadings,
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
      strokeCount: r.strokeCount,
      // jsonb string arrays, NOT NULL DEFAULT '[]' — but coalesce anyway, so a
      // hand-seeded test row without them cannot produce NaN in learner copy.
      readingCount: (r.kunReadings?.length ?? 0) + (r.onReadings?.length ?? 0),
    }))
  }

  /**
   * `level` and the labels for the ends of the credible interval -- all THREE
   * from the SAME bands, at the SAME `theta`, in the same call. copy.ts's
   * level_estimate formatter interpolates all three into one sentence, so
   * they must never be able to disagree.
   *
   * Finding 1 (CRITICAL, coaching-copy-floor final review): `level` used to
   * come from the caller's `fallback` -- placementSessions.inferredLevel,
   * STORED AT TEST TIME -- while `levelLow`/`levelHigh` were recomputed HERE
   * from TODAY's corpus. A recalibration between those two moments can leave
   * them disagreeing: verified live, session 21c54a5e (theta=1.1453,
   * se=0.3511, stored inferred_level='N4') recomputes to levelLow='N3',
   * levelHigh='N2' today -- N4 sits outside N3..N2. Those rows were written
   * by a pre-B146 build (the fix, 504b1ea, landed 2026-08-01) and will not
   * self-heal until each learner retakes the test. Deriving `level` here,
   * from the same bands and the same `theta` used for the bounds, makes
   * containment true by construction instead of assuming two
   * independently-sourced values agree.
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
  ): Promise<{ level: JlptLevel; levelLow: JlptLevel; levelHigh: JlptLevel }> {
    const corpus = await this.db
      .select({ b: kanjiDifficulty.b, level: kanji.jlptLevel })
      .from(kanjiDifficulty)
      .innerJoin(kanji, eq(kanji.id, kanjiDifficulty.kanjiId))

    const bands = levelBands(corpus as { b: number; level: JlptLevel | null }[], JLPT_LEVELS)
    // No bands at all (an empty corpus): nothing to recompute against, so
    // fall back to the stored level for all three rather than inventing one
    // from no data -- same fallback this always returned.
    if (bands.levels.length === 0) return { level: fallback, levelLow: fallback, levelHigh: fallback }

    return {
      level: inferredLevel(theta, bands.boundaries, bands.levels),
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
      windowDays: REVIEW_WINDOW_DAYS,
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

  private async commitment(userId: string, now: string): Promise<CommitmentSnapshot | null> {
    const profile = await this.db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, userId),
    })
    const period = await this.commitments.getLastCompletedPeriod(
      userId, now, profile?.buddyIntervalWeeks ?? 1,
    )
    if (!period) return null

    // daily_stats.date is TEXT 'YYYY-MM-DD', so ISO range comparison is
    // lexical and correct. periodEnd is exclusive: a period starting on the
    // 20th covers the 20th to the 26th.
    const rows = await this.db
      .select({ total: sum(dailyStats.studyTimeMs) })
      .from(dailyStats)
      .where(and(
        eq(dailyStats.userId, userId),
        gte(dailyStats.date, period.periodStart),
        lt(dailyStats.date, period.periodEnd),
      ))

    const totalMs = Number(rows[0]?.total ?? 0)
    return {
      promisedMinutes: period.promisedMinutes,
      actualMinutes: totalMs / 60_000,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
    }
  }

  private async hooks(userId: string): Promise<HookSnapshot> {
    const [cocreated, sessionDates, progress] = await Promise.all([
      this.db.select({ kanjiId: mnemonics.kanjiId, createdAt: mnemonics.createdAt })
        .from(mnemonics)
        .where(and(
          eq(mnemonics.userId, userId),
          eq(mnemonics.generationMethod, 'cocreated'),
        ))
        .orderBy(desc(mnemonics.createdAt)),
      this.commitments.getSessionDates(userId),
      this.db.select({ kanjiId: userKanjiProgress.kanjiId, lapses: userKanjiProgress.lapses })
        .from(userKanjiProgress)
        .where(and(
          eq(userKanjiProgress.userId, userId),
          ne(userKanjiProgress.status, 'unseen'),
        )),
    ])

    const hookIds = new Set(cocreated.map((m) => m.kanjiId))
    const withHook = progress.filter((p) => hookIds.has(p.kanjiId)).map((p) => p.lapses)
    const without = progress.filter((p) => !hookIds.has(p.kanjiId)).map((p) => p.lapses)
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

    // Only claim hooks help when BOTH sides of the comparison exist -- a mean
    // over an empty group is NaN, and detectHookCoverage would push it into
    // evidence the learner sees.
    const bothExist = withHook.length > 0 && without.length > 0

    return {
      count: cocreated.length,
      latestAt: cocreated[0]?.createdAt.toISOString() ?? null,
      sessionDates,
      lapsesWithHook: bothExist ? mean(withHook) : null,
      lapsesWithoutHook: bothExist ? mean(without) : null,
    }
  }
}
