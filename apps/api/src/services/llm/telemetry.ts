import { buddyLlmTelemetry } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import type { EmitTelemetry, TelemetryEvent } from './router'

/**
 * Build a router-compatible telemetry writer that persists events to the
 * buddy_llm_telemetry table. Safe to use as `opts.emitTelemetry` on the
 * BuddyLLMRouter — it never throws.
 *
 * The router invokes this once per provider attempt (success OR failure,
 * including zero-cost "skip" events for unavailable/rate-limited providers).
 * Because this runs on the user-facing request path, any throw would fail the
 * whole request — hence the blanket try/catch. Phase 1 will add structured
 * logging + a dead-letter queue for dropped telemetry rows.
 */
export function createTelemetryWriter(db: Db): EmitTelemetry {
  return async (event: TelemetryEvent) => {
    try {
      await db.insert(buddyLlmTelemetry).values({
        userId: event.userId,
        tier: tierToEnumValue(event.tier),
        providerName: event.providerName,
        requestContext: event.requestContext,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        latencyMs: event.latencyMs,
        success: event.success,
        errorCode: event.errorCode ?? null,
      })
    } catch (err) {
      // Telemetry must never break a user-facing request. Log and drop.
      // eslint-disable-next-line no-console
      console.warn('[telemetry] failed to write buddy_llm_telemetry row', err)
    }
  }
}

function tierToEnumValue(tier: 1 | 2 | 3): 'tier1' | 'tier2' | 'tier3' {
  return `tier${tier}` as const
}
