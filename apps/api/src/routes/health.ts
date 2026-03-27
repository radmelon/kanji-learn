import type { FastifyInstance } from 'fastify'

export async function healthRoutes(server: FastifyInstance) {
  server.get('/health', async (_req, reply) => {
    return reply.send({ ok: true, status: 'healthy', ts: new Date().toISOString() })
  })

  server.get('/health/db', { preHandler: [server.authenticate] }, async (_req, reply) => {
    try {
      await server.db.execute('SELECT 1')
      return reply.send({ ok: true, status: 'connected' })
    } catch {
      return reply.code(503).send({ ok: false, status: 'disconnected' })
    }
  })
}
