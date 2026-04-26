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

// Module-level shared caches. Multiple consumers (Dashboard, Profile,
// the tab layout's pending-count subscriber) mount their own useSocial
// instances; without a shared cache each instance keeps its own friends /
// pending / leaderboard arrays and they go stale when state changes
// elsewhere — e.g. accepting a request on iPad would not clear the badge
// in Dashboard's instance, and dropping a friend from one screen would
// leave them visible on another until force-quit. Mirrors useProfile.ts.
function makeSharedCache<T>(initial: T) {
  let cache = initial
  const listeners = new Set<(v: T) => void>()
  return {
    get: () => cache,
    set: (next: T) => {
      cache = next
      listeners.forEach((fn) => fn(next))
    },
    subscribe: (fn: (v: T) => void) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
}

const _friendsCache = makeSharedCache<Friend[]>([])
const _pendingCache = makeSharedCache<FriendRequest[]>([])
const _leaderboardCache = makeSharedCache<LeaderboardEntry[]>([])

export function useSocial() {
  const [friends, setFriends] = useState<Friend[]>(_friendsCache.get())
  const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>(_pendingCache.get())
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(_leaderboardCache.get())
  const [isLoading, setIsLoading] = useState(false)
  const [isSearching, setIsSearching] = useState(false)

  // Subscribe each local state hook to its shared cache so updates from any
  // useSocial instance (or the tab-layout subscriber) propagate everywhere.
  useEffect(() => _friendsCache.subscribe(setFriends), [])
  useEffect(() => _pendingCache.subscribe(setPendingRequests), [])
  useEffect(() => _leaderboardCache.subscribe(setLeaderboard), [])

  const loadAll = useCallback(async () => {
    setIsLoading(true)
    try {
      const [friendsData, requestsData, leaderboardData] = await Promise.all([
        api.get<Friend[]>('/v1/social/friends'),
        api.get<FriendRequest[]>('/v1/social/requests'),
        api.get<LeaderboardEntry[]>('/v1/social/leaderboard'),
      ])
      _friendsCache.set(friendsData)
      _pendingCache.set(requestsData)
      _leaderboardCache.set(leaderboardData)
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
    _pendingCache.set(_pendingCache.get().filter((r) => r.id !== requestId))
    if (action === 'accept') await loadAll()
  }, [loadAll])

  const removeFriend = useCallback(async (friendId: string) => {
    await api.delete(`/v1/social/friends/${friendId}`)
    _friendsCache.set(_friendsCache.get().filter((f) => f.id !== friendId))
    _leaderboardCache.set(_leaderboardCache.get().filter((e) => e.userId !== friendId))
  }, [])

  // Per-friendship mute toggle. Applies an optimistic update and reverts on
  // failure. Rejects with the underlying error so callers can surface a toast.
  const setFriendMute = useCallback(async (friendUserId: string, notifyOfActivity: boolean) => {
    const apply = (toggle: boolean) =>
      _friendsCache.set(_friendsCache.get().map((f) =>
        f.userId === friendUserId ? { ...f, notifyOfActivity: toggle } : f
      ))
    apply(notifyOfActivity)
    try {
      await api.patch(`/v1/social/friends/${friendUserId}`, { notifyOfActivity })
    } catch (err) {
      apply(!notifyOfActivity)
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
  const [pending, setPending] = useState<FriendRequest[]>(_pendingCache.get())

  useEffect(() => _pendingCache.subscribe(setPending), [])

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<FriendRequest[]>('/v1/social/requests')
      _pendingCache.set(data)
    } catch {
      // silently fail — stale count is preferable to a noisy error path
    }
  }, [])

  return { count: pending.length, refresh }
}
