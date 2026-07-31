import type { FastifyInstance } from 'fastify'
import { NotificationService } from '../services/notification.service.js'

/**
 * Internal routes — only reachable from trusted callers (EventBridge Lambda).
 * Protected by a shared secret header: X-Internal-Secret.
 *
 * Required env var:
 *   INTERNAL_SECRET — must match the value configured in the Lambda function
 */
export async function internalRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/daily-reminders', async (request, reply) => {
    const secret = process.env.INTERNAL_SECRET

    if (!secret) {
      fastify.log.error('[Internal] INTERNAL_SECRET env var not set')
      return reply.code(500).send({ error: 'Server misconfiguration' })
    }

    if (request.headers['x-internal-secret'] !== secret) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }

    fastify.log.info('[Internal] Daily reminder job triggered by EventBridge')
    const notifications = new NotificationService(fastify.db)

    try {
      await notifications.sendDailyReminders()
      fastify.log.info('[Internal] Daily reminders sent successfully')
    } catch (err) {
      fastify.log.error({ err }, '[Internal] Daily reminders failed')
      return reply.code(500).send({ error: 'Job failed' })
    }

    // Rest-day summaries ride the same hourly trigger. Independent try/catch so
    // a rest-day failure can't fail the daily-reminder job.
    try {
      await notifications.sendRestDaySummaries()
    } catch (err) {
      fastify.log.error({ err }, '[Internal] Rest-day summaries failed')
    }

    // The weekly Buddy appointment rides this same hourly invocation — see
    // cron.ts:8 for why this is not a node-cron schedule, and the plan for why
    // it is not a second EventBridge rule.
    try {
      await notifications.runBuddyDayPass()
    } catch (err) {
      fastify.log.error({ err }, '[Internal] Buddy-day pass failed')
    }

    return reply.send({ ok: true })
  })
}
