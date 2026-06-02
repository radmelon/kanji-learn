import Anthropic from '@anthropic-ai/sdk'
import { and, eq, isNull, lte } from 'drizzle-orm'
import { mnemonics, kanji } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import { MNEMONIC_REFRESH_DAYS, updateEffectiveness, EFFECTIVENESS_DEFAULT } from '@kanji-learn/shared'
import type { AssemblerSlots, CoCreationContext } from '@kanji-learn/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MnemonicRecord {
  id: string
  kanjiId: number
  userId: string | null
  type: 'system' | 'user'
  storyText: string
  imagePrompt: string | null
  imageUrl: string | null
  latitude: number | null
  longitude: number | null
  generationMethod: 'system' | 'user' | 'cocreated'
  locationType: string | null
  cocreationContext: CoCreationContext | null
  effectivenessScore: number
  reinforcementCount: number
  lastReinforcedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface GeneratedMnemonic {
  storyText: string
  imagePrompt: string
}

// ─── Mnemonic Service ─────────────────────────────────────────────────────────

/** Minimal seam over Anthropic.messages.create so the cloud tier is testable. */
export interface AnthropicLike {
  messages: {
    create(args: {
      model: string
      max_tokens: number
      system: string
      messages: { role: 'user'; content: string }[]
    }): Promise<{ content: Array<{ type: string; text?: string }> }>
  }
}

export class MnemonicService {
  private anthropic: AnthropicLike

  constructor(private db: Db, anthropic?: AnthropicLike) {
    this.anthropic =
      anthropic ?? (new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) as unknown as AnthropicLike)
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

  // ── Cloud-tier assembly from co-creation slots (spec §7.3) ────────────────

  /** Weaves the co-creation slots into a personal story via Claude. Throws on
   *  Anthropic error so the client can fall to the next cascade tier. */
  async assembleFromSlots(slots: AssemblerSlots): Promise<string> {
    const res = await this.anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: COCREATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildAssemblyPrompt(slots) }],
    })
    const block = res.content[0]
    const text = block?.type === 'text' ? block.text?.trim() : undefined
    if (!text) throw new Error('Cloud assembly returned no text')
    return text
  }

  // ── Generate mnemonic with Claude Haiku (fast, live) ──────────────────────

  async generateHaiku(kanjiId: number, userId: string, coords?: { latitude: number; longitude: number }): Promise<MnemonicRecord> {
    const kanjiData = await this.fetchKanji(kanjiId)
    const { storyText, imagePrompt } = this.parseResponse(
      (await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: this.buildPrompt(kanjiData, 'concise') }],
        system: MNEMONIC_SYSTEM_PROMPT,
      })).content[0]
    )
    return this.saveMnemonic({ kanjiId, userId, type: 'user', storyText, imagePrompt, ...coords })
  }

  // ── Generate mnemonic with Claude Sonnet (rich, detailed) ─────────────────

  async generateSonnet(kanjiId: number, userId: string, coords?: { latitude: number; longitude: number }): Promise<MnemonicRecord> {
    const kanjiData = await this.fetchKanji(kanjiId)
    const { storyText, imagePrompt } = this.parseResponse(
      (await this.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        messages: [{ role: 'user', content: this.buildPrompt(kanjiData, 'rich') }],
        system: MNEMONIC_SYSTEM_PROMPT,
      })).content[0]
    )
    return this.saveMnemonic({ kanjiId, userId, type: 'user', storyText, imagePrompt, ...coords })
  }

  // ── Save user-authored mnemonic ────────────────────────────────────────────

  async saveUserMnemonic(
    kanjiId: number,
    userId: string,
    storyText: string,
    coords?: { latitude: number; longitude: number }
  ): Promise<MnemonicRecord> {
    return this.saveMnemonic({ kanjiId, userId, type: 'user', storyText, imagePrompt: null, ...coords })
  }

  // ── Persist a co-created mnemonic (client-owned flow; spec §10.1/§10.3) ────

  async saveCoCreatedMnemonic(
    kanjiId: number,
    userId: string,
    storyText: string,
    context: CoCreationContext,
    coords?: { latitude: number; longitude: number },
  ): Promise<MnemonicRecord> {
    const [row] = await this.db
      .insert(mnemonics)
      .values({
        kanjiId,
        userId,
        type: 'user',
        generationMethod: 'cocreated',
        storyText,
        imagePrompt: null,
        cocreationContext: context,
        locationType: context.locationName ?? null,
        latitude: coords?.latitude,
        longitude: coords?.longitude,
        // No refreshPromptAt — the 30-day nudge is retired (later task).
      })
      .returning()
    return this.toRecord(row)
  }

  // ── Reinforcement outcome → EMA effectiveness (spec §6.1) ──────────────────

  /** outcome = 1 (👍 / quiz correct) or 0 (👎 / quiz wrong). */
  async recordOutcome(mnemonicId: string, userId: string, outcome: 0 | 1): Promise<MnemonicRecord | null> {
    const [existing] = await this.db
      .select()
      .from(mnemonics)
      .where(and(eq(mnemonics.id, mnemonicId), eq(mnemonics.userId, userId)))
    if (!existing) return null

    const [updated] = await this.db
      .update(mnemonics)
      .set({
        effectivenessScore: updateEffectiveness(existing.effectivenessScore, outcome),
        reinforcementCount: existing.reinforcementCount + 1,
        lastReinforcedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(mnemonics.id, mnemonicId), eq(mnemonics.userId, userId)))
      .returning()
    return updated ? this.toRecord(updated) : null
  }

  // ── Deepen: append a layer, reset score, keep history (spec §6.3) ──────────

  /** Replaces story + context with the deepened versions; resets effectiveness
   *  to the default (fresh chance) while reinforcementCount keeps climbing. */
  async applyDeepen(
    mnemonicId: string,
    userId: string,
    storyText: string,
    context: CoCreationContext,
  ): Promise<MnemonicRecord | null> {
    const [updated] = await this.db
      .update(mnemonics)
      .set({
        storyText,
        cocreationContext: context,
        effectivenessScore: EFFECTIVENESS_DEFAULT,
        updatedAt: new Date(),
      })
      .where(and(eq(mnemonics.id, mnemonicId), eq(mnemonics.userId, userId)))
      .returning()
    return updated ? this.toRecord(updated) : null
  }

  // ── Update a user's mnemonic ───────────────────────────────────────────────

  async updateUserMnemonic(
    mnemonicId: string,
    userId: string,
    storyText?: string,
    imageUrl?: string | null,
    latitude?: number | null,
    longitude?: number | null,
  ): Promise<MnemonicRecord | null> {
    const patch: Partial<typeof mnemonics.$inferInsert> = { updatedAt: new Date() }
    if (storyText !== undefined) { patch.storyText = storyText; patch.refreshPromptAt = null }
    if (imageUrl !== undefined) patch.imageUrl = imageUrl
    if (latitude !== undefined) patch.latitude = latitude
    if (longitude !== undefined) patch.longitude = longitude

    const [updated] = await this.db
      .update(mnemonics)
      .set(patch)
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

  private parseResponse(content: { type: string; text?: string }): GeneratedMnemonic {
    if (content.type !== 'text' || content.text === undefined) {
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
    latitude?: number
    longitude?: number
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
      imageUrl: row.imageUrl,
      latitude: row.latitude,
      longitude: row.longitude,
      generationMethod: row.generationMethod,
      locationType: row.locationType,
      cocreationContext: (row.cocreationContext as CoCreationContext | null) ?? null,
      effectivenessScore: row.effectivenessScore,
      reinforcementCount: row.reinforcementCount,
      lastReinforcedAt: row.lastReinforcedAt,
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

const COCREATION_SYSTEM_PROMPT = `You are Buddy, a warm study companion helping a learner BUILD their own memory hook for a kanji.
You are given real details the learner just gave you: where they are, something they can see, the kanji's component parts and meaning, and its reading.
Weave ALL of them into one vivid 2–3 sentence second-person scene that connects the new kanji to what they already see and know (learning is constructed: new → known).
Name each component's meaning, ground it in their place, use their anchor detail, and surface the reading naturally. Concrete and surprising, never generic. Output ONLY the story — no preamble, no labels.`

function buildAssemblyPrompt(slots: AssemblerSlots): string {
  const components = slots.components.length
    ? slots.components.map((c) => `${c.char} (${c.meaning})`).join(', ')
    : 'no mapped components'
  const lines = [
    `Kanji: ${slots.kanji} — means "${slots.kanjiMeaning}", read ${slots.reading}.`,
    `Components: ${components}.`,
    `Place: ${slots.locationName}.`,
    `They are looking at: ${slots.anchor}.`,
  ]
  if (slots.personalDetail) lines.push(`Personal detail: ${slots.personalDetail}.`)
  if (slots.readingPlay) lines.push(`Reading wordplay seed: ${slots.readingPlay}.`)
  return lines.join('\n')
}
