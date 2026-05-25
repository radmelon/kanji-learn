export {
  selectActiveBadges,
  computeUpNext,
  formatAchievedAt,
  LADDERS,
  GRADE_BADGE_DISPLAY_CAP,
  nextStreakThreshold,
} from '@kanji-learn/shared';

export type {
  MilestoneEntry,
  MilestoneType,
  GradeTier,
  JlptLevel,
  Grade,
  UpNextEntry,
} from '@kanji-learn/shared';

// Mobile-specific display metadata for each category (icons + labels).
// Reads cleanly in the components; keep the data shape close to render needs.
export const CATEGORY_DISPLAY = {
  kanji_seen:       { emoji: '👀', label: 'kanji seen' },
  kanji_remembered: { emoji: '🧠', label: 'kanji remembered' },
  kanji_burned:     { emoji: '🔥', label: 'kanji burned' },
  streak_days:      { emoji: '📅', label: 'day streak' },
  jlpt_level:       { emoji: '🎓', label: 'JLPT' },
  grade_level:      { emoji: '🏅', label: 'grade' },
} as const;
