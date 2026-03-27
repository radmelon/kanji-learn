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

  return server
}
