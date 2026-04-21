// apps/api/src/routes/push-tokens.ts
//
// Per-device Expo push token registration. A user can be signed in on
// multiple devices; each device POSTs its own token here. Stale tokens are
// pruned synchronously by NotificationService when Expo tickets return
// DeviceNotRegistered / InvalidCredentials / MessageTooBig.
//
// POST   /v1/push-tokens           — upsert (user_id, token); idempotent.
// DELETE /v1/push-tokens/:token    — remove by URL-encoded token; idempotent.

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { userPushTokens } from '@kanji-learn/db'

const EXPO_TOKEN_RE = /^ExponentPushToken\[.+\]$/
const PLATFORMS = ['ios', 'android'] as const

const RegisterBody = z.object({
  token: z.string().regex(EXPO_TOKEN_RE, 'invalid Expo push token format'),
  platform: z.enum(PLATFORMS),
})

export async function pushTokensRoute(server: FastifyInstance) {
  server.post(
    '/v1/push-tokens',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const parsed = RegisterBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({
          ok: false,
          error: 'Invalid body',
          code: 'VALIDATION_ERROR',
          details: parsed.error.issues,
        })
      }
      const { token, platform } = parsed.data
      const userId = req.userId!

      // Idempotent upsert keyed on (user_id, token). `onConflictDoNothing`
      // leaves the existing row untouched — return 200 to signal
      // "already registered"; 201 signals "newly created".
      const inserted = await server.db
        .insert(userPushTokens)
        .values({ userId, token, platform })
        .onConflictDoNothing({
          target: [userPushTokens.userId, userPushTokens.token],
        })
        .returning()

      if (inserted.length === 0) {
        return reply.code(200).send({ ok: true, data: { created: false } })
      }
      return reply.code(201).send({ ok: true, data: { created: true } })
    },
  )

  server.delete<{ Params: { token: string } }>(
    '/v1/push-tokens/:token',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const token = decodeURIComponent(req.params.token)
      const userId = req.userId!
      await server.db
        .delete(userPushTokens)
        .where(
          and(eq(userPushTokens.userId, userId), eq(userPushTokens.token, token)),
        )
      return reply.code(204).send()
    },
  )
}
