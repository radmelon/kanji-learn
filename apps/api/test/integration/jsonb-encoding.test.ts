// apps/api/test/integration/jsonb-encoding.test.ts
//
// Regression guard for the Drizzle/postgres-js jsonb double-encoding bug.
//
// drizzle-orm's built-in `jsonb` JSON.stringifies the value in mapToDriverValue,
// then postgres-js JSON.stringifies it a SECOND time: on a parameterised write
// the Postgres server reports the parameter's type as jsonb (oid 3802), and
// postgres-js's serializer for that oid is JSON.stringify. The column ends up
// holding a JSON *string* scalar (jsonb_typeof = 'string') and SQL path
// operators (`->`, `#>>`, `@>`) silently return NULL.
//
// packages/db's local `jsonb` type (packages/db/src/jsonb.ts) hands the raw
// value to the driver so it is encoded exactly once. These tests insert through
// the real schema and assert the stored value is a genuine jsonb object/array.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { interventions, learnerProfiles } from '@kanji-learn/db'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER = '0b0b0b0b-0000-4000-8000-00000000ab01'

beforeAll(async () => {
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES (${TEST_USER}, 'JsonbEncodingTest', 'UTC')
    ON CONFLICT DO NOTHING
  `)
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM interventions WHERE user_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM learner_profiles WHERE user_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM user_profiles WHERE id = ${TEST_USER}`)
  await client.end()
})

describe('jsonb write encoding', () => {
  it('stores a Drizzle-written object payload as a real jsonb object', async () => {
    const id = crypto.randomUUID()
    await db.insert(interventions).values({
      id,
      userId: TEST_USER,
      type: 'velocity_drop',
      payload: { currentAvg: 10, previousAvg: 24, dropPct: 0.583, nested: { tags: ['a', 'b'] } },
    })

    const meta = (await db.execute(sql`
      SELECT jsonb_typeof(payload)         AS typ,
             payload #>> '{dropPct}'        AS drop_pct,
             payload #>> '{nested,tags,1}'  AS nested_tag
      FROM interventions WHERE id = ${id}
    `))[0] as { typ: string; drop_pct: string | null; nested_tag: string | null }

    // Before the fix: typ would be 'string' and both path reads NULL.
    expect(meta.typ).toBe('object')
    expect(meta.drop_pct).toBe('0.583')
    expect(meta.nested_tag).toBe('b')

    const [row] = await db.select().from(interventions).where(eq(interventions.id, id))
    expect(row.payload).toEqual({
      currentAvg: 10,
      previousAvg: 24,
      dropPct: 0.583,
      nested: { tags: ['a', 'b'] },
    })
  })

  it('stores a Drizzle-written string[] column as a real jsonb array', async () => {
    const interests = ['kanji', 'grammar', 'JLPT']
    await db
      .insert(learnerProfiles)
      .values({ userId: TEST_USER, interests })
      .onConflictDoUpdate({ target: learnerProfiles.userId, set: { interests } })

    const meta = (await db.execute(sql`
      SELECT jsonb_typeof(interests)       AS typ,
             jsonb_array_length(interests) AS len,
             interests #>> '{1}'           AS second
      FROM learner_profiles WHERE user_id = ${TEST_USER}
    `))[0] as { typ: string; len: number; second: string | null }

    expect(meta.typ).toBe('array')
    expect(Number(meta.len)).toBe(3)
    expect(meta.second).toBe('grammar')

    const [row] = await db
      .select()
      .from(learnerProfiles)
      .where(eq(learnerProfiles.userId, TEST_USER))
    expect(row.interests).toEqual(interests)
  })

  it('still decodes legacy double-encoded rows on read (fromDriver fallback)', async () => {
    const id = crypto.randomUUID()
    // Reproduce a pre-fix row: a JSON string scalar stored in the jsonb column.
    await db.execute(sql`
      INSERT INTO interventions (id, user_id, type, payload)
      VALUES (${id}, ${TEST_USER}, 'plateau',
              to_jsonb(${JSON.stringify({ daysSinceProgress: 7 })}::text))
    `)

    const meta = (await db.execute(sql`
      SELECT jsonb_typeof(payload) AS typ FROM interventions WHERE id = ${id}
    `))[0] as { typ: string }
    expect(meta.typ).toBe('string') // confirms the row is genuinely double-encoded

    const [row] = await db.select().from(interventions).where(eq(interventions.id, id))
    expect(row.payload).toEqual({ daysSinceProgress: 7 })
  })
})
