import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { TestService } from '../services/test.service.js'
import type { QuestionType } from '../services/test.service.js'

const VALID_QUESTION_TYPES: QuestionType[] = [
  'meaning_recall',
  'kanji_from_meaning',
  'reading_recall',
  'vocab_reading',
  'vocab_from_definition',
]

const submitAnswerSchema = z.object({
  kanjiId: z.number().int().positive(),
  selectedIndex: z.number().int().min(0).max(3),
  responseMs: z.number().int().nonnegative(),
})

const testQuestionSchema = z.object({
  kanjiId: z.number().int().positive(),
  character: z.string(),
  jlptLevel: z.string(),
  primaryMeaning: z.string(),
  options: z.array(z.string()).length(4),
  correctIndex: z.number().int().min(0).max(3),
  questionType: z.string(),
  prompt: z.string(),
})

const submitTestSchema = z.object({
  testType: z.string().min(1),
  questions: z.array(testQuestionSchema).min(1).max(200),
  answers: z.array(submitAnswerSchema).min(1).max(200),
})

export async function testRoutes(server: FastifyInstance) {
  const testService = new TestService(server.db)

  // GET /v1/tests/questions?limit=10&types=meaning_recall,reading_recall
  server.get<{ Querystring: { limit?: string; types?: string } }>(
    '/questions',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const limit = Math.min(Number(req.query.limit ?? 10), 50)
      const requestedTypes = req.query.types
        ? (req.query.types.split(',').filter((t) => VALID_QUESTION_TYPES.includes(t as QuestionType)) as QuestionType[])
        : ['meaning_recall' as const]
      const types = requestedTypes.length > 0 ? requestedTypes : ['meaning_recall' as const]
      const questions = await testService.generateQuestions(req.userId!, limit, types)
      return reply.send({ ok: true, data: questions })
    }
  )

  // GET /v1/tests/analytics
  server.get(
    '/analytics',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const data = await testService.getQuizAnalytics(req.userId!)
      return reply.send({ ok: true, data })
    }
  )

  // POST /v1/tests/submit
  server.post(
    '/submit',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const body = submitTestSchema.safeParse(req.body)
      if (!body.success) {
        return reply.code(400).send({
          ok: false,
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          details: body.error,
        })
      }

      const result = await testService.saveSession(req.userId!, body.data)
      return reply.code(201).send({ ok: true, data: result })
    }
  )
}
