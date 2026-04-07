import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { SocialService } from '../services/social.service.js'

const requestSchema = z.object({ addresseeId: z.string().uuid() })
const respondSchema = z.object({ action: z.enum(['accept', 'decline']) })

export async function socialRoutes(server: FastifyInstance) {
  const service = new SocialService(server.db)

  // GET /v1/social/search?email=...
  server.get<{ Querystring: { email?: string } }>(
    '/search',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const email = (req.query.email ?? '').trim()
      if (!email) return reply.code(400).send({ ok: false, error: 'email required', code: 'VALIDATION_ERROR' })
      const result = await service.searchByEmail(email, req.userId!)
      return reply.send({ ok: true, data: result })
    }
  )

  // POST /v1/social/request
  server.post(
    '/request',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const body = requestSchema.safeParse(req.body)
      if (!body.success) return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
      const request = await service.sendRequest(req.userId!, body.data.addresseeId)
      return reply.code(201).send({ ok: true, data: request })
    }
  )

  // GET /v1/social/requests — pending requests received
  server.get(
    '/requests',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const data = await service.getPendingRequests(req.userId!)
      return reply.send({ ok: true, data })
    }
  )

  // PATCH /v1/social/request/:id — accept or decline
  server.patch<{ Params: { id: string } }>(
    '/request/:id',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const body = respondSchema.safeParse(req.body)
      if (!body.success) return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
      await service.respondToRequest(req.params.id, req.userId!, body.data.action)
      return reply.send({ ok: true })
    }
  )

  // GET /v1/social/friends
  server.get(
    '/friends',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const data = await service.getFriends(req.userId!)
      return reply.send({ ok: true, data })
    }
  )

  // DELETE /v1/social/friends/:friendId
  server.delete<{ Params: { friendId: string } }>(
    '/friends/:friendId',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      await service.removeFriend(req.userId!, req.params.friendId)
      return reply.send({ ok: true })
    }
  )

  // GET /v1/social/leaderboard
  server.get(
    '/leaderboard',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const data = await service.getLeaderboard(req.userId!)
      return reply.send({ ok: true, data })
    }
  )

  // GET /v1/social/friends/activity
  // Lightweight endpoint for Watch delay picker: returns today's review count
  // for each friend so the Watch can show competitive encouragement context.
  server.get(
    '/friends/activity',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const data = await service.getFriendsActivity(req.userId!)
      return reply.send({ ok: true, data })
    }
  )
}
