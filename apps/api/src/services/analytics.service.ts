import { and, eq, gte, desc, sql, lte } from 'drizzle-orm'
import { dailyStats, reviewLogs, reviewSessions, userKanjiProgress, kanji, writingAttempts, voiceAttempts, testResults } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import type { DailyStats, VelocityMetrics, JlptLevelProjection } from '@kanji-learn/shared'
import {
  VELOCITY_DROP_THRESHOLD,
  PLATEAU_DAYS_THRESHOLD,
  TOTAL_JOUYOU_KANJI,
  JLPT_LEVELS,
  JLPT_KANJI_COUNTS,
} from '@kanji-learn/shared'

// ─── Analytics Service ────────────────────────────────────────────────────────

export class AnalyticsService {
  constructor(private db: Db) {}

  // ── Daily stats for the last N days ────────────────────────────────────────

  async getDailyStats(userId: string, days = 30): Promise<DailyStats[]> {
    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceStr = since.toISOString().slice(0, 10)

    const rows = await this.db
      .select()
      .from(dailyStats)
      .where(and(eq(dailyStats.userId, userId), gte(dailyStats.date, sinceStr)))
      .orderBy(desc(dailyStats.date))

    return rows.map((r) => ({
      date: r.date,
      reviewed: r.reviewed,
      correct: r.correct,
      newLearned: r.newLearned,
      burned: r.burned,
      studyTimeMs: r.studyTimeMs,
    }))
  }

  // ── Velocity: reviews per day average + trend ───────────────────────────────

  async getVelocityMetrics(userId: string): Promise<VelocityMetrics> {
    const now = new Date()

    // Last 7 days
    const week = new Date(now)
    week.setDate(week.getDate() - 7)
    const weekStr = week.toISOString().slice(0, 10)

    // Last 30 days
    const month = new Date(now)
    month.setDate(month.getDate() - 30)
    const monthStr = month.toISOString().slice(0, 10)

    const [weekRow] = await this.db
      .select({ avg: sql<number>`ROUND(AVG(reviewed)::numeric, 1)` })
      .from(dailyStats)
      .where(and(eq(dailyStats.userId, userId), gte(dailyStats.date, weekStr)))

    const [monthRow] = await this.db
      .select({ avg: sql<number>`ROUND(AVG(reviewed)::numeric, 1)` })
      .from(dailyStats)
      .where(and(eq(dailyStats.userId, userId), gte(dailyStats.date, monthStr)))

    const weeklyAverage = Number(weekRow?.avg ?? 0)
    const dailyAverage = Number(monthRow?.avg ?? 0)

    // Burned per day (30-day avg from daily_stats.burned)
    const [burnedRow] = await this.db
      .select({ avg: sql<number>`ROUND(AVG(burned)::numeric, 2)` })
      .from(dailyStats)
      .where(and(eq(dailyStats.userId, userId), gte(dailyStats.date, monthStr)))

    const burnedPerDay = Number(burnedRow?.avg ?? 0)

    // Trend: compare this week vs previous week
    const prevWeek = new Date(week)
    prevWeek.setDate(prevWeek.getDate() - 7)
    const prevWeekStr = prevWeek.toISOString().slice(0, 10)

    const [prevWeekRow] = await this.db
      .select({ avg: sql<number>`ROUND(AVG(reviewed)::numeric, 1)` })
      .from(dailyStats)
      .where(
        and(
          eq(dailyStats.userId, userId),
          gte(dailyStats.date, prevWeekStr),
          lte(dailyStats.date, weekStr)
        )
      )

    const prevWeekAvg = Number(prevWeekRow?.avg ?? 0)
    const trend = this.calculateTrend(weeklyAverage, prevWeekAvg)

    // Per-JLPT seen counts (all non-unseen statuses), grouped by level
    const levelSeenRows = await this.db
      .select({
        jlptLevel: kanji.jlptLevel,
        status: userKanjiProgress.status,
        count: sql<number>`count(*)::int`,
      })
      .from(userKanjiProgress)
      .innerJoin(kanji, eq(userKanjiProgress.kanjiId, kanji.id))
      .where(
        and(
          eq(userKanjiProgress.userId, userId),
          sql`${userKanjiProgress.status} != 'unseen'`
        )
      )
      .groupBy(kanji.jlptLevel, userKanjiProgress.status)

    const seenByLevel: Record<string, { seen: number; burned: number }> = {}
    for (const row of levelSeenRows) {
      if (!seenByLevel[row.jlptLevel]) seenByLevel[row.jlptLevel] = { seen: 0, burned: 0 }
      seenByLevel[row.jlptLevel].seen += Number(row.count)
      if (row.status === 'burned') seenByLevel[row.jlptLevel].burned += Number(row.count)
    }

    // Build per-level projections (N5 → N1)
    const levelProjections: JlptLevelProjection[] = JLPT_LEVELS.map((level) => {
      const total = JLPT_KANJI_COUNTS[level]
      const { seen = 0, burned = 0 } = seenByLevel[level] ?? {}
      const remaining = Math.max(0, total - burned)
      const projectedDate =
        burnedPerDay > 0 && remaining > 0
          ? new Date(now.getTime() + (remaining / burnedPerDay) * 24 * 60 * 60 * 1000)
          : null
      return { level, total, seen, burned, remaining, projectedDate }
    })

    const nextMilestone = levelProjections.find((lp) => lp.remaining > 0) ?? null

    // Total projected completion using burnedPerDay
    const totalRemaining = levelProjections.reduce((sum, lp) => sum + lp.remaining, 0)
    const projectedCompletion =
      burnedPerDay > 0 && totalRemaining > 0
        ? new Date(now.getTime() + (totalRemaining / burnedPerDay) * 24 * 60 * 60 * 1000)
        : null

    return { dailyAverage, weeklyAverage, burnedPerDay, trend, projectedCompletion, levelProjections, nextMilestone }
  }

  // ── Confidence breakdown by review type (SRS quality grades) ───────────────

  async getConfidenceByType(userId: string, days = 30): Promise<Record<string, { total: number; correct: number; pct: number }>> {
    const since = new Date()
    since.setDate(since.getDate() - days)

    const rows = await this.db
      .select({
        reviewType: reviewLogs.reviewType,
        total: sql<number>`count(*)::int`,
        // quality >= 4 (Good/Easy) = confident recall; Hard (3) counts as reviewed but not "correct"
        correct: sql<number>`count(*) filter (where ${reviewLogs.quality} >= 4)::int`,
      })
      .from(reviewLogs)
      .where(and(eq(reviewLogs.userId, userId), gte(reviewLogs.reviewedAt, since)))
      .groupBy(reviewLogs.reviewType)

    const result: Record<string, { total: number; correct: number; pct: number }> = {}
    for (const row of rows) {
      const total = Number(row.total)
      const correct = Number(row.correct)
      result[row.reviewType] = { total, correct, pct: total > 0 ? Math.round((correct / total) * 100) : 0 }
    }
    return result
  }

  // ── Confidence rate over last N days (SRS quality grades) ──────────────────

  async getConfidenceRate(userId: string, days = 30): Promise<number> {
    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceStr = since.toISOString().slice(0, 10)

    const rows = await this.db
      .select({
        totalReviewed: sql<number>`SUM(reviewed)::int`,
        totalCorrect: sql<number>`SUM(correct)::int`,
      })
      .from(dailyStats)
      .where(and(eq(dailyStats.userId, userId), gte(dailyStats.date, sinceStr)))

    const total = Number(rows[0]?.totalReviewed ?? 0)
    const correct = Number(rows[0]?.totalCorrect ?? 0)
    return total > 0 ? Math.round((correct / total) * 100) : 0
  }

  // ── Quiz accuracy (from kl_test_results) ───────────────────────────────────

  async getQuizAccuracy(userId: string, days = 30): Promise<{ overall: number; byType: Record<string, { total: number; correct: number; pct: number }> }> {
    const since = new Date()
    since.setDate(since.getDate() - days)

    // Overall accuracy
    const [overall] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        correct: sql<number>`count(*) filter (where correct = true)::int`,
      })
      .from(testResults)
      .where(and(eq(testResults.userId, userId), gte(testResults.createdAt, since)))

    // By question type
    const typeRows = await this.db
      .select({
        questionType: testResults.questionType,
        total: sql<number>`count(*)::int`,
        correct: sql<number>`count(*) filter (where correct = true)::int`,
      })
      .from(testResults)
      .where(and(eq(testResults.userId, userId), gte(testResults.createdAt, since)))
      .groupBy(testResults.questionType)

    const totalAll = Number(overall?.total ?? 0)
    const correctAll = Number(overall?.correct ?? 0)
    const overallPct = totalAll > 0 ? Math.round((correctAll / totalAll) * 100) : 0

    const byType: Record<string, { total: number; correct: number; pct: number }> = {}
    for (const row of typeRows) {
      const t = Number(row.total)
      const c = Number(row.correct)
      byType[row.questionType] = { total: t, correct: c, pct: t > 0 ? Math.round((c / t) * 100) : 0 }
    }

    return { overall: overallPct, byType }
  }

  // ── Full summary for dashboard ──────────────────────────────────────────────

  async getSummary(userId: string) {
    const [velocity, confidence, confidenceByType, quizAccuracy, statusCounts, streakDays, recentStats, jlptProgress, writing, voice] =
      await Promise.all([
        this.getVelocityMetrics(userId),
        this.getConfidenceRate(userId),
        this.getConfidenceByType(userId),
        this.getQuizAccuracy(userId),
        this.getStatusCounts(userId),
        this.getStreakDays(userId),
        this.getDailyStats(userId, 90), // fetch 90d so chart period selector works client-side
        this.getJlptProgress(userId),
        this.getWritingStats(userId),
        this.getVoiceStats(userId),
      ])

    const totalSeen = TOTAL_JOUYOU_KANJI - statusCounts.unseen
    const completionPct = Math.round((statusCounts.burned / TOTAL_JOUYOU_KANJI) * 100)

    return {
      velocity,
      confidence,
      confidenceByType,
      quizAccuracy,
      statusCounts,
      jlptProgress,
      streakDays,
      recentStats,
      totalSeen,
      completionPct,
      writing,
      voice,
    }
  }

  // ── Writing practice stats ─────────────────────────────────────────────────

  async getWritingStats(userId: string) {
    const [agg] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        avgScore: sql<number>`ROUND(AVG(score)::numeric * 100, 1)`,
        passed: sql<number>`count(*) filter (where score >= 0.7)::int`,
      })
      .from(writingAttempts)
      .where(eq(writingAttempts.userId, userId))

    const total = Number(agg?.total ?? 0)
    const avgScore = Number(agg?.avgScore ?? 0)
    const passRate = total > 0 ? Math.round((Number(agg?.passed ?? 0) / total) * 100) : 0

    const worstRows = await this.db
      .select({
        kanjiId: writingAttempts.kanjiId,
        character: kanji.character,
        avgScore: sql<number>`ROUND(AVG(${writingAttempts.score})::numeric * 100, 1)`,
      })
      .from(writingAttempts)
      .innerJoin(kanji, eq(writingAttempts.kanjiId, kanji.id))
      .where(eq(writingAttempts.userId, userId))
      .groupBy(writingAttempts.kanjiId, kanji.character)
      .having(sql`count(*) >= 2`)
      .orderBy(sql`AVG(${writingAttempts.score})`)
      .limit(5)

    return {
      totalAttempts: total,
      avgScore,
      passRate,
      worstKanji: worstRows.map((r) => ({ kanjiId: r.kanjiId, character: r.character, avgScore: Number(r.avgScore) })),
    }
  }

  // ── Voice practice stats ───────────────────────────────────────────────────

  async getVoiceStats(userId: string) {
    const [agg] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        correct: sql<number>`count(*) filter (where passed = true)::int`,
      })
      .from(voiceAttempts)
      .where(eq(voiceAttempts.userId, userId))

    const total = Number(agg?.total ?? 0)
    const correctPct = total > 0 ? Math.round((Number(agg?.correct ?? 0) / total) * 100) : 0

    const worstRows = await this.db
      .select({
        kanjiId: voiceAttempts.kanjiId,
        character: kanji.character,
        correctPct: sql<number>`ROUND(count(*) filter (where passed = true)::numeric / count(*) * 100, 1)`,
      })
      .from(voiceAttempts)
      .innerJoin(kanji, eq(voiceAttempts.kanjiId, kanji.id))
      .where(eq(voiceAttempts.userId, userId))
      .groupBy(voiceAttempts.kanjiId, kanji.character)
      .having(sql`count(*) >= 2`)
      .orderBy(sql`count(*) filter (where passed = true)::numeric / count(*)`)
      .limit(5)

    return {
      totalAttempts: total,
      correctPct,
      worstKanji: worstRows.map((r) => ({ kanjiId: r.kanjiId, character: r.character, correctPct: Number(r.correctPct) })),
    }
  }

  // ── Per-JLPT-level seen counts ─────────────────────────────────────────────

  async getJlptProgress(userId: string): Promise<Record<string, { learning: number; reviewing: number; remembered: number; burned: number }>> {
    const rows = await this.db
      .select({
        jlptLevel: kanji.jlptLevel,
        status: userKanjiProgress.status,
        count: sql<number>`count(*)::int`,
      })
      .from(userKanjiProgress)
      .innerJoin(kanji, eq(userKanjiProgress.kanjiId, kanji.id))
      .where(
        and(
          eq(userKanjiProgress.userId, userId),
          sql`${userKanjiProgress.status} != 'unseen'`
        )
      )
      .groupBy(kanji.jlptLevel, userKanjiProgress.status)

    const result: Record<string, { learning: number; reviewing: number; remembered: number; burned: number }> = {}
    for (const row of rows) {
      if (!result[row.jlptLevel]) {
        result[row.jlptLevel] = { learning: 0, reviewing: 0, remembered: 0, burned: 0 }
      }
      const st = row.status as keyof typeof result[string]
      if (st in result[row.jlptLevel]) {
        result[row.jlptLevel][st] = Number(row.count)
      }
    }
    return result
  }

  // ── Streak: consecutive days with at least 1 review ────────────────────────

  async getStreakDays(userId: string): Promise<number> {
    const rows = await this.db
      .select({ date: dailyStats.date, reviewed: dailyStats.reviewed })
      .from(dailyStats)
      .where(and(eq(dailyStats.userId, userId), gte(dailyStats.reviewed, 1)))
      .orderBy(desc(dailyStats.date))
      .limit(365)

    if (rows.length === 0) return 0

    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

    // Streak must start from today or yesterday — otherwise it's broken
    if (rows[0].date !== today && rows[0].date !== yesterday) return 0

    let streak = 1
    let expected = new Date(rows[0].date)
    expected.setDate(expected.getDate() - 1)

    for (let i = 1; i < rows.length; i++) {
      if (rows[i].date === expected.toISOString().slice(0, 10)) {
        streak++
        expected.setDate(expected.getDate() - 1)
      } else {
        break
      }
    }

    return streak
  }

  // ── Check for velocity drop (intervention trigger) ─────────────────────────

  async hasVelocityDrop(userId: string): Promise<boolean> {
    const { weeklyAverage } = await this.getVelocityMetrics(userId)

    // Get previous week average for comparison
    const twoWeeksAgo = new Date()
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
    const oneWeekAgo = new Date()
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)

    const [prevRow] = await this.db
      .select({ avg: sql<number>`ROUND(AVG(reviewed)::numeric, 1)` })
      .from(dailyStats)
      .where(
        and(
          eq(dailyStats.userId, userId),
          gte(dailyStats.date, twoWeeksAgo.toISOString().slice(0, 10)),
          lte(dailyStats.date, oneWeekAgo.toISOString().slice(0, 10))
        )
      )

    const prevAvg = Number(prevRow?.avg ?? 0)
    if (prevAvg === 0) return false

    return weeklyAverage < prevAvg * (1 - VELOCITY_DROP_THRESHOLD)
  }

  // ── Check for plateau (no new status advances in N days) ───────────────────

  async hasPlateaued(userId: string): Promise<boolean> {
    const since = new Date()
    since.setDate(since.getDate() - PLATEAU_DAYS_THRESHOLD)

    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(reviewLogs)
      .where(
        and(
          eq(reviewLogs.userId, userId),
          gte(reviewLogs.reviewedAt, since),
          sql`${reviewLogs.nextStatus} != ${reviewLogs.prevStatus}`
        )
      )

    return Number(row?.count ?? 0) === 0
  }

  // ── Session history ────────────────────────────────────────────────────────

  async getSessionHistory(userId: string, limit = 20, offset = 0) {
    const rows = await this.db
      .select({
        id: reviewSessions.id,
        startedAt: reviewSessions.startedAt,
        completedAt: reviewSessions.completedAt,
        totalItems: reviewSessions.totalItems,
        correctItems: reviewSessions.correctItems,
        studyTimeMs: reviewSessions.studyTimeMs,
        sessionType: reviewSessions.sessionType,
      })
      .from(reviewSessions)
      .where(and(eq(reviewSessions.userId, userId), sql`${reviewSessions.completedAt} is not null`))
      .orderBy(desc(reviewSessions.startedAt))
      .limit(limit)
      .offset(offset)

    return rows.map((r) => ({
      id: r.id,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      totalItems: r.totalItems,
      correctItems: r.correctItems,
      accuracyPct: r.totalItems > 0 ? Math.round((r.correctItems / r.totalItems) * 100) : 0,
      studyTimeMs: r.studyTimeMs,
      sessionType: r.sessionType,
    }))
  }

  // ── Upsert daily stats after a session ────────────────────────────────────

  async upsertDailyStats(
    userId: string,
    date: string,
    delta: {
      reviewed: number
      correct: number
      newLearned: number
      burned: number
      studyTimeMs: number
    }
  ): Promise<void> {
    await this.db
      .insert(dailyStats)
      .values({
        userId,
        date,
        reviewed:   delta.reviewed,
        correct:    delta.correct,
        newLearned: delta.newLearned,
        burned:     delta.burned,
        studyTimeMs: delta.studyTimeMs,
      })
      .onConflictDoUpdate({
        target: [dailyStats.userId, dailyStats.date],
        set: {
          reviewed:    sql`${dailyStats.reviewed}    + EXCLUDED.reviewed`,
          correct:     sql`${dailyStats.correct}     + EXCLUDED.correct`,
          newLearned:  sql`${dailyStats.newLearned}  + EXCLUDED.new_learned`,
          burned:      sql`${dailyStats.burned}      + EXCLUDED.burned`,
          studyTimeMs: sql`${dailyStats.studyTimeMs} + EXCLUDED.study_time_ms`,
        },
      })
  }

  // ── Weekly summary (last 7 days) — for Watch rest-day message ─────────────

  async getWeeklySummary(userId: string): Promise<{
    reviewed: number
    newLearned: number
    burned: number
    accuracyPct: number
    streakDays: number
  }> {
    const since = new Date()
    since.setDate(since.getDate() - 7)
    const sinceStr = since.toISOString().slice(0, 10)

    const [row] = await this.db
      .select({
        reviewed:   sql<number>`COALESCE(SUM(reviewed), 0)::int`,
        newLearned: sql<number>`COALESCE(SUM(new_learned), 0)::int`,
        burned:     sql<number>`COALESCE(SUM(burned), 0)::int`,
        correct:    sql<number>`COALESCE(SUM(correct), 0)::int`,
      })
      .from(dailyStats)
      .where(and(eq(dailyStats.userId, userId), gte(dailyStats.date, sinceStr)))

    const reviewed   = Number(row?.reviewed ?? 0)
    const correct    = Number(row?.correct ?? 0)
    const accuracyPct = reviewed > 0 ? Math.round((correct / reviewed) * 100) : 0
    const streakDays  = await this.getStreakDays(userId)

    return {
      reviewed,
      newLearned: Number(row?.newLearned ?? 0),
      burned:     Number(row?.burned ?? 0),
      accuracyPct,
      streakDays,
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private calculateTrend(current: number, previous: number): 'up' | 'down' | 'stable' {
    if (previous === 0) return current > 0 ? 'up' : 'stable'
    const change = (current - previous) / previous
    if (change > 0.1) return 'up'
    if (change < -0.1) return 'down'
    return 'stable'
  }

  private async getRemainingKanjiCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(userKanjiProgress)
      .where(
        and(
          eq(userKanjiProgress.userId, userId),
          eq(userKanjiProgress.status, 'burned')
        )
      )

    const burned = Number(row?.count ?? 0)
    return Math.max(0, TOTAL_JOUYOU_KANJI - burned)
  }

  private async getStatusCounts(userId: string) {
    const rows = await this.db
      .select({
        status: userKanjiProgress.status,
        count: sql<number>`count(*)::int`,
      })
      .from(userKanjiProgress)
      .where(eq(userKanjiProgress.userId, userId))
      .groupBy(userKanjiProgress.status)

    const counts = Object.fromEntries(rows.map((r) => [r.status, r.count]))
    const seen = rows.reduce((sum, r) => sum + r.count, 0)

    return {
      unseen: Math.max(0, TOTAL_JOUYOU_KANJI - seen),
      learning: 0,
      reviewing: 0,
      remembered: 0,
      burned: 0,
      ...counts,
    }
  }
}
