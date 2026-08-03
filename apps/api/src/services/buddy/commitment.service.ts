import { and, desc, eq, gt, gte, isNull, lte, ne } from 'drizzle-orm'
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

  /**
   * Consecutive missed appointments, derived rather than stored (spec §8.1).
   *
   * `excludeWeekStart` — the period currently being evaluated by the pass.
   * `ensureForWeek` writes THIS period's `rolled_forward` row before the pass
   * asks for the miss count, so without excluding it a learner is stepped
   * down on the morning of their third appointment, before they could have
   * attended it — the spec means three COMPLETED misses (fix for the
   * off-by-one in the weekly-buddy-review pre-merge review).
   *
   * `sinceCadenceChangedAt` — only rows whose period began AFTER this
   * timestamp count. Without it, the very next hourly pass after a step-down
   * re-evaluates the SAME miss streak (the window just widened) and steps
   * the learner down again immediately — the fortnightly tier was otherwise
   * unreachable. A cadence change resets the count.
   */
  async getMissCount(
    userId: string,
    options: { excludeWeekStart?: string; sinceCadenceChangedAt?: Date | null } = {},
  ): Promise<number> {
    const { excludeWeekStart, sinceCadenceChangedAt } = options

    const conditions = [eq(buddyCommitments.userId, userId)]
    if (excludeWeekStart) {
      conditions.push(ne(buddyCommitments.weekStart, excludeWeekStart))
    }
    if (sinceCadenceChangedAt) {
      // Compare on the calendar date the period began, not the instant —
      // week_start is a plain date. Anything at or before the cadence
      // change's own day is the streak that caused it, not a new miss.
      const sinceDate = sinceCadenceChangedAt.toISOString().slice(0, 10)
      conditions.push(gt(buddyCommitments.weekStart, sinceDate))
    }

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
      .where(and(...conditions))
      .orderBy(desc(buddyCommitments.weekStart))
      .limit(12)

    return countConsecutiveRolledForward(
      rows.map((r) => ({ weekStart: r.weekStart, source: r.source as CommitmentSource }))
    )
  }

  /**
   * Buddy session dates, newest first — `HookSnapshot.sessionDates`.
   *
   * `source='session'` IS this app's definition of "a Buddy session happened":
   * getMostRecentAgreed above filters exactly this way, and both
   * buddy-session.ts and notification.service.ts feed that to
   * evaluateAppointment as `lastSessionDate`. There is no buddy_sessions table
   * and inventing a second definition would let two parts of the system
   * disagree about the same learner.
   */
  async getSessionDates(userId: string, limit = 10): Promise<string[]> {
    const rows = await this.db.select({ weekStart: buddyCommitments.weekStart })
      .from(buddyCommitments)
      .where(and(
        eq(buddyCommitments.userId, userId),
        eq(buddyCommitments.source, 'session'),
      ))
      .orderBy(desc(buddyCommitments.weekStart))
      .limit(limit)
    return rows.map((r) => r.weekStart)
  }

  /**
   * The most recent commitment period that has ENDED.
   *
   * `commitment_gap` is a statement about a finished period, which is what the
   * weekly session is for. Handing it the CURRENT period means that at the
   * instant a commitment is agreed, `actualMinutes` is 0 against a full
   * promise: magnitude 1.0, confidence 1 (set deliberately -- "a promise and a
   * measurement"), novelty 1.0. Buddy would greet a learner who just committed
   * to four days a week with "you studied less than you promised yourself",
   * and repeat it at the start of every period after that.
   *
   * `default` is excluded: assembleNotebook already treats it as "the learner
   * agreed nothing", and buddy_commitments.source's own schema comment says a
   * missed rolled_forward is not a broken promise because the learner never
   * turned up to agree it. `default` is weaker still. `rolled_forward` IS
   * included -- the register difference is §8's frankness escalator (slice 6).
   */
  async getLastCompletedPeriod(
    userId: string,
    now: string,
    intervalWeeks: number,
  ): Promise<{
    weekStart: string
    periodStart: string
    periodEnd: string
    promisedMinutes: number
  } | null> {
    const periodDays = 7 * intervalWeeks
    const today = now.slice(0, 10)

    const rows = await this.db.select().from(buddyCommitments)
      .where(and(
        eq(buddyCommitments.userId, userId),
        ne(buddyCommitments.source, 'default'),
        isNull(buddyCommitments.supersededAt),
      ))
      .orderBy(desc(buddyCommitments.weekStart))

    for (const row of rows) {
      const periodEnd = addDays(row.weekStart, periodDays)
      if (periodEnd > today) continue
      return {
        weekStart: row.weekStart,
        periodStart: row.weekStart,
        periodEnd,
        promisedMinutes: row.minutesPerDay * row.daysCommitted,
      }
    }
    return null
  }
}
