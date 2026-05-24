// apps/api/src/services/buddy/metrics.service.ts
//
// Daily Buddy metrics — three rolling-24h counters emitted as a single
// structured-JSON log line on stdout. Consumed by App Runner's stdout →
// CloudWatch pipeline. Query via CloudWatch Logs Insights:
//
//   fields @timestamp, @message
//   | filter @message like /buddy_daily_counts/
//   | parse @message '"metric":"buddy_daily_counts"' as metric
//
// Phase 0a Task 4. Scheduled by `cron.ts` at 03:00 UTC daily.

import { sql } from 'drizzle-orm'
import type { Db } from '@kanji-learn/db'

/**
 * Emit a single structured-JSON log line summarising Buddy-related write
 * counts over the past 24h.
 *
 * Format:
 *   {"metric":"buddy_daily_counts",
 *    "window_start":"...","window_end":"...",
 *    "learner_state_refreshes":N,
 *    "llm_telemetry_rows":N,
 *    "dual_write_events":N}
 *
 * Errors are caught and logged as a warning — a metric-emission failure
 * must never take down the API. `dual_write_events` is proxied by row
 * count in `learner_timeline_events`; every dual-write commits one
 * timeline event per submitted card, which is the closest available
 * proxy for "dual-write commits" without instrumenting the service path.
 */
export async function emitDailyBuddyMetrics(db: Db): Promise<void> {
  const windowEnd = new Date()
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000)
  // postgres-js doesn't accept Date objects as positional params in raw SQL
  // — pass ISO strings and cast on the server side.
  const startIso = windowStart.toISOString()
  const endIso = windowEnd.toISOString()

  try {
    const rows = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM learner_state_cache
          WHERE updated_at >= ${startIso}::timestamptz AND updated_at < ${endIso}::timestamptz)::int
          AS learner_state_refreshes,
        (SELECT COUNT(*) FROM buddy_llm_telemetry
          WHERE created_at >= ${startIso}::timestamptz AND created_at < ${endIso}::timestamptz)::int
          AS llm_telemetry_rows,
        (SELECT COUNT(*) FROM learner_timeline_events
          WHERE occurred_at >= ${startIso}::timestamptz AND occurred_at < ${endIso}::timestamptz)::int
          AS dual_write_events
    `)

    // postgres-js + drizzle .execute() returns rows directly as an array.
    // Coerce defensively in case the shape varies by driver version.
    const list = rows as unknown as Array<Record<string, number>>
    const row = list[0] ?? {}

    console.log(
      JSON.stringify({
        metric: 'buddy_daily_counts',
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
        learner_state_refreshes: row.learner_state_refreshes ?? 0,
        llm_telemetry_rows: row.llm_telemetry_rows ?? 0,
        dual_write_events: row.dual_write_events ?? 0,
      })
    )
  } catch (err) {
    console.warn('[BuddyMetrics] daily emission failed:', err)
  }
}
