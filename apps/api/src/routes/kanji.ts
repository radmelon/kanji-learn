import type { FastifyInstance } from 'fastify'
import { eq, and, ilike, sql, asc } from 'drizzle-orm'
import { kanji, userKanjiProgress } from '@kanji-learn/db'

// Defensive array coercion. `?? []` only catches null/undefined, but a
// jsonb column can hold a scalar (e.g. a corrupted string that was once an
// array, see the 2026-04-18 radicals-string repair). If the mobile client
// then calls `.map()` or `.slice()` on a string, React Native's native
// bridge throws RCTFatal. Mirror the guard used in srs.service.ts so kanji
// routes are resilient to future seed-pipeline regressions.
const toArr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

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
            meanings: toArr<string>(r.meanings).slice(0, 3),
          })),
          total: Number(countRow?.total ?? 0),
          offset,
          limit,
        },
      })
    }
  )

  // GET /v1/kanji/:id/related  — kanji sharing at least one radical, ordered by jlptOrder (most commonly seen first)
  server.get<{ Params: { id: string } }>(
    '/:id/related',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const id = Number(req.params.id)
      if (!Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ ok: false, error: 'Invalid kanji ID', code: 'VALIDATION_ERROR' })
      }

      const target = await server.db.query.kanji.findFirst({
        where: eq(kanji.id, id),
        columns: { radicals: true },
      })

      if (!target) {
        return reply.code(404).send({ ok: false, error: 'Kanji not found', code: 'NOT_FOUND' })
      }

      const radicals = toArr<string>(target.radicals)
      if (radicals.length === 0) {
        return reply.send({ ok: true, data: [] })
      }

      const rows = await server.db
        .select({
          id: kanji.id,
          character: kanji.character,
          jlptLevel: kanji.jlptLevel,
          jlptOrder: kanji.jlptOrder,
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
        .where(
          and(
            sql`${kanji.id} != ${id}`,
            sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${kanji.radicals}) r WHERE r = ANY(ARRAY[${sql.join(radicals.map((r) => sql`${r}`), sql`, `)}]))`
          )
        )
        .orderBy(asc(kanji.jlptLevel), asc(kanji.jlptOrder))
        .limit(8)

      return reply.send({
        ok: true,
        data: rows.map((r) => ({
          id: r.id,
          character: r.character,
          jlptLevel: r.jlptLevel,
          meaning: toArr<string>(r.meanings)[0] ?? '',
          srsStatus: r.srsStatus ?? 'unseen',
        })),
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
          exampleSentences: kanji.exampleSentences,
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
          // Coerce every array-shaped jsonb column so a corrupted scalar
          // never reaches the mobile client and trips RCTFatal on .map().
          meanings: toArr<string>(row.meanings),
          kunReadings: toArr<string>(row.kunReadings),
          onReadings: toArr<string>(row.onReadings),
          radicals: toArr<string>(row.radicals),
          exampleVocab: toArr<{ word: string; reading: string; meaning: string }>(row.exampleVocab),
          exampleSentences: toArr<{ ja: string; en: string; vocab: string }>(row.exampleSentences),
          srsStatus: row.srsStatus ?? 'unseen',
        },
      })
    }
  )
}
