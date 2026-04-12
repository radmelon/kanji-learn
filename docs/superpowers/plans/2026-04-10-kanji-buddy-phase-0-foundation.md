# Kanji Buddy Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the architectural skeleton for Kanji Buddy v2 — database schema, provider-agnostic LLM router, learner state cache, dual-write to the Universal Knowledge Graph, backfill for existing users, and telemetry — with zero user-visible changes.

**Architecture:** Additive changes in the existing `kanji-learn` monorepo. New Drizzle tables alongside the current schema, a new `services/llm` provider layer on the API, a new `services/buddy` directory for the learner state service and dual-write wrapper, and a one-time backfill script. All writes flow through a `DualWriteService` that projects every meaningful event into both the app-specific tables and the app-agnostic universal Knowledge Graph.

**Tech Stack:** Drizzle ORM + drizzle-kit, PostgreSQL (Supabase), Fastify, TypeScript, `groq-sdk`, `@google/generative-ai`, existing `@anthropic-ai/sdk`, Vitest (introduced in this phase — the repo has no test runner yet).

**Companion documents:**
- Design: `docs/superpowers/specs/2026-04-09-kanji-buddy-design.md`
- Spec: `docs/superpowers/specs/2026-04-09-kanji-buddy-spec.md` (sections 1–4, 2 for LLM layer, 12 for UKG)

---

## Context for the Implementing Engineer

You are a skilled developer, but you have zero context for this codebase. Read these notes before starting any task.

**Monorepo layout:**
```
kanji-learn/                         (repo root; pnpm workspace)
├── apps/
│   ├── api/       Fastify server (our main target)
│   ├── mobile/    Expo React Native (untouched in Phase 0)
│   └── watch/     Apple Watch (untouched in Phase 0)
└── packages/
    ├── db/        Drizzle schema + migrations + seeds
    └── shared/    Types and pure helpers shared between api and mobile
```

**Key existing files you will reference:**
- `packages/db/src/schema.ts` — the single Drizzle schema file (447 lines). All new tables and alterations go here.
- `packages/db/src/client.ts` — exports `Db` type and a postgres-js client.
- `packages/db/src/index.ts` — re-exports schema + client.
- `packages/db/drizzle.config.ts` — drizzle-kit config; migrations land in `packages/db/drizzle/`.
- `apps/api/src/services/srs.service.ts` — the existing SRS engine. `submitReview()` is where we will hook dual-write.
- `apps/api/src/services/mnemonic.service.ts` — existing Anthropic-based mnemonic generator. We refactor its Anthropic usage to go through the new router in a later task but keep it working throughout.
- `apps/api/src/services/analytics.service.ts` — pattern for async stats updates.
- `apps/api/src/routes/review.ts` — pattern for route + service wiring (line 67 is the submitReview entry point).
- `packages/shared/src/types.ts` — shared types live here.
- `packages/shared/src/index.ts` — re-export index.

**Drizzle conventions in this repo:**
- Snake-case column names in the DB (`user_id`), camelCase in TypeScript (`userId`).
- Enums use `pgEnum(...)` exported at the top of `schema.ts`.
- Indexes are declared via the second arg callback on `pgTable`.
- Foreign keys always use `onDelete: 'cascade'` unless otherwise noted.
- `timestamp(..., { withTimezone: true }).notNull().defaultNow()` for created_at/updated_at.
- `uuid('id').primaryKey().defaultRandom()` for UUID primary keys.
- `serial('id').primaryKey()` for integer primary keys (legacy tables).
- `jsonb('col').$type<T>().notNull().default([])` for typed JSON.

**Migrations workflow:**
```bash
# From packages/db/
pnpm db:generate   # runs drizzle-kit generate; reads schema.ts and produces a new SQL file in drizzle/
pnpm db:migrate    # runs drizzle-kit migrate; applies pending migrations against DATABASE_URL
```
Never edit generated SQL files by hand unless you need raw SQL that drizzle-kit can't express (e.g., materialized views, `CHECK` constraints not expressible via Drizzle). When you do, use `drizzle-kit generate --custom` to create an empty migration file and add the SQL manually.

**Testing:** The repo has no test runner today. Task 4 installs Vitest and creates the test-scaffolding. All subsequent tasks write tests first.

**Commits:** Small and frequent. Each task ends with a commit. Follow the existing conventional-commit style visible in `git log` (`feat:`, `fix:`, `docs:`, `chore:`).

**DB access for testing:** Use a dedicated test database URL via `TEST_DATABASE_URL`. The task that sets up Vitest also adds a reset helper that truncates tables between tests.

---

## File Structure

Every file that will be created or modified in Phase 0, with its single responsibility:

### New files — packages/db
| Path | Responsibility |
|------|---------------|
| `packages/db/src/schema.ts` *(MODIFY)* | Add 15 new tables + 5 enums + 4 alterations to existing tables |
| `packages/db/drizzle/0008_kanji_buddy_phase0.sql` *(GENERATED)* | Migration SQL produced by drizzle-kit |
| `packages/db/drizzle/0009_kanji_buddy_phase0_custom.sql` *(MANUAL)* | Raw SQL for CHECK constraints, materialized view, indexes drizzle-kit cannot express |
| `packages/db/src/seeds/backfill-universal-kg.ts` *(NEW)* | One-time backfill script for existing users into UKG tables |

### New files — packages/shared
| Path | Responsibility |
|------|---------------|
| `packages/shared/src/buddy-types.ts` *(NEW)* | All Buddy domain TypeScript types (LearnerStateCache, BuddyNudge, StudyPlan, StudyLogEntry, CoCreationSession, FriendComparison, Milestone, StudyPatterns, etc.) |
| `packages/shared/src/llm-types.ts` *(NEW)* | LLM provider interface, Message, ToolDefinition, CompletionRequest, CompletionResult, LLMProvider |
| `packages/shared/src/index.ts` *(MODIFY)* | Re-export new modules |

### New files — apps/api LLM layer
| Path | Responsibility |
|------|---------------|
| `apps/api/src/services/llm/types.ts` *(NEW)* | Server-only types: RequestContext, BuddyRequest, BuddyLLMError, routing decisions |
| `apps/api/src/services/llm/rate-limit.ts` *(NEW)* | Per-user daily tier caps via `buddy_llm_usage` counter table |
| `apps/api/src/services/llm/providers/groq.ts` *(NEW)* | GroqProvider implementation (Llama 3.3 70B) |
| `apps/api/src/services/llm/providers/gemini.ts` *(NEW)* | GeminiProvider implementation (Gemini 2.5 Flash) |
| `apps/api/src/services/llm/providers/claude.ts` *(NEW)* | ClaudeProvider — wraps the existing Anthropic SDK usage into the LLMProvider interface |
| `apps/api/src/services/llm/providers/apple-foundation-stub.ts` *(NEW)* | Server-side stub that always returns `isAvailable() = false`, used by router constructor. The real implementation lives in the mobile app in a later phase. |
| `apps/api/src/services/llm/router.ts` *(NEW)* | BuddyLLMRouter: tier classification, fail-over, truncation, telemetry emit |
| `apps/api/src/services/llm/telemetry.ts` *(NEW)* | Writes to `buddy_llm_telemetry` table (per-call latency, provider, tier, tokens, success) |

### New files — apps/api Buddy layer
| Path | Responsibility |
|------|---------------|
| `apps/api/src/services/buddy/learner-state.service.ts` *(NEW)* | Compute and persist `learner_state_cache` rows; expose `refreshState(userId)` and `getState(userId)` |
| `apps/api/src/services/buddy/dual-write.service.ts` *(NEW)* | Wrapper that writes to app-specific tables AND the UKG inside a single transaction |
| `apps/api/src/services/buddy/constants.ts` *(NEW)* | Scaffold level thresholds, leech thresholds, status-to-mastery mapping |

### New files — apps/api wiring
| Path | Responsibility |
|------|---------------|
| `apps/api/src/lib/env.ts` *(MODIFY)* | Add GROQ_API_KEY, GEMINI_API_KEY, BUDDY_TIER2_DAILY_CAP_PER_USER, BUDDY_TIER3_DAILY_CAP_PER_USER, LLM_PRIMARY_TIER2_PROVIDER |
| `apps/api/src/server.ts` *(MODIFY)* | Decorate Fastify with `buddyLLMRouter`, `learnerStateService`, `dualWriteService` |
| `apps/api/package.json` *(MODIFY)* | Add `groq-sdk`, `@google/generative-ai`, `vitest`, `@vitest/ui` |
| `apps/api/src/services/srs.service.ts` *(MODIFY)* | `submitReview()` routes the review log insert + progress upsert through `DualWriteService` |

### New files — tests
| Path | Responsibility |
|------|---------------|
| `apps/api/vitest.config.ts` *(NEW)* | Vitest configuration — Node env, test DB setup |
| `apps/api/test/setup.ts` *(NEW)* | Global test setup: load .env.test, create DB client, expose `resetDb()` |
| `apps/api/test/unit/llm/router.test.ts` *(NEW)* | Router classification + fail-over unit tests |
| `apps/api/test/unit/buddy/learner-state.test.ts` *(NEW)* | Learner state computation tests |
| `apps/api/test/unit/buddy/dual-write.test.ts` *(NEW)* | Dual-write transaction integrity tests |
| `apps/api/test/integration/backfill.test.ts` *(NEW)* | Backfill job correctness test |

---

## Task Summary

Phase 0 has **24 tasks**, grouped in five sections:

- **Section A: Schema foundation** — Tasks 1–5 (enums, new tables, alterations, custom SQL, migration)
- **Section B: Shared types** — Tasks 6–7
- **Section C: LLM layer** — Tasks 8–14 (rate limiter, each provider, router)
- **Section D: Buddy layer** — Tasks 15–19 (learner state, dual-write, SRS integration)
- **Section E: Backfill, wiring, telemetry** — Tasks 20–24

---

## Section A — Schema Foundation

### Task 1: Add new enums and learner_profiles table

**Files:**
- Modify: `packages/db/src/schema.ts` (append new enums near line 47, new tables at end before Relations section ~line 378)

- [ ] **Step 1: Add new enums after the existing `interventionTypeEnum`**

Insert after line 47 in `packages/db/src/schema.ts`:

```typescript
export const deviceTypeEnum = pgEnum('device_type', ['iphone', 'ipad', 'watch'])

export const buddyMoodEnum = pgEnum('buddy_mood', [
  'celebratory',
  'supportive',
  'challenging',
  'concerned',
])

export const velocityTrendEnum = pgEnum('velocity_trend', [
  'accelerating',
  'steady',
  'decelerating',
  'inactive',
])

export const weakestModalityEnum = pgEnum('weakest_modality', [
  'meaning',
  'reading',
  'writing',
  'voice',
  'compound',
])

export const buddyPersonalityEnum = pgEnum('buddy_personality', [
  'encouraging',
  'direct',
  'playful',
])

export const mnemonicGenerationMethodEnum = pgEnum('mnemonic_generation_method', [
  'system',
  'user',
  'cocreated',
])

export const llmTierEnum = pgEnum('llm_tier', ['tier1', 'tier2', 'tier3'])

export const studyLogMoodEnum = pgEnum('study_log_mood', [
  'aha',
  'struggle',
  'breakthrough',
  'fun',
  'confused',
])
```

- [ ] **Step 2: Append learner_profiles table at the end of schema.ts (before Relations section)**

```typescript
// ─── learner_profiles ─────────────────────────────────────────────────────────
// Extended preference and personality data for Kanji Buddy. One row per user.

export const learnerProfiles = pgTable('learner_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => userProfiles.id, { onDelete: 'cascade' }),
  nativeLanguage: text('native_language'),
  reasonsForLearning: jsonb('reasons_for_learning').$type<string[]>().notNull().default([]),
  interests: jsonb('interests').$type<string[]>().notNull().default([]),
  preferredMnemonicStyle: text('preferred_mnemonic_style'), // 'visual' | 'narrative' | 'wordplay' | 'spatial'
  preferredLearningStyles: jsonb('preferred_learning_styles').$type<string[]>().notNull().default([]),
  buddyPersonalityPref: buddyPersonalityEnum('buddy_personality_pref').notNull().default('encouraging'),
  studyEnvironments: jsonb('study_environments').$type<string[]>().notNull().default([]),
  goals: jsonb('goals').$type<string[]>().notNull().default([]),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 3: Typecheck the schema**

Run: `pnpm --filter @kanji-learn/db typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): add buddy enums and learner_profiles table"
```

---

### Task 2: Add learner_state_cache, buddy_conversations, buddy_nudges tables

**Files:**
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Append learner_state_cache table**

Append after `learnerProfiles`:

```typescript
// ─── learner_state_cache ──────────────────────────────────────────────────────
// Pre-computed snapshot of a learner's current state. Refreshed after each session.

export const learnerStateCache = pgTable(
  'learner_state_cache',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    currentStreakDays: integer('current_streak_days').notNull().default(0),
    longestStreakDays: integer('longest_streak_days').notNull().default(0),
    velocityTrend: velocityTrendEnum('velocity_trend').notNull().default('inactive'),
    totalKanjiSeen: integer('total_kanji_seen').notNull().default(0),
    totalKanjiBurned: integer('total_kanji_burned').notNull().default(0),
    activeLeechCount: integer('active_leech_count').notNull().default(0),
    leechKanjiIds: jsonb('leech_kanji_ids').$type<number[]>().notNull().default([]),
    weakestModality: weakestModalityEnum('weakest_modality').notNull().default('meaning'),
    strongestJlptLevel: jlptLevelEnum('strongest_jlpt_level'),
    currentFocusLevel: jlptLevelEnum('current_focus_level'),
    recentAccuracy: real('recent_accuracy').notNull().default(0),
    lastSessionAt: timestamp('last_session_at', { withTimezone: true }),
    avgDailyReviews: real('avg_daily_reviews').notNull().default(0),
    avgSessionDurationMs: integer('avg_session_duration_ms').notNull().default(0),
    daysSinceLastSession: integer('days_since_last_session').notNull().default(0),
    daysSinceFirstSession: integer('days_since_first_session').notNull().default(0),
    quizVsSrsGapHigh: boolean('quiz_vs_srs_gap_high').notNull().default(false),
    primaryDevice: deviceTypeEnum('primary_device'),
    deviceDistribution: jsonb('device_distribution')
      .$type<Partial<Record<'iphone' | 'ipad' | 'watch', number>>>()
      .notNull()
      .default({}),
    watchSessionAvgCards: integer('watch_session_avg_cards'),
    recentMilestones: jsonb('recent_milestones')
      .$type<{ type: string; achievedAt: string; payload: Record<string, unknown> }[]>()
      .notNull()
      .default([]),
    studyPatterns: jsonb('study_patterns')
      .$type<{
        preferredTime?: 'morning' | 'midday' | 'evening' | 'night'
        avgSessionsPerDay: number
        weekendVsWeekdayRatio: number
      }>()
      .notNull()
      .default({ avgSessionsPerDay: 0, weekendVsWeekdayRatio: 1 }),
    nextRecommendedActivity: text('next_recommended_activity'),
    buddyMood: buddyMoodEnum('buddy_mood').notNull().default('supportive'),
    // 'heavy' | 'medium' | 'light' — mirrors ScaffoldLevel in api/src/services/buddy/constants.ts
    scaffoldLevel: text('scaffold_level').notNull().default('medium'),
    friendsCount: integer('friends_count').notNull().default(0),
    activeFriendsToday: integer('active_friends_today').notNull().default(0),
    friendsAheadOnBurn: jsonb('friends_ahead_on_burn')
      .$type<{ friendId: string; displayName: string; metric: string; value: number; delta: number }[]>()
      .notNull()
      .default([]),
    friendsBehindOnBurn: jsonb('friends_behind_on_burn')
      .$type<{ friendId: string; displayName: string; metric: string; value: number; delta: number }[]>()
      .notNull()
      .default([]),
    friendsAheadOnStreak: jsonb('friends_ahead_on_streak')
      .$type<{ friendId: string; displayName: string; metric: string; value: number; delta: number }[]>()
      .notNull()
      .default([]),
    friendsBehindOnStreak: jsonb('friends_behind_on_streak')
      .$type<{ friendId: string; displayName: string; metric: string; value: number; delta: number }[]>()
      .notNull()
      .default([]),
    userStrengthsVsFriends: jsonb('user_strengths_vs_friends')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    groupMomentum: text('group_momentum'), // 'rising' | 'steady' | 'falling'
  }
)
// No secondary index: userId is PK, so all lookups are already point-lookups.
// If a cache-staleness job is added later, add `index(...).on(t.updatedAt)`.
```

- [ ] **Step 2: Append buddy_conversations table**

```typescript
// ─── buddy_conversations ──────────────────────────────────────────────────────
// Short-lived LLM conversation state. Expires 30min after last activity.

export const buddyConversations = pgTable(
  'buddy_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    context: text('context').notNull(), // 'session_start' | 'card_failed' | ...
    messages: jsonb('messages')
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    turnCount: integer('turn_count').notNull().default(0),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userActiveIdx: index('buddy_conv_user_active_idx').on(t.userId, t.lastActiveAt),
  })
)
```

- [ ] **Step 3: Append buddy_nudges table**

```typescript
// ─── buddy_nudges ─────────────────────────────────────────────────────────────
// Pre-computed nudge messages for inline display on specific screens.

export const buddyNudges = pgTable(
  'buddy_nudges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    screen: text('screen').notNull(), // 'dashboard' | 'study' | 'journal' | 'write' | 'speak' | 'progress'
    nudgeType: text('nudge_type').notNull(),
    content: text('content').notNull(),
    watchSummary: text('watch_summary'),
    actionType: text('action_type'), // 'navigate' | 'start_drill' | 'view_kanji' | 'generate_mnemonic' | 'dismiss' | 'none'
    actionPayload: jsonb('action_payload').$type<Record<string, unknown>>(),
    priority: smallint('priority').notNull().default(3),
    deliveryTarget: text('delivery_target').notNull().default('app'),
    watchDeliveredAt: timestamp('watch_delivered_at', { withTimezone: true }),
    pushDeliveredAt: timestamp('push_delivered_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    generatedBy: text('generated_by').notNull(), // 'template' | 'on_device' | 'cloud'
    deviceType: deviceTypeEnum('device_type'),
    socialFraming: boolean('social_framing').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userScreenIdx: index('buddy_nudges_user_screen_idx').on(t.userId, t.screen, t.expiresAt),
    watchDeliveryIdx: index('buddy_nudges_watch_delivery_idx').on(t.userId, t.deliveryTarget, t.watchDeliveredAt),
  })
)
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @kanji-learn/db typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): add learner state cache, buddy conversations, buddy nudges"
```

---

### Task 3: Add study_plans, study_log_entries, shared_goals, and Universal Knowledge Graph tables

**Files:**
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Append study_plans and study_plan_events**

```typescript
// ─── study_plans ──────────────────────────────────────────────────────────────

export const studyPlans = pgTable(
  'study_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    activities: jsonb('activities')
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    rationale: text('rationale').notNull(),
    scaffoldLevel: smallint('scaffold_level').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    deviceType: deviceTypeEnum('device_type'),
    completedCount: integer('completed_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    userActiveIdx: index('study_plans_user_active_idx').on(t.userId, t.expiresAt),
  })
)

export const studyPlanEvents = pgTable(
  'study_plan_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => studyPlans.id, { onDelete: 'cascade' }),
    activityIndex: smallint('activity_index').notNull(),
    event: text('event').notNull(), // 'started' | 'completed' | 'skipped' | 'navigated_away'
    eventAt: timestamp('event_at', { withTimezone: true }).notNull().defaultNow(),
    deviceType: deviceTypeEnum('device_type'),
  },
  (t) => ({
    // Postgres does not auto-index FKs; "all events for plan X" is the core read.
    planIdx: index('study_plan_events_plan_idx').on(t.planId),
  })
)
```

- [ ] **Step 2: Append study_log_entries**

```typescript
// ─── study_log_entries ────────────────────────────────────────────────────────
// Enhanced journal entries with photos, sentences, audio, mood, tags.

export const studyLogEntries = pgTable(
  'study_log_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    kanjiId: integer('kanji_id')
      .notNull()
      .references(() => kanji.id, { onDelete: 'cascade' }),
    mnemonicId: uuid('mnemonic_id').references(() => mnemonics.id, { onDelete: 'set null' }),
    userNote: text('user_note'),
    exampleSentence: text('example_sentence'),
    sentenceReading: text('sentence_reading'),
    sentenceTranslation: text('sentence_translation'),
    photoUrls: jsonb('photo_urls').$type<string[]>().notNull().default([]),
    audioNoteUrl: text('audio_note_url'),
    locationLat: real('location_lat'),
    locationLng: real('location_lng'),
    locationName: text('location_name'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    mood: studyLogMoodEnum('mood'),
    sharedWithFriends: boolean('shared_with_friends').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
  },
  (t) => ({
    userCreatedIdx: index('study_log_user_created_idx').on(t.userId, t.createdAt),
    userKanjiIdx: index('study_log_user_kanji_idx').on(t.userId, t.kanjiId),
  })
)
```

- [ ] **Step 3: Append shared_goals**

```typescript
// ─── shared_goals ─────────────────────────────────────────────────────────────

export const sharedGoals = pgTable(
  'shared_goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userIdA: uuid('user_id_a')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    userIdB: uuid('user_id_b')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    goalType: text('goal_type').notNull(), // 'burn_milestone' | 'streak_match' | 'level_complete'
    target: integer('target').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    achievedAt: timestamp('achieved_at', { withTimezone: true }),
    achievedBy: jsonb('achieved_by').$type<Record<string, string>>().notNull().default({}),
  },
  (t) => ({
    pairTypeIdx: index('shared_goals_pair_type_idx').on(t.userIdA, t.userIdB, t.goalType),
  })
)
```

- [ ] **Step 4: Append UKG core tables**

```typescript
// ─── Universal Knowledge Graph ────────────────────────────────────────────────
// App-agnostic projection of learner state. Subjects are namespaced (e.g. "kanji:持").

export const learnerIdentity = pgTable('learner_identity', {
  // PK is named learnerId (not id) so every other UKG table can reference
  // `learnerIdentity.learnerId` with the same name they use for their own FK.
  learnerId: uuid('learner_id').primaryKey(), // matches user_profiles.id
  displayName: text('display_name'),
  email: text('email'),
  nativeLanguage: text('native_language'),
  targetLanguages: jsonb('target_languages').$type<string[]>().notNull().default(['ja']),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const learnerProfileUniversal = pgTable('learner_profile_universal', {
  learnerId: uuid('learner_id')
    .primaryKey()
    .references(() => learnerIdentity.learnerId, { onDelete: 'cascade' }),
  interests: jsonb('interests').$type<string[]>().notNull().default([]),
  reasonsForLearning: jsonb('reasons_for_learning').$type<string[]>().notNull().default([]),
  preferredLearningStyles: jsonb('preferred_learning_styles').$type<string[]>().notNull().default([]),
  goals: jsonb('goals').$type<string[]>().notNull().default([]),
  studyHabits: jsonb('study_habits').$type<Record<string, unknown>>().notNull().default({}),
  // buddyPersonalityEnum is Kanji-Buddy-specific vocabulary ('encouraging' | 'direct' | 'playful').
  // If a second app joins the UKG and needs a different vocabulary, relax this to plain text.
  buddyPersonalityPref: buddyPersonalityEnum('buddy_personality_pref').notNull().default('encouraging'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const learnerConnections = pgTable(
  'learner_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    learnerIdA: uuid('learner_id_a')
      .notNull()
      .references(() => learnerIdentity.learnerId, { onDelete: 'cascade' }),
    learnerIdB: uuid('learner_id_b')
      .notNull()
      .references(() => learnerIdentity.learnerId, { onDelete: 'cascade' }),
    relationship: text('relationship').notNull().default('friend'),
    sharedApps: jsonb('shared_apps').$type<string[]>().notNull().default(['kanji_buddy']),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Callers MUST normalize so learnerIdA < learnerIdB before insert; otherwise
    // (alice, bob) and (bob, alice) will both be accepted as distinct connections.
    pairIdx: uniqueIndex('learner_connections_pair_idx').on(t.learnerIdA, t.learnerIdB),
  })
)

export const learnerMemoryArtifacts = pgTable(
  'learner_memory_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learnerIdentity.learnerId, { onDelete: 'cascade' }),
    subject: text('subject').notNull(), // e.g. "kanji:持"
    artifactType: text('artifact_type').notNull(), // 'mnemonic' | 'note' | 'sentence' | 'photo' | 'audio'
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
    effectivenessScore: real('effectiveness_score').notNull().default(0.5),
    appSource: text('app_source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    subjectIdx: index('learner_artifacts_subject_idx').on(t.learnerId, t.subject),
  })
)

export const learnerKnowledgeState = pgTable(
  'learner_knowledge_state',
  {
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learnerIdentity.learnerId, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    masteryLevel: real('mastery_level').notNull().default(0),
    status: text('status').notNull().default('unseen'), // 'unseen' | 'learning' | 'reviewing' | 'mastered'
    reviewCount: integer('review_count').notNull().default(0),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    appSource: text('app_source').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.learnerId, t.subject] }),
    subjectOnlyIdx: index('learner_knowledge_subject_only_idx').on(t.subject),
  })
)

export const learnerAppGrants = pgTable(
  'learner_app_grants',
  {
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learnerIdentity.learnerId, { onDelete: 'cascade' }),
    appId: text('app_id').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.learnerId, t.appId] }),
  })
)

export const learnerTimelineEvents = pgTable(
  'learner_timeline_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learnerIdentity.learnerId, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    subject: text('subject'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    appSource: text('app_source').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    learnerTimeIdx: index('learner_timeline_learner_time_idx').on(t.learnerId, t.occurredAt),
  })
)
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @kanji-learn/db typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): add study plans, study log, shared goals, universal knowledge graph tables"
```

---

### Task 4: Alter existing tables (device_type columns, mnemonic cocreation fields, telemetry tables)

**Files:**
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Add `deviceType` column to reviewSessions**

In the existing `reviewSessions` definition, add before the closing brace of the columns object:

```typescript
    deviceType: deviceTypeEnum('device_type'),
```

- [ ] **Step 2: Add `deviceType` column to reviewLogs**

In the existing `reviewLogs` definition, add before the closing brace of the columns object:

```typescript
    deviceType: deviceTypeEnum('device_type'),
```

- [ ] **Step 3: Add `deviceType` column to testSessions**

In the existing `testSessions` definition, add before the closing brace of the columns object:

```typescript
    deviceType: deviceTypeEnum('device_type'),
```

- [ ] **Step 4: Add cocreation columns to mnemonics**

In the existing `mnemonics` definition, add before the closing brace of the columns object:

```typescript
    generationMethod: mnemonicGenerationMethodEnum('generation_method').notNull().default('system'),
    locationType: text('location_type'),
    // Nullable jsonb — Drizzle already infers `T | null` from the missing .notNull().
    cocreationContext: jsonb('cocreation_context').$type<{
      questions: string[]
      answers: string[]
      timeOfDay?: string
    }>(),
    // effectivenessScore is only meaningful once reinforcementCount > 0;
    // the 0.5 default is a placeholder for freshly-created mnemonics.
    effectivenessScore: real('effectiveness_score').notNull().default(0.5),
    lastReinforcedAt: timestamp('last_reinforced_at', { withTimezone: true }),
    reinforcementCount: integer('reinforcement_count').notNull().default(0),
```

- [ ] **Step 5: Add `onboardingCompletedAt` to userProfiles**

In the existing `userProfiles` definition, add before `createdAt`:

```typescript
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
```

- [ ] **Step 6: Append buddy_llm_telemetry and buddy_llm_usage tables**

```typescript
// ─── buddy_llm_telemetry ──────────────────────────────────────────────────────
// Per-call latency, provider, tier, tokens, success/failure. Used for dashboards.

export const buddyLlmTelemetry = pgTable(
  'buddy_llm_telemetry',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id').references(() => userProfiles.id, { onDelete: 'set null' }),
    tier: llmTierEnum('tier').notNull(),
    providerName: text('provider_name').notNull(),
    requestContext: text('request_context').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull(),
    success: boolean('success').notNull(),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerTimeIdx: index('buddy_llm_telemetry_provider_time_idx').on(t.providerName, t.createdAt),
    userTimeIdx: index('buddy_llm_telemetry_user_time_idx').on(t.userId, t.createdAt),
  })
)

// ─── buddy_llm_usage ──────────────────────────────────────────────────────────
// Per-user daily counters enforced by the rate limiter.

export const buddyLlmUsage = pgTable(
  'buddy_llm_usage',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    usageDate: text('usage_date').notNull(), // YYYY-MM-DD in user tz
    tier: llmTierEnum('tier').notNull(),
    callCount: integer('call_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.usageDate, t.tier] }),
  })
)
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @kanji-learn/db typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "feat(db): alter existing tables for buddy; add llm telemetry and usage tables"
```

---

### Task 5: Generate and apply migration

**Files:**
- Create (generated): `packages/db/drizzle/0008_<drizzle-kit-name>.sql`

- [ ] **Step 1: Generate migration from schema**

Run: `pnpm --filter @kanji-learn/db db:generate`
Expected: a new SQL file in `packages/db/drizzle/` (e.g. `0008_<name>.sql`) and an updated `meta/_journal.json`.

- [ ] **Step 2: Inspect the generated SQL**

Open the new SQL file and verify:
- All 15 new tables are created (`learner_profiles`, `learner_state_cache`, `buddy_conversations`, `buddy_nudges`, `study_plans`, `study_plan_events`, `study_log_entries`, `shared_goals`, `learner_identity`, `learner_profile_universal`, `learner_connections`, `learner_memory_artifacts`, `learner_knowledge_state`, `learner_app_grants`, `learner_timeline_events`, `buddy_llm_telemetry`, `buddy_llm_usage`) — that's 17 total including telemetry/usage.
- All 8 new enums are declared.
- `ALTER TABLE review_sessions ADD COLUMN device_type ...` (and the same for `review_logs`, `kl_test_sessions`).
- `ALTER TABLE mnemonics ADD COLUMN generation_method ...` plus the other 5 mnemonic columns.
- `ALTER TABLE user_profiles ADD COLUMN onboarding_completed_at ...`.

If anything is missing, fix the schema and re-run `db:generate`. Delete the incomplete migration file before re-generating.

- [ ] **Step 3: Point DATABASE_URL at a dev database and apply**

```bash
export DATABASE_URL="postgres://..."  # dev / local Supabase
pnpm --filter @kanji-learn/db db:migrate
```

Expected: migration applies cleanly. No errors.

- [ ] **Step 4: Verify table creation in the database**

Run a sanity query via `psql` or Supabase SQL editor:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'learner_profiles', 'learner_state_cache', 'buddy_conversations',
    'buddy_nudges', 'study_plans', 'study_plan_events', 'study_log_entries',
    'shared_goals', 'learner_identity', 'learner_profile_universal',
    'learner_connections', 'learner_memory_artifacts', 'learner_knowledge_state',
    'learner_app_grants', 'learner_timeline_events',
    'buddy_llm_telemetry', 'buddy_llm_usage'
  )
ORDER BY table_name;
```

Expected: 17 rows returned.

- [ ] **Step 5: Commit**

```bash
git add packages/db/drizzle/
git commit -m "feat(db): generate phase 0 foundation migration"
```

---

## Section B — Shared Types

### Task 6: Buddy domain types in packages/shared

**Files:**
- Create: `packages/shared/src/buddy-types.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `packages/shared/src/buddy-types.ts`**

```typescript
// packages/shared/src/buddy-types.ts
// Buddy domain types shared between API and mobile app.
//
// Most of these mirror columns in the Buddy tables in packages/db/src/schema.ts
// (camelCase here, snake_case in the DB via Drizzle column mappings). A few
// exceptions are called out inline:
//   - LearnerStateCache matches the `learner_state_cache` row shape.
//   - StudyPlan.scaffoldLevel uses the string form; the DB column is a
//     smallint encoding — see the comment on StudyPlan.
//   - CoCreationSession is an in-memory session shape used during
//     co-created mnemonic flows. It is not persisted directly; the final
//     result is stored on `mnemonics.cocreation_context` (jsonb).

export type BuddyScreen =
  | 'dashboard'
  | 'study'
  | 'journal'
  | 'write'
  | 'speak'
  | 'progress'

export type NudgeType =
  | 'encouragement'
  | 'activity_suggestion'
  | 'leech_alert'
  | 'milestone'
  | 'streak'
  | 'mnemonic_refresh'
  | 'study_plan'
  | 'social_peer'
  | 'social_challenge'
  | 'social_rescue'

export type DeviceType = 'iphone' | 'ipad' | 'watch'

export type DeliveryTarget = 'app' | 'watch' | 'push' | 'all'

export type GeneratedBy = 'template' | 'on_device' | 'cloud'

export type BuddyMood = 'celebratory' | 'supportive' | 'challenging' | 'concerned'

export type VelocityTrend =
  | 'accelerating'
  | 'steady'
  | 'decelerating'
  | 'inactive'

export type WeakestModality =
  | 'meaning'
  | 'reading'
  | 'writing'
  | 'voice'
  | 'compound'

// Canonical scaffold level. Matches `learner_state_cache.scaffold_level` (text)
// and the API-internal ScaffoldLevel declared in
// apps/api/src/services/buddy/constants.ts (Task 15). The `study_plans`
// table stores this as a smallint encoding — the mapping lives in the
// StudyPlanService mapper (Phase 1).
export type ScaffoldLevel = 'heavy' | 'medium' | 'light'

export type BuddyPersonalityPref = 'encouraging' | 'direct' | 'playful'

export type StudyLogMood =
  | 'aha'
  | 'struggle'
  | 'breakthrough'
  | 'fun'
  | 'confused'

export type NudgeActionType =
  | 'navigate'
  | 'start_drill'
  | 'view_kanji'
  | 'generate_mnemonic'
  | 'dismiss'
  | 'none'

export type ActivityType =
  | 'flashcard_review'
  | 'new_kanji'
  | 'quiz'
  | 'writing'
  | 'voice'
  | 'leech_drill'
  | 'mnemonic_review'
  | 'confused_pair_drill'

export interface FriendComparison {
  friendId: string
  displayName: string
  metric: string
  value: number
  delta: number
}

export interface Milestone {
  type: string
  achievedAt: string
  payload: Record<string, unknown>
}

export interface StudyPatterns {
  preferredTime?: 'morning' | 'midday' | 'evening' | 'night'
  avgSessionsPerDay: number
  weekendVsWeekdayRatio: number
}

// Mirrors `learner_state_cache` in packages/db/src/schema.ts. Field names
// match the Drizzle table one-to-one so the service layer can pass rows
// through with minimal mapping. Keep in sync with the DB.
//
// Note: the transient `ComputedLearnerState` produced by LearnerStateService
// (Task 16) uses `computedAt` as its own field name and maps it to
// `updatedAt` on write. The two types intentionally serve different layers —
// do not unify them.
export interface LearnerStateCache {
  userId: string
  updatedAt: Date
  currentStreakDays: number
  longestStreakDays: number
  velocityTrend: VelocityTrend
  totalKanjiSeen: number
  totalKanjiBurned: number
  activeLeechCount: number
  leechKanjiIds: number[]
  weakestModality: WeakestModality
  strongestJlptLevel?: 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
  currentFocusLevel?: 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
  recentAccuracy: number // 0–1, average across modalities
  lastSessionAt?: Date
  avgDailyReviews: number
  avgSessionDurationMs: number
  daysSinceLastSession: number
  daysSinceFirstSession: number
  quizVsSrsGapHigh: boolean
  primaryDevice?: DeviceType
  deviceDistribution: Partial<Record<DeviceType, number>>
  watchSessionAvgCards?: number
  recentMilestones: Milestone[]
  studyPatterns: StudyPatterns
  nextRecommendedActivity?: string
  buddyMood: BuddyMood
  scaffoldLevel: ScaffoldLevel
  friendsCount: number
  activeFriendsToday: number
  friendsAheadOnBurn: FriendComparison[]
  friendsBehindOnBurn: FriendComparison[]
  friendsAheadOnStreak: FriendComparison[]
  friendsBehindOnStreak: FriendComparison[]
  userStrengthsVsFriends: Record<string, string>
  groupMomentum?: 'rising' | 'steady' | 'falling'
}

export interface BuddyNudge {
  id: string
  userId: string
  screen: BuddyScreen
  nudgeType: NudgeType
  content: string
  watchSummary?: string
  actionType?: NudgeActionType
  actionPayload?: Record<string, unknown>
  priority: number
  deliveryTarget: DeliveryTarget
  watchDeliveredAt?: Date
  pushDeliveredAt?: Date
  expiresAt: Date
  dismissedAt?: Date
  generatedBy: GeneratedBy
  deviceType?: DeviceType
  socialFraming: boolean
  createdAt: Date
}

export interface StudyActivity {
  order: number
  type: ActivityType
  kanjiIds?: number[]
  duration: number // minutes
  reason: string
  loopStage: 1 | 2 | 3 | 4 | 5
  socialFraming?: boolean
  completed: boolean
  skipped: boolean
}

// Domain shape for a study plan. The DB column `study_plans.scaffold_level`
// is a smallint; the mapping between that integer and the string
// ScaffoldLevel lives in the StudyPlanService mapper (Phase 1).
export interface StudyPlan {
  id: string
  userId: string
  activities: StudyActivity[]
  rationale: string
  scaffoldLevel: ScaffoldLevel
  generatedAt: Date
  deviceType?: DeviceType
  completedCount: number
  skippedCount: number
  expiresAt: Date
}

export interface StudyLogEntry {
  id: string
  userId: string
  kanjiId: number
  mnemonicId?: string
  userNote?: string
  exampleSentence?: string
  sentenceReading?: string
  sentenceTranslation?: string
  photoUrls: string[]
  audioNoteUrl?: string
  locationLat?: number
  locationLng?: number
  locationName?: string
  tags: string[]
  mood?: StudyLogMood
  sharedWithFriends: boolean
  createdAt: Date
  updatedAt: Date
  lastViewedAt?: Date
}

// In-memory shape tracked by the Buddy co-creation flow while a user
// builds a personal mnemonic. Not a DB row: the finished mnemonic is
// written to `mnemonics.cocreation_context` (jsonb). Phase 0 defines
// the type so API/mobile stay aligned when the flow is implemented.
export interface CoCreationSession {
  id: string
  userId: string
  kanjiId: number
  stage:
    | 'consent'
    | 'location_inference'
    | 'detail_elicitation'
    | 'assembly'
    | 'commitment'
  location?: {
    lat: number
    lng: number
    name: string
    type: string
  }
  questions: string[]
  answers: string[]
  draftMnemonic?: string
  finalMnemonic?: string
  startedAt: Date
  completedAt?: Date
}
```

- [ ] **Step 2: Re-export from the shared index**

Modify `packages/shared/src/index.ts`:

```typescript
export * from './types'
export * from './srs'
export * from './placement'
export * from './constants'
export * from './buddy-types'
```

(If `packages/shared/src/index.ts` already uses a different form of re-export — e.g. explicit `export { ... } from` lines — follow the existing convention and add `buddy-types` in the same style.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @kanji-learn/shared typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/buddy-types.ts packages/shared/src/index.ts
git commit -m "feat(shared): add buddy domain types"
```

---

### Task 7: LLM types in packages/shared

**Files:**
- Create: `packages/shared/src/llm-types.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `packages/shared/src/llm-types.ts`**

```typescript
// packages/shared/src/llm-types.ts
// Provider-agnostic LLM types. Usable from server and client.

export type JSONSchema = Record<string, unknown>

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: JSONSchema
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

// Phase 0 never constructs a ToolResult — tool-result round-trips come
// in Phase 1. The type exists so the Message union is shape-complete,
// but provider adapters in Tasks 11–13 drop `role: 'tool'` messages.
export interface ToolResult {
  toolCallId: string
  content: string | Record<string, unknown>
  isError?: boolean
}

export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolResults: ToolResult[] }

export interface CompletionRequest {
  systemPrompt?: string
  messages: Message[]
  tools?: ToolDefinition[]
  maxTokens: number
  temperature: number
  responseFormat?: 'text' | 'json'
}

export type FinishReason = 'stop' | 'length' | 'tool_use' | 'safety'

export interface CompletionResult {
  /**
   * Assistant text. Optional because a pure tool-call response (finishReason
   * === 'tool_use') carries no text. Providers MAY emit `''` instead of
   * omitting the field; both are valid.
   */
  content?: string
  toolCalls?: ToolCall[]
  finishReason: FinishReason
  inputTokens: number
  outputTokens: number
  providerName: string
  latencyMs: number
}

export interface LLMProvider {
  readonly name: string
  readonly supportsToolCalling: boolean
  readonly maxContextTokens: number
  /** Expected p50 latency for a ~500-token completion, in milliseconds. */
  readonly estimatedLatencyMs: number
  /** Cost per input token in USD (e.g. 0.000003 for $3 / 1M tokens). */
  readonly costPerInputToken: number
  /** Cost per output token in USD (e.g. 0.000015 for $15 / 1M tokens). */
  readonly costPerOutputToken: number

  generateCompletion(request: CompletionRequest): Promise<CompletionResult>
  isAvailable(): Promise<boolean>
}
```

- [ ] **Step 2: Re-export from `packages/shared/src/index.ts`**

Add:

```typescript
export * from './llm-types'
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @kanji-learn/shared typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/llm-types.ts packages/shared/src/index.ts
git commit -m "feat(shared): add llm provider interface types"
```

---

## Section C — LLM Layer

### Task 8: Install Vitest and add test scaffolding

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/test/setup.ts`
- Create: `apps/api/.env.test.example`

- [ ] **Step 1: Add Vitest and supporting dev deps**

```bash
pnpm --filter @kanji-learn/api add -D vitest @vitest/ui dotenv
```

Expected: `package.json` updated with `vitest` and `@vitest/ui`. A pnpm lock update.

- [ ] **Step 2: Add a `test` script to `apps/api/package.json`**

In the `scripts` object, add:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui"
```

- [ ] **Step 3: Create `apps/api/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 15000,
  },
})
```

- [ ] **Step 4: Create `apps/api/test/setup.ts`**

```typescript
// apps/api/test/setup.ts
// Loaded before every test file. Reads .env.test, exposes a shared test db.

import { config } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// `apps/api` is ESM, so __dirname is not available — reconstruct it.
const __dirname = resolve(fileURLToPath(import.meta.url), '..')

config({ path: resolve(__dirname, '../.env.test') })

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Copy apps/api/.env.test.example to apps/api/.env.test and fill in TEST_DATABASE_URL.'
  )
}

// Override DATABASE_URL with the test URL for any code that reads it
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
```

- [ ] **Step 5: Create `apps/api/.env.test.example`**

```
# Copy to apps/api/.env.test and fill in values.
# Matches the local dev Postgres in docker-compose.yml (user kanji,
# password kanji, host port 5433, dedicated test database).
TEST_DATABASE_URL=postgres://kanji:kanji@localhost:5433/kanji_buddy_test
GROQ_API_KEY=test-fake-key
GEMINI_API_KEY=test-fake-key
ANTHROPIC_API_KEY=test-fake-key
LLM_PRIMARY_TIER2_PROVIDER=groq
BUDDY_TIER2_DAILY_CAP_PER_USER=50
BUDDY_TIER3_DAILY_CAP_PER_USER=2
```

> Note: `.env.test` contains credentials (even if they are local dev fakes)
> and must not be committed. Ensure it is covered by `.gitignore` — in this
> repo the root `.gitignore` explicitly lists `.env.test`. Only the
> `.env.test.example` template goes into git.
>
> `apps/api/tsconfig.json` must include the `test` directory so
> `pnpm --filter @kanji-learn/api typecheck` catches type errors in tests.
> Keep `apps/api/tsconfig.build.json` scoped to `src` so test files do not
> land in `dist/`.

- [ ] **Step 6: Create a sanity test to prove the runner works**

Create `apps/api/test/unit/sanity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

describe('sanity', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 7: Run the test**

```bash
cp apps/api/.env.test.example apps/api/.env.test
# edit apps/api/.env.test to point TEST_DATABASE_URL at a real test db
pnpm --filter @kanji-learn/api test
```

Expected: `sanity.test.ts` passes. One test, one assertion.

- [ ] **Step 8: Commit**

```bash
git add apps/api/package.json apps/api/vitest.config.ts apps/api/test/ apps/api/.env.test.example pnpm-lock.yaml
git commit -m "chore(api): add vitest and test scaffolding"
```

---

### Task 9: LLM server-side types and BuddyLLMError

**Files:**
- Create: `apps/api/src/services/llm/types.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/unit/llm/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { BuddyLLMError, classifyTier } from '../../../src/services/llm/types'
import type { BuddyRequest } from '../../../src/services/llm/types'

describe('BuddyLLMError', () => {
  it('captures the wrapped cause', () => {
    const cause = new Error('boom')
    const err = new BuddyLLMError('All providers failed', cause)
    expect(err.message).toBe('All providers failed')
    expect(err.cause).toBe(cause)
    expect(err.name).toBe('BuddyLLMError')
  })

  it('sets cause as a non-enumerable property (matches native Error.cause)', () => {
    const cause = new Error('boom')
    const err = new BuddyLLMError('wrap', cause)
    const descriptor = Object.getOwnPropertyDescriptor(err, 'cause')
    expect(descriptor?.enumerable).toBe(false)
    expect(JSON.stringify(err)).not.toContain('cause')
  })
})

describe('classifyTier', () => {
  const base: BuddyRequest = {
    context: 'encouragement',
    userId: 'u1',
    messages: [],
  }

  it('returns 1 for simple template-like contexts', () => {
    expect(classifyTier({ ...base, context: 'encouragement' })).toBe(1)
    expect(classifyTier({ ...base, context: 'streak_message' })).toBe(1)
    expect(classifyTier({ ...base, context: 'milestone_celebration' })).toBe(1)
    expect(classifyTier({ ...base, context: 'session_summary' })).toBe(1)
  })

  it('returns 3 for deep-reasoning contexts', () => {
    expect(classifyTier({ ...base, context: 'mnemonic_cocreation' })).toBe(3)
    expect(classifyTier({ ...base, context: 'deep_diagnostic' })).toBe(3)
  })

  it('returns 2 for everything else', () => {
    expect(classifyTier({ ...base, context: 'study_plan_generation' })).toBe(2)
    expect(classifyTier({ ...base, context: 'leech_diagnostic' })).toBe(2)
    expect(classifyTier({ ...base, context: 'mnemonic_question_generation' })).toBe(2)
    expect(classifyTier({ ...base, context: 'mnemonic_assembly' })).toBe(2)
    expect(classifyTier({ ...base, context: 'social_nudge' })).toBe(2)
  })

  it('preferredTier overrides context-based classification', () => {
    // context would classify as tier 1, but preferredTier forces 3
    expect(
      classifyTier({ ...base, context: 'encouragement', preferredTier: 3 })
    ).toBe(3)
    // context would classify as tier 3, but preferredTier forces 1
    expect(
      classifyTier({ ...base, context: 'deep_diagnostic', preferredTier: 1 })
    ).toBe(1)
    // tier-2 override on a tier-1 context
    expect(
      classifyTier({ ...base, context: 'session_summary', preferredTier: 2 })
    ).toBe(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- llm/types`
Expected: FAIL with "Cannot find module '../../../src/services/llm/types'".

- [ ] **Step 3: Create the implementation**

Create `apps/api/src/services/llm/types.ts`:

```typescript
import type { Message, ToolDefinition } from '@kanji-learn/shared'

export type RequestContext =
  | 'encouragement'
  | 'streak_message'
  | 'milestone_celebration'
  | 'session_summary'
  | 'study_plan_generation'
  | 'leech_diagnostic'
  | 'mnemonic_question_generation'
  | 'mnemonic_assembly'
  | 'mnemonic_cocreation'
  | 'deep_diagnostic'
  | 'social_nudge'

export interface BuddyRequest {
  context: RequestContext
  userId: string
  /**
   * Optional to mirror CompletionRequest.systemPrompt in @kanji-learn/shared.
   * Callers that don't need a system prompt should omit this rather than
   * passing ''. The router decides whether to forward a system turn.
   */
  systemPrompt?: string
  /**
   * `readonly` so the router (Task 14) must copy before truncating —
   * prevents accidental in-place mutation of the caller's array.
   */
  messages: readonly Message[]
  tools?: ToolDefinition[]
  preferredTier?: 1 | 2 | 3
  userOptedInPremium?: boolean
  maxTokens?: number
  temperature?: number
}

export class BuddyLLMError extends Error {
  constructor(message: string, cause?: unknown) {
    // Forward to the ES2022 Error constructor so `.cause` is stored as the
    // native non-enumerable own property. Declaring our own `cause` field
    // would shadow the native slot with an enumerable property and leak
    // the chain into JSON.stringify/structured loggers.
    super(message, { cause })
    this.name = 'BuddyLLMError'
  }
}

const TIER1_CONTEXTS: readonly RequestContext[] = [
  'encouragement',
  'streak_message',
  'milestone_celebration',
  'session_summary',
]

const TIER3_CONTEXTS: readonly RequestContext[] = [
  'mnemonic_cocreation',
  'deep_diagnostic',
]

export function classifyTier(request: BuddyRequest): 1 | 2 | 3 {
  if (request.preferredTier) return request.preferredTier
  if (TIER1_CONTEXTS.includes(request.context)) return 1
  if (TIER3_CONTEXTS.includes(request.context)) return 3
  return 2
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @kanji-learn/api test -- llm/types`
Expected: PASS — 1 test file, 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/llm/types.ts apps/api/test/unit/llm/types.test.ts
git commit -m "feat(api): add llm request context types and tier classification"
```

---

### Task 10: Per-user LLM rate limiter

**Files:**
- Create: `apps/api/src/services/llm/rate-limit.ts`
- Create: `apps/api/test/unit/llm/rate-limit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/unit/llm/rate-limit.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@kanji-learn/db'
import { sql } from 'drizzle-orm'
import { RateLimiter } from '../../../src/services/llm/rate-limit'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

// Use a fixed user id for these tests
const TEST_USER = '00000000-0000-0000-0000-000000000001'

async function resetUsage() {
  await db.execute(sql`DELETE FROM buddy_llm_usage WHERE user_id = ${TEST_USER}`)
}

async function ensureUser() {
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES (${TEST_USER}, 'Test User', 'UTC')
    ON CONFLICT DO NOTHING
  `)
}

describe('RateLimiter', () => {
  beforeEach(async () => {
    await ensureUser()
    await resetUsage()
  })

  it('allows calls under the cap', async () => {
    const limiter = new RateLimiter(db, { tier2DailyCap: 3, tier3DailyCap: 1 })
    expect(await limiter.tryConsume(TEST_USER, 2)).toBe(true)
    expect(await limiter.tryConsume(TEST_USER, 2)).toBe(true)
    expect(await limiter.tryConsume(TEST_USER, 2)).toBe(true)
  })

  it('blocks calls over the cap', async () => {
    const limiter = new RateLimiter(db, { tier2DailyCap: 2, tier3DailyCap: 1 })
    expect(await limiter.tryConsume(TEST_USER, 2)).toBe(true)
    expect(await limiter.tryConsume(TEST_USER, 2)).toBe(true)
    expect(await limiter.tryConsume(TEST_USER, 2)).toBe(false)
  })

  it('tracks tier 3 separately from tier 2', async () => {
    const limiter = new RateLimiter(db, { tier2DailyCap: 1, tier3DailyCap: 1 })
    expect(await limiter.tryConsume(TEST_USER, 2)).toBe(true)
    expect(await limiter.tryConsume(TEST_USER, 3)).toBe(true)
    expect(await limiter.tryConsume(TEST_USER, 2)).toBe(false)
    expect(await limiter.tryConsume(TEST_USER, 3)).toBe(false)
  })

  it('tier 1 is never limited', async () => {
    const limiter = new RateLimiter(db, { tier2DailyCap: 0, tier3DailyCap: 0 })
    for (let i = 0; i < 10; i++) {
      expect(await limiter.tryConsume(TEST_USER, 1)).toBe(true)
    }
  })

  it('remainingForTier reports a sensible number', async () => {
    const limiter = new RateLimiter(db, { tier2DailyCap: 5, tier3DailyCap: 1 })
    await limiter.tryConsume(TEST_USER, 2)
    await limiter.tryConsume(TEST_USER, 2)
    expect(await limiter.remainingForTier(TEST_USER, 2)).toBe(3)
  })

  it('concurrent bursts at the cap boundary never over-consume', async () => {
    // Regression test for the atomic DO UPDATE WHERE pattern.
    const cap = 5
    const limiter = new RateLimiter(db, { tier2DailyCap: cap, tier3DailyCap: 1 })
    const burst = 25
    const results = await Promise.all(
      Array.from({ length: burst }, () => limiter.tryConsume(TEST_USER, 2))
    )
    const allowed = results.filter((r) => r === true).length
    expect(allowed).toBe(cap)

    const remaining = await limiter.remainingForTier(TEST_USER, 2)
    expect(remaining).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test — it should fail on import**

Run: `pnpm --filter @kanji-learn/api test -- llm/rate-limit`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/api/src/services/llm/rate-limit.ts`**

```typescript
import { and, eq, sql } from 'drizzle-orm'
import { buddyLlmUsage } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'

export interface RateLimiterOptions {
  tier2DailyCap: number
  tier3DailyCap: number
}

/**
 * Per-user daily LLM rate limiter backed by the `buddy_llm_usage` table.
 *
 * **Day boundary:** all "days" are UTC. This is an intentional Phase 0
 * simplification — per-user-timezone day boundaries are deferred until we
 * plumb `userProfiles.timezone` through the router in a later phase.
 *
 * **Error policy:** `tryConsume` propagates db errors. The caller
 * (`BuddyLLMRouter`) owns fail-open vs. fail-closed policy.
 */
export class RateLimiter {
  constructor(private db: Db, private options: RateLimiterOptions) {}

  /**
   * Atomically increments usage for the given (user, tier, today) row.
   * Uses a single `INSERT ... ON CONFLICT DO UPDATE ... WHERE call_count < cap`
   * so the cap is enforced in one round-trip with no compensating write.
   * When the WHERE suppresses the update, RETURNING emits zero rows — the
   * "blocked" signal. Tier 1 is never limited.
   */
  async tryConsume(userId: string, tier: 1 | 2 | 3): Promise<boolean> {
    if (tier === 1) return true
    const cap = tier === 2 ? this.options.tier2DailyCap : this.options.tier3DailyCap
    if (cap <= 0) return false

    const today = this.todayIsoDate()
    const tierStr = `tier${tier}` as 'tier2' | 'tier3'

    const rows = await this.db
      .insert(buddyLlmUsage)
      .values({ userId, usageDate: today, tier: tierStr, callCount: 1 })
      .onConflictDoUpdate({
        target: [buddyLlmUsage.userId, buddyLlmUsage.usageDate, buddyLlmUsage.tier],
        set: {
          callCount: sql`${buddyLlmUsage.callCount} + 1`,
          updatedAt: sql`now()`,
        },
        where: sql`${buddyLlmUsage.callCount} < ${cap}`,
      })
      .returning({ callCount: buddyLlmUsage.callCount })

    return rows.length > 0
  }

  async remainingForTier(userId: string, tier: 2 | 3): Promise<number> {
    const cap = tier === 2 ? this.options.tier2DailyCap : this.options.tier3DailyCap
    const today = this.todayIsoDate()
    const tierStr = `tier${tier}` as 'tier2' | 'tier3'

    const row = await this.db.query.buddyLlmUsage.findFirst({
      where: and(
        eq(buddyLlmUsage.userId, userId),
        eq(buddyLlmUsage.usageDate, today),
        eq(buddyLlmUsage.tier, tierStr)
      ),
    })
    return Math.max(0, cap - (row?.callCount ?? 0))
  }

  private todayIsoDate(): string {
    return new Date().toISOString().slice(0, 10)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @kanji-learn/api test -- llm/rate-limit`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/llm/rate-limit.ts apps/api/test/unit/llm/rate-limit.test.ts
git commit -m "feat(api): add per-user daily llm rate limiter"
```

---

### Task 11: Groq provider

**Files:**
- Create: `apps/api/src/services/llm/providers/groq.ts`
- Create: `apps/api/test/unit/llm/providers/groq.test.ts`

- [ ] **Step 1: Install the Groq SDK**

```bash
pnpm --filter @kanji-learn/api add groq-sdk
```

- [ ] **Step 2: Write the failing test (mocks the Groq SDK)**

Create `apps/api/test/unit/llm/providers/groq.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GroqProvider } from '../../../../src/services/llm/providers/groq'

// Mock the groq-sdk module.
// Note: the default export must be a function expression (not an arrow
// function) because the implementation calls `new Groq(...)` and vitest 4
// uses Reflect.construct on the mock — arrow functions aren't constructors.
vi.mock('groq-sdk', () => {
  const createMock = vi.fn()
  return {
    default: vi.fn().mockImplementation(function () {
      return { chat: { completions: { create: createMock } } }
    }),
    __createMock: createMock,
  }
})

import * as groqModule from 'groq-sdk'
const createMock = (groqModule as unknown as { __createMock: ReturnType<typeof vi.fn> }).__createMock

describe('GroqProvider', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('exposes the expected metadata', () => {
    const provider = new GroqProvider({ apiKey: 'test' })
    expect(provider.name).toBe('groq')
    expect(provider.maxContextTokens).toBe(128_000)
    expect(provider.supportsToolCalling).toBe(true)
    expect(provider.costPerInputToken).toBe(0)
    expect(provider.costPerOutputToken).toBe(0)
  })

  it('generateCompletion calls the SDK and maps the response', async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: { role: 'assistant', content: 'hello world' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 5 },
    })

    const provider = new GroqProvider({ apiKey: 'test' })
    const result = await provider.generateCompletion({
      systemPrompt: 'You are a test',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
      temperature: 0.5,
    })

    expect(result.content).toBe('hello world')
    expect(result.inputTokens).toBe(12)
    expect(result.outputTokens).toBe(5)
    expect(result.finishReason).toBe('stop')
    expect(result.providerName).toBe('groq')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)

    expect(createMock).toHaveBeenCalledTimes(1)
    const call = createMock.mock.calls[0][0]
    expect(call.model).toBe('llama-3.3-70b-versatile')
    expect(call.messages[0]).toEqual({ role: 'system', content: 'You are a test' })
    expect(call.messages[1]).toEqual({ role: 'user', content: 'hi' })
    expect(call.max_tokens).toBe(100)
    expect(call.temperature).toBe(0.5)
  })

  it('isAvailable returns true when an api key is present', async () => {
    const provider = new GroqProvider({ apiKey: 'test' })
    expect(await provider.isAvailable()).toBe(true)
  })

  it('isAvailable returns false when api key is empty', async () => {
    const provider = new GroqProvider({ apiKey: '' })
    expect(await provider.isAvailable()).toBe(false)
  })

  it('wraps SDK errors in BuddyLLMError', async () => {
    createMock.mockRejectedValue(new Error('429 rate limit'))
    const provider = new GroqProvider({ apiKey: 'test' })
    await expect(
      provider.generateCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
        temperature: 0,
      })
    ).rejects.toThrow('Groq request failed')
  })
})
```

- [ ] **Step 3: Run the test — it should fail on import**

Run: `pnpm --filter @kanji-learn/api test -- llm/providers/groq`
Expected: FAIL — module not found.

- [ ] **Step 4: Create `apps/api/src/services/llm/providers/groq.ts`**

```typescript
import Groq, { APIError } from 'groq-sdk'
import type {
  CompletionRequest,
  CompletionResult,
  FinishReason,
  LLMProvider,
} from '@kanji-learn/shared'
import { BuddyLLMError } from '../types'

export interface GroqProviderOptions {
  apiKey: string
  model?: string
}

const DEFAULT_MODEL = 'llama-3.3-70b-versatile'

/**
 * Tier 1 provider: Llama-3.3-70b-versatile via Groq.
 *
 * **Latency semantics:** latencyMs reflects the successful call's wall-clock
 * time. On error, the router (Task 14) owns latency timing for telemetry.
 *
 * **Tool calling:** supportsToolCalling is true but Phase 0 does not parse
 * tool_calls into CompletionResult.toolCalls. Callers that send tools will
 * receive finishReason 'tool_use' with no tool calls populated. Tool-call
 * round-trips are Phase 1 work.
 */
export class GroqProvider implements LLMProvider {
  readonly name = 'groq'
  readonly supportsToolCalling = true
  readonly maxContextTokens = 128_000
  /** ~p50 for a 500-token Llama-3.3-70b completion on Groq free tier. */
  readonly estimatedLatencyMs = 400
  readonly costPerInputToken = 0
  readonly costPerOutputToken = 0

  private client: Groq | undefined
  private model: string

  constructor(private options: GroqProviderOptions) {
    this.model = options.model ?? DEFAULT_MODEL
    // Defer SDK construction: the Groq SDK throws synchronously when apiKey
    // is undefined, which would bypass BuddyLLMError wrapping. Lazy init
    // means an un-configured provider can still be constructed and rejected
    // cleanly via isAvailable().
  }

  async isAvailable(): Promise<boolean> {
    return typeof this.options.apiKey === 'string' && this.options.apiKey.length > 0
  }

  async generateCompletion(request: CompletionRequest): Promise<CompletionResult> {
    const start = Date.now()
    try {
      const client = this.getClient()
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt })
      }
      for (const m of request.messages) {
        if (m.role === 'tool') continue // Phase 1 will handle tool-result round-trips
        messages.push({ role: m.role, content: m.content })
      }

      const response = await client.chat.completions.create({
        model: this.model,
        messages,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
      })

      if (!response.choices || response.choices.length === 0) {
        throw new BuddyLLMError('Groq returned no choices')
      }

      const choice = response.choices[0]
      return {
        // Preserve the distinction between "empty string" and "no text at all"
        // (e.g., a pure tool-call response has null content).
        content: choice?.message?.content ?? undefined,
        finishReason: this.mapFinishReason(choice?.finish_reason ?? null),
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        providerName: this.name,
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      if (err instanceof BuddyLLMError) throw err
      const status = err instanceof APIError ? err.status : undefined
      const suffix = status !== undefined ? ` (HTTP ${status})` : ''
      throw new BuddyLLMError(`Groq request failed${suffix}`, err)
    }
  }

  private getClient(): Groq {
    if (!this.client) {
      if (!this.options.apiKey) {
        throw new BuddyLLMError('Groq request failed: api key is missing')
      }
      this.client = new Groq({ apiKey: this.options.apiKey })
    }
    return this.client
  }

  private mapFinishReason(raw: string | null): FinishReason {
    switch (raw) {
      case 'stop':
        return 'stop'
      case 'length':
        return 'length'
      case 'tool_calls':
        return 'tool_use'
      case 'content_filter':
        return 'safety'
      default:
        return 'stop'
    }
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @kanji-learn/api test -- llm/providers/groq`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/services/llm/providers/groq.ts apps/api/test/unit/llm/providers/groq.test.ts
git commit -m "feat(api): add groq llm provider"
```

---

### Task 12: Gemini provider

**Files:**
- Create: `apps/api/src/services/llm/providers/gemini.ts`
- Create: `apps/api/test/unit/llm/providers/gemini.test.ts`

- [ ] **Step 1: Install the Gemini SDK**

```bash
pnpm --filter @kanji-learn/api add @google/generative-ai
```

- [ ] **Step 2: Write the failing test**

Create `apps/api/test/unit/llm/providers/gemini.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GeminiProvider } from '../../../../src/services/llm/providers/gemini'

// Note: GoogleGenerativeAI is invoked with `new ...` in the impl, so the
// mock must be a function expression (not an arrow) — vitest 4 uses
// Reflect.construct on the mock and arrow functions aren't constructors.
vi.mock('@google/generative-ai', () => {
  const generateContentMock = vi.fn()
  const getGenerativeModelMock = vi.fn(() => ({ generateContent: generateContentMock }))
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(function () {
      return { getGenerativeModel: getGenerativeModelMock }
    }),
    __generateContentMock: generateContentMock,
  }
})

import * as geminiModule from '@google/generative-ai'
const generateContentMock = (geminiModule as unknown as { __generateContentMock: ReturnType<typeof vi.fn> }).__generateContentMock

describe('GeminiProvider', () => {
  beforeEach(() => {
    generateContentMock.mockReset()
  })

  it('exposes the expected metadata', () => {
    const provider = new GeminiProvider({ apiKey: 'test' })
    expect(provider.name).toBe('gemini')
    expect(provider.maxContextTokens).toBe(1_048_576)
    expect(provider.supportsToolCalling).toBe(true)
    expect(provider.costPerInputToken).toBe(0)
  })

  it('generateCompletion calls the SDK and maps the response', async () => {
    generateContentMock.mockResolvedValue({
      response: {
        text: () => 'gemini response text',
        candidates: [{ finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 4 },
      },
    })

    const provider = new GeminiProvider({ apiKey: 'test' })
    const result = await provider.generateCompletion({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
      temperature: 0.3,
    })

    expect(result.content).toBe('gemini response text')
    expect(result.inputTokens).toBe(7)
    expect(result.outputTokens).toBe(4)
    expect(result.finishReason).toBe('stop')
    expect(result.providerName).toBe('gemini')
  })

  it('isAvailable reflects api key presence', async () => {
    expect(await new GeminiProvider({ apiKey: 'x' }).isAvailable()).toBe(true)
    expect(await new GeminiProvider({ apiKey: '' }).isAvailable()).toBe(false)
  })

  it('wraps sdk errors', async () => {
    generateContentMock.mockRejectedValue(new Error('gemini boom'))
    const provider = new GeminiProvider({ apiKey: 'test' })
    await expect(
      provider.generateCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
        temperature: 0,
      })
    ).rejects.toThrow('Gemini request failed')
  })
})
```

- [ ] **Step 3: Run the test — expect failure**

Run: `pnpm --filter @kanji-learn/api test -- llm/providers/gemini`
Expected: FAIL — module not found.

- [ ] **Step 4: Create `apps/api/src/services/llm/providers/gemini.ts`**

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai'
import type {
  CompletionRequest,
  CompletionResult,
  FinishReason,
  LLMProvider,
} from '@kanji-learn/shared'
import { BuddyLLMError } from '../types'

export interface GeminiProviderOptions {
  apiKey: string
  model?: string
}

const DEFAULT_MODEL = 'gemini-2.5-flash'

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini'
  readonly supportsToolCalling = true
  readonly maxContextTokens = 1_048_576
  readonly estimatedLatencyMs = 600
  readonly costPerInputToken = 0
  readonly costPerOutputToken = 0

  private client: GoogleGenerativeAI
  private model: string

  constructor(private options: GeminiProviderOptions) {
    this.client = new GoogleGenerativeAI(options.apiKey)
    this.model = options.model ?? DEFAULT_MODEL
  }

  async isAvailable(): Promise<boolean> {
    return typeof this.options.apiKey === 'string' && this.options.apiKey.length > 0
  }

  async generateCompletion(request: CompletionRequest): Promise<CompletionResult> {
    const start = Date.now()
    try {
      const model = this.client.getGenerativeModel({
        model: this.model,
        systemInstruction: request.systemPrompt,
        generationConfig: {
          maxOutputTokens: request.maxTokens,
          temperature: request.temperature,
        },
      })

      const prompt = request.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => (m as { content: string }).content)
        .join('\n')

      const response = await model.generateContent(prompt)
      const raw = response.response
      const text = raw.text()
      const finish = raw.candidates?.[0]?.finishReason ?? 'STOP'

      return {
        content: text,
        finishReason: this.mapFinishReason(finish),
        inputTokens: raw.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: raw.usageMetadata?.candidatesTokenCount ?? 0,
        providerName: this.name,
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      throw new BuddyLLMError('Gemini request failed', err)
    }
  }

  private mapFinishReason(raw: string): FinishReason {
    switch (raw) {
      case 'STOP':
        return 'stop'
      case 'MAX_TOKENS':
        return 'length'
      case 'SAFETY':
        return 'safety'
      default:
        return 'stop'
    }
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @kanji-learn/api test -- llm/providers/gemini`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/services/llm/providers/gemini.ts apps/api/test/unit/llm/providers/gemini.test.ts
git commit -m "feat(api): add gemini llm provider"
```

---

### Task 13: Claude provider and Apple FM server stub

**Files:**
- Create: `apps/api/src/services/llm/providers/claude.ts`
- Create: `apps/api/src/services/llm/providers/apple-foundation-stub.ts`
- Create: `apps/api/test/unit/llm/providers/claude.test.ts`

- [ ] **Step 1: Write the Claude provider failing test**

Create `apps/api/test/unit/llm/providers/claude.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClaudeProvider } from '../../../../src/services/llm/providers/claude'

// Note: the default export must be a function expression (not an arrow)
// because the impl calls `new Anthropic(...)` — vitest 4 uses
// Reflect.construct and arrow functions aren't constructors.
vi.mock('@anthropic-ai/sdk', () => {
  const createMock = vi.fn()
  return {
    default: vi.fn().mockImplementation(function () {
      return { messages: { create: createMock } }
    }),
    __createMock: createMock,
  }
})

import * as anthropicModule from '@anthropic-ai/sdk'
const createMock = (anthropicModule as unknown as { __createMock: ReturnType<typeof vi.fn> }).__createMock

describe('ClaudeProvider', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('exposes the expected metadata', () => {
    const provider = new ClaudeProvider({ apiKey: 'test' })
    expect(provider.name).toBe('claude')
    expect(provider.maxContextTokens).toBe(200_000)
    expect(provider.supportsToolCalling).toBe(true)
  })

  it('generateCompletion maps the Anthropic response', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'claude says hi' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 9, output_tokens: 6 },
    })

    const provider = new ClaudeProvider({ apiKey: 'test' })
    const result = await provider.generateCompletion({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
      temperature: 0.4,
    })

    expect(result.content).toBe('claude says hi')
    expect(result.inputTokens).toBe(9)
    expect(result.outputTokens).toBe(6)
    expect(result.finishReason).toBe('stop')
    expect(result.providerName).toBe('claude')
  })

  it('wraps errors', async () => {
    createMock.mockRejectedValue(new Error('anthropic boom'))
    const provider = new ClaudeProvider({ apiKey: 'test' })
    await expect(
      provider.generateCompletion({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 10,
        temperature: 0,
      })
    ).rejects.toThrow('Claude request failed')
  })
})
```

- [ ] **Step 2: Run the test — expect failure**

Run: `pnpm --filter @kanji-learn/api test -- llm/providers/claude`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/api/src/services/llm/providers/claude.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk'
import type {
  CompletionRequest,
  CompletionResult,
  FinishReason,
  LLMProvider,
} from '@kanji-learn/shared'
import { BuddyLLMError } from '../types'

export interface ClaudeProviderOptions {
  apiKey: string
  model?: string
}

const DEFAULT_MODEL = 'claude-sonnet-4-6'

export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude'
  readonly supportsToolCalling = true
  readonly maxContextTokens = 200_000
  readonly estimatedLatencyMs = 1_200
  readonly costPerInputToken = 0.000003
  readonly costPerOutputToken = 0.000015

  private client: Anthropic
  private model: string

  constructor(private options: ClaudeProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey })
    this.model = options.model ?? DEFAULT_MODEL
  }

  async isAvailable(): Promise<boolean> {
    return typeof this.options.apiKey === 'string' && this.options.apiKey.length > 0
  }

  async generateCompletion(request: CompletionRequest): Promise<CompletionResult> {
    const start = Date.now()
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        system: request.systemPrompt,
        messages: request.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: (m as { content: string }).content,
          })),
      })

      const textBlock = response.content.find((b) => b.type === 'text')
      const text = textBlock && textBlock.type === 'text' ? textBlock.text : ''

      return {
        content: text,
        finishReason: this.mapFinishReason(response.stop_reason ?? 'end_turn'),
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        providerName: this.name,
        latencyMs: Date.now() - start,
      }
    } catch (err) {
      throw new BuddyLLMError('Claude request failed', err)
    }
  }

  private mapFinishReason(raw: string): FinishReason {
    switch (raw) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop'
      case 'max_tokens':
        return 'length'
      case 'tool_use':
        return 'tool_use'
      default:
        return 'stop'
    }
  }
}
```

- [ ] **Step 4: Create the Apple Foundation Models server stub**

Create `apps/api/src/services/llm/providers/apple-foundation-stub.ts`:

```typescript
import type { CompletionRequest, CompletionResult, LLMProvider } from '@kanji-learn/shared'
import { BuddyLLMError } from '../types'

/**
 * Server-side placeholder for Apple Foundation Models.
 *
 * The real provider lives in the mobile app (Phase 2) and runs on-device.
 * This stub exists so the router's constructor has a uniformly-typed slot
 * for the on-device provider. It always reports unavailable and throws if
 * asked to generate, which causes the router to fall through to Tier 2.
 */
export class AppleFoundationStubProvider implements LLMProvider {
  readonly name = 'apple-foundation-stub'
  readonly supportsToolCalling = false
  readonly maxContextTokens = 4096
  readonly estimatedLatencyMs = 200
  readonly costPerInputToken = 0
  readonly costPerOutputToken = 0

  async isAvailable(): Promise<boolean> {
    return false
  }

  async generateCompletion(_request: CompletionRequest): Promise<CompletionResult> {
    throw new BuddyLLMError('AppleFoundationStubProvider cannot generate on the server')
  }
}
```

- [ ] **Step 5: Run the Claude tests**

Run: `pnpm --filter @kanji-learn/api test -- llm/providers/claude`
Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/llm/providers/claude.ts apps/api/src/services/llm/providers/apple-foundation-stub.ts apps/api/test/unit/llm/providers/claude.test.ts
git commit -m "feat(api): add claude provider and apple foundation server stub"
```

---

### Task 14: BuddyLLMRouter — tier classification, fail-over, truncation

**Files:**
- Create: `apps/api/src/services/llm/router.ts`
- Create: `apps/api/test/unit/llm/router.test.ts`

This is the orchestrator that ties providers, tier classification, rate limiting, fail-over, and telemetry together. Spec reference: design doc §2.3 (Three-Tier LLM Architecture).

**Routing rules:**
- Classify request → tier 1/2/3 via `classifyTier()`.
- Tier 1: try on-device provider; if unavailable, fall through to the primary Tier 2 provider.
- Tier 2: try primary Tier 2 provider; on failure, try the secondary Tier 2 provider.
- Tier 3: require `userOptedInPremium === true`. If not, fall through to Tier 2. If opted in, try Claude; on failure, fall through to Tier 2.
- Every attempt consults `RateLimiter.tryConsume(userId, tier)` before calling the provider. If the cap is hit, fall through to the next lower tier (or return a `BuddyLLMError` if no lower tier remains).
- Every attempt emits a telemetry record (success or failure).
- Context truncation: if the assembled prompt exceeds the chosen provider's `maxContextTokens`, truncate the earliest non-system messages until it fits (leaving system prompt intact).

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/unit/llm/router.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  CompletionRequest,
  CompletionResult,
  LLMProvider,
} from '@kanji-learn/shared'
import { BuddyLLMRouter } from '../../../src/services/llm/router'
import { BuddyLLMError } from '../../../src/services/llm/types'
import type { BuddyRequest } from '../../../src/services/llm/types'

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function makeProvider(
  name: string,
  opts: Partial<LLMProvider> & {
    available?: boolean
    shouldFail?: boolean
    content?: string
  } = {}
): LLMProvider {
  return {
    name,
    supportsToolCalling: opts.supportsToolCalling ?? false,
    maxContextTokens: opts.maxContextTokens ?? 8_000,
    estimatedLatencyMs: opts.estimatedLatencyMs ?? 100,
    costPerInputToken: opts.costPerInputToken ?? 0,
    costPerOutputToken: opts.costPerOutputToken ?? 0,
    async isAvailable() {
      return opts.available ?? true
    },
    async generateCompletion(_req: CompletionRequest): Promise<CompletionResult> {
      if (opts.shouldFail) throw new Error(`${name} failed`)
      return {
        content: opts.content ?? `from ${name}`,
        finishReason: 'stop',
        inputTokens: 10,
        outputTokens: 5,
        providerName: name,
        latencyMs: 42,
      }
    },
  }
}

const telemetrySpy = vi.fn()
const rateLimiter = {
  tryConsume: vi.fn(async (_uid: string, _tier: 1 | 2 | 3) => true),
  remainingForTier: vi.fn(async () => 10),
}

function baseRequest(overrides: Partial<BuddyRequest> = {}): BuddyRequest {
  return {
    context: 'encouragement',
    userId: 'user-1',
    systemPrompt: 'You are Buddy.',
    messages: [{ role: 'user', content: 'Hi' }],
    ...overrides,
  }
}

beforeEach(() => {
  telemetrySpy.mockReset()
  rateLimiter.tryConsume.mockReset()
  rateLimiter.tryConsume.mockResolvedValue(true)
})

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

describe('BuddyLLMRouter — tier 1', () => {
  it('uses the on-device provider when available', async () => {
    const onDevice = makeProvider('apple-fm', { available: true, content: 'from device' })
    const primary = makeProvider('groq')
    const secondary = makeProvider('gemini')
    const claude = makeProvider('claude')

    const router = new BuddyLLMRouter({
      onDevice,
      tier2Primary: primary,
      tier2Secondary: secondary,
      tier3: claude,
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    const result = await router.route(baseRequest({ context: 'encouragement' }))
    expect(result.content).toBe('from device')
    expect(result.providerName).toBe('apple-fm')
  })

  it('falls through to tier 2 primary when on-device is unavailable', async () => {
    const onDevice = makeProvider('apple-fm', { available: false })
    const primary = makeProvider('groq', { content: 'from groq' })
    const secondary = makeProvider('gemini')
    const claude = makeProvider('claude')

    const router = new BuddyLLMRouter({
      onDevice,
      tier2Primary: primary,
      tier2Secondary: secondary,
      tier3: claude,
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    const result = await router.route(baseRequest({ context: 'encouragement' }))
    expect(result.providerName).toBe('groq')
  })
})

describe('BuddyLLMRouter — tier 2', () => {
  it('uses the primary provider on success', async () => {
    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: makeProvider('groq', { content: 'g' }),
      tier2Secondary: makeProvider('gemini', { content: 'x' }),
      tier3: makeProvider('claude'),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    const result = await router.route(baseRequest({ context: 'study_plan_generation' }))
    expect(result.providerName).toBe('groq')
  })

  it('falls over to the secondary provider if primary throws', async () => {
    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: makeProvider('groq', { shouldFail: true }),
      tier2Secondary: makeProvider('gemini', { content: 'from gemini' }),
      tier3: makeProvider('claude'),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    const result = await router.route(baseRequest({ context: 'leech_diagnostic' }))
    expect(result.providerName).toBe('gemini')
    // Two telemetry emits: one failure for groq, one success for gemini
    expect(telemetrySpy).toHaveBeenCalledTimes(2)
    expect(telemetrySpy.mock.calls[0][0]).toMatchObject({ providerName: 'groq', success: false })
    expect(telemetrySpy.mock.calls[1][0]).toMatchObject({ providerName: 'gemini', success: true })
  })

  it('throws BuddyLLMError when both tier 2 providers fail', async () => {
    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: makeProvider('groq', { shouldFail: true }),
      tier2Secondary: makeProvider('gemini', { shouldFail: true }),
      tier3: makeProvider('claude'),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    await expect(router.route(baseRequest({ context: 'leech_diagnostic' }))).rejects.toBeInstanceOf(
      BuddyLLMError
    )
  })
})

describe('BuddyLLMRouter — tier 3', () => {
  it('uses Claude when user has opted in', async () => {
    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: makeProvider('groq'),
      tier2Secondary: makeProvider('gemini'),
      tier3: makeProvider('claude', { content: 'from claude' }),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    const result = await router.route(
      baseRequest({ context: 'mnemonic_cocreation', userOptedInPremium: true })
    )
    expect(result.providerName).toBe('claude')
  })

  it('falls through to tier 2 when user has NOT opted in', async () => {
    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: makeProvider('groq', { content: 'from groq' }),
      tier2Secondary: makeProvider('gemini'),
      tier3: makeProvider('claude', { content: 'from claude' }),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    const result = await router.route(
      baseRequest({ context: 'mnemonic_cocreation', userOptedInPremium: false })
    )
    expect(result.providerName).toBe('groq')
  })

  it('falls through to tier 2 when Claude fails', async () => {
    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: makeProvider('groq', { content: 'from groq' }),
      tier2Secondary: makeProvider('gemini'),
      tier3: makeProvider('claude', { shouldFail: true }),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    const result = await router.route(
      baseRequest({ context: 'deep_diagnostic', userOptedInPremium: true })
    )
    expect(result.providerName).toBe('groq')
  })
})

describe('BuddyLLMRouter — rate limiting', () => {
  it('falls through to tier 2 when tier 3 is rate limited', async () => {
    rateLimiter.tryConsume.mockImplementation(async (_uid, tier) => tier !== 3)

    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: makeProvider('groq', { content: 'from groq' }),
      tier2Secondary: makeProvider('gemini'),
      tier3: makeProvider('claude', { content: 'from claude' }),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    const result = await router.route(
      baseRequest({ context: 'deep_diagnostic', userOptedInPremium: true })
    )
    expect(result.providerName).toBe('groq')
  })

  it('throws BuddyLLMError when all tiers are rate limited', async () => {
    rateLimiter.tryConsume.mockResolvedValue(false)

    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: makeProvider('groq'),
      tier2Secondary: makeProvider('gemini'),
      tier3: makeProvider('claude'),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    await expect(
      router.route(baseRequest({ context: 'leech_diagnostic' }))
    ).rejects.toBeInstanceOf(BuddyLLMError)
  })
})

describe('BuddyLLMRouter — truncation', () => {
  it('drops the earliest non-system messages when over the cap', async () => {
    const captured: CompletionRequest[] = []
    const tinyProvider: LLMProvider = {
      ...makeProvider('tiny', { maxContextTokens: 20 }),
      async generateCompletion(req) {
        captured.push(req)
        return {
          content: 'ok',
          finishReason: 'stop',
          inputTokens: 5,
          outputTokens: 5,
          providerName: 'tiny',
          latencyMs: 1,
        }
      },
    }

    const router = new BuddyLLMRouter({
      onDevice: makeProvider('apple-fm', { available: false }),
      tier2Primary: tinyProvider,
      tier2Secondary: makeProvider('gemini'),
      tier3: makeProvider('claude'),
      rateLimiter,
      emitTelemetry: telemetrySpy,
    })

    // Build a request with many long messages
    const longMessages = Array.from({ length: 10 }, (_, i) => ({
      role: 'user' as const,
      content: 'this is a long message number ' + i + ' filler filler filler',
    }))

    await router.route(
      baseRequest({
        context: 'study_plan_generation',
        systemPrompt: 'SYS',
        messages: longMessages,
      })
    )

    const sent = captured[0]
    // System prompt preserved
    expect(sent.systemPrompt).toBe('SYS')
    // Fewer messages than we sent in
    expect(sent.messages.length).toBeLessThan(longMessages.length)
    // The last message is still present (most recent)
    expect((sent.messages.at(-1) as { content: string }).content).toContain('9')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- llm/router`
Expected: FAIL — "Cannot find module '../../../src/services/llm/router'".

- [ ] **Step 3: Create the router implementation**

Create `apps/api/src/services/llm/router.ts`:

```typescript
import type {
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  Message,
} from '@kanji-learn/shared'
import { BuddyLLMError, classifyTier } from './types'
import type { BuddyRequest } from './types'

// Lightweight interface — the concrete implementation lives in rate-limit.ts
// but the router only needs these two methods.
export interface RateLimiterLike {
  tryConsume(userId: string, tier: 1 | 2 | 3): Promise<boolean>
  remainingForTier(userId: string, tier: 2 | 3): Promise<number>
}

export interface TelemetryEvent {
  userId: string
  tier: 1 | 2 | 3
  providerName: string
  requestContext: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  success: boolean
  errorCode?: string
}

export type EmitTelemetry = (event: TelemetryEvent) => void | Promise<void>

export interface BuddyLLMRouterOptions {
  onDevice: LLMProvider
  tier2Primary: LLMProvider
  tier2Secondary: LLMProvider
  tier3: LLMProvider
  rateLimiter: RateLimiterLike
  emitTelemetry: EmitTelemetry
  defaultMaxTokens?: number
  defaultTemperature?: number
}

export class BuddyLLMRouter {
  constructor(private readonly opts: BuddyLLMRouterOptions) {}

  /**
   * Route a BuddyRequest through the tier chain with rate limiting + fail-over.
   * Throws BuddyLLMError if nothing can service the request.
   */
  async route(request: BuddyRequest): Promise<CompletionResult> {
    const tier = classifyTier(request)

    // Tier 1 → try on-device; fall through to tier 2 primary on failure/unavail
    if (tier === 1) {
      const viaOnDevice = await this.tryOnDevice(request)
      if (viaOnDevice) return viaOnDevice
      return this.runTier2(request)
    }

    // Tier 3 → try Claude if opted in; fall through to tier 2
    if (tier === 3) {
      if (request.userOptedInPremium === true) {
        const viaClaude = await this.tryClaude(request)
        if (viaClaude) return viaClaude
      }
      return this.runTier2(request)
    }

    // Tier 2 (default)
    return this.runTier2(request)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Per-tier attempts
  // ─────────────────────────────────────────────────────────────────────────

  private async tryOnDevice(request: BuddyRequest): Promise<CompletionResult | null> {
    const provider = this.opts.onDevice
    // Tier 1 is not rate-limited; no consume call needed.
    try {
      if (!(await provider.isAvailable())) return null
    } catch {
      return null
    }
    return this.callProvider(provider, request, 1)
  }

  private async tryClaude(request: BuddyRequest): Promise<CompletionResult | null> {
    const provider = this.opts.tier3
    const allowed = await this.opts.rateLimiter.tryConsume(request.userId, 3)
    if (!allowed) return null
    try {
      return await this.callProvider(provider, request, 3)
    } catch {
      return null
    }
  }

  private async runTier2(request: BuddyRequest): Promise<CompletionResult> {
    const allowed = await this.opts.rateLimiter.tryConsume(request.userId, 2)
    if (!allowed) {
      throw new BuddyLLMError('Tier 2 daily cap reached; no lower tier available')
    }

    // Try primary
    try {
      return await this.callProvider(this.opts.tier2Primary, request, 2)
    } catch (primaryErr) {
      // Secondary attempt — does not consume an additional quota slot
      try {
        return await this.callProvider(this.opts.tier2Secondary, request, 2)
      } catch (secondaryErr) {
        throw new BuddyLLMError('Both tier 2 providers failed', {
          primary: primaryErr,
          secondary: secondaryErr,
        })
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Single provider call (with truncation + telemetry)
  // ─────────────────────────────────────────────────────────────────────────

  private async callProvider(
    provider: LLMProvider,
    request: BuddyRequest,
    tier: 1 | 2 | 3
  ): Promise<CompletionResult> {
    const completionRequest = this.buildCompletionRequest(provider, request)
    const started = Date.now()
    try {
      const result = await provider.generateCompletion(completionRequest)
      await this.safeEmit({
        userId: request.userId,
        tier,
        providerName: provider.name,
        requestContext: request.context,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs || Date.now() - started,
        success: true,
      })
      return result
    } catch (err) {
      await this.safeEmit({
        userId: request.userId,
        tier,
        providerName: provider.name,
        requestContext: request.context,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - started,
        success: false,
        errorCode: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      })
      throw err
    }
  }

  private buildCompletionRequest(
    provider: LLMProvider,
    request: BuddyRequest
  ): CompletionRequest {
    const truncated = this.truncateForContext(
      request.systemPrompt,
      request.messages,
      provider.maxContextTokens
    )
    return {
      systemPrompt: request.systemPrompt,
      messages: truncated,
      tools: request.tools,
      maxTokens: request.maxTokens ?? this.opts.defaultMaxTokens ?? 1024,
      temperature: request.temperature ?? this.opts.defaultTemperature ?? 0.7,
    }
  }

  /**
   * Crude token estimate — 1 token ≈ 4 characters for English, which is
   * accurate enough for truncation decisions. Drops the earliest non-system
   * messages until the estimate fits under `maxContextTokens * 0.75` to leave
   * headroom for the model's response.
   */
  truncateForContext(
    systemPrompt: string,
    messages: Message[],
    maxContextTokens: number
  ): Message[] {
    const budget = Math.floor(maxContextTokens * 0.75)
    const systemCost = estimateTokens(systemPrompt)

    const result = [...messages]
    while (estimateMessagesTokens(result) + systemCost > budget && result.length > 1) {
      result.shift()
    }
    return result
  }

  private async safeEmit(event: TelemetryEvent): Promise<void> {
    try {
      await this.opts.emitTelemetry(event)
    } catch {
      // Never let telemetry failures break a user-facing call.
    }
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function estimateMessagesTokens(messages: Message[]): number {
  let total = 0
  for (const m of messages) {
    if ('content' in m && typeof m.content === 'string') {
      total += estimateTokens(m.content)
    }
    if (m.role === 'tool') {
      for (const r of m.toolResults) {
        total +=
          typeof r.content === 'string'
            ? estimateTokens(r.content)
            : estimateTokens(JSON.stringify(r.content))
      }
    }
  }
  return total
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @kanji-learn/api test -- llm/router`
Expected: PASS — 10 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/llm/router.ts apps/api/test/unit/llm/router.test.ts
git commit -m "feat(api): add buddy llm router with tier classification and failover"
```

---

## Section D — Buddy Layer

### Task 15: Buddy constants (scaffold levels, mastery mapping, thresholds)

**Files:**
- Create: `apps/api/src/services/buddy/constants.ts`
- Create: `apps/api/test/unit/buddy/constants.test.ts`

These are referenced by both `LearnerStateService` (Task 16) and `DualWriteService` (Task 17). Extracting them into a single file keeps the magic numbers from the spec in exactly one place.

**Spec references:**
- Status-to-mastery mapping: spec §3.2 "learner_knowledge_state.mastery_level"
- Leech threshold: spec §3.1 "leech_candidates" — kanji with `lapseCount >= 3` and not yet burned
- Scaffold levels: design doc §4.3 — derived from current streak, consecutive_failures, recent accuracy

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/unit/buddy/constants.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  MASTERY_BY_STATUS,
  LEECH_LAPSE_THRESHOLD,
  SCAFFOLD_LEVELS,
  scaffoldForSignals,
  isLeech,
} from '../../../src/services/buddy/constants'

describe('MASTERY_BY_STATUS', () => {
  it('maps every SRS status to a 0–1 mastery value', () => {
    expect(MASTERY_BY_STATUS.unseen).toBe(0)
    expect(MASTERY_BY_STATUS.learning).toBe(0.25)
    expect(MASTERY_BY_STATUS.reviewing).toBe(0.6)
    expect(MASTERY_BY_STATUS.remembered).toBe(0.85)
    expect(MASTERY_BY_STATUS.burned).toBe(1.0)
  })
})

describe('isLeech', () => {
  it('is true when lapseCount ≥ threshold and status is not burned', () => {
    expect(isLeech({ lapseCount: LEECH_LAPSE_THRESHOLD, status: 'reviewing' })).toBe(true)
    expect(isLeech({ lapseCount: LEECH_LAPSE_THRESHOLD + 1, status: 'learning' })).toBe(true)
  })

  it('is false when burned, regardless of lapseCount', () => {
    expect(isLeech({ lapseCount: 10, status: 'burned' })).toBe(false)
  })

  it('is false when under threshold', () => {
    expect(isLeech({ lapseCount: LEECH_LAPSE_THRESHOLD - 1, status: 'reviewing' })).toBe(false)
  })
})

describe('scaffoldForSignals', () => {
  it('returns "heavy" when accuracy is low and consecutive failures are high', () => {
    expect(
      scaffoldForSignals({ recentAccuracy: 0.4, consecutiveFailures: 4, streakDays: 1 })
    ).toBe('heavy')
  })

  it('returns "medium" for mid-range signals', () => {
    expect(
      scaffoldForSignals({ recentAccuracy: 0.7, consecutiveFailures: 1, streakDays: 5 })
    ).toBe('medium')
  })

  it('returns "light" for strong signals', () => {
    expect(
      scaffoldForSignals({ recentAccuracy: 0.92, consecutiveFailures: 0, streakDays: 20 })
    ).toBe('light')
  })

  it('returns one of the known SCAFFOLD_LEVELS', () => {
    const level = scaffoldForSignals({
      recentAccuracy: 0.5,
      consecutiveFailures: 0,
      streakDays: 0,
    })
    expect(SCAFFOLD_LEVELS).toContain(level)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- buddy/constants`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/api/src/services/buddy/constants.ts`**

```typescript
// apps/api/src/services/buddy/constants.ts
// All Buddy-layer magic numbers live here. Spec §3.1, §3.2, design doc §4.3.

export const SCAFFOLD_LEVELS = ['heavy', 'medium', 'light'] as const
export type ScaffoldLevel = (typeof SCAFFOLD_LEVELS)[number]

export const MASTERY_BY_STATUS = {
  unseen: 0,
  learning: 0.25,
  reviewing: 0.6,
  remembered: 0.85,
  burned: 1.0,
} as const

export type SrsStatus = keyof typeof MASTERY_BY_STATUS

/** A kanji becomes a leech candidate after this many lapses (spec §3.1). */
export const LEECH_LAPSE_THRESHOLD = 3

export interface LeechSignals {
  lapseCount: number
  status: SrsStatus
}

export function isLeech(signals: LeechSignals): boolean {
  if (signals.status === 'burned') return false
  return signals.lapseCount >= LEECH_LAPSE_THRESHOLD
}

export interface ScaffoldSignals {
  recentAccuracy: number // 0–1, rolling over last 20 reviews
  consecutiveFailures: number // streak of "again" answers in current session
  streakDays: number // consecutive days studied
}

/**
 * Pick a scaffold level from recent signals.
 * - heavy: user is struggling (lots of questions, step-by-step mnemonic review)
 * - medium: default for most users
 * - light: user is confident (minimal hand-holding)
 */
export function scaffoldForSignals(s: ScaffoldSignals): ScaffoldLevel {
  if (s.recentAccuracy < 0.6 || s.consecutiveFailures >= 3) return 'heavy'
  if (s.recentAccuracy >= 0.9 && s.streakDays >= 14 && s.consecutiveFailures === 0) {
    return 'light'
  }
  return 'medium'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @kanji-learn/api test -- buddy/constants`
Expected: PASS — 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/buddy/constants.ts apps/api/test/unit/buddy/constants.test.ts
git commit -m "feat(api): add buddy constants (scaffolds, mastery map, leech threshold)"
```

---

### Task 16: LearnerStateService — compute and persist learner_state_cache

**Files:**
- Create: `apps/api/src/services/buddy/learner-state.service.ts`
- Create: `apps/api/test/unit/buddy/learner-state.test.ts`

Reads all per-user progress/review tables, computes a denormalized snapshot, and upserts `learner_state_cache`. Phase 0 only needs these two public methods:

- `refreshState(userId)` — recompute and write the cache row. In Phase 0 this is exposed as a public method and called manually from the Phase 0 smoke test (Task 24). Phase 1 will wire it as a fire-and-forget call from the review route handler.
- `getState(userId)` — read the cache row. Returns `null` if no cache exists.

The computation itself is pure — it takes raw DB query results and returns a `LearnerStateCache` object. Put that pure function in a local helper so the test can exercise it without a database.

**Spec references:**
- `learner_state_cache` columns: spec §3.1
- `LearnerStateCache` TS type: `packages/shared/src/buddy-types.ts` (Task 6)
- Velocity trend derivation: design doc §4.4
- Weakest modality derivation: design doc §4.4

- [ ] **Step 1: Write the failing test for the pure computation**

Create `apps/api/test/unit/buddy/learner-state.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  computeLearnerState,
  type RawLearnerInputs,
} from '../../../src/services/buddy/learner-state.service'

function baseInputs(overrides: Partial<RawLearnerInputs> = {}): RawLearnerInputs {
  return {
    userId: 'user-1',
    currentStreakDays: 3,
    longestStreakDays: 5,
    totalKanjiSeen: 50,
    totalKanjiBurned: 10,
    reviewsLast7Days: [8, 9, 10, 11, 12, 13, 14], // accelerating
    reviewsPrev7Days: [5, 5, 5, 5, 5, 5, 5],
    recentAccuracy: {
      meaning: 0.85,
      reading: 0.7,
      writing: 0.5, // weakest
      voice: 0.8,
      compound: 0.9,
    },
    activeLeechCount: 2,
    consecutiveFailures: 0,
    lastSessionAt: new Date('2026-04-09T22:00:00Z'),
    ...overrides,
  }
}

describe('computeLearnerState', () => {
  it('picks velocityTrend=accelerating when last week > prev week by 20%+', () => {
    const state = computeLearnerState(baseInputs())
    expect(state.velocityTrend).toBe('accelerating')
  })

  it('picks velocityTrend=decelerating when last week < prev week by 20%+', () => {
    const state = computeLearnerState(
      baseInputs({
        reviewsLast7Days: [2, 2, 2, 2, 2, 2, 2],
        reviewsPrev7Days: [10, 10, 10, 10, 10, 10, 10],
      })
    )
    expect(state.velocityTrend).toBe('decelerating')
  })

  it('picks velocityTrend=steady when within ±20%', () => {
    const state = computeLearnerState(
      baseInputs({
        reviewsLast7Days: [10, 10, 10, 10, 10, 10, 10],
        reviewsPrev7Days: [10, 10, 10, 10, 10, 10, 10],
      })
    )
    expect(state.velocityTrend).toBe('steady')
  })

  it('picks velocityTrend=inactive when last week is zero', () => {
    const state = computeLearnerState(
      baseInputs({
        reviewsLast7Days: [0, 0, 0, 0, 0, 0, 0],
      })
    )
    expect(state.velocityTrend).toBe('inactive')
  })

  it('picks weakestModality as the lowest accuracy', () => {
    const state = computeLearnerState(baseInputs())
    expect(state.weakestModality).toBe('writing')
  })

  it('derives scaffoldLevel from the helper', () => {
    const struggling = computeLearnerState(
      baseInputs({
        recentAccuracy: {
          meaning: 0.4,
          reading: 0.4,
          writing: 0.4,
          voice: 0.4,
          compound: 0.4,
        },
        consecutiveFailures: 4,
      })
    )
    expect(struggling.scaffoldLevel).toBe('heavy')
  })

  it('exposes the active leech count', () => {
    const state = computeLearnerState(baseInputs({ activeLeechCount: 7 }))
    expect(state.activeLeechCount).toBe(7)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- buddy/learner-state`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/api/src/services/buddy/learner-state.service.ts`**

```typescript
import { and, eq } from 'drizzle-orm'
import {
  learnerStateCache,
  userKanjiProgress,
  reviewLogs,
  userProfiles,
  dailyStats,
} from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import { scaffoldForSignals, isLeech, type ScaffoldLevel } from './constants'

// ─── Shared input/output types ───────────────────────────────────────────────

export interface RawLearnerInputs {
  userId: string
  currentStreakDays: number
  longestStreakDays: number
  totalKanjiSeen: number
  totalKanjiBurned: number
  reviewsLast7Days: number[] // length 7
  reviewsPrev7Days: number[] // length 7
  recentAccuracy: {
    meaning: number
    reading: number
    writing: number
    voice: number
    compound: number
  }
  activeLeechCount: number
  consecutiveFailures: number
  lastSessionAt: Date | null
}

export interface ComputedLearnerState {
  userId: string
  currentStreakDays: number
  longestStreakDays: number
  totalKanjiSeen: number
  totalKanjiBurned: number
  velocityTrend: 'accelerating' | 'steady' | 'decelerating' | 'inactive'
  weakestModality: 'meaning' | 'reading' | 'writing' | 'voice' | 'compound'
  scaffoldLevel: ScaffoldLevel
  activeLeechCount: number
  lastSessionAt: Date | null
  recentAccuracy: number // average across modalities, 0–1
  computedAt: Date
}

// ─── Pure computation — no db access, easy to test ──────────────────────────

export function computeLearnerState(input: RawLearnerInputs): ComputedLearnerState {
  const last = sum(input.reviewsLast7Days)
  const prev = sum(input.reviewsPrev7Days)

  const velocityTrend: ComputedLearnerState['velocityTrend'] = (() => {
    if (last === 0) return 'inactive'
    if (prev === 0) return last > 0 ? 'accelerating' : 'inactive'
    const ratio = last / prev
    if (ratio >= 1.2) return 'accelerating'
    if (ratio <= 0.8) return 'decelerating'
    return 'steady'
  })()

  const modalityEntries = Object.entries(input.recentAccuracy) as Array<
    [ComputedLearnerState['weakestModality'], number]
  >
  const weakestModality = modalityEntries.reduce((worst, cur) =>
    cur[1] < worst[1] ? cur : worst
  )[0]

  const avgAccuracy =
    modalityEntries.reduce((acc, [, v]) => acc + v, 0) / modalityEntries.length

  const scaffoldLevel = scaffoldForSignals({
    recentAccuracy: avgAccuracy,
    consecutiveFailures: input.consecutiveFailures,
    streakDays: input.currentStreakDays,
  })

  return {
    userId: input.userId,
    currentStreakDays: input.currentStreakDays,
    longestStreakDays: input.longestStreakDays,
    totalKanjiSeen: input.totalKanjiSeen,
    totalKanjiBurned: input.totalKanjiBurned,
    velocityTrend,
    weakestModality,
    scaffoldLevel,
    activeLeechCount: input.activeLeechCount,
    lastSessionAt: input.lastSessionAt,
    recentAccuracy: Number(avgAccuracy.toFixed(4)),
    computedAt: new Date(),
  }
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}

// ─── Service — reads the db, upserts the cache ──────────────────────────────

export class LearnerStateService {
  constructor(private readonly db: Db) {}

  async refreshState(userId: string): Promise<ComputedLearnerState> {
    const raw = await this.loadRawInputs(userId)
    const computed = computeLearnerState(raw)
    await this.persist(computed)
    return computed
  }

  async getState(userId: string): Promise<ComputedLearnerState | null> {
    const row = await this.db.query.learnerStateCache.findFirst({
      where: eq(learnerStateCache.userId, userId),
    })
    if (!row) return null
    return {
      userId: row.userId,
      currentStreakDays: row.currentStreakDays,
      longestStreakDays: row.longestStreakDays,
      totalKanjiSeen: row.totalKanjiSeen,
      totalKanjiBurned: row.totalKanjiBurned,
      velocityTrend: row.velocityTrend,
      weakestModality: row.weakestModality,
      scaffoldLevel: (row.scaffoldLevel ?? 'medium') as ScaffoldLevel,
      activeLeechCount: row.activeLeechCount,
      lastSessionAt: row.lastSessionAt,
      recentAccuracy: row.recentAccuracy,
      computedAt: row.updatedAt,
    }
  }

  // ─── Private: raw input assembly from existing tables ────────────────────

  private async loadRawInputs(userId: string): Promise<RawLearnerInputs> {
    // 1. User profile — streak data
    const profile = await this.db.query.userProfiles.findFirst({
      where: eq(userProfiles.id, userId),
    })

    // 2. Kanji progress aggregate — seen, burned, leeches
    const progress = await this.db.query.userKanjiProgress.findMany({
      where: eq(userKanjiProgress.userId, userId),
    })
    const totalKanjiSeen = progress.filter((p) => p.status !== 'unseen').length
    const totalKanjiBurned = progress.filter((p) => p.status === 'burned').length
    const activeLeechCount = progress.filter((p) =>
      isLeech({ lapseCount: p.lapseCount ?? 0, status: p.status })
    ).length

    // 3. Daily stats — last 14 days of review counts
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    const stats = await this.db.query.dailyStats.findMany({
      where: and(eq(dailyStats.userId, userId)),
    })
    const recent = stats
      .filter((s) => new Date(s.date) >= fourteenDaysAgo)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    const last7 = recent.slice(-7).map((s) => s.reviewsCompleted ?? 0)
    const prev7 = recent.slice(-14, -7).map((s) => s.reviewsCompleted ?? 0)
    // Pad to length 7 with zeros so computeLearnerState's sum is well-defined
    const pad = (arr: number[]) => [...arr, ...Array(Math.max(0, 7 - arr.length)).fill(0)]

    // 4. Recent per-modality accuracy — last 100 review logs
    const recentLogs = await this.db.query.reviewLogs.findMany({
      where: eq(reviewLogs.userId, userId),
      orderBy: (rl, { desc }) => desc(rl.completedAt),
      limit: 100,
    })
    const recentAccuracy = computeModalityAccuracy(recentLogs)

    // 5. Consecutive failures — walk back from the most recent log
    let consecutiveFailures = 0
    for (const log of recentLogs) {
      if (log.wasCorrect) break
      consecutiveFailures += 1
    }

    return {
      userId,
      currentStreakDays: profile?.currentStreak ?? 0,
      longestStreakDays: profile?.longestStreak ?? 0,
      totalKanjiSeen,
      totalKanjiBurned,
      reviewsLast7Days: pad(last7),
      reviewsPrev7Days: pad(prev7),
      recentAccuracy,
      activeLeechCount,
      consecutiveFailures,
      lastSessionAt: profile?.lastActiveAt ?? null,
    }
  }

  private async persist(state: ComputedLearnerState): Promise<void> {
    await this.db
      .insert(learnerStateCache)
      .values({
        userId: state.userId,
        currentStreakDays: state.currentStreakDays,
        longestStreakDays: state.longestStreakDays,
        totalKanjiSeen: state.totalKanjiSeen,
        totalKanjiBurned: state.totalKanjiBurned,
        velocityTrend: state.velocityTrend,
        weakestModality: state.weakestModality,
        scaffoldLevel: state.scaffoldLevel,
        activeLeechCount: state.activeLeechCount,
        lastSessionAt: state.lastSessionAt,
        recentAccuracy: state.recentAccuracy,
        updatedAt: state.computedAt,
      })
      .onConflictDoUpdate({
        target: learnerStateCache.userId,
        set: {
          currentStreakDays: state.currentStreakDays,
          longestStreakDays: state.longestStreakDays,
          totalKanjiSeen: state.totalKanjiSeen,
          totalKanjiBurned: state.totalKanjiBurned,
          velocityTrend: state.velocityTrend,
          weakestModality: state.weakestModality,
          scaffoldLevel: state.scaffoldLevel,
          activeLeechCount: state.activeLeechCount,
          lastSessionAt: state.lastSessionAt,
          recentAccuracy: state.recentAccuracy,
          updatedAt: state.computedAt,
        },
      })
  }
}

function computeModalityAccuracy(
  logs: Array<{ reviewType: string; wasCorrect: boolean | null }>
): RawLearnerInputs['recentAccuracy'] {
  const counts = {
    meaning: { c: 0, t: 0 },
    reading: { c: 0, t: 0 },
    writing: { c: 0, t: 0 },
    voice: { c: 0, t: 0 },
    compound: { c: 0, t: 0 },
  }
  for (const log of logs) {
    const key = log.reviewType as keyof typeof counts
    if (!(key in counts)) continue
    counts[key].t += 1
    if (log.wasCorrect) counts[key].c += 1
  }
  const ratio = (x: { c: number; t: number }) => (x.t === 0 ? 1.0 : x.c / x.t)
  return {
    meaning: ratio(counts.meaning),
    reading: ratio(counts.reading),
    writing: ratio(counts.writing),
    voice: ratio(counts.voice),
    compound: ratio(counts.compound),
  }
}
```

- [ ] **Step 4: Run the pure-function tests to verify they pass**

Run: `pnpm --filter @kanji-learn/api test -- buddy/learner-state`
Expected: PASS — 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/buddy/learner-state.service.ts apps/api/test/unit/buddy/learner-state.test.ts
git commit -m "feat(api): add learner state service with pure computation"
```

---

### Task 17: DualWriteService — transactional mirror to Universal Knowledge Graph

**Files:**
- Create: `apps/api/src/services/buddy/dual-write.service.ts`
- Create: `apps/api/test/integration/dual-write.test.ts`

This is the architectural hinge the user chose over Postgres triggers. Every write to an app-specific review/progress table goes through this wrapper, which performs the app-specific write AND the corresponding UKG write (`learner_knowledge_state` + `learner_timeline_events`) in a single Drizzle transaction.

**Spec references:**
- Universal Knowledge Graph tables: spec §3.2
- Subject format: `"kanji:<character>"` — e.g. `"kanji:持"` (spec §3.2)
- Mastery values: `MASTERY_BY_STATUS` from `constants.ts`

The service exposes one method for Phase 0: `recordReviewSubmission`. Phase 1 and later will add `recordMnemonicCreation`, `recordTestResult`, etc., following the same pattern.

**Important:** The `buddy_llm_*` tables are NOT written via this service — telemetry goes directly to its own writer to avoid dragging telemetry into the same transaction as a user-facing review.

- [ ] **Step 1: Write the failing integration test**

Create `apps/api/test/integration/dual-write.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { DualWriteService } from '../../src/services/buddy/dual-write.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER = '00000000-0000-0000-0000-000000000777'
const TEST_KANJI = '持'

async function resetFixtures() {
  await db.execute(sql`DELETE FROM learner_timeline_events WHERE learner_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM learner_knowledge_state WHERE learner_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM review_logs WHERE user_id = ${TEST_USER}`)
  await db.execute(
    sql`DELETE FROM user_kanji_progress WHERE user_id = ${TEST_USER} AND kanji = ${TEST_KANJI}`
  )
  await db.execute(
    sql`INSERT INTO user_profiles (id, display_name, timezone) VALUES (${TEST_USER}, 'DualWrite', 'UTC') ON CONFLICT DO NOTHING`
  )
  await db.execute(
    sql`INSERT INTO learner_identity (learner_id, created_at) VALUES (${TEST_USER}, now()) ON CONFLICT DO NOTHING`
  )
}

describe('DualWriteService.recordReviewSubmission', () => {
  const service = new DualWriteService(db)

  beforeEach(async () => {
    await resetFixtures()
  })

  it('writes to review_logs AND learner_knowledge_state in the same transaction', async () => {
    await service.recordReviewSubmission({
      userId: TEST_USER,
      kanji: TEST_KANJI,
      reviewType: 'meaning',
      wasCorrect: true,
      responseTimeMs: 1200,
      sessionId: null,
      // progress after SRS update
      progressAfter: {
        status: 'reviewing',
        intervalDays: 3,
        easeFactor: 2.5,
        lapseCount: 0,
        dueDate: new Date('2026-04-13T12:00:00Z'),
      },
    })

    // App table
    const appRows = await db.execute(
      sql`SELECT count(*)::int AS n FROM review_logs WHERE user_id = ${TEST_USER}`
    )
    expect((appRows[0] as { n: number }).n).toBe(1)

    // UKG table
    const ukgRows = await db.execute(
      sql`SELECT mastery_level::float AS mastery FROM learner_knowledge_state
          WHERE learner_id = ${TEST_USER} AND subject = ${'kanji:' + TEST_KANJI}`
    )
    expect(ukgRows.length).toBe(1)
    expect((ukgRows[0] as { mastery: number }).mastery).toBeCloseTo(0.6, 3)

    // Timeline event was written
    const timelineRows = await db.execute(
      sql`SELECT event_type FROM learner_timeline_events WHERE learner_id = ${TEST_USER}`
    )
    expect(timelineRows.length).toBe(1)
    expect((timelineRows[0] as { event_type: string }).event_type).toBe('review_completed')
  })

  it('rolls back the UKG write if the timeline insert fails', async () => {
    // Inject a failing clock/guard by passing an impossibly long subject
    // that exceeds the subject column length to force the transaction to fail.
    const svc = new DualWriteService(db)
    await expect(
      svc.recordReviewSubmission({
        userId: TEST_USER,
        kanji: 'x'.repeat(500), // subject will be "kanji:" + 500 chars
        reviewType: 'meaning',
        wasCorrect: true,
        responseTimeMs: 1200,
        sessionId: null,
        progressAfter: {
          status: 'reviewing',
          intervalDays: 3,
          easeFactor: 2.5,
          lapseCount: 0,
          dueDate: new Date(),
        },
      })
    ).rejects.toBeTruthy()

    // Nothing should have been written anywhere
    const appRows = await db.execute(
      sql`SELECT count(*)::int AS n FROM review_logs WHERE user_id = ${TEST_USER}`
    )
    expect((appRows[0] as { n: number }).n).toBe(0)

    const ukgRows = await db.execute(
      sql`SELECT count(*)::int AS n FROM learner_knowledge_state WHERE learner_id = ${TEST_USER}`
    )
    expect((ukgRows[0] as { n: number }).n).toBe(0)
  })

  it('increments learner_knowledge_state.review_count on repeat reviews of the same kanji', async () => {
    const payload = {
      userId: TEST_USER,
      kanji: TEST_KANJI,
      reviewType: 'meaning' as const,
      wasCorrect: true,
      responseTimeMs: 900,
      sessionId: null,
      progressAfter: {
        status: 'reviewing' as const,
        intervalDays: 3,
        easeFactor: 2.5,
        lapseCount: 0,
        dueDate: new Date('2026-04-13T12:00:00Z'),
      },
    }
    await service.recordReviewSubmission(payload)
    await service.recordReviewSubmission(payload)
    await service.recordReviewSubmission(payload)

    const rows = await db.execute(
      sql`SELECT review_count::int AS rc FROM learner_knowledge_state
          WHERE learner_id = ${TEST_USER} AND subject = ${'kanji:' + TEST_KANJI}`
    )
    expect((rows[0] as { rc: number }).rc).toBe(3)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- dual-write`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/api/src/services/buddy/dual-write.service.ts`**

```typescript
import { and, eq, sql } from 'drizzle-orm'
import {
  reviewLogs,
  userKanjiProgress,
  learnerKnowledgeState,
  learnerTimelineEvents,
} from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import { MASTERY_BY_STATUS, type SrsStatus } from './constants'

export interface ReviewSubmissionInput {
  userId: string
  kanji: string
  reviewType: 'meaning' | 'reading' | 'writing' | 'voice' | 'compound'
  wasCorrect: boolean
  responseTimeMs: number
  sessionId: string | null
  progressAfter: {
    status: SrsStatus
    intervalDays: number
    easeFactor: number
    lapseCount: number
    dueDate: Date
  }
}

export class DualWriteService {
  constructor(private readonly db: Db) {}

  /**
   * Writes a review log and mirrors it into the Universal Knowledge Graph.
   * All writes happen inside a single transaction so the app DB and the
   * UKG can never disagree.
   */
  async recordReviewSubmission(input: ReviewSubmissionInput): Promise<void> {
    const subject = `kanji:${input.kanji}`
    const mastery = MASTERY_BY_STATUS[input.progressAfter.status]

    await this.db.transaction(async (tx) => {
      // 1. App-specific write: review_logs
      await tx.insert(reviewLogs).values({
        userId: input.userId,
        kanji: input.kanji,
        reviewType: input.reviewType,
        wasCorrect: input.wasCorrect,
        responseTimeMs: input.responseTimeMs,
        sessionId: input.sessionId,
      })

      // 2. App-specific write: user_kanji_progress upsert
      await tx
        .insert(userKanjiProgress)
        .values({
          userId: input.userId,
          kanji: input.kanji,
          status: input.progressAfter.status,
          intervalDays: input.progressAfter.intervalDays,
          easeFactor: input.progressAfter.easeFactor,
          lapseCount: input.progressAfter.lapseCount,
          dueDate: input.progressAfter.dueDate,
        })
        .onConflictDoUpdate({
          target: [userKanjiProgress.userId, userKanjiProgress.kanji],
          set: {
            status: input.progressAfter.status,
            intervalDays: input.progressAfter.intervalDays,
            easeFactor: input.progressAfter.easeFactor,
            lapseCount: input.progressAfter.lapseCount,
            dueDate: input.progressAfter.dueDate,
            updatedAt: new Date(),
          },
        })

      // 3. UKG write: learner_knowledge_state upsert
      await tx
        .insert(learnerKnowledgeState)
        .values({
          learnerId: input.userId,
          subject,
          masteryLevel: mastery,
          reviewCount: 1,
          lastReviewedAt: new Date(),
          appSource: 'kanji-buddy',
        })
        .onConflictDoUpdate({
          target: [learnerKnowledgeState.learnerId, learnerKnowledgeState.subject],
          set: {
            masteryLevel: mastery,
            reviewCount: sql`${learnerKnowledgeState.reviewCount} + 1`,
            lastReviewedAt: new Date(),
            updatedAt: new Date(),
          },
        })

      // 4. UKG write: learner_timeline_events
      await tx.insert(learnerTimelineEvents).values({
        learnerId: input.userId,
        eventType: 'review_completed',
        subject,
        appSource: 'kanji-buddy',
        payload: {
          reviewType: input.reviewType,
          wasCorrect: input.wasCorrect,
          responseTimeMs: input.responseTimeMs,
          newStatus: input.progressAfter.status,
        },
      })
    })
  }
}
```

- [ ] **Step 4: Run the integration tests to verify they pass**

Run: `pnpm --filter @kanji-learn/api test -- dual-write`
Expected: PASS — 3 tests passing.

**If the "rolls back" test fails with no error thrown**, your UKG subject column is `text` with no length cap. Either:
- Add a CHECK constraint in the custom SQL migration (Task 23): `CHECK (length(subject) <= 200)`, OR
- Change the test to force a different failure (e.g., invalid mastery value).

The custom SQL migration in Task 23 adds the length check, so this test will pass once Task 23 is complete.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/buddy/dual-write.service.ts apps/api/test/integration/dual-write.test.ts
git commit -m "feat(api): add dual-write service for ukg mirroring"
```

---

### Task 18: Wire DualWriteService into SrsService.submitReview

**Files:**
- Modify: `apps/api/src/services/srs.service.ts` (constructor + `submitReview` method)
- Create: `apps/api/test/integration/srs-dual-write.test.ts`

`SrsService` currently writes directly to `reviewLogs` and `userKanjiProgress`. We need it to delegate those two writes to `DualWriteService.recordReviewSubmission` so the UKG mirror happens automatically. Session and session-level rollups still happen in `SrsService`.

The pattern:
- Constructor gains a `dualWrite: DualWriteService` parameter.
- Inside `submitReview`, after computing the SM-2 next state, replace the direct `db.insert(reviewLogs)` and `db.update(userKanjiProgress)` calls with a single `this.dualWrite.recordReviewSubmission(...)` call.
- Everything else (review session creation, session rollup, daily stats) stays where it is.

- [ ] **Step 1: Write the failing integration test**

Create `apps/api/test/integration/srs-dual-write.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { SrsService } from '../../src/services/srs.service'
import { DualWriteService } from '../../src/services/buddy/dual-write.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER = '00000000-0000-0000-0000-000000000888'
const TEST_KANJI = '学'

async function resetFixtures() {
  await db.execute(sql`DELETE FROM learner_timeline_events WHERE learner_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM learner_knowledge_state WHERE learner_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM review_logs WHERE user_id = ${TEST_USER}`)
  await db.execute(
    sql`DELETE FROM user_kanji_progress WHERE user_id = ${TEST_USER} AND kanji = ${TEST_KANJI}`
  )
  await db.execute(sql`DELETE FROM review_sessions WHERE user_id = ${TEST_USER}`)
  await db.execute(
    sql`INSERT INTO user_profiles (id, display_name, timezone) VALUES (${TEST_USER}, 'SrsTest', 'UTC') ON CONFLICT DO NOTHING`
  )
  await db.execute(
    sql`INSERT INTO learner_identity (learner_id, created_at) VALUES (${TEST_USER}, now()) ON CONFLICT DO NOTHING`
  )
  // Seed minimal kanji and progress rows
  await db.execute(
    sql`INSERT INTO kanji (character, meaning, jlpt_level) VALUES (${TEST_KANJI}, 'study', 5) ON CONFLICT DO NOTHING`
  )
}

describe('SrsService.submitReview integrates with DualWriteService', () => {
  const dualWrite = new DualWriteService(db)
  const srs = new SrsService(db, dualWrite)

  beforeEach(resetFixtures)

  it('writes to both app and UKG tables via a single submitReview call', async () => {
    await srs.submitReview(
      TEST_USER,
      [
        {
          kanji: TEST_KANJI,
          reviewType: 'meaning',
          wasCorrect: true,
          responseTimeMs: 1500,
        },
      ],
      5000
    )

    const appRows = await db.execute(
      sql`SELECT count(*)::int AS n FROM review_logs WHERE user_id = ${TEST_USER}`
    )
    expect((appRows[0] as { n: number }).n).toBe(1)

    const ukgRows = await db.execute(
      sql`SELECT count(*)::int AS n FROM learner_knowledge_state WHERE learner_id = ${TEST_USER}`
    )
    expect((ukgRows[0] as { n: number }).n).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test — it should fail because the constructor signature doesn't match yet**

Run: `pnpm --filter @kanji-learn/api test -- srs-dual-write`
Expected: FAIL — `SrsService` constructor argument count mismatch.

- [ ] **Step 3: Modify the SrsService constructor**

In `apps/api/src/services/srs.service.ts`, change the class declaration:

```typescript
import { DualWriteService } from './buddy/dual-write.service'

export class SrsService {
  constructor(
    private readonly db: Db,
    private readonly dualWrite: DualWriteService
  ) {}

  // ...
}
```

- [ ] **Step 4: Replace the direct reviewLogs/userKanjiProgress writes inside `submitReview`**

Inside the body of `submitReview`, find the block that currently does:

```typescript
await this.db.insert(reviewLogs).values({ ... })
await this.db
  .update(userKanjiProgress)
  .set({ ... })
  .where(and(eq(userKanjiProgress.userId, userId), eq(userKanjiProgress.kanji, kanji)))
```

Replace it with a single call:

```typescript
await this.dualWrite.recordReviewSubmission({
  userId,
  kanji: result.kanji,
  reviewType: result.reviewType,
  wasCorrect: result.wasCorrect,
  responseTimeMs: result.responseTimeMs,
  sessionId: session.id,
  progressAfter: {
    status: nextStatus,
    intervalDays: nextInterval,
    easeFactor: nextEase,
    lapseCount: nextLapseCount,
    dueDate: nextDueDate,
  },
})
```

**Important:** leave the review-session creation, session rollup, and daily stats code untouched. Only the individual review log + progress upsert is delegated to DualWriteService.

- [ ] **Step 5: Update the SrsService constructor call sites**

Search for other places that instantiate `SrsService`:

Run: `grep -rn "new SrsService" apps/api/src`

For each call site, pass a `new DualWriteService(db)` as the second argument. In Phase 0 the only call site is likely `apps/api/src/server.ts`, which Task 22 will update more thoroughly.

For now, make the tests compile by adding a temporary construction. If any existing file instantiates SrsService, update it like:

```typescript
const dualWrite = new DualWriteService(db)
const srs = new SrsService(db, dualWrite)
```

- [ ] **Step 6: Run the integration test to verify it passes**

Run: `pnpm --filter @kanji-learn/api test -- srs-dual-write`
Expected: PASS — 1 test passing.

- [ ] **Step 7: Run the full API test suite — nothing else should break**

Run: `pnpm --filter @kanji-learn/api test`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/srs.service.ts apps/api/test/integration/srs-dual-write.test.ts apps/api/src/server.ts
git commit -m "feat(api): route srs review submission through dual-write service"
```

---

### Task 19: LLM telemetry writer

**Files:**
- Create: `apps/api/src/services/llm/telemetry.ts`
- Create: `apps/api/test/integration/llm-telemetry.test.ts`

The router calls `emitTelemetry(event)` after every provider attempt. We need a concrete writer that persists these events to `buddy_llm_telemetry`. Kept separate from the router so telemetry has no blocking effect on user-facing calls — the writer is fire-and-forget from the router's perspective.

- [ ] **Step 1: Write the failing integration test**

Create `apps/api/test/integration/llm-telemetry.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { createTelemetryWriter } from '../../src/services/llm/telemetry'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER = '00000000-0000-0000-0000-000000000999'

beforeEach(async () => {
  await db.execute(sql`DELETE FROM buddy_llm_telemetry WHERE user_id = ${TEST_USER}`)
  await db.execute(
    sql`INSERT INTO user_profiles (id, display_name, timezone) VALUES (${TEST_USER}, 'TelemTest', 'UTC') ON CONFLICT DO NOTHING`
  )
})

describe('createTelemetryWriter', () => {
  it('persists a success event', async () => {
    const emit = createTelemetryWriter(db)
    await emit({
      userId: TEST_USER,
      tier: 2,
      providerName: 'groq',
      requestContext: 'study_plan_generation',
      inputTokens: 123,
      outputTokens: 45,
      latencyMs: 678,
      success: true,
    })

    const rows = await db.execute(
      sql`SELECT provider_name, success, input_tokens::int AS it FROM buddy_llm_telemetry
          WHERE user_id = ${TEST_USER}`
    )
    expect(rows.length).toBe(1)
    expect((rows[0] as { provider_name: string; success: boolean; it: number }).provider_name).toBe('groq')
    expect((rows[0] as { success: boolean }).success).toBe(true)
    expect((rows[0] as { it: number }).it).toBe(123)
  })

  it('persists a failure event with error code', async () => {
    const emit = createTelemetryWriter(db)
    await emit({
      userId: TEST_USER,
      tier: 3,
      providerName: 'claude',
      requestContext: 'deep_diagnostic',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 2500,
      success: false,
      errorCode: 'timeout',
    })

    const rows = await db.execute(
      sql`SELECT error_code, success FROM buddy_llm_telemetry WHERE user_id = ${TEST_USER}`
    )
    expect(rows.length).toBe(1)
    expect((rows[0] as { error_code: string }).error_code).toBe('timeout')
    expect((rows[0] as { success: boolean }).success).toBe(false)
  })

  it('swallows database errors (never throws to caller)', async () => {
    const broken = {
      insert: () => {
        throw new Error('db gone')
      },
    } as unknown as Parameters<typeof createTelemetryWriter>[0]
    const emit = createTelemetryWriter(broken)
    // Should not throw
    await expect(
      emit({
        userId: TEST_USER,
        tier: 2,
        providerName: 'groq',
        requestContext: 'encouragement',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
        success: true,
      })
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- llm-telemetry`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/api/src/services/llm/telemetry.ts`**

```typescript
import { buddyLlmTelemetry } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import type { EmitTelemetry, TelemetryEvent } from './router'

/**
 * Build a router-compatible telemetry writer that persists events to the
 * buddy_llm_telemetry table. Safe to use as `opts.emitTelemetry` on the
 * BuddyLLMRouter — it never throws.
 */
export function createTelemetryWriter(db: Db): EmitTelemetry {
  return async (event: TelemetryEvent) => {
    try {
      await db.insert(buddyLlmTelemetry).values({
        userId: event.userId,
        tier: tierToEnumValue(event.tier),
        providerName: event.providerName,
        requestContext: event.requestContext,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        latencyMs: event.latencyMs,
        success: event.success,
        errorCode: event.errorCode ?? null,
      })
    } catch (err) {
      // Telemetry must never break a user-facing request. Log and drop.
      // eslint-disable-next-line no-console
      console.warn('[telemetry] failed to write buddy_llm_telemetry row', err)
    }
  }
}

function tierToEnumValue(tier: 1 | 2 | 3): 'tier1' | 'tier2' | 'tier3' {
  return `tier${tier}` as const
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @kanji-learn/api test -- llm-telemetry`
Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/llm/telemetry.ts apps/api/test/integration/llm-telemetry.test.ts
git commit -m "feat(api): add llm telemetry writer for buddy_llm_telemetry"
```

---

## Section E — Backfill, Wiring, Telemetry

### Task 20: Backfill existing users into the Universal Knowledge Graph

**Files:**
- Create: `packages/db/src/seeds/backfill-universal-kg.ts`
- Create: `apps/api/test/integration/backfill.test.ts`

Existing users have `user_kanji_progress` rows that predate the UKG. Phase 0 needs a one-time backfill script that iterates every row and mirrors it into `learner_identity`, `learner_knowledge_state`, and `learner_timeline_events`, matching what `DualWriteService` would have done if it had existed from day one.

- [ ] **Step 1: Write the failing integration test**

Create `apps/api/test/integration/backfill.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { backfillUniversalKg } from '@kanji-learn/db/seeds/backfill-universal-kg'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USERS = [
  '00000000-0000-0000-0000-0000000bf001',
  '00000000-0000-0000-0000-0000000bf002',
]

async function resetFixtures() {
  for (const id of TEST_USERS) {
    await db.execute(sql`DELETE FROM learner_timeline_events WHERE learner_id = ${id}`)
    await db.execute(sql`DELETE FROM learner_knowledge_state WHERE learner_id = ${id}`)
    await db.execute(sql`DELETE FROM learner_identity WHERE learner_id = ${id}`)
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${id}`)
    await db.execute(
      sql`INSERT INTO user_profiles (id, display_name, timezone) VALUES (${id}, 'Backfill', 'UTC') ON CONFLICT DO NOTHING`
    )
  }
  await db.execute(sql`INSERT INTO kanji (character, meaning, jlpt_level) VALUES ('一', 'one', 5) ON CONFLICT DO NOTHING`)
  await db.execute(sql`INSERT INTO kanji (character, meaning, jlpt_level) VALUES ('二', 'two', 5) ON CONFLICT DO NOTHING`)
  // Seed progress rows (pre-UKG)
  await db.execute(
    sql`INSERT INTO user_kanji_progress (user_id, kanji, status, interval_days, ease_factor, lapse_count, due_date)
        VALUES (${TEST_USERS[0]}, '一', 'reviewing', 3, 2.5, 0, now() + interval '3 days')`
  )
  await db.execute(
    sql`INSERT INTO user_kanji_progress (user_id, kanji, status, interval_days, ease_factor, lapse_count, due_date)
        VALUES (${TEST_USERS[0]}, '二', 'burned', 365, 2.6, 0, now() + interval '365 days')`
  )
  await db.execute(
    sql`INSERT INTO user_kanji_progress (user_id, kanji, status, interval_days, ease_factor, lapse_count, due_date)
        VALUES (${TEST_USERS[1]}, '一', 'learning', 1, 2.5, 1, now() + interval '1 day')`
  )
}

describe('backfillUniversalKg', () => {
  beforeEach(resetFixtures)

  it('creates a learner_identity row for each user with progress', async () => {
    await backfillUniversalKg(db)
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM learner_identity WHERE learner_id = ANY(${sql.raw(
        `ARRAY['${TEST_USERS[0]}','${TEST_USERS[1]}']::uuid[]`
      )})`
    )
    expect((rows[0] as { n: number }).n).toBe(2)
  })

  it('mirrors every progress row into learner_knowledge_state', async () => {
    await backfillUniversalKg(db)
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM learner_knowledge_state WHERE learner_id = ANY(${sql.raw(
        `ARRAY['${TEST_USERS[0]}','${TEST_USERS[1]}']::uuid[]`
      )})`
    )
    expect((rows[0] as { n: number }).n).toBe(3)
  })

  it('sets mastery_level according to MASTERY_BY_STATUS', async () => {
    await backfillUniversalKg(db)
    const rows = await db.execute(
      sql`SELECT subject, mastery_level::float AS m FROM learner_knowledge_state
          WHERE learner_id = ${TEST_USERS[0]} ORDER BY subject`
    )
    const bySubject = Object.fromEntries(
      rows.map((r) => [(r as { subject: string }).subject, (r as { m: number }).m])
    )
    expect(bySubject['kanji:一']).toBeCloseTo(0.6, 3)
    expect(bySubject['kanji:二']).toBeCloseTo(1.0, 3)
  })

  it('is idempotent — running twice produces the same row counts', async () => {
    await backfillUniversalKg(db)
    await backfillUniversalKg(db)
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM learner_knowledge_state WHERE learner_id = ANY(${sql.raw(
        `ARRAY['${TEST_USERS[0]}','${TEST_USERS[1]}']::uuid[]`
      )})`
    )
    expect((rows[0] as { n: number }).n).toBe(3)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- backfill`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the backfill script**

Create `packages/db/src/seeds/backfill-universal-kg.ts`:

```typescript
// packages/db/src/seeds/backfill-universal-kg.ts
// One-time migration: populate Universal Knowledge Graph tables from existing
// user_kanji_progress rows. Safe to run multiple times — uses onConflictDoNothing
// for identity and onConflictDoUpdate for knowledge state.

import { sql } from 'drizzle-orm'
import {
  learnerIdentity,
  learnerKnowledgeState,
  learnerTimelineEvents,
  userKanjiProgress,
} from '../schema'
import type { Db } from '../index'

// Duplicate of apps/api/src/services/buddy/constants.ts MASTERY_BY_STATUS.
// Kept inline to avoid a cross-package dependency from db → api.
const MASTERY_BY_STATUS = {
  unseen: 0,
  learning: 0.25,
  reviewing: 0.6,
  remembered: 0.85,
  burned: 1.0,
} as const

type SrsStatus = keyof typeof MASTERY_BY_STATUS

export async function backfillUniversalKg(db: Db): Promise<{
  identitiesInserted: number
  knowledgeRowsInserted: number
  timelineEventsInserted: number
}> {
  const progressRows = await db.select().from(userKanjiProgress)

  const uniqueUsers = Array.from(new Set(progressRows.map((r) => r.userId)))

  // 1. learner_identity — insert one per user, idempotent
  let identitiesInserted = 0
  for (const userId of uniqueUsers) {
    const result = await db
      .insert(learnerIdentity)
      .values({ learnerId: userId })
      .onConflictDoNothing()
      .returning({ learnerId: learnerIdentity.learnerId })
    identitiesInserted += result.length
  }

  // 2. learner_knowledge_state — upsert one per (user, kanji)
  let knowledgeRowsInserted = 0
  for (const row of progressRows) {
    const subject = `kanji:${row.kanji}`
    const mastery = MASTERY_BY_STATUS[row.status as SrsStatus] ?? 0
    const result = await db
      .insert(learnerKnowledgeState)
      .values({
        learnerId: row.userId,
        subject,
        masteryLevel: mastery,
        reviewCount: 0, // unknown from legacy data
        lastReviewedAt: row.updatedAt ?? null,
        appSource: 'kanji-learn-legacy',
      })
      .onConflictDoUpdate({
        target: [learnerKnowledgeState.learnerId, learnerKnowledgeState.subject],
        set: {
          masteryLevel: mastery,
          lastReviewedAt: row.updatedAt ?? null,
          updatedAt: new Date(),
        },
      })
      .returning({ learnerId: learnerKnowledgeState.learnerId })
    knowledgeRowsInserted += result.length
  }

  // 3. learner_timeline_events — one "legacy_import" event per user, idempotent
  // via a uniqueness check on (learner_id, event_type='legacy_import').
  let timelineEventsInserted = 0
  for (const userId of uniqueUsers) {
    const existing = await db.execute(
      sql`SELECT 1 FROM learner_timeline_events
          WHERE learner_id = ${userId} AND event_type = 'legacy_import' LIMIT 1`
    )
    if (existing.length > 0) continue
    await db.insert(learnerTimelineEvents).values({
      learnerId: userId,
      eventType: 'legacy_import',
      subject: null,
      appSource: 'kanji-learn-legacy',
      payload: { source: 'backfill-universal-kg.ts', version: 1 },
    })
    timelineEventsInserted += 1
  }

  return { identitiesInserted, knowledgeRowsInserted, timelineEventsInserted }
}

// CLI entry — run with: `pnpm --filter @kanji-learn/db tsx src/seeds/backfill-universal-kg.ts`
if (require.main === module) {
  ;(async () => {
    const { drizzle } = await import('drizzle-orm/postgres-js')
    const postgresImport = (await import('postgres')).default
    const client = postgresImport(process.env.DATABASE_URL!)
    const db = drizzle(client, { schema: await import('../schema') })
    const result = await backfillUniversalKg(db as unknown as Db)
    // eslint-disable-next-line no-console
    console.log('Backfill complete:', result)
    await client.end()
  })().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Backfill failed:', err)
    process.exit(1)
  })
}
```

- [ ] **Step 4: Re-export from `packages/db/src/index.ts`** (if seeds are re-exported)

If `packages/db/src/index.ts` already re-exports seeds, add:

```typescript
export * from './seeds/backfill-universal-kg'
```

Otherwise, the API test imports via the subpath `@kanji-learn/db/seeds/backfill-universal-kg`. Ensure `packages/db/package.json` "exports" field allows this (or just use a relative path from the test).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @kanji-learn/api test -- backfill`
Expected: PASS — 4 tests passing.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/seeds/backfill-universal-kg.ts packages/db/src/index.ts apps/api/test/integration/backfill.test.ts
git commit -m "feat(db): add universal knowledge graph backfill script"
```

---

### Task 21: Add new environment variables

**Files:**
- Modify: `apps/api/src/lib/env.ts`

The router and rate limiter both need configuration from env vars. All defaults are set so local dev works out of the box.

- [ ] **Step 1: Read the existing env file to find the schema**

Run: `cat apps/api/src/lib/env.ts`
Expected: a Zod schema (or similar) listing existing env vars like `DATABASE_URL`, `ANTHROPIC_API_KEY`.

- [ ] **Step 2: Add new env vars to the schema**

In `apps/api/src/lib/env.ts`, extend the Zod object:

```typescript
// inside z.object({ ... })
  GROQ_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  BUDDY_TIER2_DAILY_CAP_PER_USER: z.coerce.number().int().positive().default(50),
  BUDDY_TIER3_DAILY_CAP_PER_USER: z.coerce.number().int().positive().default(5),
  LLM_PRIMARY_TIER2_PROVIDER: z.enum(['groq', 'gemini']).default('groq'),
  LLM_SECONDARY_TIER2_PROVIDER: z.enum(['groq', 'gemini']).default('gemini'),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @kanji-learn/api typecheck`
Expected: no errors.

- [ ] **Step 4: Document in `.env.example`**

Append to `apps/api/.env.example` (create if missing):

```
# Kanji Buddy LLM configuration
GROQ_API_KEY=
GEMINI_API_KEY=
BUDDY_TIER2_DAILY_CAP_PER_USER=50
BUDDY_TIER3_DAILY_CAP_PER_USER=5
LLM_PRIMARY_TIER2_PROVIDER=groq
LLM_SECONDARY_TIER2_PROVIDER=gemini
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/env.ts apps/api/.env.example
git commit -m "feat(api): add env vars for buddy llm router"
```

---

### Task 22: Wire services into Fastify server

**Files:**
- Modify: `apps/api/src/server.ts`

Compose the router with concrete providers, rate limiter, and telemetry writer, then decorate the Fastify instance so route handlers can access them via `fastify.buddyLLM`, `fastify.learnerState`, and `fastify.dualWrite`.

- [ ] **Step 1: Read the current `server.ts` to see its decorator pattern**

Run: `cat apps/api/src/server.ts`
Expected: fastify instance, `.decorate()` calls for existing services (SrsService, MnemonicService, etc.).

- [ ] **Step 2: Import all the new pieces**

At the top of `server.ts`:

```typescript
import { GroqProvider } from './services/llm/providers/groq'
import { GeminiProvider } from './services/llm/providers/gemini'
import { ClaudeProvider } from './services/llm/providers/claude'
import { AppleFoundationStubProvider } from './services/llm/providers/apple-foundation-stub'
import { BuddyLLMRouter } from './services/llm/router'
import { RateLimiter } from './services/llm/rate-limit'
import { createTelemetryWriter } from './services/llm/telemetry'
import { DualWriteService } from './services/buddy/dual-write.service'
import { LearnerStateService } from './services/buddy/learner-state.service'
import type { LLMProvider } from '@kanji-learn/shared'
```

- [ ] **Step 3: Construct the router inside `buildServer()`**

Inside the server factory function, after `const db = drizzle(...)` and the existing service constructions, add:

```typescript
// ── LLM providers ────────────────────────────────────────────────────────
const onDevice = new AppleFoundationStubProvider()
const groq = new GroqProvider(env.GROQ_API_KEY ?? '')
const gemini = new GeminiProvider(env.GEMINI_API_KEY ?? '')
const claude = new ClaudeProvider(env.ANTHROPIC_API_KEY)

function pickProvider(name: 'groq' | 'gemini'): LLMProvider {
  return name === 'groq' ? groq : gemini
}
const tier2Primary = pickProvider(env.LLM_PRIMARY_TIER2_PROVIDER)
const tier2Secondary = pickProvider(env.LLM_SECONDARY_TIER2_PROVIDER)

// ── Rate limiter ─────────────────────────────────────────────────────────
const rateLimiter = new RateLimiter(db, {
  tier2DailyCap: env.BUDDY_TIER2_DAILY_CAP_PER_USER,
  tier3DailyCap: env.BUDDY_TIER3_DAILY_CAP_PER_USER,
})

// ── Router ───────────────────────────────────────────────────────────────
const buddyLLM = new BuddyLLMRouter({
  onDevice,
  tier2Primary,
  tier2Secondary,
  tier3: claude,
  rateLimiter,
  emitTelemetry: createTelemetryWriter(db),
})

// ── Buddy services ───────────────────────────────────────────────────────
const dualWrite = new DualWriteService(db)
const learnerState = new LearnerStateService(db)

// Pass dualWrite into SrsService (updated in Task 18)
const srs = new SrsService(db, dualWrite)
```

- [ ] **Step 4: Decorate the Fastify instance**

Immediately before `return server`:

```typescript
server.decorate('buddyLLM', buddyLLM)
server.decorate('learnerState', learnerState)
server.decorate('dualWrite', dualWrite)
server.decorate('srs', srs)
```

- [ ] **Step 5: Update the Fastify type declaration**

If `apps/api/src/types/fastify.d.ts` (or similar) exists, add to the `FastifyInstance` declaration:

```typescript
import type { BuddyLLMRouter } from '../services/llm/router'
import type { LearnerStateService } from '../services/buddy/learner-state.service'
import type { DualWriteService } from '../services/buddy/dual-write.service'

declare module 'fastify' {
  interface FastifyInstance {
    buddyLLM: BuddyLLMRouter
    learnerState: LearnerStateService
    dualWrite: DualWriteService
  }
}
```

If no such file exists, create `apps/api/src/types/fastify.d.ts` with the contents above.

- [ ] **Step 6: Typecheck and boot the server**

Run: `pnpm --filter @kanji-learn/api typecheck`
Expected: no errors.

Run: `pnpm --filter @kanji-learn/api dev` (in a separate terminal)
Expected: server starts without errors. Ctrl-C to stop.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/types/fastify.d.ts
git commit -m "feat(api): wire buddy services and llm router into fastify"
```

---

### Task 23: Custom SQL migration — CHECK constraints, materialized view, indexes

**Files:**
- Create: `packages/db/drizzle/0009_kanji_buddy_phase0_custom.sql`

Some things drizzle-kit can't express cleanly:
- CHECK constraints on enum-like text columns (e.g. `learner_knowledge_state.subject` length cap)
- Materialized view `kanji_mastery_view` for dashboard queries (design doc §4.5)
- Partial indexes for efficient leech lookups

Drizzle applies raw `.sql` files in `packages/db/drizzle/` in filename order, so this file runs after the drizzle-kit generated one.

- [ ] **Step 1: Create the custom migration**

Create `packages/db/drizzle/0009_kanji_buddy_phase0_custom.sql`:

```sql
-- 0009_kanji_buddy_phase0_custom.sql
-- Constraints, views, and indexes that drizzle-kit cannot express from schema.ts.

-- ── CHECK constraints ─────────────────────────────────────────────────────

-- UKG subjects are namespaced strings ("kanji:持", "word:学校"). Cap at 200.
ALTER TABLE learner_knowledge_state
  ADD CONSTRAINT learner_knowledge_state_subject_length
  CHECK (length(subject) <= 200);

-- mastery_level is a probability-like value in [0, 1]
ALTER TABLE learner_knowledge_state
  ADD CONSTRAINT learner_knowledge_state_mastery_range
  CHECK (mastery_level >= 0 AND mastery_level <= 1);

-- Daily LLM call counts are non-negative
ALTER TABLE buddy_llm_usage
  ADD CONSTRAINT buddy_llm_usage_count_nonneg
  CHECK (call_count >= 0);

-- ── Partial indexes ───────────────────────────────────────────────────────

-- Leech lookups: "give me kanji where lapseCount ≥ 3 AND status ≠ burned"
-- A partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS user_kanji_progress_leech_idx
  ON user_kanji_progress (user_id, lapse_count DESC)
  WHERE lapse_count >= 3 AND status != 'burned';

-- Timeline events by (learner, created_at) for timeline reads
CREATE INDEX IF NOT EXISTS learner_timeline_events_learner_time_idx
  ON learner_timeline_events (learner_id, created_at DESC);

-- ── Materialized view: kanji_mastery_view ─────────────────────────────────
-- One row per (user, kanji) with derived mastery and latest review info.
-- Refreshed nightly by a scheduled job (added in Phase 1).

CREATE MATERIALIZED VIEW IF NOT EXISTS kanji_mastery_view AS
SELECT
  ukp.user_id,
  ukp.kanji,
  ukp.status,
  CASE ukp.status
    WHEN 'unseen' THEN 0.0
    WHEN 'learning' THEN 0.25
    WHEN 'reviewing' THEN 0.6
    WHEN 'remembered' THEN 0.85
    WHEN 'burned' THEN 1.0
    ELSE 0.0
  END AS mastery_level,
  ukp.lapse_count,
  ukp.interval_days,
  ukp.due_date,
  ukp.updated_at AS last_progress_update
FROM user_kanji_progress ukp;

CREATE UNIQUE INDEX IF NOT EXISTS kanji_mastery_view_user_kanji_idx
  ON kanji_mastery_view (user_id, kanji);
```

- [ ] **Step 2: Add the migration to drizzle's journal**

Open `packages/db/drizzle/meta/_journal.json`. Drizzle-kit only tracks `.sql` files it generated. To make drizzle-kit run this custom file as part of `db:migrate`, append a journal entry matching the filename:

```json
{
  "idx": 9,
  "version": "7",
  "when": <current unix ms timestamp>,
  "tag": "0009_kanji_buddy_phase0_custom",
  "breakpoints": true
}
```

(Look at the previous entry for the exact field names — they may differ slightly by drizzle-kit version. Mirror that shape.)

- [ ] **Step 3: Apply the migration**

Run: `pnpm --filter @kanji-learn/db db:migrate`
Expected: "0009_kanji_buddy_phase0_custom" applies cleanly.

- [ ] **Step 4: Verify the view and constraints exist**

```sql
-- Should return one row
SELECT matviewname FROM pg_matviews WHERE matviewname = 'kanji_mastery_view';

-- Should return the three CHECK constraint names
SELECT conname FROM pg_constraint
WHERE conname IN (
  'learner_knowledge_state_subject_length',
  'learner_knowledge_state_mastery_range',
  'buddy_llm_usage_count_nonneg'
);

-- Should return the partial index
SELECT indexname FROM pg_indexes WHERE indexname = 'user_kanji_progress_leech_idx';
```

Expected: all four queries return the expected rows.

- [ ] **Step 5: Re-run the Task 17 test — the "rolls back" case should now pass**

Run: `pnpm --filter @kanji-learn/api test -- dual-write`
Expected: PASS — 3 tests, including the rollback case, because the subject length CHECK now fires.

- [ ] **Step 6: Commit**

```bash
git add packages/db/drizzle/0009_kanji_buddy_phase0_custom.sql packages/db/drizzle/meta/_journal.json
git commit -m "feat(db): add custom sql migration for checks, partial index, and mastery view"
```

---

### Task 24: Final integration test — end-to-end review submission

**Files:**
- Create: `apps/api/test/integration/phase0-smoke.test.ts`

This is the gate that says "Phase 0 is done." It submits a review via the real Fastify instance, then asserts that all the right tables were touched: `review_logs`, `user_kanji_progress`, `learner_knowledge_state`, `learner_timeline_events`, plus a `learner_state_cache` refresh.

- [ ] **Step 1: Write the smoke test**

Create `apps/api/test/integration/phase0-smoke.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { buildServer } from '../../src/server'
import type { FastifyInstance } from 'fastify'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER = '00000000-0000-0000-0000-0000000smoke'
const TEST_KANJI = '新'

let server: FastifyInstance

beforeAll(async () => {
  server = await buildServer()
  await server.ready()
})

afterAll(async () => {
  await server.close()
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM learner_timeline_events WHERE learner_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM learner_knowledge_state WHERE learner_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM review_logs WHERE user_id = ${TEST_USER}`)
  await db.execute(
    sql`DELETE FROM user_kanji_progress WHERE user_id = ${TEST_USER} AND kanji = ${TEST_KANJI}`
  )
  await db.execute(sql`DELETE FROM review_sessions WHERE user_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM learner_state_cache WHERE user_id = ${TEST_USER}`)
  await db.execute(
    sql`INSERT INTO user_profiles (id, display_name, timezone) VALUES (${TEST_USER}, 'Smoke', 'UTC') ON CONFLICT DO NOTHING`
  )
  await db.execute(
    sql`INSERT INTO learner_identity (learner_id) VALUES (${TEST_USER}) ON CONFLICT DO NOTHING`
  )
  await db.execute(
    sql`INSERT INTO kanji (character, meaning, jlpt_level) VALUES (${TEST_KANJI}, 'new', 5) ON CONFLICT DO NOTHING`
  )
})

describe('Phase 0 smoke — end-to-end review submission', () => {
  it('records the review across app + UKG tables and refreshes learner state', async () => {
    // Submit via the injected services directly (bypasses auth, which is
    // covered in Phase 1). This exercises SrsService → DualWriteService → UKG.
    const srs = (server as unknown as { srs: import('../../src/services/srs.service').SrsService }).srs
    await srs.submitReview(
      TEST_USER,
      [{ kanji: TEST_KANJI, reviewType: 'meaning', wasCorrect: true, responseTimeMs: 1100 }],
      3000
    )

    // Refresh learner state (this is normally fire-and-forget from the route)
    await server.learnerState.refreshState(TEST_USER)

    // All five tables should show the submission
    const reviewLogCount = (
      await db.execute(
        sql`SELECT count(*)::int AS n FROM review_logs WHERE user_id = ${TEST_USER}`
      )
    )[0] as { n: number }
    expect(reviewLogCount.n).toBe(1)

    const progressRow = (
      await db.execute(
        sql`SELECT status FROM user_kanji_progress WHERE user_id = ${TEST_USER} AND kanji = ${TEST_KANJI}`
      )
    )[0] as { status: string } | undefined
    expect(progressRow?.status).toBeDefined()

    const ukgRow = (
      await db.execute(
        sql`SELECT mastery_level::float AS m FROM learner_knowledge_state
            WHERE learner_id = ${TEST_USER} AND subject = ${'kanji:' + TEST_KANJI}`
      )
    )[0] as { m: number } | undefined
    expect(ukgRow?.m).toBeGreaterThan(0)

    const timelineCount = (
      await db.execute(
        sql`SELECT count(*)::int AS n FROM learner_timeline_events WHERE learner_id = ${TEST_USER}`
      )
    )[0] as { n: number }
    expect(timelineCount.n).toBe(1)

    const cacheRow = (
      await db.execute(
        sql`SELECT total_kanji_seen::int AS seen FROM learner_state_cache WHERE user_id = ${TEST_USER}`
      )
    )[0] as { seen: number } | undefined
    expect(cacheRow?.seen).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the smoke test**

Run: `pnpm --filter @kanji-learn/api test -- phase0-smoke`
Expected: PASS — 1 test.

- [ ] **Step 3: Run the full test suite — everything should pass**

Run: `pnpm --filter @kanji-learn/api test`
Expected: every test file passes. **Phase 0 is done.**

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/integration/phase0-smoke.test.ts
git commit -m "test(api): add phase 0 end-to-end smoke test"
```

- [ ] **Step 5: Tag the phase**

```bash
git tag -a phase-0-complete -m "Kanji Buddy Phase 0 (Foundation) complete"
```

---

## Self-Review Checklist

Before handing off to execution, verify the plan itself:

**Spec coverage:**
- [x] All 15 new tables defined (Tasks 1–3)
- [x] All 8 new enums defined (Task 1)
- [x] Existing tables altered (Task 4): `reviewSessions.deviceType`, `reviewLogs.deviceType`, `testSessions.deviceType`, `mnemonics` cocreation columns, `userProfiles.onboardingCompletedAt`
- [x] Telemetry tables (`buddy_llm_telemetry`, `buddy_llm_usage`) created (Task 4)
- [x] Migration generated and applied (Task 5)
- [x] Shared buddy types (Task 6) and LLM interface (Task 7)
- [x] Test runner and scaffolding (Task 8)
- [x] LLM types + tier classification (Task 9)
- [x] Rate limiter with daily caps (Task 10)
- [x] All three LLM providers + Apple FM server stub (Tasks 11–13)
- [x] Router with tier classification, fail-over, truncation, telemetry hooks (Task 14)
- [x] Buddy constants (Task 15)
- [x] Learner state computation + persistence (Task 16)
- [x] Dual-write service with transaction integrity (Task 17)
- [x] SRS service integrated with dual-write (Task 18)
- [x] Telemetry writer (Task 19)
- [x] Universal Knowledge Graph backfill (Task 20)
- [x] Env vars + wiring (Tasks 21–22)
- [x] Custom SQL for CHECKs, partial indexes, materialized view (Task 23)
- [x] End-to-end smoke test (Task 24)

**Placeholder scan:** no "TBD", "implement later", "similar to previous", or bare "add error handling" steps remain.

**Type consistency:**
- `LLMProvider` interface (shared/llm-types.ts) ← implemented by GroqProvider, GeminiProvider, ClaudeProvider, AppleFoundationStubProvider (Tasks 11–13) ← consumed by BuddyLLMRouter (Task 14) ✅
- `BuddyRequest` / `classifyTier` (api/services/llm/types.ts, Task 9) ← used by BuddyLLMRouter (Task 14) ✅
- `TelemetryEvent` / `EmitTelemetry` exported from `router.ts` (Task 14) ← implemented by `createTelemetryWriter` (Task 19) ✅
- `RateLimiterLike` interface (Task 14) ← satisfied by `RateLimiter` (Task 10) ✅
- `MASTERY_BY_STATUS` (api/services/buddy/constants.ts, Task 15) ← used by LearnerStateService (Task 16) and DualWriteService (Task 17); duplicated in backfill (Task 20) with a code comment explaining why ✅
- `ScaffoldLevel` type (Task 15) ← used by LearnerStateService (Task 16) ✅
- `ReviewSubmissionInput` (DualWriteService, Task 17) ← consumed by SrsService (Task 18) ✅
- `SrsService(db, dualWrite)` constructor signature (Task 18) ← used in Fastify wiring (Task 22) ✅

**Method name audit:**
- `RateLimiter.tryConsume(userId, tier)` — Task 10, 14
- `RateLimiter.remainingForTier(userId, tier)` — Task 10, 14
- `BuddyLLMRouter.route(request)` — Task 14
- `BuddyLLMRouter.truncateForContext(system, msgs, max)` — Task 14
- `LearnerStateService.refreshState(userId)` — Tasks 16, 22, 24
- `LearnerStateService.getState(userId)` — Task 16
- `DualWriteService.recordReviewSubmission(input)` — Tasks 17, 18
- `computeLearnerState(input)` — Task 16 (pure function, importable from the service module)
- `backfillUniversalKg(db)` — Task 20

All match between definition and usage. ✅

**Migration filenames:** Tasks 5 and 23 both add migrations. Task 5 generates `0008_...`, Task 23 creates `0009_kanji_buddy_phase0_custom.sql`. Drizzle applies them in filename order. ✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-10-kanji-buddy-phase-0-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
