import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import jwt from '@fastify/jwt'
import { createPublicKey } from 'node:crypto'

// ─── Supabase JWT auth plugin ─────────────────────────────────────────────────
// Supabase newer projects sign JWTs with ES256 (ECDSA P-256).
// We fetch the public key from Supabase's JWKS endpoint on startup and use it
// to verify tokens — no need to trust the JWT secret for verification.

export const authPlugin = fp(async (server: FastifyInstance) => {
  const supabaseUrl = process.env.SUPABASE_URL
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL environment variable is required')
  }

  // Fetch public keys from Supabase JWKS endpoint
  const jwksUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`
  const resp = await fetch(jwksUrl)
  if (!resp.ok) throw new Error(`Failed to fetch JWKS from ${jwksUrl}: ${resp.status}`)

  const { keys } = (await resp.json()) as { keys: import('node:crypto').JsonWebKey[] }
  if (!keys?.length) throw new Error('No keys in Supabase JWKS response')

  // Convert the first JWK to PEM so @fastify/jwt can use it
  const cryptoKey = createPublicKey({ key: keys[0], format: 'jwk' })
  const publicKeyPem = cryptoKey.export({ type: 'spki', format: 'pem' }) as string

  server.log.info({ kid: keys[0].kid, alg: keys[0].alg }, 'Loaded Supabase public key')

  await server.register(jwt, {
    secret: {
      private: '',       // not needed — we only verify, never sign
      public: publicKeyPem,
    },
    decode: { complete: true },
    verify: {
      algorithms: ['ES256'],
      allowedAud: 'authenticated',
    },
  })

  // Decorate request with user after verification
  server.decorateRequest('userId', null)
  server.decorateRequest('userEmail', null)

  // Prehandler — attach to routes via { preHandler: [server.authenticate] }
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
        server.log.warn({ err }, 'JWT verification failed')
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
