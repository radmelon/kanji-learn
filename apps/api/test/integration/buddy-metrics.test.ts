// apps/api/test/integration/buddy-metrics.test.ts
//
// Phase 0a Task 4 — `emitDailyBuddyMetrics()` emits a single
// structured-JSON log line on stdout with three 24h counters. Consumed
// by App Runner's stdout → CloudWatch pipeline.

import { describe, it, expect, vi, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@kanji-learn/db'
import { emitDailyBuddyMetrics } from '../../src/services/buddy/metrics.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

afterAll(async () => {
  await client.end()
})

describe('emitDailyBuddyMetrics', () => {
  it('logs structured JSON with three counters and a window', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await emitDailyBuddyMetrics(db)

    const calls = logSpy.mock.calls.map((c) => String(c[0]))
    const metricLine = calls.find((line) => line.includes('"metric":"buddy_daily_counts"'))
    expect(metricLine).toBeDefined()

    const parsed = JSON.parse(metricLine!)
    expect(parsed.metric).toBe('buddy_daily_counts')
    expect(typeof parsed.window_start).toBe('string')
    expect(typeof parsed.window_end).toBe('string')
    expect(typeof parsed.learner_state_refreshes).toBe('number')
    expect(typeof parsed.llm_telemetry_rows).toBe('number')
    expect(typeof parsed.dual_write_events).toBe('number')

    logSpy.mockRestore()
  })
})
