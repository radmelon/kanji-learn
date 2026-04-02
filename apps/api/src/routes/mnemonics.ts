import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { MnemonicService } from '../services/mnemonic.service.js'

const coordsSchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
})

const saveSchema = z.object({
  storyText: z.string().min(10).max(2000),
}).merge(coordsSchema)

const patchSchema = z.object({
  storyText: z.string().min(10).max(2000).optional(),
  imageUrl: z.string().max(2_000_000).nullable().optional(),
}).merge(coordsSchema)

const generateSchema = z.object({
  model: z.enum(['haiku', 'sonnet']).default('haiku'),
}).merge(coordsSchema)

export async function mnemonicRoutes(server: FastifyInstance) {
  const service = new MnemonicService(server.db)

  // GET /v1/mnemonics/:kanjiId — system + user mnemonics for a kanji
  server.get<{ Params: { kanjiId: string } }>(
    '/:kanjiId',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const kanjiId = Number(req.params.kanjiId)
      if (!Number.isInteger(kanjiId) || kanjiId < 1) {
        return reply.code(400).send({ ok: false, error: 'Invalid kanjiId', code: 'VALIDATION_ERROR' })
      }

      const data = await service.getForKanji(kanjiId, req.userId!)
      return reply.send({ ok: true, data })
    }
  )

  // POST /v1/mnemonics/:kanjiId/generate — AI generation (Haiku or Sonnet)
  server.post<{ Params: { kanjiId: string } }>(
    '/:kanjiId/generate',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const kanjiId = Number(req.params.kanjiId)
      const body = generateSchema.safeParse(req.body)
      if (!body.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
      }

      const coords = body.data.latitude !== undefined && body.data.longitude !== undefined
        ? { latitude: body.data.latitude, longitude: body.data.longitude }
        : undefined

      const mnemonic =
        body.data.model === 'sonnet'
          ? await service.generateSonnet(kanjiId, req.userId!, coords)
          : await service.generateHaiku(kanjiId, req.userId!, coords)

      return reply.code(201).send({ ok: true, data: mnemonic })
    }
  )

  // POST /v1/mnemonics/:kanjiId — save user-authored mnemonic
  server.post<{ Params: { kanjiId: string } }>(
    '/:kanjiId',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const kanjiId = Number(req.params.kanjiId)
      const body = saveSchema.safeParse(req.body)
      if (!body.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
      }

      const coords = body.data.latitude !== undefined && body.data.longitude !== undefined
        ? { latitude: body.data.latitude, longitude: body.data.longitude }
        : undefined
      const mnemonic = await service.saveUserMnemonic(kanjiId, req.userId!, body.data.storyText, coords)
      return reply.code(201).send({ ok: true, data: mnemonic })
    }
  )

  // PATCH /v1/mnemonics/:id — update user's mnemonic (storyText and/or imageUrl)
  server.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const body = patchSchema.safeParse(req.body)
      if (!body.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
      }

      const updated = await service.updateUserMnemonic(
        req.params.id,
        req.userId!,
        body.data.storyText,
        body.data.imageUrl,
        body.data.latitude,
        body.data.longitude,
      )
      if (!updated) {
        return reply.code(404).send({ ok: false, error: 'Mnemonic not found', code: 'NOT_FOUND' })
      }

      return reply.send({ ok: true, data: updated })
    }
  )

  // DELETE /v1/mnemonics/:id
  server.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const deleted = await service.deleteUserMnemonic(req.params.id, req.userId!)
      if (!deleted) {
        return reply.code(404).send({ ok: false, error: 'Mnemonic not found', code: 'NOT_FOUND' })
      }
      return reply.send({ ok: true })
    }
  )

  // GET /v1/mnemonics/refresh — mnemonics due for 30-day refresh prompt
  server.get(
    '/refresh',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const due = await service.getDueForRefresh(req.userId!)
      return reply.send({ ok: true, data: due })
    }
  )

  // POST /v1/mnemonics/:id/refresh/dismiss
  server.post<{ Params: { id: string } }>(
    '/:id/refresh/dismiss',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      await service.dismissRefresh(req.params.id, req.userId!)
      return reply.send({ ok: true })
    }
  )
}
