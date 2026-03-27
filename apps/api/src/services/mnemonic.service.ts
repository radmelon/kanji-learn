import Anthropic from '@anthropic-ai/sdk'
import { and, eq, isNull, lte } from 'drizzle-orm'
import { mnemonics, kanji } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import { MNEMONIC_REFRESH_DAYS } from '@kanji-learn/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MnemonicRecord {
  id: string
  kanjiId: number
  userId: string | null
  type: 'system' | 'user'
  storyText: string
  imagePrompt: string | null
  refreshPromptAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface GeneratedMnemonic {
  storyText: string
  imagePrompt: string
}

// ─── Mnemonic Service ─────────────────────────────────────────────────────────

export class MnemonicService {
  private anthropic: Anthropic

  constructor(private db: Db) {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }

  // ── Get mnemonics for a kanji (system + user) ──────────────────────────────

  async getForKanji(kanjiId: number, userId: string): Promise<MnemonicRecord[]> {
    const rows = await this.db.query.mnemonics.findMany({
      where: and(
        eq(mnemonics.kanjiId, kanjiId),
        // system mnemonics OR user's own
        // Drizzle doesn't support OR in findMany where cleanly, use raw
      ),
    })

    // Filter: system OR belongs to this user
    return rows
      .filter((m) => m.type === 'system' || m.userId === userId)
      .map(this.toRecord)
  }

  // ── Generate mnemonic with Claude Haiku (fast, live) ──────────────────────

  async generateHaiku(kanjiId: number, userId: string): Promise<MnemonicRecord> {
    const kanjiData = await this.fetchKanji(kanjiId)

    const prompt = this.buildPrompt(kanjiData, 'concise')

    const message = await this.anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
      system: MNEMONIC_SYSTEM_PROMPT,
    })

    const { storyText, imagePrompt } = this.parseResponse(message.content[0])

    return this.saveMnemonic({
      kanjiId,
      userId,
      type: 'user',
      storyText,
      imagePrompt,
    })
  }

  // ── Generate mnemonic with Claude Sonnet (rich, detailed) ─────────────────

  async generateSonnet(kanjiId: number, userId: string): Promise<MnemonicRecord> {
    const kanjiData = await this.fetchKanji(kanjiId)

    const prompt = this.buildPrompt(kanjiData, 'rich')

    const message = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
      system: MNEMONIC_SYSTEM_PROMPT,
    })

    const { storyText, imagePrompt } = this.parseResponse(message.content[0])

    return this.saveMnemonic({
      kanjiId,
      userId,
      type: 'user',
      storyText,
      imagePrompt,
    })
  }

  // ── Save user-authored mnemonic ────────────────────────────────────────────

  async saveUserMnemonic(
    kanjiId: number,
    userId: string,
    storyText: string
  ): Promise<MnemonicRecord> {
    return this.saveMnemonic({ kanjiId, userId, type: 'user', storyText, imagePrompt: null })
  }

  // ── Update a user's mnemonic ───────────────────────────────────────────────

  async updateUserMnemonic(
    mnemonicId: string,
    userId: string,
    storyText: string
  ): Promise<MnemonicRecord | null> {
    const [updated] = await this.db
      .update(mnemonics)
      .set({ storyText, updatedAt: new Date(), refreshPromptAt: null })
      .where(and(eq(mnemonics.id, mnemonicId), eq(mnemonics.userId, userId)))
      .returning()

    return updated ? this.toRecord(updated) : null
  }

  // ── Delete a user's mnemonic ───────────────────────────────────────────────

  async deleteUserMnemonic(mnemonicId: string, userId: string): Promise<boolean> {
    const result = await this.db
      .delete(mnemonics)
      .where(
        and(
          eq(mnemonics.id, mnemonicId),
          eq(mnemonics.userId, userId),
          eq(mnemonics.type, 'user')
        )
      )
      .returning({ id: mnemonics.id })

    return result.length > 0
  }

  // ── Get mnemonics due for refresh prompt ───────────────────────────────────

  async getDueForRefresh(userId: string): Promise<MnemonicRecord[]> {
    const now = new Date()
    const rows = await this.db
      .select()
      .from(mnemonics)
      .where(
        and(
          eq(mnemonics.userId, userId),
          lte(mnemonics.refreshPromptAt, now)
        )
      )

    return rows.map(this.toRecord)
  }

  // ── Dismiss refresh prompt (user says mnemonic still works) ───────────────

  async dismissRefresh(mnemonicId: string, userId: string): Promise<void> {
    const nextRefresh = new Date()
    nextRefresh.setDate(nextRefresh.getDate() + MNEMONIC_REFRESH_DAYS)

    await this.db
      .update(mnemonics)
      .set({ refreshPromptAt: nextRefresh, updatedAt: new Date() })
      .where(and(eq(mnemonics.id, mnemonicId), eq(mnemonics.userId, userId)))
  }

  // ── Seed system mnemonic (called by seed script) ───────────────────────────

  async seedSystemMnemonic(
    kanjiId: number,
    storyText: string,
    imagePrompt?: string
  ): Promise<void> {
    await this.db
      .insert(mnemonics)
      .values({
        kanjiId,
        userId: null,
        type: 'system',
        storyText,
        imagePrompt: imagePrompt ?? null,
      })
      .onConflictDoNothing()
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async fetchKanji(kanjiId: number) {
    const k = await this.db.query.kanji.findFirst({
      where: eq(kanji.id, kanjiId),
    })
    if (!k) throw new Error(`Kanji ${kanjiId} not found`)
    return k
  }

  private buildPrompt(
    k: { character: string; meanings: string[]; kunReadings: string[]; onReadings: string[]; radicals: string[] },
    style: 'concise' | 'rich'
  ): string {
    const meanings = (k.meanings as string[]).slice(0, 3).join(', ')
    const kun = (k.kunReadings as string[]).slice(0, 2).join(', ') || 'none'
    const on = (k.onReadings as string[]).slice(0, 2).join(', ') || 'none'
    const radicals = (k.radicals as string[]).join(', ') || 'none'

    if (style === 'concise') {
      return `Create a memory hook for the kanji ${k.character}.
Meanings: ${meanings}
Kun readings: ${kun}
On readings: ${on}
Radicals: ${radicals}

Write a SHORT, vivid story (2–3 sentences) that makes the meaning and at least one reading unforgettable. Then write a one-line image prompt for an illustration.

Respond in this exact format:
STORY: <your story here>
IMAGE: <image prompt here>`
    }

    return `Create a rich memory hook for the kanji ${k.character}.
Meanings: ${meanings}
Kun readings: ${kun}
On readings: ${on}
Radicals: ${radicals}

Write a vivid, memorable story (4–6 sentences) that encodes the meaning, the shape (radicals), and at least one reading using phonetic wordplay or imagery. Make it surprising and emotionally resonant. Then write a detailed image prompt for an illustration.

Respond in this exact format:
STORY: <your story here>
IMAGE: <image prompt here>`
  }

  private parseResponse(content: Anthropic.ContentBlock): GeneratedMnemonic {
    if (content.type !== 'text') {
      return { storyText: 'Unable to generate mnemonic.', imagePrompt: '' }
    }

    const text = content.text
    const storyMatch = text.match(/STORY:\s*(.+?)(?=IMAGE:|$)/s)
    const imageMatch = text.match(/IMAGE:\s*(.+?)$/s)

    return {
      storyText: storyMatch?.[1]?.trim() ?? text.trim(),
      imagePrompt: imageMatch?.[1]?.trim() ?? '',
    }
  }

  private async saveMnemonic(data: {
    kanjiId: number
    userId: string | null
    type: 'system' | 'user'
    storyText: string
    imagePrompt: string | null
  }): Promise<MnemonicRecord> {
    const refreshPromptAt = new Date()
    refreshPromptAt.setDate(refreshPromptAt.getDate() + MNEMONIC_REFRESH_DAYS)

    const [row] = await this.db
      .insert(mnemonics)
      .values({
        ...data,
        refreshPromptAt: data.type === 'user' ? refreshPromptAt : null,
      })
      .returning()

    return this.toRecord(row)
  }

  private toRecord(row: typeof mnemonics.$inferSelect): MnemonicRecord {
    return {
      id: row.id,
      kanjiId: row.kanjiId,
      userId: row.userId,
      type: row.type,
      storyText: row.storyText,
      imagePrompt: row.imagePrompt,
      refreshPromptAt: row.refreshPromptAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

const MNEMONIC_SYSTEM_PROMPT = `You are an expert Japanese language teacher specializing in mnemonic memory hooks for kanji.
Your mnemonics use vivid imagery, phonetic wordplay, and narrative to make kanji unforgettable.
You incorporate the kanji's radicals as visual building blocks and weave in the readings naturally.
Keep stories concrete, surprising, and emotionally engaging. Avoid vague or generic associations.`
