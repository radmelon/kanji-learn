import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'

export interface SessionRecord {
  id: string
  startedAt: string
  completedAt: string
  totalItems: number
  correctItems: number
  accuracyPct: number
  studyTimeMs: number
  sessionType: string
}

export function useSessionHistory(limit = 30) {
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await api.get<SessionRecord[]>(`/v1/analytics/sessions?limit=${limit}`)
      setSessions(data)
    } catch (err: any) {
      setError(err.message ?? 'Failed to load session history')
    } finally {
      setIsLoading(false)
    }
  }, [limit])

  useEffect(() => { fetch() }, [fetch])

  return { sessions, isLoading, error, refresh: fetch }
}
