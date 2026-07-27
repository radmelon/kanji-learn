// apps/api/test/integration/queue-quiz-due.test.ts
//
// The review queue must carry `mnemonicQuizDueAt`, or the client cannot tell
// which hooked kanji owe their story→kanji first test. ReviewQueueItem had no
// such field and the queue route returned none — caught by the 2026-07-26
// adversarial plan review, which noted the scheduling logic had nothing to read.
import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { kanji, mnemonics, userKanjiProgress } from '@kanji-learn/db'
import { SrsService } from '../../src/services/srs.service'
import { DualWriteService } from '../../src/services/buddy/dual-write.service'
import { LearnerStateService } from '../../src/services/buddy/learner-state.service'
import { NudgeService } from '../../src/services/buddy/nudge.service'
import { NotificationService } from '../../src/services/notification.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER = '00000000-0000-0000-0000-0000000c0c03'
const DUE = '2026-07-01T00:00:00.000Z'

const srs = () => {
  const notifications = new NotificationService(db)
  return new SrsService(
    db,
    new DualWriteService(db),
    new LearnerStateService(db),
    new NudgeService(db, notifications),
  )
}

const ctx = (dueAt?: string) => ({
  layers: [{ questions: ['q'], answers: ['a'], source: 'environment' as const }],
  layerCount: 1,
  components: [{ char: '扌', meaning: 'hand' }],
  generatedBy: 'cloud' as const,
  ...(dueAt ? { mnemonicQuizDueAt: dueAt } : {}),
})

/** Seed a due review card for `kanjiId`, so it lands in the queue. */
async function seedDueCard(kanjiId: number) {
  await db.execute(sql`
    INSERT INTO user_kanji_progress (user_id, kanji_id, status, next_review_at, stability, difficulty)
    VALUES (${USER}, ${kanjiId}, 'reviewing', now() - interval '1 day', 5, 5)
    ON CONFLICT (user_id, kanji_id) DO UPDATE SET next_review_at = now() - interval '1 day'
  `)
}

beforeEach(async () => {
  await db.execute(sql`DELETE FROM mnemonics WHERE user_id = ${USER}`)
  await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${USER}`)
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES (${USER}, 'QueueQuizDue', 'UTC') ON CONFLICT DO NOTHING
  `)
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM mnemonics WHERE user_id = ${USER}`)
  await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${USER}`)
  await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
  await client.end()
})

describe('review queue carries mnemonicQuizDueAt', () => {
  it('sets the stamp on a kanji whose hook awaits its first test', async () => {
    const [k] = await db.select({ id: kanji.id }).from(kanji).limit(1)
    await seedDueCard(k.id)
    await db.insert(mnemonics).values({
      kanjiId: k.id, userId: USER, type: 'user', generationMethod: 'cocreated',
      storyText: 'a story', cocreationContext: ctx(DUE),
    })

    const queue = await srs().getReviewQueue(USER, 20)
    const item = queue.find((q) => q.kanjiId === k.id)
    expect(item).toBeDefined()
    expect(item!.mnemonicQuizDueAt).toBe(DUE)
  })

  it('leaves the stamp absent once the hook has passed its quiz', async () => {
    const [k] = await db.select({ id: kanji.id }).from(kanji).limit(1)
    await seedDueCard(k.id)
    await db.insert(mnemonics).values({
      kanjiId: k.id, userId: USER, type: 'user', generationMethod: 'cocreated',
      storyText: 'a story', cocreationContext: ctx(), // cleared
    })

    const queue = await srs().getReviewQueue(USER, 20)
    const item = queue.find((q) => q.kanjiId === k.id)
    expect(item).toBeDefined()
    expect(item!.mnemonicQuizDueAt).toBeUndefined()
  })

  it('ignores non-cocreated mnemonics', async () => {
    // An old system mnemonic must never schedule a recall quiz.
    const [k] = await db.select({ id: kanji.id }).from(kanji).limit(1)
    await seedDueCard(k.id)
    await db.insert(mnemonics).values({
      kanjiId: k.id, userId: USER, type: 'user', generationMethod: 'system',
      storyText: 'old style', cocreationContext: ctx(DUE),
    })

    const queue = await srs().getReviewQueue(USER, 20)
    expect(queue.find((q) => q.kanjiId === k.id)?.mnemonicQuizDueAt).toBeUndefined()
  })

  it('leaves hookless kanji untouched', async () => {
    const [k] = await db.select({ id: kanji.id }).from(kanji).limit(1)
    await seedDueCard(k.id)
    const queue = await srs().getReviewQueue(USER, 20)
    expect(queue.find((q) => q.kanjiId === k.id)?.mnemonicQuizDueAt).toBeUndefined()
  })

  it('does not blow up on an empty queue', async () => {
    await expect(srs().getReviewQueue(USER, 0)).resolves.toBeDefined()
  })
})

// The flashcard answer side (design spec §8.1) and the hint button (§8.2) both
// need the story itself. It rides the same read as the due stamp — a fetch per
// card would put the network on the critical path of every single reveal.
describe('review queue carries mnemonicStoryText', () => {
  it('attaches the hook story to a hooked kanji', async () => {
    const [k] = await db.select({ id: kanji.id }).from(kanji).limit(1)
    await seedDueCard(k.id)
    await db.insert(mnemonics).values({
      kanjiId: k.id, userId: USER, type: 'user', generationMethod: 'cocreated',
      storyText: 'the yellow vending machine hums', cocreationContext: ctx(DUE),
    })

    const queue = await srs().getReviewQueue(USER, 20)
    expect(queue.find((q) => q.kanjiId === k.id)?.mnemonicStoryText)
      .toBe('the yellow vending machine hums')
  })

  it('attaches the story even after the quiz stamp is cleared', async () => {
    // The stamp is spent after the first correct recall; the story is not.
    // Conflating the two would blank the answer side the moment a hook passed
    // its quiz — precisely when it has proven worth showing.
    const [k] = await db.select({ id: kanji.id }).from(kanji).limit(1)
    await seedDueCard(k.id)
    await db.insert(mnemonics).values({
      kanjiId: k.id, userId: USER, type: 'user', generationMethod: 'cocreated',
      storyText: 'still here', cocreationContext: ctx(),
    })

    const queue = await srs().getReviewQueue(USER, 20)
    const item = queue.find((q) => q.kanjiId === k.id)
    expect(item?.mnemonicQuizDueAt).toBeUndefined()
    expect(item?.mnemonicStoryText).toBe('still here')
  })

  it('never attaches a non-cocreated story', async () => {
    // Stock mnemonics were deleted in the Phase 5 cleanup; if one lingers it
    // must not reappear on the flashcard as "your hook".
    const [k] = await db.select({ id: kanji.id }).from(kanji).limit(1)
    await seedDueCard(k.id)
    await db.insert(mnemonics).values({
      kanjiId: k.id, userId: USER, type: 'user', generationMethod: 'system',
      storyText: 'old style', cocreationContext: ctx(),
    })

    const queue = await srs().getReviewQueue(USER, 20)
    expect(queue.find((q) => q.kanjiId === k.id)?.mnemonicStoryText).toBeUndefined()
  })

  it('leaves hookless kanji without a story', async () => {
    const [k] = await db.select({ id: kanji.id }).from(kanji).limit(1)
    await seedDueCard(k.id)
    const queue = await srs().getReviewQueue(USER, 20)
    expect(queue.find((q) => q.kanjiId === k.id)?.mnemonicStoryText).toBeUndefined()
  })
})
