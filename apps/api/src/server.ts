import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { db } from '@kanji-learn/db'

import { authPlugin } from './plugins/auth.js'
import { errorHandler } from './plugins/error-handler.js'
import { healthRoutes } from './routes/health.js'
import { reviewRoutes } from './routes/review.js'
import { mnemonicRoutes } from './routes/mnemonics.js'
import { analyticsRoutes } from './routes/analytics.js'
import { userRoutes } from './routes/user.js'
import { interventionRoutes } from './routes/interventions.js'
import { kanjiRoutes } from './routes/kanji.js'
import { testRoutes } from './routes/test.js'
import { socialRoutes } from './routes/social.js'

export async function buildServer() {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport:
        process.env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  })

  // ── Plugins ──────────────────────────────────────────────────────────────────

  await server.register(cors, {
    origin: process.env.CORS_ORIGIN ?? '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })

  await server.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.headers['x-user-id'] as string ?? req.ip,
  })

  await server.register(authPlugin)

  // Allow DELETE/GET requests that arrive with Content-Type: application/json
  // but no body (React Native fetch sends the header unconditionally).
  server.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      if (!body || (body as string).length === 0) { done(null, {}); return }
      try { done(null, JSON.parse(body as string)) }
      catch (err) { done(err as Error, undefined) }
    }
  )

  // ── Error handler ─────────────────────────────────────────────────────────

  server.setErrorHandler(errorHandler)

  // ── Decorators ────────────────────────────────────────────────────────────

  server.decorate('db', db)

  // ── Routes ────────────────────────────────────────────────────────────────

  await server.register(healthRoutes)
  await server.register(userRoutes, { prefix: '/v1/user' })
  await server.register(reviewRoutes, { prefix: '/v1/review' })
  await server.register(mnemonicRoutes, { prefix: '/v1/mnemonics' })
  await server.register(analyticsRoutes, { prefix: '/v1/analytics' })
  await server.register(interventionRoutes, { prefix: '/v1' })
  await server.register(kanjiRoutes, { prefix: '/v1/kanji' })
  await server.register(testRoutes, { prefix: '/v1/tests' })
  await server.register(socialRoutes, { prefix: '/v1/social' })

  return server
}
