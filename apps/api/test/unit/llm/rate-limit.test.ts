import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@kanji-learn/db'
import { sql } from 'drizzle-orm'
import { RateLimiter } from '../../../src/services/llm/rate-limit'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

// Use a fixed user id for these tests
const TEST_USER = '00000000-0000-0000-0000-000000000001'

async function resetUsage() {
  await db.execute(sql`DELETE FROM buddy_llm_usage WHERE user_id = ${TEST_USER}`)
}

async function ensureUser() {
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES (${TEST_USER}, 'Test User', 'UTC')
    ON CONFLICT DO NOTHING
  `)
}

describe('RateLimiter', () => {
  beforeEach(async () => {
    await ensureUser()
    await resetUsage()
  })

  it('allows calls under the cap', async () => {
    const limiter = new RateLimiter(db, { tier2DailyCap: 3, tier3DailyCap: 1 })
    expect(await limiter.tryConsume(TEST_USER, 2)).toBe(true)
    expect(await limiter.tryConsume(TEST_USER, 2)).toBe(true)
    expect(await limiter.tryConsume(TEST_USER, 2)).toBe(true)
  })

  it('blocks calls over the cap', async () => {
    const limiter = new RateLimiter(db, { tier2DailyCap: 2, tier3DailyCap: 1 })
    expect(await limiter.tryConsume(TEST_USER, 2)).toBe(true)
    expect(await limiter.tryConsume(TEST_USER, 2)).toBe(true)
    expect(await limiter.tryConsume(TEST_USER, 2)).toBe(false)
  })

  it('tracks tier 3 separately from tier 2', async () => {
    const limiter = new RateLimiter(db, { tier2DailyCap: 1, tier3DailyCap: 1 })
    expect(await limiter.tryConsume(TEST_USER, 2)).toBe(true)
    expect(await limiter.tryConsume(TEST_USER, 3)).toBe(true)
    expect(await limiter.tryConsume(TEST_USER, 2)).toBe(false)
    expect(await limiter.tryConsume(TEST_USER, 3)).toBe(false)
  })

  it('tier 1 is never limited', async () => {
    const limiter = new RateLimiter(db, { tier2DailyCap: 0, tier3DailyCap: 0 })
    for (let i = 0; i < 10; i++) {
      expect(await limiter.tryConsume(TEST_USER, 1)).toBe(true)
    }
  })

  it('remainingForTier reports a sensible number', async () => {
    const limiter = new RateLimiter(db, { tier2DailyCap: 5, tier3DailyCap: 1 })
    await limiter.tryConsume(TEST_USER, 2)
    await limiter.tryConsume(TEST_USER, 2)
    expect(await limiter.remainingForTier(TEST_USER, 2)).toBe(3)
  })
})
