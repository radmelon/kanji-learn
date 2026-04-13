import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { Eta } from 'eta'
import { TutorSharingService } from '../services/tutor-sharing.service.js'
import { TutorReportService } from '../services/tutor-report.service.js'
import { TutorAnalysisService } from '../services/tutor-analysis.service.js'
import { userProfiles } from '@kanji-learn/db'
import { eq } from 'drizzle-orm'

// ── ETA setup ─────────────────────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const eta = new Eta({ views: join(__dirname, '..', 'templates') })

// ── In-memory rate limit tracker: token → timestamps of refresh calls ─────────
// Max 3 refreshes per hour per token
const refreshRateLimit = new Map<string, number[]>()
const REFRESH_MAX = 3
const REFRESH_WINDOW_MS = 60 * 60 * 1000 // 1 hour

function checkRefreshRateLimit(token: string): boolean {
  const now = Date.now()
  const windowStart = now - REFRESH_WINDOW_MS
  const timestamps = (refreshRateLimit.get(token) ?? []).filter(t => t > windowStart)
  if (timestamps.length >= REFRESH_MAX) return false
  timestamps.push(now)
  refreshRateLimit.set(token, timestamps)
  return true
}

// ── Route module ──────────────────────────────────────────────────────────────

export async function reportRoutes(server: FastifyInstance) {
  const sharingService = new TutorSharingService(server.db)
  const reportService = new TutorReportService(server.db)
  const analysisService = new TutorAnalysisService(server.db, server.buddyLLM)

  // ── GET /:token — Main entry point ────────────────────────────────────────

  server.get<{ Params: { token: string } }>(
    '/:token',
    async (req, reply) => {
      const { token } = req.params
      const share = await sharingService.findByToken(token)

      // Not found or expired
      if (!share || share.expiresAt < new Date()) {
        const html = await eta.renderAsync('expired', {})
        return reply.type('text/html').send(html)
      }

      switch (share.status) {
        case 'revoked': {
          const html = await eta.renderAsync('revoked', {})
          return reply.type('text/html').send(html)
        }

        case 'declined': {
          const html = await eta.renderAsync('declined', {})
          return reply.type('text/html').send(html)
        }

        case 'pending': {
          // Look up the student's display name
          const profile = await server.db.query.userProfiles.findFirst({
            where: eq(userProfiles.id, share.userId),
          })
          const html = await eta.renderAsync('terms', {
            studentName: profile?.displayName ?? 'A student',
            token,
          })
          return reply.type('text/html').send(html)
        }

        case 'accepted': {
          // Renew expiry on each visit
          await sharingService.renewExpiry(token)

          // Build report
          const data = await reportService.buildReport(share.userId, share.id)

          const html = await eta.renderAsync('report', { ...data, token })
          return reply.type('text/html').send(html)
        }

        default: {
          const html = await eta.renderAsync('expired', {})
          return reply.type('text/html').send(html)
        }
      }
    }
  )

  // ── POST /:token/accept ───────────────────────────────────────────────────

  server.post<{ Params: { token: string } }>(
    '/:token/accept',
    async (req, reply) => {
      const { token } = req.params
      const share = await sharingService.findByToken(token)

      if (!share || share.status !== 'pending') {
        return reply.redirect(`/report/${token}`)
      }

      await sharingService.acceptTerms(token)
      return reply.redirect(`/report/${token}`)
    }
  )

  // ── POST /:token/decline ──────────────────────────────────────────────────

  server.post<{ Params: { token: string } }>(
    '/:token/decline',
    async (req, reply) => {
      const { token } = req.params
      const share = await sharingService.findByToken(token)

      if (!share || share.status !== 'pending') {
        const html = await eta.renderAsync('declined', {})
        return reply.type('text/html').send(html)
      }

      await sharingService.declineTerms(token)

      const html = await eta.renderAsync('declined', {})
      return reply.type('text/html').send(html)
    }
  )

  // ── POST /:token/notes ────────────────────────────────────────────────────

  server.post<{ Params: { token: string }; Body: { noteText?: string } }>(
    '/:token/notes',
    async (req, reply) => {
      const { token } = req.params
      const share = await sharingService.findByToken(token)

      if (!share || share.status !== 'accepted' || share.expiresAt < new Date()) {
        return reply.redirect(`/report/${token}`)
      }

      // Handle both form-encoded and JSON body
      const noteText = (req.body as any)?.noteText ?? (req.body as any)?.note_text ?? ''

      if (!noteText || !noteText.trim()) {
        return reply.redirect(`/report/${token}#notes`)
      }

      await sharingService.addNote(share.id, noteText.trim())
      return reply.redirect(`/report/${token}#notes`)
    }
  )

  // ── POST /:token/refresh-analysis ─────────────────────────────────────────

  server.post<{ Params: { token: string } }>(
    '/:token/refresh-analysis',
    async (req, reply) => {
      const { token } = req.params
      const share = await sharingService.findByToken(token)

      if (!share || share.status !== 'accepted' || share.expiresAt < new Date()) {
        return reply.code(403).send({ ok: false, error: 'Access denied' })
      }

      if (!checkRefreshRateLimit(token)) {
        return reply.code(429).send({ ok: false, error: 'Rate limit exceeded. Maximum 3 refreshes per hour.' })
      }

      const data = await analysisService.computeForUser(share.userId)
      return reply.send({ ok: true, data })
    }
  )
}
