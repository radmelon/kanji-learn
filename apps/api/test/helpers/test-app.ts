// apps/api/test/helpers/test-app.ts
//
// Minimal Fastify bootstrap for route-level integration tests.
//
// Production's `buildServer` registers `authPlugin`, which fetches the
// Supabase JWKS over the network at startup — unworkable in CI. This helper
// stands up a bare Fastify instance with the two decorators routes actually
// use (`server.db` and `server.authenticate`), registers the supplied route
// plugin(s), and returns the ready app.
//
// The stub `authenticate` prehandler reads the `x-test-user-id` header and
// sets `req.userId` to that value, or replies 401 with the same envelope
// `errorHandler` + `authPlugin` produce in production.
//
// Usage — two supported forms:
//
//   // 1. Bare plugin — registered at the root.
//   import { buildTestApp } from '../helpers/test-app'
//   import { pushTokensRoute } from '../../src/routes/push-tokens'
//
//   const app = await buildTestApp(pushTokensRoute)
//   await app.inject({
//     method: 'POST',
//     url: '/v1/push-tokens',
//     headers: { 'x-test-user-id': USER_A },
//     payload: { token: EXPO_IOS, platform: 'ios' },
//   })
//
//   // 2. Plugin + register options — e.g. to mount under a prefix matching
//   // production (see apps/api/src/server.ts).
//   import { socialRoutes } from '../../src/routes/social'
//
//   const app = await buildTestApp({
//     plugin: socialRoutes,
//     opts: { prefix: '/v1/social' },
//   })
//
// Both forms can be mixed in a single call.

import Fastify, {
  type FastifyInstance,
  type FastifyPluginAsync,
  type FastifyRegisterOptions,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@kanji-learn/db'

const TEST_USER_HEADER = 'x-test-user-id'

// A route can be passed as either a bare plugin (registered at the root) or
// an object carrying explicit register options (e.g. `{ prefix: '/v1/social' }`).
type RouteSpec =
  | FastifyPluginAsync
  | {
      plugin: FastifyPluginAsync
      opts: FastifyRegisterOptions<Record<string, never>>
    }

export async function buildTestApp(
  ...routes: RouteSpec[]
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  const client = postgres(process.env.TEST_DATABASE_URL!)
  const db = drizzle(client, { schema })
  app.decorate('db', db)

  // Match production: `req.userId` / `req.userEmail` are decorated so TS and
  // Fastify know the shape before the prehandler runs.
  app.decorateRequest('userId', null)
  app.decorateRequest('userEmail', null)

  app.decorate(
    'authenticate',
    async function (request: FastifyRequest, reply: FastifyReply) {
      const raw = request.headers[TEST_USER_HEADER]
      const userId = Array.isArray(raw) ? raw[0] : raw
      if (!userId || typeof userId !== 'string') {
        return reply
          .code(401)
          .send({ ok: false, error: 'Unauthorized', code: 'UNAUTHORIZED' })
      }
      request.userId = userId
    },
  )

  // Close the postgres client when the app closes. Must be registered
  // before `app.ready()` — Fastify rejects addHook after the instance is
  // listening.
  app.addHook('onClose', async () => {
    await client.end()
  })

  for (const spec of routes) {
    if (typeof spec === 'function') {
      await app.register(spec)
    } else {
      await app.register(spec.plugin, spec.opts)
    }
  }
  await app.ready()

  return app
}
