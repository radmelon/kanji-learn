// apps/api/src/routes/buddy-nudges.ts
import { z } from 'zod'
import { and, eq, sql } from 'drizzle-orm'
import { buddyNudges } from '@kanji-learn/db'
import type { FastifyInstance } from 'fastify'

const SCREEN_ENUM = z.enum(['dashboard', 'study', 'progress'])
const ID_PARAM = z.object({ id: z.string().uuid() })

export async function buddyNudgesRoutes(server: FastifyInstance) {
  // GET /v1/buddy/nudges?screen=...
  server.get('/', { preHandler: server.authenticate }, async (request, reply) => {
    const parsed = z.object({ screen: SCREEN_ENUM }).safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid screen' })

    const userId = request.userId!
    const nudges = await server.nudgeService.evaluateNudgesForScreen(userId, parsed.data.screen)
    return reply.send({ data: nudges })
  })

  // POST /v1/buddy/nudges/:id/dismiss
  server.post('/:id/dismiss', { preHandler: server.authenticate }, async (request, reply) => {
    const parsed = ID_PARAM.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid id' })

    const userId = request.userId!

    // Idempotent: only update if not already dismissed; either way return 200
    // if the row belongs to the user. 404 if no such row for this user.
    const updated = await server.db
      .update(buddyNudges)
      .set({ dismissedAt: sql`COALESCE(${buddyNudges.dismissedAt}, NOW())` })
      .where(and(eq(buddyNudges.id, parsed.data.id), eq(buddyNudges.userId, userId)))
      .returning({ id: buddyNudges.id })

    if (updated.length === 0) return reply.code(404).send({ error: 'not found' })
    return reply.send({ ok: true })
  })
}
