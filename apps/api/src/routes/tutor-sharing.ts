import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { TutorSharingService } from '../services/tutor-sharing.service.js'

const inviteSchema = z.object({
  teacherEmail: z.string().email().max(320),
})

export async function tutorSharingRoutes(server: FastifyInstance) {
  const service = new TutorSharingService(server.db)

  // POST /v1/tutor-sharing/invite
  server.post(
    '/invite',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const body = inviteSchema.safeParse(req.body)
      if (!body.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
      }

      try {
        const data = await service.invite(req.userId!, body.data.teacherEmail)
        return reply.code(201).send({ ok: true, data })
      } catch (err: any) {
        if (err?.statusCode) {
          return reply.code(err.statusCode).send({ ok: false, error: err.code, code: err.code })
        }
        throw err
      }
    }
  )

  // GET /v1/tutor-sharing/status
  server.get(
    '/status',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const data = await service.getStatus(req.userId!)
      return reply.send({ ok: true, data })
    }
  )

  // DELETE /v1/tutor-sharing/:shareId
  server.delete<{ Params: { shareId: string } }>(
    '/:shareId',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      try {
        await service.revoke(req.userId!, req.params.shareId)
        return reply.send({ ok: true })
      } catch (err: any) {
        if (err?.statusCode) {
          return reply.code(err.statusCode).send({ ok: false, error: err.code, code: err.code })
        }
        throw err
      }
    }
  )

  // GET /v1/tutor-sharing/notes
  server.get(
    '/notes',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const data = await service.getNotes(req.userId!)
      return reply.send({ ok: true, data })
    }
  )
}
