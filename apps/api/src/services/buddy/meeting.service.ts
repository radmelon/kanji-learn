// apps/api/src/services/buddy/meeting.service.ts
//
// Completion of the meeting-Buddy conversation (Phase 7 spec §6, §8).
// Order is load-bearing: ensureFirstOpen MUST precede the decision writes —
// its existence guard is "any live buddy-authored decision", so writing the
// appointment first would permanently suppress the introduction.

import { eq, sql } from 'drizzle-orm'
import { buddyConversations, userProfiles } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import { appointmentEntryBody, introEntryBody, reasonsEntryBody } from '@kanji-learn/shared'
import { NotebookService } from '../notebook.service.js'

const TRANSCRIPT_RETENTION_DAYS = 365

export interface MeetingCompleteInput {
  outcome: 'conversation' | 'form' | 'skipped'
  reasons: string[]
  interests: string[]
  ruler: 'jlpt' | 'grade' | null
  dailyGoal: number | null
  buddyDay: number | null
  buddyIntervalWeeks: number
  transcript: Array<{ role: 'user' | 'assistant'; content: string }> | null
}

export class MeetingService {
  private notebook: NotebookService
  constructor(private db: Db) {
    this.notebook = new NotebookService(db)
  }

  async complete(userId: string, input: MeetingCompleteInput): Promise<{ metBuddyAt: string }> {
    // First-wins: re-meeting Buddy must not move the date we met.
    //
    // F5 fix (whole-branch review, MED): onboardingCompletedAt used to be
    // left untouched by every path through this method — conversation, form
    // AND skipped — so a learner who completes via the conversation (rather
    // than the /onboarding-form escape, which presumably stamps it
    // elsewhere) or skips outright never gets it set. initialCollected's
    // hadPriorData discriminator reads onboardingCompletedAt !== null, so
    // that learner permanently re-answers every beat on a later re-entry.
    // Same COALESCE, same first-wins semantics, for the same reason.
    const [row] = await this.db
      .update(userProfiles)
      .set({
        metBuddyAt: sql`COALESCE(${userProfiles.metBuddyAt}, now())`,
        onboardingCompletedAt: sql`COALESCE(${userProfiles.onboardingCompletedAt}, now())`,
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.id, userId))
      .returning({ metBuddyAt: userProfiles.metBuddyAt })
    if (!row) throw new Error('NOT_FOUND')

    if (input.outcome === 'conversation') {
      await this.notebook.ensureFirstOpen(userId) // BEFORE any decision write — see header comment

      // F6 fix (whole-branch review, MED, spec §6): the intro bullet was
      // never written as its own entry — ensureFirstOpen's decision is about
      // the notebook itself, not Buddy introducing himself. Files under
      // "What Buddy notices" (kind 'observation') per assembleNotebook.
      await this.notebook.writeKeyedEntry(userId, {
        sourceKind: 'onboarding_intro',
        kind: 'observation',
        body: introEntryBody(),
      })

      if (input.buddyDay !== null) {
        await this.notebook.writeKeyedEntry(userId, {
          sourceKind: 'onboarding_appointment',
          kind: 'decision',
          body: appointmentEntryBody(input.buddyDay, input.buddyIntervalWeeks),
        })
      }
      if (input.reasons.length > 0 && input.ruler !== null) {
        await this.notebook.writeKeyedEntry(userId, {
          sourceKind: 'onboarding_reasons',
          kind: 'decision',
          body: reasonsEntryBody(input.reasons, input.ruler),
        })
      }
      if (input.transcript && input.transcript.length > 0) {
        await this.db.insert(buddyConversations).values({
          userId,
          context: 'onboarding_conversation',
          messages: input.transcript,
          turnCount: input.transcript.length,
          expiresAt: new Date(Date.now() + TRANSCRIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000),
        })
      }
    }

    return { metBuddyAt: row.metBuddyAt!.toISOString() }
  }
}
