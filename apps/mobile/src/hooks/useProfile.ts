import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth.store'

export type UserProfile = {
  id: string
  displayName: string | null
  email: string | null
  dailyGoal: number
  notificationsEnabled: boolean
  timezone: string
  reminderHour: number
  restDay: number | null
  onboardingCompletedAt: string | null
  showPitchAccent: boolean
  /** "Mnemonic coaching" — parent spec §11 specifies an opt-OUT, so this
   *  defaults true server-side (migration 0027). Off suppresses automatic
   *  Buddy moments only; manual "Build a hook" is unaffected. */
  mnemonicCoachingEnabled: boolean
  /** Whether co-created hooks may store GPS coordinates. Defaults FALSE —
   *  hooks must not inherit consent from the milestones location toggle. */
  attachLocationToHooks: boolean
  /** ISO, or null when the one-time in-flow location ask has never been
   *  answered. Server-side so a reinstall does not re-ask. */
  hookLocationAskSeenAt: string | null
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
  // Subscribe to the access token so this hook re-runs its fetch effect whenever
  // the session changes (sign-in, sign-out, token refresh). Without this the
  // pre-login fetch races `initialize()`, fails with 401, and `_cache` stays
  // null forever — stranding users on the sign-in screen after OAuth succeeds.
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null)
  const [profile, setProfile] = useState<UserProfile | null>(_cache)
  const [isLoading, setIsLoading] = useState(_cache === null)

  useEffect(() => {
    // Subscribe to cross-instance updates (e.g. update() called from onboarding.tsx)
    _listeners.add(setProfile)
    return () => { _listeners.delete(setProfile) }
  }, [])

  useEffect(() => {
    // No session → clear any stale cache from a prior session or failed fetch.
    if (!accessToken) {
      _cache = null
      setProfile(null)
      setIsLoading(false)
      return
    }
    if (_cache) {
      setProfile(_cache)
      setIsLoading(false)
      return
    }
    if (_fetching) return

    _fetching = true
    setIsLoading(true)
    api
      .get<UserProfile>('/v1/user/profile')
      .then((data) => {
        _cache = data
        notifyListeners(data)
      })
      .catch(() => {/* swallow — next session change will retry */})
      .finally(() => {
        _fetching = false
        setIsLoading(false)
      })
  }, [accessToken])

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
