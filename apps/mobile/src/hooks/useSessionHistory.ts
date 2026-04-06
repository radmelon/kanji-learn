import { useState, useEffect, useCallback, useRef } from 'react'
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

const PAGE_SIZE = 20

export function useSessionHistory() {
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const offsetRef = useRef(0)

  const load = useCallback(async (reset: boolean) => {
    const offset = reset ? 0 : offsetRef.current
    if (reset) {
      setIsLoading(true)
    } else {
      setIsLoadingMore(true)
    }
    setError(null)
    try {
      const data = await api.get<SessionRecord[]>(
        `/v1/analytics/sessions?limit=${PAGE_SIZE}&offset=${offset}`
      )
      setSessions((prev) => (reset ? data : [...prev, ...data]))
      offsetRef.current = offset + data.length
      setHasMore(data.length === PAGE_SIZE)
    } catch (err: any) {
      setError(err.message ?? 'Failed to load session history')
    } finally {
      setIsLoading(false)
      setIsLoadingMore(false)
    }
  }, [])

  const refresh = useCallback(() => load(true), [load])
  const loadMore = useCallback(() => { if (!isLoadingMore && hasMore) load(false) }, [load, isLoadingMore, hasMore])

  useEffect(() => { load(true) }, [load])

  return { sessions, isLoading, isLoadingMore, hasMore, error, refresh, loadMore }
}
