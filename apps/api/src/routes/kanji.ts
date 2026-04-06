import type { FastifyInstance } from 'fastify'
import { eq, and, ilike, sql, asc } from 'drizzle-orm'
import { kanji, userKanjiProgress } from '@kanji-learn/db'

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

  // GET /v1/kanji/browse?level=N5&status=learning&search=fire&offset=0&limit=50
  server.get<{
    Querystring: {
      level?: string
      status?: string
      search?: string
      offset?: string
      limit?: string
    }
  }>(
    '/browse',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const { level, status, search } = req.query
      const offset = Math.max(0, Number(req.query.offset ?? 0))
      const limit = Math.min(Number(req.query.limit ?? 50), 100)

      const validLevels = ['N5', 'N4', 'N3', 'N2', 'N1']
      const validStatuses = ['unseen', 'learning', 'reviewing', 'remembered', 'burned']

      const conditions: any[] = []

      if (level && validLevels.includes(level)) {
        conditions.push(eq(kanji.jlptLevel, level as any))
      }

      if (search?.trim()) {
        const term = `%${search.trim()}%`
        conditions.push(
          sql`(${kanji.character} = ${search.trim()} OR ${kanji.meanings}::text ILIKE ${term})`
        )
      }

      // For status filtering: 'unseen' means no progress row OR progress.status = 'unseen'
      // Other statuses: left join and filter on status
      if (status && validStatuses.includes(status)) {
        if (status === 'unseen') {
          conditions.push(
            sql`(${userKanjiProgress.status} IS NULL OR ${userKanjiProgress.status} = 'unseen')`
          )
        } else {
          conditions.push(eq(userKanjiProgress.status, status as any))
        }
      }

      const rows = await server.db
        .select({
          id: kanji.id,
          character: kanji.character,
          jlptLevel: kanji.jlptLevel,
          meanings: kanji.meanings,
          srsStatus: userKanjiProgress.status,
        })
        .from(kanji)
        .leftJoin(
          userKanjiProgress,
          and(
            eq(userKanjiProgress.kanjiId, kanji.id),
            eq(userKanjiProgress.userId, req.userId!)
          )
        )
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(asc(kanji.jlptLevel), asc(kanji.jlptOrder))
        .limit(limit)
        .offset(offset)

      const [countRow] = await server.db
        .select({ total: sql<number>`count(*)::int` })
        .from(kanji)
        .leftJoin(
          userKanjiProgress,
          and(
            eq(userKanjiProgress.kanjiId, kanji.id),
            eq(userKanjiProgress.userId, req.userId!)
          )
        )
        .where(conditions.length > 0 ? and(...conditions) : undefined)

      return reply.send({
        ok: true,
        data: {
          items: rows.map((r) => ({
            ...r,
            srsStatus: r.srsStatus ?? 'unseen',
            meanings: (r.meanings as string[]).slice(0, 3),
          })),
          total: Number(countRow?.total ?? 0),
          offset,
          limit,
        },
      })
    }
  )

  // GET /v1/kanji/:id  — full detail for one kanji + user SRS progress
  server.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const id = Number(req.params.id)
      if (!Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ ok: false, error: 'Invalid kanji ID', code: 'VALIDATION_ERROR' })
      }

      const [row] = await server.db
        .select({
          id: kanji.id,
          character: kanji.character,
          jlptLevel: kanji.jlptLevel,
          strokeCount: kanji.strokeCount,
          meanings: kanji.meanings,
          kunReadings: kanji.kunReadings,
          onReadings: kanji.onReadings,
          exampleVocab: kanji.exampleVocab,
          radicals: kanji.radicals,
          svgPath: kanji.svgPath,
          // Cross-reference codes
          jisCode: kanji.jisCode,
          nelsonClassic: kanji.nelsonClassic,
          nelsonNew: kanji.nelsonNew,
          morohashiIndex: kanji.morohashiIndex,
          morohashiVolume: kanji.morohashiVolume,
          morohashiPage: kanji.morohashiPage,
          // SRS progress
          srsStatus: userKanjiProgress.status,
          srsInterval: userKanjiProgress.interval,
          srsRepetitions: userKanjiProgress.repetitions,
          srsNextReviewAt: userKanjiProgress.nextReviewAt,
          srsLastReviewedAt: userKanjiProgress.lastReviewedAt,
          srsEaseFactor: userKanjiProgress.easeFactor,
          srsReadingStage: userKanjiProgress.readingStage,
        })
        .from(kanji)
        .leftJoin(
          userKanjiProgress,
          and(
            eq(userKanjiProgress.kanjiId, kanji.id),
            eq(userKanjiProgress.userId, req.userId!)
          )
        )
        .where(eq(kanji.id, id))

      if (!row) {
        return reply.code(404).send({ ok: false, error: 'Kanji not found', code: 'NOT_FOUND' })
      }

      return reply.send({
        ok: true,
        data: {
          ...row,
          srsStatus: row.srsStatus ?? 'unseen',
        },
      })
    }
  )
}
