import { describe, it, expect } from 'vitest';
import { selectActiveBadges, computeUpNext, formatAchievedAt, milestoneFocusFromReasons } from './selection';
import { GRANDFATHERED, type MilestoneEntry } from './types';

describe('selectActiveBadges', () => {
  it('applies replacement rule per numeric category — only highest threshold shown', () => {
    const entries: MilestoneEntry[] = [
      { type: 'kanji_seen', threshold: 10, achievedAt: '2026-04-01T00:00:00Z' },
      { type: 'kanji_seen', threshold: 50, achievedAt: '2026-04-15T00:00:00Z' },
      { type: 'kanji_seen', threshold: 100, achievedAt: '2026-05-01T00:00:00Z' },
    ];
    const { core } = selectActiveBadges(entries);
    expect(core.filter(c => c.type === 'kanji_seen')).toHaveLength(1);
    expect(core.find(c => c.type === 'kanji_seen')?.threshold).toBe(100);
  });

  it('grade cap = 3 most recent', () => {
    const entries: MilestoneEntry[] = [1, 2, 3, 4, 5].map(g => ({
      type: 'grade_level' as const,
      threshold: 'silver' as const,
      payload: { grade: g as 1|2|3|4|5, tier: 'silver' as const },
      achievedAt: `2026-0${g}-01T00:00:00Z`,
    }));
    const { grade } = selectActiveBadges(entries);
    expect(grade).toHaveLength(3);
    expect(grade.map(g => g.payload?.grade).sort()).toEqual([3, 4, 5]);
  });

  it('per-grade highest tier wins (bronze + silver recorded → silver shown)', () => {
    const entries: MilestoneEntry[] = [
      { type: 'grade_level', threshold: 'bronze', payload: { grade: 1, tier: 'bronze' }, achievedAt: '2026-04-01T00:00:00Z' },
      { type: 'grade_level', threshold: 'silver', payload: { grade: 1, tier: 'silver' }, achievedAt: '2026-05-01T00:00:00Z' },
    ];
    const { grade } = selectActiveBadges(entries);
    expect(grade).toHaveLength(1);
    expect(grade[0].payload?.tier).toBe('silver');
  });

  it('JLPT badge: highest tier within level, most-recent across levels', () => {
    const entries: MilestoneEntry[] = [
      { type: 'jlpt_level', threshold: 'silver', payload: { level: 'N5', tier: 'silver' }, achievedAt: '2025-12-01T00:00:00Z' },
      { type: 'jlpt_level', threshold: 'gold',   payload: { level: 'N5', tier: 'gold'   }, achievedAt: '2026-02-01T00:00:00Z' },
      { type: 'jlpt_level', threshold: 'silver', payload: { level: 'N4', tier: 'silver' }, achievedAt: '2026-05-20T00:00:00Z' },
    ];
    const { core } = selectActiveBadges(entries);
    const jlpt = core.find(c => c.type === 'jlpt_level');
    expect(jlpt?.payload?.level).toBe('N4');
    expect(jlpt?.payload?.tier).toBe('silver');
  });

  it('grandfathered entries sort to bottom; among grandfathered, grade-number desc', () => {
    const entries: MilestoneEntry[] = [1, 2, 3, 4, 5].map(g => ({
      type: 'grade_level' as const,
      threshold: 'silver' as const,
      payload: { grade: g as 1|2|3|4|5, tier: 'silver' as const },
      achievedAt: GRANDFATHERED,
    }));
    const { grade } = selectActiveBadges(entries);
    expect(grade.map(g => g.payload?.grade)).toEqual([5, 4, 3]); // frontier first
  });
});

describe('computeUpNext', () => {
  it('open-ended streak: 49-day → next is 56', () => {
    const upNext = computeUpNext({
      counts: { seen: 0, remembered: 0, burned: 0, streak: 49 },
      milestones: [],
      perGrade: {} as any,
      perJlpt: {} as any,
    });
    const streak = upNext.find(u => u.type === 'streak_days');
    expect(streak?.nextThreshold).toBe(56);
  });

  it('JLPT next tier: N5 Silver recorded → "N5 Gold" next, not N4', () => {
    const upNext = computeUpNext({
      counts: { seen: 0, remembered: 0, burned: 0, streak: 0 },
      milestones: [
        { type: 'jlpt_level', threshold: 'silver', payload: { level: 'N5', tier: 'silver' }, achievedAt: '2026-05-01T00:00:00Z' },
      ],
      perGrade: {} as any,
      perJlpt: {} as any,
    });
    const jlpt = upNext.find(u => u.type === 'jlpt_level');
    expect(jlpt?.payload?.level).toBe('N5');
    expect(jlpt?.payload?.tier).toBe('gold');
  });
});

describe('formatAchievedAt', () => {
  it('returns "Earned before this update" for the grandfathered sentinel', () => {
    expect(formatAchievedAt(GRANDFATHERED)).toBe('Earned before this update');
  });

  it('formats real ISO timestamps to a locale-style "Earned <date>" string', () => {
    const result = formatAchievedAt('2026-05-21T15:00:00Z');
    expect(result).toMatch(/^Earned /);
    expect(result).toMatch(/2026/);
  });
});

describe('milestoneFocusFromReasons', () => {
  it("returns 'jlpt' when reasons include JLPT exam", () => {
    expect(milestoneFocusFromReasons(['JLPT exam'])).toBe('jlpt');
  });

  it("returns 'jlpt' when reasons include Work / Business", () => {
    expect(milestoneFocusFromReasons(['Work / Business'])).toBe('jlpt');
  });

  it("returns 'grade' when reasons include Heritage", () => {
    expect(milestoneFocusFromReasons(['Heritage'])).toBe('grade');
  });

  it("returns 'grade' when reasons include Curiosity", () => {
    expect(milestoneFocusFromReasons(['Curiosity'])).toBe('grade');
  });

  it('JLPT wins ties when both groups are selected', () => {
    expect(milestoneFocusFromReasons(['Heritage', 'JLPT exam'])).toBe('jlpt');
    expect(milestoneFocusFromReasons(['Curiosity', 'Work / Business'])).toBe('jlpt');
  });

  it("defaults to 'jlpt' for empty or unrelated reasons", () => {
    expect(milestoneFocusFromReasons([])).toBe('jlpt');
    expect(milestoneFocusFromReasons(['Travel', 'Anime / Manga', 'Other'])).toBe('jlpt');
  });

  it('is tolerant of casing/whitespace variants', () => {
    expect(milestoneFocusFromReasons(['  jlpt exam '])).toBe('jlpt');
    expect(milestoneFocusFromReasons(['heritage'])).toBe('grade');
  });
});
