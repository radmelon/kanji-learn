import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  selectNextItems, getQuestionsWithDistractors, completePlacement, getSessionPrior,
} from '../services/placement.service.js'
import { CoachingService } from '../services/buddy/coaching.service.js'

export async function placementRoutes(server: FastifyInstance) {
  // GET /v1/placement/session-prior — does this user have a prior placement
  // to retest from? (spec §10.1 — server determines retest-ness itself.)
  server.get('/session-prior', { preHandler: [server.authenticate] }, async (req, reply) => {
    const result = await getSessionPrior(server.db, req.userId!)
    return reply.send({ ok: true, data: result })
  })

  // GET /v1/placement/next-items?theta=<num>&exclude=<csv>&count=<n>
  server.get<{ Querystring: { theta?: string; exclude?: string; count?: string } }>(
    '/next-items',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const theta = req.query.theta != null ? Number(req.query.theta) : 0
      if (!Number.isFinite(theta)) {
        return reply.code(400).send({ ok: false, error: 'Invalid theta', code: 'VALIDATION_ERROR' })
      }
      const exclude = (req.query.exclude ?? '')
        .split(',')
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0)
      const count = req.query.count != null ? Number(req.query.count) : 5

      const items = await selectNextItems(server.db, req.userId!, theta, exclude, count)
      return reply.send({ ok: true, data: { items } })
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
        responses: z
          .array(
            z.object({
              kanjiId: z.number().int().positive(),
              itemType: z.enum(['meaning', 'reading']),
              correct: z.boolean(),
            })
          )
          .min(1)
          .max(400), // up to 24 characters (cap) × 2 items, plus headroom
      })
      const parsed = schema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: parsed.error.message, code: 'VALIDATION_ERROR' })
      }
      const result = await completePlacement(server.db, req.userId!, parsed.data.responses)
      // §6: immediate, because this is the moment the learner is asking "what
      // does that mean?". Forced — this is a real event, not a read.
      try {
        await new CoachingService(server.db).refresh(req.userId!, { force: true })
      } catch (err) {
        req.log.error({ err, userId: req.userId }, '[Placement] coaching refresh failed')
      }
      return reply.send({ ok: true, data: result })
    }
  )
}
