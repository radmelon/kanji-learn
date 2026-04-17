import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'

export type UserProfile = {
  id: string
  displayName: string | null
  email: string | null
  dailyGoal: number
  notificationsEnabled: boolean
  pushToken: string | null
  timezone: string
  reminderHour: number
  restDay: number | null
  onboardingCompletedAt: string | null
  createdAt: string
  updatedAt: string
}

// Module-level cache — shared across all hook instances in the same session.
let _cache: UserProfile | null = null
let _fetching = false
const _listeners = new Set<(p: UserProfile | null) => void>()

function notifyListeners(profile: UserProfile | null) {
  _listeners.forEach((fn) => fn(profile))
}

/** Call this from auth.store.ts signOut so the next session gets a fresh fetch. */
export function clearProfileCache() {
  _cache = null
  notifyListeners(null)
}

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(_cache)
  const [isLoading, setIsLoading] = useState(_cache === null)

  useEffect(() => {
    // Subscribe to cross-instance updates (e.g. update() called from onboarding.tsx)
    _listeners.add(setProfile)
    return () => { _listeners.delete(setProfile) }
  }, [])

  useEffect(() => {
    if (_cache) {
      setProfile(_cache)
      setIsLoading(false)
      return
    }
    if (_fetching) return

    _fetching = true
    api
      .get<UserProfile>('/v1/user/profile')
      .then((data) => {
        _cache = data
        notifyListeners(data)
      })
      .catch(() => {/* swallow — layout will retry on next mount */})
      .finally(() => {
        _fetching = false
        setIsLoading(false)
      })
  }, [])

  const update = useCallback(async (fields: Partial<UserProfile>): Promise<boolean> => {
    try {
      const data = await api.patch<UserProfile>('/v1/user/profile', fields)
      _cache = data
      notifyListeners(data)
      return true
    } catch {
      return false
    }
  }, [])

  const refresh = useCallback(async () => {
    _cache = null
    setIsLoading(true)
    try {
      const data = await api.get<UserProfile>('/v1/user/profile')
      _cache = data
      notifyListeners(data)
    } catch {
      /* swallow */
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { profile, isLoading, update, refresh }
}
