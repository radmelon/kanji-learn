import type { FastifyInstance } from 'fastify'
import { InterventionService } from '../services/intervention.service.js'

export async function interventionRoutes(server: FastifyInstance) {
  const engine = new InterventionService(server.db)

  // GET /v1/interventions — active unresolved interventions
  server.get('/interventions', { preHandler: [server.authenticate] }, async (req, reply) => {
    const active = await engine.getActive(req.userId!)
    const messages = active.map((i) => ({ ...i, message: engine.buildMessage(i) }))
    return reply.send({ ok: true, data: messages })
  })

  // POST /v1/interventions/:id/resolve
  server.post<{ Params: { id: string } }>(
    '/interventions/:id/resolve',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      await engine.resolve(req.userId!, req.params.id)
      return reply.send({ ok: true })
    }
  )

  // POST /v1/interventions/check — manually trigger check (also called post-session)
  server.post(
    '/interventions/check',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const triggered = await engine.runChecks(req.userId!)
      return reply.send({ ok: true, data: triggered })
    }
  )
}
