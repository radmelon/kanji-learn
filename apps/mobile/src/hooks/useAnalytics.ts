import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import { storage } from '../lib/storage'
import type { DailyStats, VelocityMetrics } from '@kanji-learn/shared'

const CACHE_KEY = 'kl:analytics_cache'

interface KanjiMissRow {
  kanjiId: number
  character: string
  avgScore?: number
  correctPct?: number
}

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
  writing: {
    totalAttempts: number
    avgScore: number
    passRate: number
    worstKanji: KanjiMissRow[]
  }
  voice: {
    totalAttempts: number
    correctPct: number
    worstKanji: KanjiMissRow[]
  }
}

export function useAnalytics() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isStale, setIsStale] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    // Show cache immediately if available (eliminates loading flash)
    const cached = await storage.getItem<{ cachedAt: number; data: AnalyticsSummary }>(CACHE_KEY)
    if (cached?.data) {
      setSummary(cached.data)
      setIsStale(false)
    }

    try {
      const data = await api.get<AnalyticsSummary>('/v1/analytics/summary')
      setSummary(data)
      setIsStale(false)
      await storage.setItem(CACHE_KEY, { cachedAt: Date.now(), data })
    } catch (err: any) {
      if (cached?.data) {
        setIsStale(true) // show cached with stale indicator
      } else {
        setError(err.message ?? 'Failed to load analytics')
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { summary, isLoading, isStale, error, refresh: fetch }
}
