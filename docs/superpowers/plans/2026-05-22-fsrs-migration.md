# FSRS Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SM-2 scheduler with hand-rolled FSRS-5, replay every existing user's `review_logs` to seed FSRS state, and rewire the Practice Loop's "maybe-slipping" trigger to use retrievability `R(t)`.

**Architecture:** All FSRS math is a pure-function module in `packages/shared/src/srs.ts` (file replacement, same path — keeps imports stable). Schema migration `0024` is a clean swap on `user_kanji_progress` plus additive columns on `review_logs`. A one-time local replay script (`scripts/replay-srs-fsrs.mjs`) walks every user's logs and writes fresh `(stability, difficulty, lapses, total_reviews, status, next_review_at, last_reviewed_at)`. The API service layer adopts the new types; `dual-write.service.ts` and a small set of touch-point files get a renaming sweep.

**Tech Stack:** TypeScript, Drizzle ORM, Postgres (Supabase), Vitest (shared/api), Node.js scripts.

**Spec:** [`docs/superpowers/specs/2026-05-22-fsrs-migration-design.md`](../specs/2026-05-22-fsrs-migration-design.md)

---

## File structure

**Created:**
- `packages/db/supabase/migrations/0024_fsrs_migration.sql` — schema migration
- `scripts/replay-srs-fsrs.mjs` — one-time backfill
- `docs/superpowers/runbooks/2026-05-22-fsrs-rollout.md` — operator runbook

**Replaced wholesale:**
- `packages/shared/src/srs.ts` — SM-2 → FSRS-5 math, same exports renamed
- `packages/shared/src/srs.test.ts` — new test suite (existing covers SM-2 cases that no longer apply)

**Modified:**
- `packages/db/src/schema.ts` — `userKanjiProgress` and `reviewLogs` column changes
- `packages/shared/src/constants.ts` — add FSRS constants, drop SM-2 ones
- `packages/shared/src/index.ts` — barrel re-exports adjust to new names if needed
- `apps/api/src/services/srs.service.ts` — `submitReview`, `getReviewQueue`, `getReadingQueue`
- `apps/api/src/services/buddy/dual-write.service.ts` — input-type fields + upsert columns
- `apps/api/src/cron.ts` — type sweep
- `apps/api/src/services/placement.service.ts` — type sweep
- `apps/api/src/routes/kanji.ts` — type sweep

**Intermediate state warning:** The branch will have type errors during tasks 3–7 (between when the schema changes and when each consumer is rewired). Each commit is internally consistent for the file(s) it touches; the branch-wide `tsc` only goes green again at Task 8. This is expected and called out in the verification steps.

---

## Task 1: FSRS module — types and pure helpers

**Files:**
- Replace: `packages/shared/src/srs.ts` (start by emptying the file)
- Create: `packages/shared/src/srs.test.ts`
- Modify: `packages/shared/src/constants.ts`

Pure functions and types only. No `calculateNextReview` yet; that's Task 2.

- [ ] **Step 1: Add FSRS constants to `packages/shared/src/constants.ts`**

Append (do not delete the SM-2 constants yet — Task 2 cleans them up):

```ts
// ─── FSRS-5 ─────────────────────────────────────────────────────────────────

/** Published FSRS-5 default weights (19 elements). Sourced from the FSRS-5
 *  reference implementation at open-spaced-repetition/ts-fsrs; verify the
 *  vector matches that repo's `default_w` at implementation time. */
export const DEFAULT_FSRS_WEIGHTS: readonly number[] = [
  0.40255, 1.18385, 3.173, 15.69105,
  7.1949, 0.5345,
  1.4604,
  0.0046,
  1.54575, 0.1192, 1.01925,
  1.9395, 0.11, 0.29605, 2.2698,
  0.2315, 2.9898,
  0.51655, 0.6621,
]

/** FSRS scheduling target — R at planned nextReviewAt. */
export const TARGET_RETENTION = 0.9

/** Threshold below which a Good/Easy self-grade is suspect and the quiz fires.
 *  Modulated by difficulty in srs.service.ts: threshold = base + coef·(D − 5). */
export const MAYBE_SLIPPING_BASE = 0.85
export const MAYBE_SLIPPING_D_COEFFICIENT = 0.01

/** Status thresholds in days of stability (ported from the SM-2 interval cuts). */
export const STATUS_LEARNING_MAX_DAYS = 7
export const STATUS_REVIEWING_MAX_DAYS = 21
export const STATUS_REMEMBERED_MAX_DAYS = 180
```

- [ ] **Step 2: Write the failing tests**

Replace `packages/shared/src/srs.test.ts` entirely with the following. Some tests reference functions that don't exist yet — that's the failure we want.

```ts
import { describe, it, expect } from 'vitest'
import {
  ratingFromQuality,
  statusFromStability,
  retrievability,
  type FsrsCard,
} from './srs'

describe('ratingFromQuality', () => {
  it('maps 0,1,2 → 1 (Again)', () => {
    expect(ratingFromQuality(0)).toBe(1)
    expect(ratingFromQuality(1)).toBe(1)
    expect(ratingFromQuality(2)).toBe(1)
  })
  it('maps 3 → 2 (Hard)', () => {
    expect(ratingFromQuality(3)).toBe(2)
  })
  it('maps 4 → 3 (Good)', () => {
    expect(ratingFromQuality(4)).toBe(3)
  })
  it('maps 5 → 4 (Easy)', () => {
    expect(ratingFromQuality(5)).toBe(4)
  })
})

describe('statusFromStability', () => {
  it('0 → learning (unseen sentinel)', () => {
    expect(statusFromStability(0)).toBe('learning')
  })
  it('below 7d → learning', () => {
    expect(statusFromStability(6.99)).toBe('learning')
  })
  it('at 7d boundary → reviewing', () => {
    expect(statusFromStability(7)).toBe('reviewing')
  })
  it('below 21d → reviewing', () => {
    expect(statusFromStability(20.99)).toBe('reviewing')
  })
  it('at 21d boundary → remembered', () => {
    expect(statusFromStability(21)).toBe('remembered')
  })
  it('below 180d → remembered', () => {
    expect(statusFromStability(179.99)).toBe('remembered')
  })
  it('at 180d boundary → burned', () => {
    expect(statusFromStability(180)).toBe('burned')
  })
})

describe('retrievability', () => {
  const baseDate = new Date('2026-05-22T00:00:00Z')
  const mkCard = (stability: number, lastReviewedAt: Date | null): FsrsCard => ({
    stability, difficulty: 5, lapses: 0, status: 'reviewing', lastReviewedAt,
  })

  it('returns 0 for unseen card (stability=0)', () => {
    expect(retrievability(mkCard(0, null), baseDate)).toBe(0)
  })
  it('returns 0 when lastReviewedAt is null', () => {
    expect(retrievability(mkCard(10, null), baseDate)).toBe(0)
  })
  it('returns 1 for elapsed=0', () => {
    expect(retrievability(mkCard(10, baseDate), baseDate)).toBeCloseTo(1, 5)
  })
  it('returns 0.9 when elapsed = stability (the FSRS target)', () => {
    const reviewedAt = new Date(baseDate.getTime() - 10 * 86400_000)
    expect(retrievability(mkCard(10, reviewedAt), baseDate)).toBeCloseTo(0.9, 5)
  })
  it('decays below 0.9 when past stability', () => {
    const reviewedAt = new Date(baseDate.getTime() - 20 * 86400_000)
    expect(retrievability(mkCard(10, reviewedAt), baseDate)).toBeLessThan(0.9)
  })
})
```

- [ ] **Step 3: Run tests, verify they fail**

```bash
cd packages/shared && pnpm vitest run srs
```

Expected: tests fail with "module has no exported member" or similar.

- [ ] **Step 4: Implement `packages/shared/src/srs.ts`**

Replace the file contents with:

```ts
import {
  STATUS_LEARNING_MAX_DAYS,
  STATUS_REVIEWING_MAX_DAYS,
  STATUS_REMEMBERED_MAX_DAYS,
} from './constants'
import type { SrsStatus } from './types'

// ─── Types ─────────────────────────────────────────────────────────────────

export type FsrsRating = 1 | 2 | 3 | 4  // Again | Hard | Good | Easy

export interface FsrsCard {
  /** Days. 0 = unseen sentinel. */
  stability: number
  /** 1..10. FSRS-5 midpoint is 5. */
  difficulty: number
  /** Number of `Again` events the card has received. */
  lapses: number
  status: SrsStatus
  lastReviewedAt: Date | null
}

export interface FsrsResult extends FsrsCard {
  nextReviewAt: Date
}

// ─── Boundary helpers ─────────────────────────────────────────────────────

/**
 * Map the app's 0–5 SM-2 quality scale to FSRS's 4-bucket rating.
 *   0,1,2 → 1 (Again)
 *   3     → 2 (Hard)
 *   4     → 3 (Good)
 *   5     → 4 (Easy)
 */
export function ratingFromQuality(quality: 0 | 1 | 2 | 3 | 4 | 5): FsrsRating {
  if (quality <= 2) return 1
  if (quality === 3) return 2
  if (quality === 4) return 3
  return 4
}

/**
 * Derive the user-visible `status` label from stability (in days).
 * Thresholds ported from the prior SM-2 interval cuts.
 */
export function statusFromStability(stability: number): SrsStatus {
  if (stability < STATUS_LEARNING_MAX_DAYS) return 'learning'
  if (stability < STATUS_REVIEWING_MAX_DAYS) return 'reviewing'
  if (stability < STATUS_REMEMBERED_MAX_DAYS) return 'remembered'
  return 'burned'
}

/**
 * Predicted recall probability at `atTime` for a card last reviewed at
 * `card.lastReviewedAt` with stability `card.stability`.
 *
 * Returns 0 for unseen cards (no stability or no last-review timestamp).
 * The Spec 2 bridge — pure function, no DB, no service.
 */
export function retrievability(card: FsrsCard, atTime: Date): number {
  if (card.stability <= 0 || card.lastReviewedAt == null) return 0
  const elapsedDays =
    (atTime.getTime() - card.lastReviewedAt.getTime()) / 86_400_000
  if (elapsedDays <= 0) return 1
  return Math.exp(Math.log(0.9) * elapsedDays / card.stability)
}
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
cd packages/shared && pnpm vitest run srs
```

Expected: all 18 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/srs.ts packages/shared/src/srs.test.ts packages/shared/src/constants.ts
git commit -m "$(cat <<'EOF'
feat(shared): add FSRS-5 types and pure helpers

Replaces SM-2 surface in srs.ts with FsrsCard/FsrsResult types and three
pure functions: ratingFromQuality (0–5 → 1–4 boundary mapper),
statusFromStability (interval-style label derived from days of stability),
and retrievability (R(t) = exp(ln(0.9) · t / S) — the Spec 2 bridge).

calculateNextReview lands in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 2: FSRS module — `calculateNextReview` and `createNewCard`

**Files:**
- Modify: `packages/shared/src/srs.ts`
- Modify: `packages/shared/src/srs.test.ts`
- Modify: `packages/shared/src/constants.ts` (drop SM-2 constants)

The math is the heart of FSRS-5. Reference implementation: [open-spaced-repetition/ts-fsrs `BasicScheduler`](https://github.com/open-spaced-repetition/ts-fsrs/blob/main/src/fsrs/algorithm.ts). The plan inlines the formulas; the implementer should also pull ts-fsrs into a scratch script and cross-validate a few sequences after the test vectors below pass.

- [ ] **Step 1: Add failing tests for `createNewCard` and `calculateNextReview`**

Append to `packages/shared/src/srs.test.ts`:

```ts
import { createNewCard, calculateNextReview } from './srs'

describe('createNewCard', () => {
  it('returns the unseen sentinel state', () => {
    const c = createNewCard()
    expect(c.stability).toBe(0)
    expect(c.difficulty).toBe(5)
    expect(c.lapses).toBe(0)
    expect(c.status).toBe('learning')
    expect(c.lastReviewedAt).toBeNull()
  })
})

describe('calculateNextReview — first review (initial state)', () => {
  const now = new Date('2026-05-22T00:00:00Z')
  const fresh = () => createNewCard()

  it('Again on a new card produces small S and high D', () => {
    const r = calculateNextReview(fresh(), 1, now)
    // FSRS-5 weight w[0] = 0.40255 → initial S for Again
    expect(r.stability).toBeCloseTo(0.40255, 4)
    expect(r.lapses).toBe(1)
    expect(r.difficulty).toBeGreaterThan(5)
    expect(r.lastReviewedAt).toEqual(now)
  })

  it('Good on a new card uses w[2] for initial stability', () => {
    const r = calculateNextReview(fresh(), 3, now)
    expect(r.stability).toBeCloseTo(3.173, 4)
    expect(r.lapses).toBe(0)
  })

  it('Easy on a new card uses w[3] for initial stability', () => {
    const r = calculateNextReview(fresh(), 4, now)
    expect(r.stability).toBeCloseTo(15.69105, 4)
    expect(r.lapses).toBe(0)
  })

  it('next_review_at sits ~stability days in the future (target R = 0.9)', () => {
    const r = calculateNextReview(fresh(), 3, now)
    const days = (r.nextReviewAt.getTime() - now.getTime()) / 86_400_000
    // For target R = 0.9, the interval should ~= stability days (with FSRS-5's
    // decay-adjusted scheduling); accept anything within ±1 day for the ~3.17d
    // initial Good stability.
    expect(days).toBeGreaterThan(2)
    expect(days).toBeLessThan(5)
  })

  it('status is derived from final stability', () => {
    const r = calculateNextReview(fresh(), 4, now)
    // Initial Easy stability ~15.7d → reviewing band (7..21)
    expect(r.status).toBe('reviewing')
  })
})

describe('calculateNextReview — subsequent reviews', () => {
  const t0 = new Date('2026-05-22T00:00:00Z')

  it('Again on a learned card drops stability sharply and increments lapses', () => {
    const card = createNewCard()
    const c1 = calculateNextReview(card, 3, t0)               // Good, day 0
    const t1 = new Date(c1.nextReviewAt)
    const c2 = calculateNextReview(c1, 1, t1)                  // Again, on time
    expect(c2.lapses).toBe(1)
    expect(c2.stability).toBeLessThan(c1.stability)
    expect(c2.difficulty).toBeGreaterThan(c1.difficulty)
  })

  it('Good on time grows stability', () => {
    const card = createNewCard()
    const c1 = calculateNextReview(card, 3, t0)
    const t1 = new Date(c1.nextReviewAt)
    const c2 = calculateNextReview(c1, 3, t1)
    expect(c2.stability).toBeGreaterThan(c1.stability)
    expect(c2.lapses).toBe(0)
  })

  it('Easy grows stability more than Good (easy_bonus)', () => {
    const card = createNewCard()
    const cGood = calculateNextReview(card, 3, t0)
    const cEasy = calculateNextReview(card, 4, t0)
    expect(cEasy.stability).toBeGreaterThan(cGood.stability)
  })

  it('Hard grows stability less than Good (hard_penalty)', () => {
    const card = createNewCard()
    const c0 = calculateNextReview(card, 3, t0)
    const t1 = new Date(c0.nextReviewAt)
    const cHard = calculateNextReview(c0, 2, t1)
    const cGood = calculateNextReview(c0, 3, t1)
    expect(cHard.stability).toBeLessThan(cGood.stability)
  })

  it('difficulty stays within [1, 10] under repeated extreme grades', () => {
    let card = createNewCard()
    let t = t0
    for (let i = 0; i < 20; i++) {
      card = calculateNextReview(card, 1, t)
      t = new Date(t.getTime() + 86_400_000)
    }
    expect(card.difficulty).toBeLessThanOrEqual(10)
    expect(card.difficulty).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run, verify failure**

```bash
cd packages/shared && pnpm vitest run srs
```

Expected: 18 passing (prior task), new tests fail with "createNewCard is not defined" / "calculateNextReview is not defined".

- [ ] **Step 3: Implement `createNewCard` and `calculateNextReview`**

Append to `packages/shared/src/srs.ts`:

```ts
import { DEFAULT_FSRS_WEIGHTS, TARGET_RETENTION } from './constants'

// ─── FSRS-5 algorithm ──────────────────────────────────────────────────────
//
// Reference: open-spaced-repetition/ts-fsrs BasicScheduler. The formulas
// below mirror that implementation. Weight vector indices match the FSRS-5
// paper (w[0..3] = initial stability per rating, w[4..5] = initial
// difficulty, w[6..7] = difficulty update, w[8..10] = success stability,
// w[11..14] = lapse stability, w[15..16] = hard/easy modifiers,
// w[17..18] = same-day short-term scheduler — unused here, see note below).

const W = DEFAULT_FSRS_WEIGHTS
const DECAY = -0.5
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1   // ≈ -0.9... used in interval calc

export function createNewCard(): FsrsCard {
  return {
    stability: 0,
    difficulty: 5,
    lapses: 0,
    status: 'learning',
    lastReviewedAt: null,
  }
}

/**
 * Apply one review to a card and return the updated state plus the next
 * scheduled review timestamp.
 *
 * - On `rating === 1` (Again), `lapses` is incremented internally — callers
 *   must NOT increment it themselves.
 * - `lastReviewedAt` is set to `now`.
 * - `nextReviewAt` is computed for target retention 0.9 (decay-adjusted).
 * - `status` is derived from the post-review stability.
 *
 * Same-day re-reviews (the FSRS-5 short-term scheduler using w[17..18]) are
 * not modelled — our submitReview path never issues two grades for the same
 * card in the same session. If that ever changes, port the short-term branch.
 */
export function calculateNextReview(
  card: FsrsCard,
  rating: FsrsRating,
  now: Date,
): FsrsResult {
  let stability: number
  let difficulty: number
  let lapses = card.lapses

  // ── First review: card.stability === 0 means unseen ──────────────────────
  if (card.stability <= 0 || card.lastReviewedAt == null) {
    stability = Math.max(W[rating - 1], 0.1)
    difficulty = clamp(W[4] - Math.exp(W[5] * (rating - 1)) + 1, 1, 10)
    if (rating === 1) lapses += 1
  } else {
    // ── Subsequent review ───────────────────────────────────────────────────
    const elapsedDays = Math.max(
      0,
      (now.getTime() - card.lastReviewedAt.getTime()) / 86_400_000,
    )
    const R = Math.exp(Math.log(0.9) * elapsedDays / card.stability)

    // Difficulty update: linear delta + mean reversion toward initial Good D
    const dDelta = -W[6] * (rating - 3)
    const dRaw = card.difficulty + dDelta
    const initDifficultyGood = W[4] - Math.exp(W[5] * (3 - 1)) + 1
    difficulty = clamp(W[7] * initDifficultyGood + (1 - W[7]) * dRaw, 1, 10)

    if (rating === 1) {
      // Lapse: stability shrinks per the failure formula, capped at current S.
      const sLapse =
        W[11] *
        Math.pow(card.difficulty, -W[12]) *
        (Math.pow(card.stability + 1, W[13]) - 1) *
        Math.exp((1 - R) * W[14])
      stability = Math.max(0.1, Math.min(sLapse, card.stability))
      lapses += 1
    } else {
      // Success: stability grows per the success formula with hard/easy
      // modifiers.
      const hardPenalty = rating === 2 ? W[15] : 1
      const easyBonus = rating === 4 ? W[16] : 1
      const sGrowth =
        1 +
        Math.exp(W[8]) *
          (11 - difficulty) *
          Math.pow(card.stability, -W[9]) *
          (Math.exp((1 - R) * W[10]) - 1) *
          hardPenalty *
          easyBonus
      stability = card.stability * sGrowth
    }
  }

  // Interval = S · ((R_target ^ (1/decay)) − 1) / factor
  // For target = 0.9, this simplifies to stability days exactly.
  const intervalDays = (stability * (Math.pow(TARGET_RETENTION, 1 / DECAY) - 1)) / FACTOR
  const nextReviewAt = new Date(now.getTime() + Math.max(1, intervalDays) * 86_400_000)

  return {
    stability,
    difficulty,
    lapses,
    status: statusFromStability(stability),
    lastReviewedAt: now,
    nextReviewAt,
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi)
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd packages/shared && pnpm vitest run srs
```

Expected: all tests (initial + new) pass.

- [ ] **Step 5: Cross-validate against ts-fsrs in a scratch script**

In a scratch directory (NOT committed), install `ts-fsrs` and run a small comparison:

```bash
mkdir /tmp/fsrs-check && cd /tmp/fsrs-check && pnpm init -y && pnpm add ts-fsrs
```

```ts
// /tmp/fsrs-check/compare.mjs
import { FSRS, generatorParameters, Rating, createEmptyCard } from 'ts-fsrs'
const params = generatorParameters({ enable_fuzz: false, w: [/* paste our 19 weights */] })
const f = new FSRS(params)
const card = createEmptyCard()
const now = new Date('2026-05-22T00:00:00Z')
const result = f.next(card, now, Rating.Good)
console.log('ts-fsrs S:', result.card.stability, 'D:', result.card.difficulty)
```

Compare the printed `stability` and `difficulty` against `calculateNextReview(createNewCard(), 3, now)` from our implementation. They should match to 4 decimal places for a Good first review.

If they diverge: re-check the difficulty initial formula sign convention and the order of operations in `sGrowth`. The most likely culprit is the `(rating - 3)` vs `-(rating - 3)` sign on `dDelta`.

- [ ] **Step 6: Drop the SM-2 constants**

In `packages/shared/src/constants.ts`, delete `SRS_INITIAL_EASE_FACTOR`, `SRS_MIN_EASE_FACTOR`, `SRS_MAX_EASE_FACTOR` and any other SM-2-only constants. (Keep `SURPRISE_BURNED_CHECK_RATE` — orthogonal.)

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/srs.ts packages/shared/src/srs.test.ts packages/shared/src/constants.ts
git commit -m "$(cat <<'EOF'
feat(shared): add FSRS-5 calculateNextReview and createNewCard

Implements the FSRS-5 update rules — initial state (w[0..5]), difficulty
update with mean reversion (w[6..7]), stability growth on success
(w[8..10], modulated by w[15..16]), and lapse stability (w[11..14]).
Drops the SM-2 ease-factor constants from constants.ts.

Cross-validated against open-spaced-repetition/ts-fsrs at the published
default weights.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 3: Drizzle schema + migration `0024`

**Files:**
- Modify: `packages/db/src/schema.ts` lines 192–207 (`userKanjiProgress`) and 245–261 (`reviewLogs`)
- Create: `packages/db/supabase/migrations/0024_fsrs_migration.sql`

After this task lands, `apps/api/**` will not type-check until subsequent tasks rewire the consumers. That is expected.

- [ ] **Step 1: Edit `packages/db/src/schema.ts` — userKanjiProgress columns**

Replace lines 194–196:

```ts
    easeFactor: real('ease_factor').notNull().default(2.5),
    interval: integer('interval').notNull().default(0), // days
    repetitions: integer('repetitions').notNull().default(0),
```

with:

```ts
    stability: real('stability').notNull().default(0),
    difficulty: real('difficulty').notNull().default(5),
    lapses: integer('lapses').notNull().default(0),
    totalReviews: integer('total_reviews').notNull().default(0),
```

Leave the rest of the table (status, readingStage, nextReviewAt, lastReviewedAt, createdAt, updatedAt, indexes) untouched.

- [ ] **Step 2: Edit `packages/db/src/schema.ts` — reviewLogs columns**

After the `nextInterval: integer('next_interval').notNull(),` line (line 252), add:

```ts
    prevStability: real('prev_stability'),
    nextStability: real('next_stability'),
    prevDifficulty: real('prev_difficulty'),
    nextDifficulty: real('next_difficulty'),
```

All four are nullable so existing rows stay valid.

- [ ] **Step 3: Write the migration SQL**

Create `packages/db/supabase/migrations/0024_fsrs_migration.sql`:

```sql
-- Migration 0024: FSRS-5 schema swap.
-- Adds FSRS state columns; drops SM-2 state columns from user_kanji_progress.
-- review_logs gains nullable FSRS columns (history rows stay null).
-- Must be paired with packages/shared/src/srs.ts FSRS-5 implementation and
-- the scripts/replay-srs-fsrs.mjs backfill — see the rollout runbook.

BEGIN;

-- ── user_kanji_progress ────────────────────────────────────────────────────
ALTER TABLE user_kanji_progress
  ADD COLUMN stability      real    NOT NULL DEFAULT 0,
  ADD COLUMN difficulty     real    NOT NULL DEFAULT 5,
  ADD COLUMN lapses         integer NOT NULL DEFAULT 0,
  ADD COLUMN total_reviews  integer NOT NULL DEFAULT 0;

ALTER TABLE user_kanji_progress
  DROP COLUMN ease_factor,
  DROP COLUMN interval,
  DROP COLUMN repetitions;

-- ── review_logs ────────────────────────────────────────────────────────────
ALTER TABLE review_logs
  ADD COLUMN prev_stability   real,
  ADD COLUMN next_stability   real,
  ADD COLUMN prev_difficulty  real,
  ADD COLUMN next_difficulty  real;

COMMIT;
```

- [ ] **Step 4: Apply migration to a LOCAL Supabase DB and run drizzle-kit check**

Apply the migration to a local Postgres (NOT the live DB — that happens in the rollout runbook):

```bash
# From a local Postgres set up with the kanji-learn schema (see packages/db/README)
psql -d kanji_learn_dev -f packages/db/supabase/migrations/0024_fsrs_migration.sql
```

Then verify Drizzle's generated types match:

```bash
cd packages/db && pnpm drizzle-kit check
```

Expected: no schema drift.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/supabase/migrations/0024_fsrs_migration.sql
git commit -m "$(cat <<'EOF'
feat(db): migration 0024 — FSRS schema swap

Adds stability/difficulty/lapses/total_reviews to user_kanji_progress and
drops ease_factor/interval/repetitions. Adds nullable
prev/next_stability/difficulty to review_logs.

This commit alone breaks apps/api typecheck — consumers are rewired in
the following commits. The branch goes green again at Task 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 4: Replay script (`scripts/replay-srs-fsrs.mjs`)

**Files:**
- Create: `scripts/replay-srs-fsrs.mjs`

The replay reads review_logs and writes fresh FSRS state into user_kanji_progress. It runs locally from the dev machine against Supabase. No service deps — it imports `calculateNextReview` and `ratingFromQuality` from the local checkout's shared package and uses `pg` or `postgres` directly.

- [ ] **Step 1: Verify which Postgres client matches existing scripts AND how shared is consumed**

```bash
grep -l "postgres-js\|'pg'\|node-postgres" scripts/*.mjs
head -30 scripts/run-migration-0023.mjs
```

Mirror `scripts/run-migration-0023.mjs` for both (a) the Postgres client choice (`pg` vs `postgres-js`) and (b) how it imports from the monorepo. The skeleton below uses `postgres` and imports FSRS math via `../packages/shared/dist/srs.js` — but if `0023` runs with `tsx`/loader-rewrite or imports from `src/`, follow that pattern instead. Confirm by running the dry-run in Step 3; iterate until the imports resolve cleanly.

- [ ] **Step 2: Write the script**

Create `scripts/replay-srs-fsrs.mjs`:

```js
#!/usr/bin/env node
/**
 * Replay every user's review_logs through FSRS-5 and write fresh
 * (stability, difficulty, lapses, total_reviews, status, next_review_at,
 * last_reviewed_at) into user_kanji_progress.
 *
 * One-time backfill for the FSRS migration. Idempotent — re-running produces
 * the same end state.
 *
 * Flags:
 *   --dry-run        Print the first 10 users' computed state, write nothing.
 *   --user <uuid>    Restrict to one user (useful for spot-checks).
 *
 * Run AFTER migration 0024 has been applied to the target DB.
 */

import 'dotenv/config'
import postgres from 'postgres'   // or pg; match scripts/run-migration-0023.mjs
import {
  calculateNextReview,
  createNewCard,
  ratingFromQuality,
  statusFromStability,
} from '../packages/shared/dist/srs.js'  // or src — match repo's run convention

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const userIdx = args.indexOf('--user')
const SINGLE_USER = userIdx >= 0 ? args[userIdx + 1] : null

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' })

async function main() {
  const users = SINGLE_USER
    ? [{ id: SINGLE_USER }]
    : await sql`SELECT id FROM user_profiles`

  console.log(`Replaying ${users.length} user(s)${DRY_RUN ? ' (DRY RUN)' : ''}`)

  let dryPrinted = 0

  for (const user of users) {
    const logs = await sql`
      SELECT kanji_id, quality, reviewed_at
        FROM review_logs
       WHERE user_id = ${user.id}
       ORDER BY reviewed_at ASC
    `
    // Group by kanji
    const byKanji = new Map()
    for (const log of logs) {
      const arr = byKanji.get(log.kanji_id) ?? []
      arr.push(log)
      byKanji.set(log.kanji_id, arr)
    }

    const updates = []
    for (const [kanjiId, kLogs] of byKanji) {
      let card = createNewCard()
      for (const log of kLogs) {
        const rating = ratingFromQuality(log.quality)
        card = calculateNextReview(card, rating, new Date(log.reviewed_at))
      }
      updates.push({
        userId: user.id,
        kanjiId,
        stability: card.stability,
        difficulty: card.difficulty,
        lapses: card.lapses,
        totalReviews: kLogs.length,
        status: card.status,
        nextReviewAt: card.nextReviewAt,
        lastReviewedAt: card.lastReviewedAt,
      })
    }

    if (DRY_RUN) {
      if (dryPrinted < 10) {
        console.log(`\nUser ${user.id} — ${updates.length} card(s):`)
        for (const u of updates.slice(0, 5)) {
          console.log(`  kanji ${u.kanjiId}: S=${u.stability.toFixed(2)} D=${u.difficulty.toFixed(2)} lapses=${u.lapses} status=${u.status} next=${u.nextReviewAt?.toISOString().slice(0, 10)}`)
        }
        if (updates.length > 5) console.log(`  ... and ${updates.length - 5} more`)
        dryPrinted++
      }
      continue
    }

    // UPSERT each row. Bulk-insert would be faster but the dataset is tiny.
    for (const u of updates) {
      await sql`
        UPDATE user_kanji_progress
           SET stability       = ${u.stability},
               difficulty      = ${u.difficulty},
               lapses          = ${u.lapses},
               total_reviews   = ${u.totalReviews},
               status          = ${u.status},
               next_review_at  = ${u.nextReviewAt},
               last_reviewed_at = ${u.lastReviewedAt},
               updated_at      = NOW()
         WHERE user_id = ${u.userId} AND kanji_id = ${u.kanjiId}
      `
    }
    console.log(`User ${user.id}: replayed ${updates.length} card(s)`)
  }

  await sql.end()
  console.log(DRY_RUN ? '\nDry run complete.' : '\nReplay complete.')
}

main().catch((err) => { console.error(err); process.exit(1) })
```

(If the existing scripts use `pg` instead of `postgres`, swap the import and adjust query syntax. Keep behavior identical.)

- [ ] **Step 3: Smoke test against a local DB clone**

```bash
node scripts/replay-srs-fsrs.mjs --dry-run
```

Expected: prints up to 10 users' first 5 cards each, no errors, no writes.

- [ ] **Step 4: Hand-replay one kanji to verify**

Pick a user/kanji pair from the dry-run output. Query its review_logs:

```bash
psql "$DATABASE_URL" -c "SELECT quality, reviewed_at FROM review_logs WHERE user_id='<uuid>' AND kanji_id=<id> ORDER BY reviewed_at"
```

In a Node REPL, replay by hand using the same logic and confirm the script's S/D/lapses match.

- [ ] **Step 5: Commit**

```bash
git add scripts/replay-srs-fsrs.mjs
git commit -m "$(cat <<'EOF'
feat(scripts): one-time replay backfill for FSRS migration

Walks every user's review_logs chronologically per kanji, applies FSRS-5
updates, and writes the resulting (S, D, lapses, total_reviews, status,
next_review_at, last_reviewed_at) to user_kanji_progress. Idempotent;
supports --dry-run and --user <uuid>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 5: Rewire `srs.service.ts` — submitReview

**Files:**
- Modify: `apps/api/src/services/srs.service.ts` — `submitReview` method (lines ~321–461)

Switch from SM-2 fields to FSRS state. Calls into the new `calculateNextReview` from `@kanji-learn/shared`.

- [ ] **Step 1: Update imports**

At the top of `apps/api/src/services/srs.service.ts`, replace:

```ts
import { calculateNextReview, createNewCard } from '@kanji-learn/shared'
```

with:

```ts
import {
  calculateNextReview,
  createNewCard,
  ratingFromQuality,
  retrievability,
  MAYBE_SLIPPING_BASE,
  MAYBE_SLIPPING_D_COEFFICIENT,
  type FsrsCard,
} from '@kanji-learn/shared'
```

- [ ] **Step 2: Rewrite the per-result loop in `submitReview`**

Locate lines ~399–448 (`for (const result of results) { ... }`). Replace with:

```ts
    for (const result of results) {
      const existing = existingByKanjiId.get(result.kanjiId)
      const prevCard: FsrsCard = existing
        ? {
            stability: existing.stability,
            difficulty: existing.difficulty,
            lapses: existing.lapses,
            status: existing.status ?? 'learning',
            lastReviewedAt: existing.lastReviewedAt,
          }
        : createNewCard()
      const prevStatus = prevCard.status
      const rating = ratingFromQuality(result.quality)
      const fsrsResult = calculateNextReview(prevCard, rating, now)

      if (result.quality >= 4) correctItems++
      if (prevStatus === 'unseen' || existing === undefined) newLearned++
      if (fsrsResult.status === 'burned' && prevStatus !== 'burned') burned++

      const prevReadingStage = existing?.readingStage ?? 0
      const nextReadingStage = this.advanceReadingStage(
        prevReadingStage,
        fsrsResult.status,
        result.quality,
      )

      const character = charById.get(result.kanjiId)
      if (!character) {
        throw new Error(`SrsService.submitReview: unknown kanjiId ${result.kanjiId}`)
      }

      // Derived interval for back-compat with review_logs.prev_interval /
      // next_interval (so anything still reading "interval" keeps working).
      const prevIntervalDays = Math.max(1, Math.round(prevCard.stability))
      const nextIntervalDays = Math.max(1, Math.round(fsrsResult.stability))

      submissionInputs.push({
        userId,
        kanjiId: result.kanjiId,
        kanjiCharacter: character,
        sessionId,
        reviewType: result.reviewType,
        quality: result.quality,
        responseTimeMs: result.responseTimeMs,
        prevStatus: prevStatus,
        prevInterval: prevIntervalDays,
        prevStability: prevCard.stability,
        prevDifficulty: prevCard.difficulty,
        progressAfter: {
          status: fsrsResult.status,
          stability: fsrsResult.stability,
          difficulty: fsrsResult.difficulty,
          lapses: fsrsResult.lapses,
          totalReviews: (existing?.totalReviews ?? 0) + 1,
          nextReviewAt: fsrsResult.nextReviewAt,
          nextInterval: nextIntervalDays,
          readingStage: nextReadingStage,
        },
      })
    }
```

(The `ReviewSubmissionInput` interface in `dual-write.service.ts` changes in Task 7; this code compiles after that task.)

- [ ] **Step 3: Don't run typecheck yet**

Note: `pnpm tsc -b` will fail until Task 7 lands. That's expected — call out in the commit.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/srs.service.ts
git commit -m "$(cat <<'EOF'
feat(api): rewire submitReview to FSRS-5 state

Boundary mapping at the API entry: quality (0–5) → FSRS rating (1–4) via
ratingFromQuality. Pulls FSRS-shaped card from user_kanji_progress; runs
calculateNextReview; submits prev/next stability/difficulty alongside the
back-compat prev/next interval fields.

Branch typecheck remains broken until Task 7 rewires dual-write.service.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 6: Rewire `srs.service.ts` — getReviewQueue and getReadingQueue

**Files:**
- Modify: `apps/api/src/services/srs.service.ts` — `getReviewQueue` (lines ~111–295) and `getReadingQueue` (lines ~530–610)
- Delete: `apps/api/src/services/srs.service.ts:86-99` — `RECENT_REVIEW_WINDOW`, `isRecentlyShaky` (no longer used; the heuristic is gone)
- Modify: `apps/api/test/unit/srs.service.test.ts` or equivalent — remove `isRecentlyShaky` tests

The maybe-slipping check moves from "recent grades" to "R(now) < threshold modulated by difficulty."

- [ ] **Step 1: Update column selection in `getReviewQueue`**

In each of the three select statements (lines ~115–134 dueCards, ~211–230 burnedChecks, plus the new newCardRows handling), add to the column list (alongside `status`, `readingStage`):

```ts
        stability: userKanjiProgress.stability,
        difficulty: userKanjiProgress.difficulty,
        lapses: userKanjiProgress.lapses,
        totalReviews: userKanjiProgress.totalReviews,
        lastReviewedAt: userKanjiProgress.lastReviewedAt,
```

`newCardRows` selects from `kanji` (no progress row yet), so these fields default to FSRS unseen state in `mapNew` (see Step 3).

- [ ] **Step 2: Replace the `isRecentlyShaky` block (lines ~187–207)**

Delete the whole `recentLogs` query and the `gradesByKanji` / `shakyKanji` loops. Replace with a per-card predicate evaluated inline in `mapDue`:

```ts
    const slippingThreshold = (difficulty: number) =>
      MAYBE_SLIPPING_BASE + MAYBE_SLIPPING_D_COEFFICIENT * (difficulty - 5)

    const isSlipping = (c: { stability: number; difficulty: number; lapses: number; lastReviewedAt: Date | null }): boolean => {
      const card: FsrsCard = {
        stability: c.stability,
        difficulty: c.difficulty,
        lapses: c.lapses,
        status: 'reviewing',  // unused by retrievability()
        lastReviewedAt: c.lastReviewedAt,
      }
      return retrievability(card, now) < slippingThreshold(c.difficulty)
    }
```

Update `mapDue` to use it:

```ts
    const mapDue = (c: (typeof dueCards)[number]) => ({
      ...c,
      status: c.status ?? 'learning',
      readingStage: c.readingStage ?? 0,
      reviewType: this.pickReviewType(c.readingStage ?? 0, c.status ?? 'learning'),
      maybeSlipping: isSlipping(c),
      // ... unchanged array-coercion fields ...
    })
```

`mapBurned` keeps `maybeSlipping: true` unconditionally (the burned-sample surprise check is orthogonal — see spec §6.2).

`mapNew` has no FSRS state yet — set `maybeSlipping: false` for safety though the front-end won't trigger a quiz on new kanji anyway.

- [ ] **Step 3: Remove the now-dead helpers**

Delete `RECENT_REVIEW_WINDOW` and `isRecentlyShaky` from the top of the file (lines ~86–99). Keep `planQueueSlots` and `NEW_KANJI_FLOOR` — those are orthogonal.

- [ ] **Step 4: Update `getReadingQueue` to use `totalReviews`**

Two callsites (the scoped and unscoped paths) reference `r.repetitions`. Replace with `r.totalReviews ?? 0`.

In the select lists, replace:

```ts
repetitions: userKanjiProgress.repetitions,
```

with:

```ts
totalReviews: userKanjiProgress.totalReviews,
```

The variable used in `selectVoicePrompt(exampleVocab, r.repetitions, r.character)` becomes `selectVoicePrompt(exampleVocab, r.totalReviews ?? 0, r.character)`.

- [ ] **Step 5: Update / remove the orphaned isRecentlyShaky unit tests**

```bash
grep -n "isRecentlyShaky\|RECENT_REVIEW_WINDOW" apps/api/test -r
```

Delete the corresponding tests. Add a new test for the FSRS-based slipping check inline if your shop's pattern is to test predicates at the service level (this codebase tends to test math in shared/, integration in api/).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/srs.service.ts apps/api/test
git commit -m "$(cat <<'EOF'
feat(api): rewire getReviewQueue + getReadingQueue to FSRS

getReviewQueue: replace the isRecentlyShaky heuristic with an in-memory
retrievability check — maybeSlipping = R(now) < 0.85 + 0.01·(D−5). The
windowed reviewLogs fetch (perf follow-up on the housekeeping queue) is
eliminated.

getReadingQueue: voice-prompt rotation indexes off total_reviews instead
of the dropped repetitions column.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 7: Rewire `dual-write.service.ts`

**Files:**
- Modify: `apps/api/src/services/buddy/dual-write.service.ts`

Three things need updating: the `ReviewSubmissionInput` type, the row construction logic for `user_kanji_progress` writes, and the `excluded.*` columns in upsert clauses.

- [ ] **Step 1: Find every SM-2 field reference**

```bash
grep -n "easeFactor\|interval\b\|repetitions\|ease_factor\|repetitions\b" apps/api/src/services/buddy/dual-write.service.ts
```

Expect hits at lines 31–32, 62–64, 123, 131–133, 142, 212, 224–226, 236–238, 253, 324–326.

- [ ] **Step 2: Update the input type around line 31**

Change the inner `progressAfter` type to:

```ts
    progressAfter: {
      status: SrsStatus
      stability: number
      difficulty: number
      lapses: number
      totalReviews: number
      nextReviewAt: Date
      nextInterval: number    // derived; kept for review_logs back-compat
      readingStage: number
    }
```

And add a `prevStability: number` and `prevDifficulty: number` to the top-level input alongside the existing `prevInterval: number`.

- [ ] **Step 3: Update the row construction (lines ~123–142 and the ~212–253 parallel singular path)**

Where the code builds the `userKanjiProgress` upsert row, replace `easeFactor`/`interval`/`repetitions` writes with:

```ts
        stability: input.progressAfter.stability,
        difficulty: input.progressAfter.difficulty,
        lapses: input.progressAfter.lapses,
        totalReviews: input.progressAfter.totalReviews,
```

Where the code builds the `reviewLogs` row (lines ~117, ~204), add:

```ts
        prevStability: input.prevStability,
        nextStability: input.progressAfter.stability,
        prevDifficulty: input.prevDifficulty,
        nextDifficulty: input.progressAfter.difficulty,
```

`prevInterval` and `nextInterval` writes stay — they're the derived back-compat values populated upstream.

- [ ] **Step 4: Update the `excluded.*` upsert clauses (lines ~324–326)**

Replace:

```ts
            easeFactor: sql`excluded.ease_factor`,
            interval: sql`excluded.interval`,
            repetitions: sql`excluded.repetitions`,
```

with:

```ts
            stability: sql`excluded.stability`,
            difficulty: sql`excluded.difficulty`,
            lapses: sql`excluded.lapses`,
            totalReviews: sql`excluded.total_reviews`,
```

- [ ] **Step 5: Run typecheck — should go green now**

```bash
pnpm tsc -b
```

Expected: no errors across the workspace. If there are residual hits, they're for Task 8's touch-point sweep — note them for that task but verify the api package itself type-checks now.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/buddy/dual-write.service.ts
git commit -m "$(cat <<'EOF'
feat(api): rewire dual-write service to FSRS state

ReviewSubmissionInput now carries prev_stability/prev_difficulty and a
progressAfter shaped as { status, stability, difficulty, lapses,
total_reviews, next_review_at, next_interval, reading_stage }. The
user_kanji_progress upsert writes the FSRS columns and the excluded.*
clauses follow suit.

review_logs continues to receive prev/next_interval as a derived
back-compat value alongside the new prev/next_stability/difficulty fields.

Branch typecheck is green again as of this commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 8: Touch-point sweep — cron, placement, kanji route

**Files:**
- Modify: `apps/api/src/cron.ts` (FSRS references — likely type imports)
- Modify: `apps/api/src/services/placement.service.ts` (FSRS references)
- Modify: `apps/api/src/routes/kanji.ts` (FSRS references)

These were the remaining files that grep'd as containing SM-2 names. The changes are mostly type-import renames and any places where these files happen to read FSRS-related columns directly.

- [ ] **Step 1: Find residual SM-2 references**

```bash
grep -n "easeFactor\|repetitions\|interval\b" apps/api/src/cron.ts apps/api/src/services/placement.service.ts apps/api/src/routes/kanji.ts
```

For each hit, decide:
- Type-import rename → straightforward edit.
- Column read from `user_kanji_progress` → replace with `stability` / `difficulty` / `lapses` / `total_reviews` as semantically appropriate. Most likely none of these three files actually need the column — they reference shared types only.

- [ ] **Step 2: Apply edits one file at a time, running typecheck after each**

```bash
pnpm tsc -b
```

Expected after all three files: zero errors.

- [ ] **Step 3: Update test fixtures that construct SM-2 progress rows**

Three test files are known to reference SM-2 field names in their fixtures and will fail until updated:

- `apps/api/test/integration/backfill.test.ts`
- `apps/api/test/integration/dual-write.test.ts`
- `apps/api/test/unit/buddy/dual-write-batched.test.ts`

For each, grep for `easeFactor|interval:|repetitions` within the file. Where fixtures construct `userKanjiProgress` rows or `ReviewSubmissionInput` objects, replace the SM-2 fields with the FSRS equivalents:

- `easeFactor: 2.5` → drop
- `interval: N` → drop from `userKanjiProgress` inserts; keep on `review_logs` inserts as back-compat
- `repetitions: N` → `totalReviews: N`
- Add `stability: N`, `difficulty: 5`, `lapses: 0` to `userKanjiProgress` inserts
- For `ReviewSubmissionInput` fixtures, mirror the new shape from Task 7

- [ ] **Step 4: Run the API test suite**

```bash
cd apps/api && pnpm test
```

Expected: existing 236 tests still pass. (One pre-existing failure is allowed: `apps/api/test/integration/social-mute.test.ts:25` — flagged on the housekeeping queue, unrelated.)

If anything red beyond that: dig in. Most likely remaining cause is another fixture file the grep in Step 3 missed.

- [ ] **Step 5: Run the shared test suite**

```bash
cd packages/shared && pnpm test
```

Expected: all FSRS unit tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "$(cat <<'EOF'
chore(api): sweep remaining SM-2 type references to FSRS

cron.ts, placement.service.ts, and kanji.ts route updated. Full
workspace typecheck green; api 236/236 + shared FSRS tests pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 9: Integration test — maybe-slipping under FSRS

**Files:**
- Create or modify: `apps/api/test/integration/srs-maybe-slipping.test.ts`

A focused integration test that constructs cards at known (S, D, lastReviewedAt) and asserts the `maybeSlipping` flag in `getReviewQueue` output.

- [ ] **Step 1: Write the test**

Mirror the structure of existing integration tests (look at `apps/api/test/integration/` for the helper pattern — DB setup, user creation, kanji seeding).

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { SrsService } from '../../src/services/srs.service'
// ... existing test helpers — see other integration files

describe('getReviewQueue — FSRS maybe-slipping', () => {
  // Each test constructs a card at a specific (S, D, lastReviewedAt) and
  // asserts maybeSlipping is set per: R(now) < 0.85 + 0.01·(D − 5).

  it('does NOT flag an on-time review at default D', async () => {
    // S = 10, D = 5, lastReviewedAt = now − 10 days → R(now) = 0.9
    // Threshold = 0.85 + 0 = 0.85. R = 0.9 > 0.85 → not slipping.
    // ... seed user_kanji_progress + due-now nextReviewAt
    const queue = await srs.getReviewQueue(userId)
    expect(queue.find((c) => c.kanjiId === testKanjiId)?.maybeSlipping).toBe(false)
  })

  it('flags an overdue review (R < 0.85) at default D', async () => {
    // S = 10, D = 5, lastReviewedAt = now − 20 days → R ≈ 0.81
    const queue = await srs.getReviewQueue(userId)
    expect(queue.find((c) => c.kanjiId === testKanjiId)?.maybeSlipping).toBe(true)
  })

  it('flags an on-time review for a HIGH-difficulty card', async () => {
    // S = 10, D = 9, lastReviewedAt = now − 10 days → R = 0.9
    // Threshold = 0.85 + 0.01·4 = 0.89. R = 0.9 > 0.89 → not slipping (just barely).
    // Now push to slightly overdue: lastReviewedAt = now − 11 days → R ≈ 0.886
    // R < 0.89 → flagged.
    // ... assert
  })

  it('does NOT flag a freshly-reviewed Easy card (low D, large S)', async () => {
    // S = 50, D = 3, lastReviewedAt = now → R = 1.0; threshold ≈ 0.83 → not slipping.
    // ... assert
  })

  it('always flags burned-sample surprise checks regardless of R', async () => {
    // status = 'burned'; orthogonal to R signal.
    // ... assert maybeSlipping === true on the burned-check entries
  })
})
```

- [ ] **Step 2: Run, verify**

```bash
cd apps/api && pnpm vitest run srs-maybe-slipping
```

Expected: all 5 cases pass.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/integration/srs-maybe-slipping.test.ts
git commit -m "$(cat <<'EOF'
test(api): integration coverage for FSRS maybe-slipping trigger

Five table-driven cases pinning the behaviour of the R-based maybe-slipping
predicate in getReviewQueue: on-time vs overdue, low vs high difficulty,
burned-sample override.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 10: Rollout runbook

**Files:**
- Create: `docs/superpowers/runbooks/2026-05-22-fsrs-rollout.md`

This is the operator's checklist for the actual production rollout. Not code — but every minute saved during the maintenance window matters.

- [ ] **Step 1: Write the runbook**

Create `docs/superpowers/runbooks/2026-05-22-fsrs-rollout.md`:

```markdown
# FSRS Migration Rollout

Spec: docs/superpowers/specs/2026-05-22-fsrs-migration-design.md
Plan: docs/superpowers/plans/2026-05-22-fsrs-migration.md

## Pre-rollout (on the feature branch, before merge)

- [ ] All tasks 1–9 committed; workspace typecheck green
- [ ] `pnpm test` in `packages/shared` — green
- [ ] `pnpm test` in `apps/api` — 236/236 (modulo the known social-mute pre-existing failure)
- [ ] Branch rebased onto latest `main`
- [ ] Code review pass

## Clone-rehearsal (production-shape dry run)

- [ ] Take a fresh dump of the live Supabase DB
- [ ] Restore to a local clone
- [ ] Apply `0024_fsrs_migration.sql` to the clone
- [ ] Run `node scripts/replay-srs-fsrs.mjs --dry-run` against the clone — check no errors, output looks sane
- [ ] Run `node scripts/replay-srs-fsrs.mjs` against the clone (full write)
- [ ] Spot-check 5 kanji per user: query `review_logs` for that user/kanji, hand-replay in a Node REPL using `calculateNextReview`, confirm S/D/lapses match the row in `user_kanji_progress`
- [ ] Spin up the API locally against the clone DB; hit `GET /v1/review/queue` for a known user; confirm the response shape, no errors

## Production rollout — MAINTENANCE WINDOW OPENS

Estimated time: 5–10 minutes for the current dataset size.

- [ ] Apply migration 0024 to live DB: `psql "$LIVE_DATABASE_URL" -f packages/db/supabase/migrations/0024_fsrs_migration.sql`
- [ ] Run replay against live DB: `DATABASE_URL=$LIVE_DATABASE_URL node scripts/replay-srs-fsrs.mjs`
- [ ] Confirm replay completed without errors
- [ ] Deploy the API: `./scripts/deploy-api.sh`
- [ ] Wait for App Runner rollout to complete (poll the console, ~5–10 min from trigger)
- [ ] Hit `GET https://73x3fcaaze.us-east-1.awsapprunner.com/v1/review/status` for a known user — confirm a response

## MAINTENANCE WINDOW CLOSES

## Mobile

- [ ] Cut TestFlight build B135: `cd apps/mobile && eas build --platform ios --profile production --non-interactive`
- [ ] Submit: `eas submit --platform ios --latest --non-interactive`
- [ ] Wait for Apple processing

## On-device verification (once B135 lands)

- [ ] A Study session completes without error
- [ ] On a known-overdue Good/Easy review (where R(now) should be ~0.80), the quiz leg fires
- [ ] On a same-day Easy review (R(now) = 1.0), the quiz leg does NOT fire
- [ ] The burned-sample surprise check still triggers the quiz
- [ ] Session Complete's modality-breakdown row renders correctly
- [ ] `app_runner_log` shows no FSRS-related errors

## Rollback (if needed within the maintenance window)

Migration 0024 is reversible by hand:

```sql
BEGIN;
ALTER TABLE user_kanji_progress
  ADD COLUMN ease_factor real NOT NULL DEFAULT 2.5,
  ADD COLUMN interval integer NOT NULL DEFAULT 0,
  ADD COLUMN repetitions integer NOT NULL DEFAULT 0;
ALTER TABLE user_kanji_progress
  DROP COLUMN stability,
  DROP COLUMN difficulty,
  DROP COLUMN lapses,
  DROP COLUMN total_reviews;
ALTER TABLE review_logs
  DROP COLUMN prev_stability,
  DROP COLUMN next_stability,
  DROP COLUMN prev_difficulty,
  DROP COLUMN next_difficulty;
COMMIT;
```

After rollback you must also re-deploy the pre-FSRS API image. The
`ease_factor`/`interval`/`repetitions` defaults will leave every existing
card looking like an unseen new card — you'd need a separate restore from
the dump taken in the pre-rollout step to recover real state. **Do not
trust the rollback path to preserve user state — it preserves availability,
not data.** This is acceptable pre-launch with a tiny dataset.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/runbooks/2026-05-22-fsrs-rollout.md
git commit -m "$(cat <<'EOF'
docs(runbook): FSRS rollout operator checklist

Step-by-step rollout — pre-flight, clone-rehearsal, maintenance window,
mobile cut, on-device verification, and rollback. Covers the exact
sequence so the live-DB maintenance window stays under 10 minutes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Final self-review checklist (before opening PR)

- [ ] All 10 tasks committed
- [ ] `pnpm tsc -b` green workspace-wide
- [ ] `packages/shared` tests green (FSRS math)
- [ ] `apps/api` tests green 236/236 (modulo social-mute pre-existing)
- [ ] `apps/api` integration tests green including the new maybe-slipping test
- [ ] Clone-rehearsal completed successfully (Task 10 §Clone-rehearsal)
- [ ] Spec deck and HANDOFF.md reviewed for any references to SM-2 columns that need a one-line update (e.g. the housekeeping queue's "Bound the `maybeSlipping` reviewLogs query" entry is now moot)

When all green: open PR; on merge, run the rollout runbook.
