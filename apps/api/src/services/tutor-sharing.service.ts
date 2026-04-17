import crypto from 'node:crypto'
import { and, eq, desc, count } from 'drizzle-orm'
import { tutorShares, tutorNotes, userProfiles } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import { EmailService } from './email.service.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShareStatus {
  id: string
  teacherEmail: string
  status: string
  createdAt: Date
  expiresAt: Date
  termsAcceptedAt: Date | null
  noteCount?: number
}

export interface TutorNote {
  id: string
  shareId: string
  noteText: string
  createdAt: Date
}

// ─── Tutor Sharing Service ────────────────────────────────────────────────────

export class TutorSharingService {
  constructor(private db: Db) {}

  // ── Invite a teacher by email ──────────────────────────────────────────────

  async invite(userId: string, teacherEmail: string): Promise<ShareStatus> {
    const normalised = teacherEmail.trim().toLowerCase()

    // Prevent self-invite
    const userProfile = await this.db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, userId),
    })
    if (userProfile?.email?.toLowerCase() === normalised) {
      throw { statusCode: 400, code: 'SELF_INVITE_NOT_ALLOWED' }
    }

    // Check for existing active share (pending or accepted)
    const existing = await this.db.query.tutorShares.findFirst({
      where: and(
        eq(tutorShares.userId, userId),
        eq(tutorShares.teacherEmail, normalised)
      ),
      orderBy: [desc(tutorShares.createdAt)],
    })
    if (existing && (existing.status === 'pending' || existing.status === 'accepted')) {
      throw { statusCode: 409, code: 'SHARE_ALREADY_EXISTS' }
    }

    // Generate a 64-char crypto-random token
    const token = crypto.randomBytes(32).toString('hex')

    // 90-day expiry
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 90)

    const [row] = await this.db
      .insert(tutorShares)
      .values({
        userId,
        teacherEmail: normalised,
        token,
        status: 'pending',
        expiresAt,
      })
      .returning()

    // Fire-and-forget email
    const emailService = new EmailService()
    emailService
      .sendTutorInvite(normalised, userProfile?.displayName ?? 'A student', token)
      .catch(() => { /* intentionally swallowed */ })

    return {
      id: row.id,
      teacherEmail: row.teacherEmail,
      status: row.status,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      termsAcceptedAt: row.termsAcceptedAt ?? null,
    }
  }

  // ── Get current share status ───────────────────────────────────────────────

  async getStatus(userId: string): Promise<ShareStatus | null> {
    const share = await this.db.query.tutorShares.findFirst({
      where: eq(tutorShares.userId, userId),
      orderBy: [desc(tutorShares.createdAt)],
    })

    if (!share) return null

    let noteCount: number | undefined
    if (share.status === 'accepted') {
      const [result] = await this.db
        .select({ count: count() })
        .from(tutorNotes)
        .where(eq(tutorNotes.shareId, share.id))
      noteCount = result?.count ?? 0
    }

    return {
      id: share.id,
      teacherEmail: share.teacherEmail,
      status: share.status,
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
      termsAcceptedAt: share.termsAcceptedAt ?? null,
      noteCount,
    }
  }

  // ── Revoke a share ─────────────────────────────────────────────────────────

  async revoke(userId: string, shareId: string): Promise<void> {
    const share = await this.db.query.tutorShares.findFirst({
      where: and(eq(tutorShares.id, shareId), eq(tutorShares.userId, userId)),
    })

    if (!share) throw { statusCode: 404, code: 'SHARE_NOT_FOUND' }

    await this.db
      .update(tutorShares)
      .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(tutorShares.id, shareId))
  }

  // ── Get notes for the current user ────────────────────────────────────────

  async getNotes(userId: string): Promise<TutorNote[]> {
    const share = await this.db.query.tutorShares.findFirst({
      where: and(eq(tutorShares.userId, userId), eq(tutorShares.status, 'accepted')),
      orderBy: [desc(tutorShares.createdAt)],
    })

    if (!share) return []

    return this.getNotesForShare(share.id)
  }

  // ── Look up a share by token ───────────────────────────────────────────────

  async findByToken(token: string) {
    return this.db.query.tutorShares.findFirst({
      where: eq(tutorShares.token, token),
    })
  }

  // ── Accept terms ──────────────────────────────────────────────────────────

  async acceptTerms(token: string): Promise<void> {
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 90)

    await this.db
      .update(tutorShares)
      .set({ status: 'accepted', termsAcceptedAt: new Date(), expiresAt, updatedAt: new Date() })
      .where(eq(tutorShares.token, token))
  }

  // ── Decline terms ─────────────────────────────────────────────────────────

  async declineTerms(token: string): Promise<void> {
    await this.db
      .update(tutorShares)
      .set({ status: 'declined', declinedAt: new Date(), updatedAt: new Date() })
      .where(eq(tutorShares.token, token))
  }

  // ── Renew expiry ──────────────────────────────────────────────────────────

  async renewExpiry(token: string): Promise<void> {
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 90)

    await this.db
      .update(tutorShares)
      .set({ expiresAt, updatedAt: new Date() })
      .where(eq(tutorShares.token, token))
  }

  // ── Add a note ────────────────────────────────────────────────────────────

  async addNote(shareId: string, noteText: string): Promise<TutorNote> {
    // Strip HTML tags for XSS prevention
    const sanitised = noteText.replace(/<[^>]*>/g, '').trim()

    const [row] = await this.db
      .insert(tutorNotes)
      .values({ shareId, noteText: sanitised })
      .returning()

    return {
      id: row.id,
      shareId: row.shareId,
      noteText: row.noteText,
      createdAt: row.createdAt,
    }
  }

  // ── Get notes for a specific share ────────────────────────────────────────

  async getNotesForShare(shareId: string): Promise<TutorNote[]> {
    const rows = await this.db.query.tutorNotes.findMany({
      where: eq(tutorNotes.shareId, shareId),
      orderBy: [desc(tutorNotes.createdAt)],
    })

    return rows.map((r) => ({
      id: r.id,
      shareId: r.shareId,
      noteText: r.noteText,
      createdAt: r.createdAt,
    }))
  }
}
