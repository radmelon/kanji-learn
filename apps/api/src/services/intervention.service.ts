import { and, eq, isNull, desc } from 'drizzle-orm'
import { interventions, userProfiles, dailyStats } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import { AnalyticsService } from './analytics.service.js'
import { ABSENCE_THRESHOLD_HOURS } from '@kanji-learn/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

export type InterventionType = 'absence' | 'velocity_drop' | 'plateau'

export interface InterventionPayload {
  absence: { lastSeenAt: string; hoursAgo: number }
  velocity_drop: { currentAvg: number; previousAvg: number; dropPct: number }
  plateau: { daysSinceProgress: number }
}

export interface ActiveIntervention {
  id: string
  type: InterventionType
  triggeredAt: Date
  payload: Record<string, unknown>
}

// ─── Intervention Engine ──────────────────────────────────────────────────────

export class InterventionService {
  private analytics: AnalyticsService

  constructor(private db: Db) {
    this.analytics = new AnalyticsService(db)
  }

  // ── Run all checks for a user ───────────────────────────────────────────────
  // Called after each session completion and on daily cron.

  async runChecks(userId: string): Promise<ActiveIntervention[]> {
    const triggered: ActiveIntervention[] = []

    const [absence, velocityDrop, plateau] = await Promise.all([
      this.checkAbsence(userId),
      this.analytics.hasVelocityDrop(userId),
      this.analytics.hasPlateaued(userId),
    ])

    if (absence) {
      const intervention = await this.trigger(userId, 'absence', absence)
      triggered.push(intervention)
    }

    if (velocityDrop) {
      const alreadyOpen = await this.hasOpenIntervention(userId, 'velocity_drop')
      if (!alreadyOpen) {
        const velocity = await this.analytics.getVelocityMetrics(userId)
        const intervention = await this.trigger(userId, 'velocity_drop', {
          currentAvg: velocity.weeklyAverage,
          previousAvg: 0, // resolved inside analytics
          dropPct: 0,
        })
        triggered.push(intervention)
      }
    }

    if (plateau) {
      const alreadyOpen = await this.hasOpenIntervention(userId, 'plateau')
      if (!alreadyOpen) {
        const intervention = await this.trigger(userId, 'plateau', {
          daysSinceProgress: 7,
        })
        triggered.push(intervention)
      }
    }

    return triggered
  }

  // ── Resolve an intervention (user acknowledged / resumed) ──────────────────

  async resolve(userId: string, interventionId: string): Promise<void> {
    await this.db
      .update(interventions)
      .set({ resolvedAt: new Date() })
      .where(
        and(
          eq(interventions.id, interventionId),
          eq(interventions.userId, userId),
          isNull(interventions.resolvedAt)
        )
      )
  }

  // ── Get all unresolved interventions for a user ────────────────────────────

  async getActive(userId: string): Promise<ActiveIntervention[]> {
    const rows = await this.db
      .select()
      .from(interventions)
      .where(and(eq(interventions.userId, userId), isNull(interventions.resolvedAt)))
      .orderBy(desc(interventions.triggeredAt))

    return rows.map((r) => ({
      id: r.id,
      type: r.type as InterventionType,
      triggeredAt: r.triggeredAt,
      payload: r.payload as Record<string, unknown>,
    }))
  }

  // ── Resolve all on session start (user is back) ────────────────────────────

  async resolveAbsenceOnActivity(userId: string): Promise<void> {
    await this.db
      .update(interventions)
      .set({ resolvedAt: new Date() })
      .where(
        and(
          eq(interventions.userId, userId),
          eq(interventions.type, 'absence'),
          isNull(interventions.resolvedAt)
        )
      )
  }

  // ── Build intervention message for mobile push ─────────────────────────────

  buildMessage(intervention: ActiveIntervention): string {
    switch (intervention.type) {
      case 'absence': {
        const hours = (intervention.payload.hoursAgo as number) ?? 48
        const days = Math.round(hours / 24)
        return days >= 2
          ? `You haven't studied in ${days} days. Your reviews are piling up — let's get back on track!`
          : `It's been ${hours} hours. Even 5 minutes keeps your streak alive!`
      }
      case 'velocity_drop': {
        const pct = Math.round(((intervention.payload.dropPct as number) ?? 0) * 100)
        return `Your review pace dropped ${pct}% this week. Want to set a lighter daily goal?`
      }
      case 'plateau': {
        const days = (intervention.payload.daysSinceProgress as number) ?? 7
        return `No new kanji mastered in ${days} days. Try a focused session on your weakest cards!`
      }
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async checkAbsence(
    userId: string
  ): Promise<InterventionPayload['absence'] | null> {
    // Get the most recent daily_stats entry
    const [latest] = await this.db
      .select({ date: dailyStats.date })
      .from(dailyStats)
      .where(and(eq(dailyStats.userId, userId), /* reviewed > 0 */ eq(dailyStats.reviewed, 0).not() as any))
      .orderBy(desc(dailyStats.date))
      .limit(1)

    if (!latest) {
      // Never studied — check account age
      const [profile] = await this.db
        .select({ createdAt: userProfiles.createdAt })
        .from(userProfiles)
        .where(eq(userProfiles.id, userId))

      if (!profile) return null
      const hoursAgo = (Date.now() - profile.createdAt.getTime()) / (1000 * 60 * 60)
      if (hoursAgo < ABSENCE_THRESHOLD_HOURS) return null
      return { lastSeenAt: profile.createdAt.toISOString(), hoursAgo: Math.round(hoursAgo) }
    }

    const lastDate = new Date(latest.date + 'T00:00:00Z')
    const hoursAgo = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60)

    if (hoursAgo < ABSENCE_THRESHOLD_HOURS) return null

    // Don't fire if there's already an open absence intervention
    const alreadyOpen = await this.hasOpenIntervention(userId, 'absence')
    if (alreadyOpen) return null

    return { lastSeenAt: lastDate.toISOString(), hoursAgo: Math.round(hoursAgo) }
  }

  private async hasOpenIntervention(
    userId: string,
    type: InterventionType
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ id: interventions.id })
      .from(interventions)
      .where(
        and(
          eq(interventions.userId, userId),
          eq(interventions.type, type),
          isNull(interventions.resolvedAt)
        )
      )
      .limit(1)

    return !!row
  }

  private async trigger(
    userId: string,
    type: InterventionType,
    payload: Record<string, unknown>
  ): Promise<ActiveIntervention> {
    const id = crypto.randomUUID()
    const triggeredAt = new Date()

    await this.db.insert(interventions).values({ id, userId, type, payload, triggeredAt })

    return { id, type, triggeredAt, payload }
  }
}
