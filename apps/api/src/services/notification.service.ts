import { Expo, type ExpoPushMessage } from 'expo-server-sdk'
import { and, eq, gte, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { userProfiles, dailyStats, friendships, userPushTokens } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'

// Expo ticket error strings that mean "this token will never work again."
// Anything else (e.g. MessageRateExceeded) is transient — leave the row alone.
const DEAD_TOKEN_ERRORS = new Set(['DeviceNotRegistered', 'InvalidCredentials', 'MessageTooBig'])

// Module-level frequency cap for study-mate alerts.
// Key: "${submitterId}:${recipientId}" → last-sent timestamp (ms).
// Lives for process lifetime; restarts reset it (acceptable for a 24-hour cap).
const mateNotifyCache = new Map<string, number>()

const expo = new Expo()

// ─── Message copy ─────────────────────────────────────────────────────────────

function buildMessage(streakDays: number, dueCount: number): { title: string; body: string } {
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

  // Send a push notification to a single user
  async sendToUser(userId: string, title: string, body: string): Promise<void> {
    const profile = await this.db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, userId),
      columns: { pushToken: true, notificationsEnabled: true },
    })

    if (!profile?.pushToken || !profile.notificationsEnabled) return
    if (!Expo.isExpoPushToken(profile.pushToken)) return

    await this.sendMessages([{ to: profile.pushToken, title, body, sound: 'default' }])
  }

  // Daily reminder cron — called every hour; only sends to users whose reminderHour matches now in their timezone
  async sendDailyReminders(): Promise<void> {
    const nowUtc = new Date()
    const today = nowUtc.toISOString().slice(0, 10)

    // Find users with push tokens who haven't reviewed today
    const users = await this.db
      .select({
        id: userProfiles.id,
        pushToken: userProfiles.pushToken,
        timezone: userProfiles.timezone,
        reminderHour: userProfiles.reminderHour,
        restDay: userProfiles.restDay,
      })
      .from(userProfiles)
      .where(
        and(
          eq(userProfiles.notificationsEnabled, true),
          isNotNull(userProfiles.pushToken),
          // not in daily_stats for today (i.e., hasn't studied)
          sql`${userProfiles.id} NOT IN (
            SELECT user_id FROM daily_stats WHERE date = ${today} AND reviewed > 0
          )`
        )
      )

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

    const messages: ExpoPushMessage[] = []

    for (const user of eligibleUsers) {
      if (!user.pushToken || !Expo.isExpoPushToken(user.pushToken)) continue

      const streak = await this.getUserStreak(user.id)
      const dueCount = await this.getDueCount(user.id)
      const { title, body } = buildMessage(streak, dueCount)

      messages.push({ to: user.pushToken, title, body, sound: 'default' })
    }

    if (messages.length > 0) {
      await this.sendMessages(messages)
      console.log(`[Notifications] Sent ${messages.length} daily reminders (UTC ${utcHour}:00)`)
    }
  }

  // Notify a user's friends when they complete a study session.
  // Called fire-and-forget from the POST /v1/review/submit route.
  // Respects: notificationsEnabled, pushToken validity, 24-hour frequency cap.
  async notifyStudyMates(submitterId: string, reviewedCount: number): Promise<void> {
    // Get submitter's display name for the notification copy
    const submitter = await this.db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, submitterId),
      columns: { displayName: true },
    })
    const name = submitter?.displayName ?? 'Your study mate'

    // Find all accepted friends (bidirectional)
    const rows = await this.db.query.friendships.findMany({
      where: and(
        or(
          eq(friendships.requesterId, submitterId),
          eq(friendships.addresseeId, submitterId)
        ),
        eq(friendships.status, 'accepted')
      ),
      with: { requester: true, addressee: true },
    })

    const messages: ExpoPushMessage[] = []
    const now = Date.now()
    const oneDayMs = 24 * 60 * 60 * 1000

    for (const row of rows) {
      const friend = row.requesterId === submitterId ? row.addressee : row.requester
      if (!friend.pushToken || !friend.notificationsEnabled) continue
      if (!Expo.isExpoPushToken(friend.pushToken)) continue

      // Frequency cap: max 1 alert per submitter–recipient pair per 24 hours
      const cacheKey = `${submitterId}:${friend.id}`
      const lastSent = mateNotifyCache.get(cacheKey) ?? 0
      if (now - lastSent < oneDayMs) continue

      messages.push({
        to: friend.pushToken,
        title: `📚 ${name} just studied!`,
        body: `They reviewed ${reviewedCount} kanji today. Ready to match them?`,
        sound: 'default',
        data: { type: 'mate_activity', friendId: submitterId },
      })
      mateNotifyCache.set(cacheKey, now)
    }

    if (messages.length > 0) {
      await this.sendMessages(messages)
    }
  }

  // Send rest-day weekly summary notifications.
  // Called hourly by the cron alongside sendDailyReminders().
  // Only fires for users whose local hour == reminderHour AND today == restDay.
  async sendRestDaySummaries(): Promise<void> {
    const nowUtc = new Date()

    // Fetch users who have a rest day configured, notifications on, and a push token
    const users = await this.db
      .select({
        id:          userProfiles.id,
        pushToken:   userProfiles.pushToken,
        timezone:    userProfiles.timezone,
        reminderHour: userProfiles.reminderHour,
        restDay:     userProfiles.restDay,
      })
      .from(userProfiles)
      .where(
        and(
          eq(userProfiles.notificationsEnabled, true),
          isNotNull(userProfiles.pushToken),
          sql`${userProfiles.restDay} IS NOT NULL`
        )
      )

    const utcHour = nowUtc.getUTCHours()

    for (const user of users) {
      if (!user.pushToken || !Expo.isExpoPushToken(user.pushToken)) continue
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

      await this.sendMessages([{ to: user.pushToken, title, body, sound: 'default' }])
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
    const now = new Date()
    const [row] = await this.db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int as count FROM user_kanji_progress
          WHERE user_id = ${userId}
          AND (next_review_at IS NULL OR next_review_at <= ${now})`
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
    const rows = await this.db
      .select({ token: userPushTokens.token })
      .from(userPushTokens)
      .where(eq(userPushTokens.userId, userId))

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

    console.log(`[Push] userId=${userId} sent=${tickets.length} pruned=${dead.length}`)
    return { sent: tickets.length, pruned: dead.length }
  }

  private async sendMessages(messages: ExpoPushMessage[]): Promise<void> {
    const chunks = expo.chunkPushNotifications(messages)
    for (const chunk of chunks) {
      try {
        await expo.sendPushNotificationsAsync(chunk)
      } catch (err) {
        console.error('[Notifications] Push send error:', err)
      }
    }
  }
}
