import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { userProfiles } from '@kanji-learn/db'
import { z } from 'zod'

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  dailyGoal: z.number().int().min(5).max(200).optional(),
  notificationsEnabled: z.boolean().optional(),
  pushToken: z.string().max(200).nullable().optional(),
  timezone: z.string().optional(),
  reminderHour: z.number().int().min(0).max(23).optional(),
})

export async function userRoutes(server: FastifyInstance) {
  // GET /v1/user/profile — also syncs email from JWT into user_profiles
  server.get('/profile', { preHandler: [server.authenticate] }, async (req, reply) => {
    const profile = await server.db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, req.userId!),
    })

    if (!profile) {
      return reply.code(404).send({ ok: false, error: 'Profile not found', code: 'NOT_FOUND' })
    }

    // Keep email in sync with Supabase auth (used for friend search)
    if (req.userEmail && profile.email !== req.userEmail) {
      await server.db
        .update(userProfiles)
        .set({ email: req.userEmail, updatedAt: new Date() })
        .where(eq(userProfiles.id, req.userId!))
    }

    return reply.send({ ok: true, data: { ...profile, email: req.userEmail ?? profile.email } })
  })

  // PATCH /v1/user/profile
  server.patch('/profile', { preHandler: [server.authenticate] }, async (req, reply) => {
    const body = updateProfileSchema.safeParse(req.body)
    if (!body.success) {
      return reply
        .code(400)
        .send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR', details: body.error })
    }

    const [updated] = await server.db
      .update(userProfiles)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(userProfiles.id, req.userId!))
      .returning()

    return reply.send({ ok: true, data: updated })
  })
}
