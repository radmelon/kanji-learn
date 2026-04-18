import { create } from 'zustand'
import { api } from '../lib/api'
import { storage } from '../lib/storage'
import type { ReviewQueueItem, ReviewResult } from '@kanji-learn/shared'

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEY_QUEUE = 'kl:review_queue'
const KEY_PROGRESS = 'kl:in_progress_results'
const KEY_PENDING = 'kl:pending_sessions'

const QUEUE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const PENDING_MAX_ATTEMPTS = 5
const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

interface CachedQueue {
  userId: string
  savedAt: number
  queue: ReviewQueueItem[]
  currentIndex: number
  studyStartMs: number
}

interface InProgressResults {
  userId: string
  results: ReviewResult[]
  studyStartMs: number
}

interface PendingSession {
  id: string
  userId: string
  results: ReviewResult[]
  studyTimeMs: number
  createdAt: number
  attemptCount: number
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface ReviewState {
  queue: ReviewQueueItem[]
  currentIndex: number
  results: ReviewResult[]
  isLoading: boolean
  isComplete: boolean
  studyStartMs: number
  error: string | null
  isOfflineQueue: boolean
  hasPendingSessions: boolean
  /** True when the current queue was loaded via loadWeakQueue — study.tsx skips its normal loadQueue() call */
  isWeakDrill: boolean

  loadQueue: (limit?: number) => Promise<void>
  submitResult: (result: ReviewResult) => void
  undoLastResult: () => boolean
  loadWeakQueue: (limit?: number) => Promise<boolean>
  finishSession: () => Promise<{ burned: number; studyTimeMs: number; confidencePct: number } | null>
  syncPendingSessions: () => Promise<void>
  loadMissedQueue: () => boolean
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
  isOfflineQueue: false,
  hasPendingSessions: false,
  isWeakDrill: false,

  loadQueue: async (limit = 20) => {
    set({ isLoading: true, isComplete: false, currentIndex: 0, results: [], error: null, isOfflineQueue: false, isWeakDrill: false })

    // Check for pending sessions immediately (fire-and-forget)
    const pending = await storage.getItem<PendingSession[]>(KEY_PENDING)
    if (pending && pending.length > 0) set({ hasPendingSessions: true })

    try {
      const queue = await api.get<ReviewQueueItem[]>(`/v1/review/queue?limit=${limit}`)
      const now = Date.now()

      // Cache for offline use
      const cached: CachedQueue = { userId: 'current', savedAt: now, queue, currentIndex: 0, studyStartMs: now }
      await storage.setItem(KEY_QUEUE, cached)

      // Restore in-progress position if we have results for the same queue
      const inProgress = await storage.getItem<InProgressResults>(KEY_PROGRESS)
      const resumeIndex = inProgress && inProgress.results.length > 0 && inProgress.results.length < queue.length
        ? inProgress.results.length
        : 0
      const resumeResults = resumeIndex > 0 && inProgress ? inProgress.results : []

      set({ queue, studyStartMs: now, currentIndex: resumeIndex, results: resumeResults })
    } catch {
      // Offline fallback — load cached queue
      const cached = await storage.getItem<CachedQueue>(KEY_QUEUE)
      if (cached && cached.queue.length > 0) {
        const isStale = Date.now() - cached.savedAt > QUEUE_TTL_MS

        // Restore in-progress position
        const inProgress = await storage.getItem<InProgressResults>(KEY_PROGRESS)
        const resumeIndex = inProgress && inProgress.results.length > 0 && inProgress.results.length < cached.queue.length
          ? inProgress.results.length
          : cached.currentIndex
        const resumeResults = inProgress && inProgress.results.length > 0 ? inProgress.results : []

        set({
          queue: cached.queue,
          studyStartMs: cached.studyStartMs,
          currentIndex: resumeIndex,
          results: resumeResults,
          isOfflineQueue: isStale,
          error: null,
        })
      } else {
        set({ error: 'You\'re offline and no cached cards are available.' })
      }
    } finally {
      set({ isLoading: false })
    }
  },

  loadWeakQueue: async (limit = 20) => {
    set({ isLoading: true, isComplete: false, currentIndex: 0, results: [], error: null, isOfflineQueue: false })
    try {
      const queue = await api.get<ReviewQueueItem[]>(`/v1/review/weak-queue?limit=${limit}`)
      const now = Date.now()
      if (queue.length === 0) {
        set({ isLoading: false })
        return false
      }
      set({ queue, studyStartMs: now, currentIndex: 0, results: [], isWeakDrill: true })
      return true
    } catch (err: any) {
      set({ error: err?.message ?? 'Could not load weak kanji queue.' })
      return false
    } finally {
      set({ isLoading: false })
    }
  },

  submitResult: (result) => {
    const { results, currentIndex, queue, studyStartMs } = get()
    const newResults = [...results, result]
    const nextIndex = currentIndex + 1

    set({
      results: newResults,
      currentIndex: nextIndex,
      isComplete: nextIndex >= queue.length,
    })

    // Persist progress so it survives app restarts
    storage.setItem(KEY_PROGRESS, { userId: 'current', results: newResults, studyStartMs })
  },

  undoLastResult: () => {
    const { results, currentIndex, studyStartMs } = get()
    // Can only undo if we've graded at least one card and haven't completed the session
    if (results.length === 0 || currentIndex === 0) return false
    const newResults = results.slice(0, -1)
    const prevIndex = currentIndex - 1
    set({ results: newResults, currentIndex: prevIndex, isComplete: false })
    storage.setItem(KEY_PROGRESS, { userId: 'current', results: newResults, studyStartMs })
    return true
  },

  finishSession: async () => {
    const { results, studyStartMs } = get()
    if (results.length === 0) return null
    const studyTimeMs = Date.now() - studyStartMs

    // Weighted confidence: Easy=3, Good=2, Hard=1, Again=0 (legacy quality 0/2 → 0)
    const weightForQuality = (q: number): number => {
      if (q === 5) return 3
      if (q === 4) return 2
      if (q === 3) return 1
      return 0
    }
    const totalReviews = results.length
    const confidencePct = totalReviews > 0
      ? Math.round(
          (results.reduce((sum, r) => sum + weightForQuality(r.quality), 0) /
            (totalReviews * 3)) * 100
        )
      : 0

    try {
      const res = await api.post<{ sessionId: string; totalItems: number; correctItems: number; studyTimeMs: number; newLearned: number; burned: number }>(
        '/v1/review/submit', { results, studyTimeMs }
      )
      await storage.removeItem(KEY_PROGRESS)
      return { burned: res.burned, studyTimeMs: res.studyTimeMs, confidencePct }
    } catch {
      // Queue for later submission
      const pending = (await storage.getItem<PendingSession[]>(KEY_PENDING)) ?? []
      const session: PendingSession = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId: 'current',
        results,
        studyTimeMs,
        createdAt: Date.now(),
        attemptCount: 0,
      }
      await storage.setItem(KEY_PENDING, [...pending, session])
      await storage.removeItem(KEY_PROGRESS)
      set({ hasPendingSessions: true })
      // Re-throw so study.tsx can still show the summary
      throw new Error('Session saved offline — will sync when reconnected.')
    }
  },

  syncPendingSessions: async () => {
    const pending = await storage.getItem<PendingSession[]>(KEY_PENDING)
    if (!pending || pending.length === 0) {
      set({ hasPendingSessions: false })
      return
    }

    const now = Date.now()
    const remaining: PendingSession[] = []

    for (const session of pending) {
      // Discard stale entries
      if (session.attemptCount >= PENDING_MAX_ATTEMPTS && now - session.createdAt > PENDING_MAX_AGE_MS) {
        continue
      }

      try {
        await api.post('/v1/review/submit', { results: session.results, studyTimeMs: session.studyTimeMs })
        // Success — don't add back to remaining
      } catch {
        remaining.push({ ...session, attemptCount: session.attemptCount + 1 })
      }
    }

    if (remaining.length === 0) {
      await storage.removeItem(KEY_PENDING)
      set({ hasPendingSessions: false })
    } else {
      await storage.setItem(KEY_PENDING, remaining)
      set({ hasPendingSessions: remaining.length > 0 })
    }
  },

  loadMissedQueue: () => {
    const { results, queue } = get()
    const missedIds = new Set(results.filter((r) => r.quality < 3).map((r) => r.kanjiId))
    const missedCards = queue
      .filter((card) => missedIds.has(card.kanjiId))
      .map((card) => ({ ...card, reviewType: 'meaning' as const })) // reset to meaning for the re-drill
    if (missedCards.length === 0) return false
    storage.removeItem(KEY_PROGRESS)
    set({ queue: missedCards, currentIndex: 0, results: [], isComplete: false, studyStartMs: Date.now(), error: null })
    return true
  },

  reset: () => {
    storage.removeItem(KEY_PROGRESS)
    set({ queue: [], currentIndex: 0, results: [], isComplete: false, studyStartMs: 0, isOfflineQueue: false, isWeakDrill: false })
  },
}))
