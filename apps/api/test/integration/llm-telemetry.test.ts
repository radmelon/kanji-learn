import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { createTelemetryWriter } from '../../src/services/llm/telemetry'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER = '00000000-0000-0000-0000-000000000999'

beforeEach(async () => {
  await db.execute(sql`DELETE FROM buddy_llm_telemetry WHERE user_id = ${TEST_USER}`)
  await db.execute(
    sql`INSERT INTO user_profiles (id, display_name, timezone) VALUES (${TEST_USER}, 'TelemTest', 'UTC') ON CONFLICT DO NOTHING`
  )
})

describe('createTelemetryWriter', () => {
  it('persists a success event', async () => {
    const emit = createTelemetryWriter(db)
    await emit({
      userId: TEST_USER,
      tier: 2,
      providerName: 'groq',
      requestContext: 'study_plan_generation',
      inputTokens: 123,
      outputTokens: 45,
      latencyMs: 678,
      success: true,
    })

    const rows = await db.execute(
      sql`SELECT provider_name, success, input_tokens::int AS it, tier::text AS tier_text
          FROM buddy_llm_telemetry
          WHERE user_id = ${TEST_USER}`
    )
    expect(rows.length).toBe(1)
    const row = rows[0] as {
      provider_name: string
      success: boolean
      it: number
      tier_text: string
    }
    expect(row.provider_name).toBe('groq')
    expect(row.success).toBe(true)
    expect(row.it).toBe(123)
    expect(row.tier_text).toBe('tier2')
  })

  it('persists a failure event with error code', async () => {
    const emit = createTelemetryWriter(db)
    await emit({
      userId: TEST_USER,
      tier: 3,
      providerName: 'claude',
      requestContext: 'deep_diagnostic',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 2500,
      success: false,
      errorCode: 'timeout',
    })

    const rows = await db.execute(
      sql`SELECT error_code, success FROM buddy_llm_telemetry WHERE user_id = ${TEST_USER}`
    )
    expect(rows.length).toBe(1)
    const row = rows[0] as { error_code: string; success: boolean }
    expect(row.error_code).toBe('timeout')
    expect(row.success).toBe(false)
  })

  it('persists a zero-cost skip event (tier 1 unavailable)', async () => {
    // The router emits zero-cost skip events for unavailable/rate-limited
    // providers with latencyMs=0 and token counts=0. Verify those round-trip
    // cleanly — these rows are essential for Phase 1 dashboards.
    const emit = createTelemetryWriter(db)
    await emit({
      userId: TEST_USER,
      tier: 1,
      providerName: 'apple-fm',
      requestContext: 'encouragement',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      success: false,
      errorCode: 'unavailable',
    })

    const rows = await db.execute(
      sql`SELECT latency_ms::int AS latency, error_code FROM buddy_llm_telemetry
          WHERE user_id = ${TEST_USER}`
    )
    expect(rows.length).toBe(1)
    const row = rows[0] as { latency: number; error_code: string }
    expect(row.latency).toBe(0)
    expect(row.error_code).toBe('unavailable')
  })

  it('swallows database errors (never throws to caller)', async () => {
    const broken = {
      insert: () => {
        throw new Error('db gone')
      },
    } as unknown as Parameters<typeof createTelemetryWriter>[0]
    const emit = createTelemetryWriter(broken)
    // Should not throw even though the underlying db call is broken.
    await expect(
      emit({
        userId: TEST_USER,
        tier: 2,
        providerName: 'groq',
        requestContext: 'encouragement',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
        success: true,
      })
    ).resolves.toBeUndefined()
  })
})
