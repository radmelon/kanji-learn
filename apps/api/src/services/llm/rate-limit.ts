import { and, eq, sql } from 'drizzle-orm'
import { buddyLlmUsage } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'

export interface RateLimiterOptions {
  tier2DailyCap: number
  tier3DailyCap: number
}

/**
 * Per-user daily LLM rate limiter backed by the `buddy_llm_usage` table.
 *
 * **Day boundary:** all "days" are UTC (`YYYY-MM-DD` derived from
 * `new Date().toISOString().slice(0, 10)`). This is an intentional Phase 0
 * simplification — per-user-timezone day boundaries are deferred until we
 * plumb `userProfiles.timezone` through the router in a later phase.
 *
 * **Error policy:** `tryConsume` propagates db errors (connection loss, FK
 * violations on `userId`, etc.). The caller (Task 14 `BuddyLLMRouter`) owns
 * fail-open vs. fail-closed policy — this class is deliberately agnostic.
 */
export class RateLimiter {
  constructor(private db: Db, private options: RateLimiterOptions) {}

  /**
   * Atomically increments usage for the given (user, tier, today) row and
   * returns whether the call is allowed.
   *
   * Uses a single `INSERT ... ON CONFLICT DO UPDATE ... WHERE call_count < cap`
   * statement so the cap is enforced inside one db round-trip with no
   * compensating write. When the WHERE clause suppresses the update, the
   * statement returns zero rows — that is the "blocked" signal. This avoids
   * the race window a two-step increment-then-rollback design would have.
   *
   * Tier 1 is never limited — returns true without touching the db.
   * `cap <= 0` (including accidentally negative configs) is treated as
   * "block all" for tiers 2 and 3.
   */
  async tryConsume(userId: string, tier: 1 | 2 | 3): Promise<boolean> {
    if (tier === 1) return true
    const cap = tier === 2 ? this.options.tier2DailyCap : this.options.tier3DailyCap
    if (cap <= 0) return false

    const today = this.todayIsoDate()
    const tierStr = `tier${tier}` as 'tier2' | 'tier3'

    // Atomic enforcement: the DO UPDATE only fires when the existing
    // call_count is still below the cap. If the WHERE is false, Postgres
    // suppresses the update and RETURNING emits zero rows — meaning the cap
    // is already reached and this call must be blocked. A fresh insert
    // (no conflict) always returns one row because call_count starts at 1
    // and cap > 0 is guaranteed by the early return above.
    const rows = await this.db
      .insert(buddyLlmUsage)
      .values({ userId, usageDate: today, tier: tierStr, callCount: 1 })
      .onConflictDoUpdate({
        target: [buddyLlmUsage.userId, buddyLlmUsage.usageDate, buddyLlmUsage.tier],
        set: {
          callCount: sql`${buddyLlmUsage.callCount} + 1`,
          updatedAt: sql`now()`,
        },
        where: sql`${buddyLlmUsage.callCount} < ${cap}`,
      })
      .returning({ callCount: buddyLlmUsage.callCount })

    return rows.length > 0
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

  /** UTC day key. See class-level docstring for rationale. */
  private todayIsoDate(): string {
    return new Date().toISOString().slice(0, 10)
  }
}
