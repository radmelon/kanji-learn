import { describe, it, expect } from 'vitest';
import { detectCrossings } from '../../src/services/milestones/detector';
import type { MilestoneEntry } from '@kanji-learn/shared';

const emptyGrades = { 1: zero(), 2: zero(), 3: zero(), 4: zero(), 5: zero(), 6: zero(), 7: zero(), 8: zero(), 9: zero() };
const emptyJlpt = { N5: zero(), N4: zero(), N3: zero(), N2: zero(), N1: zero() };
function zero() { return { learning: 0, reviewing: 0, remembered: 0, burned: 0 }; }

describe('detectCrossings — numeric ladders', () => {
  it('emits single crossing for kanji_seen at 12', () => {
    const result = detectCrossings({
      counts: { seen: 12, remembered: 0, burned: 0, streak: 0 },
      perGrade: emptyGrades,
      perJlpt: emptyJlpt,
      existing: [],
    });
    expect(result).toEqual([{ type: 'kanji_seen', threshold: 10 }]);
  });

  it('emits multiple crossings up to current count in one pass', () => {
    const result = detectCrossings({
      counts: { seen: 300, remembered: 0, burned: 0, streak: 0 },
      perGrade: emptyGrades,
      perJlpt: emptyJlpt,
      existing: [],
    });
    expect(result.map(r => r.threshold)).toEqual([10, 50, 100, 250]);
    expect(result.every(r => r.type === 'kanji_seen')).toBe(true);
  });

  it('is idempotent — second call on same state with existing emits nothing', () => {
    const existing: MilestoneEntry[] = [
      { type: 'kanji_seen', threshold: 10, achievedAt: '2026-05-01T00:00:00Z' },
    ];
    const result = detectCrossings({
      counts: { seen: 12, remembered: 0, burned: 0, streak: 0 },
      perGrade: emptyGrades,
      perJlpt: emptyJlpt,
      existing,
    });
    expect(result).toEqual([]);
  });

  it('does not revoke on count drop (sticky on the way up)', () => {
    const existing: MilestoneEntry[] = [
      { type: 'kanji_seen', threshold: 10, achievedAt: '2026-05-01T00:00:00Z' },
      { type: 'kanji_seen', threshold: 50, achievedAt: '2026-05-10T00:00:00Z' },
    ];
    const result = detectCrossings({
      counts: { seen: 30, remembered: 0, burned: 0, streak: 0 }, // dropped below 50
      perGrade: emptyGrades,
      perJlpt: emptyJlpt,
      existing,
    });
    expect(result).toEqual([]);
  });

  it('streak ladder extends past 49', () => {
    const result = detectCrossings({
      counts: { seen: 0, remembered: 0, burned: 0, streak: 56 },
      perGrade: emptyGrades,
      perJlpt: emptyJlpt,
      existing: [],
    });
    expect(result.find(r => r.type === 'streak_days' && r.threshold === 56)).toBeDefined();
    expect(result.find(r => r.type === 'streak_days' && r.threshold === 49)).toBeDefined();
    expect(result.find(r => r.type === 'streak_days' && r.threshold === 63)).toBeUndefined();
  });
});
