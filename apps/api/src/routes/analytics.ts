import type { FastifyInstance } from 'fastify'
import { AnalyticsService } from '../services/analytics.service.js'

export async function analyticsRoutes(server: FastifyInstance) {
  const analytics = new AnalyticsService(server.db)

  // GET /v1/analytics/summary
  server.get('/summary', { preHandler: [server.authenticate] }, async (req, reply) => {
    const summary = await analytics.getSummary(req.userId!)
    return reply.send({ ok: true, data: summary })
  })

  // GET /v1/analytics/daily?days=30
  server.get<{ Querystring: { days?: string } }>(
    '/daily',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const days = Math.min(Number(req.query.days ?? 30), 365)
      const stats = await analytics.getDailyStats(req.userId!, days)
      return reply.send({ ok: true, data: stats })
    }
  )

  // GET /v1/analytics/velocity
  server.get('/velocity', { preHandler: [server.authenticate] }, async (req, reply) => {
    const velocity = await analytics.getVelocityMetrics(req.userId!)
    return reply.send({ ok: true, data: velocity })
  })

  // GET /v1/analytics/streak
  server.get('/streak', { preHandler: [server.authenticate] }, async (req, reply) => {
    const streakDays = await analytics.getStreakDays(req.userId!)
    return reply.send({ ok: true, data: { streakDays } })
  })

  // GET /v1/analytics/weekly-summary — used by Watch rest-day message and WeeklySummaryView
  server.get('/weekly-summary', { preHandler: [server.authenticate] }, async (req, reply) => {
    const summary = await analytics.getWeeklySummary(req.userId!)
    return reply.send({ ok: true, data: summary })
  })

  // GET /v1/analytics/sessions?limit=20&offset=0
  server.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/sessions',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const limit = Math.min(Number(req.query.limit ?? 20), 50)
      const offset = Math.max(Number(req.query.offset ?? 0), 0)
      const sessions = await analytics.getSessionHistory(req.userId!, limit, offset)
      return reply.send({ ok: true, data: sessions })
    }
  )
}
