// JlptLevel is defined in ../types and re-exported from the package root.
// Import here for local use only — do not re-export (avoids duplicate-export collision).
import type { JlptLevel } from '../types';

export type GradeTier = 'bronze' | 'silver' | 'gold';
export type Grade = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type MilestoneType =
  | 'kanji_seen'
  | 'kanji_remembered'
  | 'kanji_burned'
  | 'streak_days'
  | 'jlpt_level'
  | 'grade_level';

export type MilestonePayload = {
  level?: JlptLevel;
  grade?: Grade;
  tier?: GradeTier;
};

export type MilestoneLocation = {
  lat: number;
  lon: number;
  accuracy?: number;
};

export type MilestoneEntry = {
  type: MilestoneType;
  threshold: number | GradeTier;
  payload?: MilestonePayload;
  achievedAt: string; // ISO timestamp OR sentinel "grandfathered"
  location?: MilestoneLocation;
};

export type SrsBucketCounts = {
  learning: number;
  reviewing: number;
  remembered: number;
  burned: number;
};

export type CurrentCounts = {
  seen: number;
  remembered: number;
  burned: number;
  streak: number;
};

export const GRANDFATHERED = 'grandfathered' as const;
