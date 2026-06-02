import { describe, it, expect, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@kanji-learn/db'
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
