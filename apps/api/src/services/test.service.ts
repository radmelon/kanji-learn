import { and, eq, ne, sql, desc } from 'drizzle-orm'
import { userKanjiProgress, kanji, testSessions, testResults } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'

// ─── Types ────────────────────────────────────────────────────────────────────

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
  prompt: string
}

export interface SubmitAnswer {
  kanjiId: number
  selectedIndex: number    // which option the user picked
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

// ─── Test Service ─────────────────────────────────────────────────────────────

export class TestService {
  constructor(private db: Db) {}

  async generateQuestions(
    userId: string,
    limit: number,
    questionTypes: QuestionType[] = ['meaning_recall']
  ): Promise<TestQuestion[]> {
    // Fetch pool of seen kanji with all fields needed for any question type
    const seen = await this.db
      .select({
        kanjiId: userKanjiProgress.kanjiId,
        character: kanji.character,
        jlptLevel: kanji.jlptLevel,
        meanings: kanji.meanings,
        kunReadings: kanji.kunReadings,
        onReadings: kanji.onReadings,
        exampleVocab: kanji.exampleVocab,
      })
      .from(userKanjiProgress)
      .innerJoin(kanji, eq(userKanjiProgress.kanjiId, kanji.id))
      .where(
        and(
          eq(userKanjiProgress.userId, userId),
          ne(userKanjiProgress.status, 'unseen')
        )
      )
      .orderBy(sql`RANDOM()`)
      .limit(limit * 4)

    if (seen.length < 4) return []

    const questionKanji = seen.slice(0, limit)
    const pool = seen // full pool used for distractors

    const questions: TestQuestion[] = []

    for (const qk of questionKanji) {
      const type = questionTypes[Math.floor(Math.random() * questionTypes.length)]!
      const q = this.buildQuestion(qk, pool, type)
      if (q) questions.push(q)
    }

    return questions
  }

  private buildQuestion(
    qk: { kanjiId: number; character: string; jlptLevel: string; meanings: unknown; kunReadings: unknown; onReadings: unknown; exampleVocab: unknown },
    pool: typeof qk[],
    type: QuestionType
  ): TestQuestion | null {
    const meanings = (qk.meanings as string[]) ?? []
    const kunReadings = (qk.kunReadings as string[]) ?? []
    const onReadings = (qk.onReadings as string[]) ?? []
    const exampleVocab = (qk.exampleVocab as { word: string; reading: string; meaning: string }[]) ?? []
    const primaryMeaning = meanings[0] ?? ''
    const cleanReading = (r: string) => r.replace(/\..+$/, '')

    const shuffle = <T>(arr: T[]): T[] => {
      const a = [...arr]
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[a[i], a[j]] = [a[j]!, a[i]!]
      }
      return a
    }

    const pickDistractors = (
      correct: string,
      extract: (k: typeof qk) => string | null,
      count = 3
    ): string[] => {
      const distractors: string[] = []
      const candidates = shuffle(pool.filter((k) => k.kanjiId !== qk.kanjiId))
      for (const k of candidates) {
        if (distractors.length >= count) break
        const val = extract(k)
        if (val && val !== correct && !distractors.includes(val)) distractors.push(val)
      }
      while (distractors.length < count) distractors.push(`—`)
      return distractors
    }

    const makeOptions = (correct: string, distractors: string[]) => {
      const opts = shuffle([correct, ...distractors])
      return { options: opts, correctIndex: opts.indexOf(correct) }
    }

    switch (type) {
      case 'meaning_recall': {
        if (!primaryMeaning) return null
        const distractors = pickDistractors(primaryMeaning, (k) => ((k.meanings as string[]) ?? [])[0] ?? null)
        const { options, correctIndex } = makeOptions(primaryMeaning, distractors)
        return { kanjiId: qk.kanjiId, character: qk.character, jlptLevel: qk.jlptLevel, primaryMeaning, options, correctIndex, questionType: 'meaning_recall', prompt: qk.character }
      }

      case 'kanji_from_meaning': {
        if (!primaryMeaning) return null
        const distractors = pickDistractors(qk.character, (k) => k.character)
        const { options, correctIndex } = makeOptions(qk.character, distractors)
        return { kanjiId: qk.kanjiId, character: qk.character, jlptLevel: qk.jlptLevel, primaryMeaning, options, correctIndex, questionType: 'kanji_from_meaning', prompt: primaryMeaning }
      }

      case 'reading_recall': {
        const correctReading = kunReadings.length > 0 ? cleanReading(kunReadings[0]!) : onReadings[0] ?? null
        if (!correctReading) return null
        const distractors = pickDistractors(correctReading, (k) => {
          const kuns = (k.kunReadings as string[]) ?? []
          const ons = (k.onReadings as string[]) ?? []
          const r = kuns[0] ?? ons[0]
          return r ? cleanReading(r) : null
        })
        const { options, correctIndex } = makeOptions(correctReading, distractors)
        return { kanjiId: qk.kanjiId, character: qk.character, jlptLevel: qk.jlptLevel, primaryMeaning, options, correctIndex, questionType: 'reading_recall', prompt: qk.character }
      }

      case 'vocab_reading': {
        const vocab = exampleVocab[0]
        if (!vocab?.reading) return null
        const distractors = pickDistractors(vocab.reading, (k) => {
          const ev = ((k.exampleVocab as { word: string; reading: string; meaning: string }[]) ?? [])[0]
          return ev?.reading ?? null
        })
        const { options, correctIndex } = makeOptions(vocab.reading, distractors)
        return { kanjiId: qk.kanjiId, character: qk.character, jlptLevel: qk.jlptLevel, primaryMeaning, options, correctIndex, questionType: 'vocab_reading', prompt: vocab.word }
      }

      case 'vocab_from_definition': {
        const vocab = exampleVocab[0]
        if (!vocab?.word || !vocab?.meaning) return null
        const distractors = pickDistractors(vocab.word, (k) => {
          const ev = ((k.exampleVocab as { word: string; reading: string; meaning: string }[]) ?? [])[0]
          return ev?.word ?? null
        })
        const { options, correctIndex } = makeOptions(vocab.word, distractors)
        return { kanjiId: qk.kanjiId, character: qk.character, jlptLevel: qk.jlptLevel, primaryMeaning, options, correctIndex, questionType: 'vocab_from_definition', prompt: vocab.meaning }
      }
    }
  }

  async getQuizAnalytics(userId: string) {
    // Aggregate stats across all sessions
    const [agg] = await this.db
      .select({
        totalSessions: sql<number>`count(*)::int`,
        passed: sql<number>`count(*) filter (where passed = true)::int`,
        avgScore: sql<number>`ROUND(AVG(score_pct)::numeric, 1)`,
      })
      .from(testSessions)
      .where(eq(testSessions.userId, userId))

    const totalSessions = Number(agg?.totalSessions ?? 0)
    const passRate = totalSessions > 0 ? Math.round((Number(agg?.passed ?? 0) / totalSessions) * 100) : 0
    const avgScore = Number(agg?.avgScore ?? 0)

    // Last 20 sessions
    const sessions = await this.db
      .select({
        id: testSessions.id,
        startedAt: testSessions.startedAt,
        scorePct: testSessions.scorePct,
        passed: testSessions.passed,
        total: testSessions.totalItems,
        correct: testSessions.correct,
      })
      .from(testSessions)
      .where(eq(testSessions.userId, userId))
      .orderBy(desc(testSessions.startedAt))
      .limit(20)

    const recentSessions = sessions.map((s) => ({
      id: s.id,
      date: s.startedAt!.toISOString().slice(0, 10),
      scorePct: Math.round(Number(s.scorePct ?? 0)),
      passed: s.passed ?? false,
      total: s.total ?? 0,
      correct: s.correct,
    }))

    // Weakest kanji: group by kanji, miss rate desc, min 3 attempts
    const weak = await this.db
      .select({
        kanjiId: testResults.kanjiId,
        character: kanji.character,
        totalQ: sql<number>`count(*)::int`,
        missCount: sql<number>`count(*) filter (where correct = false)::int`,
      })
      .from(testResults)
      .innerJoin(kanji, eq(testResults.kanjiId, kanji.id))
      .where(eq(testResults.userId, userId))
      .groupBy(testResults.kanjiId, kanji.character)
      .having(sql`count(*) >= 3`)
      .orderBy(sql`count(*) filter (where correct = false)::numeric / count(*) desc`)
      .limit(10)

    const weakestKanji = weak.map((r) => ({
      kanjiId: r.kanjiId,
      character: r.character,
      totalQuestions: Number(r.totalQ),
      missCount: Number(r.missCount),
      missRate: Math.round((Number(r.missCount) / Number(r.totalQ)) * 100),
    }))

    return { totalSessions, passRate, avgScore, recentSessions, weakestKanji }
  }

  async saveSession(userId: string, submission: TestSubmission): Promise<TestResultSummary> {
    const total = submission.answers.length

    // Compute correct count
    let correct = 0
    for (const answer of submission.answers) {
      const question = submission.questions.find((q) => q.kanjiId === answer.kanjiId)
      if (question?.correctIndex === answer.selectedIndex) {
        correct++
      }
    }

    const scorePct = total > 0 ? (correct / total) * 100 : 0
    const passed = scorePct >= 70

    // INSERT into kl_test_sessions
    const [session] = await this.db
      .insert(testSessions)
      .values({
        userId,
        testType: submission.testType,
        startedAt: new Date(),
        endedAt: new Date(),
        totalItems: total,
        correct,
        scorePct: scorePct.toFixed(2),
        passed,
        voiceEnabled: false,
      })
      .returning({ id: testSessions.id })

    const sessionId = session!.id

    // INSERT into kl_test_results — one row per answer
    if (submission.answers.length > 0) {
      await this.db.insert(testResults).values(
        submission.answers.map((answer) => {
          const question = submission.questions.find((q) => q.kanjiId === answer.kanjiId)
          const isCorrect = question?.correctIndex === answer.selectedIndex

          return {
            testSessionId: sessionId,
            userId,
            kanjiId: answer.kanjiId,
            questionType: question?.questionType ?? 'meaning_recall',
            correct: isCorrect ?? false,
            responseMs: answer.responseMs,
            quality: (isCorrect ? 4 : 1) as 4 | 1,
          }
        })
      )
    }

    return {
      sessionId,
      correct,
      total,
      scorePct: Math.round(scorePct * 100) / 100,
      passed,
    }
  }
}
