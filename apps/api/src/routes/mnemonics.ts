// Mnemonic routes — full implementation in commit 8
import type { FastifyInstance } from 'fastify'

export async function mnemonicRoutes(server: FastifyInstance) {
  server.get('/:kanjiId', { preHandler: [server.authenticate] }, async (_req, reply) => {
    return reply.send({ ok: true, data: [] })
  })
}
