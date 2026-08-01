// apps/api/src/services/notebook.service.ts
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  notebookEntries, buddyCommitments, userProfiles, tutorNotes, tutorShares,
} from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import { assembleNotebook, type NotebookView } from '@kanji-learn/shared'

export interface KeyedEntryInput {
  sourceKind: string
  kind: 'observation' | 'decision'
  body: string
  weekStart?: string | null
}

export class NotebookService {
  constructor(private db: Db) {}

  async getNotebook(userId: string): Promise<NotebookView> {
    const [profile, commitments, entries, shares] = await Promise.all([
      this.db.query.userProfiles.findFirst({ where: eq(userProfiles.id, userId) }),
      this.db.select().from(buddyCommitments)
        .where(eq(buddyCommitments.userId, userId))
        .orderBy(desc(buddyCommitments.weekStart)),
      this.db.select().from(notebookEntries)
        .where(eq(notebookEntries.userId, userId))
        .orderBy(desc(notebookEntries.createdAt)),
      this.db.select().from(tutorShares).where(eq(tutorShares.userId, userId)),
    ])

    const accepted = shares.filter((s) => s.status === 'accepted')
    const noteRows = accepted.length === 0
      ? []
      : await this.db.select().from(tutorNotes)
        .where(inArray(tutorNotes.shareId, accepted.map((s) => s.id)))
    const byShare = accepted.map((s) => ({
      shareId: s.id,
      tutorLabel: s.teacherEmail,
      notes: noteRows
        .filter((n) => n.shareId === s.id)
        .map((n) => ({
          id: n.id, body: n.noteText, language: n.language,
          translation: null, createdAt: n.createdAt.toISOString(),
        })),
    }))

    return assembleNotebook({
      cadence: {
        intervalWeeks: profile?.buddyIntervalWeeks ?? 1,
        buddyDay: profile?.buddyDay ?? null,
      },
      commitments: commitments.map((c) => ({
        weekStart: c.weekStart, daysCommitted: c.daysCommitted,
        minutesPerDay: c.minutesPerDay, focus: c.focus,
        source: c.source as 'session' | 'rolled_forward' | 'default',
        supersededAt: c.supersededAt?.toISOString() ?? null,
        experimentUntil: c.experimentUntil ?? null,
      })),
      entries: entries.map((e) => ({
        id: e.id, kind: e.kind as 'observation' | 'decision', body: e.body,
        author: e.author as 'buddy' | 'learner',
        createdAt: e.createdAt.toISOString(), editableBy: [],
        supersededAt: e.supersededAt?.toISOString() ?? null,
      })),
      tutorNotes: byShare,
    })
  }

  async createEntry(
    userId: string,
    input: {
      kind: 'observation' | 'decision'
      body: string
      author: 'buddy' | 'learner'
      weekStart?: string | null
      source?: unknown
    },
  ): Promise<{ id: string }> {
    const [row] = await this.db.insert(notebookEntries).values({
      userId, kind: input.kind, body: input.body, author: input.author,
      weekStart: input.weekStart ?? null, source: input.source ?? null,
    }).returning({ id: notebookEntries.id })
    return { id: row.id }
  }

  /**
   * Spec §8. Phase 7 writes page one during onboarding, but if Phase 6 ships
   * first — or for any learner who onboarded before it — the notebook would open
   * blank. Idempotent: keyed on the existence of any buddy-authored decision.
   *
   * The findFirst below is a fast path only — it avoids a pointless insert
   * attempt on every open — and does NOT by itself make this safe under
   * concurrency: it is check-then-act with no transaction or lock between
   * the read and the write. Two concurrent callers (two devices, or two
   * effect-driven calls on one) can both read "no introduction" and both
   * reach the insert. What actually enforces idempotence is the database:
   * the partial unique index notebook_entries_first_open_unique (migration
   * 0032) allows only one row per user with source->>'kind' = 'first_open',
   * so the losing insert hits that constraint. onConflictDoNothing() lets
   * it lose silently instead of throwing a 500 on a notebook read.
   */
  async ensureFirstOpen(userId: string): Promise<void> {
    const existing = await this.db.query.notebookEntries.findFirst({
      where: and(
        eq(notebookEntries.userId, userId),
        eq(notebookEntries.author, 'buddy'),
        eq(notebookEntries.kind, 'decision'),
      ),
    })
    if (existing) return

    await this.db.insert(notebookEntries).values({
      userId, kind: 'decision', author: 'buddy',
      body: "This is where we'll keep track of what we decide together — what you're working on, what we're trying, and what's actually helping.",
      source: { kind: 'first_open' },
    }).onConflictDoNothing()
  }

  /**
   * Idempotent buddy-authored write keyed on source->>'kind' (optionally +
   * weekStart): supersede any LIVE entry with the same key rather than
   * appending a second. The replacement stays buddy-authored — unlike
   * supersedeEntry, which is the learner-edit path.
   */
  async writeKeyedEntry(userId: string, input: KeyedEntryInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      const conditions = [
        eq(notebookEntries.userId, userId),
        eq(notebookEntries.kind, input.kind),
        isNull(notebookEntries.supersededAt),
        sql`${notebookEntries.source}->>'kind' = ${input.sourceKind}`,
      ]
      if (input.weekStart != null) conditions.push(eq(notebookEntries.weekStart, input.weekStart))

      const existing = await tx.query.notebookEntries.findFirst({ where: and(...conditions) })

      const [row] = await tx.insert(notebookEntries).values({
        userId, kind: input.kind, body: input.body, author: 'buddy',
        weekStart: input.weekStart ?? null, source: { kind: input.sourceKind },
      }).returning({ id: notebookEntries.id })

      if (existing) {
        await tx.update(notebookEntries)
          .set({ supersededAt: new Date(), supersededBy: row.id })
          .where(and(eq(notebookEntries.id, existing.id), isNull(notebookEntries.supersededAt)))
      }
    })
  }

  /**
   * Write-back for a just-agreed weekly commitment (buddy-session.ts).
   * CommitmentService.setForWeek is an idempotent upsert keyed on
   * (user_id, week_start) — saving a commitment twice in one session
   * updates the same row. This write-back needs the same idempotence: a
   * bare createEntry insert here left two live observations ("Agreed 4
   * days, 15 minutes." and "Agreed 5 days, 20 minutes.") both rendered,
   * the stale one never superseded. Delegates to writeKeyedEntry, which
   * does the superseding.
   */
  async writeCommitmentObservation(userId: string, weekStart: string, body: string): Promise<void> {
    await this.writeKeyedEntry(userId, { sourceKind: 'commitment', kind: 'observation', body, weekStart })
  }

  /** Editing IS superseding. `replacementBody: null` is a delete. */
  async supersedeEntry(
    userId: string,
    id: string,
    replacementBody: string | null,
  ): Promise<{ id: string | null }> {
    const existing = await this.db.query.notebookEntries.findFirst({
      where: and(eq(notebookEntries.id, id), eq(notebookEntries.userId, userId)),
    })
    if (!existing) throw new Error('NOT_FOUND')
    if (existing.supersededAt !== null) throw new Error('ALREADY_SUPERSEDED')

    const replacementId = await this.db.transaction(async (tx) => {
      // Supersede the old row FIRST, before inserting its replacement. The
      // replacement copies `existing.source` (so editing the seeded
      // first-open intro still reads as a first-open row downstream) —
      // notebook_entries_first_open_unique (migration 0032) only allows one
      // LIVE row per user per source kind, so if the insert ran first, the
      // old row (still live) and the new row would both be live and both
      // match the index predicate at the same instant, and Postgres would
      // reject the insert with 23505 regardless of statement order within
      // the transaction. Marking the old row superseded first means it no
      // longer matches "live" by the time the replacement is inserted.
      const updated = await tx.update(notebookEntries)
        .set({ supersededAt: new Date() })
        .where(and(eq(notebookEntries.id, id), isNull(notebookEntries.supersededAt)))
        .returning({ id: notebookEntries.id })

      if (updated.length === 0) {
        // Someone else superseded this entry between our check and our
        // update. Throwing here rolls back the whole transaction.
        throw new Error('ALREADY_SUPERSEDED')
      }

      let replacementId: string | null = null
      if (replacementBody !== null) {
        const [row] = await tx.insert(notebookEntries).values({
          userId, kind: existing.kind, body: replacementBody,
          author: 'learner', weekStart: existing.weekStart, source: existing.source,
        }).returning({ id: notebookEntries.id })
        replacementId = row.id

        await tx.update(notebookEntries)
          .set({ supersededBy: replacementId })
          .where(eq(notebookEntries.id, id))
      }

      return replacementId
    })

    return { id: replacementId }
  }
}
