# Kanji Buddy — Phase 0a (Cleanup) Implementation Plan

> **Plan revised 2026-05-23 after discovering the Phase 0 schema was actually shipped in April via the drizzle track.** Earlier draft (commits `5aaaaa1` and `571d439`) assumed a missing migration that doesn't exist. See the refresh doc §2.4 (commit `c577306`) for the corrected status. This plan is the slimmed version that reflects what's actually left to do.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two real gaps in Phase 0: the `LearnerStateService` is implemented but invoked nowhere, and there's no observability on Buddy-related writes. Wire `LearnerStateService.refreshState(userId)` into a non-blocking post-commit hook in `SrsService.submitReview()`, add a daily Buddy metrics log line, deploy, verify.

**Architecture:** `LearnerStateService.refreshState()` invoked from `SrsService.submitReview()` after the dual-write commits, via fire-and-forget `setImmediate` with a per-user frequency cap (30s). One new service `metrics.service.ts` emits a single structured-JSON log line per day with three counters (cache refreshes, LLM telemetry rows, dual-write events). No DB migration, no schema changes, no RLS work.

**Tech Stack:** Drizzle ORM, PostgreSQL (Supabase ap-southeast-2), Fastify, Vitest, TypeScript. Existing services: `LearnerStateService` (orphaned), `DualWriteService` (live, writing to `learner_knowledge_state` + `learner_timeline_events` since April 17 deploy).

**Spec reference:** §3 of [`../specs/2026-05-23-buddy-v2-phase-1-refresh.md`](../specs/2026-05-23-buddy-v2-phase-1-refresh.md).

**Co-author convention:** Every commit in this repo includes both `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` and `Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>`.

---

## File Structure

| Path | Action | Purpose |
|---|---|---|
| `apps/api/src/services/buddy/learner-state.service.ts` | Modify | Add per-user 30s frequency cap to `refreshState` |
| `apps/api/src/services/srs.service.ts` | Modify (~line 469-478) | Inject `LearnerStateService`; fire-and-forget refresh after dual-write |
| `apps/api/src/server.ts` | Modify (~line 138) | Pass `learnerState` to `SrsService` constructor |
| `apps/api/src/services/buddy/metrics.service.ts` | Create | `emitDailyBuddyMetrics(db)` — structured-JSON log line |
| `apps/api/src/cron.ts` | Modify | Schedule daily metric job at 03:00 UTC |
| `apps/api/test/integration/learner-state-refresh.test.ts` | Create | Integration test: refresh fires after `submitReview` |
| `apps/api/test/integration/learner-state-cap.test.ts` | Create | Integration test: two rapid submits → one refresh |
| `apps/api/test/integration/buddy-metrics.test.ts` | Create | Test: log line has three counters, valid JSON |
| `docs/superpowers/findings/2026-05-23-phase-0a-dual-write-health.md` | Create | One-page verification of dual-write health in prod |
| `docs/HANDOFF.md` | Modify | Add "Phase 0a shipped" entry on closeout |

**Operator steps (no file changes):**
- Deploy API via `./scripts/deploy-api.sh`
- One Supabase SQL query (Task 1) — operator runs in the Supabase SQL editor
- Post-deploy smoke (Task 5) — operator triggers one review through the live app

---

## Task 1: Confirm dual-write is healthy in production

**Why first:** Before adding observability, verify Buddy tables are growing as expected. If they're empty, dual-write may be silently failing (try/catch we missed, or service-role permissions issue) and the LearnerState wiring would inherit the same failure. One Supabase SQL query settles it.

**Files:** Create `docs/superpowers/findings/2026-05-23-phase-0a-dual-write-health.md`.

- [ ] **Step 1: Run health-check query in Supabase SQL editor**

Operator runs:

```sql
SELECT
  (SELECT COUNT(*) FROM learner_knowledge_state) AS knowledge_state_rows,
  (SELECT COUNT(*) FROM learner_timeline_events) AS timeline_events_rows,
  (SELECT COUNT(*) FROM learner_identity)        AS identity_rows,
  (SELECT COUNT(*) FROM buddy_llm_telemetry)     AS llm_telemetry_rows,
  (SELECT COUNT(*) FROM learner_state_cache)     AS state_cache_rows,
  (SELECT MAX(created_at) FROM learner_timeline_events) AS last_timeline_event,
  (SELECT MAX(updated_at) FROM learner_knowledge_state) AS last_knowledge_update;
```

**Expected:**
- `knowledge_state_rows` > 0 (dual-write writes here on every review)
- `timeline_events_rows` > 0 (same)
- `identity_rows` > 0 (one per active user; dual-write creates on first review)
- `llm_telemetry_rows` > 0 (tutor-analysis calls this since April)
- `state_cache_rows` = 0 (LearnerStateService is orphaned — this is the gap Phase 0a fixes)
- `last_timeline_event` recent (within hours, given any active user)
- `last_knowledge_update` recent (same)

**If `knowledge_state_rows` or `timeline_events_rows` is 0**: dual-write is not actually writing. **STOP** the plan and investigate before wiring LearnerStateService (which would inherit the same failure). Likely causes: missing service-role permission, drizzle silently swallowing errors, or `learner_identity` not bootstrapping. Add a debug task to the plan.

**If `state_cache_rows` > 0**: LearnerStateService is not actually orphaned — something is calling it. **STOP** and grep for callers before wiring more.

- [ ] **Step 2: Write findings doc**

Create `docs/superpowers/findings/2026-05-23-phase-0a-dual-write-health.md`:

```markdown
# Phase 0a — Dual-write health verification

**Date:** 2026-05-23
**Method:** Single Supabase SQL query against the live `public` schema.

## Query results

| Counter | Value | Verdict |
|---|---|---|
| `learner_knowledge_state` rows | <n> | <healthy / empty / etc> |
| `learner_timeline_events` rows | <n> | <healthy / empty / etc> |
| `learner_identity` rows | <n> | <healthy / empty / etc> |
| `buddy_llm_telemetry` rows | <n> | <healthy / empty / etc> |
| `learner_state_cache` rows | <n> | <expected 0 — Phase 0a fixes> |
| `learner_timeline_events.MAX(created_at)` | <ts> | <recent / stale> |
| `learner_knowledge_state.MAX(updated_at)` | <ts> | <recent / stale> |

## Conclusion

<one paragraph: dual-write is/isn't healthy; LearnerState gap confirmed; ready
to proceed with wiring + observability>
```

- [ ] **Step 3: Commit findings**

```bash
git add docs/superpowers/findings/2026-05-23-phase-0a-dual-write-health.md
git commit -m "$(cat <<'EOF'
docs(findings): Phase 0a — dual-write production health check

One-shot SQL verification that DualWriteService is writing to the live
Buddy/UKG tables. <one-line verdict from results>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 2: Write failing tests for `LearnerStateService` wiring

**Goal:** Lock down three behaviors via tests: (a) `learner_state_cache` populates after a successful `submitReview`; (b) two rapid submits inside the cap window produce one refresh; (c) the refresh is non-blocking from `submitReview`'s perspective. Tests live as integration tests against a real local Postgres (mirror the pattern in [`apps/api/test/integration/llm-telemetry.test.ts`](../../../apps/api/test/integration/llm-telemetry.test.ts)).

**Files:**
- Create: `apps/api/test/integration/learner-state-refresh.test.ts`
- Create: `apps/api/test/integration/learner-state-cap.test.ts`

- [ ] **Step 1: Inspect the existing integration test fixture pattern**

Read [`apps/api/test/integration/llm-telemetry.test.ts`](../../../apps/api/test/integration/llm-telemetry.test.ts) and [`apps/api/test/integration/rls-coverage.test.ts`](../../../apps/api/test/integration/rls-coverage.test.ts) to confirm:
- Test-DB connection pattern (`TEST_DATABASE_URL` + `postgres()` + `drizzle()`)
- `beforeEach` seed/cleanup conventions
- Whether tests share a single test user UUID or each creates its own

Capture the test user UUID convention (likely `'00000000-0000-0000-0000-0000000000aa'` based on what we've seen, but verify against the file).

- [ ] **Step 2: Create `learner-state-refresh.test.ts`**

```typescript
// apps/api/test/integration/learner-state-refresh.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { SrsService } from '../../src/services/srs.service.js'
import { DualWriteService } from '../../src/services/buddy/dual-write.service.js'
import { LearnerStateService } from '../../src/services/buddy/learner-state.service.js'

const TEST_DB_URL = process.env.TEST_DATABASE_URL!
const client = postgres(TEST_DB_URL)
const db = drizzle(client, { schema })

const TEST_USER_ID = '00000000-0000-0000-0000-0000000000aa'

beforeAll(async () => {
  // Seed: ensure the test user has a user_profiles row + at least one
  // user_kanji_progress row + an open review_sessions row. Reuse helpers
  // from llm-telemetry.test.ts if present; otherwise inline minimal seeds.
  // <copy exact seed pattern from llm-telemetry.test.ts after reading it>
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM learner_state_cache WHERE user_id = ${TEST_USER_ID}`)
})

afterAll(async () => {
  await client.end()
})

describe('LearnerStateService refresh hook', () => {
  it('populates learner_state_cache after a successful submitReview', async () => {
    const dualWrite = new DualWriteService(db)
    const learnerState = new LearnerStateService(db)
    const srs = new SrsService(db, dualWrite, learnerState)

    // <minimal submitReview call — adapt arg shape from existing tests>
    await srs.submitReview(/* ... */)

    // Refresh is non-blocking via setImmediate; flush the microtask queue.
    await new Promise((resolve) => setImmediate(resolve))

    const cached = await db.query.learnerStateCache.findFirst({
      where: eq(schema.learnerStateCache.userId, TEST_USER_ID),
    })
    expect(cached).toBeTruthy()
    expect(cached?.userId).toBe(TEST_USER_ID)
  })
})
```

The `<copy exact seed pattern from llm-telemetry.test.ts>` placeholder is intentional and must be filled by reading that file in Step 1. Do not invent the seed; mirror what's already proven to work in the test suite.

- [ ] **Step 3: Run the refresh test — expect FAIL**

```bash
TEST_DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter=@kanji-learn/api test:integration -- learner-state-refresh
```

Expected: FAIL with either:
- "SrsService expects 2 arguments, got 3" (constructor mismatch — confirms wiring doesn't exist yet), or
- The cache row is null after `submitReview` (no hook firing).

Either failure mode is the correct red state for TDD.

- [ ] **Step 4: Create `learner-state-cap.test.ts`**

```typescript
// apps/api/test/integration/learner-state-cap.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { SrsService } from '../../src/services/srs.service.js'
import { DualWriteService } from '../../src/services/buddy/dual-write.service.js'
import { LearnerStateService } from '../../src/services/buddy/learner-state.service.js'

const TEST_DB_URL = process.env.TEST_DATABASE_URL!
const client = postgres(TEST_DB_URL)
const db = drizzle(client, { schema })

const TEST_USER_ID = '00000000-0000-0000-0000-0000000000aa'

beforeEach(async () => {
  await db.execute(sql`DELETE FROM learner_state_cache WHERE user_id = ${TEST_USER_ID}`)
})

afterAll(async () => {
  await client.end()
})

describe('LearnerStateService frequency cap', () => {
  it('two submitReviews within the cap window result in exactly one refresh', async () => {
    const dualWrite = new DualWriteService(db)
    const learnerState = new LearnerStateService(db)
    // Spy on the persist seam so we count actual cache writes (not just
    // refreshState calls — the cap allows refreshState to return early).
    const persistSpy = vi.spyOn(learnerState as any, 'persist')

    const srs = new SrsService(db, dualWrite, learnerState)

    await srs.submitReview(/* ... first call ... */)
    await srs.submitReview(/* ... second call within 30s ... */)
    await new Promise((resolve) => setImmediate(resolve))

    expect(persistSpy).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 5: Run the cap test — expect FAIL**

```bash
TEST_DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter=@kanji-learn/api test:integration -- learner-state-cap
```

Expected: FAIL with constructor mismatch (same as Step 3) or `persistSpy` call count != 1.

- [ ] **Step 6: Commit the failing tests**

```bash
git add apps/api/test/integration/learner-state-refresh.test.ts apps/api/test/integration/learner-state-cap.test.ts
git commit -m "$(cat <<'EOF'
test(api): failing tests for LearnerStateService refresh hook + frequency cap

TDD red-step for Phase 0a Task 3. Two integration tests:

1. After submitReview, learner_state_cache has a row for the user.
2. Two submitReviews in rapid succession trigger exactly one persist call
   (per-user 30s frequency cap).

Both currently fail — SrsService doesn't invoke LearnerStateService yet.
Task 3 implements the wiring.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 3: Implement the `LearnerStateService` wiring

**Goal:** Make Task 2's tests pass. Add a per-user 30s frequency cap to `LearnerStateService.refreshState()`. Inject `LearnerStateService` into `SrsService`. Invoke `refreshState(userId)` from `submitReview` after the dual-write commits, via fire-and-forget `setImmediate`.

**Files:**
- Modify: `apps/api/src/services/buddy/learner-state.service.ts`
- Modify: `apps/api/src/services/srs.service.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Add per-user frequency cap to `LearnerStateService.refreshState`**

Edit `apps/api/src/services/buddy/learner-state.service.ts`. Add at the top of the class (right after `constructor`):

```typescript
  // Per-user frequency cap. Heavy sessions can fire submitReview every few
  // seconds; without this cap the cache would be rewritten on every one of
  // them, even though the state values barely change between rapid submits.
  // 30s matches the cadence of a "reasonable user" doing back-to-back cards.
  private static readonly CAP_WINDOW_MS = 30_000
  private lastRefreshAt = new Map<string, number>()
```

Then modify `refreshState` to consult the cap:

```typescript
  async refreshState(userId: string): Promise<ComputedLearnerState | null> {
    const now = Date.now()
    const last = this.lastRefreshAt.get(userId) ?? 0
    if (now - last < LearnerStateService.CAP_WINDOW_MS) {
      // Within the cap window — skip. Return null to signal "skipped".
      // Fire-and-forget callers (the only kind in Phase 0a) ignore the return.
      return null
    }
    this.lastRefreshAt.set(userId, now)

    const inputs = await this.loadRawInputs(userId)
    const state = computeLearnerState(inputs)
    await this.persist(state)
    return state
  }
```

The return type changes from `Promise<ComputedLearnerState>` to `Promise<ComputedLearnerState | null>`. Since `LearnerStateService` has no current callers (confirmed by Explore agent's grep + the Phase 0a premise itself), no downstream typecheck breaks.

- [ ] **Step 2: Inject `LearnerStateService` into `SrsService`**

Edit `apps/api/src/services/srs.service.ts`. Add the import at the top:

```typescript
import { LearnerStateService } from './buddy/learner-state.service.js'
```

Modify the constructor:

```typescript
export class SrsService {
  constructor(
    private readonly db: Db,
    private readonly dualWrite: DualWriteService,
    private readonly learnerState: LearnerStateService,
  ) {}
```

- [ ] **Step 3: Invoke `refreshState` after the dual-write commits**

Still in `srs.service.ts`, in the `submitReview` method around line 469-478: after the `await this.dualWrite.recordReviewSubmissions(submissionInputs)` line and after the session is marked complete (the existing `await this.db.update(reviewSessions)...`), add before the method's return:

```typescript
    // Phase 0a wiring: refresh the learner-state cache for this user.
    // Fire-and-forget — errors are logged but never propagate, since this
    // path is observability, not correctness. setImmediate ensures the HTTP
    // response is sent before the refresh starts.
    setImmediate(() => {
      this.learnerState.refreshState(input.userId).catch((err) => {
        console.warn(`[LearnerState] refresh failed for user ${input.userId}:`, err)
      })
    })
```

The exact `input.userId` reference assumes `submitReview` takes an object with a `userId` field — verify against the actual signature when editing. If the userId variable is named differently in scope, use that.

- [ ] **Step 4: Update `SrsService` instantiation in `server.ts`**

Edit `apps/api/src/server.ts`. Around line 138 (where `srsService` is instantiated, per the Explore agent's report), pass `learnerState` as the third constructor arg:

```typescript
const srsService = new SrsService(db, dualWrite, learnerState)
```

Confirm `learnerState` is in scope at that line. The Explore agent confirmed it's instantiated and decorated immediately above (line 112–137).

- [ ] **Step 5: Run both tests — expect PASS**

```bash
TEST_DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter=@kanji-learn/api test:integration -- learner-state
```

Expected: both `learner-state-refresh` and `learner-state-cap` pass.

Common failure modes and fixes:
- `learner-state-refresh` fails because the cache row is null → check that `setImmediate(...)` is actually reached (e.g., put a `console.log` before it temporarily); confirm `refreshState` doesn't throw on the test fixture.
- `learner-state-cap` fails with `persistSpy.toHaveBeenCalledTimes(2)` → cap isn't catching; verify `CAP_WINDOW_MS = 30_000` and that the test's two submits actually happen inside 30s wall-clock.
- `learner-state-cap` fails with `persistSpy.toHaveBeenCalledTimes(0)` → `vi.spyOn` was wired before `new SrsService(...)`, or spy targets the wrong instance. Re-order or use a different observation strategy.

- [ ] **Step 6: Run the full integration test suite — verify no regression**

```bash
TEST_DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter=@kanji-learn/api test:integration
```

Expected: all green.

- [ ] **Step 7: Run workspace typecheck**

```bash
pnpm typecheck
```

Expected: clean modulo the pre-existing `social-mute.test.ts:25` error noted in the prior handoff.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/buddy/learner-state.service.ts apps/api/src/services/srs.service.ts apps/api/src/server.ts
git commit -m "$(cat <<'EOF'
feat(buddy): wire LearnerStateService into post-review refresh

After a successful submitReview, schedule a non-blocking refresh of the
user's learner_state_cache via setImmediate. Errors are logged but never
propagate (fire-and-forget — observability, not correctness).

LearnerStateService now enforces a 30s per-user frequency cap so heavy
sessions don't thrash the cache. The cap lives on the service so any
future invocation seam inherits it automatically.

Closes Phase 0a Task 3. The refresh + cap integration tests now pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 4: Daily Buddy metrics

**Goal:** Three counters emitted once per day as a single structured-JSON log line on stdout: `learner_state_cache` refreshes (last 24h), `buddy_llm_telemetry` rows (last 24h), `learner_timeline_events` rows (last 24h — proxy for dual-write commits). App Runner pipes stdout to CloudWatch; the log line is queryable via CloudWatch Logs Insights.

**Files:**
- Create: `apps/api/src/services/buddy/metrics.service.ts`
- Create: `apps/api/test/integration/buddy-metrics.test.ts`
- Modify: `apps/api/src/cron.ts`

- [ ] **Step 1: Write the failing test for log-line shape**

Create `apps/api/test/integration/buddy-metrics.test.ts`:

```typescript
// apps/api/test/integration/buddy-metrics.test.ts
import { describe, it, expect, vi, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@kanji-learn/db'
import { emitDailyBuddyMetrics } from '../../src/services/buddy/metrics.service.js'

const TEST_DB_URL = process.env.TEST_DATABASE_URL!
const client = postgres(TEST_DB_URL)
const db = drizzle(client, { schema })

afterAll(async () => {
  await client.end()
})

describe('emitDailyBuddyMetrics', () => {
  it('logs structured JSON with three counters and a window', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await emitDailyBuddyMetrics(db)

    const calls = logSpy.mock.calls.map((c) => String(c[0]))
    const metricLine = calls.find((line) =>
      line.includes('"metric":"buddy_daily_counts"')
    )
    expect(metricLine).toBeDefined()

    const parsed = JSON.parse(metricLine!)
    expect(parsed.metric).toBe('buddy_daily_counts')
    expect(typeof parsed.window_start).toBe('string')
    expect(typeof parsed.window_end).toBe('string')
    expect(typeof parsed.learner_state_refreshes).toBe('number')
    expect(typeof parsed.llm_telemetry_rows).toBe('number')
    expect(typeof parsed.dual_write_events).toBe('number')

    logSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run the test — expect FAIL**

```bash
TEST_DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter=@kanji-learn/api test:integration -- buddy-metrics
```

Expected: FAIL — `metrics.service.ts` does not exist.

- [ ] **Step 3: Implement `metrics.service.ts`**

Create `apps/api/src/services/buddy/metrics.service.ts`:

```typescript
// apps/api/src/services/buddy/metrics.service.ts
import { sql } from 'drizzle-orm'
import type { Db } from '@kanji-learn/db'

/**
 * Emit a single structured-JSON log line summarising Buddy-related write
 * counts over the past 24h. Consumed by App Runner's stdout → CloudWatch
 * pipeline; query via CloudWatch Logs Insights.
 *
 * Format: {"metric":"buddy_daily_counts","window_start":...,"window_end":...,
 *          "learner_state_refreshes":N,"llm_telemetry_rows":N,
 *          "dual_write_events":N}
 *
 * Errors are caught and logged as a warning — a metric-emission failure
 * must never take down the API.
 */
export async function emitDailyBuddyMetrics(db: Db): Promise<void> {
  const windowEnd = new Date()
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000)

  try {
    const result = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM learner_state_cache
          WHERE updated_at >= ${windowStart} AND updated_at < ${windowEnd})::int
          AS learner_state_refreshes,
        (SELECT COUNT(*) FROM buddy_llm_telemetry
          WHERE created_at >= ${windowStart} AND created_at < ${windowEnd})::int
          AS llm_telemetry_rows,
        (SELECT COUNT(*) FROM learner_timeline_events
          WHERE created_at >= ${windowStart} AND created_at < ${windowEnd})::int
          AS dual_write_events
    `)

    // postgres-js + drizzle .execute() returns rows in result; shape varies
    // by driver version. Coerce defensively.
    const rows = result as unknown as Array<Record<string, number>>
    const row = rows[0] ?? {}

    console.log(
      JSON.stringify({
        metric: 'buddy_daily_counts',
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
        learner_state_refreshes: row.learner_state_refreshes ?? 0,
        llm_telemetry_rows: row.llm_telemetry_rows ?? 0,
        dual_write_events: row.dual_write_events ?? 0,
      })
    )
  } catch (err) {
    console.warn('[BuddyMetrics] daily emission failed:', err)
  }
}
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
TEST_DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter=@kanji-learn/api test:integration -- buddy-metrics
```

Expected: PASS.

- [ ] **Step 5: Schedule the daily metric job in `cron.ts`**

Read `apps/api/src/cron.ts` to identify the cron library in use (likely `node-cron` based on prior reading). Add a sibling daily job that runs once per day at 03:00 UTC.

If the file uses `node-cron`:

```typescript
import cron from 'node-cron'
import { emitDailyBuddyMetrics } from './services/buddy/metrics.service.js'

// ... within wherever the cron jobs are registered ...

// Daily Buddy metrics — one structured-JSON log line per day.
cron.schedule('0 3 * * *', () => {
  void emitDailyBuddyMetrics(db)
}, { timezone: 'UTC' })
```

If the file uses a different scheduler API, match the existing pattern in the file rather than introducing a new cron library.

- [ ] **Step 6: Run the full integration test suite + workspace typecheck**

```bash
TEST_DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter=@kanji-learn/api test:integration
pnpm typecheck
```

Both expected: green modulo the pre-existing `social-mute.test.ts:25` error.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/buddy/metrics.service.ts apps/api/src/cron.ts apps/api/test/integration/buddy-metrics.test.ts
git commit -m "$(cat <<'EOF'
feat(buddy): daily Buddy metrics — three counters via structured JSON

Adds emitDailyBuddyMetrics(): single structured-JSON log line per day
covering learner_state_cache refreshes, buddy_llm_telemetry rows, and
dual-write events (proxied by learner_timeline_events). Scheduled at
03:00 UTC.

Consumed by App Runner's stdout → CloudWatch pipeline. No new table;
the log line itself is the metric, queryable via CloudWatch Logs Insights.

Errors caught — a metric-emission failure must never take down the API.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 5: Deploy API + post-deploy smoke

**Goal:** Push the wiring + metrics to production via the established deploy script. Confirm via a real review submission that `learner_state_cache` now populates.

**Files:** No file changes — operator + verification.

- [ ] **Step 1: Pre-deploy sanity**

Verify `main` is clean and all Phase 0a commits are on it:

```bash
git status
git log --oneline -10
```

Expected: clean working tree (modulo the untracked items from the housekeeping queue); last few commits include the Phase 0a refresh + plan amendments + Tasks 1–4 code commits.

- [ ] **Step 2: Run the deploy script**

```bash
./scripts/deploy-api.sh
```

This builds and pushes the ECR image and triggers an App Runner deployment. The script returns immediately; the deployment runs async.

- [ ] **Step 3: Wait for App Runner deployment to reach SUCCEEDED**

```bash
aws apprunner list-operations \
  --service-arn "$APP_RUNNER_SERVICE_ARN" \
  --max-results 5 \
  --query 'OperationSummaryList[0]'
```

Re-run until `Status` shows `SUCCEEDED`. Typical latency: 3–5 minutes.

- [ ] **Step 4: API smoke**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://73x3fcaaze.us-east-1.awsapprunner.com/v1/review/status
```

Expected: `401` (route exists, needs auth). If 5xx, halt and check App Runner logs:

```bash
aws logs tail /aws/apprunner/kanji-learn-api --since 5m
```

- [ ] **Step 5: Trigger a real review via the live mobile app**

Open the operator's TestFlight build. Complete one card (any review type, any grade). Wait ~5 seconds.

- [ ] **Step 6: Confirm `learner_state_cache` populated**

Operator runs in Supabase SQL editor:

```sql
SELECT user_id, updated_at, current_streak_days, total_kanji_seen,
       scaffold_level, buddy_mood
FROM learner_state_cache
WHERE user_id = '<operator-user-id>'
ORDER BY updated_at DESC LIMIT 1;
```

Expected: one row with `updated_at` within the last few minutes; `total_kanji_seen` > 0; values consistent with the operator's actual progress.

If no row: check App Runner logs for `[LearnerState] refresh failed` warnings. Most likely cause: `loadRawInputs` query has a bug against real production data shape. Fix forward.

- [ ] **Step 7: Confirm `learner_timeline_events` still growing**

```sql
SELECT COUNT(*) AS events_last_10_min
FROM learner_timeline_events
WHERE created_at > NOW() - INTERVAL '10 minutes';
```

Expected: ≥ the number of card reviews the operator just did (one event per review at minimum).

---

## Task 6: Verify acceptance criteria + closeout

**Goal:** Tick the §3.3 acceptance criteria from the refresh spec, finalize the findings doc, update HANDOFF.md, commit the closeout.

**Files:** Modify `docs/superpowers/findings/2026-05-23-phase-0a-dual-write-health.md`, modify `docs/HANDOFF.md`.

- [ ] **Step 1: Tick acceptance criterion — `learner_state_cache` populated**

Task 5 Step 6 confirms. Mark off.

- [ ] **Step 2: Tick acceptance criterion — dual-write health**

Task 1 Step 1 confirms Buddy tables non-zero. Task 5 Step 7 confirms growth post-deploy. Mark off.

- [ ] **Step 3: Tick acceptance criterion — no submitReview latency regression**

Pull App Runner request-latency metrics for `POST /v1/review/submit` from the 24h before deploy vs the 24h after. If CloudWatch metrics aren't readily available, do an operator-eyeball check (the `setImmediate` wiring should keep the synchronous path identical to pre-deploy, so any regression would indicate a bug, not a design issue).

- [ ] **Step 4: Tick acceptance criterion — daily metric log line emitting**

Wait until 03:00 UTC the day after deploy, then query CloudWatch:

```bash
aws logs filter-log-events \
  --log-group-name /aws/apprunner/kanji-learn-api \
  --filter-pattern '"metric":"buddy_daily_counts"' \
  --start-time $(date -v-1d +%s)000 \
  --max-items 5
```

Expected: at least one matching line with non-zero counters. If empty, check the cron schedule landed in production and `cron.ts` is actually being imported on startup.

- [ ] **Step 5: Append final verdict to findings doc**

Edit `docs/superpowers/findings/2026-05-23-phase-0a-dual-write-health.md` and append:

```markdown
## Post-deploy verification (Task 6)

| Criterion | Status | Notes |
|---|---|---|
| `learner_state_cache` populates for at least one active user | ✅ <date> | <observed values> |
| Dual-write health confirmed; tables growing | ✅ <date> | <pre/post row counts> |
| No `submitReview` latency regression | ✅ <date> | p95 <before> → <after> |
| Daily Buddy metrics log line observed in CloudWatch | ✅ <date> | First emission <ts> |

Phase 0a complete. Next slice per the refresh doc §9: Phase 1' brainstorm
(BuddyCard delivery skeleton).
```

- [ ] **Step 6: Update HANDOFF.md**

Edit `docs/HANDOFF.md` and add a "Phase 0a shipped" entry to the current-state section. Note that Buddy Phase 0 is now fully complete (the orphan + observability gaps are closed); next slice is Phase 1' (BuddyCard delivery skeleton).

- [ ] **Step 7: Commit closeout**

```bash
git add docs/superpowers/findings/2026-05-23-phase-0a-dual-write-health.md docs/HANDOFF.md
git commit -m "$(cat <<'EOF'
docs(phase0a): close out Phase 0a — acceptance criteria met

LearnerStateService is now wired into post-review refresh; daily Buddy
metrics emitting. Dual-write health confirmed in production. No regression
in submitReview latency.

Buddy Phase 0 is now fully complete. Next slice per the refresh doc §9:
Phase 1' brainstorm (BuddyCard delivery skeleton).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Plan self-review

- **Spec coverage:** §3.1 of the refresh spec has three in-scope items; this plan has tasks for each (Task 3 → wiring, Task 4 → observability, Task 1 → dual-write health). §3.2 out-of-scope items respected — no migration work, no behavior changes, no backfill. §3.3 acceptance criteria all covered by Task 6.
- **Placeholder scan:** Two intentional placeholders in Task 2 Step 2 and Step 4 — `<copy exact seed pattern from llm-telemetry.test.ts>` and `<minimal submitReview call>`. Both must be resolved at execution time by reading the existing test patterns. Not "TBD" sentinels; concrete fill-in instructions with a named reference. Findings doc placeholders (Task 1 Step 2, Task 6 Step 5) are explicitly meant to be filled when results come in.
- **Type consistency:** `LearnerStateService.refreshState` returns `Promise<ComputedLearnerState | null>` after Task 3 Step 1; no callers exist today so no downstream breakage. `SrsService` constructor gains a third arg consistently across Tasks 2/3.
- **File-list reconciliation:** Every `Files:` header at task start matches the actual edits inside the steps.

---

*End of plan. Companion documents: [`../specs/2026-05-23-buddy-v2-phase-1-refresh.md`](../specs/2026-05-23-buddy-v2-phase-1-refresh.md), [`../runbooks/2026-05-22-fsrs-rollout.md`](../runbooks/2026-05-22-fsrs-rollout.md).*
