import {
  LADDERS,
  STREAK_LADDER_FINITE,
  streakThresholdsUpTo,
  JLPT_LEVELS,
  JLPT_TIERS_ORDER,
  jlptTierRule,
  GRADES,
  GRADE_TIERS_ORDER,
  gradeTierRule,
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

  // 3. JLPT — independent per-tier evaluation, gated N5 → N1
  let jlptUnlocked = true;
  for (const level of JLPT_LEVELS) {
    if (!jlptUnlocked) break;
    const state = input.perJlpt[level];
    for (const tier of JLPT_TIERS_ORDER) {
      if (jlptTierRule(state, tier)) {
        const already = existing.some(e =>
          e.type === 'jlpt_level' && e.payload?.level === level && e.payload?.tier === tier
        );
        if (!already) {
          proposed.push({ type: 'jlpt_level', threshold: tier, payload: { level, tier } });
        }
      }
    }
    jlptUnlocked = jlptTierRule(state, 'silver') || jlptTierRule(state, 'gold');
  }

  // 4. Grade-level — independent per-tier evaluation, gated 1 → 9
  let gradeUnlocked = true;
  for (const grade of GRADES) {
    if (!gradeUnlocked) break;
    const state = input.perGrade[grade];
    for (const tier of GRADE_TIERS_ORDER) {
      if (gradeTierRule(state, tier)) {
        const already = existing.some(e =>
          e.type === 'grade_level' && e.payload?.grade === grade && e.payload?.tier === tier
        );
        if (!already) {
          proposed.push({ type: 'grade_level', threshold: tier, payload: { grade, tier } });
        }
      }
    }
    gradeUnlocked = gradeTierRule(state, 'silver') || gradeTierRule(state, 'gold');
  }

  return proposed;
}
