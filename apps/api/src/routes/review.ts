import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { SrsService } from '../services/srs.service.js'
import { InterventionService } from '../services/intervention.service.js'
import { AnalyticsService } from '../services/analytics.service.js'
import { NotificationService } from '../services/notification.service.js'
import { evaluateReading } from '../services/reading-eval.service.js'
import { voiceAttempts, writingAttempts } from '@kanji-learn/db'

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
  // Reuse the DualWriteService instance composed in server.ts (Task 22) so
  // there's a single source of truth for the buddy layer. Previously this
  // route built its own copy — stateless and functionally equivalent, but
  // two instances at the composition root invite drift.
  const srs = new SrsService(server.db, server.dualWrite)
  const interventions = new InterventionService(server.db)
  const analytics = new AnalyticsService(server.db)
  const notifications = new NotificationService(server.db)

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
      analytics.upsertDailyStats(req.userId!, today, {
        reviewed: summary.totalItems,
        correct: summary.correctItems,
        newLearned: summary.newLearned,
        burned: summary.burned,
        studyTimeMs: summary.studyTimeMs,
      }).catch((err) => server.log.error({ err }, 'upsertDailyStats failed'))
      void interventions.resolveAbsenceOnActivity(req.userId!)
      void interventions.runChecks(req.userId!)
      // Notify friends that this user completed a session (fire-and-forget)
      void notifications.notifyStudyMates(req.userId!, summary.totalItems)

      return reply.code(201).send({ ok: true, data: summary })
    }
  )

  // GET /v1/review/weak-queue?limit=20&threshold=65
  server.get<{ Querystring: { limit?: string; threshold?: string } }>(
    '/weak-queue',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const limit = Math.min(Number(req.query.limit ?? 20), 50)
      const threshold = Math.min(Math.max(Number(req.query.threshold ?? 65), 10), 90)
      const items = await srs.getWeakKanjiQueue(req.userId!, limit, threshold)
      return reply.send({ ok: true, data: items })
    }
  )

  // GET /v1/review/writing-queue?limit=8
  server.get<{ Querystring: { limit?: string } }>(
    '/writing-queue',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const limit = Math.min(Number(req.query.limit ?? 8), 20)
      const items = await srs.getWritingQueue(req.userId!, limit)
      return reply.send({ ok: true, data: items })
    }
  )

  // GET /v1/review/reading-queue?limit=8
  server.get<{ Querystring: { limit?: string } }>(
    '/reading-queue',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const limit = Math.min(Number(req.query.limit ?? 8), 20)
      const items = await srs.getReadingQueue(req.userId!, limit)
      return reply.send({ ok: true, data: items })
    }
  )

  // POST /v1/review/voice — evaluate a spoken reading and log the attempt
  // The server runs wanakana normalisation + Levenshtein so the mobile
  // doesn't need to bundle the evaluation logic.
  const voiceSchema = z.object({
    kanjiId:        z.number().int().positive(),
    transcript:     z.string(),
    correctReadings: z.array(z.string()).min(1),
    strict:         z.boolean().optional().default(false),
  })

  server.post('/voice', { preHandler: [server.authenticate] }, async (req, reply) => {
    const body = voiceSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ ok: false, error: 'Validation error', code: 'VALIDATION_ERROR' })
    }

    const { kanjiId, transcript, correctReadings, strict } = body.data

    // Evaluate server-side (wanakana + Levenshtein)
    const result = evaluateReading(transcript, correctReadings, strict, server.kanjiReadingsIndex)

    // Compute integer Levenshtein distance for the log column
    const distance = Math.abs(
      result.normalizedSpoken.length - result.closestCorrect.length
    )

    // Log attempt
    await server.db.insert(voiceAttempts).values({
      userId:     req.userId!,
      kanjiId,
      transcript,
      expected:   result.closestCorrect,
      distance,
      passed:     result.correct,
    })

    return reply.code(201).send({ ok: true, data: result })
  })

  // POST /v1/review/writing — log a writing attempt
  const writingSchema = z.object({
    kanjiId: z.number().int().positive(),
    score: z.number().min(0).max(1),
    strokeCount: z.number().int().nonnegative(),
  })

  server.post('/writing', { preHandler: [server.authenticate] }, async (req, reply) => {
    const body = writingSchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ ok: false, error: 'Validation error', code: 'VALIDATION_ERROR' })
    }
    await server.db.insert(writingAttempts).values({ userId: req.userId!, ...body.data })
    return reply.code(201).send({ ok: true })
  })
}
