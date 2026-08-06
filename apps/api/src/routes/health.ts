import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'

/**
 * The commit this image was built from, baked in by `docker build --build-arg
 * GIT_SHA=…` (see `scripts/deploy-api.sh`). "unknown" locally and in tests.
 *
 * WHY THIS FIELD EXISTS: `docs/SOP.md` requires every deploy to be verified by
 * response CONTENT, because status codes lie here — parametric routes in
 * `mnemonics.ts` return 401 on any build, and a rollout was once reported
 * "verified" while App Runner served a 6-week-old image. Until this field, each
 * deploy needed its own bespoke canary; on 2026-08-06 that meant opening the
 * app to force a staleness-gated refresh and comparing row timestamps.
 *
 * A SHA cannot be faked by route shadowing and needs no auth, no learner and no
 * waiting. Compare it to `git rev-parse --short HEAD`.
 */
const GIT_SHA = process.env.GIT_SHA ?? 'unknown'

export async function healthRoutes(server: FastifyInstance) {
  server.get('/health', async (_req, reply) => {
    return reply.send({
      ok: true,
      status: 'healthy',
      ts: new Date().toISOString(),
      sha: GIT_SHA,
    })
  })

  server.get('/health/db', { preHandler: [server.authenticate] }, async (_req, reply) => {
    try {
      await server.db.execute(sql`SELECT 1`)
      return reply.send({ ok: true, status: 'connected' })
    } catch {
      return reply.code(503).send({ ok: false, status: 'disconnected' })
    }
  })
}
