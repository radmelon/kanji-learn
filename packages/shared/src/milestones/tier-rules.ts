import type { GradeTier, SrsBucketCounts } from './types';

const SILVER_REVIEWING_TOLERANCE_PCT = 0.02;

// Long-tail tolerance: allow up to max(1, 2% of level) cards still in `reviewing`
// to count toward silver. Keeps "learning must be 0" strict so cards being
// introduced don't qualify. Rationale: a single stuck reviewing card shouldn't
// silence recognition for a user at ~98%+ mastery of a level.
function silverReviewingTolerance(state: SrsBucketCounts): number {
  const total = state.learning + state.reviewing + state.remembered + state.burned;
  return Math.max(1, Math.floor(total * SILVER_REVIEWING_TOLERANCE_PCT));
}

export function gradeTierRule(state: SrsBucketCounts, tier: GradeTier): boolean {
  switch (tier) {
    case 'gold':
      return state.learning === 0 && state.reviewing === 0 && state.remembered === 0 && state.burned > 0;
    case 'silver':
      return state.learning === 0
        && state.reviewing <= silverReviewingTolerance(state)
        && (state.remembered + state.burned) > 0;
    case 'bronze':
      return state.learning === 0
        && state.remembered > state.reviewing
        && state.burned > state.remembered;
  }
}

export function jlptTierRule(state: SrsBucketCounts, tier: GradeTier): boolean {
  // JLPT has no Bronze tier.
  if (tier === 'bronze') return false;
  return gradeTierRule(state, tier);
}
