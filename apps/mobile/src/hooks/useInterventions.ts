import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'

export interface Intervention {
  id: string
  type: 'absence' | 'velocity_drop' | 'plateau'
  triggeredAt: string
  message: string
  payload: Record<string, unknown>
}

export function useInterventions() {
  const [interventions, setInterventions] = useState<Intervention[]>([])

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<Intervention[]>('/v1/interventions')
      setInterventions(data)
    } catch {
      // Silently fail — banner is a non-critical UX hint.
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const dismiss = useCallback(async (id: string) => {
    await api.post(`/v1/interventions/${id}/resolve`)
    setInterventions((prev) => prev.filter((i) => i.id !== id))
  }, [])

  return { interventions, dismiss, refresh }
}
