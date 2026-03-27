// Review routes — full implementation in commit 5 (SRS engine)
import type { FastifyInstance } from 'fastify'

export async function reviewRoutes(server: FastifyInstance) {
  server.get('/queue', { preHandler: [server.authenticate] }, async (_req, reply) => {
    return reply.send({ ok: true, data: [] })
  })
}
