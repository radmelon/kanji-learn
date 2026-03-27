import { and, eq, gte, desc, sql, lte } from 'drizzle-orm'
import { dailyStats, reviewLogs, userKanjiProgress } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import type { DailyStats, VelocityMetrics } from '@kanji-learn/shared'
import {
  VELOCITY_DROP_THRESHOLD,
  PLATEAU_DAYS_THRESHOLD,
  TOTAL_JOUYOU_KANJI,
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

    // Projected completion
    const remainingKanji = await this.getRemainingKanjiCount(userId)
    const projectedCompletion =
      dailyAverage > 0
        ? new Date(now.getTime() + (remainingKanji / dailyAverage) * 24 * 60 * 60 * 1000)
        : null

    return { dailyAverage, weeklyAverage, trend, projectedCompletion }
  }

  // ── Accuracy rate over last N days ─────────────────────────────────────────

  async getAccuracyRate(userId: string, days = 30): Promise<number> {
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

  // ── Full summary for dashboard ──────────────────────────────────────────────

  async getSummary(userId: string) {
    const [velocity, accuracy, statusCounts, streakDays, recentStats] = await Promise.all([
      this.getVelocityMetrics(userId),
      this.getAccuracyRate(userId),
      this.getStatusCounts(userId),
      this.getStreakDays(userId),
      this.getDailyStats(userId, 7),
    ])

    const totalSeen = TOTAL_JOUYOU_KANJI - statusCounts.unseen
    const completionPct = Math.round((statusCounts.burned / TOTAL_JOUYOU_KANJI) * 100)

    return {
      velocity,
      accuracy,
      statusCounts,
      streakDays,
      recentStats,
      totalSeen,
      completionPct,
    }
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

    let streak = 0
    const today = new Date().toISOString().slice(0, 10)
    let expected = today

    for (const row of rows) {
      if (row.date === expected) {
        streak++
        const d = new Date(expected)
        d.setDate(d.getDate() - 1)
        expected = d.toISOString().slice(0, 10)
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
      .values({ userId, date, ...delta })
      .onConflictDoUpdate({
        target: [dailyStats.userId, dailyStats.date],
        set: {
          reviewed: sql`daily_stats.reviewed + ${delta.reviewed}`,
          correct: sql`daily_stats.correct + ${delta.correct}`,
          newLearned: sql`daily_stats.new_learned + ${delta.newLearned}`,
          burned: sql`daily_stats.burned + ${delta.burned}`,
          studyTimeMs: sql`daily_stats.study_time_ms + ${delta.studyTimeMs}`,
        },
      })
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
