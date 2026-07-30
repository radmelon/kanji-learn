import { create } from 'zustand'
import { PlacementEngine } from '@kanji-learn/shared'
import { api } from '../lib/api'
import { storage } from '../lib/storage'
import type { PlacementQuestionData, PlacementResponse, JlptLevel } from '@kanji-learn/shared'

const KEY_PENDING = 'kl:placement_pending'

const FLOOR_CHARACTERS_FIRST = 8
const CAP_CHARACTERS_FIRST = 24
const FLOOR_CHARACTERS_RETEST = 4
const CAP_CHARACTERS_RETEST = 12
const BAND_WIDTH = 1.5 // spec §7.4 — 80% CI fits inside ±1 JLPT band
const READING_OFFSET = 0.4 // matches DEFAULT_READING_OFFSET in placement-difficulty.service.ts until calibrated

interface PlacementStore {
  status: 'idle' | 'loading' | 'active' | 'submitting' | 'complete' | 'error'
  engine: PlacementEngine | null
  questions: PlacementQuestionData[]
  currentQuestionIndex: number
  phase: 'meaning' | 'reading'
  kanjiLevelMap: Map<number, JlptLevel>
  totalApplied: number
  inferredLevel: JlptLevel | null
  isRetest: boolean
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
  const theta = engine.getThetaHat()
  const exclude = engine.getAskedKanjiIds()
  const { items } = await api.get<{ items: { kanjiId: number; bMeaning: number; bReading: number }[] }>(
    `/v1/placement/next-items?theta=${theta}&exclude=${exclude.join(',')}&count=5`
  )
  if (items.length === 0) return []
  const { questions } = await api.post<{ questions: PlacementQuestionData[] }>(
    '/v1/placement/questions',
    { kanjiIds: items.map((i) => i.kanjiId) }
  )
  for (const q of questions) {
    kanjiLevelMap.set(q.kanjiId, q.jlptLevel)
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
  totalApplied: 0,
  inferredLevel: null,
  isRetest: false,
  error: null,

  startTest: async () => {
    set({ status: 'loading', error: null })
    try {
      const pending = await storage.getItem<PlacementResponse[]>(KEY_PENDING)
      if (pending && pending.length > 0) {
        try {
          await api.post('/v1/placement/complete', { responses: pending })
          await storage.removeItem(KEY_PENDING)
        } catch {
          // Will try again next time
        }
      }

      const prior = await api.get<{ hasPrior: boolean; theta: number; se: number }>('/v1/placement/session-prior')
      const isRetest = prior.hasPrior
      const engine = new PlacementEngine({
        floorCharacters: isRetest ? FLOOR_CHARACTERS_RETEST : FLOOR_CHARACTERS_FIRST,
        capCharacters: isRetest ? CAP_CHARACTERS_RETEST : CAP_CHARACTERS_FIRST,
        bandWidth: BAND_WIDTH,
        readingOffset: READING_OFFSET,
        priorMean: isRetest ? prior.theta : 0,
      })

      const kanjiLevelMap = new Map<number, JlptLevel>()
      const questions = await fetchBatch(engine, kanjiLevelMap)
      if (questions.length === 0) {
        set({ status: 'error', error: 'No kanji available for placement test.' })
        return
      }
      set({ engine, questions, kanjiLevelMap, currentQuestionIndex: 0, phase: 'meaning', isRetest, status: 'active' })
    } catch (err: any) {
      set({ status: 'error', error: err?.message ?? 'Failed to start test' })
    }
  },

  // Meaning is ALWAYS followed by reading now — no skip-on-fail (spec §5).
  answerMeaning: async (correct) => {
    const { engine, questions, currentQuestionIndex } = get()
    if (!engine) return
    const q = questions[currentQuestionIndex]
    engine.recordItemResult(q.kanjiId, 'meaning', q.bMeaning, correct)
    set({ phase: 'reading' })
  },

  answerReading: async (correct) => {
    const { engine, questions, currentQuestionIndex } = get()
    if (!engine) return
    const q = questions[currentQuestionIndex]
    engine.recordItemResult(q.kanjiId, 'reading', q.bReading, correct)

    if (engine.isDone()) {
      await get().complete()
      return
    }
    await get()._advance()
  },

  _advance: async () => {
    const { engine, questions, currentQuestionIndex, kanjiLevelMap } = get() as any
    const nextIndex = currentQuestionIndex + 1

    if (nextIndex < questions.length) {
      set({ currentQuestionIndex: nextIndex, phase: 'meaning' })
      return
    }

    set({ status: 'loading' })
    try {
      const nextQuestions = await fetchBatch(engine!, kanjiLevelMap)
      if (nextQuestions.length === 0) {
        await get().complete()
        return
      }
      set({ questions: nextQuestions, currentQuestionIndex: 0, phase: 'meaning', status: 'active' })
    } catch (err: any) {
      set({ status: 'error', error: err?.message ?? 'Failed to fetch next batch' })
    }
  },

  complete: async () => {
    const { engine } = get()
    if (!engine) return
    set({ status: 'submitting' })
    const responses: PlacementResponse[] = engine.getAskedItems().map((item) => ({
      kanjiId: item.kanjiId, itemType: item.itemType, correct: item.correct,
    }))
    try {
      const data = await api.post<{ appliedCount: number; inferredLevel: JlptLevel | null }>(
        '/v1/placement/complete',
        { responses }
      )
      set({ status: 'complete', totalApplied: data.appliedCount, inferredLevel: data.inferredLevel })
    } catch {
      await storage.setItem(KEY_PENDING, responses)
      set({ status: 'complete', totalApplied: 0, inferredLevel: null })
    }
  },

  reset: () => {
    set({
      status: 'idle', engine: null, questions: [], currentQuestionIndex: 0,
      phase: 'meaning', kanjiLevelMap: new Map(), totalApplied: 0,
      inferredLevel: null, isRetest: false, error: null,
    })
  },
}))
