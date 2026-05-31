import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  selectActiveBadges,
  computeUpNext,
  milestoneFocusFromReasons,
  type MilestoneEntry,
} from '../../constants/milestones';
import { CoreBadgesRow } from './CoreBadgesRow';
import { GradeBadgesRow } from './GradeBadgesRow';
import { UpNextList } from './UpNextList';
import { MilestoneDateSheet } from './MilestoneDateSheet';
import { useAnalytics } from '../../hooks/useAnalytics';
import { useLearnerProfile } from '../../hooks/useLearnerProfile';
import { colors } from '../../theme';

export function MilestonesSection() {
  const { summary } = useAnalytics();
  const { learnerProfile } = useLearnerProfile();
  const [tapped, setTapped] = useState<MilestoneEntry | null>(null);

  // Render as soon as we have a summary — useAnalytics paints cached data
  // immediately, so gating on isLoading would blank the panel until the
  // (slow, cross-region) fetch returns. Cached badges show instantly; fresh
  // data swaps in silently. (B-206)
  if (!summary) return null;

  const recentMilestones = summary.recentMilestones ?? [];
  const counts = {
    seen: summary.totalSeen ?? 0,
    remembered: summary.statusCounts?.remembered ?? 0,
    burned: summary.statusCounts?.burned ?? 0,
    streak: summary.streakDays ?? 0,
  };
  // jlptProgress is keyed by 'N5'|'N4'|...; cast to the typed shape for the shared helper.
  const perJlpt = (summary.jlptProgress ?? {}) as Parameters<typeof computeUpNext>[0]['perJlpt'];
  const perGrade = (summary.perGradeBuckets ?? {}) as Parameters<typeof computeUpNext>[0]['perGrade'];

  const { core, grade } = selectActiveBadges(recentMilestones);
  const upNext = computeUpNext({ counts, milestones: recentMilestones, perGrade, perJlpt });

  const isEmpty = core.length === 0 && grade.length === 0;

  // Lead with the badge family that matches the learner's onboarding focus:
  // JLPT/Work-Business learners see the JLPT (core) row first; Heritage/Curiosity
  // learners see the grade row first. JLPT wins ties; default JLPT. (B-207)
  const focus = milestoneFocusFromReasons(learnerProfile?.reasonsForLearning ?? []);
  const coreRow = <CoreBadgesRow badges={core} onBadgePress={setTapped} />;
  const gradeRow = <GradeBadgesRow badges={grade} onBadgePress={setTapped} />;

  return (
    <View style={{ gap: 20 }}>
      {isEmpty ? (
        <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
          Your first milestone awaits — start studying to earn your first badge.
        </Text>
      ) : focus === 'grade' ? (
        <>
          {gradeRow}
          {coreRow}
        </>
      ) : (
        <>
          {coreRow}
          {gradeRow}
        </>
      )}
      <UpNextList entries={upNext} />
      <MilestoneDateSheet entry={tapped} onClose={() => setTapped(null)} />
    </View>
  );
}
