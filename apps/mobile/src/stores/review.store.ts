import { create } from 'zustand'
import { api } from '../lib/api'
import type { ReviewQueueItem, ReviewResult } from '@kanji-learn/shared'

interface ReviewState {
  queue: ReviewQueueItem[]
  currentIndex: number
  results: ReviewResult[]
  isLoading: boolean
  isComplete: boolean
  studyStartMs: number
  error: string | null

  loadQueue: (limit?: number) => Promise<void>
  submitResult: (result: ReviewResult) => void
  finishSession: () => Promise<void>
  reset: () => void
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  queue: [],
  currentIndex: 0,
  results: [],
  isLoading: false,
  isComplete: false,
  studyStartMs: 0,
  error: null,

  loadQueue: async (limit = 20) => {
    set({ isLoading: true, isComplete: false, currentIndex: 0, results: [], error: null })
    try {
      const queue = await api.get<ReviewQueueItem[]>(`/v1/review/queue?limit=${limit}`)
      set({ queue, studyStartMs: Date.now() })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load queue'
      console.error('[ReviewStore] loadQueue error:', message)
      set({ error: message })
    } finally {
      set({ isLoading: false })
    }
  },

  submitResult: (result) => {
    const { results, currentIndex, queue } = get()
    const newResults = [...results, result]
    const nextIndex = currentIndex + 1
    set({
      results: newResults,
      currentIndex: nextIndex,
      isComplete: nextIndex >= queue.length,
    })
  },

  finishSession: async () => {
    const { results, studyStartMs } = get()
    if (results.length === 0) return
    const studyTimeMs = Date.now() - studyStartMs
    await api.post('/v1/review/submit', { results, studyTimeMs })
  },

  reset: () => {
    set({ queue: [], currentIndex: 0, results: [], isComplete: false, studyStartMs: 0 })
  },
}))
