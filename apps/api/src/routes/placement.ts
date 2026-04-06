import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sampleKanjiIds, getQuestionsWithDistractors, applyPlacementResults } from '../services/placement.service.js'

export async function placementRoutes(server: FastifyInstance) {
  // GET /v1/placement/kanji-ids?level=N3&exclude=1,2,3
  server.get<{ Querystring: { level?: string; exclude?: string } }>(
    '/kanji-ids',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const level = req.query.level ?? 'N3'
      if (!['N5', 'N4', 'N3', 'N2', 'N1'].includes(level)) {
        return reply.code(400).send({ ok: false, error: 'Invalid level', code: 'VALIDATION_ERROR' })
      }
      const exclude = (req.query.exclude ?? '')
        .split(',')
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0)

      const kanjiIds = await sampleKanjiIds(server.db, req.userId!, level, exclude, 5)
      return reply.send({ ok: true, data: { kanjiIds } })
    }
  )

  // POST /v1/placement/questions
  server.post<{ Body: unknown }>(
    '/questions',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const schema = z.object({ kanjiIds: z.array(z.number().int().positive()).min(1).max(10) })
      const parsed = schema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: parsed.error.message, code: 'VALIDATION_ERROR' })
      }
      const questions = await getQuestionsWithDistractors(server.db, parsed.data.kanjiIds)
      return reply.send({ ok: true, data: { questions } })
    }
  )

  // POST /v1/placement/complete
  server.post<{ Body: unknown }>(
    '/complete',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const schema = z.object({
        results: z.array(z.object({ kanjiId: z.number().int().positive(), passed: z.boolean() })).min(1).max(200),
      })
      const parsed = schema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: parsed.error.message, code: 'VALIDATION_ERROR' })
      }
      const result = await applyPlacementResults(server.db, req.userId!, parsed.data.results)
      return reply.send({ ok: true, data: result })
    }
  )
}
