import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { buddyCommitments, dailyStats } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import {
  addDays,
  countConsecutiveRolledForward,
  rollForward,
  type Commitment,
  type CommitmentSource,
  type DayActivity,
} from '@kanji-learn/shared'

const PERIOD_DAYS = 7

type Row = typeof buddyCommitments.$inferSelect

function toCommitment(row: Row): Commitment {
  return {
    weekStart: row.weekStart,
    daysCommitted: row.daysCommitted,
    dayTargets: row.dayTargets ?? null,
    minutesPerDay: row.minutesPerDay,
    focus: row.focus ?? null,
    source: row.source as CommitmentSource,
  }
}

export class CommitmentService {
  constructor(private readonly db: Db) {}

  async getForWeek(userId: string, weekStart: string): Promise<Commitment | null> {
    const rows = await this.db.select().from(buddyCommitments)
      .where(and(eq(buddyCommitments.userId, userId), eq(buddyCommitments.weekStart, weekStart)))
      .limit(1)
    return rows[0] ? toCommitment(rows[0]) : null
  }

  async getMostRecentBefore(userId: string, weekStart: string): Promise<Commitment | null> {
    const rows = await this.db.select().from(buddyCommitments)
      .where(and(
        eq(buddyCommitments.userId, userId),
        lte(buddyCommitments.weekStart, addDays(weekStart, -1)),
      ))
      .orderBy(desc(buddyCommitments.weekStart))
      .limit(1)
    return rows[0] ? toCommitment(rows[0]) : null
  }

  /** The most recent commitment the learner actually agreed to. */
  async getMostRecentAgreed(userId: string): Promise<Commitment | null> {
    const rows = await this.db.select().from(buddyCommitments)
      .where(and(eq(buddyCommitments.userId, userId), eq(buddyCommitments.source, 'session')))
      .orderBy(desc(buddyCommitments.weekStart))
      .limit(1)
    return rows[0] ? toCommitment(rows[0]) : null
  }

  /**
   * Guarantee that `weekStart` has a commitment, carrying the previous one
   * forward if the learner did not attend. Idempotent: safe to call from the
   * hourly pass and from a session read in the same minute, because
   * `onConflictDoNothing` leans on the (user_id, week_start) unique index
   * rather than a read-then-write race.
   */
  async ensureForWeek(userId: string, weekStart: string): Promise<Commitment> {
    const existing = await this.getForWeek(userId, weekStart)
    if (existing) return existing

    const previous = await this.getMostRecentBefore(userId, weekStart)
    const next = rollForward(previous, weekStart)

    await this.db.insert(buddyCommitments).values({
      userId,
      weekStart: next.weekStart,
      daysCommitted: next.daysCommitted,
      dayTargets: next.dayTargets,
      minutesPerDay: next.minutesPerDay,
      focus: next.focus,
      source: next.source,
    }).onConflictDoNothing()

    // Re-read rather than trusting `next`: a concurrent writer may have won.
    return (await this.getForWeek(userId, weekStart)) ?? next
  }

  /** Write an agreed commitment, replacing whatever was carried. */
  async setForWeek(userId: string, commitment: Commitment): Promise<Commitment> {
    await this.db.insert(buddyCommitments).values({
      userId,
      weekStart: commitment.weekStart,
      daysCommitted: commitment.daysCommitted,
      dayTargets: commitment.dayTargets,
      minutesPerDay: commitment.minutesPerDay,
      focus: commitment.focus,
      source: commitment.source,
    }).onConflictDoUpdate({
      target: [buddyCommitments.userId, buddyCommitments.weekStart],
      set: {
        daysCommitted: commitment.daysCommitted,
        dayTargets: commitment.dayTargets,
        minutesPerDay: commitment.minutesPerDay,
        focus: commitment.focus,
        source: commitment.source,
        agreedAt: new Date(),
      },
    })
    return commitment
  }

  /** The seven days of a period, with absent days present and zeroed. */
  async getActivity(userId: string, weekStart: string): Promise<DayActivity[]> {
    const weekEnd = addDays(weekStart, PERIOD_DAYS - 1)

    const rows = await this.db.select({
      date: dailyStats.date,
      reviewed: dailyStats.reviewed,
      studyTimeMs: dailyStats.studyTimeMs,
    })
      .from(dailyStats)
      .where(and(
        eq(dailyStats.userId, userId),
        gte(dailyStats.date, weekStart),
        lte(dailyStats.date, weekEnd),
      ))

    const byDate = new Map(rows.map((r) => [r.date, r]))

    return Array.from({ length: PERIOD_DAYS }, (_, i) => {
      const date = addDays(weekStart, i)
      const row = byDate.get(date)
      return {
        date,
        reviewed: row?.reviewed ?? 0,
        studyMinutes: Math.round((row?.studyTimeMs ?? 0) / 60_000),
      }
    })
  }

  /** Consecutive missed appointments, derived rather than stored (spec §8.1). */
  async getMissCount(userId: string): Promise<number> {
    // Capped at the last 12 periods (~3 months). A streak of rolled-forward
    // rows longer than that would be undercounted, but the step-down
    // threshold in the reckoning is 3, so anything past that already reads
    // as "maximally missed" — raise this cap only if a caller ever needs the
    // exact streak length beyond 12.
    const rows = await this.db.select({
      weekStart: buddyCommitments.weekStart,
      source: buddyCommitments.source,
    })
      .from(buddyCommitments)
      .where(eq(buddyCommitments.userId, userId))
      .orderBy(desc(buddyCommitments.weekStart))
      .limit(12)

    return countConsecutiveRolledForward(
      rows.map((r) => ({ weekStart: r.weekStart, source: r.source as CommitmentSource }))
    )
  }
}
