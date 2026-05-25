import {
  LADDERS,
  STREAK_LADDER_FINITE,
  streakThresholdsUpTo,
  type MilestoneEntry,
  type CurrentCounts,
  type SrsBucketCounts,
  type JlptLevel,
  type Grade,
} from '@kanji-learn/shared';

export type DetectorInput = {
  counts: CurrentCounts;
  perGrade: Record<Grade, SrsBucketCounts>;
  perJlpt: Record<JlptLevel, SrsBucketCounts>;
  existing: MilestoneEntry[];
};

/** Returns proposed milestone entries WITHOUT achievedAt — caller assigns. */
export type ProposedMilestone = Omit<MilestoneEntry, 'achievedAt' | 'location'>;

export function detectCrossings(input: DetectorInput): ProposedMilestone[] {
  const proposed: ProposedMilestone[] = [];
  const existing = input.existing;

  // 1. Numeric count ladders
  for (const [type, ladder] of [
    ['kanji_seen', LADDERS.kanji_seen] as const,
    ['kanji_remembered', LADDERS.kanji_remembered] as const,
    ['kanji_burned', LADDERS.kanji_burned] as const,
  ]) {
    const current = type === 'kanji_seen' ? input.counts.seen
      : type === 'kanji_remembered' ? input.counts.remembered
      : input.counts.burned;
    for (const threshold of ladder) {
      if (threshold > current) break;
      if (!existing.some(e => e.type === type && e.threshold === threshold)) {
        proposed.push({ type, threshold });
      }
    }
  }

  // 2. Streak (open-ended)
  for (const threshold of streakThresholdsUpTo(input.counts.streak)) {
    if (!existing.some(e => e.type === 'streak_days' && e.threshold === threshold)) {
      proposed.push({ type: 'streak_days', threshold });
    }
  }

  // JLPT + Grade-level are added in Tasks 6 and 7.

  return proposed;
}
