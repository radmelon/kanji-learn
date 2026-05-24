# Buddy Phase 1' — BuddyCard Delivery Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first user-visible Buddy slice — `BuddyCard` rendered on Dashboard / Study Ready / Progress, driven by a server-side rule engine that produces one streak-milestone nudge and one Meet Buddy intro card, with Expo push delivery when a milestone trips during an active session.

**Architecture:** Pull-on-demand GET + event-time push trigger. `nudge.service.ts` has two entry points: `evaluateNudgesForScreen(userId, screen)` (called by `GET /v1/buddy/nudges`) and `maybeFireMilestoneNudges(userId, newState)` (called from Phase 0a's `setImmediate` chain in `submitReview` after `LearnerStateService.refreshState`). Dedupe via two partial unique indexes on `buddy_nudges`. The same `BuddyNudge` row drives both in-app render and push payload.

**Tech Stack:** Drizzle ORM, PostgreSQL (Supabase), Fastify, Vitest, TypeScript on the server; React Native + Expo on mobile. Reuses Phase 0a's `LearnerStateService`, the live LLM router (not used in v1 but adjacent), and `notification.service.ts` (extended with one new method).

**Spec reference:** [`../specs/2026-05-24-buddy-phase-1-prime-design.md`](../specs/2026-05-24-buddy-phase-1-prime-design.md).

**Co-author convention:** Every commit in this repo includes both `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` and `Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>`.

---

## File Structure

| Path | Action | Purpose |
|---|---|---|
| `packages/db/supabase/migrations/0025_buddy_nudges_dedupe_indexes.sql` | Create | Two partial unique indexes (streak dedupe + meet-buddy dedupe) |
| `apps/api/src/services/buddy/templates/streak.ts` | Create | Streak milestone → content string map |
| `apps/api/src/services/buddy/templates/meet-buddy.ts` | Create | Meet Buddy intro content |
| `apps/api/src/services/buddy/nudge.service.ts` | Create | Rule engine — `evaluateNudgesForScreen` + `maybeFireMilestoneNudges` |
| `apps/api/src/services/notification.service.ts` | Modify | Add `sendBuddyNudgePush(userId, nudge)` method |
| `apps/api/src/services/srs.service.ts` | Modify (~line 469) | Chain `maybeFireMilestoneNudges` into the post-commit `setImmediate` |
| `apps/api/src/routes/buddy-nudges.ts` | Create | GET nudges + POST dismiss |
| `apps/api/src/server.ts` | Modify | Instantiate `NudgeService`, decorate, register route |
| `apps/api/src/routes/review.ts` | Modify (~line 39) | Pass `server.nudgeService` to `new SrsService(...)` |
| `apps/api/test/integration/nudge-rule-engine.test.ts` | Create | Rule engine integration tests |
| `apps/api/test/integration/buddy-nudges-route.test.ts` | Create | API route tests |
| `apps/api/test/integration/buddy-push-trigger.test.ts` | Create | Push path integration test |
| `apps/api/test/integration/srs-dual-write.test.ts` | Modify | Add `nudgeService` to `SrsService` instantiation |
| `apps/api/test/integration/srs-maybe-slipping.test.ts` | Modify | Same |
| `apps/api/test/integration/phase0-smoke.test.ts` | Modify | Same |
| `apps/mobile/src/components/buddy/BuddyCard.tsx` | Create | Single nudge row component (neutral-soft visual) |
| `apps/mobile/src/components/buddy/BuddyCardStack.tsx` | Create | Per-screen wrapper — calls `useBuddyNudges`, renders ≤2 cards |
| `apps/mobile/src/hooks/useBuddyNudges.ts` | Create | Mobile hook, mirrors `useInterventions` pattern |
| `apps/mobile/app/(tabs)/index.tsx` | Modify (~line 340) | Insert `<BuddyCardStack screen="dashboard" />` after SrsStatusBar |
| `apps/mobile/src/components/study/ReadyScreen.tsx` | Modify (~line 50) | Insert `<BuddyCardStack screen="study-ready" />` above Begin button |
| `apps/mobile/app/(tabs)/progress.tsx` | Modify (~line 280) | Insert `<BuddyCardStack screen="progress" />` above Activity section |

**Operator steps (no file changes):**
- Apply `0025_buddy_nudges_dedupe_indexes.sql` to the live DB via `psql`
- Deploy API via `./scripts/deploy-api.sh`
- Cut + submit EAS iOS build (B136 by EAS auto-bump)
- Smoke + closeout

---

## Task 1: Migration `0025_buddy_nudges_dedupe_indexes.sql`

**Files:**
- Create: `packages/db/supabase/migrations/0025_buddy_nudges_dedupe_indexes.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Migration 0025: Partial unique indexes on buddy_nudges for dedupe.
--
-- Phase 1' adds two rule-engine entry points that insert buddy_nudges rows.
-- Without these indexes, concurrent requests can race and produce duplicate
-- rows for the same logical event. With them, INSERT ... ON CONFLICT DO
-- NOTHING is sufficient — the DB enforces single-row-per-event semantics.
--
-- Streak nudges dedupe on (user, screen, milestone) — mirror rows on
-- Dashboard and Study Ready are independent, each dismissable separately.
--
-- Meet Buddy is one row per user, forever — once dismissed, never returns.

BEGIN;

CREATE UNIQUE INDEX buddy_nudges_streak_dedupe
  ON buddy_nudges (user_id, screen, (action_payload->>'milestone'))
  WHERE nudge_type = 'streak';

CREATE UNIQUE INDEX buddy_nudges_meet_buddy_dedupe
  ON buddy_nudges (user_id)
  WHERE nudge_type = 'encouragement' AND action_payload->>'kind' = 'meet_buddy';

COMMIT;
```

- [ ] **Step 2: Apply to local test DB**

```bash
PGPASSWORD=kanji psql -h localhost -p 5433 -U kanji -d kanji_buddy_test \
  -f packages/db/supabase/migrations/0025_buddy_nudges_dedupe_indexes.sql
```

Expected: two `CREATE INDEX` statements + `COMMIT`. No errors.

- [ ] **Step 3: Verify indexes exist**

```bash
PGPASSWORD=kanji psql -h localhost -p 5433 -U kanji -d kanji_buddy_test \
  -c "\d buddy_nudges" | grep -E "streak_dedupe|meet_buddy_dedupe"
```

Expected: two rows, one for each new index.

- [ ] **Step 4: Run the full integration test suite to confirm no regression**

```bash
pnpm --filter=@kanji-learn/api test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/db/supabase/migrations/0025_buddy_nudges_dedupe_indexes.sql
git commit -m "$(cat <<'EOF'
feat(db): migration 0025 — buddy_nudges dedupe partial unique indexes

Two partial unique indexes prevent duplicate buddy_nudges rows from
concurrent INSERTs in the Phase 1' rule engine. Streak dedupes on
(user, screen, milestone) — Dashboard + Study Ready mirror rows are
independent. Meet Buddy dedupes per user — one card forever.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 2: Content templates

**Files:**
- Create: `apps/api/src/services/buddy/templates/streak.ts`
- Create: `apps/api/src/services/buddy/templates/meet-buddy.ts`

- [ ] **Step 1: Create the streak template module**

`apps/api/src/services/buddy/templates/streak.ts`:

```typescript
// apps/api/src/services/buddy/templates/streak.ts
//
// Streak milestone → content string map. Phase 1' is template-only;
// voice/persona lands in Phase 5 alongside the mnemonic co-creation
// work. Editing these strings only requires an API deploy (no mobile
// rebuild). When we have ≥3 nudge types or non-engineers want to
// iterate on copy, this map moves to a `nudge_templates` DB table
// (Phase 1' design spec §7.1).

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 90, 100, 180, 365] as const
export type StreakMilestone = (typeof STREAK_MILESTONES)[number]

const CONTENT: Record<StreakMilestone, string> = {
  3: "Day 3. You're getting into a rhythm.",
  7: 'A full week. Buddy noticed.',
  14: 'Two weeks. The hardest part of habit-building is behind you.',
  30: '30-day streak. This is what consistency looks like.',
  60: '60 days. Whatever you’re doing, keep doing it.',
  90: "90 days. That's a season.",
  100: '100 days. Quietly remarkable.',
  180: 'Half a year. Most people quit before now.',
  365: "A year of kanji. Buddy's proud.",
}

export function streakContent(milestone: StreakMilestone): string {
  return CONTENT[milestone]
}

export function isStreakMilestone(day: number): day is StreakMilestone {
  return (STREAK_MILESTONES as readonly number[]).includes(day)
}
```

- [ ] **Step 2: Create the Meet Buddy template module**

`apps/api/src/services/buddy/templates/meet-buddy.ts`:

```typescript
// apps/api/src/services/buddy/templates/meet-buddy.ts
//
// One-time intro card for existing TestFlight users on first launch
// after Phase 1' deploys. Foreshadows the additional functionality
// landing in subsequent phases.

export const MEET_BUDDY_CONTENT =
  "Hi, I'm Buddy. I'll notice when you're crushing it and when " +
  "you're slipping. Soon I'll help build mnemonics, explain readings, " +
  "and route practice when a kanji's giving you trouble. " +
  'For now, just saying hello.'
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean modulo pre-existing `social-mute.test.ts:25` error.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/buddy/templates/
git commit -m "$(cat <<'EOF'
feat(buddy): template content for Phase 1' nudges

Streak milestone copy (9 day-landmarks) + Meet Buddy intro string.
Phase 1' is template-only; Phase 5 settles voice and re-skins.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 3: `NudgeService` skeleton + streak rule (TDD)

**Files:**
- Create: `apps/api/src/services/buddy/nudge.service.ts` (skeleton)
- Create: `apps/api/test/integration/nudge-rule-engine.test.ts` (failing tests)

- [ ] **Step 1: Write the first failing test — streak milestone match**

Create `apps/api/test/integration/nudge-rule-engine.test.ts`:

```typescript
// apps/api/test/integration/nudge-rule-engine.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { NudgeService } from '../../src/services/buddy/nudge.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER_A = '00000000-0000-0000-0000-0000000000b1'

// Stub NotificationService — never fires real push in these tests.
const stubNotifier = { sendBuddyNudgePush: async () => {} } as any

beforeAll(async () => {
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES (${USER_A}, 'NudgeRuleTest', 'UTC') ON CONFLICT DO NOTHING
  `)
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM buddy_nudges WHERE user_id = ${USER_A}`)
  await db.execute(sql`DELETE FROM learner_state_cache WHERE user_id = ${USER_A}`)
})

afterAll(async () => {
  await client.end()
})

async function seedCacheState(streakDays: number) {
  await db.execute(sql`
    INSERT INTO learner_state_cache
      (user_id, updated_at, current_streak_days, longest_streak_days,
       velocity_trend, total_kanji_seen, total_kanji_burned, active_leech_count,
       leech_kanji_ids, weakest_modality, recent_accuracy,
       avg_daily_reviews, avg_session_duration_ms, days_since_last_session,
       days_since_first_session, quiz_vs_srs_gap_high, recent_milestones,
       study_patterns, buddy_mood, scaffold_level, friends_count,
       active_friends_today, friends_ahead_on_burn, friends_behind_on_burn,
       friends_ahead_on_streak, friends_behind_on_streak,
       user_strengths_vs_friends, device_distribution)
    VALUES (${USER_A}, NOW(), ${streakDays}, ${streakDays},
      'steady', 100, 10, 0, '[]'::jsonb, 'meaning', 0.85,
      5, 120000, 0, 30, false, '[]'::jsonb, '{}'::jsonb,
      'supportive', 'medium', 0, 0,
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      '{}'::jsonb, '{}'::jsonb)
    ON CONFLICT (user_id) DO UPDATE SET current_streak_days = EXCLUDED.current_streak_days
  `)
}

describe('NudgeService — streak rule', () => {
  it('inserts a streak row and returns it on milestone day (pull path)', async () => {
    await seedCacheState(7)
    const service = new NudgeService(db, stubNotifier)

    const nudges = await service.evaluateNudgesForScreen(USER_A, 'dashboard')

    expect(nudges).toHaveLength(1)
    expect(nudges[0]?.nudgeType).toBe('streak')
    expect((nudges[0]?.actionPayload as any)?.milestone).toBe(7)
    expect(nudges[0]?.content).toBe('A full week. Buddy noticed.')
  })
})
```

- [ ] **Step 2: Run the test — expect FAIL**

```bash
pnpm --filter=@kanji-learn/api test nudge-rule-engine
```

Expected: FAIL with "Cannot find module '../../src/services/buddy/nudge.service'".

- [ ] **Step 3: Create the NudgeService skeleton with the streak rule**

Create `apps/api/src/services/buddy/nudge.service.ts`:

```typescript
// apps/api/src/services/buddy/nudge.service.ts
//
// Phase 1' rule engine. Two public entry points:
//
//   - evaluateNudgesForScreen(userId, screen) — pull path, called by
//     GET /v1/buddy/nudges. Runs the rule check, lazily INSERTs, then
//     SELECTs and returns all currently-active rows for that screen.
//
//   - maybeFireMilestoneNudges(userId, newState) — push path, called
//     from srs.service.ts's setImmediate chain after a successful
//     review submission. INSERTs the Dashboard streak row and fires
//     Expo push exactly once per milestone.

import { and, eq, gt, isNull, sql, desc } from 'drizzle-orm'
import { buddyNudges, learnerStateCache } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import type { BuddyNudge, BuddyScreen } from '@kanji-learn/shared'
import type { NotificationService } from '../notification.service'
import { isStreakMilestone, streakContent, STREAK_MILESTONES } from './templates/streak'
import { MEET_BUDDY_CONTENT } from './templates/meet-buddy'

const STREAK_PRIORITY = 5
const MEET_BUDDY_PRIORITY = 10
const STREAK_EXPIRY_DAYS = 30
const MEET_BUDDY_EXPIRY_YEARS = 10

export class NudgeService {
  constructor(
    private readonly db: Db,
    private readonly notifier: NotificationService,
  ) {}

  /**
   * Pull path. Called by GET /v1/buddy/nudges.
   * Lazily inserts any nudges the rules dictate for (user, screen),
   * then returns all currently-active rows for that screen.
   */
  async evaluateNudgesForScreen(userId: string, screen: BuddyScreen): Promise<BuddyNudge[]> {
    // Run the rules; ignore returned rows (we re-SELECT below to include
    // any pre-existing rows the rule didn't touch).
    await this.maybeInsertStreak(userId, screen)
    if (screen === 'dashboard') await this.maybeInsertMeetBuddy(userId)

    const rows = await this.db
      .select()
      .from(buddyNudges)
      .where(
        and(
          eq(buddyNudges.userId, userId),
          eq(buddyNudges.screen, screen),
          isNull(buddyNudges.dismissedAt),
          gt(buddyNudges.expiresAt, sql`NOW()`),
        ),
      )
      .orderBy(desc(buddyNudges.priority), desc(buddyNudges.createdAt))
      .limit(2)

    return rows as unknown as BuddyNudge[]
  }

  private async maybeInsertStreak(userId: string, screen: BuddyScreen): Promise<void> {
    if (screen !== 'dashboard' && screen !== 'study') return

    const cache = await this.db.query.learnerStateCache.findFirst({
      where: eq(learnerStateCache.userId, userId),
    })
    if (!cache) return

    const days = cache.currentStreakDays
    if (!isStreakMilestone(days)) return

    const expiresAt = new Date(Date.now() + STREAK_EXPIRY_DAYS * 86_400_000)
    await this.db
      .insert(buddyNudges)
      .values({
        userId,
        screen,
        nudgeType: 'streak',
        content: streakContent(days),
        actionType: 'dismiss',
        actionPayload: { kind: 'streak_milestone', milestone: days },
        priority: STREAK_PRIORITY,
        deliveryTarget: 'all',
        expiresAt,
        generatedBy: 'template',
        socialFraming: false,
      })
      .onConflictDoNothing()
  }

  private async maybeInsertMeetBuddy(userId: string): Promise<void> {
    const expiresAt = new Date(Date.now() + MEET_BUDDY_EXPIRY_YEARS * 365 * 86_400_000)
    await this.db
      .insert(buddyNudges)
      .values({
        userId,
        screen: 'dashboard',
        nudgeType: 'encouragement',
        content: MEET_BUDDY_CONTENT,
        actionType: 'dismiss',
        actionPayload: { kind: 'meet_buddy' },
        priority: MEET_BUDDY_PRIORITY,
        deliveryTarget: 'app',
        expiresAt,
        generatedBy: 'template',
        socialFraming: false,
      })
      .onConflictDoNothing()
  }

  /**
   * Push path. Called from srs.service.ts after a successful refresh.
   * Inserts the Dashboard streak row for any newly-tripped milestone
   * and fires push exactly once per milestone (the Study Ready mirror
   * is inserted by the pull path, without firing another push).
   */
  async maybeFireMilestoneNudges(
    userId: string,
    newState: { currentStreakDays: number },
  ): Promise<void> {
    const days = newState.currentStreakDays
    if (!isStreakMilestone(days)) return

    const expiresAt = new Date(Date.now() + STREAK_EXPIRY_DAYS * 86_400_000)
    const inserted = await this.db
      .insert(buddyNudges)
      .values({
        userId,
        screen: 'dashboard',
        nudgeType: 'streak',
        content: streakContent(days),
        actionType: 'dismiss',
        actionPayload: { kind: 'streak_milestone', milestone: days },
        priority: STREAK_PRIORITY,
        deliveryTarget: 'all',
        expiresAt,
        generatedBy: 'template',
        socialFraming: false,
      })
      .onConflictDoNothing()
      .returning()

    if (inserted.length > 0) {
      await this.notifier.sendBuddyNudgePush(userId, inserted[0] as unknown as BuddyNudge)
    }
  }
}
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
pnpm --filter=@kanji-learn/api test nudge-rule-engine
```

Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/buddy/nudge.service.ts apps/api/test/integration/nudge-rule-engine.test.ts
git commit -m "$(cat <<'EOF'
feat(buddy): NudgeService skeleton + streak rule (pull path)

Two-entry-point rule engine for Phase 1':
- evaluateNudgesForScreen — pull path called by GET endpoint
- maybeFireMilestoneNudges — push path hooked into Phase 0a's
  setImmediate chain (wired in a later task)

Streak rule: reads learner_state_cache.currentStreakDays, inserts a
row when on a milestone day, dedupes via the partial unique index
from migration 0025. ON CONFLICT DO NOTHING handles concurrent races.

First TDD test green: streak milestone day → returns the row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 4: Streak rule — full test coverage

**Files:**
- Modify: `apps/api/test/integration/nudge-rule-engine.test.ts`

- [ ] **Step 1: Add the remaining streak tests + Meet Buddy tests**

Append to `apps/api/test/integration/nudge-rule-engine.test.ts` inside the existing `describe('NudgeService — streak rule', ...)`:

```typescript
  it('returns empty on a non-milestone day', async () => {
    await seedCacheState(5)
    const service = new NudgeService(db, stubNotifier)
    const nudges = await service.evaluateNudgesForScreen(USER_A, 'dashboard')
    expect(nudges).toHaveLength(0)
  })

  it('dedupes: a second evaluate on the same milestone returns the same single row', async () => {
    await seedCacheState(7)
    const service = new NudgeService(db, stubNotifier)
    const first = await service.evaluateNudgesForScreen(USER_A, 'dashboard')
    const second = await service.evaluateNudgesForScreen(USER_A, 'dashboard')
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(first[0]?.id).toBe(second[0]?.id)
  })

  it('inserts mirror row on Study Ready independently', async () => {
    await seedCacheState(7)
    const service = new NudgeService(db, stubNotifier)
    const dashRows = await service.evaluateNudgesForScreen(USER_A, 'dashboard')
    const studyRows = await service.evaluateNudgesForScreen(USER_A, 'study')
    expect(dashRows).toHaveLength(1)
    expect(studyRows).toHaveLength(1)
    expect(dashRows[0]?.id).not.toBe(studyRows[0]?.id)
  })

  it('does NOT fire on the Progress screen', async () => {
    await seedCacheState(7)
    const service = new NudgeService(db, stubNotifier)
    const rows = await service.evaluateNudgesForScreen(USER_A, 'progress')
    expect(rows).toHaveLength(0)
  })

  it('handles concurrent inserts cleanly (partial unique index enforces dedupe)', async () => {
    await seedCacheState(7)
    const service = new NudgeService(db, stubNotifier)
    const [a, b] = await Promise.all([
      service.evaluateNudgesForScreen(USER_A, 'dashboard'),
      service.evaluateNudgesForScreen(USER_A, 'dashboard'),
    ])
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(a[0]?.id).toBe(b[0]?.id)
  })
})

describe('NudgeService — Meet Buddy rule', () => {
  it('inserts a meet-buddy row on first dashboard request', async () => {
    await seedCacheState(0)
    const service = new NudgeService(db, stubNotifier)
    const rows = await service.evaluateNudgesForScreen(USER_A, 'dashboard')
    expect(rows.some((r) => r.nudgeType === 'encouragement')).toBe(true)
  })

  it('dedupes meet-buddy across requests', async () => {
    await seedCacheState(0)
    const service = new NudgeService(db, stubNotifier)
    await service.evaluateNudgesForScreen(USER_A, 'dashboard')
    const second = await service.evaluateNudgesForScreen(USER_A, 'dashboard')
    const mb = second.filter((r) => r.nudgeType === 'encouragement')
    expect(mb).toHaveLength(1)
  })

  it('does NOT fire on Study Ready or Progress', async () => {
    await seedCacheState(0)
    const service = new NudgeService(db, stubNotifier)
    const study = await service.evaluateNudgesForScreen(USER_A, 'study')
    const progress = await service.evaluateNudgesForScreen(USER_A, 'progress')
    expect(study.some((r) => r.nudgeType === 'encouragement')).toBe(false)
    expect(progress.some((r) => r.nudgeType === 'encouragement')).toBe(false)
  })

  it('stack priority: Meet Buddy comes before streak on Dashboard', async () => {
    await seedCacheState(7)
    const service = new NudgeService(db, stubNotifier)
    const rows = await service.evaluateNudgesForScreen(USER_A, 'dashboard')
    expect(rows[0]?.nudgeType).toBe('encouragement')
    expect(rows[1]?.nudgeType).toBe('streak')
  })
})
```

- [ ] **Step 2: Run the tests — expect all PASS**

```bash
pnpm --filter=@kanji-learn/api test nudge-rule-engine
```

Expected: 9 passing.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/integration/nudge-rule-engine.test.ts
git commit -m "$(cat <<'EOF'
test(buddy): full coverage for NudgeService streak + Meet Buddy rules

9 tests pinning rule-engine behavior:
- streak on milestone / non-milestone / dedupe / mirror / Progress no-op / concurrent
- meet-buddy first insert / dedupe / Dashboard-only / priority stacking

Stub notifier (no push assertions here — Task 8 covers the push path).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 5: API routes — GET + dismiss

**Files:**
- Create: `apps/api/src/routes/buddy-nudges.ts`
- Create: `apps/api/test/integration/buddy-nudges-route.test.ts`
- Modify: `apps/api/src/server.ts` (instantiate NudgeService, decorate, register route)

- [ ] **Step 1: Write the failing route tests**

Create `apps/api/test/integration/buddy-nudges-route.test.ts`:

```typescript
// apps/api/test/integration/buddy-nudges-route.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { buildServer } from '../../src/server'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER_A = '00000000-0000-0000-0000-0000000000c1'
let app: Awaited<ReturnType<typeof buildServer>>
let token: string

beforeAll(async () => {
  app = await buildServer()
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES (${USER_A}, 'NudgeRouteTest', 'UTC') ON CONFLICT DO NOTHING
  `)
  // Mint a JWT for the test user — mirror whatever helper pattern other
  // route tests use (see e.g. report-route.test.ts or interventions
  // tests). For now, use the @fastify/jwt instance the app already wires.
  token = app.jwt.sign({ sub: USER_A })
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM buddy_nudges WHERE user_id = ${USER_A}`)
  await db.execute(sql`DELETE FROM learner_state_cache WHERE user_id = ${USER_A}`)
})

afterAll(async () => {
  await app.close()
  await client.end()
})

describe('GET /v1/buddy/nudges', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/buddy/nudges?screen=dashboard' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 on missing screen query param', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/buddy/nudges',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 on invalid screen value', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/buddy/nudges?screen=bogus',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns an array (possibly empty) on valid auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/buddy/nudges?screen=dashboard',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
  })
})

describe('POST /v1/buddy/nudges/:id/dismiss', () => {
  async function seedDashboardMeetBuddy(): Promise<string> {
    const expiresAt = new Date(Date.now() + 365 * 86_400_000).toISOString()
    const row = await db.execute(sql`
      INSERT INTO buddy_nudges
        (user_id, screen, nudge_type, content, action_type, action_payload,
         priority, delivery_target, expires_at, generated_by, social_framing)
      VALUES (${USER_A}, 'dashboard', 'encouragement', 'hi', 'dismiss',
        '{"kind":"meet_buddy"}'::jsonb, 10, 'app', ${expiresAt}, 'template', false)
      RETURNING id
    `)
    return (row as unknown as Array<{ id: string }>)[0].id
  }

  it('marks dismissed_at and returns 200', async () => {
    const id = await seedDashboardMeetBuddy()
    const res = await app.inject({
      method: 'POST',
      url: `/v1/buddy/nudges/${id}/dismiss`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const after = await db.execute(
      sql`SELECT dismissed_at FROM buddy_nudges WHERE id = ${id}`,
    )
    const rows = after as unknown as Array<{ dismissed_at: string | null }>
    expect(rows[0].dismissed_at).not.toBeNull()
  })

  it('is idempotent (second dismiss is 200, dismissed_at unchanged)', async () => {
    const id = await seedDashboardMeetBuddy()
    await app.inject({
      method: 'POST', url: `/v1/buddy/nudges/${id}/dismiss`,
      headers: { authorization: `Bearer ${token}` },
    })
    const firstRows = (await db.execute(
      sql`SELECT dismissed_at FROM buddy_nudges WHERE id = ${id}`,
    )) as unknown as Array<{ dismissed_at: string }>
    const firstTs = firstRows[0].dismissed_at

    const res = await app.inject({
      method: 'POST', url: `/v1/buddy/nudges/${id}/dismiss`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const secondRows = (await db.execute(
      sql`SELECT dismissed_at FROM buddy_nudges WHERE id = ${id}`,
    )) as unknown as Array<{ dismissed_at: string }>
    expect(secondRows[0].dismissed_at).toBe(firstTs)
  })

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/buddy/nudges/00000000-0000-0000-0000-000000000000/dismiss`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 dismissing another user’s nudge', async () => {
    const id = await seedDashboardMeetBuddy()
    const otherToken = app.jwt.sign({ sub: '00000000-0000-0000-0000-0000000000c9' })
    const res = await app.inject({
      method: 'POST',
      url: `/v1/buddy/nudges/${id}/dismiss`,
      headers: { authorization: `Bearer ${otherToken}` },
    })
    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 2: Run the tests — expect FAIL**

```bash
pnpm --filter=@kanji-learn/api test buddy-nudges-route
```

Expected: FAIL — route not registered yet (404 on every endpoint).

- [ ] **Step 3: Create the route file**

Create `apps/api/src/routes/buddy-nudges.ts`:

```typescript
// apps/api/src/routes/buddy-nudges.ts
import { z } from 'zod'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { buddyNudges } from '@kanji-learn/db'
import type { FastifyInstance } from 'fastify'

const SCREEN_ENUM = z.enum(['dashboard', 'study', 'progress'])
const ID_PARAM = z.object({ id: z.string().uuid() })

export async function buddyNudgesRoutes(server: FastifyInstance) {
  // GET /v1/buddy/nudges?screen=...
  server.get('/', { preHandler: server.authenticate }, async (request, reply) => {
    const parsed = z.object({ screen: SCREEN_ENUM }).safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid screen' })

    const userId = (request.user as { sub: string }).sub
    const nudges = await server.nudgeService.evaluateNudgesForScreen(userId, parsed.data.screen)
    return reply.send({ data: nudges })
  })

  // POST /v1/buddy/nudges/:id/dismiss
  server.post('/:id/dismiss', { preHandler: server.authenticate }, async (request, reply) => {
    const parsed = ID_PARAM.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid id' })

    const userId = (request.user as { sub: string }).sub

    // Idempotent: only update if not already dismissed; either way return 200
    // if the row belongs to the user. 404 if no such row for this user.
    const updated = await server.db
      .update(buddyNudges)
      .set({ dismissedAt: sql`COALESCE(${buddyNudges.dismissedAt}, NOW())` })
      .where(and(eq(buddyNudges.id, parsed.data.id), eq(buddyNudges.userId, userId)))
      .returning({ id: buddyNudges.id })

    if (updated.length === 0) return reply.code(404).send({ error: 'not found' })
    return reply.send({ ok: true })
  })
}
```

- [ ] **Step 4: Wire `NudgeService` into `server.ts`**

Modify `apps/api/src/server.ts`:

Add to the imports at the top (around line 16):

```typescript
import { NudgeService } from './services/buddy/nudge.service.js'
import { buddyNudgesRoutes } from './routes/buddy-nudges.js'
```

Add to the instantiation block (around line 113, near other service constructions):

```typescript
const nudgeService = new NudgeService(db, notificationService)
```

Note: this requires `notificationService` to exist in scope. Confirm at edit time; if it's not already instantiated, instantiate it here (it's likely already there for daily reminders / mate alerts).

Add to the decoration block (around line 136):

```typescript
server.decorate('nudgeService', nudgeService)
```

Update the Fastify type augmentation (likely in `apps/api/src/types/fastify.d.ts` or inline in `server.ts`):

```typescript
declare module 'fastify' {
  interface FastifyInstance {
    nudgeService: NudgeService
  }
}
```

(If the existing pattern uses a single types file with all decorations, add the property there alongside `dualWrite` and `learnerState`.)

Add to the route registration block (around line 148, after `interventionRoutes`):

```typescript
  await server.register(buddyNudgesRoutes, { prefix: '/v1/buddy/nudges' })
```

- [ ] **Step 5: Run the tests — expect PASS**

```bash
pnpm --filter=@kanji-learn/api test buddy-nudges-route
```

Expected: 7 passing.

- [ ] **Step 6: Run the full integration suite — verify no regression**

```bash
pnpm --filter=@kanji-learn/api test
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/buddy-nudges.ts apps/api/src/server.ts apps/api/test/integration/buddy-nudges-route.test.ts
git commit -m "$(cat <<'EOF'
feat(buddy): API routes for Phase 1' — GET nudges + POST dismiss

GET /v1/buddy/nudges?screen=<dashboard|study|progress> — calls the
rule engine via NudgeService.evaluateNudgesForScreen, returns the
active nudges for that screen (max 2 by priority).

POST /v1/buddy/nudges/:id/dismiss — idempotent. 404 for unknown id
or cross-user attempts.

NudgeService decorated onto Fastify; the route uses it via
server.nudgeService.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 6: `NotificationService.sendBuddyNudgePush`

**Files:**
- Modify: `apps/api/src/services/notification.service.ts`

- [ ] **Step 1: Read the existing public methods**

Look at `sendToUserTokens(userId, message)` (around line 388) and `notifyStudyMates(...)` (around line 178) to confirm the Expo-client + dead-token-pruning pattern. The new method reuses `sendToUserTokens`.

- [ ] **Step 2: Add `sendBuddyNudgePush` to `NotificationService`**

Append to the class in `apps/api/src/services/notification.service.ts`:

```typescript
  /**
   * Fire an Expo push for a Buddy nudge. Phase 1' Task 6.
   *
   * Reuses sendToUserTokens for the Expo client + dead-token pruning.
   * Sets buddy_nudges.push_delivered_at after Expo resolves (success or
   * logged failure — "we tried"). Errors never propagate; this is
   * called fire-and-forget from the setImmediate chain in submitReview.
   */
  async sendBuddyNudgePush(userId: string, nudge: BuddyNudge): Promise<void> {
    try {
      await this.sendToUserTokens(userId, {
        title: 'Kanji Buddy',
        body: nudge.content,
        data: {
          nudgeId: nudge.id,
          kind: 'buddy_nudge',
          screen: nudge.screen,
        },
      })
    } catch (err) {
      console.warn(`[BuddyPush] send failed for user ${userId} nudge ${nudge.id}:`, err)
    }

    // Mark "we tried" — success or failure — so daily metrics count it.
    try {
      await this.db
        .update(buddyNudges)
        .set({ pushDeliveredAt: new Date() })
        .where(eq(buddyNudges.id, nudge.id))
    } catch (err) {
      console.warn(`[BuddyPush] failed to set pushDeliveredAt for ${nudge.id}:`, err)
    }
  }
```

Add the necessary imports at the top of the file:

```typescript
import { buddyNudges } from '@kanji-learn/db'
import { eq } from 'drizzle-orm'
import type { BuddyNudge } from '@kanji-learn/shared'
```

(If `eq` and the `@kanji-learn/db` imports are already there, skip.)

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean modulo the pre-existing error.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/notification.service.ts
git commit -m "$(cat <<'EOF'
feat(buddy): NotificationService.sendBuddyNudgePush

New method on the existing service. Wraps sendToUserTokens with a
buddy-flavored Expo payload (title 'Kanji Buddy', body = nudge.content,
data carries nudgeId + screen for future deep-link routing).

Sets buddy_nudges.push_delivered_at after Expo resolves — success or
logged failure — so daily metrics can count attempts.

Fire-and-forget: errors are logged but never thrown. Caller (the
setImmediate chain in submitReview, Task 7) doesn't need to await
this for correctness.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 7: Wire `maybeFireMilestoneNudges` into the Phase 0a `setImmediate` chain

**Files:**
- Modify: `apps/api/src/services/srs.service.ts`
- Modify: `apps/api/src/routes/review.ts`
- Modify: `apps/api/test/integration/srs-dual-write.test.ts`
- Modify: `apps/api/test/integration/srs-maybe-slipping.test.ts`
- Modify: `apps/api/test/integration/phase0-smoke.test.ts`
- Create: `apps/api/test/integration/buddy-push-trigger.test.ts`

- [ ] **Step 1: Write the failing push-path test**

Create `apps/api/test/integration/buddy-push-trigger.test.ts`:

```typescript
// apps/api/test/integration/buddy-push-trigger.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { NudgeService } from '../../src/services/buddy/nudge.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER_A = '00000000-0000-0000-0000-0000000000d1'

beforeAll(async () => {
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES (${USER_A}, 'PushTriggerTest', 'UTC') ON CONFLICT DO NOTHING
  `)
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM buddy_nudges WHERE user_id = ${USER_A}`)
})

afterAll(async () => {
  await client.end()
})

describe('NudgeService.maybeFireMilestoneNudges (push path)', () => {
  it('inserts dashboard row + fires push on milestone day', async () => {
    const spy = vi.fn().mockResolvedValue(undefined)
    const notifier = { sendBuddyNudgePush: spy } as any
    const service = new NudgeService(db, notifier)

    await service.maybeFireMilestoneNudges(USER_A, { currentStreakDays: 30 })

    expect(spy).toHaveBeenCalledTimes(1)
    const inserted = await db.execute(
      sql`SELECT screen, nudge_type FROM buddy_nudges WHERE user_id = ${USER_A}`,
    )
    const rows = inserted as unknown as Array<{ screen: string; nudge_type: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0].screen).toBe('dashboard')
    expect(rows[0].nudge_type).toBe('streak')
  })

  it('does not fire on non-milestone days', async () => {
    const spy = vi.fn().mockResolvedValue(undefined)
    const notifier = { sendBuddyNudgePush: spy } as any
    const service = new NudgeService(db, notifier)

    await service.maybeFireMilestoneNudges(USER_A, { currentStreakDays: 4 })
    expect(spy).not.toHaveBeenCalled()
  })

  it('does not double-fire if milestone already recorded', async () => {
    const spy = vi.fn().mockResolvedValue(undefined)
    const notifier = { sendBuddyNudgePush: spy } as any
    const service = new NudgeService(db, notifier)

    await service.maybeFireMilestoneNudges(USER_A, { currentStreakDays: 30 })
    spy.mockClear()
    await service.maybeFireMilestoneNudges(USER_A, { currentStreakDays: 30 })

    expect(spy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — expect PASS already**

```bash
pnpm --filter=@kanji-learn/api test buddy-push-trigger
```

Expected: 3 passing. (The `maybeFireMilestoneNudges` method was implemented in Task 3 along with the rest of the service.)

If FAIL: the service logic in Task 3 is broken — fix it before continuing.

- [ ] **Step 3: Wire the trigger into `srs.service.ts`**

Modify `apps/api/src/services/srs.service.ts`. Add to the imports:

```typescript
import { NudgeService } from './buddy/nudge.service'
```

Update the constructor (was 3 args in Phase 0a, now 4):

```typescript
export class SrsService {
  constructor(
    private db: Db,
    private readonly dualWrite: DualWriteService,
    private readonly learnerState: LearnerStateService,
    private readonly nudgeService: NudgeService,
  ) {}
```

Update the `setImmediate` block inside `submitReview` (around line 469 — the Phase 0a wiring):

Replace:

```typescript
    setImmediate(() => {
      this.learnerState.refreshState(userId).catch((err) => {
        console.warn(`[LearnerState] refresh failed for user ${userId}:`, err)
      })
    })
```

With:

```typescript
    setImmediate(async () => {
      try {
        const newState = await this.learnerState.refreshState(userId)
        if (newState) {
          await this.nudgeService.maybeFireMilestoneNudges(userId, {
            currentStreakDays: newState.currentStreakDays,
          })
        }
      } catch (err) {
        console.warn(`[Buddy post-submit] failed for user ${userId}:`, err)
      }
    })
```

- [ ] **Step 4: Update the four `new SrsService(...)` callsites**

Modify `apps/api/src/routes/review.ts:39`:

```typescript
  const srs = new SrsService(server.db, server.dualWrite, server.learnerState, server.nudgeService)
```

Modify the three existing test files — add `nudgeService` instantiation and pass as 4th arg:

`apps/api/test/integration/srs-dual-write.test.ts`:

```typescript
import { NudgeService } from '../../src/services/buddy/nudge.service'
// ...
const dualWrite = new DualWriteService(db)
const learnerState = new LearnerStateService(db)
const nudgeService = new NudgeService(db, { sendBuddyNudgePush: async () => {} } as any)
const srs = new SrsService(db, dualWrite, learnerState, nudgeService)
```

`apps/api/test/integration/srs-maybe-slipping.test.ts` — same edit.

`apps/api/test/integration/phase0-smoke.test.ts` — same edit; if `learnerState` is already declared in that file, just add `nudgeService` and update the constructor call.

- [ ] **Step 5: Run the full suite — verify no regression**

```bash
pnpm --filter=@kanji-learn/api test
```

Expected: all green (240+ tests passing).

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: clean modulo the pre-existing `social-mute.test.ts:25` error.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/srs.service.ts apps/api/src/routes/review.ts \
        apps/api/test/integration/srs-dual-write.test.ts \
        apps/api/test/integration/srs-maybe-slipping.test.ts \
        apps/api/test/integration/phase0-smoke.test.ts \
        apps/api/test/integration/buddy-push-trigger.test.ts
git commit -m "$(cat <<'EOF'
feat(buddy): wire maybeFireMilestoneNudges into submitReview's setImmediate chain

Extends the Phase 0a post-commit hook: after LearnerStateService refresh,
NudgeService.maybeFireMilestoneNudges runs. On a milestone day, it inserts
the Dashboard streak row and fires Expo push. The Study Ready mirror row
is left for the pull path (no second push).

SrsService constructor gains nudgeService as a 4th required arg. Four
callsites updated: routes/review.ts and three existing integration tests.

Three new push-path integration tests verify: fires on milestone /
no-fire on non-milestone / no double-fire on duplicate trigger.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 8: Mobile hook `useBuddyNudges`

**Files:**
- Create: `apps/mobile/src/hooks/useBuddyNudges.ts`

- [ ] **Step 1: Create the hook**

Create `apps/mobile/src/hooks/useBuddyNudges.ts`:

```typescript
// apps/mobile/src/hooks/useBuddyNudges.ts
//
// Mirrors apps/mobile/src/hooks/useInterventions.ts — module-cache,
// refresh on mount + focus, optimistic dismiss.

import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { api } from '../lib/api'
import type { BuddyNudge, BuddyScreen } from '@kanji-learn/shared'

type NudgesResponse = { data: BuddyNudge[] }

export function useBuddyNudges(screen: BuddyScreen) {
  const [nudges, setNudges] = useState<BuddyNudge[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await api.get<NudgesResponse>(`/v1/buddy/nudges?screen=${screen}`)
      setNudges(res.data ?? [])
      setError(null)
    } catch (err) {
      setError(err)
      // Silently keep previous nudges on transient failure (banner is
      // non-critical — same posture as useInterventions).
    } finally {
      setIsLoading(false)
    }
  }, [screen])

  // Initial fetch on mount.
  useEffect(() => {
    refresh()
  }, [refresh])

  // Refetch on screen focus — covers tab-switch and app-foreground.
  useFocusEffect(
    useCallback(() => {
      refresh()
    }, [refresh])
  )

  const dismiss = useCallback(
    async (id: string) => {
      // Optimistic: remove locally before the API call resolves.
      setNudges((prev) => prev.filter((n) => n.id !== id))
      try {
        await api.post(`/v1/buddy/nudges/${id}/dismiss`)
      } catch (err) {
        // Server didn't get the dismiss. The nudge will reappear on
        // next refresh; the user can dismiss again. Retry queue is
        // Phase 1' future work (spec §7.7).
        setError(err)
      }
    },
    []
  )

  return { nudges, isLoading, error, dismiss, refresh }
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean (modulo pre-existing error).

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/hooks/useBuddyNudges.ts
git commit -m "$(cat <<'EOF'
feat(buddy): useBuddyNudges hook

Mirrors useInterventions: module-state cache, refresh on mount + focus,
optimistic dismiss. Returns { nudges, isLoading, error, dismiss, refresh }.

Phase 1' future-work item §7.7 will queue failed dismisses for retry;
v1 just reappears them on next refresh.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 9: `BuddyCard` and `BuddyCardStack` components

**Files:**
- Create: `apps/mobile/src/components/buddy/BuddyCard.tsx`
- Create: `apps/mobile/src/components/buddy/BuddyCardStack.tsx`

- [ ] **Step 1: Create `BuddyCard.tsx`**

Create `apps/mobile/src/components/buddy/BuddyCard.tsx`:

```typescript
// apps/mobile/src/components/buddy/BuddyCard.tsx
//
// Single nudge row. Neutral-soft visual treatment per Phase 1' design §4.3
// — matches InviteMateBanner aesthetic so Buddy reads as part of the
// dashboard banner vocabulary. Phase 5 re-skins once persona work happens.

import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { BuddyNudge } from '@kanji-learn/shared'

interface BuddyCardProps {
  nudge: BuddyNudge
  onDismiss: () => void
}

export function BuddyCard({ nudge, onDismiss }: BuddyCardProps) {
  return (
    <View
      style={styles.container}
      accessibilityRole="text"
      accessibilityLabel={`Buddy says: ${nudge.content}`}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarEmoji}>🐵</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.content}>{nudge.content}</Text>
      </View>
      <TouchableOpacity
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss Buddy message"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="close" size={18} color="#888" />
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1f1f23',
    borderColor: '#2e2e35',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2e2e35',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  avatarEmoji: {
    fontSize: 18,
  },
  body: {
    flex: 1,
  },
  content: {
    color: '#e0e0e0',
    fontSize: 13,
    lineHeight: 18,
  },
})
```

- [ ] **Step 2: Create `BuddyCardStack.tsx`**

Create `apps/mobile/src/components/buddy/BuddyCardStack.tsx`:

```typescript
// apps/mobile/src/components/buddy/BuddyCardStack.tsx
//
// Per-screen wrapper. Calls useBuddyNudges, renders 0-2 BuddyCard rows
// in priority-descending order, handles dismissal. Returns null when
// the array is empty so an empty stack contributes zero visual space.

import React from 'react'
import { StyleSheet, View } from 'react-native'
import { BuddyCard } from './BuddyCard'
import { useBuddyNudges } from '../../hooks/useBuddyNudges'
import type { BuddyScreen } from '@kanji-learn/shared'

interface BuddyCardStackProps {
  screen: BuddyScreen
}

export function BuddyCardStack({ screen }: BuddyCardStackProps) {
  const { nudges, dismiss } = useBuddyNudges(screen)

  if (nudges.length === 0) return null

  return (
    <View style={styles.stack}>
      {nudges.slice(0, 2).map((nudge) => (
        <BuddyCard key={nudge.id} nudge={nudge} onDismiss={() => dismiss(nudge.id)} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  stack: {
    gap: 8,
    marginVertical: 8,
  },
})
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean modulo pre-existing error.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/buddy/
git commit -m "$(cat <<'EOF'
feat(buddy): BuddyCard + BuddyCardStack components

BuddyCard renders one nudge row in the neutral-soft treatment locked
in Phase 1' design §4.3 — #1f1f23 background, monkey emoji avatar,
dismiss × button. Accessibility labels included; full a11y pass on
the housekeeping queue.

BuddyCardStack is the per-screen wrapper: calls useBuddyNudges,
renders up to 2 nudges in priority order, returns null on empty so
an empty stack contributes no visual space.

Phase 5 re-skins both components once persona work settles voice/identity.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 10: Surface integration — Dashboard

**Files:**
- Modify: `apps/mobile/app/(tabs)/index.tsx` (~line 340)

- [ ] **Step 1: Add the import**

At the top of `apps/mobile/app/(tabs)/index.tsx`, add:

```typescript
import { BuddyCardStack } from '../../src/components/buddy/BuddyCardStack'
```

- [ ] **Step 2: Insert the component**

Find the existing JSX around line 335-345:

```jsx
            {/* ── Kanji Status ── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Kanji Status</Text>
              <SrsStatusBar counts={summary.statusCounts} />
            </View>

            {/* ── Velocity ── */}
            <View style={styles.card}>
```

Insert `<BuddyCardStack screen="dashboard" />` between the Kanji Status card and the Velocity card:

```jsx
            {/* ── Kanji Status ── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Kanji Status</Text>
              <SrsStatusBar counts={summary.statusCounts} />
            </View>

            {/* ── Buddy nudges ── */}
            <BuddyCardStack screen="dashboard" />

            {/* ── Velocity ── */}
            <View style={styles.card}>
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean modulo pre-existing error.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/\(tabs\)/index.tsx
git commit -m "$(cat <<'EOF'
feat(buddy): mount BuddyCardStack on Dashboard

Inserted between Kanji Status card and Velocity card — below the
SrsStatusBar (status: where am I) and above operational/velocity info
(now: what do I do). Buddy speaks first when applicable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 11: Surface integration — Study Ready

**Files:**
- Modify: `apps/mobile/src/components/study/ReadyScreen.tsx` (~line 50)

- [ ] **Step 1: Add the import**

At the top of `apps/mobile/src/components/study/ReadyScreen.tsx`, add:

```typescript
import { BuddyCardStack } from '../buddy/BuddyCardStack'
```

(Path is relative — confirm the depth when editing.)

- [ ] **Step 2: Insert the component**

Find the existing JSX around lines 45-55:

```jsx
        </View>
        <TouchableOpacity style={styles.beginBtn} onPress={onBegin} activeOpacity={0.85}>
          <Text style={styles.beginText}>Begin</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>
```

Insert `<BuddyCardStack screen="study" />` before the Begin button:

```jsx
        </View>
        <BuddyCardStack screen="study" />
        <TouchableOpacity style={styles.beginBtn} onPress={onBegin} activeOpacity={0.85}>
          <Text style={styles.beginText}>Begin</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>
```

Note the `screen="study"` value — the `BuddyScreen` enum uses `study`, not `study-ready` (per the existing schema's screen text values).

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean modulo pre-existing error.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/study/ReadyScreen.tsx
git commit -m "$(cat <<'EOF'
feat(buddy): mount BuddyCardStack on Study Ready screen

Inserted between the stats row and the Begin button — the last thing
the user sees before tapping into a session. screen='study' is the
canonical enum value; the rule engine fires the streak mirror row for
this screen via the pull path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 12: Surface integration — Progress

**Files:**
- Modify: `apps/mobile/app/(tabs)/progress.tsx` (~line 280)

- [ ] **Step 1: Add the import**

At the top of `apps/mobile/app/(tabs)/progress.tsx`, add:

```typescript
import { BuddyCardStack } from '../../src/components/buddy/BuddyCardStack'
```

- [ ] **Step 2: Insert the component**

Find the existing JSX around lines 275-285:

```jsx
            {/* Period selector + activity chart */}
            <Section
              title="Activity"
```

Insert `<BuddyCardStack screen="progress" />` before the Activity Section:

```jsx
            {/* ── Buddy nudges ── */}
            <BuddyCardStack screen="progress" />

            {/* Period selector + activity chart */}
            <Section
              title="Activity"
```

Note: This renders nothing in v1 (the rule engine has no Progress-screen rules), but the placement is wired so future nudge types — weekly recap, milestone reflection — slot in here.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean modulo pre-existing error.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/\(tabs\)/progress.tsx
git commit -m "$(cat <<'EOF'
feat(buddy): mount BuddyCardStack on Progress tab

Inserted above the Activity section. Returns null in v1 (no rules
fire on Progress yet); placement is wired so future nudge types —
weekly recap, milestone reflection — can be added without touching
mobile placement code.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 13: Operator step — apply migration to live DB

**Files:** No file changes — operator runbook.

- [ ] **Step 1: Safety dump of live DB**

```bash
mkdir -p /tmp/buddy-phase1-safety
pg_dump "$LIVE_DATABASE_URL" --no-owner --no-acl > /tmp/buddy-phase1-safety/live-$(date +%Y%m%d-%H%M).sql
ls -lh /tmp/buddy-phase1-safety/
```

Verify size is non-trivial (single-digit MB at minimum).

- [ ] **Step 2: Apply migration 0025 to live DB**

```bash
psql "$LIVE_DATABASE_URL" -f packages/db/supabase/migrations/0025_buddy_nudges_dedupe_indexes.sql
```

Expected: two `CREATE INDEX` confirmations + `COMMIT`. No errors.

The indexes are created as partial unique indexes on a table that already has rows (16 rows live as of Phase 0a verification, but the indexes only apply to streak/encouragement rows — and there are none yet). They build instantly.

- [ ] **Step 3: Verify the indexes exist live**

```bash
psql "$LIVE_DATABASE_URL" -c "\d buddy_nudges" | grep -E "streak_dedupe|meet_buddy_dedupe"
```

Expected: two rows naming the two new partial unique indexes.

- [ ] **Step 4: Clean up safety dump after 24h stability**

```bash
# After 24h of post-deploy stability:
rm -rf /tmp/buddy-phase1-safety
```

---

## Task 14: Operator step — deploy API + cut mobile build

**Files:** No file changes — operator runbook.

- [ ] **Step 1: Push commits to origin**

```bash
git push origin main
```

- [ ] **Step 2: Deploy API**

```bash
./scripts/deploy-api.sh
```

Note the App Runner operation ID it returns.

- [ ] **Step 3: Wait for App Runner SUCCEEDED**

```bash
aws apprunner list-operations \
  --service-arn "arn:aws:apprunner:us-east-1:087656010655:service/kanji-learn-api/470f4fc9f81c407e871228fb9dd93654" \
  --max-results 1 --query 'OperationSummaryList[0]'
```

Re-run until `Status` = `SUCCEEDED`. Typical 3–5 minutes.

- [ ] **Step 4: API smoke**

```bash
curl -s -o /dev/null -w "review/status: %{http_code}\n" \
  https://73x3fcaaze.us-east-1.awsapprunner.com/v1/review/status
curl -s -o /dev/null -w "buddy/nudges: %{http_code}\n" \
  https://73x3fcaaze.us-east-1.awsapprunner.com/v1/buddy/nudges?screen=dashboard
```

Expected: both `401` (routes exist, need auth). If 5xx, halt and check App Runner logs.

- [ ] **Step 5: Cut EAS iOS build (B136 by auto-bump)**

```bash
cd apps/mobile && eas build --platform ios --profile production --non-interactive
```

The build takes ~15–20 minutes on EAS. ~$2/build (per memory `feedback_eas_build_bundling.md`).

- [ ] **Step 6: Submit build to TestFlight**

When the EAS build completes:

```bash
eas submit --platform ios --latest --non-interactive
```

Apple processing follows (~5–10 minutes from submit to TestFlight availability).

- [ ] **Step 7: Update `apps/mobile/app.json` post-submit**

Per memory `feedback_eas_build_number.md`: `app.json` ios.buildNumber tracks the LAST shipped build. After EAS auto-bumps 135 → 136 server-side, manually update `app.json` to record the new shipped build number (136).

```bash
cd apps/mobile
# Edit app.json: set ios.buildNumber from "135" to "136"
git add app.json
git commit -m "$(cat <<'EOF'
chore(mobile): bump app.json ios.buildNumber to 136

EAS auto-bumped server-side; this records the LAST shipped build per
project convention.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
git push origin main
```

---

## Task 15: Acceptance verification + closeout

**Files:**
- Create: `docs/superpowers/findings/2026-05-24-phase-1-prime-verification.md`
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: On-device smoke walkthrough**

Open B136 on iOS TestFlight. Verify:

1. **Dashboard shows Meet Buddy card** (one-time, first launch post-deploy).
2. **Dismiss it.** Re-open Dashboard. Card is gone.
3. **Open Study Ready.** No nudge if not on a streak milestone day.
4. **If currently on a milestone streak day** (3, 7, 14, 30, ...): Dashboard and Study Ready both show the streak card. Dismissing one does not dismiss the other.
5. **Open Progress.** No Buddy card visible (rules don't fire there in v1).

- [ ] **Step 2: Run the Supabase verification query**

In Supabase SQL editor:

```sql
SELECT id, user_id, screen, nudge_type, content, dismissed_at, push_delivered_at, created_at
FROM buddy_nudges
WHERE user_id = '<operator-user-id>'
ORDER BY created_at DESC
LIMIT 10;
```

Expected: rows for the Meet Buddy and (if applicable) streak nudges in the last few minutes; `push_delivered_at` set for any streak rows that fired during a real review session.

- [ ] **Step 3: Verify push fires for a milestone (timing-permitting)**

If the operator can engineer being on a milestone-day streak (or the test user already is): grade a card to completion of a session, then watch for an Expo push on the device.

If not feasible during closeout: note as deferred operator verification.

- [ ] **Step 4: Write findings doc**

Create `docs/superpowers/findings/2026-05-24-phase-1-prime-verification.md`:

```markdown
# Phase 1' — On-device verification

**Date:** 2026-05-24
**Build:** B136 (EAS build <build-id>; submission <submission-id>)
**API deploy:** App Runner op `<op-id>` SUCCEEDED at <timestamp>
**Migration:** 0025_buddy_nudges_dedupe_indexes.sql applied to live DB at <timestamp>

## Acceptance criteria (Phase 1' design §1.1)

| Criterion | Status |
|---|---|
| BuddyCard renders on Dashboard | <✅/⏳> <notes> |
| BuddyCard renders on Study Ready when streak milestone present | <✅/⏳> <notes> |
| BuddyCard returns empty on Progress (placement wired) | <✅/⏳> <notes> |
| Meet Buddy card shown one-time, dismissable, never returns | <✅/⏳> <notes> |
| Streak rule fires on milestone day | <✅/⏳> <notes> |
| Push notification fires when milestone trips during session | <✅/⏳> <notes> |
| Mirror rows: dismissing Dashboard streak doesn't dismiss Study Ready | <✅/⏳> <notes> |
| Dedupe: no duplicate rows after repeated visits | <✅/⏳> <notes> |

Phase 1' complete. Next slice per the refresh doc §9 ordering: Phase 5 brainstorm (Contextual Mnemonic Co-Creation).
```

- [ ] **Step 5: Update HANDOFF.md**

Edit `docs/HANDOFF.md`. Add a new "Phase 1' shipped" entry at the top of the TL;DR section, push the existing Phase 0a + earlier content into "Prior sessions" block. Note that B136 is in TestFlight with the BuddyCard delivery skeleton; next creative work is Phase 5.

- [ ] **Step 6: Commit closeout**

```bash
git add docs/superpowers/findings/2026-05-24-phase-1-prime-verification.md docs/HANDOFF.md
git commit -m "$(cat <<'EOF'
docs(phase1'): close out — Phase 1' shipped, B136 in TestFlight

BuddyCard delivery skeleton landed. Migration 0025 applied; API deployed
with NudgeService + buddy-nudges routes + push integration; B136 cut and
submitted with BuddyCardStack mounted on Dashboard / Study Ready / Progress.

On-device verification: <one-line summary>.

Buddy Phase 1' is shipped. Next slice per refresh doc §9: Phase 5
brainstorm (Contextual Mnemonic Co-Creation — the signature feature).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
git push origin main
```

---

## Plan self-review

- **Spec coverage:** §1.1 in-scope items each have explicit tasks. BuddyCard (Task 9), GET + dismiss API (Task 5), useBuddyNudges hook (Task 8), rule engine streak + meet-buddy (Tasks 3-4), push (Tasks 6-7), migration 0025 (Task 1), integration tests (Tasks 3, 4, 5, 7). §1.2 out-of-scope items not implemented (no other NudgeTypes, no LLM enrichment, no Watch, no onboarding integration, no template DB table, no retry queue, no deep-link routing, no avatar art, no animations).
- **Placeholder scan:** Two intentional placeholders in Task 14 step 4 (`<one-line summary>`) and Task 15 step 4 (table cells with `<✅/⏳> <notes>`) — both meant to be filled at execution time from real verification data. Not "TBD" sentinels; concrete fill-in instructions. No other placeholders.
- **Type consistency:** `BuddyNudge`, `BuddyScreen` from `@kanji-learn/shared` used consistently. `SrsService` constructor `(db, dualWrite, learnerState, nudgeService)` consistent across Task 7's four edits. `NudgeService(db, notifier)` constructor consistent across rule-engine tests, route test stub, push-trigger tests, and server.ts wiring. `evaluateNudgesForScreen` and `maybeFireMilestoneNudges` names match the design spec §2.
- **File-list reconciliation:** Every task's `Files:` header matches the actual edits inside the steps. No stale headers; no file edited without being listed.

---

*End of plan. Companion documents: [`../specs/2026-05-24-buddy-phase-1-prime-design.md`](../specs/2026-05-24-buddy-phase-1-prime-design.md), [`../runbooks/2026-05-22-fsrs-rollout.md`](../runbooks/2026-05-22-fsrs-rollout.md), [`../plans/2026-05-23-buddy-phase-0a-cleanup.md`](2026-05-23-buddy-phase-0a-cleanup.md).*
