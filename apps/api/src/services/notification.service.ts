import { Expo, type ExpoPushMessage } from 'expo-server-sdk'
import { and, eq, gte, inArray, or, sql } from 'drizzle-orm'
import { userProfiles, dailyStats, friendships, userPushTokens, buddyNudges } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import type { BuddyNudge } from '@kanji-learn/shared'
import { evaluateAppointment, nextCadence, shouldStepDown, stepDownCopy } from '@kanji-learn/shared'
import { CommitmentService } from './buddy/commitment.service.js'

// Expo ticket error strings that mean "this token will never work again."
// Anything else (e.g. MessageRateExceeded) is transient — leave the row alone.
const DEAD_TOKEN_ERRORS = new Set(['DeviceNotRegistered', 'InvalidCredentials', 'MessageTooBig'])

// The receipt-level equivalent, and deliberately narrower.
//
// A receipt error is the push service's verdict, and only DeviceNotRegistered
// is a verdict about the *token*. InvalidCredentials is a verdict about OUR
// APNs/FCM key — pruning on it would delete every push token in the system the
// first time a certificate expires, and nothing re-registers them short of a
// reinstall. Root cause B was already "the accounts under test have no tokens";
// this is how that becomes permanent and global.
const DEAD_TOKEN_RECEIPT_ERRORS = new Set(['DeviceNotRegistered'])

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

// ─── Reminder eligibility ─────────────────────────────────────────────────────

export interface ReminderPrefs {
  timezone: string | null
  reminderHour: number | null
  restDay: number | null
}

/**
 * Local hour (0–23) and weekday (0=Sun … 6=Sat) for a timezone.
 *
 * Uses `Intl` parts rather than the old `toLocaleString` → `new Date`
 * round-trip, which depends on the host locale producing a string that `Date`
 * can parse back. That worked on this machine and is guaranteed nowhere.
 *
 * Falls back to UTC on an unknown timezone string: one bad row must not take
 * the hourly cron down for everybody.
 */
export function localHourAndWeekday(
  nowUtc: Date,
  timezone: string | null,
): { hour: number; weekday: number } {
  let hour: number
  let weekday: number

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone ?? 'UTC',
      hour: 'numeric',
      hour12: false,
      weekday: 'short',
    }).formatToParts(nowUtc)

    hour = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN)
    const wd = parts.find((p) => p.type === 'weekday')?.value ?? ''
    weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd)
    if (Number.isNaN(hour) || weekday < 0) throw new Error('unparseable')
  } catch {
    hour = nowUtc.getUTCHours()
    weekday = nowUtc.getUTCDay()
  }

  // ICU renders local midnight as 24 under hour12:false (verified on the
  // current Node build). Untreated, anyone who picks midnight never fires.
  return { hour: hour === 24 ? 0 : hour, weekday }
}

/**
 * Consecutive days studied, counting back from `today` (an ISO yyyy-mm-dd).
 *
 * `dates` must be the distinct days with at least one review, newest first.
 *
 * B-222: this used to begin counting at *yesterday*, on the reasoning that
 * "they haven't studied today yet" — true when the daily cron only messaged
 * people who had not studied. Plan 4 added `buildMessage`'s `reviewedToday > 0`
 * branch, so the same number now feeds copy that explicitly thanks the learner
 * for today's reviews. Buddy studied on 07-27 and 07-28 and was told *"Nice
 * work today! — 7 kanji done"* rather than *"2 days in a row"*: the message
 * congratulated them on a day the streak behind it was pretending had not
 * happened.
 *
 * Counting starts at today when today is present and falls back to yesterday
 * when it is not, so a streak that is merely *not yet continued* still counts.
 *
 * Dates are compared on the UTC calendar day, matching `sendDailyReminders`'s
 * `dailyStats` join. A learner whose local day differs from UTC can therefore
 * see a streak roll over at the wrong hour — real, separate, and not this fix.
 *
 * Extracted and exported for the same reason as `isEligibleNow` below: it is
 * pure, and testing it should not require a database.
 */
export function computeStreak(dates: string[], today: string): number {
  if (dates.length === 0) return 0

  const dayBefore = (iso: string): string => {
    const d = new Date(`${iso}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 1)
    return d.toISOString().slice(0, 10)
  }

  let expected = dates[0] === today ? today : dayBefore(today)
  let streak = 0
  for (const date of dates) {
    if (date !== expected) break
    streak++
    expected = dayBefore(expected)
  }
  return streak
}

/**
 * Whether a user should receive their daily reminder at this instant.
 *
 * Extracted and exported so it can be tested against real timezones without a
 * database — it is the whole of root cause A (BUGS.md, 2026-07-26).
 */
export function isEligibleNow(nowUtc: Date, prefs: ReminderPrefs): boolean {
  const { hour, weekday } = localHourAndWeekday(nowUtc, prefs.timezone)
  if (prefs.restDay != null && weekday === prefs.restDay) return false
  return hour === (prefs.reminderHour ?? 20)
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

    const utcHour = nowUtc.getUTCHours()

    // Root cause A (BUGS.md, 2026-07-26): nothing has ever written
    // user_profiles.timezone, so every row keeps its 'UTC' default and
    // reminderHour — documented as being in the user's timezone — is evaluated
    // against UTC. A 20:00 reminder arrives at 1pm PDT. The client fix is Plan
    // 4 Task 17; until it has rolled out, say so on every run rather than
    // silently treating an uncaptured timezone as a deliberate choice.
    const uncaptured = users.filter((u) => !u.timezone || u.timezone === 'UTC').length
    if (uncaptured > 0) {
      console.warn(
        `[Notifications] ${uncaptured}/${users.length} users have no captured timezone — ` +
          `their reminderHour is being evaluated against UTC`,
      )
    }

    // Filter to only users whose local hour matches their reminderHour, skipping rest days
    const eligibleUsers = users.filter((u) =>
      isEligibleNow(nowUtc, {
        timezone: u.timezone,
        reminderHour: u.reminderHour,
        restDay: u.restDay,
      }),
    )

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
      // Counted on `accepted`, not `sent`. `sent` now means "a receipt came
      // back confirming delivery", and receipts are asynchronous — an
      // immediate poll almost always finds none, so counting on it would make
      // this line read "Sent 0 daily reminders" on a perfectly healthy run.
      if (result.accepted > 0) sent++
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

    for (const user of users) {
      if (user.restDay == null) continue

      // Same root cause A as sendDailyReminders, and it was the same broken
      // idiom here — a second copy of the toLocaleString round-trip, with the
      // same missing midnight guard. Both now read the clock the same way.
      const { hour: localHour, weekday: localWeekday } = localHourAndWeekday(nowUtc, user.timezone)

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

  /**
   * Hourly buddy-day pass — spec §8.1 and §8.3.
   *
   * Three jobs, in this order:
   *   1. Roll the commitment forward. This is why it is server-side: the week
   *      must be set whether or not the learner's phone ever connects.
   *   2. Push, if a session is due right now in their timezone.
   *   3. Step the cadence down after three consecutive misses, so the quiet
   *      exit is ours and legible rather than iOS notification settings.
   *
   * Runs off the existing hourly EventBridge → Lambda → POST
   * /internal/daily-reminders invocation. See cron.ts:8 for why not node-cron.
   */
  async runBuddyDayPass(): Promise<void> {
    const nowUtc = new Date()
    const commitments = new CommitmentService(this.db)

    const users = await this.db
      .select({
        id: userProfiles.id,
        timezone: userProfiles.timezone,
        reminderHour: userProfiles.reminderHour,
        buddyDay: userProfiles.buddyDay,
        buddyIntervalWeeks: userProfiles.buddyIntervalWeeks,
        notificationsEnabled: userProfiles.notificationsEnabled,
      })
      .from(userProfiles)
      .where(sql`${userProfiles.buddyDay} IS NOT NULL`)

    for (const user of users) {
      // A learner still on the 'UTC' default has no reliable buddy_day.
      // Skipping is deliberate — guessing is what fired daily reminders at the
      // wrong hour for three months (schema.ts:171).
      if (user.timezone === 'UTC') {
        console.warn(`[BuddyDay] skipping ${user.id}: timezone still 'UTC' default`)
        continue
      }

      const { hour: localHour } = localHourAndWeekday(nowUtc, user.timezone)
      const localDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: user.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(nowUtc)

      const lastAgreed = await commitments.getMostRecentAgreed(user.id)
      const state = evaluateAppointment({
        buddyDay: user.buddyDay,
        intervalWeeks: user.buddyIntervalWeeks,
        localDate,
        lastSessionDate: lastAgreed?.weekStart ?? null,
      })

      if (state.kind !== 'due') continue

      // 1. Roll forward — unconditional, independent of the push.
      await commitments.ensureForWeek(user.id, state.weekStart)

      // 3. Step down before they mute us.
      const misses = await commitments.getMissCount(user.id)
      if (shouldStepDown(misses)) {
        const next = nextCadence({
          buddyDay: user.buddyDay,
          intervalWeeks: user.buddyIntervalWeeks,
        })
        await this.db.update(userProfiles)
          .set({ buddyDay: next.buddyDay, buddyIntervalWeeks: next.intervalWeeks })
          .where(eq(userProfiles.id, user.id))

        if (user.notificationsEnabled) {
          await this.sendToUserTokens(user.id, {
            title: 'Buddy',
            body: stepDownCopy(next),
            sound: 'default',
            data: { type: 'buddy_step_down' },
          })
        }
        continue
      }

      // 2. Push, only at their chosen hour.
      if (localHour !== (user.reminderHour ?? 20)) continue
      if (!user.notificationsEnabled) continue

      await this.sendToUserTokens(user.id, {
        title: 'Time for our weekly catch-up',
        body: "Let's look at the week and set the next one.",
        sound: 'default',
        data: { type: 'buddy_session', weekStart: state.weekStart },
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

    return computeStreak(
      rows.map((r) => r.date),
      new Date().toISOString().slice(0, 10),
    )
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

  /**
   * Fan out a single notification payload to every push token this user has
   * registered (multi-device), then ask Expo what actually happened.
   *
   * Three numbers, because they are three different things and conflating them
   * is what hid the daily-reminder failure for three months (BUGS.md, root
   * cause C):
   *
   *   accepted — Expo took the message. A *ticket*, i.e. synchronous
   *              acceptance. This is what the old `sent` really counted.
   *   sent     — a *receipt* came back confirming delivery to APNs/FCM.
   *   pruned   — tokens deleted because they are dead.
   *
   * `sent` is a floor, not a total: Expo generates receipts asynchronously, so
   * an immediate poll usually finds none and healthy sends legitimately report
   * `delivered=0`. Judge health by `accepted` and by the absence of receipt
   * errors. The durable fix is to persist ticket ids and poll them minutes
   * later; this is the cheap version that makes the failures visible at all.
   */
  async sendToUserTokens(
    userId: string,
    message: Omit<ExpoPushMessage, 'to'>,
  ): Promise<{ sent: number; pruned: number; accepted: number }> {
    // Cap at 100 rows — Expo's batch API hard limit. At ~2 devices/user today
    // this can't trip, but it's cheap defense against sticky-token leaks.
    const rows = await this.db
      .select({ token: userPushTokens.token })
      .from(userPushTokens)
      .where(eq(userPushTokens.userId, userId))
      .limit(100)

    if (rows.length === 0) {
      // Loud on purpose. A user with notificationsEnabled=true and zero tokens
      // cannot receive anything, and this path used to return in total silence
      // — which is precisely why root cause B read as "notifications never
      // work" instead of "this account has no device registered".
      console.warn(`[Push] userId=${userId} has NO registered push tokens — nothing sent`)
      return { sent: 0, pruned: 0, accepted: 0 }
    }

    const messages: ExpoPushMessage[] = rows.map((r) => ({ ...message, to: r.token }))
    const tickets = await expo.sendPushNotificationsAsync(messages)

    const dead: string[] = []
    const receiptIdToToken = new Map<string, string>()
    let accepted = 0

    tickets.forEach((ticket, i) => {
      if (ticket.status === 'error') {
        const error = ticket.details?.error ?? 'unknown'
        console.error(`[Push] ticket error userId=${userId} error=${error}`)
        if (DEAD_TOKEN_ERRORS.has(error)) dead.push(rows[i].token)
        return
      }
      accepted++
      if (ticket.id) receiptIdToToken.set(ticket.id, rows[i].token)
    })

    // Tickets are acceptance, not delivery. Poll receipts for the real outcome.
    let delivered = 0
    const receiptIds = [...receiptIdToToken.keys()]
    for (const chunk of expo.chunkPushNotificationReceiptIds(receiptIds)) {
      let receipts: Record<string, { status: string; details?: { error?: string } }>
      try {
        receipts = await expo.getPushNotificationReceiptsAsync(chunk)
      } catch (err) {
        // Receipts are diagnostics; losing them must not fail the send. An
        // unfetched receipt is unknown, never delivered.
        console.warn(`[Push] receipt fetch failed for ${chunk.length} ids:`, err)
        continue
      }
      for (const [id, receipt] of Object.entries(receipts)) {
        if (receipt.status === 'ok') { delivered++; continue }
        const error = receipt.details?.error ?? 'unknown'
        console.error(`[Push] receipt error userId=${userId} error=${error}`)
        if (DEAD_TOKEN_RECEIPT_ERRORS.has(error)) {
          const token = receiptIdToToken.get(id)
          if (token) dead.push(token)
        }
      }
    }

    if (dead.length > 0) {
      await this.db
        .delete(userPushTokens)
        .where(and(eq(userPushTokens.userId, userId), inArray(userPushTokens.token, dead)))
    }

    console.log(
      `[Push] userId=${userId} accepted=${accepted} delivered=${delivered} pruned=${dead.length}`,
    )
    return { sent: delivered, pruned: dead.length, accepted }
  }

  /**
   * Fire an Expo push for a Buddy nudge. Phase 1' Task 6.
   *
   * Honors userProfiles.notificationsEnabled — if the user has push off,
   * skip both the Expo call and the push_delivered_at stamp (no attempt
   * happened, so the daily-metrics column should not record one).
   *
   * Otherwise: reuses sendToUserTokens for the Expo client + dead-token
   * pruning, then sets buddy_nudges.push_delivered_at after Expo resolves
   * (success or logged failure — "we tried"). Errors never propagate;
   * called fire-and-forget from the setImmediate chain in submitReview.
   */
  async sendBuddyNudgePush(userId: string, nudge: BuddyNudge): Promise<void> {
    // Respect the user's master push switch — matches the gate used by
    // sendDailyReminders, notifyStudyMates, notifyIncomingFriendRequest,
    // and sendRestDaySummaries.
    const profile = await this.db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, userId),
      columns: { notificationsEnabled: true },
    })
    if (!profile?.notificationsEnabled) return

    try {
      await this.sendToUserTokens(userId, {
        title: 'Kanji Buddy',
        body: nudge.content,
        sound: 'default',
        data: {
          nudgeId: nudge.id,
          kind: 'buddy_nudge',
          screen: nudge.screen,
        },
      })
    } catch (err) {
      console.warn(`[BuddyPush] send failed for user ${userId} nudge ${nudge.id}:`, err)
    }

    // Mark "we tried" — success or failure — so daily metrics count it.
    try {
      await this.db
        .update(buddyNudges)
        .set({ pushDeliveredAt: new Date() })
        .where(eq(buddyNudges.id, nudge.id))
    } catch (err) {
      console.warn(`[BuddyPush] failed to set pushDeliveredAt for ${nudge.id}:`, err)
    }
  }
}
