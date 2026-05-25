# Milestones Panel Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cumulative Milestones panel with a replacement-rule + tiered grade-level + Up Next design, backed by server-side detection on the post-review refresh hook, with optional location capture plumbing.

**Architecture:** Shared types/constants/rules in `@kanji-learn/shared`. Server detects threshold crossings inside `LearnerStateService.refreshState` and persists to `learner_state_cache.recentMilestones`. Mobile reads that array, applies replacement rule + grade cap + sort at render, and computes Up Next from live counts. Location is captured opt-in mobile-side on the review-submit request and threaded server-side onto newly created milestone entries.

**Tech Stack:** TypeScript everywhere, Drizzle ORM, Vitest (shared + api), Jest (mobile), Expo (mobile), Zod (api request validation), expo-location (already a dependency).

**Spec reference:** [docs/superpowers/specs/2026-05-25-milestones-panel-rework-design.md](../specs/2026-05-25-milestones-panel-rework-design.md) (commits 12f1a50, f5ebba3)

---

## Pre-flight notes

**Test commands per package:**
- `packages/shared`: `npm test --workspace=@kanji-learn/shared` (or `cd packages/shared && npm test`)
- `apps/api`: `cd apps/api && npm test` (Vitest)
- `apps/mobile`: `cd apps/mobile && npm test` (Jest)

**Commit message footer (required on every commit in this repo):**
```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
```

**Key paths discovered during planning:**
- `LearnerStateService`: [apps/api/src/services/buddy/learner-state.service.ts](../../../apps/api/src/services/buddy/learner-state.service.ts) — method `refreshState(userId)`
- Called from: [apps/api/src/services/srs.service.ts](../../../apps/api/src/services/srs.service.ts) via `setImmediate` post-submitReview
- `recentMilestones` column already exists at [packages/db/src/schema.ts:531](../../../packages/db/src/schema.ts:531)
- User SRS table: `user_kanji_progress` at [packages/db/src/schema.ts:180](../../../packages/db/src/schema.ts:180) — `created_at` column distinguishes pre-deploy users
- Kanji grade column: [packages/db/src/schema.ts:128](../../../packages/db/src/schema.ts:128) (no index yet — Task 4 adds one)
- Mobile inline `MilestonesSection`: [apps/mobile/app/(tabs)/progress.tsx](../../../apps/mobile/app/(tabs)/progress.tsx) line 515
- Mobile review submit: [apps/mobile/src/stores/review.store.ts](../../../apps/mobile/src/stores/review.store.ts) lines 302–325
- Review API schema: [apps/api/src/routes/review.ts](../../../apps/api/src/routes/review.ts) lines 10–23
- iOS location permission + expo-location plugin already configured in [apps/mobile/app.json](../../../apps/mobile/app.json) lines 30, 41–45, 73–78 (no new permissions needed)

**Frequent commits.** Commit after every passing task. Do not batch.

---

## File Structure

**Created files:**
- `packages/shared/src/milestones/index.ts` — barrel export
- `packages/shared/src/milestones/types.ts` — `MilestoneEntry`, `MilestoneType`, `GradeTier`, etc.
- `packages/shared/src/milestones/constants.ts` — `LADDERS`, JLPT levels, grade ranges
- `packages/shared/src/milestones/tier-rules.ts` — `gradeTierRule`, `jlptTierRule`
- `packages/shared/src/milestones/selection.ts` — `selectActiveBadges`, `computeUpNext`, `formatAchievedAt`
- `packages/shared/src/milestones/tier-rules.test.ts`
- `packages/shared/src/milestones/selection.test.ts`
- `apps/api/src/services/milestones/detector.ts` — `MilestoneDetector` with `detectCrossings`
- `apps/api/src/services/milestones/index.ts` — public exports
- `apps/api/test/unit/milestones-detector.test.ts`
- `apps/api/test/integration/milestones-refresh.test.ts`
- `apps/mobile/src/components/milestones/MilestonesSection.tsx`
- `apps/mobile/src/components/milestones/CoreBadgesRow.tsx`
- `apps/mobile/src/components/milestones/GradeBadgesRow.tsx`
- `apps/mobile/src/components/milestones/MilestoneBadge.tsx`
- `apps/mobile/src/components/milestones/GradeBadge.tsx`
- `apps/mobile/src/components/milestones/UpNextList.tsx`
- `apps/mobile/src/components/milestones/MilestoneDateSheet.tsx`
- `apps/mobile/src/utils/location.ts` — `tryGetCoordsForCapture`
- `apps/mobile/test/unit/milestones-section.test.tsx`

**Modified files:**
- `packages/shared/src/index.ts` — re-export milestones module
- `packages/db/src/schema.ts` — add `kanji_grade_idx` index
- New Drizzle migration under `packages/db/drizzle/`
- `apps/api/src/services/buddy/learner-state.service.ts` — call detector, persist crossings
- `apps/api/src/services/srs.service.ts` — thread `clientContext.location` through to refresh
- `apps/api/src/routes/review.ts` — extend `submitReviewSchema` with optional `clientContext.location`
- `apps/mobile/src/constants/milestones.ts` — strip `computeMilestones`, re-export shared LADDERS, add fixture helpers
- `apps/mobile/src/theme/index.ts` — add `milestoneTier` tokens
- `apps/mobile/app/(tabs)/progress.tsx` — replace inline milestone block with new component
- `apps/mobile/app/(tabs)/profile.tsx` — add "Attach location to milestones" toggle
- `apps/mobile/src/stores/review.store.ts` — attach `clientContext.location` to submit body when opted in

---

## Tasks

### Task 1: Shared types module

**Files:**
- Create: `packages/shared/src/milestones/types.ts`
- Create: `packages/shared/src/milestones/index.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create the types file**

`packages/shared/src/milestones/types.ts`:
```ts
export type GradeTier = 'bronze' | 'silver' | 'gold';
export type JlptLevel = 'N5' | 'N4' | 'N3' | 'N2' | 'N1';
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
```

- [ ] **Step 2: Create the barrel export**

`packages/shared/src/milestones/index.ts`:
```ts
export * from './types';
export * from './constants';
export * from './tier-rules';
export * from './selection';
```

- [ ] **Step 3: Re-export from package root**

Edit `packages/shared/src/index.ts` — add at the bottom:
```ts
export * from './milestones';
```

- [ ] **Step 4: Verify typecheck passes**

Run: `cd packages/shared && npm run typecheck`
Expected: PASS (no errors)

Note: tier-rules and selection don't exist yet, so the barrel will fail until Tasks 3 and 12. For now, comment out the lines in `milestones/index.ts` that reference them. Re-enable after their tasks.

Adjust `packages/shared/src/milestones/index.ts` temporarily:
```ts
export * from './types';
export * from './constants';
// re-enable after Task 3: export * from './tier-rules';
// re-enable after Task 12: export * from './selection';
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/milestones/ packages/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat(shared): milestone types module — entry shape and bucket types

Defines MilestoneEntry, MilestoneType, GradeTier, JlptLevel,
SrsBucketCounts, CurrentCounts, and the GRANDFATHERED sentinel.
Constants and rules to follow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 2: Shared constants — ladders

**Files:**
- Create: `packages/shared/src/milestones/constants.ts`

- [ ] **Step 1: Create the constants file**

`packages/shared/src/milestones/constants.ts`:
```ts
import type { JlptLevel, Grade } from './types';

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
```

- [ ] **Step 2: Verify typecheck**

Run: `cd packages/shared && npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/milestones/constants.ts
git commit -m "$(cat <<'EOF'
feat(shared): milestone ladders + JLPT/grade level constants

COUNT_LADDER (10..2000) shared by seen/remembered/burned.
STREAK_LADDER_FINITE plus open-ended helpers (streakThresholdsUpTo,
nextStreakThreshold). GRADE_BADGE_DISPLAY_CAP = 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 3: Shared tier rules

**Files:**
- Create: `packages/shared/src/milestones/tier-rules.ts`
- Create: `packages/shared/src/milestones/tier-rules.test.ts`
- Modify: `packages/shared/src/milestones/index.ts`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/milestones/tier-rules.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && npm test -- tier-rules`
Expected: FAIL — `gradeTierRule` and `jlptTierRule` not defined

- [ ] **Step 3: Implement tier rules**

`packages/shared/src/milestones/tier-rules.ts`:
```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/shared && npm test -- tier-rules`
Expected: PASS — all assertions green

- [ ] **Step 5: Re-enable barrel export**

Edit `packages/shared/src/milestones/index.ts` to uncomment:
```ts
export * from './tier-rules';
```

Run: `cd packages/shared && npm run typecheck` — PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/milestones/tier-rules.ts packages/shared/src/milestones/tier-rules.test.ts packages/shared/src/milestones/index.ts
git commit -m "$(cat <<'EOF'
feat(shared): tier rules — gradeTierRule + jlptTierRule

Independent per-tier evaluation. Grade Bronze tightened to require
burned > remembered (not implied by Silver). JLPT has no Bronze.
Tests cover edge cases including the Silver-without-Bronze case.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 4: DB index on kanji.grade

**Files:**
- Modify: `packages/db/src/schema.ts` (add index to kanji table)
- Create: new Drizzle migration under `packages/db/drizzle/`

- [ ] **Step 1: Read the current kanji table definition**

Read [packages/db/src/schema.ts](../../../packages/db/src/schema.ts) lines 60-140 to confirm the table structure and the existing `jlpt_level_order_idx` pattern.

- [ ] **Step 2: Add the index to schema**

In `packages/db/src/schema.ts`, in the kanji table definition's index callback (around line 134), add a new index:

```ts
(t) => ({
  jlptLevelOrderIdx: index('kanji_jlpt_level_order_idx').on(t.jlptLevel, t.jlptOrder),
  gradeIdx: index('kanji_grade_idx').on(t.grade),  // NEW
})
```

- [ ] **Step 3: Generate the migration**

Run from repo root:
```bash
cd packages/db && npx drizzle-kit generate
```

Expected: New migration file appears under `packages/db/drizzle/` (Drizzle picks a numbered name like `0012_*.sql`). Confirm the SQL contains `CREATE INDEX IF NOT EXISTS "kanji_grade_idx" ON "kanji" USING btree ("grade");`.

- [ ] **Step 4: Apply locally and verify**

```bash
cd packages/db && npx drizzle-kit migrate
```

Expected: applies cleanly. Confirm with a psql query or Drizzle Studio that the index exists.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/
git commit -m "$(cat <<'EOF'
feat(db): index kanji.grade for milestone detection queries

Per-grade aggregation in MilestoneDetector benefits from a btree index
on kanji.grade. Generated migration via drizzle-kit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 5: Server detector — numeric ladders

**Files:**
- Create: `apps/api/src/services/milestones/detector.ts`
- Create: `apps/api/src/services/milestones/index.ts`
- Create: `apps/api/test/unit/milestones-detector.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/api/test/unit/milestones-detector.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npm test -- milestones-detector`
Expected: FAIL — module not found

- [ ] **Step 3: Implement detector for numeric ladders**

`apps/api/src/services/milestones/detector.ts`:
```ts
import {
  LADDERS,
  STREAK_LADDER_FINITE,
  streakThresholdsUpTo,
  type MilestoneEntry,
  type CurrentCounts,
  type SrsBucketCounts,
  type JlptLevel,
  type Grade,
} from '@kanji-learn/shared';

export type DetectorInput = {
  counts: CurrentCounts;
  perGrade: Record<Grade, SrsBucketCounts>;
  perJlpt: Record<JlptLevel, SrsBucketCounts>;
  existing: MilestoneEntry[];
};

/** Returns proposed milestone entries WITHOUT achievedAt — caller assigns. */
export type ProposedMilestone = Omit<MilestoneEntry, 'achievedAt' | 'location'>;

export function detectCrossings(input: DetectorInput): ProposedMilestone[] {
  const proposed: ProposedMilestone[] = [];
  const existing = input.existing;

  // 1. Numeric count ladders
  for (const [type, ladder] of [
    ['kanji_seen', LADDERS.kanji_seen] as const,
    ['kanji_remembered', LADDERS.kanji_remembered] as const,
    ['kanji_burned', LADDERS.kanji_burned] as const,
  ]) {
    const current = type === 'kanji_seen' ? input.counts.seen
      : type === 'kanji_remembered' ? input.counts.remembered
      : input.counts.burned;
    for (const threshold of ladder) {
      if (threshold > current) break;
      if (!existing.some(e => e.type === type && e.threshold === threshold)) {
        proposed.push({ type, threshold });
      }
    }
  }

  // 2. Streak (open-ended)
  for (const threshold of streakThresholdsUpTo(input.counts.streak)) {
    if (!existing.some(e => e.type === 'streak_days' && e.threshold === threshold)) {
      proposed.push({ type: 'streak_days', threshold });
    }
  }

  // JLPT + Grade-level are added in Tasks 6 and 7.

  return proposed;
}
```

`apps/api/src/services/milestones/index.ts`:
```ts
export * from './detector';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npm test -- milestones-detector`
Expected: PASS — all five numeric-ladder tests green

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/milestones/ apps/api/test/unit/milestones-detector.test.ts
git commit -m "$(cat <<'EOF'
feat(api): MilestoneDetector — numeric ladders (seen/remembered/burned/streak)

Idempotent detection against existing entries; sticky on the way down;
streak ladder open-ended via streakThresholdsUpTo. JLPT and grade-level
tiers in follow-up tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 6: Detector — JLPT tier evaluation with gating

**Files:**
- Modify: `apps/api/src/services/milestones/detector.ts`
- Modify: `apps/api/test/unit/milestones-detector.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `milestones-detector.test.ts`:
```ts
describe('detectCrossings — JLPT tiers with gating', () => {
  it('emits Silver and Gold independently when both met', () => {
    const result = detectCrossings({
      counts: { seen: 0, remembered: 0, burned: 0, streak: 0 },
      perGrade: emptyGrades,
      perJlpt: { ...emptyJlpt, N5: { learning: 0, reviewing: 0, remembered: 0, burned: 5 } },
      existing: [],
    });
    const n5 = result.filter(r => r.type === 'jlpt_level' && r.payload?.level === 'N5');
    expect(n5.map(r => r.payload?.tier).sort()).toEqual(['gold', 'silver']);
  });

  it('gates N4 until N5 reaches Silver+', () => {
    // N5 not Silver-eligible (still has reviewing); N4 raw-Silver-eligible
    const result = detectCrossings({
      counts: { seen: 0, remembered: 0, burned: 0, streak: 0 },
      perGrade: emptyGrades,
      perJlpt: {
        ...emptyJlpt,
        N5: { learning: 0, reviewing: 2, remembered: 5, burned: 0 },
        N4: { learning: 0, reviewing: 0, remembered: 3, burned: 0 },
      },
      existing: [],
    });
    expect(result.find(r => r.type === 'jlpt_level' && r.payload?.level === 'N4')).toBeUndefined();
  });

  it('JLPT has no Bronze (even if state would qualify)', () => {
    const result = detectCrossings({
      counts: { seen: 0, remembered: 0, burned: 0, streak: 0 },
      perGrade: emptyGrades,
      perJlpt: {
        ...emptyJlpt,
        N5: { learning: 0, reviewing: 2, remembered: 5, burned: 10 }, // Bronze-eligible if it existed
      },
      existing: [],
    });
    expect(result.find(r => r.type === 'jlpt_level' && r.payload?.tier === 'bronze')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd apps/api && npm test -- milestones-detector`
Expected: 3 new tests FAIL

- [ ] **Step 3: Extend the detector**

In `apps/api/src/services/milestones/detector.ts`, after the streak block but before `return proposed`, add:

```ts
import { JLPT_LEVELS, JLPT_TIERS_ORDER, jlptTierRule } from '@kanji-learn/shared';
// ... at top with other imports

// 3. JLPT — independent per-tier evaluation, gated N5 → N1
let jlptUnlocked = true;
for (const level of JLPT_LEVELS) {
  if (!jlptUnlocked) break;
  const state = input.perJlpt[level];
  for (const tier of JLPT_TIERS_ORDER) {
    if (jlptTierRule(state, tier)) {
      const already = existing.some(e =>
        e.type === 'jlpt_level' && e.payload?.level === level && e.payload?.tier === tier
      );
      if (!already) {
        proposed.push({ type: 'jlpt_level', threshold: tier, payload: { level, tier } });
      }
    }
  }
  jlptUnlocked = jlptTierRule(state, 'silver') || jlptTierRule(state, 'gold');
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd apps/api && npm test -- milestones-detector`
Expected: PASS — all 8 tests green

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/milestones/detector.ts apps/api/test/unit/milestones-detector.test.ts
git commit -m "$(cat <<'EOF'
feat(api): MilestoneDetector — JLPT Silver/Gold with N5→N1 gating

Independent tier evaluation per level. No Bronze for JLPT. Higher
N-levels gated on Silver+ at the previous level.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 7: Detector — Grade-level tier evaluation with gating

**Files:**
- Modify: `apps/api/src/services/milestones/detector.ts`
- Modify: `apps/api/test/unit/milestones-detector.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `milestones-detector.test.ts`:
```ts
describe('detectCrossings — Grade-level tiers with gating', () => {
  it('emits Bronze when burned > remembered > reviewing and learning == 0', () => {
    const result = detectCrossings({
      counts: { seen: 0, remembered: 0, burned: 0, streak: 0 },
      perGrade: { ...emptyGrades, 1: { learning: 0, reviewing: 2, remembered: 5, burned: 10 } },
      perJlpt: emptyJlpt,
      existing: [],
    });
    const g1 = result.filter(r => r.type === 'grade_level' && r.payload?.grade === 1);
    expect(g1.map(r => r.payload?.tier).sort()).toEqual(['bronze']);
  });

  it('emits Silver only (not Bronze) when state fails the tightened Bronze rule', () => {
    // Silver-eligible (learning + reviewing == 0), but burned (2) NOT > remembered (8)
    const result = detectCrossings({
      counts: { seen: 0, remembered: 0, burned: 0, streak: 0 },
      perGrade: { ...emptyGrades, 1: { learning: 0, reviewing: 0, remembered: 8, burned: 2 } },
      perJlpt: emptyJlpt,
      existing: [],
    });
    const g1 = result.filter(r => r.type === 'grade_level' && r.payload?.grade === 1);
    expect(g1.map(r => r.payload?.tier).sort()).toEqual(['silver']);
  });

  it('gates Grade 2 until Grade 1 reaches Silver+', () => {
    const result = detectCrossings({
      counts: { seen: 0, remembered: 0, burned: 0, streak: 0 },
      perGrade: {
        ...emptyGrades,
        1: { learning: 0, reviewing: 2, remembered: 5, burned: 0 },  // not Silver-eligible
        2: { learning: 0, reviewing: 0, remembered: 3, burned: 0 },  // Silver-eligible on its own
      },
      perJlpt: emptyJlpt,
      existing: [],
    });
    expect(result.find(r => r.type === 'grade_level' && r.payload?.grade === 2)).toBeUndefined();
  });

  it('emits Gold + Silver when all burned at Grade 1', () => {
    const result = detectCrossings({
      counts: { seen: 0, remembered: 0, burned: 0, streak: 0 },
      perGrade: { ...emptyGrades, 1: { learning: 0, reviewing: 0, remembered: 0, burned: 7 } },
      perJlpt: emptyJlpt,
      existing: [],
    });
    const tiers = result.filter(r => r.type === 'grade_level' && r.payload?.grade === 1).map(r => r.payload?.tier).sort();
    expect(tiers).toEqual(['gold', 'silver']);  // Bronze fails (remembered (0) NOT > reviewing (0))
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd apps/api && npm test -- milestones-detector`
Expected: 4 new tests FAIL

- [ ] **Step 3: Extend the detector**

In `detector.ts`, add to imports:
```ts
import { GRADES, GRADE_TIERS_ORDER, gradeTierRule } from '@kanji-learn/shared';
```

After the JLPT block, before `return proposed`:
```ts
// 4. Grade-level — independent per-tier evaluation, gated 1 → 9
let gradeUnlocked = true;
for (const grade of GRADES) {
  if (!gradeUnlocked) break;
  const state = input.perGrade[grade];
  for (const tier of GRADE_TIERS_ORDER) {
    if (gradeTierRule(state, tier)) {
      const already = existing.some(e =>
        e.type === 'grade_level' && e.payload?.grade === grade && e.payload?.tier === tier
      );
      if (!already) {
        proposed.push({ type: 'grade_level', threshold: tier, payload: { grade, tier } });
      }
    }
  }
  gradeUnlocked = gradeTierRule(state, 'silver') || gradeTierRule(state, 'gold');
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd apps/api && npm test -- milestones-detector`
Expected: PASS — 12 tests green

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/milestones/detector.ts apps/api/test/unit/milestones-detector.test.ts
git commit -m "$(cat <<'EOF'
feat(api): MilestoneDetector — Grade-level tiers with 1→9 gating

Independent per-tier evaluation. Tightened Bronze (burned > remembered)
enforced. Gating prevents higher grades until lower is Silver+. Tests
include the Silver-without-Bronze case that motivated independent eval.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 8: Per-grade and per-JLPT bucket queries

**Files:**
- Create: `apps/api/src/services/milestones/queries.ts`
- Create: `apps/api/test/integration/milestones-queries.test.ts`

The detector needs per-grade and per-JLPT-level `SrsBucketCounts`. Source: join `user_kanji_progress` (status column distinguishes buckets) to `kanji` (grade / jlpt_level).

- [ ] **Step 1: Inspect the user_kanji_progress status enum**

Read [packages/db/src/schema.ts](../../../packages/db/src/schema.ts) lines 180-210. Note the `status` column values — likely `'learning' | 'reviewing' | 'remembered' | 'burned'` (or similar). Use these exact values in the queries.

If the names differ from the `SrsBucketCounts` shape, add a small mapping function at the top of `queries.ts`.

- [ ] **Step 2: Write integration test (skeleton)**

`apps/api/test/integration/milestones-queries.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/db';  // adjust import to match existing pattern
import { userKanjiProgress, kanji } from '@kanji-learn/db/schema';  // adjust import path
import { computePerGradeBuckets, computePerJlptBuckets } from '../../src/services/milestones/queries';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

describe('computePerGradeBuckets', () => {
  beforeEach(async () => {
    await db.delete(userKanjiProgress).where(/* userId == TEST_USER_ID */);
    // seed kanji rows with grades 1, 2, 3 — borrow from existing test fixtures if available
    // seed user_kanji_progress with mixed statuses
  });

  it('returns SrsBucketCounts per grade 1..9 with zeros for ungraded', async () => {
    const result = await computePerGradeBuckets(TEST_USER_ID);
    expect(result[1]).toEqual({ learning: 1, reviewing: 1, remembered: 1, burned: 1 });
    expect(result[9]).toEqual({ learning: 0, reviewing: 0, remembered: 0, burned: 0 });
  });
});

describe('computePerJlptBuckets', () => {
  it('returns SrsBucketCounts per N5..N1', async () => {
    const result = await computePerJlptBuckets(TEST_USER_ID);
    expect(Object.keys(result).sort()).toEqual(['N1', 'N2', 'N3', 'N4', 'N5']);
  });
});
```

Look at [apps/api/test/integration/learner-state-refresh.test.ts](../../../apps/api/test/integration/learner-state-refresh.test.ts) (the test added in commit 1807a72) to copy the exact fixture / DB-cleanup pattern. Fill in seeding to match.

- [ ] **Step 3: Run test to verify failure**

Run: `cd apps/api && npm test -- milestones-queries`
Expected: FAIL — module not found or seed missing

- [ ] **Step 4: Implement queries**

`apps/api/src/services/milestones/queries.ts`:
```ts
import { db } from '../../db';  // adjust to match existing pattern
import { userKanjiProgress, kanji } from '@kanji-learn/db/schema';
import { sql, eq, and } from 'drizzle-orm';
import {
  GRADES, JLPT_LEVELS,
  type SrsBucketCounts, type Grade, type JlptLevel,
} from '@kanji-learn/shared';

function zero(): SrsBucketCounts { return { learning: 0, reviewing: 0, remembered: 0, burned: 0 }; }

export async function computePerGradeBuckets(userId: string): Promise<Record<Grade, SrsBucketCounts>> {
  const rows = await db
    .select({
      grade: kanji.grade,
      status: userKanjiProgress.status,
      count: sql<number>`count(*)::int`,
    })
    .from(userKanjiProgress)
    .innerJoin(kanji, eq(userKanjiProgress.kanjiId, kanji.id))
    .where(eq(userKanjiProgress.userId, userId))
    .groupBy(kanji.grade, userKanjiProgress.status);

  const out = Object.fromEntries(GRADES.map(g => [g, zero()])) as Record<Grade, SrsBucketCounts>;
  for (const r of rows) {
    if (r.grade == null) continue;
    const g = r.grade as Grade;
    if (!out[g]) continue;
    if (r.status === 'learning' || r.status === 'reviewing' || r.status === 'remembered' || r.status === 'burned') {
      out[g][r.status] += r.count;
    }
  }
  return out;
}

export async function computePerJlptBuckets(userId: string): Promise<Record<JlptLevel, SrsBucketCounts>> {
  const rows = await db
    .select({
      level: kanji.jlptLevel,
      status: userKanjiProgress.status,
      count: sql<number>`count(*)::int`,
    })
    .from(userKanjiProgress)
    .innerJoin(kanji, eq(userKanjiProgress.kanjiId, kanji.id))
    .where(eq(userKanjiProgress.userId, userId))
    .groupBy(kanji.jlptLevel, userKanjiProgress.status);

  const out = Object.fromEntries(JLPT_LEVELS.map(l => [l, zero()])) as Record<JlptLevel, SrsBucketCounts>;
  for (const r of rows) {
    if (r.level == null) continue;
    const lvl = r.level as JlptLevel;
    if (!out[lvl]) continue;
    if (r.status === 'learning' || r.status === 'reviewing' || r.status === 'remembered' || r.status === 'burned') {
      out[lvl][r.status] += r.count;
    }
  }
  return out;
}
```

**Verify status enum values match.** If `user_kanji_progress.status` uses different strings (e.g., `'reviewable'` instead of `'reviewing'`), adjust the switch and add a small mapping comment.

- [ ] **Step 5: Run test to verify pass**

Run: `cd apps/api && npm test -- milestones-queries`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/milestones/queries.ts apps/api/test/integration/milestones-queries.test.ts
git commit -m "$(cat <<'EOF'
feat(api): per-grade and per-JLPT SRS bucket aggregation queries

Joins user_kanji_progress to kanji on grade / jlpt_level. Returns
Record<Grade, SrsBucketCounts> and Record<JlptLevel, SrsBucketCounts>
ready for MilestoneDetector consumption. Uses the kanji_grade_idx
added in Task 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 9: Grandfather pass detection helper

**Files:**
- Modify: `apps/api/src/services/milestones/detector.ts`

**Testing note:** `hasPreDeployHistory` is a one-line DB query whose only meaningful behaviour shows up in the integration test added in Task 11 (which seeds a pre-deploy user and asserts the grandfather path fires). No dedicated unit test for this function — Task 11 covers it.

- [ ] **Step 1: Implement**

Add to `detector.ts`:
```ts
import { db } from '../../db';
import { userKanjiProgress } from '@kanji-learn/db/schema';
import { eq, and, lt, sql } from 'drizzle-orm';

/**
 * "Pre-deploy history" cutoff. Set to the deploy timestamp of the rework so
 * users with SRS activity before that moment receive the lazy grandfather pass.
 * The value is environment-driven so it can be set per-environment at boot.
 */
const PRE_DEPLOY_CUTOFF_ISO = process.env.MILESTONES_DEPLOY_CUTOFF_ISO
  ?? '2026-05-25T00:00:00Z';   // safe default — adjust at deploy time

export async function hasPreDeployHistory(userId: string): Promise<boolean> {
  const rows = await db
    .select({ exists: sql<number>`1` })
    .from(userKanjiProgress)
    .where(and(
      eq(userKanjiProgress.userId, userId),
      lt(userKanjiProgress.createdAt, new Date(PRE_DEPLOY_CUTOFF_ISO)),
    ))
    .limit(1);
  return rows.length > 0;
}
```

- [ ] **Step 2: Run existing milestone tests to confirm no regression**

Run: `cd apps/api && npm test -- milestones`
Expected: PASS — all tier/ladder tests from Tasks 5–7 still green

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/milestones/detector.ts
git commit -m "$(cat <<'EOF'
feat(api): hasPreDeployHistory — gate for the migration grandfather pass

Reads MILESTONES_DEPLOY_CUTOFF_ISO env (default 2026-05-25T00:00:00Z).
Used by LearnerStateService refresh to decide whether to grandfather
existing milestones on first post-deploy refresh. Behaviour exercised
by the integration test in Task 11.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 10: Integrate detector into LearnerStateService.refreshState

**Files:**
- Modify: `apps/api/src/services/buddy/learner-state.service.ts`

- [ ] **Step 1: Read the current refresh flow**

Read [apps/api/src/services/buddy/learner-state.service.ts](../../../apps/api/src/services/buddy/learner-state.service.ts) — find `refreshState`, locate where it computes counts and where it upserts `learnerStateCache`. Note: the spec wants the new logic AFTER counts are computed and BEFORE persistence so the persisted row includes the new milestone entries in one upsert.

- [ ] **Step 2: Extend the refreshState method**

Replace the upsert section with logic that:
1. Loads the current `recentMilestones` from the cache row (default `[]`)
2. Calls `detectCrossings` with computed counts + per-grade + per-jlpt + existing
3. Decides grandfather vs normal path:
   - If `existing.length === 0` AND `await hasPreDeployHistory(userId)` → grandfather mode, `achievedAt = GRANDFATHERED`
   - Else → normal mode, `achievedAt = nowIso`
4. Appends mapped entries to `existing`
5. Persists the merged array on the upsert

Method signature gains an optional `opts` parameter that we'll use for location in a later task:
```ts
async refreshState(
  userId: string,
  opts?: { location?: { lat: number; lon: number; accuracy?: number } }
): Promise<ComputedLearnerState | null>
```

Within the method, alongside the existing count computation:
```ts
import { detectCrossings, hasPreDeployHistory } from '../milestones/detector';
import { computePerGradeBuckets, computePerJlptBuckets } from '../milestones/queries';
import { GRANDFATHERED, type MilestoneEntry } from '@kanji-learn/shared';

// ... inside refreshState, after counts/streak are computed and before upsert:

const existingCacheRow = /* fetched cache row, or null if first time */;
const existingMilestones: MilestoneEntry[] = existingCacheRow?.recentMilestones ?? [];

const [perGrade, perJlpt] = await Promise.all([
  computePerGradeBuckets(userId),
  computePerJlptBuckets(userId),
]);

const proposed = detectCrossings({
  counts: { seen: totalSeen, remembered: rememberedCount, burned: burnedCount, streak: streakDays },
  perGrade,
  perJlpt,
  existing: existingMilestones,
});

const isGrandfatherPass = existingMilestones.length === 0 && await hasPreDeployHistory(userId);

const newEntries: MilestoneEntry[] = proposed.map(p => ({
  ...p,
  achievedAt: isGrandfatherPass ? GRANDFATHERED : new Date().toISOString(),
  ...(opts?.location ? { location: opts.location } : {}),
}));

const updatedMilestones: MilestoneEntry[] = [...existingMilestones, ...newEntries];

// ... pass updatedMilestones into the existing upsert as recentMilestones
```

Replace the existing upsert's `recentMilestones` value with `updatedMilestones`. (If the existing upsert doesn't touch `recentMilestones`, add it explicitly.)

- [ ] **Step 3: Run all api tests**

Run: `cd apps/api && npm test`
Expected: PASS (the detector unit tests still pass; refreshState changes should not break existing tests yet — integration test for the full path comes in Task 11).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/buddy/learner-state.service.ts
git commit -m "$(cat <<'EOF'
feat(api): LearnerStateService.refreshState — detect and persist milestones

Calls MilestoneDetector after counts are computed. Persists newly
crossed milestones to learner_state_cache.recentMilestones with real
ISO timestamps, OR with the GRANDFATHERED sentinel on the first
refresh for a pre-deploy user. Idempotent; subsequent refreshes only
append truly new crossings. Accepts optional location for later
plumbing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 11: Integration test — refresh end-to-end

**Files:**
- Create: `apps/api/test/integration/milestones-refresh.test.ts`

- [ ] **Step 1: Use the existing learner-state-refresh.test.ts as a template**

Read [apps/api/test/integration/learner-state-refresh.test.ts](../../../apps/api/test/integration/learner-state-refresh.test.ts) — copy the seeding/cleanup scaffold.

- [ ] **Step 2: Write three integration tests**

`apps/api/test/integration/milestones-refresh.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { LearnerStateService } from '../../src/services/buddy/learner-state.service';
import { db } from '../../src/db';
import { userKanjiProgress, kanji, learnerStateCache } from '@kanji-learn/db/schema';
import { eq } from 'drizzle-orm';
import { GRANDFATHERED } from '@kanji-learn/shared';

const TEST_USER_ID = '00000000-0000-0000-0000-0000000000aa';
const svc = new LearnerStateService();  // or however it's instantiated in the codebase

describe('refreshState — milestone persistence', () => {
  beforeEach(async () => {
    await db.delete(learnerStateCache).where(eq(learnerStateCache.userId, TEST_USER_ID));
    await db.delete(userKanjiProgress).where(eq(userKanjiProgress.userId, TEST_USER_ID));
  });

  it('first refresh for a pre-deploy user grandfathers existing crossings', async () => {
    // Seed 50 burned kanji with createdAt BEFORE the deploy cutoff
    // (use the test fixture pattern from learner-state-refresh.test.ts)
    // ... seeding ...
    await svc.refreshState(TEST_USER_ID);
    const [row] = await db.select().from(learnerStateCache).where(eq(learnerStateCache.userId, TEST_USER_ID));
    expect(row.recentMilestones.length).toBeGreaterThan(0);
    expect(row.recentMilestones.every((e: any) => e.achievedAt === GRANDFATHERED)).toBe(true);
  });

  it('a brand-new user (no pre-deploy history) gets real timestamps', async () => {
    // Seed 50 burned kanji with createdAt AFTER the deploy cutoff
    // ... seeding ...
    await svc.refreshState(TEST_USER_ID);
    const [row] = await db.select().from(learnerStateCache).where(eq(learnerStateCache.userId, TEST_USER_ID));
    expect(row.recentMilestones.some((e: any) => e.achievedAt !== GRANDFATHERED)).toBe(true);
  });

  it('second refresh is idempotent — no duplicate entries', async () => {
    // ... same seed as first test ...
    await svc.refreshState(TEST_USER_ID);
    const [row1] = await db.select().from(learnerStateCache).where(eq(learnerStateCache.userId, TEST_USER_ID));
    const count1 = row1.recentMilestones.length;
    await svc.refreshState(TEST_USER_ID);
    const [row2] = await db.select().from(learnerStateCache).where(eq(learnerStateCache.userId, TEST_USER_ID));
    expect(row2.recentMilestones.length).toBe(count1);
  });
});
```

- [ ] **Step 3: Run test to verify pass**

Run: `cd apps/api && npm test -- milestones-refresh`
Expected: PASS — all three tests green

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/integration/milestones-refresh.test.ts
git commit -m "$(cat <<'EOF'
test(api): integration tests for milestone persistence on refresh

Covers the grandfather pass for pre-deploy users, real timestamps for
new users, and idempotency across repeat refreshes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 12: Shared selection helpers

**Files:**
- Create: `packages/shared/src/milestones/selection.ts`
- Create: `packages/shared/src/milestones/selection.test.ts`
- Modify: `packages/shared/src/milestones/index.ts`

- [ ] **Step 1: Write failing tests**

`packages/shared/src/milestones/selection.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { selectActiveBadges, computeUpNext, formatAchievedAt } from './selection';
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
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd packages/shared && npm test -- selection`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`packages/shared/src/milestones/selection.ts`:
```ts
import {
  type MilestoneEntry,
  type MilestoneType,
  type CurrentCounts,
  type SrsBucketCounts,
  type JlptLevel,
  type Grade,
  GRANDFATHERED,
} from './types';
import {
  LADDERS,
  JLPT_LEVELS, JLPT_TIERS_ORDER,
  GRADES, GRADE_TIERS_ORDER,
  GRADE_BADGE_DISPLAY_CAP,
  nextStreakThreshold,
} from './constants';
import { gradeTierRule, jlptTierRule } from './tier-rules';

const TIER_ORDER: Record<string, number> = { bronze: 0, silver: 1, gold: 2 };
const JLPT_ORDER: Record<JlptLevel, number> = { N5: 0, N4: 1, N3: 2, N2: 3, N1: 4 };

function isGrandfathered(e: MilestoneEntry): boolean {
  return e.achievedAt === GRANDFATHERED;
}

function recencyKey(e: MilestoneEntry): number {
  // Grandfathered sorts to bottom (use -Infinity)
  if (isGrandfathered(e)) return -Infinity;
  return new Date(e.achievedAt).getTime();
}

export type ActiveBadgesResult = {
  core: MilestoneEntry[];   // ordered most-recent-first within row
  grade: MilestoneEntry[];  // capped to GRADE_BADGE_DISPLAY_CAP
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

  // ── Grade-level: highest tier per grade, top 3 by recency ──
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

  // JLPT — next ungated tier
  // Walk N5→N1; the first level where the user hasn't reached the highest tier and is unlocked is the next entry.
  let jlptUnlocked = true;
  for (const level of JLPT_LEVELS) {
    if (!jlptUnlocked) break;
    const state = input.perJlpt[level];
    const hasGold = jlptTierRule(state, 'gold');
    const hasSilver = jlptTierRule(state, 'silver');
    if (!hasSilver) {
      out.push({ type: 'jlpt_level', nextThreshold: 'silver', payload: { level, tier: 'silver' } });
      break;
    } else if (!hasGold) {
      out.push({ type: 'jlpt_level', nextThreshold: 'gold', payload: { level, tier: 'gold' } });
      break;
    }
    jlptUnlocked = hasSilver || hasGold;
  }

  // Grade-level — next ungated tier
  let gradeUnlocked = true;
  for (const grade of GRADES) {
    if (!gradeUnlocked) break;
    const state = input.perGrade[grade];
    const hasGold = gradeTierRule(state, 'gold');
    const hasSilver = gradeTierRule(state, 'silver');
    const hasBronze = gradeTierRule(state, 'bronze');
    if (!hasBronze && !hasSilver && !hasGold) {
      out.push({ type: 'grade_level', nextThreshold: 'bronze', payload: { grade, tier: 'bronze' } });
      break;
    } else if (!hasSilver) {
      out.push({ type: 'grade_level', nextThreshold: 'silver', payload: { grade, tier: 'silver' } });
      break;
    } else if (!hasGold) {
      out.push({ type: 'grade_level', nextThreshold: 'gold', payload: { grade, tier: 'gold' } });
      break;
    }
    gradeUnlocked = hasSilver || hasGold;
  }

  return out;
}

export function formatAchievedAt(achievedAt: string): string {
  if (achievedAt === GRANDFATHERED) return 'Earned before this update';
  const d = new Date(achievedAt);
  return `Earned ${d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`;
}
```

- [ ] **Step 4: Re-enable barrel export**

In `packages/shared/src/milestones/index.ts`, uncomment:
```ts
export * from './selection';
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd packages/shared && npm test -- selection`
Expected: PASS — all assertions green

Run: `cd packages/shared && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/milestones/selection.ts packages/shared/src/milestones/selection.test.ts packages/shared/src/milestones/index.ts
git commit -m "$(cat <<'EOF'
feat(shared): selection helpers — selectActiveBadges + computeUpNext

Replacement rule for numeric categories, highest-tier-per-{grade,level}
collapse, grade cap = 3, recency-first sort with grandfathered to bottom
(grade-number desc as tiebreaker). computeUpNext handles open-ended streak
and gated JLPT/grade-level progression. formatAchievedAt handles the
grandfathered sentinel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 13: Mobile constants/milestones.ts refactor

**Files:**
- Modify: `apps/mobile/src/constants/milestones.ts`

- [ ] **Step 1: Read the current file**

Read [apps/mobile/src/constants/milestones.ts](../../../apps/mobile/src/constants/milestones.ts) — note all callers of `computeMilestones` and the `Milestone` type (grep for `from '*constants/milestones'`).

- [ ] **Step 2: Rewrite the file**

Replace the entire contents with re-exports from shared, plus mobile-only display constants:

```ts
// apps/mobile/src/constants/milestones.ts
export {
  selectActiveBadges,
  computeUpNext,
  formatAchievedAt,
  LADDERS,
  GRADE_BADGE_DISPLAY_CAP,
  nextStreakThreshold,
  type MilestoneEntry,
  type MilestoneType,
  type GradeTier,
  type JlptLevel,
  type Grade,
  type UpNextEntry,
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
```

Delete the old `computeMilestones` and `Milestone` type. If any caller you found in Step 1 references them outside of `progress.tsx`, leave a `git grep` note for Task 20 to clean up.

- [ ] **Step 3: Typecheck**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: errors only in progress.tsx and any other caller of the removed functions — Tasks 19/20 will resolve those. Note them.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/constants/milestones.ts
git commit -m "$(cat <<'EOF'
refactor(mobile): milestones constants — re-export from shared + display metadata

Removes the obsolete client-side computeMilestones (replaced by
selectActiveBadges from @kanji-learn/shared). CATEGORY_DISPLAY adds
mobile-only emoji + label per type for the new badge components.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 14: Mobile theme tokens for milestone tiers

**Files:**
- Modify: `apps/mobile/src/theme/index.ts`

- [ ] **Step 1: Read the theme module**

Read [apps/mobile/src/theme/index.ts](../../../apps/mobile/src/theme/index.ts). Identify where colours live (`colors` export, dark/light variants if applicable).

- [ ] **Step 2: Add tier tokens**

Add a new branch alongside existing colour exports. Pick values WCAG-AA-compliant against the dominant panel background; the brainstorm v2 mockup used the values below as a starting point:

```ts
export const milestoneTier = {
  bronze: { bg: '#3a1f0a', border: '#e89a5c', label: '#f5b07a' },
  silver: { bg: '#3a3a3a', border: '#e0e0e0', label: '#f0f0f0' },
  gold:   { bg: '#3a2c00', border: '#ffd24a', label: '#ffe066' },
};
```

If the theme supports light/dark mode with named tokens, mirror the pattern — both modes need ≥ 4.5:1 contrast on the panel background.

- [ ] **Step 3: Verify with an accessibility checker**

Use the WebAIM contrast tool (or the macOS Color Picker contrast helper) to confirm each `label` colour against the corresponding `bg` ≥ 4.5:1. If any fall short, brighten the label.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/theme/index.ts
git commit -m "$(cat <<'EOF'
feat(mobile): theme tokens for milestone bronze/silver/gold tiers

WCAG AA compliant on dark panel background. Used by GradeBadge in
the rework. Starting values from the brainstorm v2 mockup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 15: MilestoneBadge + GradeBadge components

**Files:**
- Create: `apps/mobile/src/components/milestones/MilestoneBadge.tsx`
- Create: `apps/mobile/src/components/milestones/GradeBadge.tsx`

- [ ] **Step 1: Implement MilestoneBadge (non-grade categories)**

`apps/mobile/src/components/milestones/MilestoneBadge.tsx`:
```tsx
import { Pressable, Text, View } from 'react-native';
import { CATEGORY_DISPLAY, type MilestoneEntry } from '../../constants/milestones';
import { colors } from '../../theme';   // adjust to actual export

export function MilestoneBadge({
  entry,
  onPress,
}: {
  entry: MilestoneEntry;
  onPress: (e: MilestoneEntry) => void;
}) {
  const display = CATEGORY_DISPLAY[entry.type];

  // Label text per category
  let primary = '';
  if (entry.type === 'kanji_seen' || entry.type === 'kanji_remembered' || entry.type === 'kanji_burned') {
    primary = `${entry.threshold} ${display.label}`;
  } else if (entry.type === 'streak_days') {
    primary = `${entry.threshold}-day streak`;
  } else if (entry.type === 'jlpt_level') {
    primary = `${entry.payload?.level} ${entry.payload?.tier}`;
  }

  return (
    <Pressable
      onPress={() => onPress(entry)}
      accessibilityRole="button"
      accessibilityLabel={`${primary}. Tap to see date earned.`}
      style={{
        backgroundColor: colors.surfaceElevated,    // adjust to actual token
        borderColor: colors.borderSubtle,
        borderWidth: 2,
        borderRadius: 14,
        paddingHorizontal: 18,
        paddingVertical: 14,
        minWidth: 104,
        alignItems: 'center',
      }}
    >
      <Text style={{ fontSize: 28 }}>{display.emoji}</Text>
      <Text style={{ color: colors.textPrimary, fontWeight: '700', marginTop: 6, fontSize: 14, textAlign: 'center' }}>
        {primary}
      </Text>
    </Pressable>
  );
}
```

- [ ] **Step 2: Implement GradeBadge (tier-styled)**

`apps/mobile/src/components/milestones/GradeBadge.tsx`:
```tsx
import { Pressable, Text } from 'react-native';
import type { MilestoneEntry } from '../../constants/milestones';
import { milestoneTier, colors } from '../../theme';

export function GradeBadge({
  entry,
  onPress,
}: {
  entry: MilestoneEntry;
  onPress: (e: MilestoneEntry) => void;
}) {
  const tier = entry.payload?.tier ?? 'bronze';
  const palette = milestoneTier[tier];
  return (
    <Pressable
      onPress={() => onPress(entry)}
      accessibilityRole="button"
      accessibilityLabel={`Grade ${entry.payload?.grade} ${tier}. Tap to see date earned.`}
      style={{
        backgroundColor: palette.bg,
        borderColor: palette.border,
        borderWidth: 2,
        borderRadius: 14,
        paddingHorizontal: 18,
        paddingVertical: 14,
        minWidth: 104,
        alignItems: 'center',
      }}
    >
      <Text style={{ fontSize: 28 }}>🏅</Text>
      <Text style={{ color: colors.textPrimary, fontWeight: '700', marginTop: 6, fontSize: 14 }}>
        Grade {entry.payload?.grade}
      </Text>
      <Text style={{ color: palette.label, fontWeight: '700', fontSize: 12, letterSpacing: 1.5, marginTop: 4 }}>
        {tier.toUpperCase()}
      </Text>
    </Pressable>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: PASS (theme token names may need adjustment to actual exports)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/milestones/
git commit -m "$(cat <<'EOF'
feat(mobile): MilestoneBadge + GradeBadge components

Pressable badge cards with explicit theme colours (no opacity tricks).
GradeBadge uses milestoneTier tokens for bronze/silver/gold. Both
expose accessibilityLabel covering category + 'tap to see date'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 16: CoreBadgesRow + GradeBadgesRow

**Files:**
- Create: `apps/mobile/src/components/milestones/CoreBadgesRow.tsx`
- Create: `apps/mobile/src/components/milestones/GradeBadgesRow.tsx`

- [ ] **Step 1: Implement both rows**

`apps/mobile/src/components/milestones/CoreBadgesRow.tsx`:
```tsx
import { ScrollView } from 'react-native';
import { MilestoneBadge } from './MilestoneBadge';
import type { MilestoneEntry } from '../../constants/milestones';

export function CoreBadgesRow({
  badges,
  onBadgePress,
}: {
  badges: MilestoneEntry[];
  onBadgePress: (e: MilestoneEntry) => void;
}) {
  if (badges.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 12, paddingVertical: 4 }}
    >
      {badges.map((b, i) => (
        <MilestoneBadge key={`core-${b.type}-${b.threshold}-${i}`} entry={b} onPress={onBadgePress} />
      ))}
    </ScrollView>
  );
}
```

`apps/mobile/src/components/milestones/GradeBadgesRow.tsx`:
```tsx
import { ScrollView } from 'react-native';
import { GradeBadge } from './GradeBadge';
import type { MilestoneEntry } from '../../constants/milestones';

export function GradeBadgesRow({
  badges,
  onBadgePress,
}: {
  badges: MilestoneEntry[];
  onBadgePress: (e: MilestoneEntry) => void;
}) {
  if (badges.length === 0) return null;   // hide row entirely when empty
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 12, paddingVertical: 4 }}
    >
      {badges.map((b, i) => (
        <GradeBadge key={`grade-${b.payload?.grade}-${b.payload?.tier}-${i}`} entry={b} onPress={onBadgePress} />
      ))}
    </ScrollView>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/components/milestones/CoreBadgesRow.tsx apps/mobile/src/components/milestones/GradeBadgesRow.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): CoreBadgesRow + GradeBadgesRow — horizontal scroll containers

Render zero badges as null (row hidden entirely) so the panel collapses
gracefully when a user has not yet earned anything in a category.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 17: UpNextList

**Files:**
- Create: `apps/mobile/src/components/milestones/UpNextList.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/mobile/src/components/milestones/UpNextList.tsx
import { Text, View } from 'react-native';
import { CATEGORY_DISPLAY, type UpNextEntry } from '../../constants/milestones';
import { colors } from '../../theme';

export function UpNextList({ entries }: { entries: UpNextEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <View>
      <Text style={{
        color: colors.textSecondary,
        fontSize: 12,
        letterSpacing: 1,
        textTransform: 'uppercase',
        marginBottom: 8,
      }}>
        Up next
      </Text>
      {entries.map((e, i) => {
        const display = CATEGORY_DISPLAY[e.type];
        let primary = '';
        let detail = '';
        if (e.type === 'streak_days') {
          primary = `${e.nextThreshold}-day streak`;
          detail = `${e.current} / ${e.target}`;
        } else if (e.type === 'kanji_seen' || e.type === 'kanji_remembered' || e.type === 'kanji_burned') {
          primary = `${e.nextThreshold} ${display.label}`;
          detail = `${e.current} / ${e.target}`;
        } else if (e.type === 'jlpt_level') {
          primary = `${e.payload?.level} ${e.payload?.tier}`;
        } else if (e.type === 'grade_level') {
          primary = `Grade ${e.payload?.grade} ${e.payload?.tier}`;
        }
        return (
          <View
            key={`upnext-${i}`}
            style={{
              flexDirection: 'row',
              paddingVertical: 10,
              borderBottomColor: colors.borderSubtle,
              borderBottomWidth: i === entries.length - 1 ? 0 : 1,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 16, marginRight: 8 }}>{display.emoji}</Text>
            <Text style={{ color: colors.textPrimary, fontSize: 14, flex: 1 }}>{primary}</Text>
            {detail ? (
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{detail}</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/components/milestones/UpNextList.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): UpNextList — per-category next threshold with progress

Numeric categories show "(current / target)" alongside the label;
JLPT and grade-level show just the name + tier. Hidden when no entries.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 18: MilestoneDateSheet (bottom-sheet)

**Files:**
- Create: `apps/mobile/src/components/milestones/MilestoneDateSheet.tsx`

The brainstorm called for a bottom-sheet, not a modal. If `@gorhom/bottom-sheet` is already in `apps/mobile/package.json`, use it. Otherwise, a `<Modal animationType="slide" presentationStyle="formSheet">` is acceptable as a v1 approximation.

- [ ] **Step 1: Check for an existing bottom-sheet library**

Run: `grep -E "bottom-sheet|@gorhom" /Users/rdennis/Documents/projects/kanji-learn/apps/mobile/package.json`

If present, use it. If not, fall through to `Modal`.

- [ ] **Step 2: Implement (Modal fallback shown)**

```tsx
// apps/mobile/src/components/milestones/MilestoneDateSheet.tsx
import { Modal, Pressable, Text, View } from 'react-native';
import { CATEGORY_DISPLAY, formatAchievedAt, type MilestoneEntry } from '../../constants/milestones';
import { colors } from '../../theme';

export function MilestoneDateSheet({
  entry,
  onClose,
}: {
  entry: MilestoneEntry | null;
  onClose: () => void;
}) {
  if (!entry) return null;
  const display = CATEGORY_DISPLAY[entry.type];

  let title = '';
  if (entry.type === 'kanji_seen' || entry.type === 'kanji_remembered' || entry.type === 'kanji_burned') {
    title = `${entry.threshold} ${display.label}`;
  } else if (entry.type === 'streak_days') {
    title = `${entry.threshold}-day streak`;
  } else if (entry.type === 'jlpt_level') {
    title = `${entry.payload?.level} ${entry.payload?.tier}`;
  } else if (entry.type === 'grade_level') {
    title = `Grade ${entry.payload?.grade} ${entry.payload?.tier}`;
  }

  return (
    <Modal
      visible={entry != null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: colors.surface,
            paddingTop: 24,
            paddingBottom: 48,
            paddingHorizontal: 24,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: 48 }}>{display.emoji}</Text>
          <Text style={{ color: colors.textPrimary, fontSize: 20, fontWeight: '700', marginTop: 8 }}>
            {title}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14, marginTop: 12 }}>
            {formatAchievedAt(entry.achievedAt)}
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/milestones/MilestoneDateSheet.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): MilestoneDateSheet — bottom-sheet shown on badge tap

Renders category emoji, milestone title, and formatted earned date
(or "Earned before this update" for grandfathered entries). Tap-out
to dismiss.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 19: MilestonesSection orchestrator + smoke test

**Files:**
- Create: `apps/mobile/src/components/milestones/MilestonesSection.tsx`
- Create: `apps/mobile/test/unit/milestones-section.test.tsx`

- [ ] **Step 1: Discover the learner-state hook**

Run from the repo root:
```bash
grep -rn "learner-state\|learnerState" apps/mobile/src/hooks/ apps/mobile/src/stores/ 2>/dev/null | head -20
```

Identify the actual hook/store name (likely `useLearnerState` or `useLearnerStore`) and the shape of its exposed data. Note whether it currently surfaces `recentMilestones`, `counts`, `perGrade`, `perJlpt`. The snippet below uses `useLearnerState` as a placeholder — adjust to the actual name.

**If the hook does NOT expose all four (likely scenario):** the `/v1/learner-state` API response shape needs extension to include `perGradeBuckets` and `perJlptBuckets` from the queries added in Task 8. This is a real expansion of scope — call it out, make the API extension before continuing, and verify the response in DevTools or a curl against the dev server. The hook then surfaces them via the same destructure pattern.

- [ ] **Step 2: Implement orchestrator**

The section reads from the learner-state hook and supplies `recentMilestones`, `counts`, `perGrade`, `perJlpt` to the selection helpers.

```tsx
// apps/mobile/src/components/milestones/MilestonesSection.tsx
import { useState } from 'react';
import { Text, View } from 'react-native';
import { selectActiveBadges, computeUpNext, type MilestoneEntry } from '../../constants/milestones';
import { CoreBadgesRow } from './CoreBadgesRow';
import { GradeBadgesRow } from './GradeBadgesRow';
import { UpNextList } from './UpNextList';
import { MilestoneDateSheet } from './MilestoneDateSheet';
import { useLearnerState } from '../../hooks/useLearnerState';   // adjust name
import { colors } from '../../theme';

export function MilestonesSection() {
  const { recentMilestones, counts, perGrade, perJlpt, loading } = useLearnerState();
  const [tapped, setTapped] = useState<MilestoneEntry | null>(null);

  if (loading) return null;

  const { core, grade } = selectActiveBadges(recentMilestones ?? []);
  const upNext = computeUpNext({
    counts: counts ?? { seen: 0, remembered: 0, burned: 0, streak: 0 },
    milestones: recentMilestones ?? [],
    perGrade: perGrade ?? ({} as any),
    perJlpt: perJlpt ?? ({} as any),
  });

  const isEmpty = core.length === 0 && grade.length === 0;

  return (
    <View style={{ gap: 20, paddingVertical: 16 }}>
      <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: '700' }}>
        Milestones
      </Text>
      {isEmpty ? (
        <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
          Your first milestone awaits — start studying to earn your first badge.
        </Text>
      ) : (
        <>
          <CoreBadgesRow badges={core} onBadgePress={setTapped} />
          <GradeBadgesRow badges={grade} onBadgePress={setTapped} />
        </>
      )}
      <UpNextList entries={upNext} />
      <MilestoneDateSheet entry={tapped} onClose={() => setTapped(null)} />
    </View>
  );
}
```

Verify the `useLearnerState` hook exposes `recentMilestones`, `counts`, `perGrade`, `perJlpt`. **If it does not**, extend it (and the underlying `/v1/learner-state` response shape if necessary) to include those fields. This may be a small follow-up task — if it grows, split it out. Document any change here in the commit message.

- [ ] **Step 3: Write a smoke test**

`apps/mobile/test/unit/milestones-section.test.tsx`:
```tsx
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { MilestonesSection } from '../../src/components/milestones/MilestonesSection';

jest.mock('../../src/hooks/useLearnerState', () => ({
  useLearnerState: () => ({
    loading: false,
    counts: { seen: 100, remembered: 12, burned: 0, streak: 7 },
    perGrade: { 1: { learning: 0, reviewing: 0, remembered: 0, burned: 0 } },
    perJlpt: { N5: { learning: 0, reviewing: 0, remembered: 0, burned: 0 } },
    recentMilestones: [
      { type: 'kanji_seen', threshold: 100, achievedAt: '2026-05-01T00:00:00Z' },
      { type: 'streak_days', threshold: 7, achievedAt: '2026-05-20T00:00:00Z' },
    ],
  }),
}));

describe('MilestonesSection', () => {
  it('renders one badge per category', () => {
    render(<MilestonesSection />);
    expect(screen.getByText('100 kanji seen')).toBeTruthy();
    expect(screen.getByText('7-day streak')).toBeTruthy();
  });

  it('opens the date sheet on badge tap', () => {
    render(<MilestonesSection />);
    fireEvent.press(screen.getByText('100 kanji seen'));
    expect(screen.getByText(/Earned /)).toBeTruthy();
  });

  it('renders "earned before this update" for grandfathered entries', () => {
    jest.resetModules();
    jest.doMock('../../src/hooks/useLearnerState', () => ({
      useLearnerState: () => ({
        loading: false,
        counts: { seen: 100, remembered: 0, burned: 0, streak: 0 },
        perGrade: {}, perJlpt: {},
        recentMilestones: [
          { type: 'kanji_seen', threshold: 100, achievedAt: 'grandfathered' },
        ],
      }),
    }));
    const { MilestonesSection: Reloaded } = require('../../src/components/milestones/MilestonesSection');
    render(<Reloaded />);
    fireEvent.press(screen.getByText('100 kanji seen'));
    expect(screen.getByText('Earned before this update')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run test**

Run: `cd apps/mobile && npm test -- milestones-section`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/milestones/MilestonesSection.tsx apps/mobile/test/unit/milestones-section.test.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): MilestonesSection orchestrator + smoke tests

Wires selectActiveBadges + computeUpNext onto the learner-state hook
output and renders the new badge rows + UpNext list + date sheet.
Smoke tests cover the happy path and the grandfathered-date display.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 20: Wire into progress.tsx (delete inline block)

**Files:**
- Modify: `apps/mobile/app/(tabs)/progress.tsx`

- [ ] **Step 1: Read the file**

Read [apps/mobile/app/(tabs)/progress.tsx](../../../apps/mobile/app/(tabs)/progress.tsx) lines 500-560 to find the inline `MilestonesSection` block (around line 515) and identify the props it currently receives.

- [ ] **Step 2: Replace the inline block**

- Delete the inline `MilestonesSection` helper function (the one defined inside `progress.tsx`).
- Replace its JSX usage (`<MilestonesSection ... />` in the render tree) with an import:

```tsx
import { MilestonesSection } from '../../src/components/milestones/MilestonesSection';
// ...
// in render:
<MilestonesSection />
```

The new component reads directly from `useLearnerState`, so the old prop-drilling (`burned`, `streakDays`, `totalSeen`, `jlptProgress`) is no longer needed at the call-site. Delete those props.

- [ ] **Step 3: Remove any unused imports**

After the edit, run `cd apps/mobile && npx tsc --noEmit` and clean up any TS warnings for newly unused imports/variables in progress.tsx.

- [ ] **Step 4: Manual smoke test on simulator/device**

Run the app (`cd apps/mobile && npx expo start`). Navigate to the Progress tab. Verify:
- Milestones section renders (either populated or empty-state).
- Tap a badge → bottom sheet appears with date.
- Tap outside the sheet → dismisses.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/(tabs)/progress.tsx
git commit -m "$(cat <<'EOF'
refactor(mobile): wire new MilestonesSection into Progress tab

Replaces the inline milestone block with the new component tree.
Removes the obsolete prop-drilling — MilestonesSection reads directly
from useLearnerState.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 21: Shared location capture utility

**Files:**
- Create: `apps/mobile/src/utils/location.ts`

- [ ] **Step 1: Implement**

```ts
// apps/mobile/src/utils/location.ts
import * as Location from 'expo-location';

export type CapturedCoords = {
  lat: number;
  lon: number;
  accuracy?: number;
};

/**
 * Best-effort foreground location capture for opt-in features.
 * Returns null on permission denial, hardware off, or timeout — never throws.
 */
export async function tryGetCoordsForCapture(): Promise<CapturedCoords | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? undefined,
    };
  } catch {
    return null;
  }
}
```

The mnemonics surface already uses an inline equivalent of this helper. Migrating those callers to `tryGetCoordsForCapture` is **out of scope for this task** but flagged for a follow-up.

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/utils/location.ts
git commit -m "$(cat <<'EOF'
feat(mobile): tryGetCoordsForCapture — shared opt-in location helper

Best-effort coord capture for milestones and mnemonics; returns null
on denial/timeout/error rather than throwing. Mnemonics migration to
this helper is a follow-up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 22: Profile setting toggle

**Files:**
- Modify: `apps/mobile/app/(tabs)/profile.tsx`
- (Possibly modify) underlying profile API client / store for the new boolean

- [ ] **Step 1: Read the existing toggle patterns**

Read [apps/mobile/app/(tabs)/profile.tsx](../../../apps/mobile/app/(tabs)/profile.tsx) lines 44-60 (state declarations) and find an existing toggle row like `notificationsEnabled` or `restDay`. Mirror its persistence pattern.

- [ ] **Step 2: Add the milestone-location toggle**

Add a new boolean state `attachLocationToMilestones` defaulting to false. Wire it to whichever profile-persistence hook the other toggles use. Add a row in the appropriate settings section (e.g., near other privacy controls):

```tsx
<SettingsRow
  label="Attach location to milestones"
  helperText="When on, your location is saved with each milestone you earn. Used for future personalisation."
  value={attachLocationToMilestones}
  onValueChange={async (next) => {
    if (next) {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        // user denied — keep toggle off
        return;
      }
    }
    setAttachLocationToMilestones(next);
    await saveProfile({ attachLocationToMilestones: next });
  }}
/>
```

Use whatever component / persistence call the existing toggles use — adapt the snippet. The setting may need to be added to the user profile schema and API; if so, that's part of this task.

- [ ] **Step 3: Manual smoke test**

Run the app. Toggle the setting ON — expect OS permission prompt. Deny permission — expect toggle to stay OFF (and no error). Grant permission, toggle on — expect persistence (refresh app, toggle remains ON).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/(tabs)/profile.tsx <other modified files>
git commit -m "$(cat <<'EOF'
feat(mobile): Profile setting — Attach location to milestones (default OFF)

New opt-in toggle. Enabling triggers the OS foreground-location
permission prompt; permission denial leaves the toggle OFF. Setting
is persisted alongside other profile preferences.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 23: Attach location to review submit

**Files:**
- Modify: `apps/mobile/src/stores/review.store.ts`
- Modify: `apps/api/src/routes/review.ts`
- Modify: `apps/api/src/services/srs.service.ts`

- [ ] **Step 1: Extend the review submit request body (mobile)**

In `review.store.ts` around line 302-304:
```ts
import { tryGetCoordsForCapture } from '../utils/location';
import { useProfile } from '../hooks/useProfile';  // or however the setting is exposed
// ...
const profile = useProfile.getState();  // or pull the setting via the appropriate accessor
let clientContext: { location?: { lat: number; lon: number; accuracy?: number } } | undefined;
if (profile.attachLocationToMilestones) {
  const coords = await tryGetCoordsForCapture();
  if (coords) clientContext = { location: coords };
}
const res = await api.post<...>('/v1/review/submit', { results, studyTimeMs, ...(clientContext ? { clientContext } : {}) });
```

Adjust the import path for the profile-setting accessor to match the project's actual hook/store.

- [ ] **Step 2: Extend the API schema**

In [apps/api/src/routes/review.ts](../../../apps/api/src/routes/review.ts) lines 10-23:
```ts
const clientContextSchema = z.object({
  location: z.object({
    lat: z.number(),
    lon: z.number(),
    accuracy: z.number().optional(),
  }).optional(),
}).optional();

const submitReviewSchema = z.object({
  results: z.array(reviewResultSchema).min(1).max(200),
  studyTimeMs: z.number().int().nonnegative(),
  clientContext: clientContextSchema,
});
```

In the handler body, when calling `srsService.submitReview(...)`, thread `clientContext.location` down:
```ts
await srsService.submitReview(userId, { results, studyTimeMs, location: clientContext?.location });
```

Adjust `srsService.submitReview` signature to accept the optional location, and pass it to `learnerStateService.refreshState(userId, { location })`.

- [ ] **Step 3: Server unit test for location persistence**

Append to `apps/api/test/integration/milestones-refresh.test.ts`:
```ts
it('persists location on newly created milestone entries when provided', async () => {
  // ... seed pre-deploy state with no recentMilestones, user with enough kanji burned
  //     to trigger a new threshold crossing on this refresh ...
  await svc.refreshState(TEST_USER_ID, { location: { lat: 35.6895, lon: 139.6917, accuracy: 12 } });
  const [row] = await db.select().from(learnerStateCache).where(eq(learnerStateCache.userId, TEST_USER_ID));
  const newest = row.recentMilestones[row.recentMilestones.length - 1];
  expect(newest.location).toEqual({ lat: 35.6895, lon: 139.6917, accuracy: 12 });
});

it('omits location when not provided', async () => {
  await svc.refreshState(TEST_USER_ID);
  const [row] = await db.select().from(learnerStateCache).where(eq(learnerStateCache.userId, TEST_USER_ID));
  for (const e of row.recentMilestones) expect(e.location).toBeUndefined();
});
```

- [ ] **Step 4: Run tests**

Run: `cd apps/api && npm test -- milestones-refresh`
Expected: PASS

- [ ] **Step 5: Manual end-to-end smoke**

With the milestone-location setting ON, do a review session in the simulator that crosses a new threshold. Inspect the DB row for that user's `learner_state_cache.recentMilestones` and verify the newest entry has a `location` field.

With the setting OFF, do another review session that crosses a threshold. Verify the new entries do **not** have a `location` field.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/stores/review.store.ts apps/api/src/routes/review.ts apps/api/src/services/srs.service.ts apps/api/test/integration/milestones-refresh.test.ts
git commit -m "$(cat <<'EOF'
feat: thread opt-in milestone location from mobile to server

Mobile: review.store attaches clientContext.location to the submit
request when the profile toggle is ON and capture succeeds.
API: submitReviewSchema accepts optional clientContext.location;
srs.service threads it to LearnerStateService.refreshState, which
stamps newly created milestone entries with the coordinates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

### Task 24: Final manual verification + acceptance walkthrough

This is a non-coding task: walk the acceptance criteria from §14 of the spec and confirm each.

- [ ] **Panel renders the 5 active categories** (Seen / Remembered / Burned / Streak / JLPT) with at most one badge each. Verify on a test account with realistic data.

- [ ] **Grade-level row renders up to 3 most-recently-earned tier badges.** Use a test account that has earned at least 4 grade-level milestones to confirm the cap. Tap each badge and verify the WCAG-AA contrast (run iOS Accessibility Inspector with "Audit" or the Android equivalent).

- [ ] **Up Next list shows the next threshold per non-maxed category**, with `current / target` progress for count categories.

- [ ] **Tap on a badge opens a bottom-sheet** with locale-formatted date OR "Earned before this update". Confirm both — one badge from a real crossing, one grandfathered.

- [ ] **Server detection runs idempotently** — trigger two reviews in quick succession and inspect `recentMilestones`; no duplicate entries.

- [ ] **First refresh after deploy for an existing user grandfathers** their current active state; subsequent crossings get real timestamps. Use a pre-deploy-cutoff seed account.

- [ ] **New users (no pre-deploy SRS history) skip the grandfather pass.** Use a fresh test account.

- [ ] **Tightened Bronze rule.** Construct a user state where `learning + reviewing == 0` and `(remembered + burned) > 0`, but `burned <= remembered`. Confirm Silver is earned but Bronze is NOT in `recentMilestones`.

- [ ] **Location toggle (default OFF), permission prompt, persistence.** Walk through enabling the toggle, granting permission, doing a review that crosses a threshold, verifying location is stamped. Disable toggle and verify subsequent threshold crossings have no location, while older entries are untouched.

- [ ] **iOS NSLocationWhenInUseUsageDescription** in [apps/mobile/app.json](../../../apps/mobile/app.json) is present (already in place). **Android ACCESS_COARSE_LOCATION** is present (already in place).

- [ ] **All tests green.**
  - `cd packages/shared && npm test` — PASS
  - `cd apps/api && npm test` — PASS
  - `cd apps/mobile && npm test` — PASS

- [ ] **No client-side `computeMilestones()` usage remains.** Run `git grep computeMilestones apps/mobile/` — expect zero hits.

If anything in the walkthrough fails, file a follow-up bug (do not patch silently — the discrepancy needs visibility).

---

## Self-review checklist (for plan author)

This is a checklist for the engineer reading the plan — confirm before starting:
- [ ] Every spec section maps to at least one task. (§4 ladders → T2; §5 display rules → T12; §7 data model → T1; §8 detection → T5/T6/T7/T9/T10; §9 migration → T9/T10; §10 mobile → T13–T20; §11 location → T21/T22/T23; §12 testing → T3/T5/T6/T7/T8/T11/T12/T19/T23; §13 decisions baked in; §14 acceptance → T24).
- [ ] No "TBD" / "fill in later" / placeholders.
- [ ] Type names consistent across tasks (`MilestoneEntry`, `SrsBucketCounts`, `CurrentCounts`, `tryGetCoordsForCapture`, `selectActiveBadges`, `computeUpNext`).
- [ ] Tests precede implementation in every code task.
- [ ] Each commit message includes both Co-Authored-By footers per repo convention.
- [ ] Deploy-cutoff env var (`MILESTONES_DEPLOY_CUTOFF_ISO`) is set at deploy time before the first real refresh runs against production data.
