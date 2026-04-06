import { Expo, type ExpoPushMessage } from 'expo-server-sdk'
import { and, eq, gte, isNotNull, sql } from 'drizzle-orm'
import { userProfiles, dailyStats, type InferSelectModel } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'

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
