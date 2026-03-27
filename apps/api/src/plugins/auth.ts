import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import jwt from '@fastify/jwt'

// ─── Supabase JWT auth plugin ─────────────────────────────────────────────────
// Validates the Bearer token issued by Supabase Auth.
// The Supabase JWT secret is the `JWT_SECRET` env var from your Supabase project.

export const authPlugin = fp(async (server: FastifyInstance) => {
  const jwtSecret = process.env.SUPABASE_JWT_SECRET
  if (!jwtSecret) {
    throw new Error('SUPABASE_JWT_SECRET environment variable is required')
  }

  await server.register(jwt, {
    secret: jwtSecret,
    decode: { complete: true },
    verify: {
      algorithms: ['HS256'],
    },
  })

  // Decorate request with user after verification
  server.decorateRequest('userId', null)
  server.decorateRequest('userEmail', null)

  // Prehandler hook — attach to authenticated routes via { preHandler: [server.authenticate] }
  server.decorate(
    'authenticate',
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        const decoded = await request.jwtVerify<{
          sub: string
          email: string
          role: string
        }>()

        request.userId = decoded.sub
        request.userEmail = decoded.email
      } catch (err) {
        reply.code(401).send({ ok: false, error: 'Unauthorized', code: 'UNAUTHORIZED' })
      }
    }
  )
})

// ─── Type augmentation ────────────────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    userId: string | null
    userEmail: string | null
  }
}
