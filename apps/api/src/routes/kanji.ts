import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { kanji } from '@kanji-learn/db'

export async function kanjiRoutes(server: FastifyInstance) {
  // GET /v1/kanji/lookup?character=三  — resolve a kanji character to its DB row
  server.get<{ Querystring: { character?: string } }>(
    '/lookup',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const char = req.query.character?.trim()
      if (!char) {
        return reply.code(400).send({ ok: false, error: 'character query param required', code: 'VALIDATION_ERROR' })
      }

      const row = await server.db.query.kanji.findFirst({
        where: eq(kanji.character, char),
        columns: { id: true, character: true, meanings: true, jlptLevel: true },
      })

      if (!row) {
        return reply.code(404).send({ ok: false, error: 'Kanji not found', code: 'NOT_FOUND' })
      }

      return reply.send({ ok: true, data: row })
    }
  )
}
