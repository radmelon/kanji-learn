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

const assembleSchema = z.object({
  kanji: z.string().min(1),
  kanjiMeaning: z.string().min(1),
  reading: z.string().min(1),
  components: z
    .array(z.object({ char: z.string(), name: z.string(), meaning: z.string(), imageKeyword: z.string() }))
    .default([]),
  locationName: z.string().min(1),
  anchor: z.string().min(1),
  personalDetail: z.string().optional(),
  readingPlay: z.string().optional(),
})

const layerSchema = z.object({
  questions: z.array(z.string()),
  answers: z.array(z.string()),
  anchor: z.string().optional(),
  source: z.enum(['environment', 'known_knowledge']),
})
const contextSchema = z.object({
  layers: z.array(layerSchema),
  layerCount: z.number().int().nonnegative(),
  locationName: z.string().optional(),
  components: z.array(z.object({ char: z.string(), meaning: z.string() })),
  generatedBy: z.enum(['template', 'on_device', 'cloud']),
  mnemonicQuizDueAt: z.string().datetime().optional(),
  timeOfDay: z.string().optional(),
})
const cocreatedSchema = z.object({
  storyText: z.string().min(1).max(2000),
  context: contextSchema,
}).merge(coordsSchema)

const outcomeSchema = z.object({ outcome: z.union([z.literal(0), z.literal(1)]) })
const deepenSchema = z.object({
  storyText: z.string().min(1).max(2000),
  context: contextSchema,
})

const buddyContextSchema = z.object({ kanjiIds: z.array(z.number().int().positive()).max(100) })

export async function mnemonicRoutes(
  server: FastifyInstance,
  opts?: { service?: MnemonicService },
) {
  const service = opts?.service ?? new MnemonicService(server.db)

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

  // POST /v1/mnemonics/assemble — cloud-tier story assembly (no DB write)
  server.post(
    '/assemble',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const body = assembleSchema.safeParse(req.body)
      if (!body.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
      }
      try {
        const storyText = await service.assembleFromSlots(body.data)
        return reply.send({ ok: true, data: { storyText, generatedBy: 'cloud' } })
      } catch {
        // Signal the client to fall to the next cascade tier (on-device / template).
        return reply.code(502).send({ ok: false, error: 'Assembly failed', code: 'ASSEMBLY_FAILED' })
      }
    }
  )

  // POST /v1/mnemonics/:kanjiId/cocreated — persist a finished co-created hook
  server.post<{ Params: { kanjiId: string } }>(
    '/:kanjiId/cocreated',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const kanjiId = Number(req.params.kanjiId)
      if (!Number.isInteger(kanjiId) || kanjiId < 1) {
        return reply.code(400).send({ ok: false, error: 'Invalid kanjiId', code: 'VALIDATION_ERROR' })
      }
      const body = cocreatedSchema.safeParse(req.body)
      if (!body.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
      }
      const coords =
        body.data.latitude !== undefined && body.data.longitude !== undefined
          ? { latitude: body.data.latitude, longitude: body.data.longitude }
          : undefined
      const saved = await service.saveCoCreatedMnemonic(
        kanjiId, req.userId!, body.data.storyText, body.data.context, coords,
      )
      return reply.code(201).send({ ok: true, data: saved })
    }
  )

  // POST /v1/mnemonics/:id/outcome — record a reinforcement/quiz outcome
  server.post<{ Params: { id: string } }>(
    '/:id/outcome',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const body = outcomeSchema.safeParse(req.body)
      if (!body.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
      }
      const updated = await service.recordOutcome(req.params.id, req.userId!, body.data.outcome)
      if (!updated) return reply.code(404).send({ ok: false, error: 'Mnemonic not found', code: 'NOT_FOUND' })
      return reply.send({ ok: true, data: updated })
    }
  )

  // POST /v1/mnemonics/:id/deepen — append a layer (additive; never discard)
  server.post<{ Params: { id: string } }>(
    '/:id/deepen',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const body = deepenSchema.safeParse(req.body)
      if (!body.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
      }
      const updated = await service.applyDeepen(req.params.id, req.userId!, body.data.storyText, body.data.context)
      if (!updated) return reply.code(404).send({ ok: false, error: 'Mnemonic not found', code: 'NOT_FOUND' })
      return reply.send({ ok: true, data: updated })
    }
  )

  // POST /v1/mnemonics/buddy-moment-context — lapses + hasHook for graded kanji
  server.post(
    '/buddy-moment-context',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const body = buddyContextSchema.safeParse(req.body)
      if (!body.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
      }
      const data = await service.getBuddyMomentContext(req.userId!, body.data.kanjiIds)
      return reply.send({ ok: true, data })
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

}
