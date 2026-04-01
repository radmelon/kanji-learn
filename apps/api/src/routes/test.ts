import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { TestService } from '../services/test.service.js'

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
})

const submitTestSchema = z.object({
  testType: z.string().min(1),
  questions: z.array(testQuestionSchema).min(1).max(200),
  answers: z.array(submitAnswerSchema).min(1).max(200),
})

export async function testRoutes(server: FastifyInstance) {
  const testService = new TestService(server.db)

  // GET /v1/tests/questions?limit=10
  server.get<{ Querystring: { limit?: string } }>(
    '/questions',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const limit = Math.min(Number(req.query.limit ?? 10), 50)
      const questions = await testService.generateQuestions(req.userId!, limit)
      return reply.send({ ok: true, data: questions })
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
