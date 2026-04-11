import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { db } from '@kanji-learn/db'
import type { LLMProvider } from '@kanji-learn/shared'

import { authPlugin } from './plugins/auth.js'
import { errorHandler } from './plugins/error-handler.js'
import { env } from './lib/env.js'
import { healthRoutes } from './routes/health.js'
import { reviewRoutes } from './routes/review.js'
import { mnemonicRoutes } from './routes/mnemonics.js'
import { analyticsRoutes } from './routes/analytics.js'
import { userRoutes } from './routes/user.js'
import { interventionRoutes } from './routes/interventions.js'
import { kanjiRoutes } from './routes/kanji.js'
import { placementRoutes } from './routes/placement.js'
import { testRoutes } from './routes/test.js'
import { socialRoutes } from './routes/social.js'
import { internalRoutes } from './routes/internal.js'

// ── Buddy layer: LLM router + buddy services ────────────────────────────────
import { GroqProvider } from './services/llm/providers/groq.js'
import { GeminiProvider } from './services/llm/providers/gemini.js'
import { ClaudeProvider } from './services/llm/providers/claude.js'
import { AppleFoundationStubProvider } from './services/llm/providers/apple-foundation-stub.js'
import { BuddyLLMRouter } from './services/llm/router.js'
import { RateLimiter } from './services/llm/rate-limit.js'
import { createTelemetryWriter } from './services/llm/telemetry.js'
import { DualWriteService } from './services/buddy/dual-write.service.js'
import { LearnerStateService } from './services/buddy/learner-state.service.js'

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

  // ── Buddy layer composition ───────────────────────────────────────────────
  // Providers are lazy-initialised (they self-report unavailable when their
  // api key is missing), so building them unconditionally here is safe even
  // when only a subset of the tier 2/3 keys are configured.

  const onDevice = new AppleFoundationStubProvider()
  const groq = new GroqProvider({ apiKey: env.GROQ_API_KEY ?? '' })
  const gemini = new GeminiProvider({ apiKey: env.GEMINI_API_KEY ?? '' })
  const claude = new ClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY })

  const pickTier2Provider = (name: 'groq' | 'gemini'): LLMProvider =>
    name === 'groq' ? groq : gemini
  const tier2Primary = pickTier2Provider(env.LLM_PRIMARY_TIER2_PROVIDER)
  const tier2Secondary = pickTier2Provider(env.LLM_SECONDARY_TIER2_PROVIDER)

  const rateLimiter = new RateLimiter(db, {
    tier2DailyCap: env.BUDDY_TIER2_DAILY_CAP_PER_USER,
    tier3DailyCap: env.BUDDY_TIER3_DAILY_CAP_PER_USER,
  })

  const buddyLLM = new BuddyLLMRouter({
    onDevice,
    tier2Primary,
    tier2Secondary,
    tier3: claude,
    rateLimiter,
    emitTelemetry: createTelemetryWriter(db),
  })

  const dualWrite = new DualWriteService(db)
  const learnerState = new LearnerStateService(db)

  // ── Decorators ────────────────────────────────────────────────────────────

  server.decorate('db', db)
  server.decorate('buddyLLM', buddyLLM)
  server.decorate('dualWrite', dualWrite)
  server.decorate('learnerState', learnerState)

  // ── Routes ────────────────────────────────────────────────────────────────

  await server.register(healthRoutes)
  await server.register(userRoutes, { prefix: '/v1/user' })
  await server.register(reviewRoutes, { prefix: '/v1/review' })
  await server.register(mnemonicRoutes, { prefix: '/v1/mnemonics' })
  await server.register(analyticsRoutes, { prefix: '/v1/analytics' })
  await server.register(interventionRoutes, { prefix: '/v1' })
  await server.register(kanjiRoutes, { prefix: '/v1/kanji' })
  await server.register(placementRoutes, { prefix: '/v1/placement' })
  await server.register(testRoutes, { prefix: '/v1/tests' })
  await server.register(socialRoutes, { prefix: '/v1/social' })
  await server.register(internalRoutes, { prefix: '/internal' })

  return server
}
