import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { kanji, mnemonics, userProfiles } from '@kanji-learn/db'
import { buildTestApp } from '../helpers/test-app'
import { mnemonicRoutes } from '../../src/routes/mnemonics'
import { MnemonicService, type AnthropicLike } from '../../src/services/mnemonic.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER = '00000000-0000-0000-0000-0000000c0c01'

const fakeOk: AnthropicLike = {
  messages: { create: async () => ({ content: [{ type: 'text', text: 'At Beppu Station a hand holds a can.' }] }) },
}
const fakeErr: AnthropicLike = {
  messages: { create: async () => { throw new Error('rate limited') } },
}

const SLOTS = {
  kanji: '持', kanjiMeaning: 'hold', reading: 'もつ',
  components: [{ char: '扌', name: 'tehen', meaning: 'hand', imageKeyword: 'a hand grasping' }],
  locationName: 'Beppu Station', anchor: 'a yellow vending machine',
}

const CTX = {
  layers: [{ questions: ['q'], answers: ['a yellow vending machine'], anchor: 'a yellow vending machine', source: 'environment' as const }],
  layerCount: 1,
  locationName: 'Beppu Station',
  components: [{ char: '扌', meaning: 'hand' }, { char: '寺', meaning: 'temple' }],
  generatedBy: 'cloud' as const,
  mnemonicQuizDueAt: '2026-06-01T00:00:00.000Z',
}

afterAll(async () => { await client.end() })

describe('POST /v1/mnemonics/assemble', () => {
  it('returns the assembled cloud story on success', async () => {
    const app = await buildTestApp({
      plugin: mnemonicRoutes,
      opts: { prefix: '/v1/mnemonics', service: new MnemonicService(db, fakeOk) },
    })
    const res = await app.inject({
      method: 'POST', url: '/v1/mnemonics/assemble',
      headers: { 'x-test-user-id': USER }, payload: SLOTS,
    })
    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.ok).toBe(true)
    expect(json.data.generatedBy).toBe('cloud')
    expect(json.data.storyText).toContain('Beppu Station')
    await app.close()
  })

  it('returns 502 ASSEMBLY_FAILED so the client can fall back', async () => {
    const app = await buildTestApp({
      plugin: mnemonicRoutes,
      opts: { prefix: '/v1/mnemonics', service: new MnemonicService(db, fakeErr) },
    })
    const res = await app.inject({
      method: 'POST', url: '/v1/mnemonics/assemble',
      headers: { 'x-test-user-id': USER }, payload: SLOTS,
    })
    expect(res.statusCode).toBe(502)
    expect(res.json().code).toBe('ASSEMBLY_FAILED')
    await app.close()
  })
})

describe('POST /v1/mnemonics/:kanjiId/cocreated', () => {
  let kanjiId: number
  beforeAll(async () => {
    await db.execute(sql`DELETE FROM mnemonics WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
    await db.insert(userProfiles).values({ id: USER, displayName: 'CoCreate', timezone: 'UTC' })
    const [k] = await db.select({ id: kanji.id }).from(kanji).limit(1)
    kanjiId = k.id
  })

  it('persists generationMethod=cocreated and the layered context survives round-trip', async () => {
    const app = await buildTestApp({ plugin: mnemonicRoutes, opts: { prefix: '/v1/mnemonics' } })
    const res = await app.inject({
      method: 'POST', url: `/v1/mnemonics/${kanjiId}/cocreated`,
      headers: { 'x-test-user-id': USER },
      payload: { storyText: 'A hand holds a can at Beppu Station.', context: CTX, latitude: 33.2, longitude: 131.5 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.generationMethod).toBe('cocreated')
    await app.close()

    const [row] = await db.select().from(mnemonics).where(eq(mnemonics.userId, USER))
    expect(row.cocreationContext).toMatchObject({ layerCount: 1, generatedBy: 'cloud' })
    expect(row.cocreationContext!.components.map((c) => c.char)).toEqual(['扌', '寺'])
    const probe = await db.execute(
      sql`SELECT cocreation_context->>'generatedBy' AS gen FROM mnemonics WHERE user_id = ${USER}`,
    )
    expect((probe[0] as { gen: string }).gen).toBe('cloud')
  })
})
