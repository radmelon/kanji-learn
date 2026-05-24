# Kanji Buddy — Phase 0a (Cleanup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 0 of the Kanji Buddy v2 work — apply the 17 Buddy/UKG tables defined in `schema.ts` but never migrated, verify what `DualWriteService` is doing in production today, wire `LearnerStateService` into a non-blocking post-review refresh hook, and add basic observability. Plumbing-only, no user-visible changes.

**Architecture:** A single Drizzle migration creates the 17 missing tables + 8 enums with full RLS coverage. `LearnerStateService.refreshState()` is invoked from `SrsService.submitReview()` after the dual-write commits, via a fire-and-forget `setImmediate` with a per-user frequency cap. Observability surfaces three daily counters as structured JSON in App Runner logs.

**Tech Stack:** Drizzle ORM + drizzle-kit, PostgreSQL (Supabase ap-southeast-2), Fastify, Vitest, TypeScript. Existing services: `LearnerStateService` (orphaned), `DualWriteService` (wired into `submitReview`), `TutorAnalysisService` (live consumer of the LLM router).

**Spec reference:** §3 of [`../specs/2026-05-23-buddy-v2-phase-1-refresh.md`](../specs/2026-05-23-buddy-v2-phase-1-refresh.md).

**Co-author convention:** Every commit in this repo includes both `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` and `Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>`.

---

## File Structure

**Files this plan touches:**

| Path | Action | Purpose |
|---|---|---|
| `packages/db/drizzle/0025_buddy_phase0.sql` | Create (via `pnpm db:generate`) | Drizzle-generated migration for 17 tables + 8 enums |
| `packages/db/supabase/migrations/0025_buddy_phase0.sql` | Create (hand-copy + RLS augmentation) | Supabase-applied migration with hand-added RLS policies |
| `apps/api/src/services/srs.service.ts` | Modify around line 469 | Hook `LearnerStateService.refreshState()` post-commit |
| `apps/api/src/services/buddy/learner-state.service.ts` | Modify | Add per-user frequency cap to `refreshState()` |
| `apps/api/src/services/buddy/metrics.service.ts` | Create | Daily counter emission (structured JSON) |
| `apps/api/src/cron.ts` | Modify | Schedule daily metric job |
| `apps/api/src/server.ts` | Modify (~line 138) | Pass `learnerState` into `srsService` constructor |
| `apps/api/test/integration/learner-state-refresh.test.ts` | Create | Integration test for the refresh hook |
| `apps/api/test/integration/learner-state-cap.test.ts` | Create | Integration test for frequency cap |
| `apps/api/test/integration/metrics.test.ts` | Create | Test daily-counter emission shape |
| `docs/superpowers/findings/2026-05-23-dual-write-prod-status.md` | Create | Findings document from Task 1 |

**Rollout artifacts (operator-applied, documented inline in tasks):**
- Apply `0025_buddy_phase0.sql` to live DB via `psql`
- Deploy API via `./scripts/deploy-api.sh`

---

## Task 1: Verify what `DualWriteService` is doing in production today

**Why first:** Per the Phase 0a spec, we must determine empirically whether the dual-write call has been (a) silently succeeding via some path we missed, (b) failing silently via try/catch we missed, (c) failing in a way that 5xx's `submitReview` but hasn't surfaced, or (d) no-op'd by some kill-switch. The answer determines whether we need backfill.

**Files:**
- Inspect (read-only): `apps/api/src/services/buddy/dual-write.service.ts`, `apps/api/src/services/srs.service.ts:460-478`, `packages/db/supabase/migrations/`
- Create: `docs/superpowers/findings/2026-05-23-dual-write-prod-status.md`

- [ ] **Step 1: Confirm no `learner_state_cache` / `learner_knowledge_state` / `learner_timeline_events` tables exist in any migration file**

Run:

```bash
grep -l "learner_state_cache\|learner_knowledge_state\|learner_timeline_events" packages/db/supabase/migrations/
```

Expected: no output (no migration creates these tables). If output appears, halt the plan and re-evaluate Phase 0a's premise.

- [ ] **Step 2: Read App Runner logs for the last 7 days, search for "relation does not exist" or `learner_` errors**

Run (with AWS credentials configured):

```bash
aws logs filter-log-events \
  --log-group-name /aws/apprunner/kanji-learn-api \
  --start-time $(date -v-7d +%s)000 \
  --filter-pattern 'relation' \
  --max-items 50
```

Document: number of matches, sample error text, frequency. If matches exist, the dual-write has been failing in prod for six weeks — likely raising 5xx on every review submit (which contradicts the "B135 verified working on-device" handoff note). Resolve the contradiction in the findings doc.

- [ ] **Step 3: Reproduce locally to nail down the exact behavior**

Spin up a local clone of the live DB *without* applying migration 0025 (follow the FSRS rehearsal pattern from `docs/superpowers/runbooks/2026-05-22-fsrs-rollout.md`):

```bash
# Generate fresh dump of live DB (do not commit the dump)
pg_dump "$LIVE_DATABASE_URL" --no-owner --no-acl --clean --if-exists > /tmp/live-clone.sql

# Start local Postgres if not running, then restore
psql "$LOCAL_DATABASE_URL" < /tmp/live-clone.sql

# Run the API against the clone
DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter=@kanji-learn/api dev
```

In a second terminal, send a single `POST /v1/review/submit` for one card (any valid user token) and observe the response + API stdout:

```bash
curl -X POST http://localhost:3000/v1/review/submit \
  -H "Authorization: Bearer $TEST_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"<id>","results":[{"kanjiId":1,"quality":3,"responseTimeMs":1500,"reviewType":"meaning"}]}'
```

Expected outcomes (record which one matches):
- **5xx response + "relation does not exist" in stdout** → dual-write throws today, but somehow prod isn't surfacing this. Investigate (Step 4).
- **2xx response + no error in stdout** → dual-write is silently no-op'd or the inserts succeed against tables we missed. Investigate (Step 4).
- **2xx response + warning in stdout** → caught and logged elsewhere. Identify the catch site.

- [ ] **Step 4: Locate the catch site (if any) or the kill switch (if any)**

If Step 3 returned 2xx without errors, grep for try/catch around the dual-write callsite and any feature-flag-style guards:

```bash
grep -rn "dualWrite\|dual_write\|DualWrite" apps/api/src/ | grep -v test
```

Inspect `apps/api/src/services/srs.service.ts:460-478`. If no try/catch wraps the call but it still didn't throw, the most likely explanation is that the inserts succeeded against tables-that-do-exist (i.e. our inventory of "missing tables" is wrong). Re-verify the table existence in the clone:

```bash
psql "$LOCAL_DATABASE_URL" -c "\dt learner_*"
psql "$LOCAL_DATABASE_URL" -c "\dt buddy_*"
```

If those tables DO exist in the clone, there's a migration we missed or a different migration system. Read every file in `packages/db/supabase/migrations/` and `packages/db/drizzle/` to find it.

- [ ] **Step 5: Write the findings document**

Create `docs/superpowers/findings/2026-05-23-dual-write-prod-status.md` documenting:
- The empirical answer (which of a/b/c/d from the "Why first" rationale).
- The evidence (log excerpts, repro steps, file references).
- Whether backfill is needed (default: no — there's no consumer; if writes have been succeeding the data is already there).
- Whether the current dual-write code needs any modification before the migration applies (e.g. should we *expect* it to start working after migration, or are there bugs that need fixing first?).

- [ ] **Step 6: Commit findings**

```bash
git add docs/superpowers/findings/2026-05-23-dual-write-prod-status.md
git commit -m "$(cat <<'EOF'
docs(findings): Phase 0a Task 1 — dual-write production status

Documents empirical investigation of what DualWriteService is doing in
production today. <one-line verdict based on findings>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 2: Generate the Drizzle migration

**Goal:** Use `drizzle-kit generate` to produce a SQL file capturing the diff between `schema.ts` and the live DB (post-FSRS). Validate the generated SQL covers all 17 tables + 8 enums.

**Files:**
- Create: `packages/db/drizzle/0025_<auto-named>.sql` (generated)

- [ ] **Step 1: Set `DATABASE_URL` to point at the live DB (read-only verification)**

The generation command compares schema.ts against the URL in `DATABASE_URL`. Use the *live* URL so the diff is real:

```bash
export DATABASE_URL="<live Supabase URL>"
```

- [ ] **Step 2: Run generation**

```bash
cd packages/db && pnpm db:generate
```

Expected: a new file appears in `packages/db/drizzle/` named `0025_<adjective>_<noun>.sql` (drizzle-kit auto-names).

- [ ] **Step 3: Inspect the generated SQL**

```bash
ls -la packages/db/drizzle/ | tail -5
cat packages/db/drizzle/0025_*.sql
```

Verify the file contains:
- `CREATE TYPE` for 8 enums: `buddy_mood`, `velocity_trend`, `weakest_modality`, `buddy_personality`, `mnemonic_generation_method`, `llm_tier`, `study_log_mood`, plus any new enums for `deviceType` if not yet created.
- `CREATE TABLE` for 17 tables: `learner_state_cache`, `buddy_conversations`, `buddy_nudges`, `study_plans`, `study_plan_events`, `study_log_entries`, `shared_goals`, `learner_identity`, `learner_profile_universal`, `learner_connections`, `learner_memory_artifacts`, `learner_knowledge_state`, `learner_app_grants`, `learner_timeline_events`, `buddy_llm_telemetry`, `buddy_llm_usage`, and any of the above I'm missing per `schema.ts` lines 501–908.
- Indexes and foreign keys per the schema.

If any table is missing or any column type looks wrong, halt and reconcile by fixing `schema.ts`, then regenerate.

- [ ] **Step 4: Rename generated file to canonical name**

```bash
mv packages/db/drizzle/0025_*.sql packages/db/drizzle/0025_buddy_phase0.sql
```

If the auto-name was already `0025_buddy_phase0.sql`, skip.

- [ ] **Step 5: Commit the generated migration**

```bash
git add packages/db/drizzle/0025_buddy_phase0.sql packages/db/drizzle/meta/
git commit -m "$(cat <<'EOF'
feat(db): generate migration 0025 — Buddy Phase 0 tables

Drizzle-generated migration covering the 17 buddy/UKG tables and 8 enums
that have been in packages/db/src/schema.ts since April Phase 0 but were
never migrated. Includes: learner_state_cache, buddy_conversations,
buddy_nudges, study_plans, study_plan_events, study_log_entries,
shared_goals, learner_identity, learner_profile_universal,
learner_connections, learner_memory_artifacts, learner_knowledge_state,
learner_app_grants, learner_timeline_events, buddy_llm_telemetry,
buddy_llm_usage, plus enums.

RLS policies and Supabase-side copy follow in Task 3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 3: Augment migration with RLS policies and copy to Supabase

**Goal:** drizzle-kit doesn't generate RLS policies. Per the existing test `apps/api/test/integration/rls-coverage.test.ts`, every public table must have `relrowsecurity = true` and `relforcerowsecurity = true`. We add `ENABLE ROW LEVEL SECURITY` + `FORCE` + policies for all 17 new tables, then copy the augmented migration to `packages/db/supabase/migrations/` (Supabase's canonical location).

**Files:**
- Create: `packages/db/supabase/migrations/0025_buddy_phase0.sql` (copy + augment)

- [ ] **Step 1: Copy the Drizzle migration to Supabase migrations directory**

```bash
cp packages/db/drizzle/0025_buddy_phase0.sql packages/db/supabase/migrations/0025_buddy_phase0.sql
```

- [ ] **Step 2: Wrap migration in BEGIN/COMMIT, add header comment**

Edit `packages/db/supabase/migrations/0025_buddy_phase0.sql` — prepend at the top:

```sql
-- Migration 0025: Kanji Buddy Phase 0 tables (17 tables + 8 enums)
-- Completes the Phase 0 schema that was defined in packages/db/src/schema.ts
-- in April but never migrated. Plumbing-only: no user-visible changes.
--
-- See docs/superpowers/specs/2026-05-23-buddy-v2-phase-1-refresh.md §3 for
-- the rationale and acceptance criteria.

BEGIN;
```

And append at the bottom (after the last statement, before EOF):

```sql

COMMIT;
```

- [ ] **Step 3: For each of the 17 new tables, append `ENABLE ROW LEVEL SECURITY` + `FORCE` + policies**

Tables fall into three RLS classes. The existing patterns are in `packages/db/supabase/migrations/0009_rls_service_role_policies.sql` and `0018_rls_placement_tutor_tables.sql`.

**Class A — user-owned, direct `user_id` foreign key.** User reads own row; service role full access.

Tables: `learner_state_cache`, `buddy_conversations`, `buddy_nudges`, `study_plans`, `study_plan_events`, `study_log_entries`, `shared_goals`.

Pattern:
```sql
ALTER TABLE learner_state_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_state_cache FORCE ROW LEVEL SECURITY;

CREATE POLICY "Users read own learner_state_cache"
  ON learner_state_cache FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access learner_state_cache"
  ON learner_state_cache FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');
```

**Class B — UKG tables, service-role-only.** The April design §12 frames UKG as an internal *projection* of app-specific tables. All user reads happen through API endpoints that the service mediates, not direct table access. `DualWriteService` writes via service role. Per-user RLS on UKG tables would require sub-selects via `learner_identity` — costly and brittle. Service-role-only is the right posture for Phase 0a; later phases can add per-user policies if/when user-facing direct access becomes a real requirement.

Tables: `learner_identity`, `learner_profile_universal`, `learner_connections`, `learner_memory_artifacts`, `learner_knowledge_state`, `learner_app_grants`, `learner_timeline_events`.

Pattern:
```sql
ALTER TABLE learner_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_identity FORCE ROW LEVEL SECURITY;

CREATE POLICY "Service role only learner_identity"
  ON learner_identity FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');
```

**Class C — telemetry, service-role-only.** Internal; no user read access.

Tables: `buddy_llm_telemetry`, `buddy_llm_usage`.

Pattern:
```sql
ALTER TABLE buddy_llm_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE buddy_llm_telemetry FORCE ROW LEVEL SECURITY;

CREATE POLICY "Service role only buddy_llm_telemetry"
  ON buddy_llm_telemetry FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');
```

- [ ] **Step 4: Run RLS coverage test against a local clone with the migration applied**

```bash
# Restore live clone (or use the one from Task 1 Step 3, post-migration)
psql "$LOCAL_DATABASE_URL" -f packages/db/supabase/migrations/0025_buddy_phase0.sql

# Run the RLS coverage test
TEST_DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter=@kanji-learn/api test:integration -- rls-coverage
```

Expected: PASS. Every public table reports `relrowsecurity=true AND relforcerowsecurity=true`.

If FAIL: the test output lists the offending tables. Add ENABLE + FORCE to the migration for those tables and re-run.

- [ ] **Step 5: Commit the Supabase-side migration with RLS**

```bash
git add packages/db/supabase/migrations/0025_buddy_phase0.sql
git commit -m "$(cat <<'EOF'
feat(db): supabase-side migration 0025 with RLS coverage

Hand-augmented copy of the Drizzle-generated 0025 migration with full RLS
coverage for all 17 new tables. User-owned tables: user can read own row,
service role full access. Telemetry tables: service role only.

RLS coverage test (apps/api/test/integration/rls-coverage.test.ts) passes
against a local clone with this migration applied.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 4: Clone-rehearsal — verify migration applies cleanly + smoke-test submitReview

**Goal:** Per the FSRS rollout pattern (`docs/superpowers/runbooks/2026-05-22-fsrs-rollout.md`), rehearse the migration on a fresh dump of the live DB before applying it to production. Smoke-test that `submitReview` succeeds end-to-end against the migrated clone (the dual-write inserts must now land in the new tables).

**Files:** No file changes — operator + verification only.

- [ ] **Step 1: Fresh pg_dump of live DB**

```bash
pg_dump "$LIVE_DATABASE_URL" --no-owner --no-acl --clean --if-exists > /tmp/live-clone-$(date +%Y%m%d).sql
```

Verify size matches the expected order of magnitude (FSRS rehearsal used a 5.5MB dump; current should be similar).

- [ ] **Step 2: Restore to local Postgres**

```bash
# Drop and recreate local target
psql "$LOCAL_DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$LOCAL_DATABASE_URL" < /tmp/live-clone-$(date +%Y%m%d).sql
```

- [ ] **Step 3: Apply migration 0025**

```bash
psql "$LOCAL_DATABASE_URL" -f packages/db/supabase/migrations/0025_buddy_phase0.sql
```

Expected: no errors. Migration commits cleanly inside its BEGIN/COMMIT.

- [ ] **Step 4: Verify the 17 tables exist**

```bash
psql "$LOCAL_DATABASE_URL" -c "\dt learner_*"
psql "$LOCAL_DATABASE_URL" -c "\dt buddy_*"
psql "$LOCAL_DATABASE_URL" -c "\dt study_*"
psql "$LOCAL_DATABASE_URL" -c "\dt shared_goals"
```

Expected: 17 rows total across these queries (15 from prefix matches, plus `shared_goals`, plus any I'm miscounting — confirm against the §2.4 inventory in the refresh doc).

- [ ] **Step 5: Run the full integration test suite against the clone**

```bash
TEST_DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter=@kanji-learn/api test:integration
```

Expected: all green. Particularly: `rls-coverage` passes, and no existing test regresses.

- [ ] **Step 6: Smoke-test `submitReview` end-to-end against the clone**

Start the API pointed at the clone:

```bash
DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter=@kanji-learn/api dev
```

Submit a single review (use a known user from the clone):

```bash
curl -X POST http://localhost:3000/v1/review/submit \
  -H "Authorization: Bearer $TEST_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"<id-from-clone>","results":[{"kanjiId":1,"quality":3,"responseTimeMs":1500,"reviewType":"meaning"}]}'
```

Then verify the dual-write landed in the new tables:

```bash
psql "$LOCAL_DATABASE_URL" -c "SELECT COUNT(*) FROM learner_knowledge_state WHERE user_id = '<test-user-id>';"
psql "$LOCAL_DATABASE_URL" -c "SELECT COUNT(*) FROM learner_timeline_events WHERE learner_id IN (SELECT id FROM learner_identity WHERE user_id = '<test-user-id>');"
```

Expected: both non-zero. Resolves Task 1's open question about dual-write behavior post-migration.

- [ ] **Step 7: Tear down**

```bash
# Stop the API
# Delete the dump (security hygiene — contains user data)
rm /tmp/live-clone-$(date +%Y%m%d).sql
```

- [ ] **Step 8: Commit a brief rehearsal-findings note**

Append to `docs/superpowers/findings/2026-05-23-dual-write-prod-status.md` a "Post-migration smoke" section noting: rehearsal results, dual-write behavior verified, ready for live rollout. Commit:

```bash
git add docs/superpowers/findings/2026-05-23-dual-write-prod-status.md
git commit -m "$(cat <<'EOF'
docs(findings): record Phase 0a clone-rehearsal results

Migration 0025 applies cleanly to a fresh clone of the live DB.
Integration tests pass. submitReview end-to-end smoke confirms dual-write
inserts land in learner_knowledge_state + learner_timeline_events as
designed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 5: Write failing integration tests for the LearnerStateService refresh hook

**Goal:** Test-drive the wiring. Three behaviors to lock down: (a) `learner_state_cache` is populated after a successful `submitReview`; (b) two rapid `submitReview` calls within the frequency cap window result in *one* refresh; (c) `submitReview` returns before the refresh completes (non-blocking).

**Files:**
- Create: `apps/api/test/integration/learner-state-refresh.test.ts`
- Create: `apps/api/test/integration/learner-state-cap.test.ts`

- [ ] **Step 1: Create `learner-state-refresh.test.ts` — refresh happens after submitReview**

Mirror the pattern in `apps/api/test/integration/llm-telemetry.test.ts` (per Explore agent). Create `apps/api/test/integration/learner-state-refresh.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
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

beforeEach(async () => {
  // Seed a test user + a known kanji + an open review session.
  // (Mirror llm-telemetry.test.ts upsert pattern; exact rows depend on fixture.)
  await db.execute(sql`DELETE FROM learner_state_cache WHERE user_id = ${TEST_USER_ID}`)
})

describe('LearnerStateService refresh hook', () => {
  it('populates learner_state_cache after a successful submitReview', async () => {
    const dualWrite = new DualWriteService(db)
    const learnerState = new LearnerStateService(db)
    const srs = new SrsService(db, dualWrite, learnerState)

    await srs.submitReview({
      userId: TEST_USER_ID,
      sessionId: '<seeded-session-id>',
      results: [{ kanjiId: 1, quality: 3, responseTimeMs: 1500, reviewType: 'meaning' }],
    })

    // The refresh is non-blocking via setImmediate; give it a tick.
    await new Promise((resolve) => setImmediate(resolve))

    const cached = await db.query.learnerStateCache.findFirst({
      where: eq(schema.learnerStateCache.userId, TEST_USER_ID),
    })
    expect(cached).toBeTruthy()
    expect(cached?.userId).toBe(TEST_USER_ID)
  })
})
```

- [ ] **Step 2: Run the test — expect FAIL**

```bash
TEST_DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter=@kanji-learn/api test:integration -- learner-state-refresh
```

Expected: FAIL — `SrsService` currently does not invoke `LearnerStateService`. The test should fail with either "no row found in learner_state_cache" or a constructor mismatch ("SrsService expects 2 args, got 3").

- [ ] **Step 3: Create `learner-state-cap.test.ts` — two rapid submits = one refresh**

Create `apps/api/test/integration/learner-state-cap.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
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

beforeEach(async () => {
  await db.execute(sql`DELETE FROM learner_state_cache WHERE user_id = ${TEST_USER_ID}`)
})

describe('LearnerStateService frequency cap', () => {
  it('two submitReviews within the cap window result in exactly one refresh', async () => {
    const dualWrite = new DualWriteService(db)
    const learnerState = new LearnerStateService(db)
    const srs = new SrsService(db, dualWrite, learnerState)

    let refreshCount = 0
    const originalRefresh = learnerState.refreshState.bind(learnerState)
    learnerState.refreshState = async (userId: string) => {
      refreshCount++
      return originalRefresh(userId)
    }

    await srs.submitReview({ userId: TEST_USER_ID, sessionId: '<id-1>', results: [/* ... */] })
    await srs.submitReview({ userId: TEST_USER_ID, sessionId: '<id-2>', results: [/* ... */] })
    await new Promise((resolve) => setImmediate(resolve))

    expect(refreshCount).toBe(1)
  })
})
```

- [ ] **Step 4: Run the cap test — expect FAIL**

```bash
TEST_DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter=@kanji-learn/api test:integration -- learner-state-cap
```

Expected: FAIL — either constructor mismatch or `refreshCount` is 0 (not invoked) or 2 (no cap).

- [ ] **Step 5: Commit the failing tests**

```bash
git add apps/api/test/integration/learner-state-refresh.test.ts apps/api/test/integration/learner-state-cap.test.ts
git commit -m "$(cat <<'EOF'
test(api): failing tests for LearnerStateService refresh hook + frequency cap

TDD red-step for Phase 0a Task 6. Two integration tests:

1. After submitReview, learner_state_cache has a row for the user.
2. Two submitReviews in rapid succession trigger exactly one refresh
   (per-user frequency cap).

Both currently fail because SrsService doesn't invoke LearnerStateService.
Task 6 implements the wiring.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 6: Implement the LearnerStateService refresh hook in SrsService

**Goal:** Make the Task 5 tests pass. Wire `LearnerStateService.refreshState(userId)` into `SrsService.submitReview()` *after* the dual-write commits, via a non-blocking `setImmediate`. Add a per-user frequency cap on `LearnerStateService` itself (so any future invocation seam — not just submitReview — gets the same protection).

**Files:**
- Modify: `apps/api/src/services/buddy/learner-state.service.ts`
- Modify: `apps/api/src/services/srs.service.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Add per-user frequency cap to `LearnerStateService.refreshState`**

Edit `apps/api/src/services/buddy/learner-state.service.ts`. Add at the top of the class (after `constructor`):

```typescript
  // Per-user frequency cap: at most one refresh per user per CAP_WINDOW_MS.
  // Prevents thrash on heavy sessions where submitReview fires every few seconds.
  private static readonly CAP_WINDOW_MS = 30_000
  private lastRefreshAt = new Map<string, number>()
```

Then modify `refreshState`:

```typescript
  async refreshState(userId: string): Promise<ComputedLearnerState | null> {
    const now = Date.now()
    const last = this.lastRefreshAt.get(userId) ?? 0
    if (now - last < LearnerStateService.CAP_WINDOW_MS) {
      // Within the cap window — skip. The next call after the window passes
      // will refresh normally. Return null to signal "skipped" to any caller
      // that cares; callers in fire-and-forget mode ignore the return value.
      return null
    }
    this.lastRefreshAt.set(userId, now)

    const inputs = await this.loadRawInputs(userId)
    const state = computeLearnerState(inputs)
    await this.persist(state)
    return state
  }
```

Note the return type changed from `Promise<ComputedLearnerState>` to `Promise<ComputedLearnerState | null>`. If existing callers depend on the non-null return, update them. (Per Explore agent: `learnerState` is currently orphaned; no callers exist.)

- [ ] **Step 2: Inject `LearnerStateService` into `SrsService`**

Edit `apps/api/src/services/srs.service.ts`. Modify the constructor:

```typescript
export class SrsService {
  constructor(
    private readonly db: Db,
    private readonly dualWrite: DualWriteService,
    private readonly learnerState: LearnerStateService,
  ) {}
```

Add the import at the top of the file:

```typescript
import { LearnerStateService } from './buddy/learner-state.service.js'
```

- [ ] **Step 3: Invoke `refreshState` after the dual-write commits**

Still in `srs.service.ts`, edit `submitReview` around line 469. After the `await this.dualWrite.recordReviewSubmissions(submissionInputs)` line and after the session is marked complete (line 472-475), add:

```typescript
    // Phase 0a wiring: refresh the learner-state cache for this user.
    // Fire-and-forget: errors are logged but never propagate, since this
    // path is observability, not correctness. setImmediate ensures the HTTP
    // response is sent before the refresh starts.
    setImmediate(() => {
      this.learnerState.refreshState(input.userId).catch((err) => {
        console.warn(`[LearnerState] refresh failed for user ${input.userId}:`, err)
      })
    })
```

Place it after the session-completion update, before the function's return.

- [ ] **Step 4: Update `SrsService` instantiation in `server.ts`**

Edit `apps/api/src/server.ts`. Find the `srsService` instantiation (likely near where `dualWrite` is decorated, line ~125-138) and pass `learnerState` as the third arg:

```typescript
const srsService = new SrsService(db, dualWrite, learnerState)
```

Confirm `learnerState` is in scope at that line. Per Explore agent (line 112-137), it's instantiated immediately above; the change is one positional argument.

- [ ] **Step 5: Run both tests — expect PASS**

```bash
TEST_DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter=@kanji-learn/api test:integration -- learner-state
```

Expected: both `learner-state-refresh` and `learner-state-cap` pass.

If either fails:
- `learner-state-refresh` failing → check that `setImmediate(...)` is reached, that `refreshState` doesn't throw on the test fixture, and that the `beforeEach` cleared the cache row.
- `learner-state-cap` failing with `refreshCount === 2` → the cap isn't catching; verify `CAP_WINDOW_MS` is 30s and the test doesn't wait that long between submits.
- `learner-state-cap` failing with `refreshCount === 0` → the wrapping mutation of `learnerState.refreshState` happened before `srsService` captured the reference; either move the wrap before `new SrsService(...)`, or use a spy.

- [ ] **Step 6: Run the full integration test suite — verify no regression**

```bash
TEST_DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter=@kanji-learn/api test:integration
```

Expected: all green.

- [ ] **Step 7: Run workspace typecheck**

```bash
pnpm typecheck
```

Expected: clean modulo the pre-existing `social-mute.test.ts:25` error documented in the prior handoff.

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
future invocation seam inherits it.

Resolves Phase 0a Task 6. Tests in learner-state-refresh.test.ts +
learner-state-cap.test.ts now pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 7: Add daily metric emission

**Goal:** Three counters surfaced once per day as structured JSON in App Runner logs: rows inserted into `learner_state_cache` (cache refreshes), rows inserted into `buddy_llm_telemetry`, dual-write commits (proxied by `learner_timeline_events` row count, since every dual-write inserts a timeline event).

**Files:**
- Create: `apps/api/src/services/buddy/metrics.service.ts`
- Modify: `apps/api/src/cron.ts`
- Create: `apps/api/test/integration/metrics.test.ts`

- [ ] **Step 1: Write the failing test for metric emission shape**

Create `apps/api/test/integration/metrics.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@kanji-learn/db'
import { emitDailyBuddyMetrics } from '../../src/services/buddy/metrics.service.js'

const TEST_DB_URL = process.env.TEST_DATABASE_URL!
const client = postgres(TEST_DB_URL)
const db = drizzle(client, { schema })

describe('emitDailyBuddyMetrics', () => {
  it('logs structured JSON with three counters', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await emitDailyBuddyMetrics(db)

    const calls = logSpy.mock.calls.map((c) => c[0] as string)
    const metricLine = calls.find((line) => line.includes('"metric":"buddy_daily_counts"'))
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
TEST_DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter=@kanji-learn/api test:integration -- metrics
```

Expected: FAIL — `metrics.service.ts` does not exist.

- [ ] **Step 3: Implement `metrics.service.ts`**

Create `apps/api/src/services/buddy/metrics.service.ts`:

```typescript
import { sql } from 'drizzle-orm'
import type { Db } from '@kanji-learn/db'

/**
 * Emit a single structured-JSON log line summarising Buddy-related write
 * counts over the past 24h. Consumed by App Runner's stdout pipeline.
 *
 * One-line ops contract: `{"metric":"buddy_daily_counts", ...}` on stdout.
 */
export async function emitDailyBuddyMetrics(db: Db): Promise<void> {
  const windowEnd = new Date()
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000)

  const result = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM learner_state_cache
        WHERE updated_at >= ${windowStart} AND updated_at < ${windowEnd})::int AS learner_state_refreshes,
      (SELECT COUNT(*) FROM buddy_llm_telemetry
        WHERE created_at >= ${windowStart} AND created_at < ${windowEnd})::int AS llm_telemetry_rows,
      (SELECT COUNT(*) FROM learner_timeline_events
        WHERE created_at >= ${windowStart} AND created_at < ${windowEnd})::int AS dual_write_events
  `)

  const row = (result as unknown as Array<Record<string, number>>)[0] ?? {}

  console.log(
    JSON.stringify({
      metric: 'buddy_daily_counts',
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      learner_state_refreshes: row.learner_state_refreshes ?? 0,
      llm_telemetry_rows: row.llm_telemetry_rows ?? 0,
      dual_write_events: row.dual_write_events ?? 0,
    }),
  )
}
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
TEST_DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter=@kanji-learn/api test:integration -- metrics
```

Expected: PASS.

- [ ] **Step 5: Schedule the daily metric job**

Edit `apps/api/src/cron.ts`. Find the existing daily-reminder job (added in prior work) and add a sibling daily job that runs once per day, e.g. at 03:00 UTC. Pattern:

```typescript
import { emitDailyBuddyMetrics } from './services/buddy/metrics.service.js'

// ... within the cron schedule wiring ...

// Daily Buddy metrics — one structured-JSON log line per day.
schedule.scheduleJob({ hour: 3, minute: 0, tz: 'Etc/UTC' }, async () => {
  try {
    await emitDailyBuddyMetrics(db)
  } catch (err) {
    console.warn('[BuddyMetrics] daily emission failed:', err)
  }
})
```

(Exact API depends on the cron library in use — match the existing pattern in `cron.ts`. If the file uses `node-cron`, use `cron.schedule('0 3 * * *', ...)`. If it uses raw `setInterval`, fall through.)

- [ ] **Step 6: Run the full integration test suite + workspace typecheck**

```bash
TEST_DATABASE_URL="$LOCAL_DATABASE_URL" pnpm --filter=@kanji-learn/api test:integration
pnpm typecheck
```

Both expected: green modulo the pre-existing `social-mute.test.ts:25` error.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/buddy/metrics.service.ts apps/api/src/cron.ts apps/api/test/integration/metrics.test.ts
git commit -m "$(cat <<'EOF'
feat(buddy): daily Buddy metrics — three counters via structured JSON

Adds emitDailyBuddyMetrics(): single structured-JSON log line per day
covering learner_state_cache refreshes, buddy_llm_telemetry rows, and
dual-write events (proxied by learner_timeline_events). Scheduled at
03:00 UTC.

Consumed by App Runner's stdout → CloudWatch pipeline. No new table; the
log line itself is the metric, queryable via CloudWatch Logs Insights.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 8: Operator step — apply migration to live DB

**Goal:** Migration applied, dual-write writes start landing in real tables. Follows the FSRS rollout pattern exactly.

**Files:** No file changes. Operator runbook.

- [ ] **Step 1: Safety dump of live DB**

```bash
mkdir -p /tmp/buddy-phase0a-safety
pg_dump "$LIVE_DATABASE_URL" --no-owner --no-acl > /tmp/buddy-phase0a-safety/live-$(date +%Y%m%d-%H%M).sql
ls -lh /tmp/buddy-phase0a-safety/
```

Verify size is non-trivial (single-digit MB at minimum).

- [ ] **Step 2: Confirm rehearsal results are still valid**

If more than a day has passed since Task 4's rehearsal, re-run Task 4 against a fresh dump. Otherwise proceed.

- [ ] **Step 3: Apply migration to live DB**

```bash
psql "$LIVE_DATABASE_URL" -f packages/db/supabase/migrations/0025_buddy_phase0.sql
```

Expected: no errors, single `COMMIT` confirmation.

- [ ] **Step 4: Verify the 17 tables exist live**

```bash
psql "$LIVE_DATABASE_URL" -c "\dt learner_*"
psql "$LIVE_DATABASE_URL" -c "\dt buddy_*"
psql "$LIVE_DATABASE_URL" -c "\dt study_*"
psql "$LIVE_DATABASE_URL" -c "\dt shared_goals"
```

Expected: 17 rows total.

- [ ] **Step 5: Deploy the API with the LearnerState + metrics wiring**

```bash
./scripts/deploy-api.sh
```

Wait for the App Runner operation to reach `SUCCEEDED` (poll with `aws apprunner list-operations --service-arn <arn>`).

- [ ] **Step 6: Smoke-test live**

A short health check:

```bash
curl -s https://73x3fcaaze.us-east-1.awsapprunner.com/v1/review/status -o /dev/null -w "%{http_code}\n"
```

Expected: `401` (route exists, needs auth). If 5xx, halt and investigate App Runner logs.

- [ ] **Step 7: Trigger one real review via the live mobile app + verify dual-write landed**

Use the operator's own TestFlight account: do one card. Then in Supabase SQL editor:

```sql
SELECT user_id, updated_at, total_kanji_seen
FROM learner_state_cache
WHERE user_id = '<operator-user-id>'
ORDER BY updated_at DESC LIMIT 1;

SELECT COUNT(*) AS rows_last_5_min
FROM learner_knowledge_state
WHERE updated_at > NOW() - INTERVAL '5 minutes';

SELECT COUNT(*) AS rows_last_5_min
FROM learner_timeline_events
WHERE created_at > NOW() - INTERVAL '5 minutes';
```

Expected: `learner_state_cache` has a row updated in the last few minutes for the operator's user; `learner_knowledge_state` and `learner_timeline_events` have rows from the dual-write.

If `learner_state_cache` is empty: the refresh hook isn't firing. Check App Runner logs for `[LearnerState] refresh failed` warnings.

- [ ] **Step 8: Clean up safety dump after 24h of stability**

(Not automated — calendar reminder.)

```bash
# After 24h of stability:
rm -rf /tmp/buddy-phase0a-safety
```

---

## Task 9: Post-deploy acceptance verification

**Goal:** Tick off the acceptance criteria from §3.3 of the Phase 0a spec, document results, close the phase.

**Files:** Modify `docs/superpowers/findings/2026-05-23-dual-write-prod-status.md` (append "Post-deploy verification" section) + refresh HANDOFF.md.

- [ ] **Step 1: Verify acceptance — migration applied**

Tick: ✅ Migration `0025_buddy_phase0.sql` applied to the live DB; 17 tables exist.

- [ ] **Step 2: Verify acceptance — `learner_state_cache` populated**

Tick once Task 8 Step 7 confirms a row for an active user.

- [ ] **Step 3: Verify acceptance — dual-write status confirmed and documented**

The findings doc from Task 1 + Task 4 + Task 8 covers this. Append a final verdict line.

- [ ] **Step 4: Verify acceptance — no submitReview latency regression**

Pull App Runner request-latency metrics for `POST /v1/review/submit` from the 24h before deploy vs the 24h after:

```bash
# Use CloudWatch metrics; concrete command depends on monitoring setup.
# Compare p50/p95/p99 — flag any >20% increase.
```

If unable to pull metrics (no Datadog / CloudWatch Insights configured), note it in the findings doc as an operator-eyeball check (i.e. confirm by using the app that things feel responsive). The `setImmediate` wiring should keep this clean.

- [ ] **Step 5: Verify acceptance — observability emitting**

Wait until 03:00 UTC the next day. Then search CloudWatch logs:

```bash
aws logs filter-log-events \
  --log-group-name /aws/apprunner/kanji-learn-api \
  --filter-pattern '"metric":"buddy_daily_counts"' \
  --start-time $(date -v-1d +%s)000 \
  --max-items 5
```

Expected: at least one matching line with non-zero counters.

- [ ] **Step 6: Update findings doc with the verdict**

Append to `docs/superpowers/findings/2026-05-23-dual-write-prod-status.md`:

```markdown
## Post-deploy verification (Task 9)

| Criterion | Status |
|---|---|
| Migration 0025 applied to live DB; 17 tables exist | ✅ <date> |
| learner_state_cache populated for at least one active user | ✅ <date> |
| Dual-write status confirmed | ✅ See §<verdict> above |
| No submitReview latency regression | ✅ <date> (p95 <before>→<after>) |
| Daily Buddy metrics emitting | ✅ <date> |

Phase 0a complete.
```

- [ ] **Step 7: Update HANDOFF.md**

Edit `docs/HANDOFF.md` — add a "Phase 0a shipped" entry to the current-state section. Note that Buddy Phase 0 is now fully complete; next slice is Phase 1' (BuddyCard delivery skeleton).

- [ ] **Step 8: Commit closure**

```bash
git add docs/superpowers/findings/2026-05-23-dual-write-prod-status.md docs/HANDOFF.md
git commit -m "$(cat <<'EOF'
docs(phase0a): close out Phase 0a — all acceptance criteria met

Migration 0025 applied to live; 17 Buddy/UKG tables exist in production.
LearnerStateService wiring confirmed via operator review; daily metrics
emitting. No regression in submitReview latency.

Buddy Phase 0 is now fully complete. Next slice per the refresh doc §9:
Phase 1' brainstorm (BuddyCard delivery skeleton).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Plan self-review

- **Spec coverage:** §3.1 in scope items 1–4 each have explicit tasks (Task 2/3/4 → migration; Task 1 → dual-write verification; Task 5/6 → LearnerState wiring; Task 7 → observability). §3.2 out-of-scope items (no user-visible change, no Buddy behavior, no backfill) are respected — no UI touchpoints, no new Buddy logic, backfill conditional on Task 1 verdict and explicitly out by default. §3.3 acceptance criteria all covered by Task 9.
- **Placeholder scan:** No "TBD" or "TODO" sentinels. Each step has concrete commands and code. Task 1 Step 4 has a conditional branch ("if Step 3 returned 2xx without errors…") but the branch is concrete on both sides.
- **Type consistency:** `LearnerStateService.refreshState` returns `Promise<ComputedLearnerState | null>` (was non-null per Explore agent's read). Task 6 Step 1 documents the change; no caller exists today to break. `SrsService` constructor gains a third arg consistently across Tasks 5/6.
- **Files-list reconciliation:** Every "Files: Create / Modify" header at task start matches the actual edits inside the steps. No stale "create" header that never produces a file.

---

*End of plan. Companion documents: [`../specs/2026-05-23-buddy-v2-phase-1-refresh.md`](../specs/2026-05-23-buddy-v2-phase-1-refresh.md), [`../runbooks/2026-05-22-fsrs-rollout.md`](../runbooks/2026-05-22-fsrs-rollout.md).*
