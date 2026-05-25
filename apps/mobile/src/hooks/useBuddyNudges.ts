// apps/mobile/src/hooks/useBuddyNudges.ts
//
// Mirrors apps/mobile/src/hooks/useInterventions.ts — module-state,
// refresh on mount + focus, optimistic dismiss.
//
// api.get<T> returns T directly (the ApiClient unwraps json.data internally),
// so api.get<BuddyNudge[]> yields BuddyNudge[] — no extra wrapper to strip.

import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { api } from '../lib/api'
import type { BuddyNudge, BuddyScreen } from '@kanji-learn/shared'

export function useBuddyNudges(screen: BuddyScreen) {
  const [nudges, setNudges] = useState<BuddyNudge[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await api.get<BuddyNudge[]>(`/v1/buddy/nudges?screen=${screen}`)
      setNudges(data)
      setError(null)
    } catch (err) {
      setError(err)
      // Silently keep previous nudges on transient failure (banner is
      // non-critical — same posture as useInterventions).
    } finally {
      setIsLoading(false)
    }
  }, [screen])

  // Initial fetch on mount.
  useEffect(() => {
    refresh()
  }, [refresh])

  // Refetch on screen focus — covers tab-switch and app-foreground.
  useFocusEffect(
    useCallback(() => {
      refresh()
    }, [refresh])
  )

  const dismiss = useCallback(async (id: string) => {
    // Optimistic: remove locally before the API call resolves.
    setNudges((prev) => prev.filter((n) => n.id !== id))
    try {
      await api.post(`/v1/buddy/nudges/${id}/dismiss`)
    } catch (err) {
      // Server didn't get the dismiss. The nudge will reappear on
      // next refresh; the user can dismiss again. Retry queue is
      // Phase 1' future work (spec §7.7).
      setError(err)
    }
  }, [])

  return { nudges, isLoading, error, dismiss, refresh }
}
