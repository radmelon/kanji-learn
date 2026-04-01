import { and, eq, ne, sql } from 'drizzle-orm'
import { userKanjiProgress, kanji, testSessions, testResults } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TestQuestion {
  kanjiId: number
  character: string
  jlptLevel: string
  primaryMeaning: string
  options: string[]        // 4 shuffled options (includes primaryMeaning)
  correctIndex: number     // index of correct option in options[]
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

  async generateQuestions(userId: string, limit: number): Promise<TestQuestion[]> {
    // Fetch up to limit*3 kanji the user has seen (status != 'unseen'), ordered randomly
    const seen = await this.db
      .select({
        kanjiId: userKanjiProgress.kanjiId,
        character: kanji.character,
        jlptLevel: kanji.jlptLevel,
        meanings: kanji.meanings,
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
      .limit(limit * 3)

    const questionKanji = seen.slice(0, limit)
    const distractorPool = seen.slice(limit)

    const questions: TestQuestion[] = questionKanji.map((qk) => {
      const primaryMeaning = (qk.meanings as string[])[0] ?? ''

      // Pick 3 random distractors from the pool (different kanjiId)
      const available = distractorPool.filter((d) => d.kanjiId !== qk.kanjiId)
      const distractors: string[] = []
      const used = new Set<number>()
      while (distractors.length < 3 && used.size < available.length) {
        const idx = Math.floor(Math.random() * available.length)
        const d = available[idx]
        if (!used.has(idx) && d) {
          used.add(idx)
          const dm = (d.meanings as string[])[0]
          if (dm && dm !== primaryMeaning && !distractors.includes(dm)) {
            distractors.push(dm)
          }
        }
      }

      // Pad with empty strings if not enough distractors (edge case for small pools)
      while (distractors.length < 3) {
        distractors.push(`option ${distractors.length + 2}`)
      }

      // Shuffle all 4 options
      const options = [primaryMeaning, ...distractors]
      for (let i = options.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[options[i], options[j]] = [options[j]!, options[i]!]
      }

      const correctIndex = options.indexOf(primaryMeaning)

      return {
        kanjiId: qk.kanjiId,
        character: qk.character,
        jlptLevel: qk.jlptLevel,
        primaryMeaning,
        options,
        correctIndex,
      }
    })

    return questions
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
            questionType: 'meaning_recall',
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
