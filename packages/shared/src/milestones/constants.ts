import type { JlptLevel } from '../types';
import type { Grade } from './types';

export const COUNT_LADDER = [10, 50, 100, 250, 500, 750, 1000, 1250, 1500, 2000] as const;
export const STREAK_LADDER_FINITE = [3, 7, 10, 14, 21, 28, 35, 42, 49] as const;

// Streak is open-ended after 49 (+7 forever). Helper resolves any reachable threshold.
export function streakThresholdsUpTo(currentDays: number): number[] {
  const out: number[] = [];
  for (const t of STREAK_LADDER_FINITE) {
    if (t <= currentDays) out.push(t);
  }
  // Open-ended tail: 56, 63, 70, ...
  let next = 56;
  while (next <= currentDays) {
    out.push(next);
    next += 7;
  }
  return out;
}

export function nextStreakThreshold(currentDays: number): number {
  for (const t of STREAK_LADDER_FINITE) {
    if (t > currentDays) return t;
  }
  // Open-ended past 49: next multiple-of-7 strictly greater than currentDays
  return currentDays - ((currentDays - 49) % 7) + 7;
}

export const LADDERS = {
  kanji_seen: COUNT_LADDER,
  kanji_remembered: COUNT_LADDER,
  kanji_burned: COUNT_LADDER,
} as const;

export const JLPT_LEVELS: readonly JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1'] as const;
export const GRADES: readonly Grade[] = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const GRADE_TIERS_ORDER = ['bronze', 'silver', 'gold'] as const;
export const JLPT_TIERS_ORDER = ['silver', 'gold'] as const;

export const GRADE_BADGE_DISPLAY_CAP = 3;
