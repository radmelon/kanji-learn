import type { GradeTier, SrsBucketCounts } from './types';

export function gradeTierRule(state: SrsBucketCounts, tier: GradeTier): boolean {
  switch (tier) {
    case 'gold':
      return state.learning === 0 && state.reviewing === 0 && state.remembered === 0 && state.burned > 0;
    case 'silver':
      return state.learning === 0 && state.reviewing === 0 && (state.remembered + state.burned) > 0;
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
