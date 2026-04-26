import { useState, useCallback, useEffect } from 'react'
import { api } from '../lib/api'

export interface Friend {
  /** @deprecated Use `userId` instead — the API marks this as deprecated. */
  id: string
  userId: string
  displayName: string | null
  notifyOfActivity: boolean
}

export interface FriendRequest {
  id: string
  requesterId: string
  requesterName: string | null
  addresseeId: string
  status: string
  createdAt: string
}

export interface LeaderboardEntry {
  userId: string
  displayName: string | null
  streak: number
  totalReviewed: number
  totalBurned: number
  totalDaysStudied: number
  rememberedCount: number
  dailyAverage: number
  isMe: boolean
}

export interface SearchResult {
  user: Friend | null
  friendshipStatus: string | null
}

// Module-level cache of pending friend requests. Multiple consumers
// (useSocial in Dashboard/Profile, usePendingRequestCount in the tab layout)
// must see the same value, otherwise the badge goes stale after the user
// accepts/declines a request from a different screen. Mirrors the
// useProfile.ts shared-cache pattern.
let _pendingCache: FriendRequest[] = []
const _pendingListeners = new Set<(r: FriendRequest[]) => void>()
function _setPending(next: FriendRequest[]) {
  _pendingCache = next
  _pendingListeners.forEach((fn) => fn(next))
}

export function useSocial() {
  const [friends, setFriends] = useState<Friend[]>([])
  const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>(_pendingCache)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSearching, setIsSearching] = useState(false)

  // Subscribe to cross-instance updates of the pending-requests cache
  useEffect(() => {
    _pendingListeners.add(setPendingRequests)
    return () => { _pendingListeners.delete(setPendingRequests) }
  }, [])

  const loadAll = useCallback(async () => {
    setIsLoading(true)
    try {
      const [friendsData, requestsData, leaderboardData] = await Promise.all([
        api.get<Friend[]>('/v1/social/friends'),
        api.get<FriendRequest[]>('/v1/social/requests'),
        api.get<LeaderboardEntry[]>('/v1/social/leaderboard'),
      ])
      setFriends(friendsData)
      _setPending(requestsData)
      setLeaderboard(leaderboardData)
    } catch {
      // silently fail
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const searchByEmail = useCallback(async (email: string): Promise<SearchResult> => {
    setIsSearching(true)
    try {
      return await api.get<SearchResult>(`/v1/social/search?email=${encodeURIComponent(email)}`)
    } finally {
      setIsSearching(false)
    }
  }, [])

  const sendRequest = useCallback(async (addresseeId: string) => {
    await api.post('/v1/social/request', { addresseeId })
  }, [])

  const respondToRequest = useCallback(async (requestId: string, action: 'accept' | 'decline') => {
    await api.patch(`/v1/social/request/${requestId}`, { action })
    _setPending(_pendingCache.filter((r) => r.id !== requestId))
    if (action === 'accept') await loadAll()
  }, [loadAll])

  const removeFriend = useCallback(async (friendId: string) => {
    await api.delete(`/v1/social/friends/${friendId}`)
    setFriends((prev) => prev.filter((f) => f.id !== friendId))
    setLeaderboard((prev) => prev.filter((e) => e.userId !== friendId))
  }, [])

  // Per-friendship mute toggle. Applies an optimistic update and reverts on
  // failure. Rejects with the underlying error so callers can surface a toast.
  const setFriendMute = useCallback(async (friendUserId: string, notifyOfActivity: boolean) => {
    setFriends((prev) => prev.map((f) =>
      f.userId === friendUserId ? { ...f, notifyOfActivity } : f
    ))
    try {
      await api.patch(`/v1/social/friends/${friendUserId}`, { notifyOfActivity })
    } catch (err) {
      setFriends((prev) => prev.map((f) =>
        f.userId === friendUserId ? { ...f, notifyOfActivity: !notifyOfActivity } : f
      ))
      throw err
    }
  }, [])

  return {
    friends,
    pendingRequests,
    leaderboard,
    isLoading,
    isSearching,
    loadAll,
    searchByEmail,
    sendRequest,
    respondToRequest,
    removeFriend,
    setFriendMute,
  }
}

// Lightweight subscriber for the Profile-tab badge: returns just the pending
// count and a one-shot fetcher. Reads the same shared cache useSocial maintains
// so accepting a request from any screen clears the badge across the app.
// Caller must invoke `refresh()` (e.g. on app focus) to keep the count fresh
// without mounting the heavier useSocial hook.
export function usePendingRequestCount() {
  const [pending, setPending] = useState<FriendRequest[]>(_pendingCache)

  useEffect(() => {
    _pendingListeners.add(setPending)
    return () => { _pendingListeners.delete(setPending) }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<FriendRequest[]>('/v1/social/requests')
      _setPending(data)
    } catch {
      // silently fail — stale count is preferable to a noisy error path
    }
  }, [])

  return { count: pending.length, refresh }
}
