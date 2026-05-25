// apps/mobile/src/hooks/useBuddyNudges.ts
//
// Same shape as apps/mobile/src/hooks/useInterventions.ts: useState-backed,
// refresh on screen focus. One intentional difference — dismiss here is
// OPTIMISTIC (remove from state first, then call the server); useInterventions
// is pessimistic (call first, remove on success). The optimistic posture is
// better for a banner the user explicitly closed — they shouldn't see it
// flash back during a slow round-trip. Server failure is recovered on next
// refresh (the nudge reappears).
//
// api.get<T> returns T directly (the ApiClient unwraps json.data internally),
// so api.get<BuddyNudge[]> yields BuddyNudge[] — no extra wrapper to strip.

import { useCallback, useState } from 'react'
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

  // useFocusEffect fires on initial mount AND every subsequent focus, so it
  // covers both first-render and tab-switch / app-foreground without needing
  // a separate useEffect (which would double-fetch on mount).
  useFocusEffect(
    useCallback(() => {
      refresh()
    }, [refresh])
  )

  const dismiss = useCallback(async (id: string) => {
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
