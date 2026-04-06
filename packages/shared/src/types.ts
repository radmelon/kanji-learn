// ─── SRS Status ───────────────────────────────────────────────────────────────

export type SrsStatus = 'unseen' | 'learning' | 'reviewing' | 'remembered' | 'burned'

// ─── Reading Stage ────────────────────────────────────────────────────────────

/** 0=meaning only, 1=kun'yomi, 2=on'yomi via vocab, 3=all readings, 4=compound tests */
export type ReadingStage = 0 | 1 | 2 | 3 | 4

// ─── JLPT Level ───────────────────────────────────────────────────────────────

export type JlptLevel = 'N5' | 'N4' | 'N3' | 'N2' | 'N1'

// ─── Kanji ────────────────────────────────────────────────────────────────────

export interface Kanji {
  id: number
  character: string
  jlptLevel: JlptLevel
  jlptOrder: number
  strokeCount: number
  meanings: string[]
  kunReadings: string[]
  onReadings: string[]
  exampleVocab: VocabExample[]
}

export interface VocabExample {
  word: string
  reading: string
  meaning: string
}

// ─── User Progress ────────────────────────────────────────────────────────────

export interface UserKanjiProgress {
  userId: string
  kanjiId: number
  status: SrsStatus
  readingStage: ReadingStage
  easeFactor: number
  interval: number
  repetitions: number
  nextReviewAt: Date
  lastReviewedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

// ─── Mnemonic ─────────────────────────────────────────────────────────────────

export type MnemonicType = 'system' | 'user'

export interface Mnemonic {
  id: string
  kanjiId: number
  userId: string | null
  type: MnemonicType
  storyText: string
  imagePrompt: string | null
  refreshPromptAt: Date | null
  createdAt: Date
  updatedAt: Date
}

// ─── Review Session ───────────────────────────────────────────────────────────

export interface ReviewItem {
  kanjiId: number
  character: string
  reviewType: 'meaning' | 'reading' | 'writing' | 'compound'
}

export interface ReviewResult {
  kanjiId: number
  quality: 0 | 1 | 2 | 3 | 4 | 5
  responseTimeMs: number
  reviewType: ReviewItem['reviewType']
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface DailyStats {
  date: string
  reviewed: number
  correct: number
  newLearned: number
  burned: number
  studyTimeMs: number
}

export interface JlptLevelProjection {
  level: string
  total: number       // total kanji in this level
  seen: number        // learning + reviewing + remembered + burned
  burned: number      // how many user has burned
  remaining: number   // left to burn
  projectedDate: Date | null  // null if burnedPerDay is 0
}

export interface VelocityMetrics {
  dailyAverage: number       // avg reviews/day, last 30 days
  weeklyAverage: number      // avg reviews/day, last 7 days
  burnedPerDay: number       // avg kanji burned/day, last 30 days
  trend: 'up' | 'down' | 'stable'
  projectedCompletion: Date | null        // all 2,294 Jouyou kanji
  levelProjections: JlptLevelProjection[] // per-JLPT-level breakdown
  nextMilestone: JlptLevelProjection | null // first incomplete level
}

// ─── API Response ─────────────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  ok: true
  data: T
}

export interface ApiError {
  ok: false
  error: string
  code: string
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

// ─── Test Session ─────────────────────────────────────────────────────────────

export type QuestionType =
  | 'meaning_recall'
  | 'kanji_from_meaning'
  | 'reading_recall'
  | 'vocab_reading'
  | 'vocab_from_definition'

export interface TestQuestion {
  kanjiId: number
  character: string
  jlptLevel: string
  primaryMeaning: string
  options: string[]
  correctIndex: number
  questionType: QuestionType
  /** The text/character shown as the question prompt */
  prompt: string
}

export interface SubmitAnswer {
  kanjiId: number
  selectedIndex: number
  responseMs: number
}

export interface TestSubmission {
  testType: string
  questions: TestQuestion[]
  answers: SubmitAnswer[]
}

export interface TestResultSummary {
  sessionId: number
  correct: number
  total: number
  scorePct: number
  passed: boolean
}

// ─── Placement Test ───────────────────────────────────────────────────────────

export interface PlacementQuestionData {
  kanjiId: number
  character: string
  jlptLevel: JlptLevel
  meaningOptions: string[]
  correctMeaningIndex: number
  readingOptions: string[]
  correctReadingIndex: number
}

export interface PlacementResult {
  kanjiId: number
  passed: boolean
}
