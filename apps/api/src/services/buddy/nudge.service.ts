// apps/api/src/services/buddy/nudge.service.ts
//
// Phase 1' rule engine. Two public entry points:
//
//   - evaluateNudgesForScreen(userId, screen) — pull path, called by
//     GET /v1/buddy/nudges. Runs the rule check, lazily INSERTs, then
//     SELECTs and returns all currently-active rows for that screen.
//
//   - maybeFireMilestoneNudges(userId, newState) — push path, called
//     from srs.service.ts's setImmediate chain after a successful
//     review submission. INSERTs the Dashboard streak row and fires
//     Expo push exactly once per milestone.

import { and, eq, gt, isNull, sql, desc } from 'drizzle-orm'
import { buddyNudges, learnerStateCache } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import type { BuddyNudge, BuddyScreen } from '@kanji-learn/shared'
import type { NotificationService } from '../notification.service'
import { isStreakMilestone, streakContent, STREAK_MILESTONES } from './templates/streak'
import { MEET_BUDDY_CONTENT } from './templates/meet-buddy'

const STREAK_PRIORITY = 5
const MEET_BUDDY_PRIORITY = 10
const STREAK_EXPIRY_DAYS = 30
const MEET_BUDDY_EXPIRY_YEARS = 10

export class NudgeService {
  constructor(
    private readonly db: Db,
    private readonly notifier: NotificationService,
  ) {}

  /**
   * Pull path. Called by GET /v1/buddy/nudges.
   * Lazily inserts any nudges the rules dictate for (user, screen),
   * then returns all currently-active rows for that screen.
   */
  async evaluateNudgesForScreen(userId: string, screen: BuddyScreen): Promise<BuddyNudge[]> {
    // Run the rules; ignore returned rows (we re-SELECT below to include
    // any pre-existing rows the rule didn't touch).
    const streakFired = await this.maybeInsertStreak(userId, screen)
    if (screen === 'dashboard' && !streakFired) await this.maybeInsertMeetBuddy(userId)

    const rows = await this.db
      .select()
      .from(buddyNudges)
      .where(
        and(
          eq(buddyNudges.userId, userId),
          eq(buddyNudges.screen, screen),
          isNull(buddyNudges.dismissedAt),
          gt(buddyNudges.expiresAt, sql`NOW()`),
        ),
      )
      .orderBy(desc(buddyNudges.priority), desc(buddyNudges.createdAt))
      .limit(2)

    return rows as unknown as BuddyNudge[]
  }

  private async maybeInsertStreak(userId: string, screen: BuddyScreen): Promise<boolean> {
    if (screen !== 'dashboard' && screen !== 'study') return false

    const cache = await this.db.query.learnerStateCache.findFirst({
      where: eq(learnerStateCache.userId, userId),
    })
    if (!cache) return false

    const days = cache.currentStreakDays
    if (!isStreakMilestone(days)) return false

    const expiresAt = new Date(Date.now() + STREAK_EXPIRY_DAYS * 86_400_000)
    await this.db
      .insert(buddyNudges)
      .values({
        userId,
        screen,
        nudgeType: 'streak',
        content: streakContent(days),
        actionType: 'dismiss',
        actionPayload: { kind: 'streak_milestone', milestone: days },
        priority: STREAK_PRIORITY,
        deliveryTarget: 'all',
        expiresAt,
        generatedBy: 'template',
        socialFraming: false,
      })
      .onConflictDoNothing()

    return true
  }

  private async maybeInsertMeetBuddy(userId: string): Promise<void> {
    const expiresAt = new Date(Date.now() + MEET_BUDDY_EXPIRY_YEARS * 365 * 86_400_000)
    await this.db
      .insert(buddyNudges)
      .values({
        userId,
        screen: 'dashboard',
        nudgeType: 'encouragement',
        content: MEET_BUDDY_CONTENT,
        actionType: 'dismiss',
        actionPayload: { kind: 'meet_buddy' },
        priority: MEET_BUDDY_PRIORITY,
        deliveryTarget: 'app',
        expiresAt,
        generatedBy: 'template',
        socialFraming: false,
      })
      .onConflictDoNothing()
  }

  /**
   * Push path. Called from srs.service.ts after a successful refresh.
   * Inserts the Dashboard streak row for any newly-tripped milestone
   * and fires push exactly once per milestone (the Study Ready mirror
   * is inserted by the pull path, without firing another push).
   */
  async maybeFireMilestoneNudges(
    userId: string,
    newState: { currentStreakDays: number },
  ): Promise<void> {
    const days = newState.currentStreakDays
    if (!isStreakMilestone(days)) return

    const expiresAt = new Date(Date.now() + STREAK_EXPIRY_DAYS * 86_400_000)
    const inserted = await this.db
      .insert(buddyNudges)
      .values({
        userId,
        screen: 'dashboard',
        nudgeType: 'streak',
        content: streakContent(days),
        actionType: 'dismiss',
        actionPayload: { kind: 'streak_milestone', milestone: days },
        priority: STREAK_PRIORITY,
        deliveryTarget: 'all',
        expiresAt,
        generatedBy: 'template',
        socialFraming: false,
      })
      .onConflictDoNothing()
      .returning()

    if (inserted.length > 0) {
      await this.notifier.sendBuddyNudgePush(userId, inserted[0] as unknown as BuddyNudge)
    }
  }
}
