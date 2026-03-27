// Analytics routes — full implementation in commit 6
import type { FastifyInstance } from 'fastify'

export async function analyticsRoutes(server: FastifyInstance) {
  server.get('/summary', { preHandler: [server.authenticate] }, async (_req, reply) => {
    return reply.send({ ok: true, data: {} })
  })
}
