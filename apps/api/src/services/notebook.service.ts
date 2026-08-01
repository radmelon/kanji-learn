// apps/api/src/services/notebook.service.ts
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import {
  notebookEntries, buddyCommitments, userProfiles, tutorNotes, tutorShares,
} from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import { assembleNotebook, type NotebookView } from '@kanji-learn/shared'

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

    let replacementId: string | null = null
    if (replacementBody !== null) {
      const [row] = await this.db.insert(notebookEntries).values({
        userId, kind: existing.kind, body: replacementBody,
        author: 'learner', weekStart: existing.weekStart, source: existing.source,
      }).returning({ id: notebookEntries.id })
      replacementId = row.id
    }

    const updated = await this.db.update(notebookEntries)
      .set({ supersededAt: new Date(), supersededBy: replacementId })
      .where(and(eq(notebookEntries.id, id), isNull(notebookEntries.supersededAt)))
      .returning({ id: notebookEntries.id })

    if (updated.length === 0) {
      // Someone else superseded this entry between our check and our
      // update. Our replacement row (if any) has nothing pointing at it —
      // delete it rather than leave it orphaned.
      if (replacementId !== null) {
        await this.db.delete(notebookEntries).where(eq(notebookEntries.id, replacementId))
      }
      throw new Error('ALREADY_SUPERSEDED')
    }

    return { id: replacementId }
  }
}
