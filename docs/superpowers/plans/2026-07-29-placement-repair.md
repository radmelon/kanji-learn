# Placement Damage Repair — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find every `user_kanji_progress` row that B-210 silently overwrote (declared "remembered" on a single guessable multiple-choice item, destroying real FSRS history), and restore the state that history actually supports.

**Architecture:** A pure, unit-tested predicate identifies the bug's exact write signature. Two CLI scripts — mirroring the existing `scripts/replay-srs-fsrs.mjs` precedent — use it: a read-only detector, then a repair script that replays each affected row's `review_logs` through FSRS via `calculateNextReview`/`createNewCard`/`ratingFromQuality` (`packages/shared/src/srs.ts`) and UPSERTs the reconstructed state.

**Tech Stack:** `tsx` (import TS source directly, no build step), `postgres` (raw tagged-template client, matching `replay-srs-fsrs.mjs` — not Drizzle), `vitest` for the pure predicate.

## Global Constraints

- **Runs before anything else ships.** This plan is a prerequisite for `docs/superpowers/plans/2026-07-29-placement-model.md` — do not seed the design's `kanji_difficulty` table or deploy the new estimator against a live DB that hasn't been repaired.
- **Take a safety dump before any write to live data.** Use `scripts/with-live-db.sh` — never handle `DATABASE_URL` directly (see `CLAUDE.md`).
- **The exact damage signature:** `status='remembered' AND stability=21 AND difficulty=5 AND totalReviews=1`. `DEFAULT_FSRS_WEIGHTS[4] = 7.1949` (`packages/shared/src/constants.ts`), so a genuine first FSRS review cannot land on `difficulty=5.0` exactly — this signature is unique to the bug, not a coincidence to hedge against.
- **A row counts as damaged only if it has ≥1 real `review_logs` row.** The design spec's detector SQL uses `count(l.id) > 1`; this plan uses `>= 1` instead — a row with exactly one prior real review still had real state (from that one review) destroyed, and `> 1` would miss it. This is a strict improvement (catches genuine damage the spec's literal SQL would miss) with zero false-positive risk, given the signature is already unique. A row matching the signature with **zero** logs was never-studied-before — placement seeding it is a separate, less severe concern (over-claiming on flimsy evidence) that the new placement model fixes going forward; it is not what this plan repairs.
- **Repair is idempotent.** Re-running produces the same end state, matching `replay-srs-fsrs.mjs`.
- **Scripts never print or log `DATABASE_URL`.**

---

### Task 1: The damage-signature predicate

**Files:**
- Create: `packages/shared/src/placement-repair.ts`
- Modify: `packages/shared/src/index.ts` (add export)
- Test: `packages/shared/src/placement-repair.test.ts`

**Interfaces:**
- Produces: `isPlacementDamageSignature(row: PlacementDamageRow): boolean`, `PlacementDamageRow` type — consumed by Task 2 and Task 4's scripts.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/src/placement-repair.test.ts
import { describe, it, expect } from 'vitest'
import { isPlacementDamageSignature } from './placement-repair'

describe('isPlacementDamageSignature', () => {
  it('matches the exact bug signature', () => {
    expect(
      isPlacementDamageSignature({
        status: 'remembered',
        stability: 21,
        difficulty: 5,
        totalReviews: 1,
      })
    ).toBe(true)
  })

  it('rejects a genuine single-review card (different stability/difficulty)', () => {
    expect(
      isPlacementDamageSignature({
        status: 'learning',
        stability: 0.4,
        difficulty: 7.19,
        totalReviews: 1,
      })
    ).toBe(false)
  })

  it('rejects totalReviews other than 1', () => {
    expect(
      isPlacementDamageSignature({
        status: 'remembered',
        stability: 21,
        difficulty: 5,
        totalReviews: 2,
      })
    ).toBe(false)
  })

  it('rejects a near-miss on stability (floating point must not fuzzy-match)', () => {
    expect(
      isPlacementDamageSignature({
        status: 'remembered',
        stability: 21.4,
        difficulty: 5,
        totalReviews: 1,
      })
    ).toBe(false)
  })

  it('rejects status other than remembered', () => {
    expect(
      isPlacementDamageSignature({
        status: 'reviewing',
        stability: 21,
        difficulty: 5,
        totalReviews: 1,
      })
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @kanji-learn/shared test -- placement-repair`
Expected: FAIL — `Cannot find module './placement-repair'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/shared/src/placement-repair.ts

/**
 * One row from `user_kanji_progress`, the fields the B-210 write signature
 * touches. `status` is a plain string here (not `SrsStatus`) so this stays
 * usable from a raw-SQL script without importing the DB enum type.
 */
export interface PlacementDamageRow {
  status: string
  stability: number
  difficulty: number
  totalReviews: number
}

/**
 * True when a row exactly matches the write `applyPlacementResults` used to
 * make on a passed placement item: status='remembered', stability=21,
 * difficulty=5, totalReviews=1. This combination cannot arise from a genuine
 * FSRS review — DEFAULT_FSRS_WEIGHTS[4] (the first-review difficulty base)
 * is 7.1949, not 5, and no rating produces stability=21 on a first review.
 */
export function isPlacementDamageSignature(row: PlacementDamageRow): boolean {
  return (
    row.status === 'remembered' &&
    row.stability === 21 &&
    row.difficulty === 5 &&
    row.totalReviews === 1
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @kanji-learn/shared test -- placement-repair`
Expected: PASS (5 tests)

- [ ] **Step 5: Export from the package barrel**

In `packages/shared/src/index.ts`, add a line so the export list reads:

```typescript
// Shared types and utilities for kanji-learn
export * from './types'
export * from './constants'
export * from './srs'
export * from './placement'
export * from './placement-repair'
export * from './buddy-types'
export * from './llm-types'
export * from './milestones'
export * from './mnemonics'
```

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @kanji-learn/shared typecheck`
Expected: no errors

```bash
git add packages/shared/src/placement-repair.ts packages/shared/src/placement-repair.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add placement damage signature predicate

Pure, unit-tested check for the exact B-210 write signature
(status='remembered', stability=21, difficulty=5, totalReviews=1).
Used by the detect/repair scripts in scripts/."
```

---

### Task 2: Detection script

**Files:**
- Create: `scripts/detect-placement-damage.mjs`

**Interfaces:**
- Consumes: `isPlacementDamageSignature` from `packages/shared/src/placement-repair.ts` (Task 1).
- Produces: a printed report (no return value consumed elsewhere — this is a leaf CLI tool). Exit code 0 always (detection finding damage is not a script failure).

- [ ] **Step 1: Write the script**

```javascript
#!/usr/bin/env node
/**
 * Find user_kanji_progress rows B-210 overwrote: rows matching the exact
 * placement-write signature (status='remembered', stability=21,
 * difficulty=5, totalReviews=1) that ALSO have at least one real
 * review_logs row — proof the card had genuine history before placement
 * stamped over it. A matching row with zero logs was never studied before;
 * that is not what this script reports (see plan §Global Constraints).
 *
 * Read-only. Writes nothing. Safe to run against live data without a dump.
 *
 * Usage (from repo root):
 *   DATABASE_URL='<postgres connection string>' \
 *     node --import tsx/esm scripts/detect-placement-damage.mjs [--user <uuid>]
 *
 * Prefer running against live data via the safety wrapper:
 *   ./scripts/with-live-db.sh node --import tsx/esm scripts/detect-placement-damage.mjs
 */

import { createRequire } from 'node:module'
import { isPlacementDamageSignature } from '../packages/shared/src/placement-repair.ts'

const require = createRequire(
  new URL('../packages/db/src/index.ts', import.meta.url),
)
const postgres = require('postgres')

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Aborting.')
  process.exit(1)
}

const args = process.argv.slice(2)
const userIdx = args.indexOf('--user')
const SINGLE_USER = userIdx >= 0 ? args[userIdx + 1] : null

const dbUrl = process.env.DATABASE_URL
const sslDisabled = /[?&]sslmode=disable\b/.test(dbUrl)
const sql = postgres(dbUrl, { ssl: sslDisabled ? false : 'require', max: 5 })

async function main() {
  // Candidates: total_reviews = 1 is the only cheap index-friendly filter;
  // the exact signature and the log-count check happen after fetch.
  const candidates = await sql`
    SELECT p.user_id, p.kanji_id, p.status, p.stability, p.difficulty,
           p.total_reviews AS "totalReviews",
           (SELECT count(*) FROM review_logs l
             WHERE l.user_id = p.user_id AND l.kanji_id = p.kanji_id) AS logged_reviews
      FROM user_kanji_progress p
     WHERE p.total_reviews = 1
       ${SINGLE_USER ? sql`AND p.user_id = ${SINGLE_USER}` : sql``}
  `

  const damaged = candidates.filter(
    (row) =>
      isPlacementDamageSignature({
        status: row.status,
        stability: Number(row.stability),
        difficulty: Number(row.difficulty),
        totalReviews: Number(row.totalReviews),
      }) && Number(row.logged_reviews) >= 1,
  )

  console.log(`Scanned ${candidates.length} candidate row(s).`)
  console.log(`Found ${damaged.length} damaged row(s):\n`)

  for (const row of damaged) {
    console.log(
      `  user=${row.user_id} kanji=${row.kanji_id} logged_reviews=${row.logged_reviews}`,
    )
  }

  if (damaged.length > 0) {
    const byUser = new Map()
    for (const row of damaged) {
      byUser.set(row.user_id, (byUser.get(row.user_id) ?? 0) + 1)
    }
    console.log(`\nAffected accounts (${byUser.size}):`)
    for (const [userId, count] of byUser) {
      console.log(`  ${userId}: ${count} kanji`)
    }
  }

  await sql.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Run against the local test DB to verify it executes cleanly**

Rebuild the local test database first — see `docs/local-test-db.md`.

Run:
```bash
DATABASE_URL="$TEST_DATABASE_URL" node --import tsx/esm scripts/detect-placement-damage.mjs
```
Expected: `Scanned N candidate row(s).` / `Found 0 damaged row(s):` — the test DB has no placement-damaged rows yet (nothing has exercised the bug there). A clean run with zero findings confirms the query is syntactically correct and the join executes; it does not yet prove the detector recognizes real damage — Task 3 does that.

- [ ] **Step 3: Commit**

```bash
git add scripts/detect-placement-damage.mjs
git commit -m "feat(scripts): add placement damage detector

Read-only. Flags user_kanji_progress rows matching B-210's exact write
signature that also have real review_logs history — proof of a
genuine overwrite, not just a freshly-seeded card."
```

---

### Task 3: Prove the detector against a seeded fixture

**Files:**
- None created — this task seeds and cleans up data directly in the local test DB to verify Task 2's script against a known-damaged row before trusting it on live data.

**Interfaces:**
- Consumes: `scripts/detect-placement-damage.mjs` (Task 2).

- [ ] **Step 1: Seed one real review, then simulate the bug's overwrite**

```bash
psql "$TEST_DATABASE_URL" <<'SQL'
-- Use an existing kanji row and a throwaway test user.
INSERT INTO user_profiles (id, display_name, timezone)
VALUES ('00000000-0000-0000-0000-0000000000b2', 'RepairFixture', 'UTC')
ON CONFLICT DO NOTHING;

-- A genuine prior review (what the bug destroys).
INSERT INTO review_sessions (id, user_id, started_at, completed_at)
VALUES ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b2', NOW(), NOW())
ON CONFLICT DO NOTHING;

INSERT INTO review_logs
  (session_id, user_id, kanji_id, review_type, quality, response_time_ms,
   prev_status, next_status, prev_interval, next_interval, reviewed_at)
SELECT '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b2',
       id, 'meaning', 3, 2000, 'unseen', 'learning', 0, 1, NOW()
  FROM kanji ORDER BY id LIMIT 1;

-- The bug's overwrite: total_reviews stamped to 1, masking the real history above.
INSERT INTO user_kanji_progress
  (user_id, kanji_id, status, stability, difficulty, total_reviews, next_review_at, last_reviewed_at, updated_at)
SELECT '00000000-0000-0000-0000-0000000000b2', id,
       'remembered', 21, 5, 1, NOW() + interval '21 days', NOW(), NOW()
  FROM kanji ORDER BY id LIMIT 1
ON CONFLICT (user_id, kanji_id) DO UPDATE SET
  status = EXCLUDED.status, stability = EXCLUDED.stability,
  difficulty = EXCLUDED.difficulty, total_reviews = EXCLUDED.total_reviews;
SQL
```

- [ ] **Step 2: Run the detector and verify it finds exactly this row**

Run:
```bash
DATABASE_URL="$TEST_DATABASE_URL" node --import tsx/esm scripts/detect-placement-damage.mjs --user 00000000-0000-0000-0000-0000000000b2
```
Expected: `Found 1 damaged row(s):` listing `user=00000000-0000-0000-0000-0000000000b2` with `logged_reviews=1`.

- [ ] **Step 3: Clean up the fixture**

```bash
psql "$TEST_DATABASE_URL" -c "DELETE FROM user_profiles WHERE id = '00000000-0000-0000-0000-0000000000b2';"
```
(Cascades to `review_sessions`, `review_logs`, `user_kanji_progress` via their FK `ON DELETE CASCADE`.)

No commit — this task only validates Task 2's script and leaves no file changes.

---

### Task 4: Repair script

**Files:**
- Create: `scripts/repair-placement-damage.mjs`

**Interfaces:**
- Consumes: `isPlacementDamageSignature` (Task 1), `createNewCard`/`calculateNextReview`/`ratingFromQuality` from `packages/shared/src/srs.ts` (existing — same functions `replay-srs-fsrs.mjs` uses).

- [ ] **Step 1: Write the script**

```javascript
#!/usr/bin/env node
/**
 * Repair user_kanji_progress rows B-210 overwrote (see
 * scripts/detect-placement-damage.mjs for the detection query this reuses).
 * For each damaged (user_id, kanji_id): replay its review_logs through
 * FSRS-5 from scratch — same functions and UPSERT pattern as
 * scripts/replay-srs-fsrs.mjs — and write the reconstructed state.
 *
 * Idempotent — re-running produces the same end state.
 *
 * Defensive branch: if a row matches the damage signature but has ZERO
 * review_logs at repair time (should not happen — the detector requires
 * >=1 — but data can change between detect and repair runs), it is
 * reverted to 'unseen' rather than left with a fabricated 21-day stability,
 * and reported separately as unrepairable.
 *
 * Flags:
 *   --dry-run        Print what would change, write nothing.
 *   --user <uuid>    Restrict to one user.
 *
 * Usage (from repo root):
 *   DATABASE_URL='<postgres connection string>' \
 *     node --import tsx/esm scripts/repair-placement-damage.mjs [--dry-run] [--user <uuid>]
 *
 * ALWAYS run --dry-run first and review the output before a live run.
 * ALWAYS take a safety dump before a live (non-dry-run) run — see
 * scripts/with-live-db.sh and docs/HANDOFF.md's safety-dump precedent.
 */

import { createRequire } from 'node:module'
import {
  calculateNextReview,
  createNewCard,
  ratingFromQuality,
} from '../packages/shared/src/srs.ts'
import { isPlacementDamageSignature } from '../packages/shared/src/placement-repair.ts'

const require = createRequire(
  new URL('../packages/db/src/index.ts', import.meta.url),
)
const postgres = require('postgres')

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Aborting.')
  process.exit(1)
}

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const userIdx = args.indexOf('--user')
const SINGLE_USER = userIdx >= 0 ? args[userIdx + 1] : null

const dbUrl = process.env.DATABASE_URL
const sslDisabled = /[?&]sslmode=disable\b/.test(dbUrl)
const sql = postgres(dbUrl, { ssl: sslDisabled ? false : 'require', max: 5 })

async function main() {
  const candidates = await sql`
    SELECT p.user_id, p.kanji_id, p.status, p.stability, p.difficulty,
           p.total_reviews AS "totalReviews"
      FROM user_kanji_progress p
     WHERE p.total_reviews = 1
       ${SINGLE_USER ? sql`AND p.user_id = ${SINGLE_USER}` : sql``}
  `

  const damaged = candidates.filter((row) =>
    isPlacementDamageSignature({
      status: row.status,
      stability: Number(row.stability),
      difficulty: Number(row.difficulty),
      totalReviews: Number(row.totalReviews),
    }),
  )

  console.log(
    `${DRY_RUN ? '[DRY RUN] ' : ''}Repairing ${damaged.length} damaged row(s)`,
  )

  let repaired = 0
  let reverted = 0

  for (const row of damaged) {
    const logs = await sql`
      SELECT quality, reviewed_at FROM review_logs
       WHERE user_id = ${row.user_id} AND kanji_id = ${row.kanji_id}
       ORDER BY reviewed_at ASC
    `

    if (logs.length === 0) {
      // Matched the signature but nothing to replay — unrepairable. Revert
      // to the honest state rather than keep the fabricated one.
      console.log(
        `  UNREPAIRABLE user=${row.user_id} kanji=${row.kanji_id} — 0 review_logs, reverting to unseen`,
      )
      if (!DRY_RUN) {
        await sql`
          UPDATE user_kanji_progress
             SET status = 'unseen', stability = 0, difficulty = 5,
                 total_reviews = 0, next_review_at = NULL,
                 last_reviewed_at = NULL, updated_at = NOW()
           WHERE user_id = ${row.user_id} AND kanji_id = ${row.kanji_id}
        `
      }
      reverted++
      continue
    }

    let card = createNewCard()
    for (const log of logs) {
      const rating = ratingFromQuality(log.quality)
      card = calculateNextReview(card, rating, new Date(log.reviewed_at))
    }

    console.log(
      `  REPAIR user=${row.user_id} kanji=${row.kanji_id}: ` +
        `S=${card.stability.toFixed(2)} D=${card.difficulty.toFixed(2)} ` +
        `status=${card.status} (from ${logs.length} logged review(s))`,
    )

    if (!DRY_RUN) {
      await sql`
        UPDATE user_kanji_progress
           SET status = ${card.status}, stability = ${card.stability},
               difficulty = ${card.difficulty}, lapses = ${card.lapses},
               total_reviews = ${logs.length},
               next_review_at = ${card.nextReviewAt},
               last_reviewed_at = ${card.lastReviewedAt}, updated_at = NOW()
         WHERE user_id = ${row.user_id} AND kanji_id = ${row.kanji_id}
      `
    }
    repaired++
  }

  console.log(
    `\n${DRY_RUN ? '[DRY RUN] ' : ''}Done. Repaired ${repaired}, reverted-to-unseen ${reverted}.`,
  )

  await sql.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Re-seed the Task 3 fixture and dry-run the repair**

```bash
psql "$TEST_DATABASE_URL" <<'SQL'
INSERT INTO user_profiles (id, display_name, timezone)
VALUES ('00000000-0000-0000-0000-0000000000b2', 'RepairFixture', 'UTC')
ON CONFLICT DO NOTHING;

INSERT INTO review_sessions (id, user_id, started_at, completed_at)
VALUES ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b2', NOW(), NOW())
ON CONFLICT DO NOTHING;

INSERT INTO review_logs
  (session_id, user_id, kanji_id, review_type, quality, response_time_ms,
   prev_status, next_status, prev_interval, next_interval, reviewed_at)
SELECT '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b2',
       id, 'meaning', 3, 2000, 'unseen', 'learning', 0, 1, NOW()
  FROM kanji ORDER BY id LIMIT 1;

INSERT INTO user_kanji_progress
  (user_id, kanji_id, status, stability, difficulty, total_reviews, next_review_at, last_reviewed_at, updated_at)
SELECT '00000000-0000-0000-0000-0000000000b2', id,
       'remembered', 21, 5, 1, NOW() + interval '21 days', NOW(), NOW()
  FROM kanji ORDER BY id LIMIT 1
ON CONFLICT (user_id, kanji_id) DO UPDATE SET
  status = EXCLUDED.status, stability = EXCLUDED.stability,
  difficulty = EXCLUDED.difficulty, total_reviews = EXCLUDED.total_reviews;
SQL

DATABASE_URL="$TEST_DATABASE_URL" node --import tsx/esm scripts/repair-placement-damage.mjs --dry-run --user 00000000-0000-0000-0000-0000000000b2
```
Expected: `REPAIR user=...b2 kanji=... S=0.40 D=7.19 status=learning (from 1 logged review(s))` — a `quality=3` (Good) first review under FSRS-5 default weights produces `status='learning'`, not `'remembered'`, proving the fabricated `remembered`/21/5 state is gone. No DB row changes yet (dry run).

- [ ] **Step 3: Run it for real and verify the row changed**

```bash
DATABASE_URL="$TEST_DATABASE_URL" node --import tsx/esm scripts/repair-placement-damage.mjs --user 00000000-0000-0000-0000-0000000000b2

psql "$TEST_DATABASE_URL" -c "SELECT status, stability, difficulty, total_reviews FROM user_kanji_progress WHERE user_id = '00000000-0000-0000-0000-0000000000b2';"
```
Expected: one row, `status='learning'`, `stability≈0.4`, `difficulty≈7.19`, `total_reviews=1` — the true single-review state, not the fabricated one.

- [ ] **Step 4: Re-run to confirm idempotency**

```bash
DATABASE_URL="$TEST_DATABASE_URL" node --import tsx/esm scripts/repair-placement-damage.mjs --user 00000000-0000-0000-0000-0000000000b2
psql "$TEST_DATABASE_URL" -c "SELECT status, stability, difficulty, total_reviews FROM user_kanji_progress WHERE user_id = '00000000-0000-0000-0000-0000000000b2';"
```
Expected: `Repairing 0 damaged row(s)` — the row no longer matches the damage signature (it's `learning` now, not `remembered`/21/5), so the second run correctly finds nothing left to fix. Row unchanged.

- [ ] **Step 5: Clean up the fixture and commit**

```bash
psql "$TEST_DATABASE_URL" -c "DELETE FROM user_profiles WHERE id = '00000000-0000-0000-0000-0000000000b2';"
```

```bash
git add scripts/repair-placement-damage.mjs
git commit -m "feat(scripts): add placement damage repair script

Replays review_logs through FSRS for every row matching the B-210
write signature, following the replay-srs-fsrs.mjs precedent. Reverts
to unseen (not fabricated state) for the unrepairable zero-log edge
case. --dry-run and --user flags; idempotent."
```

---

### Task 5: Run against the live database

**This task touches production data. Do not run it unattended.**

**Files:** none — operational only.

- [ ] **Step 1: Take the safety dump**

```bash
mkdir -p /tmp/placement-repair-safety
./scripts/with-live-db.sh pg_dump -f /tmp/placement-repair-safety/live-$(date +%Y%m%d-%H%M).sql
```
Confirm the file was written and has non-trivial size (`ls -lh /tmp/placement-repair-safety/`) before proceeding.

- [ ] **Step 2: Run the detector against live data (read-only, safe)**

```bash
./scripts/with-live-db.sh node --import tsx/esm scripts/detect-placement-damage.mjs
```

Read the output. Note the affected-account count and whether the account with 104 kanji in `learning` (flagged in `docs/HANDOFF-placement-and-b210.md`) appears.

- [ ] **Step 3: STOP — human review gate**

**Do not proceed to Step 4 without explicit confirmation from whoever is running this plan.** Paste the detector's account-level summary and get an explicit go-ahead before writing to live data. This is exactly the kind of hard-to-reverse, shared-state action that needs a pause, even though the repair script is idempotent and dry-runnable — the underlying data change is still real.

- [ ] **Step 4: Dry-run the repair against live data**

```bash
./scripts/with-live-db.sh node --import tsx/esm scripts/repair-placement-damage.mjs --dry-run
```

Compare the row count to the detector's count from Step 2. They must match.

- [ ] **Step 5: Run the repair against live data**

```bash
./scripts/with-live-db.sh node --import tsx/esm scripts/repair-placement-damage.mjs
```

- [ ] **Step 6: Verify and record**

```bash
./scripts/with-live-db.sh node --import tsx/esm scripts/detect-placement-damage.mjs
```
Expected: `Found 0 damaged row(s)`.

Record in `docs/HANDOFF.md` (new top section, following the file's existing newest-section-first convention): the safety dump path, the repaired/reverted counts from Step 4's script output, and confirmation the post-repair detector scan is clean. Delete the safety dump after 24h of confirmed stability, per the precedent in `docs/HANDOFF.md`.

No code commit for this task — it is a data operation, recorded in the handoff doc instead.

---

## Self-Review Notes

**Spec coverage:** §12's detector signature, repair-via-replay, unrepairable→unseen fallback, and take-a-dump-first requirement are all covered (Tasks 1, 2, 4, 5). The `>1` vs `>=1` deviation from the spec's literal SQL is called out explicitly in Global Constraints with the reasoning, not silently changed.

**Placeholder scan:** none — every script step has complete, runnable code and exact expected output.

**Type consistency:** `PlacementDamageRow` (Task 1) is the single shape both scripts filter against; `row.status`/`stability`/`difficulty`/`totalReviews` field names match between the predicate, both `.mjs` scripts' SQL aliases, and the test fixtures.
