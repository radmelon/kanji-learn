import { useState, useCallback, useEffect } from 'react'
import { api } from '../lib/api'

export interface Friend {
  id: string
  displayName: string | null
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
  isMe: boolean
}

export interface SearchResult {
  user: Friend | null
  friendshipStatus: string | null
}

export function useSocial() {
  const [friends, setFriends] = useState<Friend[]>([])
  const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSearching, setIsSearching] = useState(false)

  const loadAll = useCallback(async () => {
    setIsLoading(true)
    try {
      const [friendsData, requestsData, leaderboardData] = await Promise.all([
        api.get<Friend[]>('/v1/social/friends'),
        api.get<FriendRequest[]>('/v1/social/requests'),
        api.get<LeaderboardEntry[]>('/v1/social/leaderboard'),
      ])
      setFriends(friendsData)
      setPendingRequests(requestsData)
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
    setPendingRequests((prev) => prev.filter((r) => r.id !== requestId))
    if (action === 'accept') await loadAll()
  }, [loadAll])

  const removeFriend = useCallback(async (friendId: string) => {
    await api.delete(`/v1/social/friends/${friendId}`)
    setFriends((prev) => prev.filter((f) => f.id !== friendId))
    setLeaderboard((prev) => prev.filter((e) => e.userId !== friendId))
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
  }
}
