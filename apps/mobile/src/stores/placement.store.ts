import { create } from 'zustand'
import { PlacementEngine } from '@kanji-learn/shared'
import { api } from '../lib/api'
import { storage } from '../lib/storage'
import type { PlacementQuestionData, PlacementResult, JlptLevel } from '@kanji-learn/shared'

const KEY_PENDING = 'kl:placement_pending'

interface PlacementStore {
  status: 'idle' | 'loading' | 'active' | 'submitting' | 'complete' | 'error'
  engine: PlacementEngine | null
  questions: PlacementQuestionData[]
  currentQuestionIndex: number
  phase: 'meaning' | 'reading'
  // Store level of each tested kanji for results breakdown
  kanjiLevelMap: Map<number, JlptLevel>
  stats: { passed: number; failed: number; total: number }
  passedByLevel: Partial<Record<JlptLevel, number>>
  totalApplied: number
  error: string | null

  startTest: () => Promise<void>
  answerMeaning: (correct: boolean) => Promise<void>
  answerReading: (correct: boolean) => Promise<void>
  _advance: () => Promise<void>
  complete: () => Promise<void>
  reset: () => void
}

async function fetchBatch(
  engine: PlacementEngine,
  kanjiLevelMap: Map<number, JlptLevel>
): Promise<PlacementQuestionData[]> {
  const level = engine.getCurrentLevel()
  const exclude = engine.getTestedIds()
  const { kanjiIds } = await api.get<{ kanjiIds: number[] }>(
    `/v1/placement/kanji-ids?level=${level}&exclude=${exclude.join(',')}`
  )
  if (kanjiIds.length === 0) return []
  const { questions } = await api.post<{ questions: PlacementQuestionData[] }>(
    '/v1/placement/questions',
    { kanjiIds }
  )
  // Record level for each kanji for results breakdown
  for (const q of questions) {
    kanjiLevelMap.set(q.kanjiId, q.jlptLevel as JlptLevel)
  }
  return questions
}

export const usePlacementStore = create<PlacementStore>((set, get) => ({
  status: 'idle',
  engine: null,
  questions: [],
  currentQuestionIndex: 0,
  phase: 'meaning',
  kanjiLevelMap: new Map(),
  stats: { passed: 0, failed: 0, total: 0 },
  passedByLevel: {},
  totalApplied: 0,
  error: null,

  startTest: async () => {
    set({ status: 'loading', error: null })
    try {
      // Retry any pending placement results from a previous failed complete()
      const pending = await storage.getItem<PlacementResult[]>(KEY_PENDING)
      if (pending && pending.length > 0) {
        try {
          await api.post('/v1/placement/complete', { results: pending })
          await storage.removeItem(KEY_PENDING)
        } catch {
          // Will try again next time
        }
      }

      const engine = new PlacementEngine()
      const kanjiLevelMap = new Map<number, JlptLevel>()
      const questions = await fetchBatch(engine, kanjiLevelMap)
      if (questions.length === 0) {
        set({ status: 'error', error: 'No kanji available for placement test.' })
        return
      }
      set({ engine, questions, kanjiLevelMap, currentQuestionIndex: 0, phase: 'meaning', status: 'active' })
    } catch (err: any) {
      set({ status: 'error', error: err?.message ?? 'Failed to start test' })
    }
  },

  answerMeaning: async (correct) => {
    const { engine, questions, currentQuestionIndex, kanjiLevelMap } = get()
    if (!engine) return

    if (!correct) {
      // Failed on meaning — record fail and advance
      const q = questions[currentQuestionIndex]
      engine.recordResult(q.kanjiId, false)

      if (engine.isDone()) {
        set({ stats: engine.getStats(), passedByLevel: engine.getPassedByLevel(kanjiLevelMap) })
        await get().complete()
        return
      }

      await get()._advance()
      return
    }

    // Correct meaning — move to reading phase
    set({ phase: 'reading' })
  },

  answerReading: async (correct) => {
    const { engine, questions, currentQuestionIndex, kanjiLevelMap } = get()
    if (!engine) return

    const q = questions[currentQuestionIndex]
    engine.recordResult(q.kanjiId, correct)

    if (engine.isDone()) {
      set({ stats: engine.getStats(), passedByLevel: engine.getPassedByLevel(kanjiLevelMap) })
      await get().complete()
      return
    }

    await get()._advance()
  },

  // Internal: advance to next question, fetching next batch if needed
  _advance: async () => {
    const { engine, questions, currentQuestionIndex, kanjiLevelMap } = get() as any
    const nextIndex = currentQuestionIndex + 1

    if (nextIndex < questions.length) {
      set({ currentQuestionIndex: nextIndex, phase: 'meaning' })
      return
    }

    // Need next batch
    set({ status: 'loading' })
    try {
      const nextQuestions = await fetchBatch(engine!, kanjiLevelMap)
      if (nextQuestions.length === 0) {
        // No more kanji — end test
        set({ stats: engine!.getStats(), passedByLevel: engine!.getPassedByLevel(kanjiLevelMap) })
        await get().complete()
        return
      }
      set({ questions: nextQuestions, currentQuestionIndex: 0, phase: 'meaning', status: 'active' })
    } catch (err: any) {
      set({ status: 'error', error: err?.message ?? 'Failed to fetch next batch' })
    }
  },

  complete: async () => {
    const { engine, kanjiLevelMap } = get()
    if (!engine) return
    set({ status: 'submitting', stats: engine.getStats(), passedByLevel: engine.getPassedByLevel(kanjiLevelMap) })
    const results = engine.getResults()
    try {
      const data = await api.post<{ applied: number; skipped: number }>('/v1/placement/complete', { results })
      set({ status: 'complete', totalApplied: data.applied })
    } catch {
      // Save for retry
      await storage.setItem(KEY_PENDING, results)
      set({ status: 'complete', totalApplied: results.filter((r) => r.passed).length })
    }
  },

  reset: () => {
    set({
      status: 'idle',
      engine: null,
      questions: [],
      currentQuestionIndex: 0,
      phase: 'meaning',
      kanjiLevelMap: new Map(),
      stats: { passed: 0, failed: 0, total: 0 },
      passedByLevel: {},
      totalApplied: 0,
      error: null,
    })
  },
}))
