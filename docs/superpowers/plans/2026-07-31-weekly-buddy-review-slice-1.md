# Weekly Buddy Review — Slice 1 (The Ritual) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the weekly appointment with Buddy — the learner agrees a week's
commitment, the next session reviews it — using template copy only, no LLM.

**Architecture:** Four pure decision functions in `packages/shared/src/buddy/`
(appointment, commitment, reckoning, copy) with all I/O in `apps/api`. The
commitment is **carried forward and confirmed, never constructed**: a
server-side roll-forward guarantees every week has a commitment whether or not
the learner ever opens the app. The `buddy_day` push and the roll-forward both
ride the existing hourly `POST /internal/daily-reminders` invocation.

**Tech Stack:** TypeScript · Drizzle ORM · Postgres (Supabase) · Fastify ·
vitest (shared + api) · Expo / React Native · Zustand · jest-expo + RTL
(component lane)

**Spec:** [`2026-07-30-weekly-buddy-review-design.md`](../specs/2026-07-30-weekly-buddy-review-design.md)
— this plan implements **Slice 1** from §10 only.

## Global Constraints

- **No LLM in this slice.** No calls to any provider, no `buddy_llm_*` writes.
  The template tier is the only generation tier here (spec §3).
- **The commitment period is always 7 days.** `buddy_interval_weeks = 2`
  (fortnightly) means Buddy *meets* every other week; commitments still roll
  weekly, and the unattended week's row is written with
  `source = 'rolled_forward'`.
- **Roll-forward is server-side and must not depend on the device being
  reachable** (spec §8.3).
- **`buddy_day` is a day in the learner's timezone.** A learner whose
  `user_profiles.timezone` is still the `'UTC'` default has no reliable
  `buddy_day` and must be skipped by the hourly pass, not guessed at
  (spec §8.5, and `packages/db/src/schema.ts:171`).
- **`buddy_day` is independent of `rest_day`.** Never read one for the other.
- **Every guard test carries a control assertion** proving the guarded path
  actually executed (spec §9). A test that cannot fail is worse than no test.
- **Rebuild the local test DB before judging API test results** — see
  [`docs/local-test-db.md`](../../local-test-db.md). A stale one reads ~5 extra
  failures.
- **No `completed_count` / `skipped_count` columns, ever** (spec §5.4). Those
  measure compliance; this measures result.
- **Pure functions take an injected `now`/`localDate`.** No `new Date()` inside
  `packages/shared`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/supabase/migrations/0030_weekly_buddy_review.sql` | schema + RLS |
| `packages/db/src/schema.ts` | Drizzle mirror of 0030 |
| `packages/shared/src/buddy/commitment.ts` | commitment types, validation, roll-forward derivation |
| `packages/shared/src/buddy/appointment.ts` | is a session due; week windows; miss counting; step-down |
| `packages/shared/src/buddy/reckoning.ts` | promise check + opener selection |
| `packages/shared/src/buddy/copy.ts` | template-tier copy catalogue |
| `apps/api/src/services/buddy/commitment.service.ts` | ensure/read/write commitments |
| `apps/api/src/routes/buddy-session.ts` | `GET /v1/buddy/session`, `POST /v1/buddy/session/commitment` |
| `apps/api/src/services/notification.service.ts` | `runBuddyDayPass()` — push + roll-forward + step-down |
| `apps/mobile/src/lib/buddy-session-state.ts` | pure card-sequence state |
| `apps/mobile/src/stores/buddy.store.ts` | session fetch + commit |
| `apps/mobile/app/buddy-session.tsx` | the template-tier card screen |

---

### Task 1: Migration 0030 and the Drizzle mirror

**Files:**
- Create: `packages/db/supabase/migrations/0030_weekly_buddy_review.sql`
- Modify: `packages/db/src/schema.ts` (add columns to `userProfiles` ~line 175; add `buddyCommitments` after `studyPlanEvents` ~line 717)
- Test: `apps/api/test/integration/buddy-commitments-schema.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `buddyCommitments` Drizzle table with columns `id, userId, weekStart, daysCommitted, dayTargets, minutesPerDay, method, experimentUntil, focus, source, agreedAt, supersededAt`; `userProfiles.buddyDay`, `userProfiles.buddyIntervalWeeks`

- [ ] **Step 1: Write the migration**

Create `packages/db/supabase/migrations/0030_weekly_buddy_review.sql`:

```sql
-- Migration 0030: Weekly Buddy Review — the appointment and the commitment
-- Run order: 30
--
-- Part of docs/superpowers/plans/2026-07-31-weekly-buddy-review-slice-1.md,
-- implementing docs/superpowers/specs/2026-07-30-weekly-buddy-review-design.md
-- §5 (Slice 1 only).
--
-- buddy_day is deliberately SEPARATE from rest_day (spec decision #8):
-- conflating them means the one day the learner protects is the day Buddy
-- shows up. NULL means "no appointment" — which is both a real cadence
-- ("when I ask") and the correct state for every pre-existing row.

BEGIN;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS buddy_day smallint,
  ADD COLUMN IF NOT EXISTS buddy_interval_weeks smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN user_profiles.buddy_day IS
  '0=Sun..6=Sat, in the user''s timezone. NULL = no appointment scheduled. Independent of rest_day by design.';
COMMENT ON COLUMN user_profiles.buddy_interval_weeks IS
  '1 = weekly, 2 = fortnightly. Commitment periods are ALWAYS 7 days; this only controls how often Buddy meets. Unattended weeks roll forward.';

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_buddy_day_range
    CHECK (buddy_day IS NULL OR (buddy_day >= 0 AND buddy_day <= 6)),
  ADD CONSTRAINT user_profiles_buddy_interval_range
    CHECK (buddy_interval_weeks >= 1 AND buddy_interval_weeks <= 2);

CREATE TABLE IF NOT EXISTS buddy_commitments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  week_start       date NOT NULL,
  days_committed   smallint NOT NULL,
  day_targets      jsonb,
  minutes_per_day  smallint NOT NULL,
  method           jsonb,
  experiment_until date,
  focus            text,
  source           text NOT NULL,
  agreed_at        timestamptz NOT NULL DEFAULT now(),
  superseded_at    timestamptz,
  CONSTRAINT buddy_commitments_user_week_unique UNIQUE (user_id, week_start),
  CONSTRAINT buddy_commitments_source_check
    CHECK (source IN ('session', 'rolled_forward', 'default')),
  CONSTRAINT buddy_commitments_days_range
    CHECK (days_committed >= 1 AND days_committed <= 7)
);

COMMENT ON TABLE buddy_commitments IS
  'One row per learner per 7-day period. Deliberately has NO completed_count/skipped_count: those measure compliance with a prescription, and this measures the result of an agreement (spec §5.4).';
COMMENT ON COLUMN buddy_commitments.source IS
  'session = the learner agreed it. rolled_forward = carried over because they did not attend. default = seeded with no prior. The reckoning changes register on this: a missed rolled_forward commitment is NOT a broken promise.';

CREATE INDEX IF NOT EXISTS buddy_commitments_user_week_idx
  ON buddy_commitments (user_id, week_start DESC);

-- RLS, mirroring migrations 0009 and 0018.
ALTER TABLE public.buddy_commitments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own buddy_commitments"
  ON public.buddy_commitments
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage buddy_commitments"
  ON public.buddy_commitments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
```

- [ ] **Step 2: Mirror it in the Drizzle schema**

In `packages/db/src/schema.ts`, add to `userProfiles` immediately after the
`restDay` line:

```ts
  // Deliberately separate from restDay (spec decision #8) — conflating them
  // means the one day the learner protects is the day Buddy shows up.
  buddyDay: smallint('buddy_day'),                                  // 0=Sun…6=Sat, null=no appointment
  buddyIntervalWeeks: smallint('buddy_interval_weeks').notNull().default(1), // 1=weekly, 2=fortnightly
```

Then add this table after `studyPlanEvents`:

```ts
// ─── buddy_commitments ────────────────────────────────────────────────────────
// One row per learner per 7-day period. NO completed_count/skipped_count by
// design: those measure compliance with a prescription; this measures the
// result of an agreement (spec §5.4).

export const buddyCommitments = pgTable(
  'buddy_commitments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    weekStart: date('week_start').notNull(),
    daysCommitted: smallint('days_committed').notNull(),
    dayTargets: jsonb('day_targets').$type<number[] | null>(),
    minutesPerDay: smallint('minutes_per_day').notNull(),
    method: jsonb('method').$type<Record<string, unknown> | null>(),
    experimentUntil: date('experiment_until'),
    focus: text('focus'),
    // 'session' | 'rolled_forward' | 'default' — the reckoning changes register
    // on this. A missed rolled_forward commitment is NOT a broken promise.
    source: text('source').notNull(),
    agreedAt: timestamp('agreed_at', { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (t) => ({
    userWeekUnique: uniqueIndex('buddy_commitments_user_week_unique').on(t.userId, t.weekStart),
    userWeekIdx: index('buddy_commitments_user_week_idx').on(t.userId, t.weekStart),
  })
)
```

If `date` is not already imported at the top of `schema.ts`, add it to the
`drizzle-orm/pg-core` import list.

- [ ] **Step 3: Write the failing schema test**

Create `apps/api/test/integration/buddy-commitments-schema.test.ts`:

```ts
// Confirms migration 0030's table and constraints exist and behave.
// Fixture pattern mirrors learner-state-refresh.test.ts.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER_ID = '00000000-0000-0000-0000-0000000000b1'

beforeAll(async () => {
  await db.insert(schema.userProfiles)
    .values({ id: TEST_USER_ID, displayName: 'Commitment Fixture' })
    .onConflictDoNothing()
})

beforeEach(async () => {
  await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
})

afterAll(async () => {
  await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
  await db.delete(schema.userProfiles).where(eq(schema.userProfiles.id, TEST_USER_ID))
  await client.end()
})

describe('buddy_commitments schema', () => {
  it('stores a commitment and defaults buddy_interval_weeks to 1', async () => {
    await db.insert(schema.buddyCommitments).values({
      userId: TEST_USER_ID,
      weekStart: '2026-08-03',
      daysCommitted: 4,
      minutesPerDay: 15,
      source: 'session',
    })

    const rows = await db.select().from(schema.buddyCommitments)
      .where(eq(schema.buddyCommitments.userId, TEST_USER_ID))

    expect(rows).toHaveLength(1)
    expect(rows[0].daysCommitted).toBe(4)
    expect(rows[0].source).toBe('session')

    const profile = await db.select().from(schema.userProfiles)
      .where(eq(schema.userProfiles.id, TEST_USER_ID))
    expect(profile[0].buddyIntervalWeeks).toBe(1)
    expect(profile[0].buddyDay).toBeNull()
  })

  it('rejects a second commitment for the same week', async () => {
    await db.insert(schema.buddyCommitments).values({
      userId: TEST_USER_ID, weekStart: '2026-08-03',
      daysCommitted: 4, minutesPerDay: 15, source: 'session',
    })

    await expect(
      db.insert(schema.buddyCommitments).values({
        userId: TEST_USER_ID, weekStart: '2026-08-03',
        daysCommitted: 2, minutesPerDay: 10, source: 'rolled_forward',
      })
    ).rejects.toThrow()
  })

  it('rejects an out-of-range source', async () => {
    await expect(
      db.insert(schema.buddyCommitments).values({
        userId: TEST_USER_ID, weekStart: '2026-08-10',
        daysCommitted: 4, minutesPerDay: 15, source: 'invented',
      })
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
pnpm --filter @kanji-learn/api test -- buddy-commitments-schema
```

Expected: FAIL — `relation "buddy_commitments" does not exist`.

- [ ] **Step 5: Apply the migration to the local test database**

Follow [`docs/local-test-db.md`](../../local-test-db.md) to apply `0030` to the
local Docker Postgres. Remember `?sslmode=disable` on `TEST_DATABASE_URL`.

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm --filter @kanji-learn/api test -- buddy-commitments-schema
```

Expected: PASS, 3 tests.

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @kanji-learn/db typecheck && pnpm --filter @kanji-learn/api typecheck
```

Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add packages/db/supabase/migrations/0030_weekly_buddy_review.sql packages/db/src/schema.ts apps/api/test/integration/buddy-commitments-schema.test.ts
git commit -m "feat(db): migration 0030 — buddy_day and buddy_commitments"
```

---

### Task 2: `commitment.ts` — types, validation, roll-forward

**Files:**
- Create: `packages/shared/src/buddy/commitment.ts`
- Test: `packages/shared/src/buddy/commitment.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Commitment`, `CommitmentSource`, `DEFAULT_COMMITMENT`, `validateCommitment(input): ValidationResult`, `rollForward(previous, weekStart): Commitment`, `countConsecutiveRolledForward(rows): number`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/buddy/commitment.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  validateCommitment,
  rollForward,
  countConsecutiveRolledForward,
  DEFAULT_COMMITMENT,
  type Commitment,
} from './commitment'

const agreed: Commitment = {
  weekStart: '2026-08-03',
  daysCommitted: 4,
  dayTargets: null,
  minutesPerDay: 15,
  focus: null,
  source: 'session',
}

describe('validateCommitment', () => {
  it('accepts a normal commitment', () => {
    expect(validateCommitment({ daysCommitted: 4, minutesPerDay: 15 })).toEqual({ ok: true })
  })

  it('rejects zero days — a commitment to nothing is not a commitment', () => {
    const r = validateCommitment({ daysCommitted: 0, minutesPerDay: 15 })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('days_out_of_range')
  })

  it('rejects more than 7 days', () => {
    expect(validateCommitment({ daysCommitted: 8, minutesPerDay: 15 }).ok).toBe(false)
  })

  it('rejects non-positive minutes', () => {
    const r = validateCommitment({ daysCommitted: 4, minutesPerDay: 0 })
    expect(r.ok === false && r.reason).toBe('minutes_out_of_range')
  })

  it('rejects dayTargets that disagree with daysCommitted', () => {
    const r = validateCommitment({ daysCommitted: 4, minutesPerDay: 15, dayTargets: [1, 3] })
    expect(r.ok === false && r.reason).toBe('day_targets_mismatch')
  })

  it('accepts dayTargets that agree', () => {
    expect(validateCommitment({ daysCommitted: 2, minutesPerDay: 15, dayTargets: [1, 3] }).ok).toBe(true)
  })
})

describe('rollForward', () => {
  it('carries the numbers and re-labels the source', () => {
    const next = rollForward(agreed, '2026-08-10')
    expect(next.weekStart).toBe('2026-08-10')
    expect(next.daysCommitted).toBe(4)
    expect(next.minutesPerDay).toBe(15)
    expect(next.source).toBe('rolled_forward')
  })

  it('rolling forward a rolled-forward commitment stays rolled_forward', () => {
    const once = rollForward(agreed, '2026-08-10')
    const twice = rollForward(once, '2026-08-17')
    expect(twice.source).toBe('rolled_forward')
  })

  it('drops focus — a theme the learner never re-agreed should not persist', () => {
    const next = rollForward({ ...agreed, focus: 'backlog' }, '2026-08-10')
    expect(next.focus).toBeNull()
  })

  it('seeds from DEFAULT_COMMITMENT when there is no previous', () => {
    const next = rollForward(null, '2026-08-03')
    expect(next.source).toBe('default')
    expect(next.daysCommitted).toBe(DEFAULT_COMMITMENT.daysCommitted)
  })
})

describe('countConsecutiveRolledForward', () => {
  it('counts an unbroken run from the most recent backwards', () => {
    expect(countConsecutiveRolledForward([
      { weekStart: '2026-08-17', source: 'rolled_forward' },
      { weekStart: '2026-08-10', source: 'rolled_forward' },
      { weekStart: '2026-08-03', source: 'session' },
    ])).toBe(2)
  })

  it('is zero when the most recent was actually agreed', () => {
    expect(countConsecutiveRolledForward([
      { weekStart: '2026-08-17', source: 'session' },
      { weekStart: '2026-08-10', source: 'rolled_forward' },
    ])).toBe(0)
  })

  it('sorts by weekStart rather than trusting input order', () => {
    expect(countConsecutiveRolledForward([
      { weekStart: '2026-08-03', source: 'session' },
      { weekStart: '2026-08-17', source: 'rolled_forward' },
      { weekStart: '2026-08-10', source: 'rolled_forward' },
    ])).toBe(2)
  })

  it('is zero for an empty history', () => {
    expect(countConsecutiveRolledForward([])).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @kanji-learn/shared test -- commitment
```

Expected: FAIL — `Failed to resolve import "./commitment"`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/buddy/commitment.ts`:

```ts
// The weekly commitment — spec §5.1.
//
// The commitment is EFFORT and METHOD, never volume (spec decision #3): new
// kanji per week depends on review debt and FSRS intervals, so a learner can do
// everything right and miss a volume target. Days and minutes are theirs.

export type CommitmentSource = 'session' | 'rolled_forward' | 'default'

export interface Commitment {
  weekStart: string            // YYYY-MM-DD, in the learner's timezone
  daysCommitted: number        // 1-7
  dayTargets: number[] | null  // optional specific weekdays, 0=Sun…6=Sat
  minutesPerDay: number
  focus: string | null
  source: CommitmentSource
}

/** Seed for a learner with no history. 15 matches user_profiles.daily_goal's default. */
export const DEFAULT_COMMITMENT = {
  daysCommitted: 4,
  minutesPerDay: 15,
} as const

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: 'days_out_of_range' | 'minutes_out_of_range' | 'day_targets_mismatch' }

export function validateCommitment(input: {
  daysCommitted: number
  minutesPerDay: number
  dayTargets?: number[] | null
}): ValidationResult {
  if (!Number.isInteger(input.daysCommitted) || input.daysCommitted < 1 || input.daysCommitted > 7) {
    return { ok: false, reason: 'days_out_of_range' }
  }
  if (!Number.isInteger(input.minutesPerDay) || input.minutesPerDay < 1) {
    return { ok: false, reason: 'minutes_out_of_range' }
  }
  if (input.dayTargets != null && input.dayTargets.length !== input.daysCommitted) {
    return { ok: false, reason: 'day_targets_mismatch' }
  }
  return { ok: true }
}

/**
 * Carry a commitment into the next period. This is what makes the ritual
 * survive a learner who never opens the session (spec §4): the week is always
 * set, and the conversation is a chance to CHANGE it, not a prerequisite for
 * having one.
 *
 * `focus` is deliberately dropped — a qualitative theme the learner never
 * re-agreed should not silently persist as though they had.
 */
export function rollForward(previous: Commitment | null, weekStart: string): Commitment {
  if (previous === null) {
    return {
      weekStart,
      daysCommitted: DEFAULT_COMMITMENT.daysCommitted,
      dayTargets: null,
      minutesPerDay: DEFAULT_COMMITMENT.minutesPerDay,
      focus: null,
      source: 'default',
    }
  }

  return {
    weekStart,
    daysCommitted: previous.daysCommitted,
    dayTargets: previous.dayTargets,
    minutesPerDay: previous.minutesPerDay,
    focus: null,
    source: 'rolled_forward',
  }
}

/**
 * How many periods in a row were carried rather than agreed — i.e. how many
 * appointments the learner has missed. Derived rather than stored, so there is
 * one source of truth (spec §8.1).
 */
export function countConsecutiveRolledForward(
  rows: Array<{ weekStart: string; source: CommitmentSource }>
): number {
  const sorted = [...rows].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
  let count = 0
  for (const row of sorted) {
    if (row.source === 'rolled_forward') count++
    else break
  }
  return count
}
```

- [ ] **Step 4: Export it**

Add to `packages/shared/src/index.ts`, after the existing `export * from './mnemonics'` line:

```ts
export * from './buddy/commitment'
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @kanji-learn/shared test -- commitment
```

Expected: PASS, 14 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/buddy/commitment.ts packages/shared/src/buddy/commitment.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): commitment types, validation and roll-forward"
```

---

### Task 3: `appointment.ts` — is a session due, and the step-down

**Files:**
- Create: `packages/shared/src/buddy/appointment.ts`
- Test: `packages/shared/src/buddy/appointment.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `AppointmentInput`, `AppointmentState`, `evaluateAppointment(input): AppointmentState`, `STEP_DOWN_AFTER_MISSES`, `shouldStepDown(misses): boolean`, `nextCadence(current): Cadence`, `defaultBuddyDay(restDay): number | null`, `addDays(iso, n): string`, `weekdayOf(iso): number`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/buddy/appointment.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  evaluateAppointment,
  shouldStepDown,
  nextCadence,
  defaultBuddyDay,
  addDays,
  weekdayOf,
  STEP_DOWN_AFTER_MISSES,
} from './appointment'

// 2026-08-03 is a Monday (weekday 1). Verified against a calendar; every date
// in this file is stated with its weekday so a reader can check the arithmetic.
const MON = '2026-08-03'
const TUE = '2026-08-04'
const THU = '2026-08-06'
const FRI = '2026-08-07'
const NEXT_MON = '2026-08-10'

describe('date helpers', () => {
  it('weekdayOf reads a UTC-anchored ISO date', () => {
    expect(weekdayOf(MON)).toBe(1)
    expect(weekdayOf('2026-08-09')).toBe(0) // Sunday
  })

  it('addDays crosses a month boundary', () => {
    expect(addDays('2026-08-30', 3)).toBe('2026-09-02')
  })

  it('addDays accepts negatives', () => {
    expect(addDays(NEXT_MON, -7)).toBe(MON)
  })
})

describe('evaluateAppointment', () => {
  const base = { buddyDay: 1, intervalWeeks: 1, lastSessionDate: null }

  it('is not_scheduled when buddyDay is null', () => {
    expect(evaluateAppointment({ ...base, buddyDay: null, localDate: MON }).kind)
      .toBe('not_scheduled')
  })

  it('is due on the buddy day itself', () => {
    const s = evaluateAppointment({ ...base, localDate: MON })
    expect(s.kind).toBe('due')
    expect(s.kind === 'due' && s.weekStart).toBe(MON)
  })

  it('is still due one day late — the window has not closed', () => {
    const s = evaluateAppointment({ ...base, localDate: TUE })
    expect(s.kind).toBe('due')
    expect(s.kind === 'due' && s.weekStart).toBe(MON)
  })

  it('is due at the last day of the window (3 days after, weekly)', () => {
    const s = evaluateAppointment({ ...base, localDate: THU })
    expect(s.kind).toBe('due')
    expect(s.kind === 'due' && s.weekStart).toBe(MON)
  })

  it('past the window it is waiting for the NEXT buddy day, not the missed one', () => {
    const s = evaluateAppointment({ ...base, localDate: FRI })
    expect(s.kind).toBe('waiting')
    expect(s.kind === 'waiting' && s.nextDue).toBe(NEXT_MON)
  })

  it('is not due again once this week is already done', () => {
    const s = evaluateAppointment({ ...base, localDate: TUE, lastSessionDate: MON })
    expect(s.kind).toBe('waiting')
    expect(s.kind === 'waiting' && s.nextDue).toBe(NEXT_MON)
  })

  it('fortnightly is not due on the off week', () => {
    // Session held on MON; fortnightly means the next is 14 days later.
    const s = evaluateAppointment({
      buddyDay: 1, intervalWeeks: 2, lastSessionDate: MON, localDate: NEXT_MON,
    })
    expect(s.kind).toBe('waiting')
    expect(s.kind === 'waiting' && s.nextDue).toBe('2026-08-17')
  })

  it('fortnightly is due again after two weeks', () => {
    const s = evaluateAppointment({
      buddyDay: 1, intervalWeeks: 2, lastSessionDate: MON, localDate: '2026-08-17',
    })
    expect(s.kind).toBe('due')
  })
})

describe('step-down', () => {
  it('does not fire below the threshold', () => {
    expect(shouldStepDown(STEP_DOWN_AFTER_MISSES - 1)).toBe(false)
  })

  it('fires at the threshold', () => {
    expect(shouldStepDown(STEP_DOWN_AFTER_MISSES)).toBe(true)
  })

  it('weekly steps down to fortnightly, keeping the day', () => {
    expect(nextCadence({ buddyDay: 1, intervalWeeks: 1 }))
      .toEqual({ buddyDay: 1, intervalWeeks: 2 })
  })

  it('fortnightly steps down to no appointment at all', () => {
    expect(nextCadence({ buddyDay: 1, intervalWeeks: 2 }))
      .toEqual({ buddyDay: null, intervalWeeks: 2 })
  })

  it('already stepped all the way down is a no-op', () => {
    expect(nextCadence({ buddyDay: null, intervalWeeks: 2 }))
      .toEqual({ buddyDay: null, intervalWeeks: 2 })
  })
})

describe('defaultBuddyDay', () => {
  it('is the day after the rest day', () => {
    expect(defaultBuddyDay(0)).toBe(1)
  })

  it('wraps around the week', () => {
    expect(defaultBuddyDay(6)).toBe(0)
  })

  it('is null when there is no rest day — Buddy proposes rather than picking silently', () => {
    expect(defaultBuddyDay(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @kanji-learn/shared test -- appointment
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/buddy/appointment.ts`:

```ts
// The appointment — spec §3 and §8.1.
//
// The appointment is a THIRD mode alongside push and pull: the learner agreed
// to it in advance, on a day they chose, so Buddy may bring things without
// those things being unbidden.
//
// Every function here is pure and takes the learner's LOCAL date as a
// YYYY-MM-DD string. Timezone conversion happens at the edge (the API uses
// localHourAndWeekday from notification.service.ts) — never in here.

/** Consecutive missed appointments before cadence drops (spec §8.1). */
export const STEP_DOWN_AFTER_MISSES = 3

export interface Cadence {
  buddyDay: number | null   // 0=Sun…6=Sat, null = "when I ask"
  intervalWeeks: number     // 1 = weekly, 2 = fortnightly
}

export interface AppointmentInput extends Cadence {
  localDate: string              // YYYY-MM-DD in the learner's timezone
  lastSessionDate: string | null // YYYY-MM-DD of the last completed session
}

export type AppointmentState =
  | { kind: 'not_scheduled' }
  | { kind: 'due'; weekStart: string }
  | { kind: 'waiting'; nextDue: string }

/** Weekday of a YYYY-MM-DD date, 0=Sun…6=Sat. Anchored to UTC so it is pure. */
export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay()
}

/** Add (or subtract) whole days to a YYYY-MM-DD date. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The most recent occurrence of `weekday` on or before `iso`. */
function lastOccurrenceOnOrBefore(iso: string, weekday: number): string {
  const delta = (weekdayOf(iso) - weekday + 7) % 7
  return addDays(iso, -delta)
}

/**
 * Is a session due right now?
 *
 * The window: a session belongs to the week that ended. Past the midpoint to
 * the next buddy_day the week is skipped and the next one is fresh (spec §8.1)
 * — so a learner who opens on day 5 of a weekly cadence does NOT get last
 * week's session two days before this week's.
 */
export function evaluateAppointment(input: AppointmentInput): AppointmentState {
  if (input.buddyDay === null) return { kind: 'not_scheduled' }

  const periodDays = 7 * input.intervalWeeks
  const anchor = lastOccurrenceOnOrBefore(input.localDate, input.buddyDay)
  const daysSinceAnchor = daysBetween(anchor, input.localDate)
  const windowDays = Math.floor(periodDays / 2)

  // Fortnightly: an anchor is only a real appointment if it is a whole number
  // of periods after the last session.
  const anchorIsThisPeriod =
    input.lastSessionDate === null ||
    daysBetween(input.lastSessionDate, anchor) >= periodDays

  const alreadyHeld =
    input.lastSessionDate !== null && input.lastSessionDate >= anchor

  if (anchorIsThisPeriod && !alreadyHeld && daysSinceAnchor <= windowDays) {
    return { kind: 'due', weekStart: anchor }
  }

  return { kind: 'waiting', nextDue: nextDueAfter(input, anchor) }
}

function nextDueAfter(input: AppointmentInput, anchor: string): string {
  const periodDays = 7 * input.intervalWeeks
  // Count from the last session when there was one — NOT from the anchor.
  // Counting from the anchor breaks fortnightly: a session held on the 3rd
  // with an anchor of the 10th would schedule the 24th instead of the 17th.
  const from = input.lastSessionDate ?? anchor
  let candidate = addDays(from, periodDays)
  // Snap forward if the last session was itself held off-day.
  while (weekdayOf(candidate) !== input.buddyDay) {
    candidate = addDays(candidate, 1)
  }
  return candidate
}

function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()
  return Math.round(ms / 86_400_000)
}

export function shouldStepDown(consecutiveMisses: number): boolean {
  return consecutiveMisses >= STEP_DOWN_AFTER_MISSES
}

/**
 * Weekly → fortnightly → no appointment. The learner keeps every other part of
 * the app; only the sit-down changes (spec decision #9). This exists so the
 * quiet exit is OURS and legible, rather than iOS notification settings, which
 * is silent and teaches us nothing.
 */
export function nextCadence(current: Cadence): Cadence {
  if (current.buddyDay === null) return current
  if (current.intervalWeeks === 1) return { buddyDay: current.buddyDay, intervalWeeks: 2 }
  return { buddyDay: null, intervalWeeks: current.intervalWeeks }
}

/** The day after the rest day (owner, 2026-07-30). Null rest day → Buddy proposes. */
export function defaultBuddyDay(restDay: number | null): number | null {
  if (restDay === null) return null
  return (restDay + 1) % 7
}
```

- [ ] **Step 4: Export it**

Add to `packages/shared/src/index.ts`:

```ts
export * from './buddy/appointment'
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @kanji-learn/shared test -- appointment
```

Expected: PASS, 17 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/buddy/appointment.ts packages/shared/src/buddy/appointment.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): appointment scheduling, window and step-down"
```

---

### Task 4: `reckoning.ts` — the promise check and the opener

**Files:**
- Create: `packages/shared/src/buddy/reckoning.ts`
- Test: `packages/shared/src/buddy/reckoning.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `Commitment` from `./commitment`
- Produces: `DayActivity`, `PromiseCheck`, `PromiseVerdict`, `OpenerKind`, `checkPromise(commitment, days): PromiseCheck`, `selectOpener(input): OpenerKind`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/buddy/reckoning.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { checkPromise, selectOpener, type DayActivity } from './reckoning'
import type { Commitment } from './commitment'

const agreed: Commitment = {
  weekStart: '2026-08-03', daysCommitted: 4, dayTargets: null,
  minutesPerDay: 15, focus: null, source: 'session',
}

const rolled: Commitment = { ...agreed, source: 'rolled_forward' }

function days(...minutes: number[]): DayActivity[] {
  return minutes.map((m, i) => ({
    date: `2026-08-0${3 + i}`, reviewed: m > 0 ? 10 : 0, studyMinutes: m,
  }))
}

describe('checkPromise', () => {
  it('is kept when active days reach the commitment', () => {
    const r = checkPromise(agreed, days(20, 20, 20, 20))
    expect(r.verdict).toBe('kept')
    expect(r.activeDays).toBe(4)
    expect(r.wasPromised).toBe(true)
  })

  it('counts a day active on reviews, not on minutes', () => {
    // Four short days still counts as showing up four times — the commitment
    // is regularity first (spec decision #3).
    const r = checkPromise(agreed, days(3, 3, 3, 3))
    expect(r.verdict).toBe('kept')
    expect(r.daysOnTargetMinutes).toBe(0)
  })

  it('is partial at half the commitment', () => {
    expect(checkPromise(agreed, days(20, 20)).verdict).toBe('partial')
  })

  it('is missed below half', () => {
    expect(checkPromise(agreed, days(20)).verdict).toBe('missed')
  })

  it('a rolled-forward commitment is NEVER a broken promise', () => {
    const r = checkPromise(rolled, days(20))
    expect(r.verdict).toBe('not_promised')
    expect(r.wasPromised).toBe(false)
    // Control assertion: the activity was genuinely read, so this is not
    // passing because the fixture was empty.
    expect(r.activeDays).toBe(1)
  })

  it('a default commitment is also not_promised', () => {
    expect(checkPromise({ ...agreed, source: 'default' }, days(20, 20, 20, 20)).verdict)
      .toBe('not_promised')
  })

  it('ignores zero-review days entirely', () => {
    const r = checkPromise(agreed, days(20, 0, 20, 0, 20, 0, 20))
    expect(r.activeDays).toBe(4)
    expect(r.verdict).toBe('kept')
  })

  it('reports days that also hit the minutes target', () => {
    const r = checkPromise(agreed, days(20, 5, 20, 20))
    expect(r.daysOnTargetMinutes).toBe(3)
  })
})

describe('selectOpener', () => {
  const kept = checkPromise(agreed, days(20, 20, 20, 20))
  const one = checkPromise(agreed, days(20))
  const none = checkPromise(agreed, [])
  const some = checkPromise(agreed, days(20, 20))

  it('first_ever wins over everything', () => {
    expect(selectOpener({ check: none, isFirstSession: true })).toBe('first_ever')
  })

  it('absent when nothing happened at all', () => {
    expect(selectOpener({ check: none, isFirstSession: false })).toBe('absent')
  })

  it('off for a single session — the week to ask about the person', () => {
    expect(selectOpener({ check: one, isFirstSession: false })).toBe('off')
  })

  it('strong when the promise was kept', () => {
    expect(selectOpener({ check: kept, isFirstSession: false })).toBe('strong')
  })

  it('steady in between', () => {
    expect(selectOpener({ check: some, isFirstSession: false })).toBe('steady')
  })

  it('a kept rolled-forward week is steady, not strong — nothing was promised', () => {
    const rolledKept = checkPromise(rolled, days(20, 20, 20, 20))
    expect(selectOpener({ check: rolledKept, isFirstSession: false })).toBe('steady')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @kanji-learn/shared test -- reckoning
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/buddy/reckoning.ts`:

```ts
// The reckoning — spec §6. Slice 1 implements the PROMISE check only;
// trajectory and frontier arrive in slice 2.

import type { Commitment } from './commitment'

export interface DayActivity {
  date: string          // YYYY-MM-DD
  reviewed: number      // reviews completed that day
  studyMinutes: number
}

export type PromiseVerdict = 'kept' | 'partial' | 'missed' | 'not_promised'

export interface PromiseCheck {
  verdict: PromiseVerdict
  activeDays: number
  committedDays: number
  /** Active days that also reached minutes_per_day. Reported, never the gate. */
  daysOnTargetMinutes: number
  /** False when the commitment was carried rather than agreed. */
  wasPromised: boolean
}

/**
 * Did the week match what was agreed?
 *
 * A day counts as active on REVIEWS, not on minutes: the commitment is
 * regularity first (spec decision #3, Arc §5C3). Minutes are reported
 * separately so Buddy can notice short days without turning them into a
 * failure.
 *
 * A commitment the learner never agreed to — rolled forward because they did
 * not attend — returns `not_promised`. Scoring it as broken would be Buddy
 * holding someone to words they never said (spec §5.1).
 */
export function checkPromise(commitment: Commitment, days: DayActivity[]): PromiseCheck {
  const active = days.filter((d) => d.reviewed > 0)
  const activeDays = active.length
  const daysOnTargetMinutes = active.filter((d) => d.studyMinutes >= commitment.minutesPerDay).length
  const wasPromised = commitment.source === 'session'

  const base = {
    activeDays,
    committedDays: commitment.daysCommitted,
    daysOnTargetMinutes,
    wasPromised,
  }

  if (!wasPromised) return { ...base, verdict: 'not_promised' }
  if (activeDays >= commitment.daysCommitted) return { ...base, verdict: 'kept' }
  if (activeDays >= Math.ceil(commitment.daysCommitted / 2)) return { ...base, verdict: 'partial' }
  return { ...base, verdict: 'missed' }
}

/**
 * Which register the session opens in (spec §4).
 *
 * The rule that matters: a POOR week opens with a question about the person,
 * not with numbers. That is the mechanism behind "less than hoped must not read
 * as failure" — not softer wording around the same figures, but not leading
 * with figures at all.
 *
 * 'mates_active' is designed in the spec but gated on Phase 4 social being
 * live, so it is deliberately absent from this union until then.
 */
export type OpenerKind = 'strong' | 'steady' | 'off' | 'absent' | 'first_ever'

export function selectOpener(input: {
  check: PromiseCheck
  isFirstSession: boolean
}): OpenerKind {
  if (input.isFirstSession) return 'first_ever'
  if (input.check.activeDays === 0) return 'absent'
  if (input.check.activeDays === 1) return 'off'
  if (input.check.verdict === 'kept') return 'strong'
  return 'steady'
}
```

- [ ] **Step 4: Export it**

Add to `packages/shared/src/index.ts`:

```ts
export * from './buddy/reckoning'
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @kanji-learn/shared test -- reckoning
```

Expected: PASS, 14 tests.

- [ ] **Step 6: Prove the guard tests can fail (spec §9)**

Temporarily change the `wasPromised` line in `reckoning.ts` to
`const wasPromised = true`. Re-run:

```bash
pnpm --filter @kanji-learn/shared test -- reckoning
```

Expected: FAIL — "a rolled-forward commitment is NEVER a broken promise" and
"a default commitment is also not_promised" both go red. **Revert the change**
and re-run to confirm PASS. If either test still passed with the rule removed,
the fixture is not reaching the guarded path and the test must be fixed before
moving on.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/buddy/reckoning.ts packages/shared/src/buddy/reckoning.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): promise check and opener selection"
```

---

### Task 5: `copy.ts` — the template-tier catalogue

**Files:**
- Create: `packages/shared/src/buddy/copy.ts`
- Test: `packages/shared/src/buddy/copy.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `OpenerKind`, `PromiseCheck` from `./reckoning`
- Produces: `openerCopy(kind, check): string`, `reckonCopy(check): string | null`, `stepDownCopy(next): string`

Copy lives server-side so Buddy's voice changes without an EAS build (spec §7.6).
It sits in `packages/shared` because the API is its only consumer and the
functions are pure.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/buddy/copy.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { openerCopy, reckonCopy, stepDownCopy } from './copy'
import { checkPromise } from './reckoning'
import type { Commitment } from './commitment'

const agreed: Commitment = {
  weekStart: '2026-08-03', daysCommitted: 4, dayTargets: null,
  minutesPerDay: 15, focus: null, source: 'session',
}

const four = checkPromise(agreed, [
  { date: '2026-08-03', reviewed: 10, studyMinutes: 20 },
  { date: '2026-08-04', reviewed: 10, studyMinutes: 20 },
  { date: '2026-08-05', reviewed: 10, studyMinutes: 20 },
  { date: '2026-08-06', reviewed: 10, studyMinutes: 20 },
])
const nothing = checkPromise(agreed, [])
const one = checkPromise(agreed, [{ date: '2026-08-03', reviewed: 10, studyMinutes: 20 }])

describe('openerCopy', () => {
  it('a strong week is specific, not generic', () => {
    const s = openerCopy('strong', four)
    expect(s).toContain('4')
    expect(s.toLowerCase()).not.toContain('amazing')
  })

  it('an OFF week never states a number — it asks about the person', () => {
    const s = openerCopy('off', one)
    expect(s).not.toMatch(/\d/)
    expect(s).toContain('?')
  })

  it('an ABSENT week never states a number either', () => {
    expect(openerCopy('absent', nothing)).not.toMatch(/\d/)
  })

  it('first_ever introduces Buddy and says it will get to know you', () => {
    const s = openerCopy('first_ever', nothing).toLowerCase()
    expect(s).toContain('know you')
  })
})

describe('reckonCopy', () => {
  it('is silent for a commitment that was never agreed', () => {
    const rolled = checkPromise({ ...agreed, source: 'rolled_forward' }, [])
    expect(reckonCopy(rolled)).toBeNull()
  })

  it('states both numbers when a promise was missed', () => {
    const missed = checkPromise(agreed, [{ date: '2026-08-03', reviewed: 10, studyMinutes: 20 }])
    const s = reckonCopy(missed)!
    expect(s).toContain('4')
    expect(s).toContain('1')
  })

  it('never scolds', () => {
    const missed = checkPromise(agreed, [])
    const s = (reckonCopy(missed) ?? '').toLowerCase()
    for (const word of ['should', 'failed', 'only managed', 'disappoint']) {
      expect(s).not.toContain(word)
    }
  })
})

describe('stepDownCopy', () => {
  it('says what will change and how to come back', () => {
    const s = stepDownCopy({ buddyDay: 1, intervalWeeks: 2 }).toLowerCase()
    expect(s).toContain('every other week')
  })

  it('the full stop-down says Buddy will stop showing up', () => {
    const s = stepDownCopy({ buddyDay: null, intervalWeeks: 2 }).toLowerCase()
    expect(s).toContain('shout')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @kanji-learn/shared test -- copy
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/buddy/copy.ts`:

```ts
// Template-tier copy — spec §7.6. English only, structured for localization
// but not localized (Arc §6).
//
// The tone rules this file enforces (spec §7.5):
//   - specific over enthusiastic
//   - no inflation
//   - a POOR week states no numbers at all, and asks about the person

import type { Cadence } from './appointment'
import type { OpenerKind, PromiseCheck } from './reckoning'

export function openerCopy(kind: OpenerKind, check: PromiseCheck): string {
  switch (kind) {
    case 'first_ever':
      return "Hi — I'm Buddy. I'll check in once a week to see how studying is going, " +
        "and I'll get to know you a bit as we go, so I can make this fit your life. " +
        "Shall we set up your first week?"
    case 'absent':
      return "Good to see you. No accounting today — how have things been?"
    case 'off':
      return "Hey. Quiet week on the app — has work been busy?"
    case 'strong':
      return `Nice — ${check.activeDays} days this week. That's the shape that sticks.`
    case 'steady':
      return "Good to see you. Let's take a look at the week."
  }
}

/**
 * The reckoning line. Returns null when there is nothing honest to say —
 * a commitment the learner never agreed to is not a promise to report on.
 */
export function reckonCopy(check: PromiseCheck): string | null {
  if (!check.wasPromised) return null

  switch (check.verdict) {
    case 'kept':
      return `We said ${check.committedDays} days, and you got ${check.activeDays}.`
    case 'partial':
      return `We said ${check.committedDays} days and you got ${check.activeDays} — ` +
        `a decent chunk of it.`
    case 'missed':
      return `We said ${check.committedDays} days; it came out at ${check.activeDays}. ` +
        `What got in the way?`
    case 'not_promised':
      return null
  }
}

export function stepDownCopy(next: Cadence): string {
  if (next.buddyDay === null) {
    return "I'll stop showing up on a schedule — give me a shout whenever you " +
      "want to pick this back up."
  }
  return "I'll switch to every other week, so I'm not in your way."
}
```

- [ ] **Step 4: Export it**

Add to `packages/shared/src/index.ts`:

```ts
export * from './buddy/copy'
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @kanji-learn/shared test -- copy
```

Expected: PASS, 9 tests.

- [ ] **Step 6: Run the whole shared suite and typecheck**

```bash
pnpm --filter @kanji-learn/shared test && pnpm --filter @kanji-learn/shared typecheck
```

Expected: all pass. Baseline before this plan was 193 tests; expect 193 + 54.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/buddy/copy.ts packages/shared/src/buddy/copy.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): template-tier copy catalogue"
```

---

### Task 6: `CommitmentService` — ensure, read, write

**Files:**
- Create: `apps/api/src/services/buddy/commitment.service.ts`
- Test: `apps/api/test/integration/buddy-commitment-service.test.ts`

**Interfaces:**
- Consumes: `Commitment`, `rollForward`, `countConsecutiveRolledForward` from `@kanji-learn/shared`; `buddyCommitments`, `dailyStats` from `@kanji-learn/db`
- Produces: `CommitmentService` with `ensureForWeek(userId, weekStart): Promise<Commitment>`, `getForWeek(userId, weekStart): Promise<Commitment | null>`, `getMostRecentBefore(userId, weekStart): Promise<Commitment | null>`, `setForWeek(userId, commitment): Promise<Commitment>`, `getActivity(userId, weekStart): Promise<DayActivity[]>`, `getMissCount(userId): Promise<number>`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/integration/buddy-commitment-service.test.ts`:

```ts
// CommitmentService — the server-side roll-forward that makes the ritual
// survive a learner who never opens the app (spec §8.3).

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { CommitmentService } from '../../src/services/buddy/commitment.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const service = new CommitmentService(db)

const TEST_USER_ID = '00000000-0000-0000-0000-0000000000b2'

beforeAll(async () => {
  await db.insert(schema.userProfiles)
    .values({ id: TEST_USER_ID, displayName: 'Service Fixture' })
    .onConflictDoNothing()
})

beforeEach(async () => {
  await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
  await db.delete(schema.dailyStats).where(eq(schema.dailyStats.userId, TEST_USER_ID))
})

afterAll(async () => {
  await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
  await db.delete(schema.dailyStats).where(eq(schema.dailyStats.userId, TEST_USER_ID))
  await db.delete(schema.userProfiles).where(eq(schema.userProfiles.id, TEST_USER_ID))
  await client.end()
})

describe('ensureForWeek', () => {
  it('seeds a default commitment for a learner with no history', async () => {
    const c = await service.ensureForWeek(TEST_USER_ID, '2026-08-03')
    expect(c.source).toBe('default')
    expect(c.daysCommitted).toBe(4)
  })

  it('rolls the previous week forward', async () => {
    await service.setForWeek(TEST_USER_ID, {
      weekStart: '2026-08-03', daysCommitted: 5, dayTargets: null,
      minutesPerDay: 20, focus: 'backlog', source: 'session',
    })

    const next = await service.ensureForWeek(TEST_USER_ID, '2026-08-10')
    expect(next.source).toBe('rolled_forward')
    expect(next.daysCommitted).toBe(5)
    expect(next.minutesPerDay).toBe(20)
    expect(next.focus).toBeNull()
  })

  it('is idempotent — running twice does not create a second row', async () => {
    await service.ensureForWeek(TEST_USER_ID, '2026-08-03')
    await service.ensureForWeek(TEST_USER_ID, '2026-08-03')

    const rows = await db.select().from(schema.buddyCommitments)
      .where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
    expect(rows).toHaveLength(1)
  })

  it('never overwrites a commitment the learner agreed', async () => {
    await service.setForWeek(TEST_USER_ID, {
      weekStart: '2026-08-03', daysCommitted: 6, dayTargets: null,
      minutesPerDay: 30, focus: null, source: 'session',
    })

    const same = await service.ensureForWeek(TEST_USER_ID, '2026-08-03')
    expect(same.source).toBe('session')
    expect(same.daysCommitted).toBe(6)
  })
})

describe('setForWeek', () => {
  it('replaces a rolled-forward row when the learner turns up and agrees', async () => {
    await service.ensureForWeek(TEST_USER_ID, '2026-08-03')

    const agreed = await service.setForWeek(TEST_USER_ID, {
      weekStart: '2026-08-03', daysCommitted: 3, dayTargets: null,
      minutesPerDay: 10, focus: null, source: 'session',
    })

    expect(agreed.source).toBe('session')
    const rows = await db.select().from(schema.buddyCommitments)
      .where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].daysCommitted).toBe(3)
  })
})

describe('getActivity', () => {
  it('returns the seven days of the period, including empty ones', async () => {
    await db.insert(schema.dailyStats).values([
      { userId: TEST_USER_ID, date: '2026-08-03', reviewed: 12, studyTimeMs: 20 * 60_000 },
      { userId: TEST_USER_ID, date: '2026-08-06', reviewed: 5, studyTimeMs: 6 * 60_000 },
      // Outside the window — must not be counted.
      { userId: TEST_USER_ID, date: '2026-08-11', reviewed: 30, studyTimeMs: 40 * 60_000 },
    ])

    const days = await service.getActivity(TEST_USER_ID, '2026-08-03')
    expect(days).toHaveLength(7)
    expect(days.filter((d) => d.reviewed > 0)).toHaveLength(2)
    expect(days.find((d) => d.date === '2026-08-03')!.studyMinutes).toBe(20)
    expect(days.some((d) => d.date === '2026-08-11')).toBe(false)
  })
})

describe('getMissCount', () => {
  it('counts consecutive rolled-forward periods', async () => {
    await service.setForWeek(TEST_USER_ID, {
      weekStart: '2026-08-03', daysCommitted: 4, dayTargets: null,
      minutesPerDay: 15, focus: null, source: 'session',
    })
    await service.ensureForWeek(TEST_USER_ID, '2026-08-10')
    await service.ensureForWeek(TEST_USER_ID, '2026-08-17')

    expect(await service.getMissCount(TEST_USER_ID)).toBe(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @kanji-learn/api test -- buddy-commitment-service
```

Expected: FAIL — cannot resolve `commitment.service`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/services/buddy/commitment.service.ts`:

```ts
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { buddyCommitments, dailyStats } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import {
  addDays,
  countConsecutiveRolledForward,
  rollForward,
  type Commitment,
  type CommitmentSource,
  type DayActivity,
} from '@kanji-learn/shared'

const PERIOD_DAYS = 7

type Row = typeof buddyCommitments.$inferSelect

function toCommitment(row: Row): Commitment {
  return {
    weekStart: row.weekStart,
    daysCommitted: row.daysCommitted,
    dayTargets: row.dayTargets ?? null,
    minutesPerDay: row.minutesPerDay,
    focus: row.focus ?? null,
    source: row.source as CommitmentSource,
  }
}

export class CommitmentService {
  constructor(private readonly db: Db) {}

  async getForWeek(userId: string, weekStart: string): Promise<Commitment | null> {
    const rows = await this.db.select().from(buddyCommitments)
      .where(and(eq(buddyCommitments.userId, userId), eq(buddyCommitments.weekStart, weekStart)))
      .limit(1)
    return rows[0] ? toCommitment(rows[0]) : null
  }

  async getMostRecentBefore(userId: string, weekStart: string): Promise<Commitment | null> {
    const rows = await this.db.select().from(buddyCommitments)
      .where(and(
        eq(buddyCommitments.userId, userId),
        lte(buddyCommitments.weekStart, addDays(weekStart, -1)),
      ))
      .orderBy(desc(buddyCommitments.weekStart))
      .limit(1)
    return rows[0] ? toCommitment(rows[0]) : null
  }

  /**
   * Guarantee that `weekStart` has a commitment, carrying the previous one
   * forward if the learner did not attend. Idempotent: safe to call from the
   * hourly pass and from a session read in the same minute, because
   * `onConflictDoNothing` leans on the (user_id, week_start) unique index
   * rather than a read-then-write race.
   */
  async ensureForWeek(userId: string, weekStart: string): Promise<Commitment> {
    const existing = await this.getForWeek(userId, weekStart)
    if (existing) return existing

    const previous = await this.getMostRecentBefore(userId, weekStart)
    const next = rollForward(previous, weekStart)

    await this.db.insert(buddyCommitments).values({
      userId,
      weekStart: next.weekStart,
      daysCommitted: next.daysCommitted,
      dayTargets: next.dayTargets,
      minutesPerDay: next.minutesPerDay,
      focus: next.focus,
      source: next.source,
    }).onConflictDoNothing()

    // Re-read rather than trusting `next`: a concurrent writer may have won.
    return (await this.getForWeek(userId, weekStart)) ?? next
  }

  /** Write an agreed commitment, replacing whatever was carried. */
  async setForWeek(userId: string, commitment: Commitment): Promise<Commitment> {
    await this.db.insert(buddyCommitments).values({
      userId,
      weekStart: commitment.weekStart,
      daysCommitted: commitment.daysCommitted,
      dayTargets: commitment.dayTargets,
      minutesPerDay: commitment.minutesPerDay,
      focus: commitment.focus,
      source: commitment.source,
    }).onConflictDoUpdate({
      target: [buddyCommitments.userId, buddyCommitments.weekStart],
      set: {
        daysCommitted: commitment.daysCommitted,
        dayTargets: commitment.dayTargets,
        minutesPerDay: commitment.minutesPerDay,
        focus: commitment.focus,
        source: commitment.source,
        agreedAt: new Date(),
      },
    })
    return commitment
  }

  /** The seven days of a period, with absent days present and zeroed. */
  async getActivity(userId: string, weekStart: string): Promise<DayActivity[]> {
    const weekEnd = addDays(weekStart, PERIOD_DAYS - 1)

    const rows = await this.db.select({
      date: dailyStats.date,
      reviewed: dailyStats.reviewed,
      studyTimeMs: dailyStats.studyTimeMs,
    })
      .from(dailyStats)
      .where(and(
        eq(dailyStats.userId, userId),
        gte(dailyStats.date, weekStart),
        lte(dailyStats.date, weekEnd),
      ))

    const byDate = new Map(rows.map((r) => [r.date, r]))

    return Array.from({ length: PERIOD_DAYS }, (_, i) => {
      const date = addDays(weekStart, i)
      const row = byDate.get(date)
      return {
        date,
        reviewed: row?.reviewed ?? 0,
        studyMinutes: Math.round((row?.studyTimeMs ?? 0) / 60_000),
      }
    })
  }

  /** Consecutive missed appointments, derived rather than stored (spec §8.1). */
  async getMissCount(userId: string): Promise<number> {
    const rows = await this.db.select({
      weekStart: buddyCommitments.weekStart,
      source: buddyCommitments.source,
    })
      .from(buddyCommitments)
      .where(eq(buddyCommitments.userId, userId))
      .orderBy(desc(buddyCommitments.weekStart))
      .limit(12)

    return countConsecutiveRolledForward(
      rows.map((r) => ({ weekStart: r.weekStart, source: r.source as CommitmentSource }))
    )
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @kanji-learn/api test -- buddy-commitment-service
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Prove the idempotency guard can fail**

Temporarily replace `.onConflictDoNothing()` with nothing (a bare insert).
Re-run — "is idempotent" must go red with a unique-violation. **Revert.**

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/buddy/commitment.service.ts apps/api/test/integration/buddy-commitment-service.test.ts
git commit -m "feat(api): CommitmentService with idempotent server-side roll-forward"
```

---

### Task 7: `GET /v1/buddy/session` — the session context

**Files:**
- Create: `apps/api/src/routes/buddy-session.ts`
- Modify: `apps/api/src/server.ts` (import beside the other route imports ~line 40; register beside `buddyNudgesRoutes` ~line 155)
- Test: `apps/api/test/integration/buddy-session-route.test.ts`

**Interfaces:**
- Consumes: `CommitmentService` (Task 6); `evaluateAppointment`, `checkPromise`, `selectOpener`, `openerCopy`, `reckonCopy`, `validateCommitment` from `@kanji-learn/shared`
- Produces: `CommitmentService.getMostRecentAgreed(userId): Promise<Commitment | null>` (added here, used again by Task 8); `buddySessionRoutes(server)`; response shape
  `{ ok: true, data: { state: 'not_scheduled' | 'due' | 'waiting', weekStart?, nextDue?, opener?: { kind, text }, reckon?: string | null, currentCommitment?, proposedCommitment? } }`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/integration/buddy-session-route.test.ts`:

```ts
// GET /v1/buddy/session — auth via the bare x-test-user-id header
// (this repo's convention; see test-app.ts).

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { buildTestApp } from '../test-app'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER_ID = '00000000-0000-0000-0000-0000000000b3'
let app: Awaited<ReturnType<typeof buildTestApp>>

beforeAll(async () => {
  app = await buildTestApp()
  await db.insert(schema.userProfiles)
    .values({ id: TEST_USER_ID, displayName: 'Route Fixture', timezone: 'America/Los_Angeles' })
    .onConflictDoUpdate({
      target: schema.userProfiles.id,
      set: { timezone: 'America/Los_Angeles' },
    })
})

beforeEach(async () => {
  await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
  await db.update(schema.userProfiles)
    .set({ buddyDay: null, buddyIntervalWeeks: 1 })
    .where(eq(schema.userProfiles.id, TEST_USER_ID))
})

afterAll(async () => {
  await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
  await db.delete(schema.userProfiles).where(eq(schema.userProfiles.id, TEST_USER_ID))
  await app.close()
  await client.end()
})

function get() {
  return app.inject({
    method: 'GET',
    url: '/v1/buddy/session',
    headers: { 'x-test-user-id': TEST_USER_ID },
  })
}

describe('GET /v1/buddy/session', () => {
  it('reports not_scheduled when the learner has no buddy_day', async () => {
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.json().data.state).toBe('not_scheduled')
  })

  it('returns an opener and a proposed commitment when a session is due', async () => {
    // Set buddy_day to today in the learner's timezone so the session is due.
    const todayWeekday = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
    ).getDay()
    await db.update(schema.userProfiles)
      .set({ buddyDay: todayWeekday })
      .where(eq(schema.userProfiles.id, TEST_USER_ID))

    const res = await get()
    const data = res.json().data

    expect(data.state).toBe('due')
    expect(data.opener.kind).toBe('first_ever')
    expect(typeof data.opener.text).toBe('string')
    expect(data.proposedCommitment.daysCommitted).toBe(4)
    expect(data.proposedCommitment.source).toBe('default')
  })

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/buddy/session' })
    expect(res.statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @kanji-learn/api test -- buddy-session-route
```

Expected: FAIL — 404 on the route.

- [ ] **Step 3: Write the route**

Create `apps/api/src/routes/buddy-session.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { userProfiles } from '@kanji-learn/db'
import {
  checkPromise,
  evaluateAppointment,
  openerCopy,
  reckonCopy,
  selectOpener,
  validateCommitment,
  type Commitment,
} from '@kanji-learn/shared'
import { z } from 'zod'
import { CommitmentService } from '../services/buddy/commitment.service.js'

const commitmentBodySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  daysCommitted: z.number().int(),
  minutesPerDay: z.number().int(),
  dayTargets: z.array(z.number().int().min(0).max(6)).nullable().optional(),
  focus: z.string().max(200).nullable().optional(),
})

/** The learner's local calendar date, from their stored timezone. */
function localDateFor(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

export async function buddySessionRoutes(server: FastifyInstance) {
  const service = new CommitmentService(server.db)

  server.get('/', { preHandler: [server.authenticate] }, async (req, reply) => {
    const profile = await server.db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, req.userId!),
    })
    if (!profile) {
      return reply.code(404).send({ ok: false, error: 'Profile not found', code: 'NOT_FOUND' })
    }

    const now = new Date()
    const localDate = localDateFor(profile.timezone, now)

    const lastAgreed = await service.getMostRecentAgreed(req.userId!)

    const state = evaluateAppointment({
      buddyDay: profile.buddyDay ?? null,
      intervalWeeks: profile.buddyIntervalWeeks,
      localDate,
      lastSessionDate: lastAgreed?.weekStart ?? null,
    })

    if (state.kind === 'not_scheduled') {
      return reply.send({ ok: true, data: { state: 'not_scheduled' } })
    }
    if (state.kind === 'waiting') {
      return reply.send({ ok: true, data: { state: 'waiting', nextDue: state.nextDue } })
    }

    // Due. Look at what actually happened in the period that just ended.
    const previous = await service.getMostRecentBefore(req.userId!, state.weekStart)
    const isFirstSession = previous === null

    // The check must stay in scope: openerCopy('strong', …) reports
    // check.activeDays, so handing it a freshly-zeroed check would make Buddy
    // congratulate the learner on "0 days".
    const check = previous === null
      ? checkPromise(defaultShape(state.weekStart), [])
      : checkPromise(previous, await service.getActivity(req.userId!, previous.weekStart))

    const openerKind = selectOpener({ check, isFirstSession })
    const reckon = previous === null ? null : reckonCopy(check)

    const proposed = await service.ensureForWeek(req.userId!, state.weekStart)

    return reply.send({
      ok: true,
      data: {
        state: 'due',
        weekStart: state.weekStart,
        opener: { kind: openerKind, text: openerCopy(openerKind, check) },
        reckon,
        isFirstSession,
        proposedCommitment: proposed,
      },
    })
  })

  server.post('/commitment', { preHandler: [server.authenticate] }, async (req, reply) => {
    const body = commitmentBodySchema.safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({
        ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR', details: body.error,
      })
    }

    const check = validateCommitment({
      daysCommitted: body.data.daysCommitted,
      minutesPerDay: body.data.minutesPerDay,
      dayTargets: body.data.dayTargets ?? null,
    })
    if (!check.ok) {
      return reply.code(400).send({ ok: false, error: check.reason, code: 'VALIDATION_ERROR' })
    }

    const commitment: Commitment = {
      weekStart: body.data.weekStart,
      daysCommitted: body.data.daysCommitted,
      dayTargets: body.data.dayTargets ?? null,
      minutesPerDay: body.data.minutesPerDay,
      focus: body.data.focus ?? null,
      source: 'session',
    }

    await service.setForWeek(req.userId!, commitment)
    return reply.send({ ok: true, data: commitment })
  })
}

function defaultShape(weekStart: string): Commitment {
  return {
    weekStart, daysCommitted: 4, dayTargets: null,
    minutesPerDay: 15, focus: null, source: 'default',
  }
}
```

Then add to `apps/api/src/services/buddy/commitment.service.ts` (it is needed by
the route and belongs beside its siblings):

```ts
  /** The most recent commitment the learner actually agreed to. */
  async getMostRecentAgreed(userId: string): Promise<Commitment | null> {
    const rows = await this.db.select().from(buddyCommitments)
      .where(and(eq(buddyCommitments.userId, userId), eq(buddyCommitments.source, 'session')))
      .orderBy(desc(buddyCommitments.weekStart))
      .limit(1)
    return rows[0] ? toCommitment(rows[0]) : null
  }
```

- [ ] **Step 4: Register the route**

In `apps/api/src/server.ts`, add beside the other route imports:

```ts
import { buddySessionRoutes } from './routes/buddy-session.js'
```

and beside `buddyNudgesRoutes`:

```ts
  await server.register(buddySessionRoutes, { prefix: '/v1/buddy/session' })
```

**Register it BEFORE any parametric route that could swallow it.** `docs/SOP.md`
records `mnemonics.ts`'s `GET /:kanjiId` swallowing `/refresh` and returning 401
on every build, which made a stale deploy look verified.

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @kanji-learn/api test -- buddy-session-route
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/buddy-session.ts apps/api/src/services/buddy/commitment.service.ts apps/api/src/server.ts apps/api/test/integration/buddy-session-route.test.ts
git commit -m "feat(api): GET /v1/buddy/session and POST /v1/buddy/session/commitment"
```

---

### Task 8: The hourly buddy-day pass — push, roll-forward, step-down

**Files:**
- Modify: `apps/api/src/services/notification.service.ts` (add `runBuddyDayPass` beside `sendRestDaySummaries` ~line 396)
- Modify: `apps/api/src/routes/internal.ts` (call it from the existing `/daily-reminders` handler)
- Test: `apps/api/test/integration/buddy-day-pass.test.ts`

**Interfaces:**
- Consumes: `CommitmentService`; `evaluateAppointment`, `shouldStepDown`, `nextCadence`, `stepDownCopy` from `@kanji-learn/shared`
- Produces: `NotificationService.runBuddyDayPass(): Promise<void>`

**Why it rides `/daily-reminders`:** daily reminders run off the external
EventBridge rule `kanji-learn-hourly-reminders` → Lambda → this endpoint.
`apps/api/src/cron.ts:8` warns that in-app `node-cron` double-fires once App
Runner scales past one instance, and a new EventBridge rule is an infra step
that can be missed at deploy time. The hourly invocation already exists; use it.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/integration/buddy-day-pass.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { NotificationService } from '../../src/services/notification.service'
import { CommitmentService } from '../../src/services/buddy/commitment.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER_ID = '00000000-0000-0000-0000-0000000000b4'
const UTC_USER_ID = '00000000-0000-0000-0000-0000000000b5'

beforeAll(async () => {
  await db.insert(schema.userProfiles).values([
    { id: TEST_USER_ID, displayName: 'Pass Fixture', timezone: 'America/Los_Angeles' },
    // Still on the 'UTC' default — must be skipped, not guessed at (spec §8.5).
    { id: UTC_USER_ID, displayName: 'UTC Default Fixture' },
  ]).onConflictDoNothing()
})

beforeEach(async () => {
  for (const id of [TEST_USER_ID, UTC_USER_ID]) {
    await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, id))
  }
})

afterAll(async () => {
  for (const id of [TEST_USER_ID, UTC_USER_ID]) {
    await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, id))
    await db.delete(schema.userProfiles).where(eq(schema.userProfiles.id, id))
  }
  await client.end()
})

/** Set buddy_day and reminder_hour to "right now" in the user's timezone. */
async function scheduleForNow(userId: string, timeZone: string) {
  const local = new Date(new Date().toLocaleString('en-US', { timeZone }))
  await db.update(schema.userProfiles)
    .set({ buddyDay: local.getDay(), reminderHour: local.getHours(), notificationsEnabled: true })
    .where(eq(schema.userProfiles.id, userId))
}

describe('runBuddyDayPass', () => {
  it('ensures a commitment exists for the due period', async () => {
    await scheduleForNow(TEST_USER_ID, 'America/Los_Angeles')

    const service = new NotificationService(db)
    vi.spyOn(service as any, 'sendToUserTokens').mockResolvedValue(undefined)
    await service.runBuddyDayPass()

    const rows = await db.select().from(schema.buddyCommitments)
      .where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('default')
  })

  it('sends exactly one push for a due session', async () => {
    await scheduleForNow(TEST_USER_ID, 'America/Los_Angeles')

    const service = new NotificationService(db)
    const send = vi.spyOn(service as any, 'sendToUserTokens').mockResolvedValue(undefined)
    await service.runBuddyDayPass()

    const calls = send.mock.calls.filter((c) => c[0] === TEST_USER_ID)
    expect(calls).toHaveLength(1)
    expect((calls[0][1] as any).data.type).toBe('buddy_session')
  })

  it('SKIPS a user whose timezone is still the UTC default (spec §8.5)', async () => {
    await db.update(schema.userProfiles)
      .set({ buddyDay: new Date().getUTCDay(), reminderHour: new Date().getUTCHours() })
      .where(eq(schema.userProfiles.id, UTC_USER_ID))

    const service = new NotificationService(db)
    const send = vi.spyOn(service as any, 'sendToUserTokens').mockResolvedValue(undefined)
    await service.runBuddyDayPass()

    expect(send.mock.calls.filter((c) => c[0] === UTC_USER_ID)).toHaveLength(0)
    const rows = await db.select().from(schema.buddyCommitments)
      .where(eq(schema.buddyCommitments.userId, UTC_USER_ID))
    expect(rows).toHaveLength(0)

    // Control assertion: the pass genuinely ran and did work for someone else,
    // so this is not passing because nothing executed.
    await scheduleForNow(TEST_USER_ID, 'America/Los_Angeles')
    await service.runBuddyDayPass()
    expect(send.mock.calls.filter((c) => c[0] === TEST_USER_ID).length).toBeGreaterThan(0)
  })

  it('steps cadence down after three consecutive misses', async () => {
    await scheduleForNow(TEST_USER_ID, 'America/Los_Angeles')
    const commitments = new CommitmentService(db)

    await commitments.setForWeek(TEST_USER_ID, {
      weekStart: '2026-07-06', daysCommitted: 4, dayTargets: null,
      minutesPerDay: 15, focus: null, source: 'session',
    })
    for (const w of ['2026-07-13', '2026-07-20', '2026-07-27']) {
      await commitments.ensureForWeek(TEST_USER_ID, w)
    }

    const service = new NotificationService(db)
    vi.spyOn(service as any, 'sendToUserTokens').mockResolvedValue(undefined)
    await service.runBuddyDayPass()

    const profile = await db.select().from(schema.userProfiles)
      .where(eq(schema.userProfiles.id, TEST_USER_ID))
    expect(profile[0].buddyIntervalWeeks).toBe(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @kanji-learn/api test -- buddy-day-pass
```

Expected: FAIL — `service.runBuddyDayPass is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `apps/api/src/services/notification.service.ts`, immediately after
`sendRestDaySummaries`:

```ts
  /**
   * Hourly buddy-day pass — spec §8.1 and §8.3.
   *
   * Three jobs, in this order:
   *   1. Roll the commitment forward. This is why it is server-side: the week
   *      must be set whether or not the learner's phone ever connects.
   *   2. Push, if a session is due right now in their timezone.
   *   3. Step the cadence down after three consecutive misses, so the quiet
   *      exit is ours and legible rather than iOS notification settings.
   *
   * Runs off the existing hourly EventBridge → Lambda → POST
   * /internal/daily-reminders invocation. See cron.ts:8 for why not node-cron.
   */
  async runBuddyDayPass(): Promise<void> {
    const nowUtc = new Date()
    const commitments = new CommitmentService(this.db)

    const users = await this.db
      .select({
        id: userProfiles.id,
        timezone: userProfiles.timezone,
        reminderHour: userProfiles.reminderHour,
        buddyDay: userProfiles.buddyDay,
        buddyIntervalWeeks: userProfiles.buddyIntervalWeeks,
        notificationsEnabled: userProfiles.notificationsEnabled,
      })
      .from(userProfiles)
      .where(sql`${userProfiles.buddyDay} IS NOT NULL`)

    for (const user of users) {
      // A learner still on the 'UTC' default has no reliable buddy_day.
      // Skipping is deliberate — guessing is what fired daily reminders at the
      // wrong hour for three months (schema.ts:171).
      if (user.timezone === 'UTC') {
        console.warn(`[BuddyDay] skipping ${user.id}: timezone still 'UTC' default`)
        continue
      }

      const { hour: localHour } = localHourAndWeekday(nowUtc, user.timezone)
      const localDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: user.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(nowUtc)

      const lastAgreed = await commitments.getMostRecentAgreed(user.id)
      const state = evaluateAppointment({
        buddyDay: user.buddyDay,
        intervalWeeks: user.buddyIntervalWeeks,
        localDate,
        lastSessionDate: lastAgreed?.weekStart ?? null,
      })

      if (state.kind !== 'due') continue

      // 1. Roll forward — unconditional, independent of the push.
      await commitments.ensureForWeek(user.id, state.weekStart)

      // 3. Step down before they mute us.
      const misses = await commitments.getMissCount(user.id)
      if (shouldStepDown(misses)) {
        const next = nextCadence({
          buddyDay: user.buddyDay,
          intervalWeeks: user.buddyIntervalWeeks,
        })
        await this.db.update(userProfiles)
          .set({ buddyDay: next.buddyDay, buddyIntervalWeeks: next.intervalWeeks })
          .where(eq(userProfiles.id, user.id))

        if (user.notificationsEnabled) {
          await this.sendToUserTokens(user.id, {
            title: 'Buddy',
            body: stepDownCopy(next),
            sound: 'default',
            data: { type: 'buddy_step_down' },
          })
        }
        continue
      }

      // 2. Push, only at their chosen hour.
      if (localHour !== (user.reminderHour ?? 20)) continue
      if (!user.notificationsEnabled) continue

      await this.sendToUserTokens(user.id, {
        title: 'Time for our weekly catch-up',
        body: "Let's look at the week and set the next one.",
        sound: 'default',
        data: { type: 'buddy_session', weekStart: state.weekStart },
      })
    }
  }
```

Add to the imports at the top of `notification.service.ts`:

```ts
import { evaluateAppointment, nextCadence, shouldStepDown, stepDownCopy } from '@kanji-learn/shared'
import { CommitmentService } from './buddy/commitment.service.js'
```

`eq`, `sql` and `userProfiles` are already imported in that file by
`sendDailyReminders` and `sendRestDaySummaries` — check before adding them
again rather than creating a duplicate import.

- [ ] **Step 4: Call it from the hourly endpoint**

In `apps/api/src/routes/internal.ts`, inside the `/daily-reminders` handler,
after the existing calls:

```ts
    // The weekly Buddy appointment rides this same hourly invocation — see
    // cron.ts:8 for why this is not a node-cron schedule, and the plan for why
    // it is not a second EventBridge rule.
    await notificationService.runBuddyDayPass()
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @kanji-learn/api test -- buddy-day-pass
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Prove the timezone guard can fail**

Temporarily delete the `if (user.timezone === 'UTC') continue` block. Re-run —
"SKIPS a user whose timezone is still the UTC default" must go red. **Revert**
and confirm PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/notification.service.ts apps/api/src/routes/internal.ts apps/api/test/integration/buddy-day-pass.test.ts
git commit -m "feat(api): hourly buddy-day pass — roll-forward, push, step-down"
```

---

### Task 9: Account deletion coverage

**Files:**
- Modify: `apps/api/test/integration/user-delete.test.ts`
- Test: same file

`buddy_commitments` cascades from `user_profiles`, so deletion already works —
this task proves it, because "the table that gets forgotten" is exactly this one
(spec §5.5).

**Interfaces:**
- Consumes: `buddyCommitments`
- Produces: nothing

- [ ] **Step 1: Add the failing assertion**

In `apps/api/test/integration/user-delete.test.ts`, seed a commitment for the
user under test before deletion:

```ts
  await db.insert(schema.buddyCommitments).values({
    userId: TEST_USER_ID,
    weekStart: '2026-08-03',
    daysCommitted: 4,
    minutesPerDay: 15,
    source: 'session',
  })
```

and assert after deletion, alongside the existing table assertions:

```ts
  const commitments = await db.select().from(schema.buddyCommitments)
    .where(eq(schema.buddyCommitments.userId, TEST_USER_ID))
  expect(commitments).toHaveLength(0)
```

- [ ] **Step 2: Run it**

```bash
pnpm --filter @kanji-learn/api test -- user-delete
```

Expected: PASS — the FK cascade in migration 0030 already handles it. **If it
fails, the `ON DELETE CASCADE` in 0030 is wrong and must be fixed before
continuing.**

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/integration/user-delete.test.ts
git commit -m "test(api): prove buddy_commitments is covered by account deletion"
```

---

### Task 10: Mobile — pure card-sequence state

**Files:**
- Create: `apps/mobile/src/lib/buddy-session-state.ts`
- Test: `apps/mobile/test/buddy-session-state.test.ts`

Mirrors `journal-list-state.ts` — a pure decision function in the pure Jest
lane, which is this repo's default for anything that does not need rendering.

**Interfaces:**
- Consumes: nothing (mirrors the API response shape from Task 7)
- Produces: `SessionCard`, `SessionBody`, `selectSessionBody(input): SessionBody`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/test/buddy-session-state.test.ts`:

```ts
import { selectSessionBody } from '../src/lib/buddy-session-state'

describe('selectSessionBody', () => {
  it('shows a loader before anything has arrived', () => {
    expect(selectSessionBody({ hasLoaded: false, error: null, data: null }).kind)
      .toBe('loading')
  })

  it('shows an error state when the fetch failed', () => {
    expect(selectSessionBody({ hasLoaded: true, error: 'offline', data: null }).kind)
      .toBe('error')
  })

  it('shows the not-scheduled state', () => {
    expect(selectSessionBody({
      hasLoaded: true, error: null, data: { state: 'not_scheduled' },
    }).kind).toBe('not_scheduled')
  })

  it('shows when the next session is due', () => {
    const body = selectSessionBody({
      hasLoaded: true, error: null, data: { state: 'waiting', nextDue: '2026-08-10' },
    })
    expect(body.kind).toBe('waiting')
    expect(body.kind === 'waiting' && body.nextDue).toBe('2026-08-10')
  })

  it('builds the card sequence for a due session, opener first and set last', () => {
    const body = selectSessionBody({
      hasLoaded: true, error: null,
      data: {
        state: 'due', weekStart: '2026-08-10',
        opener: { kind: 'strong', text: 'Nice — 4 days this week.' },
        reckon: 'We said 4 days, and you got 4.',
        isFirstSession: false,
        proposedCommitment: {
          weekStart: '2026-08-10', daysCommitted: 4, dayTargets: null,
          minutesPerDay: 15, focus: null, source: 'rolled_forward',
        },
      },
    })

    expect(body.kind).toBe('cards')
    if (body.kind !== 'cards') throw new Error('expected cards')
    expect(body.cards.map((c) => c.kind)).toEqual(['opener', 'reckon', 'set'])
  })

  it('omits the reckon card when there is nothing honest to report', () => {
    const body = selectSessionBody({
      hasLoaded: true, error: null,
      data: {
        state: 'due', weekStart: '2026-08-10',
        opener: { kind: 'first_ever', text: "Hi — I'm Buddy." },
        reckon: null,
        isFirstSession: true,
        proposedCommitment: {
          weekStart: '2026-08-10', daysCommitted: 4, dayTargets: null,
          minutesPerDay: 15, focus: null, source: 'default',
        },
      },
    })

    if (body.kind !== 'cards') throw new Error('expected cards')
    expect(body.cards.map((c) => c.kind)).toEqual(['opener', 'set'])
  })

  it('always ends on the set card — the one guaranteed outcome', () => {
    for (const reckon of [null, 'We said 4 days.']) {
      const body = selectSessionBody({
        hasLoaded: true, error: null,
        data: {
          state: 'due', weekStart: '2026-08-10',
          opener: { kind: 'steady', text: 'Good to see you.' },
          reckon,
          isFirstSession: false,
          proposedCommitment: {
            weekStart: '2026-08-10', daysCommitted: 4, dayTargets: null,
            minutesPerDay: 15, focus: null, source: 'rolled_forward',
          },
        },
      })
      if (body.kind !== 'cards') throw new Error('expected cards')
      expect(body.cards[body.cards.length - 1].kind).toBe('set')
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @kanji-learn/mobile test -- buddy-session-state --runInBand
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/lib/buddy-session-state.ts`:

```ts
// Pure card-sequence decision for the template-tier weekly session.
//
// Written as a pure function for the same reason journal-list-state.ts is:
// B-227 shipped a screen whose body states were not exhaustive, and the owner
// concluded the feature was unbuilt. Every state below is enumerated.

export interface SessionCommitment {
  weekStart: string
  daysCommitted: number
  dayTargets: number[] | null
  minutesPerDay: number
  focus: string | null
  source: 'session' | 'rolled_forward' | 'default'
}

export type SessionData =
  | { state: 'not_scheduled' }
  | { state: 'waiting'; nextDue: string }
  | {
      state: 'due'
      weekStart: string
      opener: { kind: string; text: string }
      reckon: string | null
      isFirstSession: boolean
      proposedCommitment: SessionCommitment
    }

export type SessionCard =
  | { kind: 'opener'; text: string }
  | { kind: 'reckon'; text: string }
  | { kind: 'set'; proposed: SessionCommitment }

export type SessionBody =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'not_scheduled' }
  | { kind: 'waiting'; nextDue: string }
  | { kind: 'cards'; cards: SessionCard[] }

export function selectSessionBody(input: {
  hasLoaded: boolean
  error: string | null
  data: SessionData | null
}): SessionBody {
  if (!input.hasLoaded) return { kind: 'loading' }
  if (input.error !== null) return { kind: 'error' }
  if (input.data === null) return { kind: 'error' }

  switch (input.data.state) {
    case 'not_scheduled':
      return { kind: 'not_scheduled' }
    case 'waiting':
      return { kind: 'waiting', nextDue: input.data.nextDue }
    case 'due': {
      const cards: SessionCard[] = [{ kind: 'opener', text: input.data.opener.text }]
      if (input.data.reckon !== null) {
        cards.push({ kind: 'reckon', text: input.data.reckon })
      }
      // 'set' is always last and always present: it is the session's one
      // guaranteed outcome (spec §4).
      cards.push({ kind: 'set', proposed: input.data.proposedCommitment })
      return { kind: 'cards', cards }
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @kanji-learn/mobile test -- buddy-session-state --runInBand
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/buddy-session-state.ts apps/mobile/test/buddy-session-state.test.ts
git commit -m "feat(mobile): pure card-sequence state for the weekly session"
```

---

### Task 11: Mobile — store, screen, and the settings control

**Files:**
- Create: `apps/mobile/src/stores/buddy.store.ts`
- Create: `apps/mobile/app/buddy-session.tsx`
- Modify: `apps/mobile/app/(tabs)/profile.tsx` (add the buddy-day picker)
- Test: `apps/mobile/test/components/BuddySessionBody.test.tsx`

**Interfaces:**
- Consumes: `selectSessionBody`, `SessionData` (Task 10); `apiFetch` from `src/lib/api`
- Produces: `useBuddyStore` with `{ hasLoaded, error, data, load(), commit(c) }`; route `/buddy-session`

- [ ] **Step 1: Write the store**

Create `apps/mobile/src/stores/buddy.store.ts`, mirroring `placement.store.ts`:

```ts
import { create } from 'zustand'
import { apiFetch } from '../lib/api'
import type { SessionCommitment, SessionData } from '../lib/buddy-session-state'

interface BuddyState {
  hasLoaded: boolean
  error: string | null
  data: SessionData | null
  load: () => Promise<void>
  commit: (c: SessionCommitment) => Promise<void>
}

export const useBuddyStore = create<BuddyState>((set, get) => ({
  hasLoaded: false,
  error: null,
  data: null,

  load: async () => {
    set({ hasLoaded: false, error: null })
    try {
      const res = await apiFetch('/v1/buddy/session')
      set({ hasLoaded: true, data: res.data, error: null })
    } catch (e) {
      set({ hasLoaded: true, error: e instanceof Error ? e.message : 'Failed to load', data: null })
    }
  },

  commit: async (c) => {
    await apiFetch('/v1/buddy/session/commitment', {
      method: 'POST',
      body: JSON.stringify({
        weekStart: c.weekStart,
        daysCommitted: c.daysCommitted,
        minutesPerDay: c.minutesPerDay,
        dayTargets: c.dayTargets,
        focus: c.focus,
      }),
    })
    await get().load()
  },
}))
```

- [ ] **Step 2: Write the failing component test**

Create `apps/mobile/test/components/BuddySessionBody.test.tsx`, mirroring
`OfflineBanner.test.tsx`:

```tsx
import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { BuddySessionBody } from '../../src/components/buddy/BuddySessionBody'

describe('BuddySessionBody', () => {
  it('renders a loading state rather than nothing (B-227)', () => {
    render(<BuddySessionBody body={{ kind: 'loading' }} onCommit={() => {}} />)
    expect(screen.getByTestId('buddy-session-loading')).toBeTruthy()
  })

  it('renders the opener and the set card for a due session', () => {
    render(
      <BuddySessionBody
        body={{
          kind: 'cards',
          cards: [
            { kind: 'opener', text: 'Nice — 4 days this week.' },
            {
              kind: 'set',
              proposed: {
                weekStart: '2026-08-10', daysCommitted: 4, dayTargets: null,
                minutesPerDay: 15, focus: null, source: 'rolled_forward',
              },
            },
          ],
        }}
        onCommit={() => {}}
      />
    )
    expect(screen.getByText('Nice — 4 days this week.')).toBeTruthy()
    expect(screen.getByTestId('buddy-session-set')).toBeTruthy()
  })

  it('renders an empty-but-explained state when no appointment is set', () => {
    render(<BuddySessionBody body={{ kind: 'not_scheduled' }} onCommit={() => {}} />)
    expect(screen.getByTestId('buddy-session-not-scheduled')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

```bash
pnpm --filter @kanji-learn/mobile test:components
```

Expected: FAIL — cannot resolve `BuddySessionBody`.

- [ ] **Step 4: Write the component**

Create `apps/mobile/src/components/buddy/BuddySessionBody.tsx`:

```tsx
import React from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import type { SessionBody, SessionCommitment } from '../../lib/buddy-session-state'

export function BuddySessionBody({
  body,
  onCommit,
}: {
  body: SessionBody
  onCommit: (c: SessionCommitment) => void
}) {
  switch (body.kind) {
    case 'loading':
      return (
        <View testID="buddy-session-loading">
          <ActivityIndicator />
        </View>
      )
    case 'error':
      return (
        <View testID="buddy-session-error">
          <Text>Couldn't reach Buddy just now. Your week is still set.</Text>
        </View>
      )
    case 'not_scheduled':
      return (
        <View testID="buddy-session-not-scheduled">
          <Text>No weekly catch-up scheduled. Pick a day in Profile and we'll start.</Text>
        </View>
      )
    case 'waiting':
      return (
        <View testID="buddy-session-waiting">
          <Text>Next catch-up: {body.nextDue}</Text>
        </View>
      )
    case 'cards':
      return (
        <View testID="buddy-session-cards">
          {body.cards.map((card, i) => {
            if (card.kind === 'set') {
              return (
                <View key={i} testID="buddy-session-set">
                  <Text>
                    {card.proposed.daysCommitted} days, {card.proposed.minutesPerDay} minutes
                  </Text>
                  <Pressable
                    testID="buddy-session-confirm"
                    onPress={() => onCommit({ ...card.proposed, source: 'session' })}
                  >
                    <Text>That works</Text>
                  </Pressable>
                </View>
              )
            }
            return <Text key={i}>{card.text}</Text>
          })}
        </View>
      )
  }
}
```

- [ ] **Step 5: Run the component test to verify it passes**

```bash
pnpm --filter @kanji-learn/mobile test:components
```

Expected: PASS — 2 suites (the existing `OfflineBanner` plus this one).

- [ ] **Step 6: Wire the screen**

Create `apps/mobile/app/buddy-session.tsx`:

```tsx
import React, { useEffect } from 'react'
import { SafeAreaView } from 'react-native'
import { useBuddyStore } from '../src/stores/buddy.store'
import { selectSessionBody } from '../src/lib/buddy-session-state'
import { BuddySessionBody } from '../src/components/buddy/BuddySessionBody'

export default function BuddySessionScreen() {
  const { hasLoaded, error, data, load, commit } = useBuddyStore()

  useEffect(() => { void load() }, [load])

  return (
    <SafeAreaView>
      <BuddySessionBody
        body={selectSessionBody({ hasLoaded, error, data })}
        onCommit={(c) => { void commit(c) }}
      />
    </SafeAreaView>
  )
}
```

- [ ] **Step 7: Add the buddy-day picker to Profile**

In `apps/mobile/app/(tabs)/profile.tsx`, beside the existing rest-day control,
add a weekday picker writing `buddyDay` and a weekly/fortnightly toggle writing
`buddyIntervalWeeks`, both via the existing `PATCH /v1/user/profile` path.
Follow whatever control pattern `restDay` already uses in that file — do not
introduce a new one.

Add `buddyDay` and `buddyIntervalWeeks` to the profile PATCH schema in
`apps/api/src/routes/user-profile.schema.ts`:

```ts
  buddyDay: z.number().int().min(0).max(6).nullable().optional(),
  buddyIntervalWeeks: z.number().int().min(1).max(2).optional(),
```

- [ ] **Step 8: Run both mobile lanes and typecheck**

```bash
pnpm --filter @kanji-learn/mobile test -- --runInBand
pnpm --filter @kanji-learn/mobile test:components
pnpm --filter @kanji-learn/mobile typecheck
```

Expected: all pass. Pure-lane baseline was 144; expect 144 + 7.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/stores/buddy.store.ts apps/mobile/src/components/buddy/BuddySessionBody.tsx apps/mobile/app/buddy-session.tsx apps/mobile/app/\(tabs\)/profile.tsx apps/mobile/test/components/BuddySessionBody.test.tsx apps/api/src/routes/user-profile.schema.ts
git commit -m "feat(mobile): weekly session screen and buddy-day settings"
```

---

### Task 12: Full verification and deploy notes

**Files:**
- Modify: `docs/HANDOFF.md` (new section at the top)

- [ ] **Step 1: Rebuild the local test DB, then run everything**

```bash
pnpm --filter @kanji-learn/shared test
pnpm --filter @kanji-learn/api test
pnpm --filter @kanji-learn/mobile test -- --runInBand
pnpm --filter @kanji-learn/mobile test:components
pnpm -r typecheck
```

Record actual numbers. Known pre-existing API failures are `rls-coverage`,
`user-delete`, and `learner-state-refresh` — **if `user-delete` fails, check
whether it is the pre-existing failure or Task 9's new assertion** before
assuming either.

- [ ] **Step 2: Confirm the route is not swallowed**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/v1/buddy/session
```

Expected: `401`, not `404`. A `404` means the route did not register; a `200`
means auth is not applied.

- [ ] **Step 3: Write the deploy sequence into `docs/HANDOFF.md`**

The order is forced:

| | Step | Why here |
|---|---|---|
| 1 | Apply migration `0030` to live | the API reads `buddy_commitments`; deploying first means 500s |
| 2 | Deploy API | — |
| 3 | Verify **by content**, not status code | `GET /v1/buddy/session` returns a body containing `state` — `docs/SOP.md` |
| 4 | EAS build + submit | mobile calls the new endpoints |
| 5 | Device walkthrough | the `buddy_day` push has never fired on a device |

Note explicitly that **the hourly `/internal/daily-reminders` Lambda now also
runs the buddy-day pass** — no EventBridge change is needed, and that is
deliberate.

- [ ] **Step 4: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "docs(handoff): slice 1 shipped, with the forced deploy sequence"
```

---

## Self-Review

**Spec coverage (Slice 1 only).** §5.1 columns and tables → Task 1. `method` and
`experiment_until` carried but not offered → Task 1 (schema); no behaviour, as
specified. Roll-forward → Tasks 2, 6, 8. Appointment window and step-down →
Tasks 3, 8. Promise check and opener → Task 4. Template copy → Task 5.
Endpoints → Task 7. Push → Task 8. Deletion → Task 9. Screen → Tasks 10, 11.
Timezone hazard (§8.5) → Task 8 with a control assertion. Guard-tests-must-fail
(§9) → Tasks 4, 6, 8.

**Deliberately absent, and correctly so:** parked topics, learner facts,
trajectory and frontier checks, escalation, the connection engine, per-dimension
drill — all slice 2 or 3.

**One gap I could not close from here:** whether `buddy_day` should be offered
during onboarding is §11 open item 3 in the spec, still unanswered. Slice 1
therefore has **no path that sets `buddy_day` except the Profile screen**
(Task 11 Step 7). That is a working, shippable state — the appointment is
opt-in — but it means a new learner will not encounter the feature unless they
go looking. Resolve item 3 before slice 2, which is where the first session
matters.
