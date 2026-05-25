// apps/api/test/integration/milestones-queries.test.ts
//
// Task 8 — integration tests for computePerGradeBuckets and computePerJlptBuckets.
// Seeds its own kanji rows to avoid depending on whatever is already in the test DB.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import * as schema from '@kanji-learn/db';
import {
  computePerGradeBuckets,
  computePerJlptBuckets,
} from '../../src/services/milestones/queries';

const client = postgres(process.env.TEST_DATABASE_URL!);
const db = drizzle(client, { schema });

const TEST_USER_ID = '00000000-0000-0000-0000-0000000000b1';

// IDs we get back after inserting kanji (captures returned ids)
let kanjiIds: number[] = [];

beforeAll(async () => {
  // Ensure the test user profile exists
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES (${TEST_USER_ID}, 'MilestonesQueriesTest', 'UTC')
    ON CONFLICT DO NOTHING
  `);

  // Seed 6 kanji specifically for this test:
  //   3 with grade=1, jlpt_level=N5
  //   1 with grade=2, jlpt_level=N4
  //   2 with grade=null, jlpt_level=N3 (exercises null-grade branch)
  //
  // Use ON CONFLICT DO NOTHING + high jlpt_order values to avoid clashes.
  // We use characters unlikely to collide with seed data; capture IDs from RETURNING.

  const seedRows = await db.execute(sql`
    INSERT INTO kanji (character, jlpt_level, jlpt_order, stroke_count, grade)
    VALUES
      ('㊀', 'N5', 99001, 3, 1),
      ('㊁', 'N5', 99002, 3, 1),
      ('㊂', 'N5', 99003, 3, 1),
      ('㊃', 'N4', 99004, 4, 2),
      ('㊄', 'N3', 99005, 5, null),
      ('㊅', 'N3', 99006, 5, null)
    ON CONFLICT (character) DO UPDATE SET jlpt_order = EXCLUDED.jlpt_order
    RETURNING id
  `);

  kanjiIds = (seedRows as unknown as { id: number }[]).map((r) => r.id);
});

beforeEach(async () => {
  // Clear this test user's progress before each test for isolation
  await db.execute(sql`
    DELETE FROM user_kanji_progress WHERE user_id = ${TEST_USER_ID}
  `);
});

afterAll(async () => {
  // Clean up seeded progress and kanji
  await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${TEST_USER_ID}`);
  await db.execute(sql`
    DELETE FROM kanji WHERE character IN ('㊀','㊁','㊂','㊃','㊄','㊅')
  `);
  await client.end();
});

// ─── Helper to insert a progress row ─────────────────────────────────────────

async function insertProgress(kanjiId: number, status: string) {
  await db.execute(sql`
    INSERT INTO user_kanji_progress (user_id, kanji_id, status, reading_stage, stability, difficulty, lapses, total_reviews)
    VALUES (${TEST_USER_ID}, ${kanjiId}, ${status}::srs_status, 0, 0, 5, 0, 0)
    ON CONFLICT (user_id, kanji_id) DO UPDATE SET status = EXCLUDED.status
  `);
}

// ─── computePerGradeBuckets ───────────────────────────────────────────────────

describe('computePerGradeBuckets', () => {
  it('returns SrsBucketCounts per grade 1..9 with zeros for grades without progress', async () => {
    // Insert 3 grade-1 kanji with distinct statuses
    await insertProgress(kanjiIds[0], 'learning');
    await insertProgress(kanjiIds[1], 'reviewing');
    await insertProgress(kanjiIds[2], 'remembered');
    // grade-2 kanji
    await insertProgress(kanjiIds[3], 'burned');
    // null-grade kanji — should be skipped in grade buckets
    await insertProgress(kanjiIds[4], 'learning');
    await insertProgress(kanjiIds[5], 'reviewing');

    const result = await computePerGradeBuckets(db, TEST_USER_ID);

    // Grade 1 should reflect 1 learning, 1 reviewing, 1 remembered
    expect(result[1]).toEqual({ learning: 1, reviewing: 1, remembered: 1, burned: 0 });

    // Grade 2 should reflect 1 burned
    expect(result[2]).toEqual({ learning: 0, reviewing: 0, remembered: 0, burned: 1 });

    // Grade 9 has no data — all zeros
    expect(result[9]).toEqual({ learning: 0, reviewing: 0, remembered: 0, burned: 0 });

    // All grade keys (1-9) must be present
    const keys = Object.keys(result).map(Number).sort((a, b) => a - b);
    expect(keys).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('drops unseen rows from the aggregation', async () => {
    // 2 grade-1 kanji with trackable statuses, 1 with unseen
    await insertProgress(kanjiIds[0], 'learning');
    await insertProgress(kanjiIds[1], 'remembered');
    await insertProgress(kanjiIds[2], 'unseen'); // should not appear in output

    const result = await computePerGradeBuckets(db, TEST_USER_ID);

    // Only 1 learning + 1 remembered — unseen not counted
    expect(result[1]).toEqual({ learning: 1, reviewing: 0, remembered: 1, burned: 0 });

    // Total across all grades is 2, not 3
    const total = Object.values(result).reduce(
      (sum, b) => sum + b.learning + b.reviewing + b.remembered + b.burned,
      0,
    );
    expect(total).toBe(2);
  });
});

// ─── computePerJlptBuckets ────────────────────────────────────────────────────

describe('computePerJlptBuckets', () => {
  it('returns SrsBucketCounts per N5..N1', async () => {
    // 3 N5 kanji (grade=1)
    await insertProgress(kanjiIds[0], 'learning');
    await insertProgress(kanjiIds[1], 'reviewing');
    await insertProgress(kanjiIds[2], 'burned');
    // 1 N4 kanji (grade=2)
    await insertProgress(kanjiIds[3], 'remembered');
    // 2 N3 kanji (grade=null)
    await insertProgress(kanjiIds[4], 'learning');
    await insertProgress(kanjiIds[5], 'reviewing');

    const result = await computePerJlptBuckets(db, TEST_USER_ID);

    // All five JLPT keys must be present
    expect(Object.keys(result).sort()).toEqual(['N1', 'N2', 'N3', 'N4', 'N5']);

    // N5: 1 learning, 1 reviewing, 0 remembered, 1 burned
    expect(result.N5).toEqual({ learning: 1, reviewing: 1, remembered: 0, burned: 1 });

    // N4: 0 learning, 0 reviewing, 1 remembered, 0 burned
    expect(result.N4).toEqual({ learning: 0, reviewing: 0, remembered: 1, burned: 0 });

    // N3: 1 learning, 1 reviewing (null-grade kanji — JLPT level still present)
    expect(result.N3).toEqual({ learning: 1, reviewing: 1, remembered: 0, burned: 0 });

    // N1 and N2 have no data
    expect(result.N1).toEqual({ learning: 0, reviewing: 0, remembered: 0, burned: 0 });
    expect(result.N2).toEqual({ learning: 0, reviewing: 0, remembered: 0, burned: 0 });
  });
});
