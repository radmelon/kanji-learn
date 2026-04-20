import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { userProfiles } from '@kanji-learn/db'
import { supabaseAdmin } from '../lib/supabase-admin.js'
import { updateProfileSchema } from './user-profile.schema.js'

export async function userRoutes(server: FastifyInstance) {
  // GET /v1/user/profile — also syncs email from JWT into user_profiles
  server.get('/profile', { preHandler: [server.authenticate] }, async (req, reply) => {
    let profile = await server.db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, req.userId!),
    })

    // Self-heal: if the on_auth_user_created trigger didn't run for this user
    // (B8 in the bug tracker), create the row on demand with onboarding pending.
    if (!profile) {
      const [created] = await server.db
        .insert(userProfiles)
        .values({ id: req.userId!, email: req.userEmail ?? null })
        .onConflictDoNothing()
        .returning()
      profile = created ?? await server.db.query.userProfiles.findFirst({
        where: eq(userProfiles.id, req.userId!),
      })
      if (!profile) {
        return reply.code(500).send({ ok: false, error: 'Profile creation failed', code: 'INTERNAL' })
      }
    }

    // Keep email in sync with Supabase auth (used for friend search)
    if (req.userEmail && profile.email !== req.userEmail) {
      await server.db
        .update(userProfiles)
        .set({ email: req.userEmail, updatedAt: new Date() })
        .where(eq(userProfiles.id, req.userId!))
    }

    return reply.send({ ok: true, data: { ...profile, email: req.userEmail ?? profile.email } })
  })

  // PATCH /v1/user/profile
  server.patch('/profile', { preHandler: [server.authenticate] }, async (req, reply) => {
    const body = updateProfileSchema.safeParse(req.body)
    if (!body.success) {
      return reply
        .code(400)
        .send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR', details: body.error })
    }

    const [updated] = await server.db
      .update(userProfiles)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(userProfiles.id, req.userId!))
      .returning()

    return reply.send({ ok: true, data: updated })
  })

  // DELETE /v1/user/me — permanently delete account + all associated data.
  // Cascades from auth.users -> user_profiles -> every user-keyed table.
  server.delete('/me', { preHandler: [server.authenticate] }, async (req, reply) => {
    const userId = req.userId!
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (error) {
      server.log.error({ userId, err: error }, 'account_delete_failed')
      return reply.code(500).send({ ok: false, error: 'Deletion failed', code: 'DELETE_FAILED' })
    }
    server.log.info({ userId }, 'account_deleted')
    return reply.send({ ok: true })
  })
}
