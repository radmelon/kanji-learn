/**
 * backfill-universal-kg.ts
 *
 * One-time migration: populate Universal Knowledge Graph tables from existing
 * user_kanji_progress rows. Safe to run multiple times — uses
 * onConflictDoNothing for identity and onConflictDoUpdate for knowledge state,
 * and dedupes legacy_import timeline events via an explicit existence check.
 *
 * Usage (CLI):
 *   pnpm --filter @kanji-learn/db tsx src/seeds/backfill-universal-kg.ts
 *
 * Usage (programmatic — e.g. from integration tests):
 *   import { backfillUniversalKg } from '@kanji-learn/db'
 *   await backfillUniversalKg(db)
 */

import { eq, sql } from 'drizzle-orm'
import { fileURLToPath } from 'node:url'
import {
  kanji,
  learnerIdentity,
  learnerKnowledgeState,
  learnerTimelineEvents,
  userKanjiProgress,
} from '../schema'
import type { Db } from '../client'

// Duplicate of apps/api/src/services/buddy/constants.ts MASTERY_BY_STATUS.
// Kept inline to avoid a cross-package dependency (db → api would be a cycle).
const MASTERY_BY_STATUS = {
  unseen: 0,
  learning: 0.25,
  reviewing: 0.6,
  remembered: 0.85,
  burned: 1.0,
} as const

type SrsStatus = keyof typeof MASTERY_BY_STATUS

export interface BackfillResult {
  identitiesInserted: number
  knowledgeRowsWritten: number
  timelineEventsInserted: number
}

/**
 * Walk every user_kanji_progress row and mirror it into the three UKG tables.
 * JOINs against the `kanji` table to construct the `kanji:<character>` subject
 * since user_kanji_progress stores only the integer FK, not the character.
 *
 * Counts:
 * - `identitiesInserted` — new learner_identity rows created (existing rows
 *   are left alone).
 * - `knowledgeRowsWritten` — rows upserted into learner_knowledge_state; this
 *   counts both inserts and updates, since Drizzle's `.returning()` surfaces
 *   every row affected by an onConflictDoUpdate.
 * - `timelineEventsInserted` — new legacy_import events created (one per
 *   user, deduped).
 */
export async function backfillUniversalKg(db: Db): Promise<BackfillResult> {
  const progressRows = await db
    .select({
      userId: userKanjiProgress.userId,
      status: userKanjiProgress.status,
      updatedAt: userKanjiProgress.updatedAt,
      character: kanji.character,
    })
    .from(userKanjiProgress)
    .innerJoin(kanji, eq(userKanjiProgress.kanjiId, kanji.id))

  const uniqueUsers = Array.from(new Set(progressRows.map((r) => r.userId)))

  // 1. learner_identity — one row per user, idempotent.
  let identitiesInserted = 0
  for (const userId of uniqueUsers) {
    const result = await db
      .insert(learnerIdentity)
      .values({ learnerId: userId })
      .onConflictDoNothing()
      .returning({ learnerId: learnerIdentity.learnerId })
    identitiesInserted += result.length
  }

  // 2. learner_knowledge_state — upsert one row per (user, kanji). Uses
  // onConflictDoUpdate so a re-run refreshes mastery_level / status to match
  // the current app-side state. review_count is NOT touched on conflict so
  // re-running the backfill doesn't double-count legacy activity.
  let knowledgeRowsWritten = 0
  for (const row of progressRows) {
    const subject = `kanji:${row.character}`
    const statusKey = row.status as SrsStatus | null
    const mastery =
      statusKey !== null && statusKey in MASTERY_BY_STATUS
        ? MASTERY_BY_STATUS[statusKey]
        : 0
    const statusForUkg = statusKey ?? 'unseen'
    const result = await db
      .insert(learnerKnowledgeState)
      .values({
        learnerId: row.userId,
        subject,
        masteryLevel: mastery,
        status: statusForUkg,
        reviewCount: 0, // unknown from legacy data — Phase 1 could derive from review_logs
        lastReviewedAt: row.updatedAt ?? null,
        appSource: 'kanji-learn-legacy',
      })
      .onConflictDoUpdate({
        target: [learnerKnowledgeState.learnerId, learnerKnowledgeState.subject],
        set: {
          masteryLevel: mastery,
          status: statusForUkg,
          lastReviewedAt: row.updatedAt ?? null,
          updatedAt: new Date(),
        },
      })
      .returning({ learnerId: learnerKnowledgeState.learnerId })
    knowledgeRowsWritten += result.length
  }

  // 3. learner_timeline_events — one "legacy_import" event per user. The
  // table has no unique constraint on (learner_id, event_type), so dedupe
  // explicitly with a SELECT probe.
  let timelineEventsInserted = 0
  for (const userId of uniqueUsers) {
    const existing = await db.execute(
      sql`SELECT 1 FROM learner_timeline_events
          WHERE learner_id = ${userId} AND event_type = 'legacy_import' LIMIT 1`
    )
    if (existing.length > 0) continue
    await db.insert(learnerTimelineEvents).values({
      learnerId: userId,
      eventType: 'legacy_import',
      subject: null,
      appSource: 'kanji-learn-legacy',
      payload: { source: 'backfill-universal-kg.ts', version: 1 },
    })
    timelineEventsInserted += 1
  }

  return { identitiesInserted, knowledgeRowsWritten, timelineEventsInserted }
}

// ─── CLI entry ───────────────────────────────────────────────────────────────
// ESM-safe self-execution check: fileURLToPath(import.meta.url) is the absolute
// path of this file, which equals process.argv[1] only when the file was
// invoked directly (not when it was `import`ed from a test).

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] === thisFile) {
  const run = async () => {
    const { db } = await import('../client')
    const result = await backfillUniversalKg(db)
    // eslint-disable-next-line no-console
    console.log('Backfill complete:', result)
    process.exit(0)
  }
  run().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Backfill failed:', err)
    process.exit(1)
  })
}
