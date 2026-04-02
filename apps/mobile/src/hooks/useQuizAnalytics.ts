import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'

export interface QuizSession {
  id: number
  date: string
  scorePct: number
  passed: boolean
  total: number
  correct: number
}

export interface QuizWeakKanji {
  kanjiId: number
  character: string
  totalQuestions: number
  missCount: number
  missRate: number
}

export interface QuizAnalytics {
  totalSessions: number
  passRate: number
  avgScore: number
  recentSessions: QuizSession[]
  weakestKanji: QuizWeakKanji[]
}

export function useQuizAnalytics() {
  const [data, setData] = useState<QuizAnalytics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await api.get<QuizAnalytics>('/v1/tests/analytics')
      setData(result)
    } catch (err: any) {
      setError(err.message ?? 'Failed to load quiz analytics')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { data, isLoading, error, refresh: fetch }
}
