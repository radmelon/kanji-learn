import { userKanjiProgress, kanji } from '@kanji-learn/db';
import type { Db } from '@kanji-learn/db';
import { sql, eq } from 'drizzle-orm';
import {
  GRADES,
  JLPT_LEVELS,
  type SrsBucketCounts,
  type Grade,
  type JlptLevel,
} from '@kanji-learn/shared';

function zero(): SrsBucketCounts {
  return { learning: 0, reviewing: 0, remembered: 0, burned: 0 };
}

export async function computePerGradeBuckets(
  db: Db,
  userId: string,
): Promise<Record<Grade, SrsBucketCounts>> {
  const rows = await db
    .select({
      grade: kanji.grade,
      status: userKanjiProgress.status,
      count: sql<number>`count(*)::int`,
    })
    .from(userKanjiProgress)
    .innerJoin(kanji, eq(userKanjiProgress.kanjiId, kanji.id))
    .where(eq(userKanjiProgress.userId, userId))
    .groupBy(kanji.grade, userKanjiProgress.status);

  const out = Object.fromEntries(
    GRADES.map((g) => [g, zero()]),
  ) as Record<Grade, SrsBucketCounts>;

  for (const r of rows) {
    if (r.grade == null) continue;
    const g = r.grade as Grade;
    if (!(g in out)) continue;
    if (
      r.status === 'learning' ||
      r.status === 'reviewing' ||
      r.status === 'remembered' ||
      r.status === 'burned'
    ) {
      out[g][r.status] += r.count;
    }
  }

  return out;
}

export async function computePerJlptBuckets(
  db: Db,
  userId: string,
): Promise<Record<JlptLevel, SrsBucketCounts>> {
  const rows = await db
    .select({
      level: kanji.jlptLevel,
      status: userKanjiProgress.status,
      count: sql<number>`count(*)::int`,
    })
    .from(userKanjiProgress)
    .innerJoin(kanji, eq(userKanjiProgress.kanjiId, kanji.id))
    .where(eq(userKanjiProgress.userId, userId))
    .groupBy(kanji.jlptLevel, userKanjiProgress.status);

  const out = Object.fromEntries(
    JLPT_LEVELS.map((l) => [l, zero()]),
  ) as Record<JlptLevel, SrsBucketCounts>;

  for (const r of rows) {
    if (r.level == null) continue;
    const lvl = r.level as JlptLevel;
    if (!(lvl in out)) continue;
    if (
      r.status === 'learning' ||
      r.status === 'reviewing' ||
      r.status === 'remembered' ||
      r.status === 'burned'
    ) {
      out[lvl][r.status] += r.count;
    }
  }

  return out;
}
