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

// A time-boxed session loads a generous fixed queue and stops on the timer,
// not on a card count. 50 is the API's queue cap (GET /v1/review/queue).
const SESSION_QUEUE_SIZE = 50

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

/** The current kanji's position within the Practice Loop. */
export type LegName = 'flashcard' | 'writing' | 'speaking' | 'quiz'

/** Per-modality rep counts for the current session — shown on Session Complete. */
export interface ModalityCounts {
  flashcard: number
  writing: number
  speaking: number
  quiz: number
}

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
  /** Minutes budget for the current session; 0 = count-bounded (weak/missed drills) */
  goalMinutes: number
  /** The current kanji's leg in the loop. New + Again/Hard kanji run flashcard
   *  → writing → speaking; Good/Easy review kanji stay on 'flashcard' unless
   *  flagged 'maybe slipping', which routes them to 'quiz'. */
  leg: LegName
  /** Per-modality rep counts for the current session (Session Complete §5). */
  modalityCounts: ModalityCounts

  loadQueue: (goalMinutes: number) => Promise<void>
  submitResult: (result: ReviewResult) => void
  undoLastResult: () => boolean
  loadWeakQueue: (limit?: number) => Promise<boolean>
  finishSession: () => Promise<{ burned: number; studyTimeMs: number; confidencePct: number } | null>
  syncPendingSessions: () => Promise<void>
  loadMissedQueue: () => boolean
  reset: () => void
  /** Advance past the current kanji: bump the index, run the time-box check,
   *  reset the leg. Called when a kanji's full path is done. */
  endKanji: () => void
  /** Writing leg finished → move to the speaking leg. */
  completeWritingLeg: () => void
  /** Speaking leg finished → advance to the next kanji. */
  completeSpeakingLeg: () => void
  /** Quiz passed → the kanji is confirmed; advance to the next kanji. */
  passQuizLeg: () => void
  /** Quiz failed → downgrade the flashcard grade to a lapse and route to writing. */
  failQuizLeg: () => void
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  queue: [],
  currentIndex: 0,
  results: [],
  // Initial true so study.tsx's "All caught up!" branch (guarded by
  // `!isLoading && queue.length === 0`) doesn't flash for a render
  // frame on cold mount before the effect fires loadQueue().
  isLoading: true,
  isComplete: false,
  studyStartMs: 0,
  error: null,
  isOfflineQueue: false,
  hasPendingSessions: false,
  isWeakDrill: false,
  goalMinutes: 0,
  leg: 'flashcard',
  modalityCounts: { flashcard: 0, writing: 0, speaking: 0, quiz: 0 },

  loadQueue: async (goalMinutes) => {
    set({ isLoading: true, isComplete: false, currentIndex: 0, results: [], error: null, isOfflineQueue: false, isWeakDrill: false, goalMinutes, leg: 'flashcard', modalityCounts: { flashcard: 0, writing: 0, speaking: 0, quiz: 0 } })

    // Check for pending sessions immediately (fire-and-forget)
    const pending = await storage.getItem<PendingSession[]>(KEY_PENDING)
    if (pending && pending.length > 0) set({ hasPendingSessions: true })

    try {
      const queue = await api.get<ReviewQueueItem[]>(`/v1/review/queue?limit=${SESSION_QUEUE_SIZE}`)
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
          studyStartMs: Date.now(),
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
    set({ isLoading: true, isComplete: false, currentIndex: 0, results: [], error: null, isOfflineQueue: false, leg: 'flashcard' })
    try {
      const queue = await api.get<ReviewQueueItem[]>(`/v1/review/weak-queue?limit=${limit}`)
      const now = Date.now()
      if (queue.length === 0) {
        set({ isLoading: false })
        return false
      }
      set({ queue, studyStartMs: now, currentIndex: 0, results: [], isWeakDrill: true, goalMinutes: 0, leg: 'flashcard', modalityCounts: { flashcard: 0, writing: 0, speaking: 0, quiz: 0 } })
      return true
    } catch (err: any) {
      set({ error: err?.message ?? 'Could not load weak kanji queue.' })
      return false
    } finally {
      set({ isLoading: false })
    }
  },

  submitResult: (result) => {
    const { results, queue, currentIndex, studyStartMs, modalityCounts } = get()
    const newResults = [...results, result]
    const item = queue[currentIndex]

    // The flashcard grade is final at grade time — record + persist it now,
    // and count the flashcard rep.
    set({
      results: newResults,
      modalityCounts: { ...modalityCounts, flashcard: modalityCounts.flashcard + 1 },
    })
    storage.setItem(KEY_PROGRESS, { userId: 'current', results: newResults, studyStartMs })

    // Per-kanji loop routing — main loop only (weak/missed drills have
    // goalMinutes 0 and stay flashcard-only).
    //   • A new kanji, or an Again(1)/Hard(3) review kanji → writing → speaking.
    //   • A Good/Easy review kanji flagged "maybe slipping" → quiz.
    //   • A Good/Easy review kanji not flagged → done.
    const { goalMinutes } = get()
    const isNew = item?.status === 'unseen'
    const isWeak = result.quality === 1 || result.quality === 3

    if (goalMinutes > 0 && (isNew || isWeak)) {
      set({ leg: 'writing' })
    } else if (goalMinutes > 0 && item?.maybeSlipping) {
      set({ leg: 'quiz' })
    } else {
      get().endKanji()
    }
  },

  endKanji: () => {
    const { currentIndex, queue, studyStartMs, goalMinutes } = get()
    const nextIndex = currentIndex + 1

    // The session ends when the queue is exhausted OR — for a time-boxed
    // session (goalMinutes > 0) — when the minutes budget has elapsed. This
    // check runs only when a kanji's FULL path is done, so a session never
    // cuts off mid-writing or mid-speaking.
    const overBudget =
      goalMinutes > 0 && Date.now() - studyStartMs >= goalMinutes * 60_000

    set({
      currentIndex: nextIndex,
      isComplete: nextIndex >= queue.length || overBudget,
      leg: 'flashcard',
    })
  },

  completeWritingLeg: () => {
    const { modalityCounts } = get()
    set({ leg: 'speaking', modalityCounts: { ...modalityCounts, writing: modalityCounts.writing + 1 } })
  },

  completeSpeakingLeg: () => {
    const { modalityCounts } = get()
    set({ modalityCounts: { ...modalityCounts, speaking: modalityCounts.speaking + 1 } })
    get().endKanji()
  },

  passQuizLeg: () => {
    const { modalityCounts } = get()
    set({ modalityCounts: { ...modalityCounts, quiz: modalityCounts.quiz + 1 } })
    get().endKanji()
  },

  failQuizLeg: () => {
    const { results, studyStartMs, modalityCounts } = get()
    // A failed quiz is a genuine lapse (spec §4). The flashcard result for
    // this kanji is the last one submitResult appended — rewrite its grade to
    // Again (1) so finishSession → POST /v1/review/submit reschedules the card
    // sooner. The quiz attempt itself is recorded to testSessions separately
    // by QuizLeg via POST /v1/tests/submit.
    const downgraded = results.length > 0
      ? [...results.slice(0, -1), { ...results[results.length - 1]!, quality: 1 as const }]
      : results
    set({
      results: downgraded,
      leg: 'writing',
      modalityCounts: { ...modalityCounts, quiz: modalityCounts.quiz + 1 },
    })
    storage.setItem(KEY_PROGRESS, { userId: 'current', results: downgraded, studyStartMs })
  },

  undoLastResult: () => {
    const { results, currentIndex, studyStartMs } = get()
    // Can only undo if we've graded at least one card and haven't completed the session
    if (results.length === 0 || currentIndex === 0) return false
    const newResults = results.slice(0, -1)
    const prevIndex = currentIndex - 1
    set({ results: newResults, currentIndex: prevIndex, isComplete: false, leg: 'flashcard' })
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

    // Fetch the profile setting to decide whether to capture location.
    // Inline import to avoid pulling expo-location into the bundle when the
    // flag is off (tree-shaken on first read).
    let clientContext: { location?: { lat: number; lon: number; accuracy?: number } } | undefined
    try {
      const profile = await api.get<{ attachLocationToMilestones?: boolean }>('/v1/user/profile')
      if (profile.attachLocationToMilestones) {
        const { tryGetCoordsForCapture } = await import('../utils/location')
        const coords = await tryGetCoordsForCapture()
        if (coords) clientContext = { location: coords }
      }
    } catch {
      // Profile fetch failure should never block a review submit — silently skip
      // location stamping rather than dropping the review.
    }

    try {
      const res = await api.post<{ sessionId: string; totalItems: number; correctItems: number; studyTimeMs: number; newLearned: number; burned: number }>(
        '/v1/review/submit', { results, studyTimeMs, ...(clientContext ? { clientContext } : {}) }
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
    // "Missed" must match the SessionComplete `wrong` threshold (totalItems -
    // correctItems where correct = quality >= 4). Without this alignment,
    // the "Drill N missed cards" button shows a count that loadMissedQueue
    // can't actually fill, and returns false (button does nothing).
    const missedIds = new Set(results.filter((r) => r.quality < 4).map((r) => r.kanjiId))
    const missedCards = queue
      .filter((card) => missedIds.has(card.kanjiId))
      .map((card) => ({ ...card, reviewType: 'meaning' as const })) // reset to meaning for the re-drill
    if (missedCards.length === 0) return false
    storage.removeItem(KEY_PROGRESS)
    set({ queue: missedCards, currentIndex: 0, results: [], isComplete: false, studyStartMs: Date.now(), error: null, goalMinutes: 0, leg: 'flashcard', modalityCounts: { flashcard: 0, writing: 0, speaking: 0, quiz: 0 } })
    return true
  },

  reset: () => {
    storage.removeItem(KEY_PROGRESS)
    set({ queue: [], currentIndex: 0, results: [], isComplete: false, studyStartMs: 0, isOfflineQueue: false, isWeakDrill: false, goalMinutes: 0, leg: 'flashcard', modalityCounts: { flashcard: 0, writing: 0, speaking: 0, quiz: 0 } })
  },
}))
