import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { learnerProfiles } from '@kanji-learn/db'
import { z } from 'zod'

const patchLearnerProfileSchema = z.object({
  country: z.string().max(100).nullable().optional(),
  reasonsForLearning: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
})

export async function learnerProfileRoutes(server: FastifyInstance) {
  // GET /v1/user/learner-profile
  // Returns the current user's learner profile row.
  // If no row exists yet, returns null for all fields (not an error).
  server.get('/learner-profile', { preHandler: [server.authenticate] }, async (req, reply) => {
    const row = await server.db.query.learnerProfiles.findFirst({
      where: eq(learnerProfiles.userId, req.userId!),
    })

    return reply.send({
      ok: true,
      data: {
        country: row?.country ?? null,
        reasonsForLearning: row?.reasonsForLearning ?? [],
        interests: row?.interests ?? [],
      },
    })
  })

  // PATCH /v1/user/learner-profile
  // Upserts the row. Fields not included in the body are left unchanged.
  server.patch('/learner-profile', { preHandler: [server.authenticate] }, async (req, reply) => {
    const body = patchLearnerProfileSchema.safeParse(req.body)
    if (!body.success) {
      return reply
        .code(400)
        .send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR', details: body.error })
    }

    await server.db
      .insert(learnerProfiles)
      .values({
        userId: req.userId!,
        ...body.data,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: learnerProfiles.userId,
        set: {
          ...body.data,
          updatedAt: new Date(),
        },
      })

    return reply.send({ ok: true })
  })
}
