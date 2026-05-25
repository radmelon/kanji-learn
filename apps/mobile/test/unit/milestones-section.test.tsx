/**
 * Smoke tests for the MilestonesSection data-derivation path.
 *
 * The mobile test harness uses ts-jest with node env — no react-native preset,
 * no @testing-library/react-native. We test the shared helpers that MilestonesSection
 * delegates to, using the same mock data shape the component would receive from
 * useAnalytics. This covers the two semantic behaviours from the plan:
 *   1. Both badge categories are selected from recentMilestones.
 *   2. The date-sheet interaction is driven by a MilestoneEntry reference.
 */
import { selectActiveBadges, computeUpNext } from '@kanji-learn/shared';
import type { MilestoneEntry, SrsBucketCounts } from '@kanji-learn/shared';

const MOCK_SUMMARY = {
  totalSeen: 100,
  streakDays: 7,
  statusCounts: { unseen: 0, learning: 0, reviewing: 0, remembered: 12, burned: 0 },
  jlptProgress: { N5: { learning: 0, reviewing: 0, remembered: 0, burned: 0 } },
  perGradeBuckets: { 1: { learning: 0, reviewing: 0, remembered: 0, burned: 0 } },
  recentMilestones: [
    { type: 'kanji_seen', threshold: 100, achievedAt: '2026-05-01T00:00:00Z' },
    { type: 'streak_days', threshold: 7, achievedAt: '2026-05-20T00:00:00Z' },
  ] as MilestoneEntry[],
};

describe('MilestonesSection data derivation', () => {
  it('renders one badge per category (core + streak both active)', () => {
    const { core, grade } = selectActiveBadges(MOCK_SUMMARY.recentMilestones);
    // kanji_seen=100 and streak_days=7 are both core milestones
    expect(core).toHaveLength(2);
    expect(core.some((e) => e.type === 'kanji_seen')).toBe(true);
    expect(core.some((e) => e.type === 'streak_days')).toBe(true);
    // No grade_level entries in the mock → empty grade list
    expect(grade).toHaveLength(0);
  });

  it('tapped entry identity matches recentMilestones (date sheet source)', () => {
    // The MilestoneDateSheet receives `entry` directly from setTapped(badge).
    // Verify the entry the sheet would display has the expected achievedAt string.
    const { core } = selectActiveBadges(MOCK_SUMMARY.recentMilestones);
    const kanjiBadge = core.find((e) => e.type === 'kanji_seen')!;
    expect(kanjiBadge.achievedAt).toBe('2026-05-01T00:00:00Z');
  });

  it('computeUpNext produces suggestions when milestones not yet full', () => {
    const counts = {
      seen: MOCK_SUMMARY.totalSeen,
      remembered: MOCK_SUMMARY.statusCounts.remembered,
      burned: MOCK_SUMMARY.statusCounts.burned,
      streak: MOCK_SUMMARY.streakDays,
    };
    const perGrade = MOCK_SUMMARY.perGradeBuckets as unknown as Parameters<typeof computeUpNext>[0]['perGrade'];
    const perJlpt = MOCK_SUMMARY.jlptProgress as unknown as Parameters<typeof computeUpNext>[0]['perJlpt'];
    const upNext = computeUpNext({
      counts,
      milestones: MOCK_SUMMARY.recentMilestones,
      perGrade,
      perJlpt,
    });
    // With only 100 seen (of 2136) and 12 remembered, there should be remaining steps
    expect(Array.isArray(upNext)).toBe(true);
    expect(upNext.length).toBeGreaterThan(0);
  });
});
