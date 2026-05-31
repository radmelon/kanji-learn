import type { JlptLevel } from '../types';
import {
  type MilestoneEntry,
  type MilestoneType,
  type CurrentCounts,
  type SrsBucketCounts,
  type Grade,
  GRANDFATHERED,
} from './types';
import {
  LADDERS,
  JLPT_LEVELS,
  GRADES,
  GRADE_BADGE_DISPLAY_CAP,
  nextStreakThreshold,
} from './constants';
import { gradeTierRule, jlptTierRule } from './tier-rules';

const TIER_ORDER: Record<string, number> = { bronze: 0, silver: 1, gold: 2 };

// Defensive zero-bucket default: callers may pass partial perJlpt/perGrade maps
// (e.g. tests using `{} as any`); tier rules must not receive undefined state.
function zeroBucket(): SrsBucketCounts {
  return { learning: 0, reviewing: 0, remembered: 0, burned: 0 };
}

function isGrandfathered(e: MilestoneEntry): boolean {
  return e.achievedAt === GRANDFATHERED;
}

function recencyKey(e: MilestoneEntry): number {
  // Grandfathered sorts to bottom (use -Infinity)
  if (isGrandfathered(e)) return -Infinity;
  return new Date(e.achievedAt).getTime();
}

export type ActiveBadgesResult = {
  core: MilestoneEntry[];  // ordered most-recent-first within row
  grade: MilestoneEntry[]; // capped to GRADE_BADGE_DISPLAY_CAP
};

export function selectActiveBadges(entries: MilestoneEntry[]): ActiveBadgesResult {
  // ── Numeric categories: highest threshold per category ──
  const numericTypes: MilestoneType[] = ['kanji_seen', 'kanji_remembered', 'kanji_burned', 'streak_days'];
  const core: MilestoneEntry[] = [];

  for (const t of numericTypes) {
    const cat = entries.filter(e => e.type === t);
    if (cat.length === 0) continue;
    const best = cat.reduce((a, b) => (a.threshold as number) >= (b.threshold as number) ? a : b);
    core.push(best);
  }

  // ── JLPT: highest tier per level, then most-recent across levels ──
  const perLevelBest = new Map<JlptLevel, MilestoneEntry>();
  for (const e of entries) {
    if (e.type !== 'jlpt_level' || !e.payload?.level || !e.payload?.tier) continue;
    const existing = perLevelBest.get(e.payload.level);
    if (!existing || TIER_ORDER[e.payload.tier] > TIER_ORDER[existing.payload!.tier!]) {
      perLevelBest.set(e.payload.level, e);
    }
  }
  if (perLevelBest.size > 0) {
    const sorted = [...perLevelBest.values()].sort((a, b) => recencyKey(b) - recencyKey(a));
    core.push(sorted[0]);
  }

  // Sort core row by recency, grandfathered to bottom
  core.sort((a, b) => recencyKey(b) - recencyKey(a));

  // ── Grade-level: highest tier per grade, top N by recency ──
  const perGradeBest = new Map<Grade, MilestoneEntry>();
  for (const e of entries) {
    if (e.type !== 'grade_level' || !e.payload?.grade || !e.payload?.tier) continue;
    const existing = perGradeBest.get(e.payload.grade);
    if (!existing || TIER_ORDER[e.payload.tier] > TIER_ORDER[existing.payload!.tier!]) {
      perGradeBest.set(e.payload.grade, e);
    }
  }
  const gradeSorted = [...perGradeBest.values()].sort((a, b) => {
    const ar = recencyKey(a);
    const br = recencyKey(b);
    if (ar !== br) return br - ar;
    // Tiebreaker: grade number desc (frontier first)
    return (b.payload?.grade ?? 0) - (a.payload?.grade ?? 0);
  });
  const grade = gradeSorted.slice(0, GRADE_BADGE_DISPLAY_CAP);

  return { core, grade };
}

export type UpNextEntry = {
  type: MilestoneType;
  nextThreshold: number | 'silver' | 'gold' | 'bronze';
  current?: number;
  target?: number;
  payload?: MilestoneEntry['payload'];
};

export type UpNextInput = {
  counts: CurrentCounts;
  milestones: MilestoneEntry[];
  perGrade: Record<Grade, SrsBucketCounts>;
  perJlpt: Record<JlptLevel, SrsBucketCounts>;
};

function jlptAlreadyEarned(milestones: MilestoneEntry[], level: JlptLevel, tier: 'silver' | 'gold'): boolean {
  return milestones.some(e => e.type === 'jlpt_level' && e.payload?.level === level && e.payload?.tier === tier);
}

function gradeAlreadyEarned(milestones: MilestoneEntry[], grade: Grade, tier: 'bronze' | 'silver' | 'gold'): boolean {
  return milestones.some(e => e.type === 'grade_level' && e.payload?.grade === grade && e.payload?.tier === tier);
}

export function computeUpNext(input: UpNextInput): UpNextEntry[] {
  const out: UpNextEntry[] = [];

  // Numeric ladders
  const numericConfigs = [
    { type: 'kanji_seen' as const, current: input.counts.seen, ladder: LADDERS.kanji_seen },
    { type: 'kanji_remembered' as const, current: input.counts.remembered, ladder: LADDERS.kanji_remembered },
    { type: 'kanji_burned' as const, current: input.counts.burned, ladder: LADDERS.kanji_burned },
  ];
  for (const cfg of numericConfigs) {
    const next = cfg.ladder.find(t => t > cfg.current);
    if (next != null) {
      out.push({ type: cfg.type, nextThreshold: next, current: cfg.current, target: next });
    }
  }
  // Streak — always has a next entry
  const nextStreak = nextStreakThreshold(input.counts.streak);
  out.push({ type: 'streak_days', nextThreshold: nextStreak, current: input.counts.streak, target: nextStreak });

  // JLPT — next ungated tier. Default missing state to zero bucket so callers
  // that pass partial perJlpt maps don't crash the rule evaluation. Consult the
  // milestones array so already-earned tiers are not re-surfaced as "up next".
  for (const level of JLPT_LEVELS) {
    // Defensive default: missing state treated as all-zero (no progress yet).
    const state = input.perJlpt[level] ?? zeroBucket();
    const hasSilver = jlptAlreadyEarned(input.milestones, level, 'silver') || jlptTierRule(state, 'silver');
    const hasGold = jlptAlreadyEarned(input.milestones, level, 'gold') || jlptTierRule(state, 'gold');
    if (!hasSilver) {
      out.push({ type: 'jlpt_level', nextThreshold: 'silver', payload: { level, tier: 'silver' } });
      break;
    } else if (!hasGold) {
      out.push({ type: 'jlpt_level', nextThreshold: 'gold', payload: { level, tier: 'gold' } });
      break;
    }
    // Both tiers earned for this level — advance to next level.
  }

  // Grade-level — next ungated tier (same defensive default + milestones check).
  for (const grade of GRADES) {
    // Defensive default: missing state treated as all-zero (no progress yet).
    const state = input.perGrade[grade] ?? zeroBucket();
    const hasBronze = gradeAlreadyEarned(input.milestones, grade, 'bronze') || gradeTierRule(state, 'bronze');
    const hasSilver = gradeAlreadyEarned(input.milestones, grade, 'silver') || gradeTierRule(state, 'silver');
    const hasGold = gradeAlreadyEarned(input.milestones, grade, 'gold') || gradeTierRule(state, 'gold');
    if (!hasBronze) {
      out.push({ type: 'grade_level', nextThreshold: 'bronze', payload: { grade, tier: 'bronze' } });
      break;
    } else if (!hasSilver) {
      out.push({ type: 'grade_level', nextThreshold: 'silver', payload: { grade, tier: 'silver' } });
      break;
    } else if (!hasGold) {
      out.push({ type: 'grade_level', nextThreshold: 'gold', payload: { grade, tier: 'gold' } });
      break;
    }
    // All tiers earned for this grade — advance to next grade.
  }

  return out;
}

/**
 * Which milestone family leads the badge display, derived from the learner's
 * onboarding "reasons for learning" (free-ish chips: 'JLPT exam',
 * 'Work / Business', 'Heritage', 'Curiosity', etc.).
 *
 * - reasons touching JLPT or work/business → 'jlpt' (lead with the JLPT badge)
 * - else reasons touching heritage or curiosity → 'grade' (lead with grade badges)
 * - JLPT wins ties (checked first); empty/unrelated defaults to 'jlpt'.
 *
 * Matching is case- and whitespace-insensitive substring so minor chip-label
 * drift doesn't silently flip behavior.
 */
export type MilestoneFocus = 'jlpt' | 'grade';

export function milestoneFocusFromReasons(reasons: string[]): MilestoneFocus {
  const norm = (reasons ?? []).map(r => r.toLowerCase().trim());
  const has = (needles: string[]) => norm.some(r => needles.some(n => r.includes(n)));

  // JLPT checked first so it wins when both groups are present.
  if (has(['jlpt', 'work', 'business'])) return 'jlpt';
  if (has(['heritage', 'curiosity'])) return 'grade';
  return 'jlpt';
}

export function formatAchievedAt(achievedAt: string): string {
  if (achievedAt === GRANDFATHERED) return 'Earned before this update';
  const d = new Date(achievedAt);
  return `Earned ${d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`;
}
