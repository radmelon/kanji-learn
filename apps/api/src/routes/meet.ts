// apps/api/src/routes/meet.ts
//
// POST /v1/buddy/meet/complete — the single completion endpoint for all
// three meeting-Buddy outcomes (conversation, form, skipped).

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { MeetingService } from '../services/buddy/meeting.service.js'
import type { Message } from '@kanji-learn/shared'
import { BuddyLLMError } from '../services/llm/types.js'
import { buildMeetingPrompt } from '../services/buddy/meeting-prompt.js'
import { extractJsonObject, extractedPatchSchema } from '../services/buddy/meeting-extract.js'

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

const collectedSchema = z.object({
  reasons: z.array(z.string().max(80)).max(12),
  interests: z.array(z.string().max(80)).max(12),
  explicitRuler: z.enum(['jlpt', 'grade']).nullable(),
  dailyGoal: z.number().int().min(5).max(200).nullable(),
  buddyDay: z.number().int().min(0).max(6).nullable(),
  buddyIntervalWeeks: z.number().int().min(1).max(2).nullable(),
  // F10 (whole-branch review, LOW): timezone flowed unbounded into
  // buildMeetingPrompt's system prompt — a real IANA zone is short, but
  // nothing enforced that server-side. Generous enough for the longest real
  // IANA names ("America/Argentina/ComodRivadavia" is 33 chars).
  timezone: z.string().max(64).nullable(),
  hadPriorData: z.boolean(),
})

const turnSchema = z
  .object({
    beat: z.enum(['intro', 'orientation', 'why', 'frame_ask', 'meaning', 'meet', 'ask']),
    collected: collectedSchema,
    messages: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(1000) }))
      .min(1)
      .max(24),
  })
  .strict()

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

  server.post('/turn', { preHandler: [server.authenticate] }, async (req, reply) => {
    const body = turnSchema.safeParse(req.body)
    if (!body.success) {
      return reply
        .code(400)
        .send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR', details: body.error })
    }
    const { beat, collected, messages } = body.data
    const systemPrompt = buildMeetingPrompt(beat, collected)

    for (let attempt = 0; attempt < 2; attempt++) {
      let content: string
      try {
        const result = await server.buddyLLM.route({
          context: 'onboarding_conversation',
          userId: req.userId!,
          systemPrompt,
          messages: messages as Message[],
          maxTokens: 500,
          temperature: 0.7,
        })
        content = result.content ?? ''
      } catch (err) {
        if (err instanceof BuddyLLMError) {
          // Rate cap or full outage: the template tier IS the floor (spec §7).
          return reply.send({ ok: true, data: { fallback: true } })
        }
        throw err
      }

      const parsed = extractJsonObject(content)
      if (!parsed) continue
      const patch = extractedPatchSchema.safeParse(parsed.patch ?? {})
      if (typeof parsed.reply === 'string' && parsed.reply.length > 0 && patch.success) {
        return reply.send({ ok: true, data: { reply: parsed.reply, patch: patch.data } })
      }
    }
    return reply.send({ ok: true, data: { fallback: true } })
  })
}
