import { and, eq, inArray, gte, or, ne } from 'drizzle-orm'
import { userProfiles, friendships, userKanjiProgress, dailyStats } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FriendRequest {
  id: string
  requesterId: string
  requesterName: string | null
  requesterEmail: string | null
  addresseeId: string
  status: string
  createdAt: Date
}

export interface Friend {
  id: string
  displayName: string | null
  email: string | null
}

export interface LeaderboardEntry {
  userId: string
  displayName: string | null
  email: string | null
  streak: number
  totalReviewed: number
  totalBurned: number
  isMe: boolean
}

// ─── Social Service ───────────────────────────────────────────────────────────

export class SocialService {
  constructor(private db: Db) {}

  // ── Search for a user by email ─────────────────────────────────────────────

  async searchByEmail(email: string, currentUserId: string): Promise<{
    user: Friend | null
    friendshipStatus: string | null
  }> {
    const normalised = email.trim().toLowerCase()
    const found = await this.db.query.userProfiles.findFirst({
      where: and(eq(userProfiles.email, normalised), ne(userProfiles.id, currentUserId)),
    })

    if (!found) return { user: null, friendshipStatus: null }

    // Check existing relationship
    const existing = await this.db.query.friendships.findFirst({
      where: or(
        and(eq(friendships.requesterId, currentUserId), eq(friendships.addresseeId, found.id)),
        and(eq(friendships.requesterId, found.id), eq(friendships.addresseeId, currentUserId))
      ),
    })

    return {
      user: { id: found.id, displayName: found.displayName, email: found.email },
      friendshipStatus: existing?.status ?? null,
    }
  }

  // ── Send a friend request ──────────────────────────────────────────────────

  async sendRequest(requesterId: string, addresseeId: string): Promise<FriendRequest> {
    const [row] = await this.db
      .insert(friendships)
      .values({ requesterId, addresseeId, status: 'pending' })
      .onConflictDoNothing()
      .returning()

    if (!row) throw new Error('Friend request already exists')

    const requester = await this.db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, requesterId),
    })

    return {
      id: row.id,
      requesterId: row.requesterId,
      requesterName: requester?.displayName ?? null,
      requesterEmail: requester?.email ?? null,
      addresseeId: row.addresseeId,
      status: row.status,
      createdAt: row.createdAt,
    }
  }

  // ── Respond to a friend request ────────────────────────────────────────────

  async respondToRequest(
    requestId: string,
    userId: string,
    action: 'accept' | 'decline'
  ): Promise<void> {
    await this.db
      .update(friendships)
      .set({ status: action === 'accept' ? 'accepted' : 'declined', updatedAt: new Date() })
      .where(and(eq(friendships.id, requestId), eq(friendships.addresseeId, userId)))
  }

  // ── Get pending requests received by user ──────────────────────────────────

  async getPendingRequests(userId: string): Promise<FriendRequest[]> {
    const rows = await this.db.query.friendships.findMany({
      where: and(eq(friendships.addresseeId, userId), eq(friendships.status, 'pending')),
      with: { requester: true },
    })

    return rows.map((r) => ({
      id: r.id,
      requesterId: r.requesterId,
      requesterName: r.requester.displayName,
      requesterEmail: r.requester.email,
      addresseeId: r.addresseeId,
      status: r.status,
      createdAt: r.createdAt,
    }))
  }

  // ── Get accepted friends ───────────────────────────────────────────────────

  async getFriends(userId: string): Promise<Friend[]> {
    const rows = await this.db.query.friendships.findMany({
      where: and(
        or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId)),
        eq(friendships.status, 'accepted')
      ),
      with: { requester: true, addressee: true },
    })

    return rows.map((r) => {
      const friend = r.requesterId === userId ? r.addressee : r.requester
      return { id: friend.id, displayName: friend.displayName, email: friend.email }
    })
  }

  // ── Remove a friend ────────────────────────────────────────────────────────

  async removeFriend(userId: string, friendId: string): Promise<void> {
    await this.db.delete(friendships).where(
      or(
        and(eq(friendships.requesterId, userId), eq(friendships.addresseeId, friendId)),
        and(eq(friendships.requesterId, friendId), eq(friendships.addresseeId, userId))
      )
    )
  }

  // ── Leaderboard ────────────────────────────────────────────────────────────
  // Shows friends + self. Falls back to global top 10 if no friends.

  async getLeaderboard(userId: string): Promise<LeaderboardEntry[]> {
    const friends = await this.getFriends(userId)
    const friendIds = friends.map((f) => f.id)
    const userIds = [userId, ...friendIds]

    // If no friends, go global (top 10 by reviewed count)
    const isGlobal = friendIds.length === 0
    let targetIds = userIds

    if (isGlobal) {
      const top = await this.db
        .select({ userId: userKanjiProgress.userId })
        .from(userKanjiProgress)
        .where(ne(userKanjiProgress.status, 'unseen'))
        .groupBy(userKanjiProgress.userId)
        .limit(10)
      targetIds = [...new Set([userId, ...top.map((r) => r.userId)])]
    }

    // Fetch progress counts
    const progress = await this.db
      .select({
        userId: userKanjiProgress.userId,
        status: userKanjiProgress.status,
      })
      .from(userKanjiProgress)
      .where(and(inArray(userKanjiProgress.userId, targetIds), ne(userKanjiProgress.status, 'unseen')))

    const reviewedMap: Record<string, number> = {}
    const burnedMap: Record<string, number> = {}
    for (const row of progress) {
      if (!row.userId) continue
      reviewedMap[row.userId] = (reviewedMap[row.userId] ?? 0) + 1
      if (row.status === 'burned') burnedMap[row.userId] = (burnedMap[row.userId] ?? 0) + 1
    }

    // Fetch last 60 days of daily stats for streak calculation
    const since = new Date()
    since.setDate(since.getDate() - 60)
    const sinceStr = since.toISOString().slice(0, 10)

    const stats = await this.db
      .select({ userId: dailyStats.userId, date: dailyStats.date, reviewed: dailyStats.reviewed })
      .from(dailyStats)
      .where(and(inArray(dailyStats.userId, targetIds), gte(dailyStats.date, sinceStr)))

    const statsByUser: Record<string, typeof stats> = {}
    for (const s of stats) {
      if (!s.userId) continue
      ;(statsByUser[s.userId] ??= []).push(s)
    }

    // Fetch display names
    const profiles = await this.db
      .select({ id: userProfiles.id, displayName: userProfiles.displayName, email: userProfiles.email })
      .from(userProfiles)
      .where(inArray(userProfiles.id, targetIds))

    const profileMap = Object.fromEntries(profiles.map((p) => [p.id, p]))

    // Assemble leaderboard
    const entries: LeaderboardEntry[] = targetIds.map((uid) => ({
      userId: uid,
      displayName: profileMap[uid]?.displayName ?? null,
      email: profileMap[uid]?.email ?? null,
      streak: computeStreak(statsByUser[uid] ?? []),
      totalReviewed: reviewedMap[uid] ?? 0,
      totalBurned: burnedMap[uid] ?? 0,
      isMe: uid === userId,
    }))

    return entries.sort((a, b) => b.streak - a.streak || b.totalReviewed - a.totalReviewed)
  }

  // ── Friends activity (Watch: delay picker encouragement) ───────────────────
  // Returns today's review count per friend — lightweight, no streak computation.

  async getFriendsActivity(userId: string): Promise<{ userId: string; displayName: string | null; todayReviewed: number }[]> {
    const friends = await this.getFriends(userId)
    if (friends.length === 0) return []

    const today = new Date().toISOString().slice(0, 10)
    const friendIds = friends.map((f) => f.id)

    const rows = await this.db
      .select({ userId: dailyStats.userId, reviewed: dailyStats.reviewed })
      .from(dailyStats)
      .where(and(inArray(dailyStats.userId, friendIds), eq(dailyStats.date, today)))

    const reviewedMap = Object.fromEntries(rows.map((r) => [r.userId, r.reviewed]))

    return friends.map((f) => ({
      userId: f.id,
      displayName: f.displayName,
      todayReviewed: reviewedMap[f.id] ?? 0,
    }))
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeStreak(stats: { date: string; reviewed: number }[]): number {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

  const days = stats
    .filter((s) => s.reviewed > 0)
    .map((s) => s.date)
    .sort()
    .reverse()

  if (!days.length) return 0
  if (days[0] !== today && days[0] !== yesterday) return 0

  let streak = 1
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]).getTime()
    const curr = new Date(days[i]).getTime()
    if ((prev - curr) / 86_400_000 === 1) streak++
    else break
  }
  return streak
}
