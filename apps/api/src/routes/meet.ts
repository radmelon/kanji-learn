// apps/api/src/routes/meet.ts
//
// POST /v1/buddy/meet/complete — the single completion endpoint for all
// three meeting-Buddy outcomes (conversation, form, skipped).

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { MeetingService } from '../services/buddy/meeting.service.js'

const completeSchema = z
  .object({
    outcome: z.enum(['conversation', 'form', 'skipped']),
    reasons: z.array(z.string().min(1).max(80)).max(12).default([]),
    interests: z.array(z.string().min(1).max(80)).max(12).default([]),
    ruler: z.enum(['jlpt', 'grade']).nullable().default(null),
    dailyGoal: z.number().int().min(5).max(200).nullable().default(null),
    buddyDay: z.number().int().min(0).max(6).nullable().default(null),
    buddyIntervalWeeks: z.number().int().min(1).max(2).default(1),
    transcript: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) }))
      .max(60)
      .nullable()
      .default(null),
  })
  .strict() // reject unknown keys loudly — this schema is a write surface for page one

export async function meetRoutes(server: FastifyInstance) {
  server.post('/complete', { preHandler: [server.authenticate] }, async (req, reply) => {
    const body = completeSchema.safeParse(req.body)
    if (!body.success) {
      return reply
        .code(400)
        .send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR', details: body.error })
    }
    const service = new MeetingService(server.db)
    try {
      const data = await service.complete(req.userId!, body.data)
      return reply.send({ ok: true, data })
    } catch (err) {
      if (err instanceof Error && err.message === 'NOT_FOUND') {
        return reply.code(404).send({ ok: false, error: 'Profile not found', code: 'NOT_FOUND' })
      }
      throw err
    }
  })
}
