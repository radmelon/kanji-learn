import { and, eq, sql } from 'drizzle-orm'
import { buddyLlmUsage } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'

export interface RateLimiterOptions {
  tier2DailyCap: number
  tier3DailyCap: number
}

export class RateLimiter {
  constructor(private db: Db, private options: RateLimiterOptions) {}

  /**
   * Atomically increments usage for the given (user, tier, today) row.
   * Returns true if the call is allowed, false if it would exceed the cap.
   * Tier 1 is never limited — returns true without touching the db.
   */
  async tryConsume(userId: string, tier: 1 | 2 | 3): Promise<boolean> {
    if (tier === 1) return true
    const cap = tier === 2 ? this.options.tier2DailyCap : this.options.tier3DailyCap
    if (cap <= 0) return false

    const today = this.todayIsoDate()
    const tierStr = `tier${tier}` as 'tier2' | 'tier3'

    // Upsert + increment atomically, then check result.
    const rows = await this.db
      .insert(buddyLlmUsage)
      .values({ userId, usageDate: today, tier: tierStr, callCount: 1 })
      .onConflictDoUpdate({
        target: [buddyLlmUsage.userId, buddyLlmUsage.usageDate, buddyLlmUsage.tier],
        set: {
          callCount: sql`${buddyLlmUsage.callCount} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning({ callCount: buddyLlmUsage.callCount })

    const newCount = rows[0]?.callCount ?? 0
    if (newCount > cap) {
      // Roll back the increment so the cap is never breached across concurrent calls.
      await this.db
        .update(buddyLlmUsage)
        .set({ callCount: sql`${buddyLlmUsage.callCount} - 1` })
        .where(
          and(
            eq(buddyLlmUsage.userId, userId),
            eq(buddyLlmUsage.usageDate, today),
            eq(buddyLlmUsage.tier, tierStr)
          )
        )
      return false
    }
    return true
  }

  async remainingForTier(userId: string, tier: 2 | 3): Promise<number> {
    const cap = tier === 2 ? this.options.tier2DailyCap : this.options.tier3DailyCap
    const today = this.todayIsoDate()
    const tierStr = `tier${tier}` as 'tier2' | 'tier3'

    const row = await this.db.query.buddyLlmUsage.findFirst({
      where: and(
        eq(buddyLlmUsage.userId, userId),
        eq(buddyLlmUsage.usageDate, today),
        eq(buddyLlmUsage.tier, tierStr)
      ),
    })
    return Math.max(0, cap - (row?.callCount ?? 0))
  }

  private todayIsoDate(): string {
    return new Date().toISOString().slice(0, 10)
  }
}
