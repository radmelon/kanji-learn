// apps/api/src/routes/notebook.ts
//
// GET    /v1/buddy/notebook               — assembled notebook view
// POST   /v1/buddy/notebook/entries        — create an observation/decision entry
// PATCH  /v1/buddy/notebook/entries/:id    — supersede with a replacement body (edit)
// DELETE /v1/buddy/notebook/entries/:id    — supersede with no replacement (delete)

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { NotebookService } from '../services/notebook.service.js'

// Every field the client sends is listed. z.object() strips what is not here
// and still returns 200 — that is how four features shipped inert (docs/SOP.md).
const createSchema = z.object({
  kind: z.enum(['observation', 'decision']),
  body: z.string().min(1).max(2000),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  source: z.record(z.unknown()).nullable().optional(),
})

const patchSchema = z.object({ body: z.string().min(1).max(2000) })

// NotebookService.supersedeEntry throws NOT_FOUND for a missing/foreign entry
// and ALREADY_SUPERSEDED for one that's already been superseded. Collapsing
// both into 404 would make a real client bug (racing edits) indistinguishable
// from a bad id — ALREADY_SUPERSEDED is a conflict (409), not a missing
// resource (404).
function errorResponseFor(err: unknown): { status: number; code: string; error: string } {
  if (err instanceof Error && err.message === 'ALREADY_SUPERSEDED') {
    return { status: 409, code: 'ALREADY_SUPERSEDED', error: 'Entry already superseded' }
  }
  return { status: 404, code: 'NOT_FOUND', error: 'Not found' }
}

export async function notebookRoutes(server: FastifyInstance) {
  const service = new NotebookService(server.db)

  server.get('/', { preHandler: [server.authenticate] }, async (req, reply) => {
    await service.ensureFirstOpen(req.userId!)
    return reply.send({ ok: true, data: await service.getNotebook(req.userId!) })
  })

  server.post('/entries', { preHandler: [server.authenticate] }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
    }
    const created = await service.createEntry(req.userId!, {
      ...parsed.data, author: 'learner',
    })
    return reply.send({ ok: true, data: created })
  })

  server.patch<{ Params: { id: string } }>(
    '/entries/:id', { preHandler: [server.authenticate] },
    async (req, reply) => {
      const parsed = patchSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
      }
      try {
        const result = await service.supersedeEntry(req.userId!, req.params.id, parsed.data.body)
        return reply.send({ ok: true, data: result })
      } catch (err) {
        const { status, code, error } = errorResponseFor(err)
        return reply.code(status).send({ ok: false, error, code })
      }
    },
  )

  server.delete<{ Params: { id: string } }>(
    '/entries/:id', { preHandler: [server.authenticate] },
    async (req, reply) => {
      try {
        await service.supersedeEntry(req.userId!, req.params.id, null)
        return reply.send({ ok: true, data: { id: null } })
      } catch (err) {
        const { status, code, error } = errorResponseFor(err)
        return reply.code(status).send({ ok: false, error, code })
      }
    },
  )
}
