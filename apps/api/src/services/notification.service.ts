import { Expo, type ExpoPushMessage } from 'expo-server-sdk'
import { and, eq, gte, inArray, or, sql } from 'drizzle-orm'
import { userProfiles, dailyStats, friendships, userPushTokens } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'

// Expo ticket error strings that mean "this token will never work again."
// Anything else (e.g. MessageRateExceeded) is transient — leave the row alone.
const DEAD_TOKEN_ERRORS = new Set(['DeviceNotRegistered', 'InvalidCredentials', 'MessageTooBig'])

// Module-level frequency cap for study-mate alerts.
// Key: "${submitterId}:${recipientId}" → last-sent timestamp (ms).
// Lives for process lifetime; restarts reset it (acceptable for the current cap).
// Exported so tests can reset between cases without leaking entries across
// unrelated fixtures. See mateNotifyCapMs inside notifyStudyMates() for the
// current window length.
/** @internal — exported only for tests (beforeEach clear). Do not call from production code. */
export const mateNotifyCache = new Map<string, number>()

const expo = new Expo()

// ─── Message copy ─────────────────────────────────────────────────────────────

function buildMessage(
  streakDays: number,
  dueCount: number,
  reviewedToday: number,
): { title: string; body: string } {
  // Encouragement copy when the user has already studied today. Without this
  // branch the daily cron was silent for daily studiers, which made reminders
  // feel broken and prevented feedback that the streak was landing.
  if (reviewedToday > 0) {
    if (streakDays >= 7) {
      return {
        title: `🔥 ${streakDays}-day streak — keep the fire going!`,
        body: dueCount > 0
          ? `${reviewedToday} kanji down today. ${dueCount} more waiting — one more round?`
          : `${reviewedToday} kanji reviewed today. Beautiful work.`,
      }
    }
    if (streakDays >= 2) {
      return {
        title: `⚡ Nice — ${streakDays} days in a row`,
        body: dueCount > 0
          ? `${reviewedToday} done today. ${dueCount} more are ready when you are.`
          : `${reviewedToday} kanji reviewed today. Extend the streak tomorrow!`,
      }
    }
    return {
      title: '✅ Nice work today!',
      body: dueCount > 0
        ? `${reviewedToday} kanji done — ${dueCount} more waiting if you want another round.`
        : `${reviewedToday} kanji reviewed. Come back tomorrow to build the streak.`,
    }
  }

  // Reminder copy when the user hasn't studied yet today.
  if (streakDays >= 7) {
    return {
      title: `🔥 ${streakDays}-day streak — don't stop now!`,
      body: dueCount > 0
        ? `You have ${dueCount} kanji waiting for review.`
        : 'Keep the momentum going with today\'s session.',
    }
  }
  if (streakDays >= 2) {
    return {
      title: `⚡ ${streakDays} days in a row!`,
      body: dueCount > 0
        ? `${dueCount} kanji are ready for review.`
        : 'A quick review keeps the streak alive.',
    }
  }
  if (streakDays === 1) {
    return {
      title: '📖 Time to study!',
      body: dueCount > 0
        ? `You have ${dueCount} kanji due today.`
        : 'Even a short session builds momentum.',
    }
  }
  return {
    title: '🀄 Your kanji are waiting',
    body: dueCount > 0
      ? `${dueCount} kanji are ready — pick up where you left off!`
      : 'Come back and keep building your vocabulary.',
  }
}

function buildRestDayMessage(stats: { reviewed: number; burned: number; streakDays: number }): { title: string; body: string } {
  const { reviewed, burned, streakDays } = stats

  let title = '🎉 Rest day — you earned it!'
  let body: string

  if (streakDays >= 7) {
    body = `${streakDays}-day streak! This week: ${reviewed} kanji reviewed${burned > 0 ? `, ${burned} burned 🔥` : ''}. Tomorrow brings fresh cards.`
  } else if (burned > 0) {
    body = `You burned ${burned} kanji this week — locked in! Enjoy the rest day. Study on your Watch anytime.`
  } else if (reviewed >= 30) {
    body = `${reviewed} kanji reviewed this week — solid consistency! Take a break; tomorrow your cards will be ready.`
  } else {
    body = `Great effort this week. Rest days recharge your memory. Your Watch is always ready when you are!`
  }

  return { title, body }
}

// ─── Notification Service ─────────────────────────────────────────────────────

export class NotificationService {
  constructor(private db: Db) {}

  // Daily reminder cron — called every hour; only sends to users whose reminderHour matches now in their timezone
  async sendDailyReminders(): Promise<void> {
    const nowUtc = new Date()
    const today = nowUtc.toISOString().slice(0, 10)

    // Find all notification-enabled users plus how many kanji they've reviewed
    // today. Both "hasn't studied yet" and "already studied" paths get a push —
    // buildMessage branches copy based on reviewedToday so daily studiers hear
    // encouragement instead of silence. Multi-device fan-out happens in
    // sendToUserTokens — we no longer filter by a profile-level push token.
    const users = await this.db
      .select({
        id: userProfiles.id,
        timezone: userProfiles.timezone,
        reminderHour: userProfiles.reminderHour,
        restDay: userProfiles.restDay,
        reviewedToday: sql<number>`COALESCE(${dailyStats.reviewed}, 0)`,
      })
      .from(userProfiles)
      .leftJoin(
        dailyStats,
        and(eq(dailyStats.userId, userProfiles.id), eq(dailyStats.date, today)),
      )
      .where(eq(userProfiles.notificationsEnabled, true))

    // Filter to only users whose local hour matches their reminderHour, skipping rest days
    const utcHour = nowUtc.getUTCHours()
    const eligibleUsers = users.filter((u) => {
      try {
        const localDate = new Date(nowUtc.toLocaleString('en-US', { timeZone: u.timezone ?? 'UTC' }))
        // Skip if today is the user's designated rest day (0=Sun … 6=Sat)
        if (u.restDay != null && localDate.getDay() === u.restDay) return false
        return localDate.getHours() === (u.reminderHour ?? 20)
      } catch {
        // Invalid timezone — fall back to UTC
        if (u.restDay != null && nowUtc.getUTCDay() === u.restDay) return false
        return utcHour === (u.reminderHour ?? 20)
      }
    })

    if (eligibleUsers.length === 0) return

    let sent = 0
    for (const user of eligibleUsers) {
      const streak = await this.getUserStreak(user.id)
      const dueCount = await this.getDueCount(user.id)
      const { title, body } = buildMessage(streak, dueCount, user.reviewedToday)

      const result = await this.sendToUserTokens(user.id, {
        title,
        body,
        sound: 'default',
        data: { type: 'daily_reminder' },
      })
      if (result.sent > 0) sent++
    }

    if (sent > 0) {
      console.log(`[Notifications] Sent ${sent} daily reminders (UTC ${utcHour}:00)`)
    }
  }

  // Notify a user's friends when they complete a study session.
  // Called fire-and-forget from the POST /v1/review/submit route.
  // Respects: notificationsEnabled, per-friendship mute, 24-hour frequency cap.
  async notifyStudyMates(submitterId: string, reviewedCount: number): Promise<void> {
    const submitter = await this.db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, submitterId),
      columns: { displayName: true },
    })
    const name = submitter?.displayName ?? 'Your study mate'

    const rows = await this.db.query.friendships.findMany({
      where: and(
        or(
          eq(friendships.requesterId, submitterId),
          eq(friendships.addresseeId, submitterId),
        ),
        eq(friendships.status, 'accepted'),
      ),
      with: {
        requester: { columns: { id: true, notificationsEnabled: true } },
        addressee: { columns: { id: true, notificationsEnabled: true } },
      },
    })

    const now = Date.now()
    // Testing-phase cap: 2h while Buddy + Bucky are exercising mate-alerts on a
    // two-account, two-device setup. Restore to 24h before public launch.
    const mateNotifyCapMs = 2 * 60 * 60 * 1000

    for (const row of rows) {
      const friend = row.requesterId === submitterId ? row.addressee : row.requester

      // Defensive self-exclusion: a friendship row with requesterId === addresseeId
      // (or any future bug that lands the submitter in their own friend list) must
      // never push "your mate just studied" back to the submitter.
      if (friend.id === submitterId) continue

      // Master switch — kills all pushes to this user.
      if (!friend.notificationsEnabled) continue

      // Per-friendship mute — recipient controls their own side. If submitter is
      // the requester, the recipient is the addressee, so read the addressee's column.
      const recipientNotifyOn = row.requesterId === submitterId
        ? row.addresseeNotifyOfActivity
        : row.requesterNotifyOfActivity
      if (!recipientNotifyOn) continue

      // Frequency cap: max 1 alert per submitter–recipient pair per window.
      // Check AFTER mute — muted sends never enter the cache so unmuting takes
      // effect immediately, not after a cooldown.
      const cacheKey = `${submitterId}:${friend.id}`
      const lastSent = mateNotifyCache.get(cacheKey) ?? 0
      if (now - lastSent < mateNotifyCapMs) continue

      await this.sendToUserTokens(friend.id, {
        title: `📚 ${name} just studied!`,
        body: `They reviewed ${reviewedCount} kanji today. Ready to match them?`,
        sound: 'default',
        data: { type: 'mate_activity', friendId: submitterId },
      })
      // Best-effort prune: sweep entries older than the cap. Called from the write
      // path so the sweep cost scales with actual send volume, not a separate timer.
      const cutoff = now - mateNotifyCapMs
      for (const [key, ts] of mateNotifyCache) {
        if (ts < cutoff) mateNotifyCache.delete(key)
      }
      mateNotifyCache.set(cacheKey, now)
    }
  }

  // Notify a user that someone has sent them a study-mate request.
  // Called fire-and-forget from POST /v1/social/request after the row is
  // created. Respects only the master notificationsEnabled switch — friend
  // requests are a low-frequency social signal and don't merit an extra
  // per-user mute beyond the master toggle.
  async notifyIncomingFriendRequest(recipientId: string, requesterName: string | null): Promise<void> {
    const recipient = await this.db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, recipientId),
      columns: { notificationsEnabled: true },
    })
    if (!recipient?.notificationsEnabled) return

    const name = requesterName?.trim() ? requesterName.trim() : 'Someone'
    await this.sendToUserTokens(recipientId, {
      title: '🤝 New study-mate request',
      body: `${name} wants to study together. Tap to view.`,
      sound: 'default',
      data: { type: 'friend_request', requesterName: name },
    })
  }

  // Send rest-day weekly summary notifications.
  // Called hourly by the cron alongside sendDailyReminders().
  // Only fires for users whose local hour == reminderHour AND today == restDay.
  async sendRestDaySummaries(): Promise<void> {
    const nowUtc = new Date()

    // Fetch users who have a rest day configured and notifications on.
    // Multi-device fan-out happens in sendToUserTokens — we no longer filter
    // by a profile-level push token.
    const users = await this.db
      .select({
        id:          userProfiles.id,
        timezone:    userProfiles.timezone,
        reminderHour: userProfiles.reminderHour,
        restDay:     userProfiles.restDay,
      })
      .from(userProfiles)
      .where(
        and(
          eq(userProfiles.notificationsEnabled, true),
          sql`${userProfiles.restDay} IS NOT NULL`
        )
      )

    const utcHour = nowUtc.getUTCHours()

    for (const user of users) {
      if (user.restDay == null) continue

      // Determine local hour and weekday for this user
      let localHour: number
      let localWeekday: number
      try {
        const localDate = new Date(nowUtc.toLocaleString('en-US', { timeZone: user.timezone ?? 'UTC' }))
        localHour    = localDate.getHours()
        localWeekday = localDate.getDay() // 0=Sun … 6=Sat
      } catch {
        localHour    = utcHour
        localWeekday = nowUtc.getUTCDay()
      }

      // Only fire at reminderHour on restDay
      if (localWeekday !== user.restDay) continue
      if (localHour !== (user.reminderHour ?? 20)) continue

      // Build weekly summary for the message body
      const stats = await this.getWeeklyStats(user.id)
      const { title, body } = buildRestDayMessage(stats)

      await this.sendToUserTokens(user.id, {
        title,
        body,
        sound: 'default',
        data: { type: 'rest_day_summary' },
      })
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async getUserStreak(userId: string): Promise<number> {
    const rows = await this.db
      .select({ date: dailyStats.date })
      .from(dailyStats)
      .where(and(eq(dailyStats.userId, userId), gte(dailyStats.reviewed, 1)))
      .orderBy(sql`date DESC`)
      .limit(365)

    if (rows.length === 0) return 0
    let streak = 0
    const d = new Date()
    d.setDate(d.getDate() - 1) // yesterday (they haven't studied today yet)
    let expected = d.toISOString().slice(0, 10)

    for (const row of rows) {
      if (row.date === expected) {
        streak++
        const next = new Date(expected)
        next.setDate(next.getDate() - 1)
        expected = next.toISOString().slice(0, 10)
      } else break
    }
    return streak
  }

  private async getDueCount(userId: string): Promise<number> {
    // Use ISO string so postgres.js binds the timestamp param correctly — a raw
    // Date object throws "argument must be of type string" when the driver
    // tries to serialize it for the Bind message.
    const nowIso = new Date().toISOString()
    const [row] = await this.db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int as count FROM user_kanji_progress
          WHERE user_id = ${userId}
          AND (next_review_at IS NULL OR next_review_at <= ${nowIso})`
    )
    return Number(row?.count ?? 0)
  }

  private async getWeeklyStats(userId: string): Promise<{ reviewed: number; burned: number; streakDays: number }> {
    const since = new Date()
    since.setDate(since.getDate() - 7)
    const sinceStr = since.toISOString().slice(0, 10)

    const [row] = await this.db
      .select({
        reviewed: sql<number>`COALESCE(SUM(reviewed), 0)::int`,
        burned:   sql<number>`COALESCE(SUM(burned), 0)::int`,
      })
      .from(dailyStats)
      .where(and(eq(dailyStats.userId, userId), gte(dailyStats.date, sinceStr)))

    const streak = await this.getUserStreak(userId)
    return {
      reviewed: Number(row?.reviewed ?? 0),
      burned:   Number(row?.burned ?? 0),
      streakDays: streak,
    }
  }

  // Fan out a single notification payload to every push token this user has
  // registered (multi-device). Synchronously prunes tokens that ticket with a
  // terminal error so the next send doesn't re-hit dead devices.
  async sendToUserTokens(
    userId: string,
    message: Omit<ExpoPushMessage, 'to'>,
  ): Promise<{ sent: number; pruned: number }> {
    // Cap at 100 rows — Expo's batch API hard limit. At ~2 devices/user today
    // this can't trip, but it's cheap defense against sticky-token leaks.
    const rows = await this.db
      .select({ token: userPushTokens.token })
      .from(userPushTokens)
      .where(eq(userPushTokens.userId, userId))
      .limit(100)

    if (rows.length === 0) {
      return { sent: 0, pruned: 0 }
    }

    const messages: ExpoPushMessage[] = rows.map((r) => ({ ...message, to: r.token }))
    const tickets = await expo.sendPushNotificationsAsync(messages)

    const dead: string[] = []
    tickets.forEach((ticket, i) => {
      if (ticket.status === 'error' && DEAD_TOKEN_ERRORS.has(ticket.details?.error ?? '')) {
        dead.push(rows[i].token)
      }
    })

    if (dead.length > 0) {
      await this.db
        .delete(userPushTokens)
        .where(and(eq(userPushTokens.userId, userId), inArray(userPushTokens.token, dead)))
    }

    // Only log when something observable happened — avoids log spam from the
    // common zero-activity path.
    if (tickets.length > 0 || dead.length > 0) {
      console.log(`[Push] userId=${userId} sent=${tickets.length} pruned=${dead.length}`)
    }
    return { sent: tickets.length, pruned: dead.length }
  }
}
