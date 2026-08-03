// apps/api/src/routes/buddy-session.ts
//
// GET  /v1/buddy/session             — assemble the weekly review session
// POST /v1/buddy/session/commitment  — record the commitment the learner agrees
//
// No LLM calls here — every string comes from the copy.ts catalogue. See
// docs/superpowers/specs/2026-07-30-weekly-buddy-review-design.md.

import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { userProfiles } from '@kanji-learn/db'
import {
  checkPromise,
  evaluateAppointment,
  openerCopy,
  reckonCopy,
  selectOpener,
  validateCommitment,
  type Commitment,
} from '@kanji-learn/shared'
import { z } from 'zod'
import { CommitmentService } from '../services/buddy/commitment.service.js'
import { NotebookService } from '../services/notebook.service.js'
import { CoachingService } from '../services/buddy/coaching.service.js'

const commitmentBodySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  daysCommitted: z.number().int(),
  minutesPerDay: z.number().int(),
  dayTargets: z.array(z.number().int().min(0).max(6)).nullable().optional(),
  focus: z.string().max(200).nullable().optional(),
})

/** The learner's local calendar date, from their stored timezone. */
function localDateFor(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/** A commitment shape to check activity against when there is no history at
 * all — the learner has never been through a session before. */
function defaultShape(weekStart: string): Commitment {
  return {
    weekStart, daysCommitted: 4, dayTargets: null,
    minutesPerDay: 15, focus: null, source: 'default',
  }
}

export async function buddySessionRoutes(server: FastifyInstance) {
  const service = new CommitmentService(server.db)
  const notebook = new NotebookService(server.db)

  server.get('/', { preHandler: [server.authenticate] }, async (req, reply) => {
    const profile = await server.db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, req.userId!),
    })
    if (!profile) {
      return reply.code(404).send({ ok: false, error: 'Profile not found', code: 'NOT_FOUND' })
    }

    // A learner still on the 'UTC' default has no reliable buddy_day — the
    // same guard runBuddyDayPass applies (notification.service.ts, spec
    // §8.5). Without it, this read path served a fabricated "due" session,
    // wrote rolled_forward rows, and accumulated miss counts the pass would
    // never see (its own query skips these users entirely), so the two
    // consumers disagreed about the same learner.
    if (profile.timezone === 'UTC') {
      return reply.send({ ok: true, data: { state: 'not_scheduled' } })
    }

    const now = new Date()
    const localDate = localDateFor(profile.timezone, now)

    const lastAgreed = await service.getMostRecentAgreed(req.userId!)

    const state = evaluateAppointment({
      buddyDay: profile.buddyDay ?? null,
      intervalWeeks: profile.buddyIntervalWeeks,
      localDate,
      lastSessionDate: lastAgreed?.weekStart ?? null,
    })

    if (state.kind === 'not_scheduled') {
      return reply.send({ ok: true, data: { state: 'not_scheduled' } })
    }
    if (state.kind === 'waiting') {
      return reply.send({ ok: true, data: { state: 'waiting', nextDue: state.nextDue } })
    }

    // Due. Look at what actually happened in the period that just ended.
    const previous = await service.getMostRecentBefore(req.userId!, state.weekStart)
    const isFirstSession = previous === null

    // The check must stay in scope: openerCopy('strong', …) reports
    // check.activeDays, so handing it a freshly-zeroed check would make Buddy
    // congratulate the learner on "0 days". Compute it once from the real
    // previous period's activity (or an empty period when there is no
    // previous commitment at all) and reuse it for both selectOpener and
    // openerCopy/reckonCopy below.
    const check = previous === null
      ? checkPromise(defaultShape(state.weekStart), [])
      : checkPromise(previous, await service.getActivity(req.userId!, previous.weekStart))

    const openerKind = selectOpener({ check, isFirstSession })
    const reckon = previous === null ? null : reckonCopy(check)

    const proposed = await service.ensureForWeek(req.userId!, state.weekStart)

    return reply.send({
      ok: true,
      data: {
        state: 'due',
        weekStart: state.weekStart,
        opener: { kind: openerKind, text: openerCopy(openerKind, check) },
        reckon,
        currentCommitment: previous,
        proposedCommitment: proposed,
      },
    })
  })

  server.post('/commitment', { preHandler: [server.authenticate] }, async (req, reply) => {
    const body = commitmentBodySchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({
        ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR', details: body.error,
      })
    }

    const check = validateCommitment({
      daysCommitted: body.data.daysCommitted,
      minutesPerDay: body.data.minutesPerDay,
      dayTargets: body.data.dayTargets ?? null,
    })
    if (!check.ok) {
      return reply.code(400).send({ ok: false, error: check.reason, code: 'VALIDATION_ERROR' })
    }

    const commitment: Commitment = {
      weekStart: body.data.weekStart,
      daysCommitted: body.data.daysCommitted,
      dayTargets: body.data.dayTargets ?? null,
      minutesPerDay: body.data.minutesPerDay,
      focus: body.data.focus ?? null,
      source: 'session',
    }

    await service.setForWeek(req.userId!, commitment)

    // Template copy only — Slice 1 has no LLM, and the notebook must still
    // render on the template tier every offline/rate-limited/outage path
    // falls back to (spec decision #11). The commitment above is the
    // session's one guaranteed outcome — it must never be lost — so the
    // notebook write is guarded: a failure here is logged, not surfaced,
    // and never turns an already-saved commitment into a 500.
    try {
      await notebook.writeCommitmentObservation(
        req.userId!,
        commitment.weekStart,
        `Agreed ${commitment.daysCommitted} days, ${commitment.minutesPerDay} minutes.`,
      )
    } catch (err) {
      req.log.error({ err, userId: req.userId }, '[BuddySession] notebook write failed after commitment saved')
    }

    try {
      await new CoachingService(server.db).refresh(req.userId!, { force: true })
    } catch (err) {
      req.log.error({ err, userId: req.userId }, '[BuddySession] coaching refresh failed')
    }

    return reply.send({ ok: true, data: commitment })
  })
}
