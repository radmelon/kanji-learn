import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import type { DailyStats, VelocityMetrics } from '@kanji-learn/shared'

interface AnalyticsSummary {
  velocity: VelocityMetrics
  accuracy: number
  statusCounts: {
    unseen: number
    learning: number
    reviewing: number
    remembered: number
    burned: number
  }
  jlptProgress: Record<string, number>  // level → seen count
  streakDays: number
  recentStats: DailyStats[]
  totalSeen: number
  completionPct: number
}

export function useAnalytics() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await api.get<AnalyticsSummary>('/v1/analytics/summary')
      setSummary(data)
    } catch (err: any) {
      setError(err.message ?? 'Failed to load analytics')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { summary, isLoading, error, refresh: fetch }
}
