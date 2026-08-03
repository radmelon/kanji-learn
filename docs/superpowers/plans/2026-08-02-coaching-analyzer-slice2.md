# Coaching Analyzer Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill `LearnerSnapshot` from Postgres, run slice 1's `analyze()`, and write the result as a superseding notebook entry — the first user-visible coaching output.

**Architecture:** A new `CoachingService` assembles the snapshot from seven tables, calls the pure `analyze()` from `@kanji-learn/shared`, and writes one keyed `notebook_entries` row per analysis. Finding memory (`kind`/`since`/`lastRaisedAt`) rides in that row's existing `source` JSONB, read back from the most recent coaching row whether or not it was superseded. No client code changes: `assembleNotebook` buckets entries by `kind`, so a `kind: 'observation'` row renders under "What Buddy notices" already.

**Tech Stack:** TypeScript, Fastify, Drizzle ORM, Postgres, Vitest.

Spec: https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-02-coaching-slice2-design.md

## Global Constraints

- **No new dependencies.** `packages/shared` has no `@types/node` by design — no `fs`, no `__dirname`, no `process` in shared code or its tests.
- **Every verification step runs BOTH the test command and `pnpm typecheck`.** Slice 1 shipped a test file that passed vitest and failed typecheck with four errors. A step naming only a test command cannot catch that class of defect.
- **Slice 2 is API-only.** Do not modify anything under `apps/mobile`.
- **`packages/shared/src/coaching/` stays pure** — no I/O, no clock. `now` is always a parameter.
- **Local test DB:** `postgresql://kanji:kanji@localhost:5433/kanji_buddy_test?sslmode=disable` (user `kanji`, NOT `postgres`). See https://github.com/radmelon/kanji-learn/blob/main/docs/local-test-db.md. Do **not** re-run the migration list on an existing DB; that strips RLS.
- **The test DB holds 2,286 kanji** — verified 2026-08-02. `CLAUDE.md` and slice 1's notes say 7; the corpus has been imported since. Tests here still resolve kanji ids by query rather than hardcoding, which is correct either way.
- **API integration tests authenticate with a bare `x-test-user-id` header.** There is no `test/helpers/auth.ts`, only `test-app.ts`.
- Source kind string is exactly `'coaching_analysis'` everywhere.
- Commit after every task. One commit per task.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/coaching/persistence.ts` | **Create.** `carryForward`, `selectionsMatch` — the stamp rules, pure. |
| `packages/shared/src/coaching/persistence.test.ts` | **Create.** Shared-lane tests for the above. |
| `packages/shared/src/coaching/copy.ts` | **Modify.** Add `analysisBody`; reword `commitment_gap`. |
| `packages/shared/src/coaching/index.ts` | **Modify.** Re-export the new symbols. |
| `packages/db/supabase/migrations/0034_coaching_analysis_index.sql` | **Create.** Partial unique index. |
| `docs/local-test-db.md` | **Modify.** Add 0034 to the migration list. |
| `apps/api/src/services/notebook.service.ts` | **Modify.** Payload-carrying `writeKeyedEntry`; `readLatestKeyed`; `updateEntryInPlace`. |
| `apps/api/src/services/buddy/commitment.service.ts` | **Modify.** `getSessionDates`, `getLastCompletedPeriod`. |
| `apps/api/src/services/buddy/coaching.service.ts` | **Create.** `assembleSnapshot`, `refresh`. |
| `apps/api/src/routes/notebook.ts` | **Modify.** Stale-gated refresh on GET. |
| `apps/api/src/routes/placement.ts` | **Modify.** Forced refresh after completion. |
| `apps/api/src/routes/buddy-session.ts` | **Modify.** Forced refresh after commitment. |
| `apps/api/test/integration/coaching-*.test.ts` | **Create.** Three integration files, one per concern. |

### One refinement to the spec, made deliberately

Spec §2 says the coalescing window is "implemented inside `carryForward`". This plan puts the **row-selection** half in `CoachingService` instead and keeps `carryForward` pure over whatever priors it is handed. Reason: coalescing means "the previous entry is not yet real history", which is a decision about *which row to read* and *whether to supersede or update in place* — both are database concerns. `carryForward` stays a two-argument pure function that is trivial to test. Same behaviour, better seam.

---

### Task 1: The stamp rules — `carryForward` and `selectionsMatch`

**Files:**
- Create: `packages/shared/src/coaching/persistence.ts`
- Test: `packages/shared/src/coaching/persistence.test.ts`
- Modify: `packages/shared/src/coaching/index.ts`

**Interfaces:**
- Consumes: `Finding`, `FindingKind`, `PriorFinding` from `./types`.
- Produces:
  - `carryForward(priors: readonly PriorFinding[], selected: readonly Finding[], now: string): PriorFinding[]`
  - `selectionsMatch(priors: readonly PriorFinding[], selected: readonly Finding[]): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/coaching/persistence.test.ts
import { describe, it, expect } from 'vitest'
import { carryForward, selectionsMatch } from './persistence'
import type { Finding, FindingKind, PriorFinding } from './types'

function finding(kind: FindingKind): Finding {
  return { kind, magnitude: 0.5, confidence: 1, evidence: [], since: null }
}

const NOW = '2026-08-02T12:00:00.000Z'

describe('carryForward', () => {
  it('stamps both dates with now for a kind that was not selected before', () => {
    const result = carryForward([], [finding('reading_lag')], NOW)
    expect(result).toEqual([
      { kind: 'reading_lag', since: NOW, lastRaisedAt: NOW },
    ])
  })

  it('preserves BOTH stamps for a kind that stays selected', () => {
    // This is the whole point: a finding on display keeps its lastRaisedAt,
    // so its novelty RECOVERS rather than being re-floored every run.
    const priors: PriorFinding[] = [
      { kind: 'reading_lag', since: '2026-07-01', lastRaisedAt: '2026-07-20' },
    ]
    const result = carryForward(priors, [finding('reading_lag')], NOW)
    expect(result).toEqual([
      { kind: 'reading_lag', since: '2026-07-01', lastRaisedAt: '2026-07-20' },
    ])
  })

  it('restamps only on a transition from absent to selected', () => {
    const priors: PriorFinding[] = [
      { kind: 'leech', since: '2026-07-01', lastRaisedAt: '2026-07-20' },
    ]
    const result = carryForward(priors, [finding('leech'), finding('reading_lag')], NOW)
    expect(result).toEqual([
      { kind: 'leech', since: '2026-07-01', lastRaisedAt: '2026-07-20' },
      { kind: 'reading_lag', since: NOW, lastRaisedAt: NOW },
    ])
  })

  it('drops kinds that are no longer selected', () => {
    const priors: PriorFinding[] = [
      { kind: 'leech', since: '2026-07-01', lastRaisedAt: '2026-07-20' },
    ]
    const result = carryForward(priors, [finding('reading_lag')], NOW)
    expect(result.map((p) => p.kind)).toEqual(['reading_lag'])
  })

  it('starts a NEW episode when a kind returns after dropping out', () => {
    // `since` deliberately does not survive a gap — priors only ever carry the
    // immediately preceding analysis, so a returning kind is a new episode.
    const priors: PriorFinding[] = []
    const result = carryForward(priors, [finding('leech')], NOW)
    expect(result[0].since).toBe(NOW)
  })

  it('returns an empty array for an empty selection', () => {
    expect(carryForward([], [], NOW)).toEqual([])
  })
})

describe('selectionsMatch', () => {
  it('is true when the same kinds are selected, regardless of order', () => {
    const priors: PriorFinding[] = [
      { kind: 'leech', since: NOW, lastRaisedAt: NOW },
      { kind: 'reading_lag', since: NOW, lastRaisedAt: NOW },
    ]
    expect(selectionsMatch(priors, [finding('reading_lag'), finding('leech')])).toBe(true)
  })

  it('is false when a kind is added', () => {
    const priors: PriorFinding[] = [{ kind: 'leech', since: NOW, lastRaisedAt: NOW }]
    expect(selectionsMatch(priors, [finding('leech'), finding('reading_lag')])).toBe(false)
  })

  it('is false when a kind is removed', () => {
    const priors: PriorFinding[] = [
      { kind: 'leech', since: NOW, lastRaisedAt: NOW },
      { kind: 'reading_lag', since: NOW, lastRaisedAt: NOW },
    ]
    expect(selectionsMatch(priors, [finding('leech')])).toBe(false)
  })

  it('is true for two empty selections', () => {
    expect(selectionsMatch([], [])).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanji-learn/shared test -- persistence`
Expected: FAIL — `Failed to resolve import "./persistence"`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/coaching/persistence.ts
import type { Finding, PriorFinding } from './types'

/**
 * Finding memory across analyses (spec §4 of the slice 2 design).
 *
 * Pure by design. The DECISION about which prior row to read — including the
 * coalescing window for back-to-back runs — belongs to the caller, because it
 * is a question about database rows. This module only answers "given these
 * priors and this selection, what are the new stamps".
 */

/**
 * TRANSITION-ONLY RESTAMPING, and the reason it is not "restamp everything".
 *
 * Re-stamping every selected finding on every write re-floors its novelty each
 * run: run 1 picks A/B/C and floors them, run 2 sees D/E at novelty 1.0 and
 * displaces them, run 3 flips back. The learner sees different content on every
 * open, and throttling the write rate only slows that down.
 *
 * Keeping the stamp while a finding stays selected lets its novelty RECOVER on
 * display, which is exactly what §4 of the parent spec asks for: "a finding
 * that has been true for six weeks is not less important than a new one — it is
 * more important, and going quiet on it is the coaching failure this policy
 * exists to prevent."
 *
 * `since` carries from the immediately preceding analysis ONLY. A kind that
 * drops out and later returns starts a new episode — more truthful than
 * claiming unbroken continuity, and the full history stays reconstructible by
 * walking the superseded chain.
 */
export function carryForward(
  priors: readonly PriorFinding[],
  selected: readonly Finding[],
  now: string,
): PriorFinding[] {
  return selected.map((f) => {
    const prior = priors.find((p) => p.kind === f.kind)
    return prior
      ? { kind: f.kind, since: prior.since, lastRaisedAt: prior.lastRaisedAt }
      : { kind: f.kind, since: now, lastRaisedAt: now }
  })
}

/**
 * Whether this analysis says the same thing as the stored one.
 *
 * Drives the "update analyzedAt in place rather than superseding" rule: without
 * it the notebook-open path inserts a byte-identical duplicate every staleness
 * window, and the superseded chain that §4 calls the trajectory becomes a run
 * of identical rows.
 */
export function selectionsMatch(
  priors: readonly PriorFinding[],
  selected: readonly Finding[],
): boolean {
  if (priors.length !== selected.length) return false
  const priorKinds = new Set(priors.map((p) => p.kind))
  return selected.every((f) => priorKinds.has(f.kind))
}
```

- [ ] **Step 4: Re-export from the barrel**

Add to `packages/shared/src/coaching/index.ts`:

```ts
export { carryForward, selectionsMatch } from './persistence'
```

- [ ] **Step 5: Run tests AND typecheck**

Run: `pnpm --filter @kanji-learn/shared test -- persistence`
Expected: PASS, 10 tests.

Run: `pnpm typecheck`
Expected: PASS, 4/4 projects.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/coaching/persistence.ts packages/shared/src/coaching/persistence.test.ts packages/shared/src/coaching/index.ts
git commit -m "feat(coaching): transition-only finding stamps and selection comparison"
```

---

### Task 2: Notebook body copy — `analysisBody` and the `commitment_gap` reword

**Files:**
- Modify: `packages/shared/src/coaching/copy.ts`
- Test: `packages/shared/src/coaching/copy.test.ts` (create if absent; append if present)
- Modify: `packages/shared/src/coaching/index.ts`

**Interfaces:**
- Consumes: `Finding` from `./types`; `templateCopy` from `./copy`.
- Produces: `analysisBody(findings: readonly Finding[], now: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/coaching/copy.test.ts
import { describe, it, expect } from 'vitest'
import { analysisBody, templateCopy } from './copy'
import type { Finding, FindingKind } from './types'

function finding(kind: FindingKind, since: string | null = null): Finding {
  return { kind, magnitude: 0.8, confidence: 1, evidence: [], since }
}

const NOW = '2026-08-02T12:00:00.000Z'

describe('analysisBody', () => {
  it('joins each finding with a blank line', () => {
    const body = analysisBody([finding('reading_lag'), finding('leech')], NOW)
    expect(body).toBe(
      `${templateCopy(finding('reading_lag'), NOW)}\n\n${templateCopy(finding('leech'), NOW)}`,
    )
  })

  it('returns an empty string for no findings', () => {
    expect(analysisBody([], NOW)).toBe('')
  })

  it('passes `now` through, so a RECENT since does NOT escalate', () => {
    // copy.ts reads `if (!now || days >= ESCALATE_AFTER_DAYS)`. Omitting `now`
    // escalates every finding that has a `since`, whatever its age. This test
    // is what stops analysisBody from dropping the argument.
    const body = analysisBody([finding('reading_lag', '2026-08-01')], NOW)
    expect(body).not.toContain('been true for a while')
  })

  it('DOES escalate a since older than the threshold', () => {
    const body = analysisBody([finding('reading_lag', '2026-06-01')], NOW)
    expect(body).toContain('been true for a while')
  })
})

describe('commitment_gap copy', () => {
  it('describes a finished period, not the current one', () => {
    // Assembly only ever passes a COMPLETED period, so "this period" was wrong.
    const text = templateCopy(finding('commitment_gap'), NOW)
    expect(text).not.toContain('this period')
    expect(text).toContain('last')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanji-learn/shared test -- copy`
Expected: FAIL — `analysisBody` is not exported, and the `commitment_gap` assertion fails on the current string.

- [ ] **Step 3: Implement**

In `packages/shared/src/coaching/copy.ts`, change the `commitment_gap` entry of `BASE`:

```ts
  commitment_gap:
    'You studied less than you promised yourself over the last period.',
```

And append to the same file:

```ts
/**
 * The notebook entry body for one analysis.
 *
 * ⚠️ `now` is NOT optional here, deliberately. `templateCopy` treats a missing
 * `now` as "escalate whenever `since` is set" (see its `!now ||` branch), so a
 * caller that drops the argument silently promotes every persistent finding to
 * "this has been true for a while now" regardless of age. Nothing else would
 * fail.
 */
export function analysisBody(findings: readonly Finding[], now: string): string {
  return findings.map((f) => templateCopy(f, now)).join('\n\n')
}
```

- [ ] **Step 4: Re-export from the barrel**

Add `analysisBody` to the existing `copy` export line in `packages/shared/src/coaching/index.ts`.

- [ ] **Step 5: Run tests AND typecheck**

Run: `pnpm --filter @kanji-learn/shared test`
Expected: PASS. The full shared suite must stay green — if an existing copy test asserted the old `commitment_gap` string, update it to the new one.

Run: `pnpm typecheck`
Expected: PASS, 4/4.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/coaching/copy.ts packages/shared/src/coaching/copy.test.ts packages/shared/src/coaching/index.ts
git commit -m "feat(coaching): analysisBody, and reword commitment_gap to the completed period"
```

---

### Task 3: Migration 0034 — the partial unique index

**Files:**
- Create: `packages/db/supabase/migrations/0034_coaching_analysis_index.sql`
- Modify: `docs/local-test-db.md`

**Interfaces:**
- Consumes: `notebook_entries` from migration 0032.
- Produces: index `notebook_entries_coaching_unique`, relied on by Task 9.

- [ ] **Step 1: Write the migration**

```sql
-- Migration 0034: one live coaching analysis per learner
-- Run order: 34
--
-- Implements docs/superpowers/specs/2026-08-02-coaching-slice2-design.md §6.
--
-- NotebookService.writeKeyedEntry is check-then-act: it finds the live keyed
-- row, inserts a replacement, then supersedes the original. Two concurrent
-- runs both find the same `existing`, both insert, and the second supersede
-- matches zero rows -- leaving TWO live coaching entries, both rendered.
--
-- Onboarding is exactly where that race is most likely: the first Buddy
-- session suggests taking the placement test, so session-completion and
-- placement-completion can fire minutes (or milliseconds) apart.
--
-- This mirrors notebook_entries_first_open_unique in migration 0032, whose
-- header explains the same reasoning. It permits one LIVE coaching row per
-- user, not one ever -- superseding must keep working.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS notebook_entries_coaching_unique
  ON notebook_entries (user_id)
  WHERE source->>'kind' = 'coaching_analysis' AND superseded_at IS NULL;

COMMIT;
```

- [ ] **Step 2: Add it to the local test DB migration list**

In `docs/local-test-db.md`, add this line immediately after the `0033_met_buddy_at.sql` line in the `psql` invocation:

```
  -f packages/db/supabase/migrations/0034_coaching_analysis_index.sql \
```

- [ ] **Step 3: Apply it to the local test database only**

Run:

```bash
psql "postgresql://kanji:kanji@localhost:5433/kanji_buddy_test?sslmode=disable" -f packages/db/supabase/migrations/0034_coaching_analysis_index.sql
```

Expected: `CREATE INDEX`.

**Do NOT run the whole migration list** — `docs/local-test-db.md` is emphatic that re-running it on an existing DB strips RLS. This one file is additive and safe on its own.

**Do NOT apply this to live.** Production rollout is a separate, owner-authorised step.

- [ ] **Step 4: Verify the index exists and its predicate is right**

Run:

```bash
psql "postgresql://kanji:kanji@localhost:5433/kanji_buddy_test?sslmode=disable" -c "SELECT indexdef FROM pg_indexes WHERE indexname='notebook_entries_coaching_unique'"
```

Expected: one row containing both `coaching_analysis` and `superseded_at IS NULL`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/supabase/migrations/0034_coaching_analysis_index.sql docs/local-test-db.md
git commit -m "feat(db): one live coaching analysis per learner (migration 0034)"
```

---

### Task 4: `NotebookService` — carry a source payload, read it back, update in place

**Files:**
- Modify: `apps/api/src/services/notebook.service.ts`
- Test: `apps/api/test/integration/coaching-notebook-store.test.ts` (create)

**Interfaces:**
- Consumes: `notebookEntries` from `@kanji-learn/db`.
- Produces, on `NotebookService`:
  - `KeyedEntryInput` gains `sourcePayload?: Record<string, unknown>`
  - `readLatestKeyed(userId: string, sourceKind: string, skip?: number): Promise<KeyedEntryRow | null>`
  - `updateEntryInPlace(userId: string, id: string, body: string, source: Record<string, unknown>): Promise<void>`
  - `interface KeyedEntryRow { id: string; author: 'buddy' | 'learner'; body: string; source: Record<string, unknown>; createdAt: string; supersededAt: string | null }`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/integration/coaching-notebook-store.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { NotebookService } from '../../src/services/notebook.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const USER = '00000000-0000-0000-0000-0000000000c1'

describe('NotebookService — coaching payload storage', () => {
  const service = new NotebookService(db)

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'CoachingStoreFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })

  const wipe = async () => {
    await db.execute(sql`DELETE FROM notebook_entries WHERE user_id = ${USER}`)
  }
  beforeEach(wipe)
  afterAll(async () => {
    await wipe()
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
  })

  it('round-trips a source payload alongside the kind', async () => {
    await service.writeKeyedEntry(USER, {
      sourceKind: 'coaching_analysis',
      kind: 'observation',
      body: 'Readings are trailing.',
      sourcePayload: {
        analyzedAt: '2026-08-02T12:00:00.000Z',
        findings: [{ kind: 'reading_lag', since: '2026-08-01', lastRaisedAt: '2026-08-01' }],
      },
    })

    const row = await service.readLatestKeyed(USER, 'coaching_analysis')
    expect(row).not.toBeNull()
    expect(row!.source.kind).toBe('coaching_analysis')
    expect(row!.source.analyzedAt).toBe('2026-08-02T12:00:00.000Z')
    expect(row!.source.findings).toEqual([
      { kind: 'reading_lag', since: '2026-08-01', lastRaisedAt: '2026-08-01' },
    ])
  })

  it('readLatestKeyed returns a SUPERSEDED row when it is the most recent', async () => {
    // This is what makes the memory survive a learner deleting the entry:
    // supersedeEntry marks the row, it never removes it.
    const { id } = await service.createEntry(USER, {
      kind: 'observation', body: 'First', author: 'buddy',
      source: { kind: 'coaching_analysis', analyzedAt: 'A', findings: [] },
    })
    await service.supersedeEntry(USER, id, null)

    const row = await service.readLatestKeyed(USER, 'coaching_analysis')
    expect(row).not.toBeNull()
    expect(row!.supersededAt).not.toBeNull()
    expect(row!.source.analyzedAt).toBe('A')
  })

  it('readLatestKeyed can skip to the row before the latest', async () => {
    await service.createEntry(USER, {
      kind: 'observation', body: 'Older', author: 'buddy',
      source: { kind: 'coaching_analysis', analyzedAt: 'OLD', findings: [] },
    })
    // created_at defaults to now(); force a later timestamp so ordering is
    // deterministic rather than dependent on clock resolution.
    await db.execute(sql`INSERT INTO notebook_entries (user_id, kind, body, author, source, created_at)
      VALUES (${USER}, 'observation', 'Newer', 'buddy',
              ${JSON.stringify({ kind: 'coaching_analysis', analyzedAt: 'NEW', findings: [] })}::jsonb,
              now() + interval '1 second')`)

    const latest = await service.readLatestKeyed(USER, 'coaching_analysis')
    const before = await service.readLatestKeyed(USER, 'coaching_analysis', 1)
    expect(latest!.source.analyzedAt).toBe('NEW')
    expect(before!.source.analyzedAt).toBe('OLD')
  })

  it('updateEntryInPlace changes body and source WITHOUT creating a new row', async () => {
    await service.writeKeyedEntry(USER, {
      sourceKind: 'coaching_analysis', kind: 'observation', body: 'Before',
      sourcePayload: { analyzedAt: 'A', findings: [] },
    })
    const row = await service.readLatestKeyed(USER, 'coaching_analysis')

    await service.updateEntryInPlace(USER, row!.id, 'After', {
      kind: 'coaching_analysis', analyzedAt: 'B', findings: [],
    })

    const rows = await db.execute(
      sql`SELECT body, source->>'analyzedAt' AS a FROM notebook_entries WHERE user_id = ${USER}`,
    )
    expect(rows.length).toBe(1)
    expect(rows[0].body).toBe('After')
    expect(rows[0].a).toBe('B')
  })

  it('writeKeyedEntry SUPERSEDES rather than colliding on the second call', async () => {
    // THE REGRESSION TEST FOR THIS TASK'S REORDER.
    //
    // writeKeyedEntry used to insert the replacement BEFORE superseding the
    // original (notebook.service.ts:137 before :143). With migration 0034's
    // partial unique index in place, both rows satisfy the predicate at that
    // instant, so this second call failed with 23505 — on the ordinary path,
    // single-threaded, no race required. supersedeEntry documents the same
    // hazard at :181-186 and orders itself the other way.
    await service.writeKeyedEntry(USER, {
      sourceKind: 'coaching_analysis', kind: 'observation', body: 'First',
      sourcePayload: { analyzedAt: 'A', findings: [] },
    })
    await service.writeKeyedEntry(USER, {
      sourceKind: 'coaching_analysis', kind: 'observation', body: 'Second',
      sourcePayload: { analyzedAt: 'B', findings: [] },
    })

    const rows = await db.execute(
      sql`SELECT id, body, superseded_at, superseded_by FROM notebook_entries
          WHERE user_id = ${USER} AND source->>'kind' = 'coaching_analysis'
          ORDER BY created_at`,
    )
    expect(rows.length).toBe(2)
    const [older, newer] = rows as any[]
    expect(older.body).toBe('First')
    expect(newer.body).toBe('Second')
    // The old row is superseded AND linked to its replacement. The link is a
    // third statement, because supersededBy needs the new row's id — which is
    // why the reorder is supersede -> insert -> link, not just a swap.
    expect(older.superseded_at).not.toBeNull()
    expect(older.superseded_by).toBe(newer.id)
    expect(newer.superseded_at).toBeNull()
  })

  it('the partial unique index permits only one LIVE coaching row', async () => {
    await service.writeKeyedEntry(USER, {
      sourceKind: 'coaching_analysis', kind: 'observation', body: 'One',
      sourcePayload: { analyzedAt: 'A', findings: [] },
    })
    await expect(
      db.execute(sql`INSERT INTO notebook_entries (user_id, kind, body, author, source)
        VALUES (${USER}, 'observation', 'Two', 'buddy',
                ${JSON.stringify({ kind: 'coaching_analysis' })}::jsonb)`),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- coaching-notebook-store`
Expected: FAIL — `service.readLatestKeyed is not a function`.

- [ ] **Step 3: Implement**

In `apps/api/src/services/notebook.service.ts`, extend the input interface:

```ts
export interface KeyedEntryInput {
  sourceKind: string
  kind: 'observation' | 'decision'
  body: string
  weekStart?: string | null
  /** Merged into `source` after `kind`. Slice 2 uses it for the coaching
   *  finding memory (`analyzedAt`, `findings`, `correction`). */
  sourcePayload?: Record<string, unknown>
}

export interface KeyedEntryRow {
  id: string
  author: 'buddy' | 'learner'
  body: string
  source: Record<string, unknown>
  createdAt: string
  supersededAt: string | null
}
```

**Rewrite `writeKeyedEntry`'s transaction body.** Two changes: it carries the payload, and — the reason for the regression test above — it **supersedes before inserting**.

```ts
      const existing = await tx.query.notebookEntries.findFirst({ where: and(...conditions) })

      // Supersede FIRST. Migration 0034 permits one LIVE coaching row per
      // learner, and the old row still matches that predicate until this
      // statement runs — so inserting first put two live rows in the index at
      // the same instant and failed with 23505 on the ordinary second write,
      // single-threaded, no race required. supersedeEntry documents this exact
      // hazard below and orders itself the same way.
      //
      // supersededBy needs the replacement's id, so linking is a third
      // statement rather than part of this one.
      if (existing) {
        await tx.update(notebookEntries)
          .set({ supersededAt: new Date() })
          .where(and(eq(notebookEntries.id, existing.id), isNull(notebookEntries.supersededAt)))
      }

      const [row] = await tx.insert(notebookEntries).values({
        userId, kind: input.kind, body: input.body, author: 'buddy',
        weekStart: input.weekStart ?? null,
        source: { kind: input.sourceKind, ...(input.sourcePayload ?? {}) },
      }).returning({ id: notebookEntries.id })

      if (existing) {
        await tx.update(notebookEntries)
          .set({ supersededBy: row.id })
          .where(eq(notebookEntries.id, existing.id))
      }
```

**This also changes the existing `commitment` write-back path**, which is `writeKeyedEntry`'s only current caller (via `writeCommitmentObservation`). The outcome is identical — same two rows, same `supersededAt`, same `supersededBy` link — only the statement order inside the transaction differs. `apps/api/test/integration/notebook-writeback.test.ts` covers that path and must stay green; run it explicitly in Step 4.

Add two methods to the class:

```ts
  /**
   * The most recent entry with this source kind, SUPERSEDED OR NOT.
   *
   * The missing `superseded_at` predicate is deliberate and load-bearing.
   * `supersedeEntry(userId, id, null)` is the delete path: it marks the row
   * superseded and never removes it. Filtering to live rows here would mean a
   * learner deleting Buddy's observation silently resets the coaching memory,
   * every finding becomes novel again, and §4's decay restarts from nothing.
   *
   * `skip` reads further back — used for the coalescing window, where the
   * previous run is part of the same episode and its stamps must not be
   * treated as history.
   */
  async readLatestKeyed(
    userId: string,
    sourceKind: string,
    skip = 0,
  ): Promise<KeyedEntryRow | null> {
    const rows = await this.db.select().from(notebookEntries)
      .where(and(
        eq(notebookEntries.userId, userId),
        sql`${notebookEntries.source}->>'kind' = ${sourceKind}`,
      ))
      .orderBy(desc(notebookEntries.createdAt))
      .limit(1)
      .offset(skip)

    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      author: row.author as 'buddy' | 'learner',
      body: row.body,
      source: (row.source ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
      supersededAt: row.supersededAt?.toISOString() ?? null,
    }
  }

  /**
   * Rewrite an entry without superseding it — no new row, no chain link.
   *
   * Used when an analysis says the same thing as the stored one (only
   * `analyzedAt` moves) and when two runs coalesce inside the same episode.
   * Superseding in either case would fill the chain with near-identical rows,
   * and that chain is what §4 calls the trajectory.
   */
  async updateEntryInPlace(
    userId: string,
    id: string,
    body: string,
    source: Record<string, unknown>,
  ): Promise<void> {
    await this.db.update(notebookEntries)
      .set({ body, source })
      .where(and(eq(notebookEntries.id, id), eq(notebookEntries.userId, userId)))
  }
```

- [ ] **Step 4: Run tests AND typecheck**

Run: `pnpm --filter @kanji-learn/api test -- coaching-notebook-store`
Expected: PASS, 6 tests.

Run: `pnpm --filter @kanji-learn/api test -- notebook`
Expected: PASS — the three existing notebook integration files must stay green. `notebook-writeback.test.ts` is the one that covers the reordered `writeKeyedEntry` through its existing `commitment` caller; it passing is the evidence that the reorder changed order without changing outcome.

Run: `pnpm typecheck`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/notebook.service.ts apps/api/test/integration/coaching-notebook-store.test.ts
git commit -m "feat(notebook): carry a source payload, read it back across supersedes, update in place"
```

---

### Task 5: `CommitmentService` — session dates and the last completed period

**Files:**
- Modify: `apps/api/src/services/buddy/commitment.service.ts`
- Test: `apps/api/test/integration/coaching-commitment-reads.test.ts` (create)

**Interfaces:**
- Consumes: `buddyCommitments`, `dailyStats` from `@kanji-learn/db`; `addDays` from `@kanji-learn/shared`.
- Produces, on `CommitmentService`:
  - `getSessionDates(userId: string, limit?: number): Promise<string[]>` — `week_start` values where `source='session'`, newest first.
  - `getLastCompletedPeriod(userId: string, now: string, intervalWeeks: number): Promise<{ weekStart: string; periodStart: string; periodEnd: string; promisedMinutes: number } | null>`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/integration/coaching-commitment-reads.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { CommitmentService } from '../../src/services/buddy/commitment.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const USER = '00000000-0000-0000-0000-0000000000c2'

async function commitment(weekStart: string, source: string, days = 4, minutes = 15) {
  await db.execute(sql`INSERT INTO buddy_commitments
    (user_id, week_start, days_committed, minutes_per_day, source)
    VALUES (${USER}, ${weekStart}, ${days}, ${minutes}, ${source})`)
}

describe('CommitmentService — coaching reads', () => {
  const service = new CommitmentService(db)

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'CoachingCommitFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })

  const wipe = async () => {
    await db.execute(sql`DELETE FROM buddy_commitments WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM daily_stats WHERE user_id = ${USER}`)
  }
  beforeEach(wipe)
  afterAll(async () => {
    await wipe()
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
  })

  it('getSessionDates returns only source=session, newest first', async () => {
    await commitment('2026-07-06', 'session')
    await commitment('2026-07-13', 'rolled_forward')
    await commitment('2026-07-20', 'session')
    await commitment('2026-07-27', 'default')

    expect(await service.getSessionDates(USER)).toEqual(['2026-07-20', '2026-07-06'])
  })

  it('getSessionDates respects the limit', async () => {
    await commitment('2026-07-06', 'session')
    await commitment('2026-07-20', 'session')
    expect(await service.getSessionDates(USER, 1)).toEqual(['2026-07-20'])
  })

  it('returns null when the only commitment period has NOT ended', async () => {
    // The defect this whole rule exists for: at the instant a commitment is
    // agreed, actual is 0 and the promise is unmet, so commitment_gap would
    // score 1.0 x 1.0 x 1.0 -- the maximum any finding can score.
    await commitment('2026-08-01', 'session')
    const result = await service.getLastCompletedPeriod(USER, '2026-08-02T12:00:00.000Z', 1)
    expect(result).toBeNull()
  })

  it('returns the most recent period that HAS ended', async () => {
    await commitment('2026-07-13', 'session')
    await commitment('2026-07-20', 'session')   // ends 2026-07-27
    await commitment('2026-08-01', 'session')   // still running
    const result = await service.getLastCompletedPeriod(USER, '2026-08-02T12:00:00.000Z', 1)
    expect(result!.weekStart).toBe('2026-07-20')
    expect(result!.periodStart).toBe('2026-07-20')
    expect(result!.periodEnd).toBe('2026-07-27')
    expect(result!.promisedMinutes).toBe(60)    // 4 days x 15 minutes
  })

  it('excludes source=default — the learner agreed nothing', async () => {
    await commitment('2026-07-20', 'default')
    const result = await service.getLastCompletedPeriod(USER, '2026-08-02T12:00:00.000Z', 1)
    expect(result).toBeNull()
  })

  it('includes source=rolled_forward', async () => {
    await commitment('2026-07-20', 'rolled_forward')
    const result = await service.getLastCompletedPeriod(USER, '2026-08-02T12:00:00.000Z', 1)
    expect(result!.weekStart).toBe('2026-07-20')
  })

  it('uses intervalWeeks for the period length, not a hardcoded 7', async () => {
    // A fortnightly learner's 2026-07-20 period ends 2026-08-03, so on
    // 2026-08-02 it has NOT completed.
    await commitment('2026-07-20', 'session')
    const weekly = await service.getLastCompletedPeriod(USER, '2026-08-02T12:00:00.000Z', 1)
    const fortnightly = await service.getLastCompletedPeriod(USER, '2026-08-02T12:00:00.000Z', 2)
    expect(weekly).not.toBeNull()
    expect(fortnightly).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- coaching-commitment-reads`
Expected: FAIL — `service.getSessionDates is not a function`.

- [ ] **Step 3: Implement**

Add to `CommitmentService` in `apps/api/src/services/buddy/commitment.service.ts`:

```ts
  /**
   * Buddy session dates, newest first — `HookSnapshot.sessionDates`.
   *
   * `source='session'` IS this app's definition of "a Buddy session happened":
   * getMostRecentAgreed above filters exactly this way, and both
   * buddy-session.ts and notification.service.ts feed that to
   * evaluateAppointment as `lastSessionDate`. There is no buddy_sessions table
   * and inventing a second definition would let two parts of the system
   * disagree about the same learner.
   */
  async getSessionDates(userId: string, limit = 10): Promise<string[]> {
    const rows = await this.db.select({ weekStart: buddyCommitments.weekStart })
      .from(buddyCommitments)
      .where(and(
        eq(buddyCommitments.userId, userId),
        eq(buddyCommitments.source, 'session'),
      ))
      .orderBy(desc(buddyCommitments.weekStart))
      .limit(limit)
    return rows.map((r) => r.weekStart)
  }

  /**
   * The most recent commitment period that has ENDED.
   *
   * `commitment_gap` is a statement about a finished period, which is what the
   * weekly session is for. Handing it the CURRENT period means that at the
   * instant a commitment is agreed, `actualMinutes` is 0 against a full
   * promise: magnitude 1.0, confidence 1 (set deliberately -- "a promise and a
   * measurement"), novelty 1.0. Buddy would greet a learner who just committed
   * to four days a week with "you studied less than you promised yourself",
   * and repeat it at the start of every period after that.
   *
   * `default` is excluded: assembleNotebook already treats it as "the learner
   * agreed nothing", and buddy_commitments.source's own schema comment says a
   * missed rolled_forward is not a broken promise because the learner never
   * turned up to agree it. `default` is weaker still. `rolled_forward` IS
   * included -- the register difference is §8's frankness escalator (slice 6).
   */
  async getLastCompletedPeriod(
    userId: string,
    now: string,
    intervalWeeks: number,
  ): Promise<{
    weekStart: string
    periodStart: string
    periodEnd: string
    promisedMinutes: number
  } | null> {
    const periodDays = 7 * intervalWeeks
    const today = now.slice(0, 10)

    const rows = await this.db.select().from(buddyCommitments)
      .where(and(
        eq(buddyCommitments.userId, userId),
        ne(buddyCommitments.source, 'default'),
        isNull(buddyCommitments.supersededAt),
      ))
      .orderBy(desc(buddyCommitments.weekStart))

    for (const row of rows) {
      const periodEnd = addDays(row.weekStart, periodDays)
      if (periodEnd > today) continue
      return {
        weekStart: row.weekStart,
        periodStart: row.weekStart,
        periodEnd,
        promisedMinutes: row.minutesPerDay * row.daysCommitted,
      }
    }
    return null
  }
```

Add `isNull` to the `drizzle-orm` import at the top of the file (`ne` and `desc` are already imported).

- [ ] **Step 4: Run tests AND typecheck**

Run: `pnpm --filter @kanji-learn/api test -- coaching-commitment-reads`
Expected: PASS, 7 tests.

Run: `pnpm --filter @kanji-learn/api test -- commitment`
Expected: PASS — existing commitment tests stay green.

Run: `pnpm typecheck`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/buddy/commitment.service.ts apps/api/test/integration/coaching-commitment-reads.test.ts
git commit -m "feat(buddy): session dates and last-completed-period reads for coaching"
```

---

### Task 6: `CoachingService.assembleSnapshot` — the placement half

**Files:**
- Create: `apps/api/src/services/buddy/coaching.service.ts`
- Test: `apps/api/test/integration/coaching-snapshot.test.ts` (create)

**Interfaces:**
- Consumes: `placementSessions`, `placementResults`, `kanji`, `kanjiDifficulty` from `@kanji-learn/db`; `levelBands`, `inferredLevel`, `JLPT_LEVELS` from `@kanji-learn/shared`.
- Produces:
  - `class CoachingService { constructor(db: Db) }`
  - `assembleSnapshot(userId: string, now: string, priors: PriorFinding[]): Promise<LearnerSnapshot>`
  - `export const REVIEW_WINDOW_DAYS = 30`
  - `export const ANALYSIS_STALE_HOURS = 6`
  - `export const COALESCE_WINDOW_MINUTES = 60`
  - `export const COACHING_SOURCE_KIND = 'coaching_analysis'`

Tasks 7 and 8 fill `reviews`, `commitment` and `hooks` on the same method. This task returns empty/null for those so the placement half is independently testable.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/integration/coaching-snapshot.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { CoachingService } from '../../src/services/buddy/coaching.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const USER = '00000000-0000-0000-0000-0000000000c3'
const NOW = '2026-08-02T12:00:00.000Z'

/** The local test DB holds 7 kanji; never hardcode ids. */
async function kanjiIds(n: number): Promise<number[]> {
  const rows = await db.execute(sql`SELECT id FROM kanji ORDER BY id LIMIT ${n}`)
  return rows.map((r: any) => Number(r.id))
}

describe('CoachingService.assembleSnapshot — placement', () => {
  const service = new CoachingService(db)

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'CoachingSnapshotFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })

  const wipe = async () => {
    await db.execute(sql`DELETE FROM placement_sessions WHERE user_id = ${USER}`)
  }
  beforeEach(wipe)
  afterAll(async () => {
    await wipe()
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
  })

  it('returns placement: null when the learner has never completed one', async () => {
    const snap = await service.assembleSnapshot(USER, NOW, [])
    expect(snap.placement).toBeNull()
    expect(snap.now).toBe(NOW)
  })

  it('ignores an INCOMPLETE placement session', async () => {
    await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level)
      VALUES (${USER}, 0.5, 0.4, 'N4')`)
    const snap = await service.assembleSnapshot(USER, NOW, [])
    expect(snap.placement).toBeNull()
  })

  it('builds the snapshot from the latest completed session', async () => {
    const [k1, k2] = await kanjiIds(2)
    const rows = await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${USER}, 0.5, 0.4, 'N4', now()) RETURNING id`)
    const sessionId = (rows[0] as any).id

    await db.execute(sql`INSERT INTO placement_results
      (session_id, kanji_id, jlpt_level, passed, meaning_correct, reading_correct, difficulty_at_ask)
      VALUES (${sessionId}, ${k1}, 'N5', true, true, false, 0.8),
             (${sessionId}, ${k2}, 'N5', true, true, NULL, 1.2)`)

    const snap = await service.assembleSnapshot(USER, NOW, [])
    expect(snap.placement).not.toBeNull()
    expect(snap.placement!.theta).toBeCloseTo(0.5)
    expect(snap.placement!.se).toBeCloseTo(0.4)
    expect(snap.placement!.level).toBe('N4')
    expect(snap.placement!.previous).toBeNull()
    expect(snap.placement!.items).toHaveLength(2)

    const item = snap.placement!.items.find((i) => i.kanjiId === k1)!
    expect(item.meaningCorrect).toBe(true)
    expect(item.readingCorrect).toBe(false)
    expect(item.difficultyAtAsk).toBeCloseTo(0.8)
    expect(typeof item.character).toBe('string')

    // readingCorrect must stay NULL when the reading half was not asked --
    // the contract says "null when the reading half was not asked for this
    // item", and coercing it to false would invent a wrong answer.
    expect(snap.placement!.items.find((i) => i.kanjiId === k2)!.readingCorrect).toBeNull()
  })

  it('the credible interval brackets theta', async () => {
    await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${USER}, 0.5, 0.4, 'N4', now())`)
    const snap = await service.assembleSnapshot(USER, NOW, [])
    expect(snap.placement!.thetaLow).toBeLessThan(0.5)
    expect(snap.placement!.thetaHigh).toBeGreaterThan(0.5)
  })

  it('populates `previous` from the session before the latest', async () => {
    await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${USER}, 0.1, 0.6, 'N5', now() - interval '30 days')`)
    await db.execute(sql`INSERT INTO placement_sessions
      (user_id, ability_theta, ability_se, inferred_level, completed_at)
      VALUES (${USER}, 0.5, 0.4, 'N4', now())`)

    const snap = await service.assembleSnapshot(USER, NOW, [])
    expect(snap.placement!.theta).toBeCloseTo(0.5)
    expect(snap.placement!.previous).not.toBeNull()
    expect(snap.placement!.previous!.theta).toBeCloseTo(0.1)
  })

  it('passes priorFindings straight through', async () => {
    const priors = [{ kind: 'leech' as const, since: '2026-07-01', lastRaisedAt: '2026-07-20' }]
    const snap = await service.assembleSnapshot(USER, NOW, priors)
    expect(snap.priorFindings).toEqual(priors)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- coaching-snapshot`
Expected: FAIL — cannot resolve `../../src/services/buddy/coaching.service`.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/services/buddy/coaching.service.ts
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm'
import {
  placementSessions, placementResults, kanji, kanjiDifficulty,
} from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import {
  levelBands, inferredLevel, JLPT_LEVELS,
  type JlptLevel, type LearnerSnapshot, type PlacementSnapshot,
  type PlacementItemOutcome, type PriorFinding,
} from '@kanji-learn/shared'

/** Notebook `source->>'kind'` for a coaching analysis. */
export const COACHING_SOURCE_KIND = 'coaching_analysis'

/**
 * Window for CardSnapshot's early/late halves. Slice 1 defined those fields
 * relative to "the window" and never fixed its length -- it is an assembly
 * parameter, and this is the slice that owns it. Split at the midpoint.
 */
export const REVIEW_WINDOW_DAYS = 30

/** A notebook GET re-analyses only when the stored analysis is older than this. */
export const ANALYSIS_STALE_HOURS = 6

/** Two runs closer together than this are one episode -- see refresh(). */
export const COALESCE_WINDOW_MINUTES = 60

/** z for an 80% two-sided interval, matching PlacementSnapshot's contract. */
const Z_80 = 1.2816

export class CoachingService {
  constructor(private readonly db: Db) {}

  async assembleSnapshot(
    userId: string,
    now: string,
    priors: PriorFinding[],
  ): Promise<LearnerSnapshot> {
    return {
      now,
      placement: await this.placement(userId),
      reviews: { cards: [], quiz: [] },
      commitment: null,
      hooks: { count: 0, latestAt: null, sessionDates: [], lapsesWithHook: null, lapsesWithoutHook: null },
      priorFindings: priors,
    }
  }

  private async placement(userId: string): Promise<PlacementSnapshot | null> {
    const sessions = await this.db.select().from(placementSessions)
      .where(and(
        eq(placementSessions.userId, userId),
        isNotNull(placementSessions.completedAt),
      ))
      .orderBy(desc(placementSessions.completedAt))
      .limit(2)

    const latest = sessions[0]
    if (!latest) return null

    // `level` is non-nullable on the contract. A session whose inferredLevel
    // never resolved cannot describe a level, and inventing one would be worse
    // than staying silent -- level_estimate simply does not fire.
    const theta = latest.abilityTheta
    const se = latest.abilitySe
    if (theta === null || se === null || latest.inferredLevel === null) return null

    const items = await this.placementItems(latest.id)
    const { levelLow, levelHigh } = await this.levelInterval(theta, se, latest.inferredLevel as JlptLevel)

    const prev = sessions[1]
    return {
      theta,
      se,
      completedAt: latest.completedAt!.toISOString(),
      level: latest.inferredLevel as JlptLevel,
      thetaLow: theta - Z_80 * se,
      thetaHigh: theta + Z_80 * se,
      levelLow,
      levelHigh,
      previous: prev && prev.abilityTheta !== null && prev.abilitySe !== null
        ? {
          theta: prev.abilityTheta,
          se: prev.abilitySe,
          completedAt: prev.completedAt!.toISOString(),
        }
        : null,
      items,
    }
  }

  private async placementItems(sessionId: string): Promise<PlacementItemOutcome[]> {
    const rows = await this.db
      .select({
        kanjiId: placementResults.kanjiId,
        character: kanji.character,
        meaningCorrect: placementResults.meaningCorrect,
        readingCorrect: placementResults.readingCorrect,
        difficultyAtAsk: placementResults.difficultyAtAsk,
        readingOffset: kanjiDifficulty.readingOffset,
      })
      .from(placementResults)
      .innerJoin(kanji, eq(kanji.id, placementResults.kanjiId))
      .leftJoin(kanjiDifficulty, eq(kanjiDifficulty.kanjiId, placementResults.kanjiId))
      .where(eq(placementResults.sessionId, sessionId))

    return rows.map((r) => ({
      kanjiId: r.kanjiId,
      character: r.character,
      meaningCorrect: r.meaningCorrect ?? false,
      // NOT coerced to false: the contract says null means the reading half
      // was never asked, and reading_lag must not count an unasked item as
      // a wrong answer.
      readingCorrect: r.readingCorrect,
      readingOffset: r.readingOffset ?? 0,
      difficultyAtAsk: r.difficultyAtAsk ?? 0,
    }))
  }

  /**
   * Level labels for the ends of the credible interval.
   *
   * Bands come from the whole difficulty CORPUS, never from the items this
   * test happened to ask -- levelBands' own header records B146, where reading
   * an index out of the full level list while the boundaries described a
   * shorter ladder told strong learners they were N4.
   */
  private async levelInterval(
    theta: number,
    se: number,
    fallback: JlptLevel,
  ): Promise<{ levelLow: JlptLevel; levelHigh: JlptLevel }> {
    const corpus = await this.db
      .select({ b: kanjiDifficulty.b, level: kanji.jlptLevel })
      .from(kanjiDifficulty)
      .innerJoin(kanji, eq(kanji.id, kanjiDifficulty.kanjiId))

    const bands = levelBands(corpus as { b: number; level: JlptLevel | null }[], JLPT_LEVELS)
    if (bands.levels.length === 0) return { levelLow: fallback, levelHigh: fallback }

    return {
      levelLow: inferredLevel(theta - Z_80 * se, bands.boundaries, bands.levels),
      levelHigh: inferredLevel(theta + Z_80 * se, bands.boundaries, bands.levels),
    }
  }
}
```

Note the unused imports `gte` and `REVIEW_WINDOW_DAYS` are consumed in Task 7 — if `pnpm typecheck` flags `gte` as unused, remove it here and re-add it in Task 7.

- [ ] **Step 4: Run tests AND typecheck**

Run: `pnpm --filter @kanji-learn/api test -- coaching-snapshot`
Expected: PASS, 6 tests.

Run: `pnpm typecheck`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/buddy/coaching.service.ts apps/api/test/integration/coaching-snapshot.test.ts
git commit -m "feat(coaching): assemble the placement half of LearnerSnapshot"
```

---

### Task 7: `assembleSnapshot` — cards and quiz

**Files:**
- Modify: `apps/api/src/services/buddy/coaching.service.ts`
- Modify: `apps/api/test/integration/coaching-snapshot.test.ts`

**Interfaces:**
- Consumes: `userKanjiProgress`, `reviewLogs`, `testResults`, `mnemonics` from `@kanji-learn/db`; `REVIEW_WINDOW_DAYS` from Task 6.
- Produces: `assembleSnapshot` now fills `reviews.cards` and `reviews.quiz`.

**Definitions this task fixes, and why:**
- **Pass quality is `>= 4`.** `hook-coverage.ts` documents `STRUGGLE_QUALITY = 3` as "Again (1) and Hard (3)", so the scale in use is Again=1, Hard=3, Good=4, Easy=5. Accuracy must therefore count `quality >= 4`, or a Hard answer would score as correct and contradict the struggle definition one file over.
- **Cards are every non-`unseen` progress row.** `leech`, `fluency_gain` and `pickHookCandidate` all iterate the list; the heaviest learner on live has ~995 such rows.
- **`recentQualities` is capped at 10, newest last** — `pickHookCandidate` only counts how many are `<= 3`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/integration/coaching-snapshot.test.ts`:

```ts
describe('CoachingService.assembleSnapshot — reviews', () => {
  const service = new CoachingService(db)
  const USER_R = '00000000-0000-0000-0000-0000000000c4'
  let sessionId: string

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER_R}, 'CoachingReviewFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })

  const wipe = async () => {
    await db.execute(sql`DELETE FROM review_logs WHERE user_id = ${USER_R}`)
    await db.execute(sql`DELETE FROM review_sessions WHERE user_id = ${USER_R}`)
    await db.execute(sql`DELETE FROM kl_test_results WHERE user_id = ${USER_R}`)
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${USER_R}`)
  }
  beforeEach(async () => {
    await wipe()
    const rows = await db.execute(sql`INSERT INTO review_sessions (user_id)
      VALUES (${USER_R}) RETURNING id`)
    sessionId = (rows[0] as any).id
  })
  afterAll(async () => {
    await wipe()
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER_R}`)
  })

  it('excludes unseen cards', async () => {
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status)
      VALUES (${USER_R}, ${k1}, 'unseen')`)
    const snap = await service.assembleSnapshot(USER_R, NOW, [])
    expect(snap.reviews.cards).toHaveLength(0)
  })

  it('carries status, lapses and reading stage', async () => {
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress
      (user_id, kanji_id, status, lapses, reading_stage)
      VALUES (${USER_R}, ${k1}, 'learning', 3, 2)`)
    const snap = await service.assembleSnapshot(USER_R, NOW, [])
    expect(snap.reviews.cards).toHaveLength(1)
    expect(snap.reviews.cards[0]).toMatchObject({
      kanjiId: k1, status: 'learning', lapses: 3, readingStage: 2,
    })
  })

  it('splits response time and accuracy into early and late halves', async () => {
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status)
      VALUES (${USER_R}, ${k1}, 'learning')`)
    // Early half: 20 days ago, slow and wrong. Late half: 2 days ago, fast and right.
    await db.execute(sql`INSERT INTO review_logs
      (session_id, user_id, kanji_id, review_type, quality, response_time_ms,
       prev_status, next_status, prev_interval, next_interval, reviewed_at)
      VALUES
       (${sessionId}, ${USER_R}, ${k1}, 'meaning', 1, 20000, 'learning', 'learning', 0, 1, now() - interval '20 days'),
       (${sessionId}, ${USER_R}, ${k1}, 'meaning', 5,  5000, 'learning', 'remembered', 1, 3, now() - interval '2 days')`)

    const card = (await service.assembleSnapshot(USER_R, NOW, [])).reviews.cards[0]
    expect(card.responseMsEarly).toBeCloseTo(20000)
    expect(card.responseMsLate).toBeCloseTo(5000)
    expect(card.accuracyEarly).toBeCloseTo(0)   // quality 1 is a fail
    expect(card.accuracyLate).toBeCloseTo(1)    // quality 5 is a pass
  })

  it('counts a Hard (3) as a FAIL, matching hook-coverage STRUGGLE_QUALITY', async () => {
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status)
      VALUES (${USER_R}, ${k1}, 'learning')`)
    await db.execute(sql`INSERT INTO review_logs
      (session_id, user_id, kanji_id, review_type, quality, response_time_ms,
       prev_status, next_status, prev_interval, next_interval, reviewed_at)
      VALUES (${sessionId}, ${USER_R}, ${k1}, 'meaning', 3, 9000, 'learning', 'learning', 0, 1, now() - interval '2 days')`)
    const card = (await service.assembleSnapshot(USER_R, NOW, [])).reviews.cards[0]
    expect(card.accuracyLate).toBeCloseTo(0)
  })

  it('leaves a half null when it holds no reviews', async () => {
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status)
      VALUES (${USER_R}, ${k1}, 'learning')`)
    await db.execute(sql`INSERT INTO review_logs
      (session_id, user_id, kanji_id, review_type, quality, response_time_ms,
       prev_status, next_status, prev_interval, next_interval, reviewed_at)
      VALUES (${sessionId}, ${USER_R}, ${k1}, 'meaning', 4, 8000, 'learning', 'learning', 0, 1, now() - interval '2 days')`)
    const card = (await service.assembleSnapshot(USER_R, NOW, [])).reviews.cards[0]
    expect(card.responseMsEarly).toBeNull()
    expect(card.responseMsLate).toBeCloseTo(8000)
  })

  it('ignores reviews older than the window', async () => {
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status)
      VALUES (${USER_R}, ${k1}, 'learning')`)
    await db.execute(sql`INSERT INTO review_logs
      (session_id, user_id, kanji_id, review_type, quality, response_time_ms,
       prev_status, next_status, prev_interval, next_interval, reviewed_at)
      VALUES (${sessionId}, ${USER_R}, ${k1}, 'meaning', 4, 8000, 'learning', 'learning', 0, 1, now() - interval '90 days')`)
    const card = (await service.assembleSnapshot(USER_R, NOW, [])).reviews.cards[0]
    expect(card.recentQualities).toEqual([])
    expect(card.responseMsEarly).toBeNull()
    expect(card.responseMsLate).toBeNull()
  })

  it('counts remembered to learning regressions inside the window', async () => {
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status)
      VALUES (${USER_R}, ${k1}, 'learning')`)
    await db.execute(sql`INSERT INTO review_logs
      (session_id, user_id, kanji_id, review_type, quality, response_time_ms,
       prev_status, next_status, prev_interval, next_interval, reviewed_at)
      VALUES (${sessionId}, ${USER_R}, ${k1}, 'meaning', 1, 8000, 'remembered', 'learning', 5, 1, now() - interval '2 days')`)
    const card = (await service.assembleSnapshot(USER_R, NOW, [])).reviews.cards[0]
    expect(card.regressions).toBe(1)
  })

  it('flags a co-created hook, and ignores a system mnemonic', async () => {
    const [k1, k2] = await kanjiIds(2)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status)
      VALUES (${USER_R}, ${k1}, 'learning'), (${USER_R}, ${k2}, 'learning')`)
    await db.execute(sql`INSERT INTO mnemonics (kanji_id, user_id, type, story_text, generation_method)
      VALUES (${k1}, ${USER_R}, 'user', 'mine', 'cocreated'),
             (${k2}, ${USER_R}, 'system', 'theirs', 'system')`)

    const cards = (await service.assembleSnapshot(USER_R, NOW, [])).reviews.cards
    expect(cards.find((c) => c.kanjiId === k1)!.hasCoCreatedHook).toBe(true)
    expect(cards.find((c) => c.kanjiId === k2)!.hasCoCreatedHook).toBe(false)
  })

  it('carries quiz outcomes inside the window', async () => {
    const [k1] = await kanjiIds(1)
    const s = await db.execute(sql`INSERT INTO kl_test_sessions (user_id, test_type)
      VALUES (${USER_R}, 'exit_quiz') RETURNING test_session_id`)
    const testSessionId = (s[0] as any).test_session_id
    await db.execute(sql`INSERT INTO kl_test_results
      (test_session_id, user_id, kanji_id, question_type, correct)
      VALUES (${testSessionId}, ${USER_R}, ${k1}, 'reading_recall', false)`)

    const snap = await service.assembleSnapshot(USER_R, NOW, [])
    expect(snap.reviews.quiz).toHaveLength(1)
    expect(snap.reviews.quiz[0]).toMatchObject({
      kanjiId: k1, questionType: 'reading_recall', correct: false,
    })
  })
})
```

The `kl_test_sessions` primary key column is `test_session_id` (a `serial`, verified against `packages/db/src/schema.ts:449`), which is why the INSERT above uses `RETURNING test_session_id` rather than `RETURNING id`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- coaching-snapshot`
Expected: FAIL — `reviews.cards` is empty; the placement tests still pass.

- [ ] **Step 3: Implement**

Add to the imports in `coaching.service.ts`:

```ts
import { userKanjiProgress, reviewLogs, testResults, mnemonics } from '@kanji-learn/db'
import type { CardSnapshot, QuizOutcome, ReviewSnapshot, SrsStatus } from '@kanji-learn/shared'
```

Replace the `reviews` line in `assembleSnapshot` with `reviews: await this.reviews(userId, now),` and add:

```ts
  /**
   * Grades at or above this are a pass.
   *
   * hook-coverage.ts documents STRUGGLE_QUALITY = 3 as "Again (1) and Hard
   * (3)", so the scale in use is Again=1, Hard=3, Good=4, Easy=5. Counting a
   * Hard as correct here would contradict the struggle definition one file
   * over, and fluency_gain's "faster AND not wronger" guard would be measuring
   * a different thing from the one hook_coverage measures.
   */
  private static readonly PASS_QUALITY = 4

  private async reviews(userId: string, now: string): Promise<ReviewSnapshot> {
    const nowMs = Date.parse(now)
    const windowStart = new Date(nowMs - REVIEW_WINDOW_DAYS * 86_400_000)
    const midpoint = nowMs - (REVIEW_WINDOW_DAYS / 2) * 86_400_000

    const [progress, logs, quiz, hooks] = await Promise.all([
      this.db.select().from(userKanjiProgress)
        .where(and(
          eq(userKanjiProgress.userId, userId),
          ne(userKanjiProgress.status, 'unseen'),
        )),
      this.db.select({
        kanjiId: reviewLogs.kanjiId,
        quality: reviewLogs.quality,
        responseTimeMs: reviewLogs.responseTimeMs,
        prevStatus: reviewLogs.prevStatus,
        nextStatus: reviewLogs.nextStatus,
        reviewedAt: reviewLogs.reviewedAt,
      }).from(reviewLogs)
        .where(and(
          eq(reviewLogs.userId, userId),
          gte(reviewLogs.reviewedAt, windowStart),
        ))
        .orderBy(reviewLogs.reviewedAt),
      this.db.select().from(testResults)
        .where(and(
          eq(testResults.userId, userId),
          gte(testResults.createdAt, windowStart),
        )),
      this.db.select({ kanjiId: mnemonics.kanjiId }).from(mnemonics)
        .where(and(
          eq(mnemonics.userId, userId),
          eq(mnemonics.generationMethod, 'cocreated'),
        )),
    ])

    const hookIds = new Set(hooks.map((h) => h.kanjiId))
    const byKanji = new Map<number, typeof logs>()
    for (const log of logs) {
      const list = byKanji.get(log.kanjiId) ?? []
      list.push(log)
      byKanji.set(log.kanjiId, list)
    }

    const mean = (xs: number[]): number | null =>
      xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length

    const cards: CardSnapshot[] = progress.map((p) => {
      const mine = byKanji.get(p.kanjiId) ?? []
      const early = mine.filter((l) => l.reviewedAt.getTime() < midpoint)
      const late = mine.filter((l) => l.reviewedAt.getTime() >= midpoint)
      const accuracy = (rows: typeof mine) =>
        mean(rows.map((l) => (l.quality >= CoachingService.PASS_QUALITY ? 1 : 0)))

      return {
        kanjiId: p.kanjiId,
        character: '',
        status: p.status as SrsStatus,
        lapses: p.lapses,
        readingStage: p.readingStage,
        regressions: mine.filter(
          (l) => l.prevStatus === 'remembered' && l.nextStatus === 'learning',
        ).length,
        responseMsEarly: mean(early.map((l) => l.responseTimeMs)),
        responseMsLate: mean(late.map((l) => l.responseTimeMs)),
        accuracyEarly: accuracy(early),
        accuracyLate: accuracy(late),
        recentQualities: mine.slice(-10).map((l) => l.quality),
        hasCoCreatedHook: hookIds.has(p.kanjiId),
      }
    })

    await this.fillCharacters(cards)

    return {
      cards,
      quiz: quiz.map((q): QuizOutcome => ({
        kanjiId: q.kanjiId,
        questionType: q.questionType,
        correct: q.correct,
        answeredAt: q.createdAt.toISOString(),
      })),
    }
  }

  /**
   * hook_coverage's evidence names the kanji, so `character` must be real --
   * an empty string would render "want to build a hook for ?" and no test of
   * the detector would notice, because it only checks the field exists.
   */
  private async fillCharacters(cards: CardSnapshot[]): Promise<void> {
    if (cards.length === 0) return
    const rows = await this.db
      .select({ id: kanji.id, character: kanji.character })
      .from(kanji)
      .where(inArray(kanji.id, cards.map((c) => c.kanjiId)))
    const chars = new Map(rows.map((r) => [r.id, r.character]))
    for (const card of cards) card.character = chars.get(card.kanjiId) ?? ''
  }
```

Add `gte`, `ne` and `inArray` to the `drizzle-orm` import.

- [ ] **Step 4: Run tests AND typecheck**

Run: `pnpm --filter @kanji-learn/api test -- coaching-snapshot`
Expected: PASS, 16 tests (6 placement + 10 reviews).

Run: `pnpm typecheck`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/buddy/coaching.service.ts apps/api/test/integration/coaching-snapshot.test.ts
git commit -m "feat(coaching): assemble cards and quiz outcomes over a 30-day window"
```

---

### Task 8: `assembleSnapshot` — commitment and hooks

**Files:**
- Modify: `apps/api/src/services/buddy/coaching.service.ts`
- Modify: `apps/api/test/integration/coaching-snapshot.test.ts`

**Interfaces:**
- Consumes: `CommitmentService.getSessionDates` and `getLastCompletedPeriod` (Task 5); `dailyStats`, `userProfiles`, `mnemonics`, `userKanjiProgress` from `@kanji-learn/db`.
- Produces: `assembleSnapshot` now fills `commitment` and `hooks`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/integration/coaching-snapshot.test.ts`:

```ts
describe('CoachingService.assembleSnapshot — commitment and hooks', () => {
  const service = new CoachingService(db)
  const USER_C = '00000000-0000-0000-0000-0000000000c5'

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone, buddy_interval_weeks)
      VALUES (${USER_C}, 'CoachingCommitSnap', 'America/Los_Angeles', 1) ON CONFLICT DO NOTHING`)
  })

  const wipe = async () => {
    await db.execute(sql`DELETE FROM buddy_commitments WHERE user_id = ${USER_C}`)
    await db.execute(sql`DELETE FROM daily_stats WHERE user_id = ${USER_C}`)
    await db.execute(sql`DELETE FROM mnemonics WHERE user_id = ${USER_C}`)
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${USER_C}`)
  }
  beforeEach(wipe)
  afterAll(async () => {
    await wipe()
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER_C}`)
  })

  it('commitment is null when the current period has not ended', async () => {
    // The defect in spec §1: at this instant commitment_gap would otherwise
    // score the maximum possible and greet a new learner with "you studied
    // less than you promised".
    await db.execute(sql`INSERT INTO buddy_commitments
      (user_id, week_start, days_committed, minutes_per_day, source)
      VALUES (${USER_C}, '2026-08-01', 4, 15, 'session')`)
    const snap = await service.assembleSnapshot(USER_C, NOW, [])
    expect(snap.commitment).toBeNull()
  })

  it('sums daily_stats study time over a completed period', async () => {
    await db.execute(sql`INSERT INTO buddy_commitments
      (user_id, week_start, days_committed, minutes_per_day, source)
      VALUES (${USER_C}, '2026-07-20', 4, 15, 'session')`)
    // 600000 ms = 10 minutes, inside the period; the third row is outside it.
    await db.execute(sql`INSERT INTO daily_stats (user_id, date, study_time_ms)
      VALUES (${USER_C}, '2026-07-21', 600000),
             (${USER_C}, '2026-07-22', 600000),
             (${USER_C}, '2026-07-28', 600000)`)

    const snap = await service.assembleSnapshot(USER_C, NOW, [])
    expect(snap.commitment).not.toBeNull()
    expect(snap.commitment!.promisedMinutes).toBe(60)
    expect(snap.commitment!.actualMinutes).toBeCloseTo(20)
    expect(snap.commitment!.periodStart).toBe('2026-07-20')
    expect(snap.commitment!.periodEnd).toBe('2026-07-27')
  })

  it('counts only co-created hooks, newest first', async () => {
    const [k1, k2] = await kanjiIds(2)
    await db.execute(sql`INSERT INTO mnemonics (kanji_id, user_id, type, story_text, generation_method, created_at)
      VALUES (${k1}, ${USER_C}, 'user', 'a', 'cocreated', '2026-07-10T00:00:00Z'),
             (${k2}, ${USER_C}, 'system', 'b', 'system', '2026-07-20T00:00:00Z')`)
    const snap = await service.assembleSnapshot(USER_C, NOW, [])
    expect(snap.hooks.count).toBe(1)
    expect(snap.hooks.latestAt).toBe('2026-07-10T00:00:00.000Z')
  })

  it('sessionDates come from session-sourced commitments, newest first', async () => {
    await db.execute(sql`INSERT INTO buddy_commitments
      (user_id, week_start, days_committed, minutes_per_day, source)
      VALUES (${USER_C}, '2026-07-06', 4, 15, 'session'),
             (${USER_C}, '2026-07-13', 4, 15, 'rolled_forward'),
             (${USER_C}, '2026-07-20', 4, 15, 'session')`)
    const snap = await service.assembleSnapshot(USER_C, NOW, [])
    expect(snap.hooks.sessionDates).toEqual(['2026-07-20', '2026-07-06'])
  })

  it('lapse means are null unless BOTH groups exist', async () => {
    const [k1] = await kanjiIds(1)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status, lapses)
      VALUES (${USER_C}, ${k1}, 'learning', 2)`)
    const snap = await service.assembleSnapshot(USER_C, NOW, [])
    expect(snap.hooks.lapsesWithHook).toBeNull()
    expect(snap.hooks.lapsesWithoutHook).toBeNull()
  })

  it('computes both lapse means when both groups exist', async () => {
    const [k1, k2] = await kanjiIds(2)
    await db.execute(sql`INSERT INTO user_kanji_progress (user_id, kanji_id, status, lapses)
      VALUES (${USER_C}, ${k1}, 'learning', 1), (${USER_C}, ${k2}, 'learning', 5)`)
    await db.execute(sql`INSERT INTO mnemonics (kanji_id, user_id, type, story_text, generation_method)
      VALUES (${k1}, ${USER_C}, 'user', 'a', 'cocreated')`)
    const snap = await service.assembleSnapshot(USER_C, NOW, [])
    expect(snap.hooks.lapsesWithHook).toBeCloseTo(1)
    expect(snap.hooks.lapsesWithoutHook).toBeCloseTo(5)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- coaching-snapshot`
Expected: FAIL — `commitment` is null in the "completed period" test and `hooks.count` is 0.

- [ ] **Step 3: Implement**

Add imports:

```ts
import { dailyStats, userProfiles, buddyCommitments } from '@kanji-learn/db'
import { CommitmentService } from './commitment.service'
import type { CommitmentSnapshot, HookSnapshot } from '@kanji-learn/shared'
import { sum } from 'drizzle-orm'
```

Add a `CommitmentService` to the constructor:

```ts
  private readonly commitments: CommitmentService

  constructor(private readonly db: Db) {
    this.commitments = new CommitmentService(db)
  }
```

Replace the `commitment` and `hooks` lines in `assembleSnapshot`:

```ts
      commitment: await this.commitment(userId, now),
      hooks: await this.hooks(userId),
```

Add:

```ts
  private async commitment(userId: string, now: string): Promise<CommitmentSnapshot | null> {
    const profile = await this.db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, userId),
    })
    const period = await this.commitments.getLastCompletedPeriod(
      userId, now, profile?.buddyIntervalWeeks ?? 1,
    )
    if (!period) return null

    // daily_stats.date is TEXT 'YYYY-MM-DD', so ISO range comparison is
    // lexical and correct. periodEnd is exclusive: a period starting on the
    // 20th covers the 20th to the 26th.
    const rows = await this.db
      .select({ total: sum(dailyStats.studyTimeMs) })
      .from(dailyStats)
      .where(and(
        eq(dailyStats.userId, userId),
        gte(dailyStats.date, period.periodStart),
        lt(dailyStats.date, period.periodEnd),
      ))

    const totalMs = Number(rows[0]?.total ?? 0)
    return {
      promisedMinutes: period.promisedMinutes,
      actualMinutes: totalMs / 60_000,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
    }
  }

  private async hooks(userId: string): Promise<HookSnapshot> {
    const [cocreated, sessionDates, progress] = await Promise.all([
      this.db.select({ kanjiId: mnemonics.kanjiId, createdAt: mnemonics.createdAt })
        .from(mnemonics)
        .where(and(
          eq(mnemonics.userId, userId),
          eq(mnemonics.generationMethod, 'cocreated'),
        ))
        .orderBy(desc(mnemonics.createdAt)),
      this.commitments.getSessionDates(userId),
      this.db.select({ kanjiId: userKanjiProgress.kanjiId, lapses: userKanjiProgress.lapses })
        .from(userKanjiProgress)
        .where(and(
          eq(userKanjiProgress.userId, userId),
          ne(userKanjiProgress.status, 'unseen'),
        )),
    ])

    const hookIds = new Set(cocreated.map((m) => m.kanjiId))
    const withHook = progress.filter((p) => hookIds.has(p.kanjiId)).map((p) => p.lapses)
    const without = progress.filter((p) => !hookIds.has(p.kanjiId)).map((p) => p.lapses)
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

    // Only claim hooks help when BOTH sides of the comparison exist -- a mean
    // over an empty group is NaN, and detectHookCoverage would push it into
    // evidence the learner sees.
    const bothExist = withHook.length > 0 && without.length > 0

    return {
      count: cocreated.length,
      latestAt: cocreated[0]?.createdAt.toISOString() ?? null,
      sessionDates,
      lapsesWithHook: bothExist ? mean(withHook) : null,
      lapsesWithoutHook: bothExist ? mean(without) : null,
    }
  }
```

Add `lt` to the `drizzle-orm` import.

- [ ] **Step 4: Run tests AND typecheck**

Run: `pnpm --filter @kanji-learn/api test -- coaching-snapshot`
Expected: PASS, 22 tests.

Run: `pnpm typecheck`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/buddy/coaching.service.ts apps/api/test/integration/coaching-snapshot.test.ts
git commit -m "feat(coaching): assemble commitment and hook snapshots"
```

---

### Task 9: `CoachingService.refresh` — the write rules

**Files:**
- Modify: `apps/api/src/services/buddy/coaching.service.ts`
- Test: `apps/api/test/integration/coaching-refresh.test.ts` (create)

**Interfaces:**
- Consumes: `analyze`, `carryForward`, `selectionsMatch`, `analysisBody` from `@kanji-learn/shared`; `NotebookService` methods from Task 4.
- Produces:
  - `refresh(userId: string, opts?: { force?: boolean; now?: string }): Promise<RefreshResult>`
  - `interface RefreshResult { written: 'inserted' | 'updated' | 'skipped'; findings: Finding[] }`
  - `interface CoachingAnalysisSource { kind: string; analyzedAt: string; findings: PriorFinding[]; correction?: { at: string; kinds: FindingKind[] } }`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/integration/coaching-refresh.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { CoachingService } from '../../src/services/buddy/coaching.service'
import { NotebookService } from '../../src/services/notebook.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const USER = '00000000-0000-0000-0000-0000000000c6'

/** A commitment period that ended, with zero study time -> commitment_gap fires. */
async function missedPeriod() {
  await db.execute(sql`INSERT INTO buddy_commitments
    (user_id, week_start, days_committed, minutes_per_day, source)
    VALUES (${USER}, '2026-07-20', 4, 15, 'session')`)
}

describe('CoachingService.refresh', () => {
  const service = new CoachingService(db)
  const notebook = new NotebookService(db)
  const NOW = '2026-08-02T12:00:00.000Z'

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'CoachingRefreshFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })

  const wipe = async () => {
    await db.execute(sql`DELETE FROM notebook_entries WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM buddy_commitments WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM daily_stats WHERE user_id = ${USER}`)
  }
  beforeEach(wipe)
  afterAll(async () => {
    await wipe()
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
  })

  const liveEntries = async () =>
    db.execute(sql`SELECT body, source FROM notebook_entries
      WHERE user_id = ${USER} AND source->>'kind' = 'coaching_analysis'
        AND superseded_at IS NULL`)

  const allEntries = async () =>
    db.execute(sql`SELECT id FROM notebook_entries
      WHERE user_id = ${USER} AND source->>'kind' = 'coaching_analysis'`)

  it('writes NOTHING for a learner with no findings', async () => {
    const result = await service.refresh(USER, { force: true, now: NOW })
    expect(result.written).toBe('skipped')
    expect(result.findings).toEqual([])
    expect((await allEntries()).length).toBe(0)
  })

  it('inserts an entry when a finding exists, and stamps the payload', async () => {
    await missedPeriod()
    const result = await service.refresh(USER, { force: true, now: NOW })
    expect(result.written).toBe('inserted')
    expect(result.findings.map((f) => f.kind)).toContain('commitment_gap')

    const rows = await liveEntries()
    expect(rows.length).toBe(1)
    expect((rows[0] as any).body).toContain('promised')
    const source = (rows[0] as any).source
    expect(source.analyzedAt).toBe(NOW)
    expect(source.findings.find((f: any) => f.kind === 'commitment_gap')).toMatchObject({
      since: NOW, lastRaisedAt: NOW,
    })
  })

  it('an UNCHANGED selection updates in place — no second row', async () => {
    await missedPeriod()
    await service.refresh(USER, { force: true, now: NOW })
    const later = '2026-08-03T12:00:00.000Z'
    const result = await service.refresh(USER, { force: true, now: later })

    expect(result.written).toBe('updated')
    expect((await allEntries()).length).toBe(1)

    const source = ((await liveEntries())[0] as any).source
    expect(source.analyzedAt).toBe(later)
    // The stamp must NOT move: the finding stayed selected, so its novelty
    // recovers on display rather than being re-floored.
    expect(source.findings[0].lastRaisedAt).toBe(NOW)
  })

  it('the staleness gate skips a non-forced refresh inside the window', async () => {
    await missedPeriod()
    await service.refresh(USER, { force: true, now: NOW })
    const soon = '2026-08-02T13:00:00.000Z'   // 1 hour later, inside 6h
    const result = await service.refresh(USER, { now: soon })
    expect(result.written).toBe('skipped')
    expect(((await liveEntries())[0] as any).source.analyzedAt).toBe(NOW)
  })

  it('a non-forced refresh past the staleness window does run', async () => {
    await missedPeriod()
    await service.refresh(USER, { force: true, now: NOW })
    const later = '2026-08-02T20:00:00.000Z'  // 8 hours later
    const result = await service.refresh(USER, { now: later })
    expect(result.written).toBe('updated')
  })

  it('reads priors back across a DELETED entry — memory survives', async () => {
    await missedPeriod()
    await service.refresh(USER, { force: true, now: NOW })
    const row = await notebook.readLatestKeyed(USER, 'coaching_analysis')
    await notebook.supersedeEntry(USER, row!.id, null)   // the delete path

    const later = '2026-08-10T12:00:00.000Z'
    await service.refresh(USER, { force: true, now: later })

    const source = ((await liveEntries())[0] as any).source
    // `since` is carried from the superseded row, NOT reset to `later`.
    expect(source.findings[0].since).toBe(NOW)
  })

  it('records a correction when the learner edited the entry', async () => {
    await missedPeriod()
    await service.refresh(USER, { force: true, now: NOW })
    const row = await notebook.readLatestKeyed(USER, 'coaching_analysis')
    await notebook.supersedeEntry(USER, row!.id, 'I was travelling that week.')

    const later = '2026-08-10T12:00:00.000Z'
    await service.refresh(USER, { force: true, now: later })

    const source = ((await liveEntries())[0] as any).source
    expect(source.correction).toBeDefined()
    expect(source.correction.kinds).toContain('commitment_gap')
  })

  it('coalesces two runs inside the window into ONE chain entry', async () => {
    await missedPeriod()
    await service.refresh(USER, { force: true, now: NOW })
    const tenMinutesLater = '2026-08-02T12:10:00.000Z'
    const result = await service.refresh(USER, { force: true, now: tenMinutesLater })

    expect(result.written).toBe('updated')
    expect((await allEntries()).length).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- coaching-refresh`
Expected: FAIL — `service.refresh is not a function`.

- [ ] **Step 3: Implement**

Add imports to `coaching.service.ts`:

```ts
import {
  analyze, carryForward, selectionsMatch, analysisBody,
  type Finding, type FindingKind,
} from '@kanji-learn/shared'
import { NotebookService } from '../notebook.service'
```

Add to the constructor:

```ts
  private readonly notebook: NotebookService
```
and in the body: `this.notebook = new NotebookService(db)`.

Add the types and method:

```ts
export interface CoachingAnalysisSource {
  kind: string
  analyzedAt: string
  findings: PriorFinding[]
  correction?: { at: string; kinds: FindingKind[] }
}

export interface RefreshResult {
  written: 'inserted' | 'updated' | 'skipped'
  findings: Finding[]
}
```

```ts
  /**
   * Analyse and write the notebook entry.
   *
   * `force` is for real events (placement completion, session completion).
   * The notebook GET passes no force and is gated on staleness, so assembling
   * seven tables does not ride on every read.
   */
  async refresh(
    userId: string,
    opts: { force?: boolean; now?: string } = {},
  ): Promise<RefreshResult> {
    const now = opts.now ?? new Date().toISOString()
    const latest = await this.notebook.readLatestKeyed(userId, COACHING_SOURCE_KIND)
    const latestSource = latest?.source as CoachingAnalysisSource | undefined
    const analyzedAt = latestSource?.analyzedAt ?? null
    const sinceLastMs = analyzedAt === null ? Infinity : Date.parse(now) - Date.parse(analyzedAt)

    if (!opts.force && sinceLastMs < ANALYSIS_STALE_HOURS * 3_600_000) {
      return { written: 'skipped', findings: [] }
    }

    // COALESCING. Two triggers can fire minutes apart -- the first Buddy
    // session suggests taking the placement test, so session-completion and
    // placement-completion are adjacent by design. Treat the previous entry as
    // part of THIS episode: read priors from the row before it, and update it
    // in place rather than superseding, so the chain gains no spurious link
    // for an entry nobody had time to read.
    const coalescing = sinceLastMs < COALESCE_WINDOW_MINUTES * 60_000
    const priorRow = coalescing
      ? await this.notebook.readLatestKeyed(userId, COACHING_SOURCE_KIND, 1)
      : latest
    const priors = (priorRow?.source as CoachingAnalysisSource | undefined)?.findings ?? []

    const snapshot = await this.assembleSnapshot(userId, now, priors)
    const findings = analyze(snapshot)

    // Nothing worth reporting: write nothing and supersede nothing. Any
    // existing entry stands until there is something better to say. (§5's
    // companion mode is slices 3-4's answer; slice 2's answer is silence.)
    if (findings.length === 0) return { written: 'skipped', findings }

    const correction = latest?.author === 'learner'
      ? { at: latest.createdAt, kinds: (latestSource?.findings ?? []).map((f) => f.kind) }
      : latestSource?.correction

    const source: CoachingAnalysisSource = {
      kind: COACHING_SOURCE_KIND,
      analyzedAt: now,
      findings: carryForward(priors, findings, now),
      ...(correction ? { correction } : {}),
    }
    const body = analysisBody(findings, now)

    // Update in place when this says the same thing, or when it coalesces with
    // a run moments earlier. Both require the row to still be LIVE -- a
    // superseded row must never be resurrected by an UPDATE.
    const canUpdate = latest !== null && latest.supersededAt === null
    const unchanged = selectionsMatch(priors, findings)
    if (canUpdate && (coalescing || unchanged)) {
      await this.notebook.updateEntryInPlace(userId, latest!.id, body, source)
      return { written: 'updated', findings }
    }

    const { kind: _kind, ...payload } = source
    await this.notebook.writeKeyedEntry(userId, {
      sourceKind: COACHING_SOURCE_KIND,
      kind: 'observation',
      body,
      sourcePayload: payload,
    })
    return { written: 'inserted', findings }
  }
```

- [ ] **Step 4: Run tests AND typecheck**

Run: `pnpm --filter @kanji-learn/api test -- coaching-refresh`
Expected: PASS, 8 tests.

Run: `pnpm typecheck`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/buddy/coaching.service.ts apps/api/test/integration/coaching-refresh.test.ts
git commit -m "feat(coaching): refresh with staleness gating, coalescing and correction capture"
```

---

### Task 10: Wire the three triggers

**Files:**
- Modify: `apps/api/src/routes/notebook.ts`
- Modify: `apps/api/src/routes/placement.ts`
- Modify: `apps/api/src/routes/buddy-session.ts`
- Test: `apps/api/test/integration/coaching-triggers.test.ts` (create)

**Interfaces:**
- Consumes: `CoachingService.refresh` from Task 9.
- Produces: no new exports. Behaviour only.

**Every call site is wrapped in try/catch**, matching `buddy-session.ts`'s existing notebook write: the route's primary outcome (a saved commitment, a completed placement, a rendered notebook) must never become a 500 because coaching failed.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/integration/coaching-triggers.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { buildTestApp } from '../helpers/test-app'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const USER = '00000000-0000-0000-0000-0000000000c7'

describe('coaching triggers', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>

  beforeAll(async () => {
    app = await buildTestApp()
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'CoachingTriggerFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })

  const wipe = async () => {
    await db.execute(sql`DELETE FROM notebook_entries WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM buddy_commitments WHERE user_id = ${USER}`)
  }
  beforeEach(wipe)
  afterAll(async () => {
    await wipe()
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
    await app.close()
  })

  const coachingRows = async () =>
    db.execute(sql`SELECT body FROM notebook_entries
      WHERE user_id = ${USER} AND source->>'kind' = 'coaching_analysis'
        AND superseded_at IS NULL`)

  it('GET /v1/buddy/notebook still returns 200 and does not write for a learner with no findings', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/buddy/notebook', headers: { 'x-test-user-id': USER },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
    expect((await coachingRows()).length).toBe(0)
  })

  it('GET /v1/buddy/notebook writes the coaching entry when a finding exists', async () => {
    await db.execute(sql`INSERT INTO buddy_commitments
      (user_id, week_start, days_committed, minutes_per_day, source)
      VALUES (${USER}, '2026-07-20', 4, 15, 'session')`)

    const res = await app.inject({
      method: 'GET', url: '/v1/buddy/notebook', headers: { 'x-test-user-id': USER },
    })
    expect(res.statusCode).toBe(200)

    const rows = await coachingRows()
    expect(rows.length).toBe(1)
    expect((rows[0] as any).body).toContain('promised')

    // And it renders through the generic section, with no mobile change.
    const observations = res.json().data.sections.find((s: any) => s.key === 'observations')
    const refetched = await app.inject({
      method: 'GET', url: '/v1/buddy/notebook', headers: { 'x-test-user-id': USER },
    })
    const after = refetched.json().data.sections.find((s: any) => s.key === 'observations')
    expect(after.live.some((e: any) => e.body.includes('promised'))).toBe(true)
    expect(observations).toBeDefined()
  })

  it('POST /v1/buddy/session/commitment refreshes coaching', async () => {
    await db.execute(sql`INSERT INTO buddy_commitments
      (user_id, week_start, days_committed, minutes_per_day, source)
      VALUES (${USER}, '2026-07-20', 4, 15, 'session')`)

    const res = await app.inject({
      method: 'POST',
      url: '/v1/buddy/session/commitment',
      headers: { 'x-test-user-id': USER },
      payload: { weekStart: '2026-08-01', daysCommitted: 4, minutesPerDay: 15 },
    })
    expect(res.statusCode).toBe(200)
    expect((await coachingRows()).length).toBe(1)
  })
})
```

`buildTestApp` lives at `apps/api/test/helpers/test-app.ts` (it also exports `buildTestAppWith` for dependency overrides, which this test does not need).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- coaching-triggers`
Expected: FAIL — no coaching row is written.

- [ ] **Step 3: Wire the notebook GET**

In `apps/api/src/routes/notebook.ts`, add the import:

```ts
import { CoachingService } from '../services/buddy/coaching.service.js'
```

and inside `notebookRoutes`, after `const service = new NotebookService(server.db)`:

```ts
  const coaching = new CoachingService(server.db)
```

Replace the GET handler:

```ts
  server.get('/', { preHandler: [server.authenticate] }, async (req, reply) => {
    await service.ensureFirstOpen(req.userId!)
    // Stale-gated: refresh() returns immediately unless the stored analysis is
    // older than ANALYSIS_STALE_HOURS, so assembling seven tables does not ride
    // on every notebook read. Guarded because a coaching failure must never
    // turn a notebook read into a 500 — the same reasoning as the commitment
    // write-back in buddy-session.ts.
    try {
      await coaching.refresh(req.userId!)
    } catch (err) {
      req.log.error({ err, userId: req.userId }, '[Notebook] coaching refresh failed')
    }
    return reply.send({ ok: true, data: await service.getNotebook(req.userId!) })
  })
```

- [ ] **Step 4: Wire placement completion**

In `apps/api/src/routes/placement.ts`, add the import:

```ts
import { CoachingService } from '../services/buddy/coaching.service.js'
```

Immediately after `const result = await completePlacement(server.db, req.userId!, parsed.data.responses)`:

```ts
      // §6: immediate, because this is the moment the learner is asking "what
      // does that mean?". Forced — this is a real event, not a read.
      try {
        await new CoachingService(server.db).refresh(req.userId!, { force: true })
      } catch (err) {
        req.log.error({ err, userId: req.userId }, '[Placement] coaching refresh failed')
      }
```

- [ ] **Step 5: Wire session completion**

In `apps/api/src/routes/buddy-session.ts`, add the import:

```ts
import { CoachingService } from '../services/buddy/coaching.service.js'
```

Immediately after the existing `writeCommitmentObservation` try/catch block in the `/commitment` handler:

```ts
    try {
      await new CoachingService(server.db).refresh(req.userId!, { force: true })
    } catch (err) {
      req.log.error({ err, userId: req.userId }, '[BuddySession] coaching refresh failed')
    }
```

- [ ] **Step 6: Run the full API suite AND typecheck**

Run: `pnpm --filter @kanji-learn/api test -- coaching-triggers`
Expected: PASS, 3 tests.

Run: `pnpm --filter @kanji-learn/api test`
Expected: **448 passed + the new coaching tests, 0 failed.** 448 was the count before this slice. Any pre-existing failure means a stale local test DB — rebuild per `docs/local-test-db.md` before blaming this work.

Run: `pnpm --filter @kanji-learn/shared test`
Expected: PASS — 453 before this slice, plus Task 1's and Task 2's.

Run: `pnpm typecheck`
Expected: PASS, 4/4.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/notebook.ts apps/api/src/routes/placement.ts apps/api/src/routes/buddy-session.ts apps/api/test/integration/coaching-triggers.test.ts
git commit -m "feat(coaching): refresh on notebook open, placement completion and session completion"
```

---

## Verifying the deploy

Per https://github.com/radmelon/kanji-learn/blob/main/docs/SOP.md, **status codes prove nothing here.** Confirm both:

1. **An App Runner operation dated today** — `aws apprunner list-operations …`
2. **Response content** — for slice 2 the canary is a `coaching_analysis` entry appearing in `GET /v1/buddy/notebook` for a learner with a completed, missed commitment period. A 200 from that route is served by every build ever deployed.

**The migration is a separate, owner-authorised step.** `0034` must be applied to live before the code that depends on it can run there. Do not apply it as part of executing this plan.

---

## Self-review notes

**Spec coverage.** Every section of the slice 2 spec maps to a task: §0's §13 correction is documented rather than coded; §1's `commitment_gap` defect → Task 5; §2's coalescing → Task 9; §3's assembly table → Tasks 5–8; §4's stamps → Tasks 1 and 9; §5's write rules and copy → Tasks 2, 4, 9; §6's triggers and index → Tasks 3 and 10; §8's testing → every task's verification step. §9 and §10 are deliberately unimplemented.

**Verified while writing, so no task has to guess:** `kl_test_sessions.test_session_id` is the primary key (`schema.ts:449`), and `buildTestApp` is exported from `apps/api/test/helpers/test-app.ts` — not `apps/api/test/test-app.ts`, which does not exist.

**Known gaps a reviewer should check rather than assume.**

- Every test resolves kanji ids by query rather than hardcoding, so the corpus size does not matter.
- `CardSnapshot.character` is filled by a second query (`fillCharacters`) rather than a join, because the progress query has no reason to join `kanji` otherwise. If a reviewer prefers the join, it is a safe refactor — the test asserting `typeof character === 'string'` in Task 6 and the hook-candidate evidence in slice 1 are what protect it.
