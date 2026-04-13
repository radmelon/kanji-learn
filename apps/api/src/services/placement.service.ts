import { and, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { kanji, placementResults, placementSessions, userKanjiProgress, userProfiles } from '@kanji-learn/db'

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export async function sampleKanjiIds(
  db: any,
  userId: string,
  level: string,
  exclude: number[],
  count = 5
): Promise<number[]> {
  const baseConditions: any[] = [
    eq(kanji.jlptLevel, level as any),
    sql`(${userKanjiProgress.status} IS NULL OR ${userKanjiProgress.status} NOT IN ('remembered', 'burned'))`,
  ]
  if (exclude.length > 0) {
    baseConditions.push(notInArray(kanji.id, exclude))
  }

  const rows = await db
    .select({ id: kanji.id })
    .from(kanji)
    .leftJoin(
      userKanjiProgress,
      and(eq(userKanjiProgress.kanjiId, kanji.id), eq(userKanjiProgress.userId, userId))
    )
    .where(and(...baseConditions))
    .orderBy(sql`RANDOM()`)
    .limit(count)

  return rows.map((r: any) => r.id as number)
}

export async function getQuestionsWithDistractors(db: any, kanjiIds: number[]) {
  if (kanjiIds.length === 0) return []

  const kanjiRows = await db
    .select({
      id: kanji.id,
      character: kanji.character,
      jlptLevel: kanji.jlptLevel,
      meanings: kanji.meanings,
      onReadings: kanji.onReadings,
      kunReadings: kanji.kunReadings,
    })
    .from(kanji)
    .where(inArray(kanji.id, kanjiIds))

  const questions = []

  for (const k of kanjiRows) {
    const correctMeaning = (k.meanings as string[])[0] ?? ''

    // Meaning distractors from same level
    const mDistRows = await db
      .select({ meanings: kanji.meanings })
      .from(kanji)
      .where(and(eq(kanji.jlptLevel, k.jlptLevel), sql`${kanji.id} != ${k.id}`))
      .orderBy(sql`RANDOM()`)
      .limit(20)

    const mDistractors = mDistRows
      .map((r: any) => (r.meanings as string[])[0])
      .filter((m: string) => m && m !== correctMeaning)

    const dedupedMeanings = [...new Set(mDistractors)].slice(0, 3)
    while (dedupedMeanings.length < 3) dedupedMeanings.push(`—`)

    const shuffledMeanings = shuffle([correctMeaning, ...dedupedMeanings])
    const correctMeaningIndex = shuffledMeanings.indexOf(correctMeaning)

    // Reading
    const onReadings = k.onReadings as string[]
    const kunReadings = k.kunReadings as string[]
    const hasOn = onReadings.length > 0
    const correctReading = hasOn ? onReadings[0] : kunReadings[0]

    let shuffledReadings: string[] = []
    let correctReadingIndex = 0

    if (correctReading) {
      const rDistRows = await db
        .select({ onReadings: kanji.onReadings, kunReadings: kanji.kunReadings })
        .from(kanji)
        .where(
          and(
            eq(kanji.jlptLevel, k.jlptLevel),
            sql`${kanji.id} != ${k.id}`,
            hasOn
              ? sql`jsonb_array_length(${kanji.onReadings}) > 0`
              : sql`jsonb_array_length(${kanji.kunReadings}) > 0`
          )
        )
        .orderBy(sql`RANDOM()`)
        .limit(20)

      const rDistractors = rDistRows
        .map((r: any) => hasOn ? (r.onReadings as string[])[0] : (r.kunReadings as string[])[0])
        .filter((r: string) => r && r !== correctReading)

      const dedupedReadings = [...new Set(rDistractors)].slice(0, 3)
      while (dedupedReadings.length < 3) dedupedReadings.push(`—`)

      shuffledReadings = shuffle([correctReading, ...dedupedReadings]) as string[]
      correctReadingIndex = shuffledReadings.indexOf(correctReading)
    }

    questions.push({
      kanjiId: k.id,
      character: k.character,
      jlptLevel: k.jlptLevel,
      meaningOptions: shuffledMeanings,
      correctMeaningIndex,
      readingOptions: shuffledReadings,
      correctReadingIndex,
    })
  }

  return questions
}

export async function applyPlacementResults(
  db: any,
  userId: string,
  results: { kanjiId: number; passed: boolean }[]
): Promise<{ applied: number; skipped: number }> {
  // ── Placement persistence ────────────────────────────────────────────────
  if (results.length > 0) {
    const allKanjiIds = results.map((r) => r.kanjiId)

    // Fetch JLPT levels for all tested kanji
    const kanjiRows = await db
      .select({ id: kanji.id, jlptLevel: kanji.jlptLevel })
      .from(kanji)
      .where(inArray(kanji.id, allKanjiIds))

    const levelMap = new Map<number, string>(kanjiRows.map((r: any) => [r.id as number, r.jlptLevel as string]))

    // Build per-level pass/total counts
    const passedByLevel: Record<string, number> = {}
    const totalByLevel: Record<string, number> = {}

    for (const r of results) {
      const level = levelMap.get(r.kanjiId)
      if (!level) continue
      totalByLevel[level] = (totalByLevel[level] ?? 0) + 1
      if (r.passed) passedByLevel[level] = (passedByLevel[level] ?? 0) + 1
    }

    // Infer placement level: highest JLPT level where accuracy >= 60%
    // Walk N5 → N4 → N3 → N2 → N1, break on first failure
    const jlptOrder = ['N5', 'N4', 'N3', 'N2', 'N1']
    let inferredLevel: string | null = null
    for (const lvl of jlptOrder) {
      const total = totalByLevel[lvl] ?? 0
      if (total === 0) continue
      const passed = passedByLevel[lvl] ?? 0
      if (passed / total >= 0.6) {
        inferredLevel = lvl
      } else {
        break
      }
    }

    // Insert placement session
    const [session] = await db
      .insert(placementSessions)
      .values({
        userId,
        completedAt: new Date(),
        inferredLevel,
        summaryJson: { passedByLevel, totalByLevel },
      })
      .returning({ id: placementSessions.id })

    // Bulk-insert individual placement results
    const resultRows = results.map((r) => ({
      sessionId: session.id,
      kanjiId: r.kanjiId,
      jlptLevel: levelMap.get(r.kanjiId) ?? 'N5',
      passed: r.passed,
    }))

    if (resultRows.length > 0) {
      await db.insert(placementResults).values(resultRows)
    }
  }
  // ── End placement persistence ─────────────────────────────────────────────

  const passedIds = results.filter((r) => r.passed).map((r) => r.kanjiId)
  if (passedIds.length === 0) return { applied: 0, skipped: 0 }

  const existing = await db
    .select({ kanjiId: userKanjiProgress.kanjiId, status: userKanjiProgress.status })
    .from(userKanjiProgress)
    .where(and(eq(userKanjiProgress.userId, userId), inArray(userKanjiProgress.kanjiId, passedIds)))

  const existingMap = new Map(existing.map((r: any) => [r.kanjiId as number, r.status as string]))

  // Ensure the user profile row exists (FK requirement) before inserting progress rows
  await db.insert(userProfiles).values({ id: userId }).onConflictDoNothing()

  const nextReviewAt = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000)
  const toInsert: any[] = []
  const toUpdate: number[] = []
  let skipped = 0

  for (const id of passedIds) {
    const st = existingMap.get(id)
    if (!st) {
      toInsert.push({
        userId,
        kanjiId: id,
        status: 'remembered' as const,
        interval: 21,
        nextReviewAt,
        easeFactor: 2.5,
        repetitions: 2,
        readingStage: 0,
        updatedAt: new Date(),
      })
    } else if (st === 'remembered' || st === 'burned') {
      skipped++
    } else {
      toUpdate.push(id)
    }
  }

  if (toInsert.length > 0) {
    await db.insert(userKanjiProgress).values(toInsert)
  }

  for (const id of toUpdate) {
    await db
      .update(userKanjiProgress)
      .set({ status: 'remembered', interval: 21, nextReviewAt, easeFactor: 2.5, repetitions: 2, updatedAt: new Date() })
      .where(and(eq(userKanjiProgress.userId, userId), eq(userKanjiProgress.kanjiId, id)))
  }

  return { applied: toInsert.length + toUpdate.length, skipped }
}
