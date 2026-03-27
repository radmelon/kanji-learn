import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { SrsService } from '../services/srs.service.js'
import { InterventionService } from '../services/intervention.service.js'
import { AnalyticsService } from '../services/analytics.service.js'

const reviewResultSchema = z.object({
  kanjiId: z.number().int().positive(),
  quality: z.union([
    z.literal(0), z.literal(1), z.literal(2),
    z.literal(3), z.literal(4), z.literal(5),
  ]),
  responseTimeMs: z.number().int().nonnegative(),
  reviewType: z.enum(['meaning', 'reading', 'writing', 'compound']),
})

const submitReviewSchema = z.object({
  results: z.array(reviewResultSchema).min(1).max(200),
  studyTimeMs: z.number().int().nonnegative(),
})

export async function reviewRoutes(server: FastifyInstance) {
  const srs = new SrsService(server.db)
  const interventions = new InterventionService(server.db)
  const analytics = new AnalyticsService(server.db)

  // GET /v1/review/queue?limit=20
  server.get<{ Querystring: { limit?: string } }>(
    '/queue',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const limit = Math.min(Number(req.query.limit ?? 20), 50)
      const queue = await srs.getReviewQueue(req.userId!, limit)
      return reply.send({ ok: true, data: queue })
    }
  )

  // GET /v1/review/status
  server.get(
    '/status',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const counts = await srs.getStatusCounts(req.userId!)
      return reply.send({ ok: true, data: counts })
    }
  )

  // POST /v1/review/submit
  server.post(
    '/submit',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const body = submitReviewSchema.safeParse(req.body)
      if (!body.success) {
        return reply.code(400).send({
          ok: false,
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          details: body.error,
        })
      }

      const summary = await srs.submitReview(
        req.userId!,
        body.data.results,
        body.data.studyTimeMs
      )

      // Upsert daily stats + run intervention checks async (don't block response)
      const today = new Date().toISOString().slice(0, 10)
      void analytics.upsertDailyStats(req.userId!, today, {
        reviewed: summary.totalItems,
        correct: summary.correctItems,
        newLearned: summary.newLearned,
        burned: summary.burned,
        studyTimeMs: summary.studyTimeMs,
      })
      void interventions.resolveAbsenceOnActivity(req.userId!)
      void interventions.runChecks(req.userId!)

      return reply.code(201).send({ ok: true, data: summary })
    }
  )
}
