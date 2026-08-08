// apps/api/src/routes/notebook.ts
//
// GET    /v1/buddy/notebook               — assembled notebook view
// POST   /v1/buddy/notebook/entries        — create an observation/decision entry
// PATCH  /v1/buddy/notebook/entries/:id    — supersede with a replacement body (edit)
// DELETE /v1/buddy/notebook/entries/:id    — supersede with no replacement (delete)

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { NotebookService } from '../services/notebook.service.js'
import { CoachingService } from '../services/buddy/coaching.service.js'

// Coaching entries are machine-composed from up to ten findings (the Journal
// is now the complete ledger, not the old top-3 cut), and each finding's copy
// can run long. 2000 was sized for the pre-ledger top-3 ceiling (~1,200 chars
// observed live); the sum of per-kind maxima for just 7 of the 10 kinds is
// already 1,945 chars, so a learner for whom 8+ kinds fire could exceed 2000
// and then be unable to PATCH (edit/supersede) their own entry -- the learner
// is `editableBy` every buddy-authored observation (assemble.ts). 8000 is
// ~4x the measured 7-kind maximum: headroom for all ten kinds plus future
// copy growth, while still bounding the field. Shared by both schemas so the
// create and edit paths can never disagree on the limit.
const MAX_ENTRY_BODY_CHARS = 8000

// Every field the client sends is listed. z.object() strips what is not here
// and still returns 200 — that is how four features shipped inert (docs/SOP.md).
const createSchema = z.object({
  kind: z.enum(['observation', 'decision']),
  body: z.string().min(1).max(MAX_ENTRY_BODY_CHARS),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  source: z.record(z.unknown()).nullable().optional(),
})

const patchSchema = z.object({ body: z.string().min(1).max(MAX_ENTRY_BODY_CHARS) })

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
  const coaching = new CoachingService(server.db)

  server.get('/', { preHandler: [server.authenticate] }, async (req, reply) => {
    await service.ensureFirstOpen(req.userId!)
    // Stale-gated: refresh() returns immediately unless the stored analysis is
    // older than ANALYSIS_STALE_HOURS, so assembling seven tables does not ride
    // on every notebook read. Guarded because a coaching failure must never
    // turn a notebook read into a 500 — the same reasoning as the commitment
    // write-back in buddy-session.ts.
    try {
      await coaching.refresh(req.userId!)
    } catch (err) {
      req.log.error({ err, userId: req.userId }, '[Notebook] coaching refresh failed')
    }
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
