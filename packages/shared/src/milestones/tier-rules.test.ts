import { describe, it, expect } from 'vitest';
import { gradeTierRule, jlptTierRule } from './tier-rules';

describe('gradeTierRule', () => {
  it('gold when all burned', () => {
    expect(gradeTierRule({ learning: 0, reviewing: 0, remembered: 0, burned: 5 }, 'gold')).toBe(true);
    expect(gradeTierRule({ learning: 0, reviewing: 0, remembered: 1, burned: 5 }, 'gold')).toBe(false);
    expect(gradeTierRule({ learning: 0, reviewing: 0, remembered: 0, burned: 0 }, 'gold')).toBe(false);
  });

  it('silver requires learning==0, (remembered+burned)>0, and reviewing within long-tail tolerance', () => {
    // Strict-clean: zero reviewing always silver-eligible.
    expect(gradeTierRule({ learning: 0, reviewing: 0, remembered: 3, burned: 2 }, 'silver')).toBe(true);
    // learning > 0 always blocks silver (cards being introduced aren't "done").
    expect(gradeTierRule({ learning: 1, reviewing: 0, remembered: 3, burned: 2 }, 'silver')).toBe(false);
  });

  it('silver tolerance: tiny levels allow 1 reviewing card (max(1, 2%) floor)', () => {
    // total=6, tolerance = max(1, floor(0.12)) = 1 → reviewing=1 allowed
    expect(gradeTierRule({ learning: 0, reviewing: 1, remembered: 3, burned: 2 }, 'silver')).toBe(true);
    // total=6, reviewing=2 exceeds tolerance → blocked
    expect(gradeTierRule({ learning: 0, reviewing: 2, remembered: 2, burned: 2 }, 'silver')).toBe(false);
  });

  it('silver tolerance scales: ~2% of total reviewing cards allowed', () => {
    // total=102, tolerance = max(1, floor(2.04)) = 2 → reviewing=2 allowed
    expect(gradeTierRule({ learning: 0, reviewing: 2, remembered: 50, burned: 50 }, 'silver')).toBe(true);
    // total=103, tolerance = max(1, floor(2.06)) = 2 → reviewing=3 blocked
    expect(gradeTierRule({ learning: 0, reviewing: 3, remembered: 50, burned: 50 }, 'silver')).toBe(false);
    // Real-world: Buddy's N5 — total=79, tolerance = max(1, floor(1.58)) = 1, reviewing=1 → silver
    expect(gradeTierRule({ learning: 0, reviewing: 1, remembered: 6, burned: 72 }, 'silver')).toBe(true);
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
