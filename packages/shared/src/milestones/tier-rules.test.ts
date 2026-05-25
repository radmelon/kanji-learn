import { describe, it, expect } from 'vitest';
import { gradeTierRule, jlptTierRule } from './tier-rules';

describe('gradeTierRule', () => {
  it('gold when all burned', () => {
    expect(gradeTierRule({ learning: 0, reviewing: 0, remembered: 0, burned: 5 }, 'gold')).toBe(true);
    expect(gradeTierRule({ learning: 0, reviewing: 0, remembered: 1, burned: 5 }, 'gold')).toBe(false);
    expect(gradeTierRule({ learning: 0, reviewing: 0, remembered: 0, burned: 0 }, 'gold')).toBe(false);
  });

  it('silver when learning + reviewing == 0 and (remembered + burned) > 0', () => {
    expect(gradeTierRule({ learning: 0, reviewing: 0, remembered: 3, burned: 2 }, 'silver')).toBe(true);
    expect(gradeTierRule({ learning: 0, reviewing: 1, remembered: 3, burned: 2 }, 'silver')).toBe(false);
    expect(gradeTierRule({ learning: 1, reviewing: 0, remembered: 3, burned: 2 }, 'silver')).toBe(false);
  });

  it('bronze requires learning==0 AND remembered>reviewing AND burned>remembered', () => {
    // burned > remembered > reviewing > 0, learning==0
    expect(gradeTierRule({ learning: 0, reviewing: 2, remembered: 5, burned: 10 }, 'bronze')).toBe(true);
    // fails: burned not > remembered
    expect(gradeTierRule({ learning: 0, reviewing: 2, remembered: 5, burned: 5 }, 'bronze')).toBe(false);
    // fails: remembered not > reviewing
    expect(gradeTierRule({ learning: 0, reviewing: 5, remembered: 3, burned: 10 }, 'bronze')).toBe(false);
    // fails: learning > 0
    expect(gradeTierRule({ learning: 1, reviewing: 2, remembered: 5, burned: 10 }, 'bronze')).toBe(false);
  });

  it('Silver-eligible state with little burned does NOT meet Bronze (independent eval)', () => {
    const state = { learning: 0, reviewing: 0, remembered: 8, burned: 2 };
    expect(gradeTierRule(state, 'silver')).toBe(true);
    expect(gradeTierRule(state, 'bronze')).toBe(false); // burned (2) NOT > remembered (8)
  });
});

describe('jlptTierRule', () => {
  it('has no bronze rule (always false)', () => {
    expect(jlptTierRule({ learning: 0, reviewing: 2, remembered: 5, burned: 10 }, 'bronze')).toBe(false);
  });

  it('silver and gold match grade rules', () => {
    expect(jlptTierRule({ learning: 0, reviewing: 0, remembered: 3, burned: 0 }, 'silver')).toBe(true);
    expect(jlptTierRule({ learning: 0, reviewing: 0, remembered: 0, burned: 7 }, 'gold')).toBe(true);
    expect(jlptTierRule({ learning: 0, reviewing: 0, remembered: 3, burned: 0 }, 'gold')).toBe(false);
  });
});
