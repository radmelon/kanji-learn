import { useState, useEffect } from 'react'
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

  useEffect(() => {
    api.get<Intervention[]>('/v1/interventions')
      .then(setInterventions)
      .catch(() => {})
  }, [])

  const dismiss = async (id: string) => {
    await api.post(`/v1/interventions/${id}/resolve`)
    setInterventions((prev) => prev.filter((i) => i.id !== id))
  }

  return { interventions, dismiss }
}
