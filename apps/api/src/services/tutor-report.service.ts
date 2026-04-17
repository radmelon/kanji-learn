import { and, desc, eq, gte, sql } from 'drizzle-orm'
import {
  userProfiles,
  learnerProfiles,
  userKanjiProgress,
  dailyStats,
  reviewLogs,
  reviewSessions,
  placementSessions,
  tutorAnalysisCache,
  tutorNotes,
  kanji,
  testResults,
  writingAttempts,
} from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'

// ─── ReportData interface ────────────────────────────────────────────────────

export interface ReportData {
  student: {
    displayName: string | null
    email: string | null
    createdAt: Date
    dailyGoal: number
    restDay: number | null
    country: string | null
    reasonsForLearning: string[]
    interests: string[]
  }
  placement: {
    sessions: { id: string; completedAt: Date | null; inferredLevel: string | null; summaryJson: any }[]
  }
  progress: {
    statusCounts: Record<string, number>
    jlptBreakdown: Record<string, Record<string, number>>
    totalSeen: number
    completionPct: number
    rememberedCount: number
  }
  effort: {
    dailyStats30: { date: string; reviewed: number; correct: number; studyTimeMs: number }[]
    dailyStats90: { date: string; reviewed: number; correct: number; studyTimeMs: number }[]
    avgSessionsPerDay: number
    weekendVsWeekdayRatio: number
  }
  velocity: {
    dailyAvg: number
    weeklyAvg: number
    trend: string
    currentStreak: number
    longestStreak: number
  }
  quizAccuracy: {
    byType: Record<string, { total: number; correct: number; pct: number }>
    weakestModality: string | null
    leechCount: number
    topLeeches: { kanjiId: number; character: string; failCount: number }[]
  }
  confidence: {
    byType: Record<string, { total: number; correct: number; pct: number }>
  }
  writing: {
    totalAttempts: number
    avgScore: number
    passRate: number
    worstKanji: { kanjiId: number; character: string; avgScore: number }[]
  }
  analysis: {
    strengths: string[]
    areasForImprovement: string[]
    recommendations: string[]
    observations: string[]
    generatedAt: string
  } | null
  notes: { id: string; noteText: string; createdAt: Date }[]
}

// ─── TutorReportService ──────────────────────────────────────────────────────

const TOTAL_JOUYOU_KANJI = 2136

export class TutorReportService {
  constructor(private db: Db) {}

  // ── Main entry point ───────────────────────────────────────────────────────

  async buildReport(userId: string, shareId: string): Promise<ReportData> {
    const [student, learner, placement, progress, effort, velocity, quizAccuracy, confidence, writing, analysis, notes] =
      await Promise.all([
        this.getStudent(userId),
        this.getLearner(userId),
        this.getPlacement(userId),
        this.getProgress(userId),
        this.getEffort(userId),
        this.getVelocity(userId),
        this.getQuizAccuracy(userId),
        this.getConfidence(userId),
        this.getWriting(userId),
        this.getAnalysis(userId),
        this.getNotes(shareId),
      ])
    return { student: { ...student, ...learner }, placement, progress, effort, velocity, quizAccuracy, confidence, writing, analysis, notes }
  }

  // ── Student profile ────────────────────────────────────────────────────────

  private async getStudent(userId: string) {
    const row = await this.db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, userId),
    })
    return {
      displayName: row?.displayName ?? null,
      email: row?.email ?? null,
      createdAt: row?.createdAt ?? new Date(),
      dailyGoal: row?.dailyGoal ?? 20,
      restDay: row?.restDay ?? null,
    }
  }

  // ── Learner profile ────────────────────────────────────────────────────────

  private async getLearner(userId: string) {
    const row = await this.db.query.learnerProfiles.findFirst({
      where: eq(learnerProfiles.userId, userId),
    })
    return {
      country: row?.country ?? null,
      reasonsForLearning: row?.reasonsForLearning ?? [],
      interests: row?.interests ?? [],
    }
  }

  // ── Placement sessions ─────────────────────────────────────────────────────

  private async getPlacement(userId: string) {
    const rows = await this.db
      .select({
        id: placementSessions.id,
        completedAt: placementSessions.completedAt,
        inferredLevel: placementSessions.inferredLevel,
        summaryJson: placementSessions.summaryJson,
      })
      .from(placementSessions)
      .where(eq(placementSessions.userId, userId))
      .orderBy(placementSessions.startedAt)

    return {
      sessions: rows.map((r) => ({
        id: r.id,
        completedAt: r.completedAt,
        inferredLevel: r.inferredLevel,
        summaryJson: r.summaryJson,
      })),
    }
  }

  // ── Progress ───────────────────────────────────────────────────────────────

  private async getProgress(userId: string) {
    // Status counts and JLPT breakdown in one query
    const rows = await this.db
      .select({
        status: userKanjiProgress.status,
        jlptLevel: kanji.jlptLevel,
        count: sql<number>`count(*)::int`,
      })
      .from(userKanjiProgress)
      .innerJoin(kanji, eq(userKanjiProgress.kanjiId, kanji.id))
      .where(eq(userKanjiProgress.userId, userId))
      .groupBy(userKanjiProgress.status, kanji.jlptLevel)

    const statusCounts: Record<string, number> = {}
    const jlptBreakdown: Record<string, Record<string, number>> = {}

    for (const row of rows) {
      const count = Number(row.count)
      statusCounts[row.status] = (statusCounts[row.status] ?? 0) + count
      if (!jlptBreakdown[row.jlptLevel]) jlptBreakdown[row.jlptLevel] = {}
      jlptBreakdown[row.jlptLevel][row.status] = (jlptBreakdown[row.jlptLevel][row.status] ?? 0) + count
    }

    const unseenCount = statusCounts['unseen'] ?? 0
    const totalSeen = Object.entries(statusCounts)
      .filter(([status]) => status !== 'unseen')
      .reduce((sum, [, count]) => sum + count, 0)

    const completionPct = Math.round((totalSeen / TOTAL_JOUYOU_KANJI) * 100)
    const rememberedCount = await this.computeRememberedCount(userId)

    return { statusCounts, jlptBreakdown, totalSeen, completionPct, rememberedCount }
  }

  // ── Remembered count (last 5 reviews all quality >= 3, spanning >= 14 days) ─

  private async computeRememberedCount(userId: string): Promise<number> {
    const rows = await this.db.execute(sql`
      WITH ranked AS (
        SELECT
          kanji_id,
          quality,
          reviewed_at,
          ROW_NUMBER() OVER (PARTITION BY kanji_id ORDER BY reviewed_at DESC) AS rn,
          COUNT(*) OVER (PARTITION BY kanji_id) AS total_reviews
        FROM review_logs
        WHERE user_id = ${userId}
      ),
      last5 AS (
        SELECT
          kanji_id,
          MIN(reviewed_at) AS oldest_of_5,
          MAX(reviewed_at) AS newest_of_5,
          COUNT(*) FILTER (WHERE quality >= 3) AS correct_count
        FROM ranked
        WHERE rn <= 5 AND total_reviews >= 5
        GROUP BY kanji_id
      )
      SELECT COUNT(*)::int AS remembered_count
      FROM last5
      WHERE correct_count = 5
        AND (newest_of_5 - oldest_of_5) >= INTERVAL '14 days'
    `)
    return Number((rows[0] as any)?.remembered_count ?? 0)
  }

  // ── Effort ─────────────────────────────────────────────────────────────────

  private async getEffort(userId: string) {
    const now = new Date()

    const since30 = new Date(now)
    since30.setDate(since30.getDate() - 30)
    const since30Str = since30.toISOString().slice(0, 10)

    const since90 = new Date(now)
    since90.setDate(since90.getDate() - 90)
    const since90Str = since90.toISOString().slice(0, 10)

    const [rows30, rows90, sessionRows] = await Promise.all([
      this.db
        .select({
          date: dailyStats.date,
          reviewed: dailyStats.reviewed,
          correct: dailyStats.correct,
          studyTimeMs: dailyStats.studyTimeMs,
        })
        .from(dailyStats)
        .where(and(eq(dailyStats.userId, userId), gte(dailyStats.date, since30Str)))
        .orderBy(dailyStats.date),

      this.db
        .select({
          date: dailyStats.date,
          reviewed: dailyStats.reviewed,
          correct: dailyStats.correct,
          studyTimeMs: dailyStats.studyTimeMs,
        })
        .from(dailyStats)
        .where(and(eq(dailyStats.userId, userId), gte(dailyStats.date, since90Str)))
        .orderBy(dailyStats.date),

      this.db
        .select({ startedAt: reviewSessions.startedAt })
        .from(reviewSessions)
        .where(
          and(
            eq(reviewSessions.userId, userId),
            gte(reviewSessions.startedAt, since30),
            sql`${reviewSessions.completedAt} is not null`
          )
        ),
    ])

    // avgSessionsPerDay over 30-day window
    const avgSessionsPerDay = Math.round((sessionRows.length / 30) * 10) / 10

    // Weekend vs weekday ratio (reviews)
    let weekendReviewed = 0
    let weekdayReviewed = 0
    let weekendDays = 0
    let weekdayDays = 0

    for (const row of rows30) {
      const dayOfWeek = new Date(row.date).getUTCDay() // 0=Sun, 6=Sat
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
      if (isWeekend) {
        weekendReviewed += row.reviewed
        weekendDays++
      } else {
        weekdayReviewed += row.reviewed
        weekdayDays++
      }
    }

    const weekendAvg = weekendDays > 0 ? weekendReviewed / weekendDays : 0
    const weekdayAvg = weekdayDays > 0 ? weekdayReviewed / weekdayDays : 0
    const weekendVsWeekdayRatio = weekdayAvg > 0 ? Math.round((weekendAvg / weekdayAvg) * 100) / 100 : 0

    return {
      dailyStats30: rows30.map((r) => ({ date: r.date, reviewed: r.reviewed, correct: r.correct, studyTimeMs: r.studyTimeMs })),
      dailyStats90: rows90.map((r) => ({ date: r.date, reviewed: r.reviewed, correct: r.correct, studyTimeMs: r.studyTimeMs })),
      avgSessionsPerDay,
      weekendVsWeekdayRatio,
    }
  }

  // ── Velocity ───────────────────────────────────────────────────────────────

  private async getVelocity(userId: string) {
    const now = new Date()

    const since30 = new Date(now)
    since30.setDate(since30.getDate() - 30)
    const since30Str = since30.toISOString().slice(0, 10)

    const since7 = new Date(now)
    since7.setDate(since7.getDate() - 7)
    const since7Str = since7.toISOString().slice(0, 10)

    const [monthRow, weekRow, allRows] = await Promise.all([
      this.db
        .select({ avg: sql<number>`ROUND(AVG(reviewed)::numeric, 1)` })
        .from(dailyStats)
        .where(and(eq(dailyStats.userId, userId), gte(dailyStats.date, since30Str))),

      this.db
        .select({ avg: sql<number>`ROUND(AVG(reviewed)::numeric, 1)` })
        .from(dailyStats)
        .where(and(eq(dailyStats.userId, userId), gte(dailyStats.date, since7Str))),

      // All daily stats ordered desc for streak calculation
      this.db
        .select({ date: dailyStats.date, reviewed: dailyStats.reviewed })
        .from(dailyStats)
        .where(and(eq(dailyStats.userId, userId), gte(dailyStats.reviewed, 1)))
        .orderBy(desc(dailyStats.date))
        .limit(730), // 2 years max
    ])

    const dailyAvg = Number(monthRow[0]?.avg ?? 0)
    const weeklyAvg = Number(weekRow[0]?.avg ?? 0)

    // Trend: compare first 15 days vs last 15 days of 30-day window
    const [firstHalfRow, secondHalfRow] = await Promise.all([
      this.db
        .select({ avg: sql<number>`ROUND(AVG(reviewed)::numeric, 1)` })
        .from(dailyStats)
        .where(
          and(
            eq(dailyStats.userId, userId),
            gte(dailyStats.date, since30Str),
            sql`${dailyStats.date} < ${new Date(now.getTime() - 15 * 86_400_000).toISOString().slice(0, 10)}`
          )
        ),
      this.db
        .select({ avg: sql<number>`ROUND(AVG(reviewed)::numeric, 1)` })
        .from(dailyStats)
        .where(
          and(
            eq(dailyStats.userId, userId),
            gte(dailyStats.date, new Date(now.getTime() - 15 * 86_400_000).toISOString().slice(0, 10))
          )
        ),
    ])

    const firstHalfAvg = Number(firstHalfRow[0]?.avg ?? 0)
    const secondHalfAvg = Number(secondHalfRow[0]?.avg ?? 0)
    let trend = 'stable'
    if (firstHalfAvg > 0) {
      const ratio = secondHalfAvg / firstHalfAvg
      if (ratio > 1.2) trend = 'accelerating'
      else if (ratio < 0.8) trend = 'decelerating'
    }

    // Current streak and longest streak from allRows
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

    let currentStreak = 0
    let longestStreak = 0
    let runningStreak = 0
    let expected: Date | null = null

    for (let i = 0; i < allRows.length; i++) {
      const rowDate = allRows[i].date

      if (i === 0) {
        // Streak must begin from today or yesterday
        if (rowDate === today || rowDate === yesterday) {
          runningStreak = 1
          expected = new Date(rowDate)
          expected.setDate(expected.getDate() - 1)
          currentStreak = 1
        } else {
          // No active streak — still scan for longest
          runningStreak = 1
          expected = new Date(rowDate)
          expected.setDate(expected.getDate() - 1)
        }
      } else {
        if (expected && rowDate === expected.toISOString().slice(0, 10)) {
          runningStreak++
          if (i < allRows.length && currentStreak > 0) currentStreak = runningStreak
          expected.setDate(expected.getDate() - 1)
        } else {
          runningStreak = 1
          expected = new Date(rowDate)
          expected.setDate(expected.getDate() - 1)
        }
      }

      if (runningStreak > longestStreak) longestStreak = runningStreak
    }

    return { dailyAvg, weeklyAvg, trend, currentStreak, longestStreak }
  }

  // ── Quiz Accuracy (from test results) ──────────────────────────────────────

  private async getQuizAccuracy(userId: string) {
    const since30 = new Date()
    since30.setDate(since30.getDate() - 30)

    const [typeRows, leechRows] = await Promise.all([
      this.db
        .select({
          questionType: testResults.questionType,
          total: sql<number>`count(*)::int`,
          correct: sql<number>`count(*) filter (where ${testResults.correct} = true)::int`,
        })
        .from(testResults)
        .where(and(eq(testResults.userId, userId), gte(testResults.createdAt, since30)))
        .groupBy(testResults.questionType),

      // Top leeches: kanji with >= 3 failures (quality < 3) in last 30 days (still from review_logs)
      this.db.execute(sql`
        SELECT
          rl.kanji_id AS "kanjiId",
          k.character,
          COUNT(*) FILTER (WHERE rl.quality < 3)::int AS "failCount"
        FROM review_logs rl
        JOIN kanji k ON k.id = rl.kanji_id
        WHERE rl.user_id = ${userId}
          AND rl.reviewed_at >= ${since30.toISOString()}
        GROUP BY rl.kanji_id, k.character
        HAVING COUNT(*) FILTER (WHERE rl.quality < 3) >= 3
        ORDER BY "failCount" DESC
        LIMIT 5
      `),
    ])

    const byType: Record<string, { total: number; correct: number; pct: number }> = {}
    for (const row of typeRows) {
      const total = Number(row.total)
      const correct = Number(row.correct)
      byType[row.questionType] = { total, correct, pct: total > 0 ? Math.round((correct / total) * 100) : 0 }
    }

    // Weakest modality = lowest accuracy among types with >= 10 total
    let weakestModality: string | null = null
    let lowestPct = Infinity
    for (const [type, stats] of Object.entries(byType)) {
      if (stats.total >= 10 && stats.pct < lowestPct) {
        lowestPct = stats.pct
        weakestModality = type
      }
    }

    const topLeeches = (leechRows as any[]).map((r) => ({
      kanjiId: Number(r.kanjiId),
      character: r.character as string,
      failCount: Number(r.failCount),
    }))

    return {
      byType,
      weakestModality,
      leechCount: topLeeches.length,
      topLeeches,
    }
  }

  // ── Review Confidence (from SRS review_logs) ─────────────────────────────

  private async getConfidence(userId: string) {
    const since30 = new Date()
    since30.setDate(since30.getDate() - 30)

    const typeRows = await this.db
      .select({
        reviewType: reviewLogs.reviewType,
        total: sql<number>`count(*)::int`,
        correct: sql<number>`count(*) filter (where ${reviewLogs.quality} >= 4)::int`,
      })
      .from(reviewLogs)
      .where(and(eq(reviewLogs.userId, userId), gte(reviewLogs.reviewedAt, since30)))
      .groupBy(reviewLogs.reviewType)

    const byType: Record<string, { total: number; correct: number; pct: number }> = {}
    for (const row of typeRows) {
      const total = Number(row.total)
      const correct = Number(row.correct)
      byType[row.reviewType] = { total, correct, pct: total > 0 ? Math.round((correct / total) * 100) : 0 }
    }

    return { byType }
  }

  // ── Writing Performance ───────────────────────────────────────────────────

  private async getWriting(userId: string) {
    const [statsRows, worstRows] = await Promise.all([
      this.db
        .select({
          totalAttempts: sql<number>`count(*)::int`,
          avgScore: sql<number>`ROUND(AVG(${writingAttempts.score})::numeric * 100, 1)`,
          passRate: sql<number>`ROUND(COUNT(*) FILTER (WHERE ${writingAttempts.score} >= 0.7)::numeric / NULLIF(COUNT(*), 0) * 100, 1)`,
        })
        .from(writingAttempts)
        .where(eq(writingAttempts.userId, userId)),

      this.db
        .select({
          kanjiId: writingAttempts.kanjiId,
          character: kanji.character,
          avgScore: sql<number>`ROUND(AVG(${writingAttempts.score})::numeric * 100, 1)`,
        })
        .from(writingAttempts)
        .innerJoin(kanji, eq(writingAttempts.kanjiId, kanji.id))
        .where(eq(writingAttempts.userId, userId))
        .groupBy(writingAttempts.kanjiId, kanji.character)
        .having(sql`COUNT(*) >= 2`)
        .orderBy(sql`AVG(${writingAttempts.score}) ASC`)
        .limit(5),
    ])

    const stats = statsRows[0]
    return {
      totalAttempts: Number(stats?.totalAttempts ?? 0),
      avgScore: Number(stats?.avgScore ?? 0),
      passRate: Number(stats?.passRate ?? 0),
      worstKanji: worstRows.map((r) => ({
        kanjiId: Number(r.kanjiId),
        character: r.character,
        avgScore: Number(r.avgScore),
      })),
    }
  }

  // ── Analysis cache ─────────────────────────────────────────────────────────

  private async getAnalysis(userId: string) {
    const row = await this.db.query.tutorAnalysisCache.findFirst({
      where: eq(tutorAnalysisCache.userId, userId),
    })
    if (!row) return null
    const data = row.analysisJson as any
    return {
      strengths: data?.strengths ?? [],
      areasForImprovement: data?.areasForImprovement ?? [],
      recommendations: data?.recommendations ?? [],
      observations: data?.observations ?? [],
      generatedAt: row.generatedAt.toISOString(),
    }
  }

  // ── Tutor notes ────────────────────────────────────────────────────────────

  private async getNotes(shareId: string) {
    const rows = await this.db.query.tutorNotes.findMany({
      where: eq(tutorNotes.shareId, shareId),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    })
    return rows.map((r) => ({ id: r.id, noteText: r.noteText, createdAt: r.createdAt }))
  }
}
