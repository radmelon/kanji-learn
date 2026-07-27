// apps/api/test/integration/quiz-due-lifecycle.test.ts
//
// The recall quiz's due-stamp must be CLEARED by a correct answer.
//
// Parent spec §8: "correct → bump effectivenessScore, clear the due stamp".
// recordOutcome originally wrote only the EMA fields and never touched
// cocreationContext, so isRecallQuizDue stayed true forever and the quiz
// re-fired at the start of every session containing that kanji. Caught by the
// 2026-07-26 adversarial plan review.
import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { kanji, mnemonics } from '@kanji-learn/db'
import { MnemonicService } from '../../src/services/mnemonic.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER = '00000000-0000-0000-0000-0000000c0c02'
const DUE = '2026-07-01T00:00:00.000Z'

const CTX = {
  layers: [
    { questions: ['q'], answers: ['a yellow vending machine'], source: 'environment' as const },
  ],
  layerCount: 1,
  locationName: 'Beppu Station',
  components: [{ char: '扌', meaning: 'hand' }, { char: '寺', meaning: 'temple' }],
  generatedBy: 'cloud' as const,
  mnemonicQuizDueAt: DUE,
}

async function seedHook(): Promise<string> {
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES (${USER}, 'QuizDueTest', 'UTC') ON CONFLICT DO NOTHING
  `)
  const [k] = await db.select({ id: kanji.id }).from(kanji).limit(1)
  const [row] = await db
    .insert(mnemonics)
    .values({
      kanjiId: k.id,
      userId: USER,
      type: 'user',
      generationMethod: 'cocreated',
      storyText: 'At Beppu Station a hand holds a can beside a temple.',
      cocreationContext: CTX,
      effectivenessScore: 0.5,
      reinforcementCount: 0,
    })
    .returning()
  return row.id
}

const ctxOf = async (id: string) => {
  const [row] = await db
    .select({ ctx: mnemonics.cocreationContext })
    .from(mnemonics)
    .where(eq(mnemonics.id, id))
  return row.ctx as typeof CTX | null
}

beforeEach(async () => {
  await db.execute(sql`DELETE FROM mnemonics WHERE user_id = ${USER}`)
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM mnemonics WHERE user_id = ${USER}`)
  await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
  await client.end()
})

describe('recall-quiz due-stamp lifecycle', () => {
  it('clears mnemonicQuizDueAt on a correct answer', async () => {
    const id = await seedHook()
    await new MnemonicService(db).recordOutcome(id, USER, 1)
    const ctx = await ctxOf(id)
    expect(ctx?.mnemonicQuizDueAt).toBeUndefined()
  })

  it('LEAVES the stamp on a wrong answer, so the kanji is re-tested', async () => {
    const id = await seedHook()
    await new MnemonicService(db).recordOutcome(id, USER, 0)
    const ctx = await ctxOf(id)
    expect(ctx?.mnemonicQuizDueAt).toBe(DUE)
  })

  it('preserves the rest of the context when clearing', async () => {
    // The clear must be surgical — layers are the hook's whole history and a
    // sloppy overwrite would discard them (parent spec §6.3: never discard).
    const id = await seedHook()
    await new MnemonicService(db).recordOutcome(id, USER, 1)
    const ctx = await ctxOf(id)
    expect(ctx?.layers).toEqual(CTX.layers)
    expect(ctx?.layerCount).toBe(1)
    expect(ctx?.components).toEqual(CTX.components)
    expect(ctx?.locationName).toBe('Beppu Station')
    expect(ctx?.generatedBy).toBe('cloud')
  })

  it('still updates the EMA fields when it clears', async () => {
    const id = await seedHook()
    const updated = await new MnemonicService(db).recordOutcome(id, USER, 1)
    expect(updated?.reinforcementCount).toBe(1)
    expect(updated?.effectivenessScore).toBeGreaterThan(0.5)
  })

  it('is safe on a hook that has no stamp', async () => {
    const id = await seedHook()
    await new MnemonicService(db).recordOutcome(id, USER, 1) // clears
    await new MnemonicService(db).recordOutcome(id, USER, 1) // already clear
    const ctx = await ctxOf(id)
    expect(ctx?.mnemonicQuizDueAt).toBeUndefined()
    expect(ctx?.layers).toEqual(CTX.layers)
  })
})
