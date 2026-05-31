# Onboarding Tutorial + Questionnaire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 5-step onboarding wizard that runs once for every new user, teaches core UI conventions, collects learner profile data, and gates the main tab interface until complete — plus surface that profile data in the Profile tab for ongoing editing.

**Architecture:** Single-screen wizard (`app/onboarding.tsx`) with `currentStep` state and horizontal slide animations; all visible strings in an OTA-updatable config file; nav gate in `_layout.tsx` via a new `useProfile` hook; two new API endpoints for learner profile data; a DB migration adds `country` to `learner_profiles` and backfills `onboarding_completed_at` for existing users; InfoButton/InfoPanel added to journal, writing, and voice tabs.

**Tech Stack:** React Native / Expo Router, Fastify + drizzle-orm, Supabase/Postgres, Zod (validation), Vitest (API tests)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/db/supabase/migrations/0013_onboarding_setup.sql` | Add `country` column + backfill |
| Modify | `packages/db/src/schema.ts` | Add `country` to `learnerProfiles` drizzle table |
| Modify | `packages/shared/src/constants.ts` | Fix `TOTAL_JOUYOU_KANJI` 2294 → 2136 |
| Modify | `apps/api/src/routes/user.ts` | Add `onboardingCompletedAt` to PATCH schema |
| Create | `apps/api/src/routes/learner-profile.ts` | `GET` + `PATCH /v1/user/learner-profile` |
| Modify | `apps/api/src/server.ts` | Register new learner-profile route |
| Create | `apps/api/test/integration/learner-profile.test.ts` | Integration tests for new endpoints |
| Create | `apps/mobile/src/config/onboarding-content.ts` | All onboarding strings (OTA-updatable) |
| Create | `apps/mobile/src/hooks/useProfile.ts` | Fetch + cache user profile (used by nav gate) |
| Create | `apps/mobile/src/hooks/useLearnerProfile.ts` | Fetch + update learner profile |
| Modify | `apps/mobile/src/stores/auth.store.ts` | Clear profile cache on sign-out |
| Create | `apps/mobile/app/onboarding.tsx` | 5-step wizard screen |
| Modify | `apps/mobile/app/_layout.tsx` | Onboarding gate + register Stack.Screen |
| Modify | `apps/mobile/app/(tabs)/journal.tsx` | Add InfoButton + InfoPanel |
| Modify | `apps/mobile/app/(tabs)/writing.tsx` | Add InfoButton + InfoPanel |
| Modify | `apps/mobile/app/(tabs)/voice.tsx` | Add InfoButton + InfoPanel |
| Modify | `apps/mobile/app/(tabs)/profile.tsx` | Add Learning Profile section |

---

## Task 1 — Fix TOTAL_JOUYOU_KANJI constant

**Files:**
- Modify: `packages/shared/src/constants.ts`

- [ ] **Step 1: Find the constant**

Run:
```bash
grep -n "TOTAL_JOUYOU_KANJI" packages/shared/src/constants.ts
```
Expected: a line like `export const TOTAL_JOUYOU_KANJI = 2294`

- [ ] **Step 2: Fix it**

In `packages/shared/src/constants.ts`, change `2294` to `2136`:
```ts
export const TOTAL_JOUYOU_KANJI = 2136  // 2010 Jōyō list — does not include Jinmeiyō
```

- [ ] **Step 3: Verify consumers still compile**

```bash
grep -rn "TOTAL_JOUYOU_KANJI" apps/ packages/
```
Expected: all occurrences import the constant — no magic numbers to update.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/constants.ts
git commit -m "fix: correct TOTAL_JOUYOU_KANJI constant from 2294 to 2136

2294 incorrectly included 158 Jinmeiyō kanji. The Jōyō list
(2010 revision) contains exactly 2,136 characters.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2 — DB migration + drizzle schema update

**Files:**
- Create: `packages/db/supabase/migrations/0013_onboarding_setup.sql`
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Create the migration file**

Create `packages/db/supabase/migrations/0013_onboarding_setup.sql`:
```sql
-- 0013_onboarding_setup.sql
--
-- 1. Add country column to learner_profiles
-- 2. Backfill onboarding_completed_at for existing users so they
--    are never shown the onboarding wizard.

ALTER TABLE learner_profiles
  ADD COLUMN IF NOT EXISTS country TEXT;

-- Backfill: any user_profile row without onboarding_completed_at
-- already exists → mark them as having completed onboarding.
UPDATE user_profiles
SET onboarding_completed_at = NOW()
WHERE onboarding_completed_at IS NULL;
```

- [ ] **Step 2: Update the drizzle schema**

In `packages/db/src/schema.ts`, find the `learnerProfiles` table (around line 444) and add the `country` column after `userId`:

```ts
export const learnerProfiles = pgTable('learner_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => userProfiles.id, { onDelete: 'cascade' }),
  country: text('country'),                                          // ← add this line
  nativeLanguage: text('native_language'),
  reasonsForLearning: jsonb('reasons_for_learning').$type<string[]>().notNull().default([]),
  interests: jsonb('interests').$type<string[]>().notNull().default([]),
  preferredMnemonicStyle: text('preferred_mnemonic_style'),
  preferredLearningStyles: jsonb('preferred_learning_styles').$type<string[]>().notNull().default([]),
  buddyPersonalityPref: buddyPersonalityEnum('buddy_personality_pref').notNull().default('encouraging'),
  studyEnvironments: jsonb('study_environments').$type<string[]>().notNull().default([]),
  goals: jsonb('goals').$type<string[]>().notNull().default([]),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 3: Apply migration to your local / staging Supabase**

```bash
# Via Supabase CLI (run from project root)
supabase db push --local

# Or directly against the target DB:
psql $DATABASE_URL < packages/db/supabase/migrations/0013_onboarding_setup.sql
```

Verify with:
```bash
psql $DATABASE_URL -c "\d learner_profiles" | grep country
```
Expected: `country | text | | |`

- [ ] **Step 4: Commit**

```bash
git add packages/db/supabase/migrations/0013_onboarding_setup.sql packages/db/src/schema.ts
git commit -m "feat: add country to learner_profiles, backfill onboarding_completed_at

New migration adds country column and marks all existing users as
having completed onboarding so they bypass the wizard.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3 — Extend PATCH /v1/user/profile with onboardingCompletedAt

**Files:**
- Modify: `apps/api/src/routes/user.ts`

The GET endpoint already returns the full drizzle row (including `onboardingCompletedAt`) — no change needed there. Only the PATCH schema needs updating.

- [ ] **Step 1: Add field to the Zod schema**

In `apps/api/src/routes/user.ts`, update `updateProfileSchema` (currently lines 6-14):

```ts
const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  dailyGoal: z.number().int().min(5).max(200).optional(),
  notificationsEnabled: z.boolean().optional(),
  pushToken: z.string().max(200).nullable().optional(),
  timezone: z.string().optional(),
  reminderHour: z.number().int().min(0).max(23).optional(),
  restDay: z.number().int().min(0).max(6).nullable().optional(),
  onboardingCompletedAt: z.string().datetime().optional(),  // ← add this line
})
```

- [ ] **Step 2: Verify the server still starts**

```bash
cd apps/api && npm run build 2>&1 | tail -20
```
Expected: no TypeScript errors.

- [ ] **Step 3: Manual smoke test**

```bash
curl -s -X PATCH https://YOUR_API/v1/user/profile \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"onboardingCompletedAt":"2026-01-01T00:00:00.000Z"}' | jq .
```
Expected: `{ "ok": true, "data": { ..., "onboardingCompletedAt": "2026-01-01T00:00:00.000Z", ... } }`

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/user.ts
git commit -m "feat: accept onboardingCompletedAt in PATCH /v1/user/profile

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4 — Create and register learner-profile API route

**Files:**
- Create: `apps/api/src/routes/learner-profile.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Create the route file**

Create `apps/api/src/routes/learner-profile.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { learnerProfiles } from '@kanji-learn/db'
import { z } from 'zod'

const patchLearnerProfileSchema = z.object({
  country: z.string().max(100).nullable().optional(),
  reasonsForLearning: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
})

export async function learnerProfileRoutes(server: FastifyInstance) {
  // GET /v1/user/learner-profile
  // Returns the current user's learner profile row.
  // If no row exists yet, returns null for all fields (not an error).
  server.get('/learner-profile', { preHandler: [server.authenticate] }, async (req, reply) => {
    const row = await server.db.query.learnerProfiles.findFirst({
      where: eq(learnerProfiles.userId, req.userId!),
    })

    return reply.send({
      ok: true,
      data: {
        country: row?.country ?? null,
        reasonsForLearning: row?.reasonsForLearning ?? [],
        interests: row?.interests ?? [],
      },
    })
  })

  // PATCH /v1/user/learner-profile
  // Upserts the row. Fields not included in the body are left unchanged.
  server.patch('/learner-profile', { preHandler: [server.authenticate] }, async (req, reply) => {
    const body = patchLearnerProfileSchema.safeParse(req.body)
    if (!body.success) {
      return reply
        .code(400)
        .send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR', details: body.error })
    }

    await server.db
      .insert(learnerProfiles)
      .values({
        userId: req.userId!,
        ...body.data,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: learnerProfiles.userId,
        set: {
          ...body.data,
          updatedAt: new Date(),
        },
      })

    return reply.send({ ok: true })
  })
}
```

- [ ] **Step 2: Register the route in server.ts**

In `apps/api/src/server.ts`, add the import and registration. After the existing `userRoutes` import (line 14):

```ts
import { learnerProfileRoutes } from './routes/learner-profile.js'
```

And after the `userRoutes` registration (line 117):

```ts
await server.register(userRoutes, { prefix: '/v1/user' })
await server.register(learnerProfileRoutes, { prefix: '/v1/user' })  // ← add this line
```

Note: using the same `/v1/user` prefix gives us `/v1/user/learner-profile` for both endpoints.

- [ ] **Step 3: Verify the build**

```bash
cd apps/api && npm run build 2>&1 | tail -20
```
Expected: no TypeScript errors.

- [ ] **Step 4: Verify the routes exist**

Start the server locally and check:
```bash
curl -s http://localhost:3000/v1/user/learner-profile \
  -H "Authorization: Bearer $TEST_TOKEN" | jq .
```
Expected: `{ "ok": true, "data": { "country": null, "reasonsForLearning": [], "interests": [] } }`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/learner-profile.ts apps/api/src/server.ts
git commit -m "feat: add GET + PATCH /v1/user/learner-profile endpoints

Upserts learner_profiles row. GET returns null-safe defaults if no row
exists. PATCH accepts country, reasonsForLearning, interests.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5 — API integration tests for learner-profile

**Files:**
- Create: `apps/api/test/integration/learner-profile.test.ts`

These tests follow the existing pattern in `phase0-smoke.test.ts`: use drizzle directly against a test DB — no Fastify server boot (the auth plugin requires network for JWKS).

- [ ] **Step 1: Create the test file**

Create `apps/api/test/integration/learner-profile.test.ts`:

```ts
// apps/api/test/integration/learner-profile.test.ts
//
// Tests for learner_profiles upsert logic (the core of the
// PATCH /v1/user/learner-profile endpoint).
//
// We bypass Fastify and test the drizzle operations directly —
// the same pattern used in phase0-smoke.test.ts.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER = '00000000-0000-0000-0000-000000000888'

beforeAll(async () => {
  await db.execute(sql`
    INSERT INTO user_profiles (id, display_name, timezone)
    VALUES (${TEST_USER}, 'LearnerProfileTest', 'UTC')
    ON CONFLICT DO NOTHING
  `)
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM learner_profiles WHERE user_id = ${TEST_USER}`)
  await db.execute(sql`DELETE FROM user_profiles WHERE id = ${TEST_USER}`)
  await client.end()
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM learner_profiles WHERE user_id = ${TEST_USER}`)
})

describe('learner_profiles upsert', () => {
  it('creates a row on first PATCH', async () => {
    await db
      .insert(schema.learnerProfiles)
      .values({
        userId: TEST_USER,
        country: 'AU',
        reasonsForLearning: ['Travel', 'Curiosity'],
        interests: ['Anime / Manga'],
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.learnerProfiles.userId,
        set: {
          country: 'AU',
          reasonsForLearning: ['Travel', 'Curiosity'],
          interests: ['Anime / Manga'],
          updatedAt: new Date(),
        },
      })

    const row = await db.query.learnerProfiles.findFirst({
      where: eq(schema.learnerProfiles.userId, TEST_USER),
    })

    expect(row).toBeDefined()
    expect(row!.country).toBe('AU')
    expect(row!.reasonsForLearning).toEqual(['Travel', 'Curiosity'])
    expect(row!.interests).toEqual(['Anime / Manga'])
  })

  it('updates only the supplied fields on subsequent PATCH', async () => {
    // First insert
    await db.insert(schema.learnerProfiles).values({
      userId: TEST_USER,
      country: 'JP',
      reasonsForLearning: ['Travel'],
      interests: ['Gaming'],
      updatedAt: new Date(),
    })

    // Partial update — only interests
    await db
      .insert(schema.learnerProfiles)
      .values({
        userId: TEST_USER,
        interests: ['Gaming', 'Film'],
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.learnerProfiles.userId,
        set: {
          interests: ['Gaming', 'Film'],
          updatedAt: new Date(),
        },
      })

    const row = await db.query.learnerProfiles.findFirst({
      where: eq(schema.learnerProfiles.userId, TEST_USER),
    })

    expect(row!.country).toBe('JP')                        // unchanged
    expect(row!.reasonsForLearning).toEqual(['Travel'])    // unchanged
    expect(row!.interests).toEqual(['Gaming', 'Film'])     // updated
  })

  it('GET returns null-safe defaults when no row exists', async () => {
    // No row inserted — simulate GET response construction
    const row = await db.query.learnerProfiles.findFirst({
      where: eq(schema.learnerProfiles.userId, TEST_USER),
    })

    const data = {
      country: row?.country ?? null,
      reasonsForLearning: row?.reasonsForLearning ?? [],
      interests: row?.interests ?? [],
    }

    expect(data.country).toBeNull()
    expect(data.reasonsForLearning).toEqual([])
    expect(data.interests).toEqual([])
  })

  it('stores null country when explicitly set to null', async () => {
    await db
      .insert(schema.learnerProfiles)
      .values({
        userId: TEST_USER,
        country: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.learnerProfiles.userId,
        set: { country: null, updatedAt: new Date() },
      })

    const row = await db.query.learnerProfiles.findFirst({
      where: eq(schema.learnerProfiles.userId, TEST_USER),
    })

    expect(row!.country).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
cd apps/api && TEST_DATABASE_URL=$TEST_DATABASE_URL npx vitest run test/integration/learner-profile.test.ts
```
Expected:
```
✓ learner_profiles upsert > creates a row on first PATCH
✓ learner_profiles upsert > updates only the supplied fields on subsequent PATCH
✓ learner_profiles upsert > GET returns null-safe defaults when no row exists
✓ learner_profiles upsert > stores null country when explicitly set to null
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/integration/learner-profile.test.ts
git commit -m "test: add integration tests for learner_profiles upsert logic

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6 — Mobile: onboarding-content.ts config file

**Files:**
- Create: `apps/mobile/src/config/onboarding-content.ts`

All onboarding strings live here. Because this file is pure JS/TS (no native code), it can be updated via Expo EAS OTA without an App Store submission.

- [ ] **Step 1: Create the config directory if it doesn't exist**

```bash
mkdir -p apps/mobile/src/config
```

- [ ] **Step 2: Create the file**

Create `apps/mobile/src/config/onboarding-content.ts`:

```ts
// apps/mobile/src/config/onboarding-content.ts
//
// All visible onboarding strings live here.
// This file is OTA-updatable via Expo EAS Update — no App Store
// rebuild needed to change copy.

export type InfoItem = {
  location: string
  description: string
}

export type OnboardingContent = typeof ONBOARDING_CONTENT

export const ONBOARDING_CONTENT = {
  welcome: {
    kanjiHero: '漢',
    headline: 'Your personal kanji companion.',
    body: 'Kanji Buddy is an AI-powered learning companion that builds a study plan around you — your goals, your pace, your weak spots.',
    tagline: 'Smarter than flashcards. Friendlier than a textbook.',
    cta: 'Get started',
  },

  findHelp: {
    headline: 'Help is always one tap away',
    items: [
      {
        location: 'Study',
        description: 'Tap ⓘ next to the grade buttons to see what Again / Good / Easy mean',
      },
      {
        location: 'Dashboard',
        description: 'Each stat card has an ⓘ explaining what the number means',
      },
      {
        location: 'Progress',
        description: 'Tap ⓘ on any chart or section for a full explanation',
      },
      {
        location: 'Journal',
        description: 'Tap ⓘ to learn how AI-generated mnemonics work and when to refresh them',
      },
      {
        location: 'Write',
        description: 'Tap ⓘ to understand how stroke-order scoring works',
      },
      {
        location: 'Speak',
        description: 'Tap ⓘ to see how reading evaluation difficulty levels work',
      },
    ] satisfies InfoItem[],
    footer: "You don't need to memorise any of this now.",
    cta: 'Got it',
  },

  aboutYou: {
    headline: 'About you',
    namePlaceholder: 'Your name',
    countryPlaceholder: 'Country (optional)',
    cta: 'Next',
  },

  focus: {
    headline: 'What are you focused on right now?',
    subhead: 'You can change this any time in your profile.',
    chips: [
      'Travel',
      'JLPT exam',
      'Work / Business',
      'Anime / Manga',
      'Heritage',
      'Curiosity',
      'Other',
    ],
    cta: 'Next',
  },

  dailyTarget: {
    headline: 'How many kanji per day?',
    options: [5, 10, 15, 20, 30, 50] as number[],
    defaultOption: 20,
    cta: "Let's go",
  },
} as const

// ─── Country list ──────────────────────────────────────────────────────────────
// Shown in the country picker modal on the "About you" step.
// OTA-updatable alongside the rest of this file.

export type Country = { code: string; name: string }

export const COUNTRIES: Country[] = [
  { code: 'AU', name: 'Australia' },
  { code: 'BR', name: 'Brazil' },
  { code: 'CA', name: 'Canada' },
  { code: 'CN', name: 'China' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IL', name: 'Israel' },
  { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'MX', name: 'Mexico' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'NO', name: 'Norway' },
  { code: 'PH', name: 'Philippines' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'RU', name: 'Russia' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'SG', name: 'Singapore' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'ES', name: 'Spain' },
  { code: 'SE', name: 'Sweden' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'TH', name: 'Thailand' },
  { code: 'TR', name: 'Turkey' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'OTHER', name: 'Other' },
]
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | grep onboarding-content
```
Expected: no output (no errors).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/config/onboarding-content.ts
git commit -m "feat: add OTA-updatable onboarding content config

All wizard strings, chip labels, and country list in one file.
No rebuild needed to update copy via Expo EAS Update.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7 — Mobile: useProfile hook

**Files:**
- Create: `apps/mobile/src/hooks/useProfile.ts`

This hook is used by `_layout.tsx` to check `onboardingCompletedAt` for the nav gate. It uses module-level caching (same pattern as `useAnalytics.ts`). `clearProfileCache()` is exported for the auth store's sign-out to call.

- [ ] **Step 1: Create the hook**

Create `apps/mobile/src/hooks/useProfile.ts`:

```ts
// apps/mobile/src/hooks/useProfile.ts
//
// Fetches the current user's profile and caches it in module-level state.
// Used by _layout.tsx to check onboardingCompletedAt for the nav gate.
//
// Call clearProfileCache() on sign-out (see auth.store.ts).

import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'

export type UserProfile = {
  id: string
  displayName: string | null
  email: string | null
  dailyGoal: number
  notificationsEnabled: boolean
  pushToken: string | null
  timezone: string
  reminderHour: number
  restDay: number | null
  onboardingCompletedAt: string | null
  createdAt: string
  updatedAt: string
}

// Module-level cache — shared across all hook instances in the same session.
let _cache: UserProfile | null = null
let _fetching = false
const _listeners = new Set<(p: UserProfile | null) => void>()

function notifyListeners(profile: UserProfile | null) {
  _listeners.forEach((fn) => fn(profile))
}

/** Call this from auth.store.ts signOut so the next session gets a fresh fetch. */
export function clearProfileCache() {
  _cache = null
  notifyListeners(null)
}

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(_cache)
  const [isLoading, setIsLoading] = useState(_cache === null)

  useEffect(() => {
    // Subscribe to cross-instance updates (e.g. update() called from onboarding.tsx)
    _listeners.add(setProfile)
    return () => { _listeners.delete(setProfile) }
  }, [])

  useEffect(() => {
    if (_cache) {
      setProfile(_cache)
      setIsLoading(false)
      return
    }
    if (_fetching) return

    _fetching = true
    api
      .get<UserProfile>('/v1/user/profile')
      .then((res) => {
        if (res.ok) {
          _cache = res.data
          notifyListeners(res.data)
        }
      })
      .catch(() => {/* swallow — layout will retry on next mount */})
      .finally(() => {
        _fetching = false
        setIsLoading(false)
      })
  }, [])

  const update = useCallback(async (fields: Partial<UserProfile>): Promise<boolean> => {
    const res = await api.patch<UserProfile>('/v1/user/profile', fields)
    if (res.ok) {
      _cache = res.data
      notifyListeners(res.data)
    }
    return res.ok
  }, [])

  const refresh = useCallback(async () => {
    _cache = null
    setIsLoading(true)
    const res = await api.get<UserProfile>('/v1/user/profile')
    if (res.ok) {
      _cache = res.data
      notifyListeners(res.data)
    }
    setIsLoading(false)
  }, [])

  return { profile, isLoading, update, refresh }
}
```

- [ ] **Step 2: Wire clearProfileCache into auth.store.ts**

In `apps/mobile/src/stores/auth.store.ts`, add the import at the top of the file:
```ts
import { clearProfileCache } from '../hooks/useProfile'
```

Then find the `signOut` action (search for `signOut`) and add a call to `clearProfileCache()`:
```ts
signOut: async () => {
  clearProfileCache()          // ← add this line at the top
  await supabase.auth.signOut()
  set({ session: null, user: null, isInitialized: true })
},
```

The exact implementation may vary — the key is that `clearProfileCache()` is called when the user signs out, before or after the supabase call.

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | grep -E "useProfile|auth.store"
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/hooks/useProfile.ts apps/mobile/src/stores/auth.store.ts
git commit -m "feat: add useProfile hook with module-level cache

Used by _layout.tsx to gate onboarding. clearProfileCache() is
called on sign-out to ensure next session fetches fresh data.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8 — Mobile: useLearnerProfile hook

**Files:**
- Create: `apps/mobile/src/hooks/useLearnerProfile.ts`

Follows the same module-level cache pattern as `useProfile`. Used by both `onboarding.tsx` (write-only) and `profile.tsx` (read + write).

- [ ] **Step 1: Create the hook**

Create `apps/mobile/src/hooks/useLearnerProfile.ts`:

```ts
// apps/mobile/src/hooks/useLearnerProfile.ts
//
// Fetches and caches the current user's learner profile.
// Used by onboarding.tsx (to write on completion) and
// profile.tsx (to read + edit).

import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'

export type LearnerProfile = {
  country: string | null
  reasonsForLearning: string[]
  interests: string[]
}

let _cache: LearnerProfile | null = null
let _fetching = false
const _listeners = new Set<(p: LearnerProfile | null) => void>()

function notify(profile: LearnerProfile | null) {
  _listeners.forEach((fn) => fn(profile))
}

export function clearLearnerProfileCache() {
  _cache = null
  notify(null)
}

export function useLearnerProfile() {
  const [learnerProfile, setLearnerProfile] = useState<LearnerProfile | null>(_cache)
  const [isLoading, setIsLoading] = useState(_cache === null)

  useEffect(() => {
    _listeners.add(setLearnerProfile)
    return () => { _listeners.delete(setLearnerProfile) }
  }, [])

  useEffect(() => {
    if (_cache) {
      setLearnerProfile(_cache)
      setIsLoading(false)
      return
    }
    if (_fetching) return

    _fetching = true
    api
      .get<LearnerProfile>('/v1/user/learner-profile')
      .then((res) => {
        if (res.ok) {
          _cache = res.data
          notify(res.data)
        }
      })
      .catch(() => {})
      .finally(() => {
        _fetching = false
        setIsLoading(false)
      })
  }, [])

  const update = useCallback(async (fields: Partial<LearnerProfile>): Promise<boolean> => {
    const res = await api.patch<{ ok: true }>('/v1/user/learner-profile', fields)
    if (res.ok) {
      const next: LearnerProfile = {
        country: 'country' in fields ? (fields.country ?? null) : (_cache?.country ?? null),
        reasonsForLearning: fields.reasonsForLearning ?? _cache?.reasonsForLearning ?? [],
        interests: fields.interests ?? _cache?.interests ?? [],
      }
      _cache = next
      notify(next)
    }
    return res.ok
  }, [])

  return { learnerProfile, isLoading, update }
}
```

- [ ] **Step 2: Also wire clearLearnerProfileCache into auth.store.ts sign-out**

In `apps/mobile/src/stores/auth.store.ts`, add the import:
```ts
import { clearLearnerProfileCache } from '../hooks/useLearnerProfile'
```

Add the call in `signOut`:
```ts
signOut: async () => {
  clearProfileCache()
  clearLearnerProfileCache()   // ← add this line
  await supabase.auth.signOut()
  set({ session: null, user: null, isInitialized: true })
},
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | grep useLearnerProfile
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/hooks/useLearnerProfile.ts apps/mobile/src/stores/auth.store.ts
git commit -m "feat: add useLearnerProfile hook

Fetches, caches, and updates country / reasonsForLearning / interests.
Cache cleared on sign-out.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 9 — Mobile: onboarding.tsx wizard

**Files:**
- Create: `apps/mobile/app/onboarding.tsx`

This is the largest task. Read it all the way through before starting.

### Step overview
| # | Key | Back? | Content |
|---|-----|-------|---------|
| 0 | welcome | No | Hero kanji + headline + tagline |
| 1 | findHelp | No | 6-item scrollable info card list |
| 2 | aboutYou | Yes | Display name input + country picker |
| 3 | focus | Yes | Multi-select reason chips |
| 4 | dailyTarget | Yes | Daily goal chip selector |

- [ ] **Step 1: Create onboarding.tsx**

Create `apps/mobile/app/onboarding.tsx`:

```tsx
// apps/mobile/app/onboarding.tsx
//
// 5-step onboarding wizard. Runs once per user, gated by _layout.tsx.
// On completion: PATCHes profile (displayName, dailyGoal, onboardingCompletedAt)
// and learner-profile (country, reasonsForLearning, interests) in parallel,
// then navigates to /placement.

import { useState, useRef, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Modal,
  Animated,
  Dimensions,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { ONBOARDING_CONTENT, COUNTRIES } from '../src/config/onboarding-content'
import { useProfile } from '../src/hooks/useProfile'
import { useLearnerProfile } from '../src/hooks/useLearnerProfile'
import { colors, spacing, radius, typography } from '../src/theme'

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const TOTAL_STEPS = 5

// ─── Onboarding Screen ────────────────────────────────────────────────────────

export default function Onboarding() {
  const router = useRouter()
  const { update: updateProfile } = useProfile()
  const { update: updateLearnerProfile } = useLearnerProfile()

  // Wizard state
  const [currentStep, setCurrentStep] = useState(0)
  const slideAnim = useRef(new Animated.Value(0)).current

  // Step 2 — About you
  const [displayName, setDisplayName] = useState('')
  const [country, setCountry] = useState<string | null>(null)
  const [countryPickerVisible, setCountryPickerVisible] = useState(false)
  const [countrySearch, setCountrySearch] = useState('')

  // Step 3 — Focus
  const [selectedReasons, setSelectedReasons] = useState<string[]>([])

  // Step 4 — Daily target
  const [dailyGoal, setDailyGoal] = useState(
    ONBOARDING_CONTENT.dailyTarget.defaultOption
  )

  // Completion
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // ─── Navigation ─────────────────────────────────────────────────────────────

  const goToStep = useCallback(
    (nextStep: number) => {
      const direction = nextStep > currentStep ? 1 : -1
      Animated.timing(slideAnim, {
        toValue: -direction * SCREEN_WIDTH,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        setCurrentStep(nextStep)
        slideAnim.setValue(direction * SCREEN_WIDTH)
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }).start()
      })
    },
    [currentStep, slideAnim]
  )

  const handleNext = useCallback(() => {
    if (currentStep < TOTAL_STEPS - 1) goToStep(currentStep + 1)
  }, [currentStep, goToStep])

  const handleBack = useCallback(() => {
    if (currentStep > 2) goToStep(currentStep - 1) // back not allowed on steps 0-1
  }, [currentStep, goToStep])

  // ─── Completion ─────────────────────────────────────────────────────────────

  const handleComplete = useCallback(async () => {
    setIsSaving(true)
    setSaveError(null)
    try {
      const [profileOk, learnerOk] = await Promise.all([
        updateProfile({
          displayName: displayName.trim() || null,
          dailyGoal,
          onboardingCompletedAt: new Date().toISOString(),
        }),
        updateLearnerProfile({
          country,
          reasonsForLearning: selectedReasons,
          interests: [],
        }),
      ])
      if (!profileOk || !learnerOk) {
        setSaveError('Something went wrong. Please try again.')
        setIsSaving(false)
        return
      }
      router.replace('/placement')
    } catch {
      setSaveError('Something went wrong. Please try again.')
      setIsSaving(false)
    }
  }, [displayName, dailyGoal, country, selectedReasons, updateProfile, updateLearnerProfile, router])

  // ─── Country picker helpers ──────────────────────────────────────────────────

  const filteredCountries = countrySearch.trim()
    ? COUNTRIES.filter((c) =>
        c.name.toLowerCase().includes(countrySearch.toLowerCase())
      )
    : COUNTRIES

  const selectedCountryName = country
    ? COUNTRIES.find((c) => c.code === country)?.name ?? country
    : null

  // ─── Chip toggle ─────────────────────────────────────────────────────────────

  const toggleReason = useCallback((chip: string) => {
    setSelectedReasons((prev) =>
      prev.includes(chip) ? prev.filter((r) => r !== chip) : [...prev, chip]
    )
  }, [])

  // ─── Step renderers ──────────────────────────────────────────────────────────

  const renderStep = (step: number) => {
    switch (step) {
      case 0:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.heroKanji}>{ONBOARDING_CONTENT.welcome.kanjiHero}</Text>
            <Text style={styles.headline}>{ONBOARDING_CONTENT.welcome.headline}</Text>
            <Text style={styles.body}>{ONBOARDING_CONTENT.welcome.body}</Text>
            <Text style={styles.tagline}>{ONBOARDING_CONTENT.welcome.tagline}</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleNext} activeOpacity={0.8}>
              <Text style={styles.primaryBtnText}>
                {ONBOARDING_CONTENT.welcome.cta} →
              </Text>
            </TouchableOpacity>
          </View>
        )

      case 1:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.headline}>{ONBOARDING_CONTENT.findHelp.headline}</Text>
            <ScrollView
              style={styles.infoScroll}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.infoScrollContent}
            >
              {ONBOARDING_CONTENT.findHelp.items.map((item) => (
                <View key={item.location} style={styles.infoCard}>
                  <View style={styles.infoCardLeft}>
                    <Ionicons
                      name="information-circle-outline"
                      size={20}
                      color={colors.info ?? colors.primary}
                    />
                  </View>
                  <View style={styles.infoCardRight}>
                    <Text style={styles.infoCardTitle}>{item.location}</Text>
                    <Text style={styles.infoCardBody}>{item.description}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
            <Text style={styles.footerNote}>{ONBOARDING_CONTENT.findHelp.footer}</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleNext} activeOpacity={0.8}>
              <Text style={styles.primaryBtnText}>
                {ONBOARDING_CONTENT.findHelp.cta} →
              </Text>
            </TouchableOpacity>
          </View>
        )

      case 2:
        return (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.stepContainer}
          >
            <Text style={styles.headline}>{ONBOARDING_CONTENT.aboutYou.headline}</Text>
            <TextInput
              style={styles.textInput}
              placeholder={ONBOARDING_CONTENT.aboutYou.namePlaceholder}
              placeholderTextColor={colors.textMuted}
              value={displayName}
              onChangeText={setDisplayName}
              autoCapitalize="words"
              returnKeyType="done"
            />
            <TouchableOpacity
              style={styles.countryField}
              onPress={() => setCountryPickerVisible(true)}
              activeOpacity={0.7}
            >
              <Text
                style={selectedCountryName ? styles.countrySelected : styles.countryPlaceholder}
              >
                {selectedCountryName ?? ONBOARDING_CONTENT.aboutYou.countryPlaceholder}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleNext} activeOpacity={0.8}>
              <Text style={styles.primaryBtnText}>
                {ONBOARDING_CONTENT.aboutYou.cta} →
              </Text>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        )

      case 3:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.headline}>{ONBOARDING_CONTENT.focus.headline}</Text>
            <Text style={styles.subhead}>{ONBOARDING_CONTENT.focus.subhead}</Text>
            <View style={styles.chipsWrap}>
              {ONBOARDING_CONTENT.focus.chips.map((chip) => {
                const selected = selectedReasons.includes(chip)
                return (
                  <TouchableOpacity
                    key={chip}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => toggleReason(chip)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {chip}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleNext} activeOpacity={0.8}>
              <Text style={styles.primaryBtnText}>
                {ONBOARDING_CONTENT.focus.cta} →
              </Text>
            </TouchableOpacity>
          </View>
        )

      case 4:
        return (
          <View style={styles.stepContainer}>
            <Text style={styles.headline}>{ONBOARDING_CONTENT.dailyTarget.headline}</Text>
            <View style={styles.chipsWrap}>
              {ONBOARDING_CONTENT.dailyTarget.options.map((n) => {
                const selected = dailyGoal === n
                return (
                  <TouchableOpacity
                    key={n}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => setDailyGoal(n)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {n}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
            {saveError && <Text style={styles.errorText}>{saveError}</Text>}
            <TouchableOpacity
              style={[styles.primaryBtn, isSaving && styles.primaryBtnDisabled]}
              onPress={handleComplete}
              disabled={isSaving}
              activeOpacity={0.8}
            >
              {isSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {ONBOARDING_CONTENT.dailyTarget.cta} →
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )

      default:
        return null
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Progress dots */}
      <View style={styles.progressRow}>
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === currentStep && styles.dotActive]}
          />
        ))}
      </View>

      {/* Back button (steps 2–4 only) */}
      {currentStep >= 2 && (
        <TouchableOpacity style={styles.backBtn} onPress={handleBack} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      )}

      {/* Animated step content */}
      <Animated.View
        style={[styles.animatedWrapper, { transform: [{ translateX: slideAnim }] }]}
      >
        {renderStep(currentStep)}
      </Animated.View>

      {/* Country picker modal */}
      <Modal
        visible={countryPickerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCountryPickerVisible(false)}
      >
        <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Country</Text>
            <TouchableOpacity onPress={() => setCountryPickerVisible(false)}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.modalSearch}
            placeholder="Search…"
            placeholderTextColor={colors.textMuted}
            value={countrySearch}
            onChangeText={setCountrySearch}
            autoFocus
          />
          <FlatList
            data={filteredCountries}
            keyExtractor={(item) => item.code}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.countryRow}
                onPress={() => {
                  setCountry(item.code)
                  setCountryPickerVisible(false)
                  setCountrySearch('')
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.countryRowText}>{item.name}</Text>
                {country === item.code && (
                  <Ionicons name="checkmark" size={18} color={colors.primary} />
                )}
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            keyboardShouldPersistTaps="handled"
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border ?? '#2A2A3E',
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 20,
  },
  backBtn: {
    position: 'absolute',
    top: spacing.lg + 40,
    left: spacing.md,
    zIndex: 10,
    padding: spacing.sm,
  },
  animatedWrapper: {
    flex: 1,
  },
  // ─── Step container ──────────────────────────────────────────────────────────
  stepContainer: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    justifyContent: 'center',
  },
  heroKanji: {
    fontSize: 80,
    textAlign: 'center',
    marginBottom: spacing.lg,
    color: colors.text,
  },
  headline: {
    ...typography.heading,
    textAlign: 'center',
    marginBottom: spacing.md,
    color: colors.text,
  },
  body: {
    ...typography.body,
    textAlign: 'center',
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 22,
  },
  tagline: {
    ...typography.caption,
    textAlign: 'center',
    color: colors.primary,
    fontWeight: '600',
    marginBottom: spacing.xl,
  },
  subhead: {
    ...typography.caption,
    textAlign: 'center',
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  // ─── Info cards (step 1) ─────────────────────────────────────────────────────
  infoScroll: {
    flex: 1,
    marginBottom: spacing.sm,
  },
  infoScrollContent: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: colors.bgElevated ?? colors.bg,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border ?? '#2A2A3E',
  },
  infoCardLeft: {
    paddingTop: 2,
  },
  infoCardRight: {
    flex: 1,
  },
  infoCardTitle: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  infoCardBody: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  footerNote: {
    ...typography.caption,
    textAlign: 'center',
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  // ─── About you (step 2) ──────────────────────────────────────────────────────
  textInput: {
    backgroundColor: colors.bgElevated ?? colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border ?? '#2A2A3E',
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.body,
    marginBottom: spacing.md,
  },
  countryField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgElevated ?? colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border ?? '#2A2A3E',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.xl,
  },
  countryPlaceholder: {
    ...typography.body,
    color: colors.textMuted,
  },
  countrySelected: {
    ...typography.body,
    color: colors.text,
  },
  // ─── Chips ───────────────────────────────────────────────────────────────────
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full ?? 999,
    borderWidth: 1,
    borderColor: colors.border ?? '#2A2A3E',
    backgroundColor: colors.bgElevated ?? colors.bg,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: '#0F0F1A',
  },
  // ─── Buttons ─────────────────────────────────────────────────────────────────
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: 'auto',
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    ...typography.body,
    fontWeight: '700',
    color: '#0F0F1A',
  },
  errorText: {
    ...typography.caption,
    color: colors.error ?? '#EF4444',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  // ─── Country modal ────────────────────────────────────────────────────────────
  modalSafe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border ?? '#2A2A3E',
  },
  modalTitle: {
    ...typography.heading,
    color: colors.text,
  },
  modalSearch: {
    backgroundColor: colors.bgElevated ?? colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border ?? '#2A2A3E',
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    margin: spacing.md,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  countryRowText: {
    ...typography.body,
    color: colors.text,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border ?? '#2A2A3E',
    marginHorizontal: spacing.lg,
  },
})
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | grep onboarding
```
Expected: no errors. Fix any type issues (most commonly `colors.info`, `colors.error`, `colors.bgElevated`, `colors.border`, `radius.full` — check `apps/mobile/src/theme/index.ts` and use fallbacks `?? value` for any that don't exist).

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/onboarding.tsx
git commit -m "feat: add 5-step onboarding wizard screen

Steps: welcome, find-help, about-you, focus, daily-target.
Horizontal slide animation, country picker modal, chip selectors.
On completion: parallel PATCH to profile + learner-profile, then
navigate to /placement.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 10 — Mobile: nav gate in _layout.tsx

**Files:**
- Modify: `apps/mobile/app/_layout.tsx`

- [ ] **Step 1: Add imports**

In `apps/mobile/app/_layout.tsx`, add to the existing imports (after line 14):

```ts
import { useProfile } from '../src/hooks/useProfile'
```

- [ ] **Step 2: Add profile hook in the component**

In `RootLayout()`, add below the existing `const { isInitialized, session, initialize } = useAuthStore()` line:

```ts
const { profile, isLoading: profileLoading } = useProfile()
```

- [ ] **Step 3: Replace the routing useEffect**

Replace the existing useEffect at lines 105–114 with this expanded version:

```ts
useEffect(() => {
  if (!isInitialized) return

  const inAuthGroup = segments[0] === '(auth)'

  // Not logged in → send to sign-in
  if (!session && !inAuthGroup) {
    router.replace('/(auth)/sign-in')
    return
  }

  // Logged in, in auth group, profile loaded → decide where to go
  if (session && inAuthGroup) {
    if (profileLoading) return // wait for profile before routing
    if (profile && !profile.onboardingCompletedAt) {
      router.replace('/onboarding')
    } else {
      router.replace('/(tabs)')
    }
    return
  }

  // Logged in, NOT in auth group — check onboarding gate
  if (session && !inAuthGroup) {
    if (profileLoading) return // still fetching — don't reroute yet
    if (profile && !profile.onboardingCompletedAt) {
      // Profile loaded and onboarding not done — send to wizard
      const inOnboarding = segments[0] === 'onboarding'
      if (!inOnboarding) router.replace('/onboarding')
    }
  }
}, [isInitialized, session, segments, profile, profileLoading])
```

- [ ] **Step 4: Register the onboarding screen in the Stack**

In the `<Stack>` JSX (around line 121), add:

```tsx
<Stack.Screen name="onboarding" options={{ headerShown: false }} />
```

The full Stack block should look like:
```tsx
<Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
  <Stack.Screen name="(auth)" />
  <Stack.Screen name="(tabs)" />
  <Stack.Screen name="kanji/[id]" />
  <Stack.Screen name="browse" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
  <Stack.Screen name="about" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
  <Stack.Screen name="placement" options={{ headerShown: false }} />
  <Stack.Screen name="onboarding" options={{ headerShown: false }} />
</Stack>
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | grep _layout
```
Expected: no errors.

- [ ] **Step 6: Manual test**

1. Sign up a new account (no `onboardingCompletedAt`).
2. Confirm app routes to `/onboarding` instead of `/(tabs)`.
3. Complete the wizard → confirm app routes to `/placement`.
4. Re-open app → confirm wizard is not shown again.
5. Sign out → confirm cache is cleared → sign in as a different account with onboarding complete → confirm no wizard.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/app/_layout.tsx
git commit -m "feat: add onboarding gate to root layout

New users with no onboardingCompletedAt are redirected to /onboarding.
Gate uses the new useProfile hook; existing users are unaffected (DB
migration backfilled their onboarding_completed_at).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 11 — Mobile: InfoButton + InfoPanel in journal, writing, voice

**Files:**
- Modify: `apps/mobile/app/(tabs)/journal.tsx`
- Modify: `apps/mobile/app/(tabs)/writing.tsx`
- Modify: `apps/mobile/app/(tabs)/voice.tsx`

The InfoButton/InfoPanel components are currently defined inline in `index.tsx` only. We'll define them inline in each of these three files using the exact same pattern. (A future refactor could extract them to a shared component file, but that's out of scope.)

### Part A — journal.tsx

- [ ] **Step 1: Add useState for activeInfo**

In `journal.tsx`, add to the existing state declarations (top of the component):

```ts
const [activeInfo, setActiveInfo] = useState<string | null>(null)
```

- [ ] **Step 2: Add INFO constant and toggle callback**

Below the state declarations, add:

```ts
const INFO_JOURNAL = [
  {
    title: 'AI-generated mnemonics',
    body: 'Each mnemonic is generated by an AI model based on the kanji\'s meaning and readings. They\'re starting points — edit or replace them with your own.',
  },
  {
    title: 'When to refresh',
    body: 'A mnemonic is marked for refresh after 30 days. Tap the "due" badge to see cards ready for a new take. Refreshing is optional — keep a mnemonic forever if it works for you.',
  },
]

const toggleInfo = useCallback((id: string) => {
  setActiveInfo((prev) => (prev === id ? null : id))
}, [])
```

- [ ] **Step 3: Add InfoButton and InfoPanel component definitions**

At the bottom of `journal.tsx` (before or after the StyleSheet), add:

```ts
// ─── Info components ──────────────────────────────────────────────────────────

const INFO_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 }

function InfoButton({
  id,
  activeInfo,
  onToggle,
}: {
  id: string
  activeInfo: string | null
  onToggle: (id: string) => void
}) {
  const isOpen = activeInfo === id
  return (
    <TouchableOpacity onPress={() => onToggle(id)} hitSlop={INFO_HIT_SLOP} activeOpacity={0.7}>
      <Ionicons
        name={isOpen ? 'chevron-up-circle-outline' : 'information-circle-outline'}
        size={18}
        color={isOpen ? colors.info : colors.textMuted}
      />
    </TouchableOpacity>
  )
}

function InfoPanel({ sections }: { sections: { title?: string; body: string }[] }) {
  return (
    <View style={infoStyles.panel}>
      {sections.map((s, i) => (
        <View key={i} style={[infoStyles.section, i > 0 && infoStyles.sectionSpaced]}>
          {s.title !== undefined && <Text style={infoStyles.sectionTitle}>{s.title}</Text>}
          <Text style={infoStyles.sectionBody}>{s.body}</Text>
        </View>
      ))}
    </View>
  )
}

const infoStyles = StyleSheet.create({
  panel: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: (colors.info ?? colors.primary) + '44',
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  section: {},
  sectionSpaced: { marginTop: spacing.sm },
  sectionTitle: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  sectionBody: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
})
```

**Note:** If `colors.info` is not defined in the theme, use `colors.primary` as fallback. Check `apps/mobile/src/theme/index.ts` first.

- [ ] **Step 4: Inject the InfoButton into the header**

In the header JSX (around line 84–91), update it to include the InfoButton:

Old:
```tsx
<View style={styles.header}>
  <Text style={styles.title}>Mnemonic Journal</Text>
  {due.length > 0 && (
    <View style={styles.refreshBadge}>
      <Text style={styles.refreshBadgeText}>{due.length} due</Text>
    </View>
  )}
</View>
```

New:
```tsx
<View style={styles.header}>
  <Text style={styles.title}>Mnemonic Journal</Text>
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
    {due.length > 0 && (
      <View style={styles.refreshBadge}>
        <Text style={styles.refreshBadgeText}>{due.length} due</Text>
      </View>
    )}
    <InfoButton id="journal" activeInfo={activeInfo} onToggle={toggleInfo} />
  </View>
</View>
{activeInfo === 'journal' && <InfoPanel sections={INFO_JOURNAL} />}
```

- [ ] **Step 5: Add `useCallback` to imports if missing**

Check line 1 of `journal.tsx` — it should already import `useCallback`. If not:
```ts
import { useEffect, useState, useCallback } from 'react'
```

### Part B — writing.tsx

- [ ] **Step 6: Add state + constants to writing.tsx**

Find the component's state declarations in `writing.tsx` and add:
```ts
const [activeInfo, setActiveInfo] = useState<string | null>(null)

const INFO_WRITING = [
  {
    title: 'Stroke order scoring',
    body: 'Your writing is compared stroke-by-stroke against the correct stroke order for each kanji. The score reflects accuracy of stroke direction, sequence, and proportion.',
  },
  {
    title: 'Improving your score',
    body: 'Focus on the starting point and direction of each stroke. The order shown in the stroke animation is the standard taught in Japanese schools.',
  },
]

const toggleInfo = useCallback((id: string) => {
  setActiveInfo((prev) => (prev === id ? null : id))
}, [])
```

- [ ] **Step 7: Add InfoButton + InfoPanel + infoStyles to writing.tsx**

Add the same `InfoButton`, `InfoPanel`, and `infoStyles` definitions from Step 3 above to the bottom of `writing.tsx`.

- [ ] **Step 8: Find the writing screen header and inject InfoButton**

Search for the screen title in `writing.tsx` (likely a `<Text>` with "Stroke Practice" or similar). Add `InfoButton` and `InfoPanel` in the same pattern:

```tsx
<View style={styles.header}>
  <Text style={styles.title}>Stroke Practice</Text>
  <InfoButton id="writing" activeInfo={activeInfo} onToggle={toggleInfo} />
</View>
{activeInfo === 'writing' && <InfoPanel sections={INFO_WRITING} />}
```

Read lines 40–80 of `writing.tsx` first to find the exact header JSX location, then make the edit.

### Part C — voice.tsx

- [ ] **Step 9: Add state + constants to voice.tsx**

Add to the component's state declarations:
```ts
const [activeInfo, setActiveInfo] = useState<string | null>(null)

const INFO_VOICE = [
  {
    title: 'Difficulty levels',
    body: 'Easy: individual kanji readings. Medium: short compounds. Hard: full sentences with multiple kanji. Higher difficulties award more XP.',
  },
  {
    title: 'How evaluation works',
    body: 'Your spoken reading is transcribed and compared to the expected reading. Partial credit is given for readings that are close — accents and minor pitch differences are not penalised.',
  },
]

const toggleInfo = useCallback((id: string) => {
  setActiveInfo((prev) => (prev === id ? null : id))
}, [])
```

- [ ] **Step 10: Add InfoButton + InfoPanel + infoStyles to voice.tsx**

Add the same component definitions from Step 3.

- [ ] **Step 11: Find the voice screen header and inject InfoButton**

Search for the screen title in `voice.tsx` and add:
```tsx
<View style={styles.header}>
  <Text style={styles.title}>Reading Practice</Text>
  <InfoButton id="voice" activeInfo={activeInfo} onToggle={toggleInfo} />
</View>
{activeInfo === 'voice' && <InfoPanel sections={INFO_VOICE} />}
```

Read lines 40–80 of `voice.tsx` first to confirm the exact header JSX location.

- [ ] **Step 12: Commit all three**

```bash
git add apps/mobile/app/(tabs)/journal.tsx apps/mobile/app/(tabs)/writing.tsx apps/mobile/app/(tabs)/voice.tsx
git commit -m "feat: add InfoButton + InfoPanel to journal, writing, and voice tabs

Onboarding slide 1 tells users each of these tabs has an ⓘ button;
this commit makes that true.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 12 — Mobile: Learning Profile section in profile.tsx

**Files:**
- Modify: `apps/mobile/app/(tabs)/profile.tsx`

This adds a "Learning Profile" section between the existing "App" section (line 446) and "Study Mates" section (line 448) in `profile.tsx`. It uses the `useLearnerProfile` hook for data, with dirty-state tracking and an explicit Save button.

- [ ] **Step 1: Add import for useLearnerProfile**

In `profile.tsx`, add to imports (after line 14):
```ts
import { useLearnerProfile } from '../../src/hooks/useLearnerProfile'
import { COUNTRIES } from '../../src/config/onboarding-content'
```

- [ ] **Step 2: Add learner profile state**

In the `ProfileScreen` component, after the existing state declarations, add:

```ts
// ─── Learning profile ─────────────────────────────────────────────────────────
const { learnerProfile, update: updateLearnerProfile } = useLearnerProfile()

const [lpCountry, setLpCountry] = useState<string | null>(null)
const [lpReasons, setLpReasons] = useState<string[]>([])
const [lpInterests, setLpInterests] = useState<string[]>([])
const [lpDirty, setLpDirty] = useState(false)
const [lpSaving, setLpSaving] = useState(false)
const [lpError, setLpError] = useState<string | null>(null)
const [countryPickerVisible, setCountryPickerVisible] = useState(false)
const [countrySearch, setCountrySearch] = useState('')

const INTEREST_OPTIONS = [
  'Manga', 'Anime', 'Gaming', 'Literature', 'Film',
  'Travel', 'Business', 'History', 'Technology', 'Other',
]

const REASON_OPTIONS = [
  'Travel', 'JLPT exam', 'Work / Business', 'Anime / Manga', 'Heritage', 'Curiosity', 'Other',
]
```

- [ ] **Step 3: Sync learner profile into local state when loaded**

Add a useEffect after the others to initialize local LP state when the hook loads:

```ts
useEffect(() => {
  if (!learnerProfile) return
  setLpCountry(learnerProfile.country)
  setLpReasons(learnerProfile.reasonsForLearning)
  setLpInterests(learnerProfile.interests)
}, [learnerProfile])
```

- [ ] **Step 4: Add dirty-tracking helpers**

Add these callbacks (near other `useCallback` declarations):

```ts
const toggleReason = useCallback((chip: string) => {
  setLpReasons((prev) => {
    const next = prev.includes(chip) ? prev.filter((r) => r !== chip) : [...prev, chip]
    setLpDirty(true)
    return next
  })
}, [])

const toggleInterest = useCallback((chip: string) => {
  setLpInterests((prev) => {
    const next = prev.includes(chip) ? prev.filter((r) => r !== chip) : [...prev, chip]
    setLpDirty(true)
    return next
  })
}, [])

const handleLpSave = useCallback(async () => {
  setLpSaving(true)
  setLpError(null)
  const ok = await updateLearnerProfile({
    country: lpCountry,
    reasonsForLearning: lpReasons,
    interests: lpInterests,
  })
  if (ok) {
    setLpDirty(false)
  } else {
    setLpError('Failed to save. Please try again.')
  }
  setLpSaving(false)
}, [lpCountry, lpReasons, lpInterests, updateLearnerProfile])
```

- [ ] **Step 5: Add the Learning Profile section JSX**

Find the closing `</Section>` tag of the "App" section (around line 446) and insert the new section immediately after it (before `{/* Study Mates */}`):

```tsx
{/* Learning Profile */}
<Section title="Learning Profile">
  {/* Country */}
  <TouchableOpacity
    style={styles.row}
    onPress={() => setCountryPickerVisible(true)}
    activeOpacity={0.7}
  >
    <View style={styles.rowLeft}>
      <Ionicons name="globe-outline" size={20} color={colors.textSecondary} />
      <View>
        <Text style={styles.rowLabel}>Country</Text>
        <Text style={styles.rowSub}>
          {lpCountry
            ? COUNTRIES.find((c) => c.code === lpCountry)?.name ?? lpCountry
            : 'Not set'}
        </Text>
      </View>
    </View>
    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
  </TouchableOpacity>

  {/* Focus / reasons */}
  <View style={[styles.row, { flexDirection: 'column', alignItems: 'flex-start', gap: 10 }]}>
    <Text style={styles.rowLabel}>What I'm focused on right now</Text>
    <View style={lpStyles.chipsWrap}>
      {REASON_OPTIONS.map((chip) => {
        const selected = lpReasons.includes(chip)
        return (
          <TouchableOpacity
            key={chip}
            style={[lpStyles.chip, selected && lpStyles.chipSelected]}
            onPress={() => toggleReason(chip)}
            activeOpacity={0.7}
          >
            <Text style={[lpStyles.chipText, selected && lpStyles.chipTextSelected]}>
              {chip}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  </View>

  {/* Interests */}
  <View style={[styles.row, { flexDirection: 'column', alignItems: 'flex-start', gap: 10 }]}>
    <Text style={styles.rowLabel}>My interests</Text>
    <View style={lpStyles.chipsWrap}>
      {INTEREST_OPTIONS.map((chip) => {
        const selected = lpInterests.includes(chip)
        return (
          <TouchableOpacity
            key={chip}
            style={[lpStyles.chip, selected && lpStyles.chipSelected]}
            onPress={() => toggleInterest(chip)}
            activeOpacity={0.7}
          >
            <Text style={[lpStyles.chipText, selected && lpStyles.chipTextSelected]}>
              {chip}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  </View>

  {/* Save button — only shown when dirty */}
  {lpDirty && (
    <View style={lpStyles.saveRow}>
      {lpError && <Text style={lpStyles.errorText}>{lpError}</Text>}
      <TouchableOpacity
        style={[lpStyles.saveBtn, lpSaving && lpStyles.saveBtnDisabled]}
        onPress={handleLpSave}
        disabled={lpSaving}
        activeOpacity={0.8}
      >
        {lpSaving
          ? <ActivityIndicator size="small" color="#fff" />
          : <Text style={lpStyles.saveBtnText}>Save</Text>
        }
      </TouchableOpacity>
    </View>
  )}
</Section>
```

- [ ] **Step 6: Add the country picker modal**

Find where the other modals/overlays close in the JSX (just before `</SafeAreaView>` or `</ScrollView>`) and add:

```tsx
{/* Country picker for Learning Profile */}
<Modal
  visible={countryPickerVisible}
  animationType="slide"
  presentationStyle="pageSheet"
  onRequestClose={() => setCountryPickerVisible(false)}
>
  <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
    <View style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.border ?? '#2A2A3E' }]}>
      <Text style={[styles.rowLabel, { flex: 1, fontSize: 17 }]}>Select Country</Text>
      <TouchableOpacity onPress={() => setCountryPickerVisible(false)}>
        <Ionicons name="close" size={24} color={colors.text} />
      </TouchableOpacity>
    </View>
    <TextInput
      style={[styles.textInput, { margin: spacing.md }]}
      placeholder="Search…"
      placeholderTextColor={colors.textMuted}
      value={countrySearch}
      onChangeText={setCountrySearch}
      autoFocus
    />
    <FlatList
      data={
        countrySearch.trim()
          ? COUNTRIES.filter((c) =>
              c.name.toLowerCase().includes(countrySearch.toLowerCase())
            )
          : COUNTRIES
      }
      keyExtractor={(item) => item.code}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            setLpCountry(item.code)
            setLpDirty(true)
            setCountryPickerVisible(false)
            setCountrySearch('')
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.rowLabel}>{item.name}</Text>
          {lpCountry === item.code && (
            <Ionicons name="checkmark" size={18} color={colors.primary} />
          )}
        </TouchableOpacity>
      )}
      ItemSeparatorComponent={() => (
        <View style={{ height: 1, backgroundColor: colors.border ?? '#2A2A3E', marginHorizontal: spacing.lg }} />
      )}
      keyboardShouldPersistTaps="handled"
    />
  </SafeAreaView>
</Modal>
```

You'll need to add `FlatList` and `Modal` to the React Native imports if they're not there. Check line 2–5 of `profile.tsx`.

- [ ] **Step 7: Add LP styles**

At the bottom of `profile.tsx`, before `export default ProfileScreen` or after the main StyleSheet, add:

```ts
const lpStyles = StyleSheet.create({
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border ?? '#2A2A3E',
    backgroundColor: colors.bgElevated ?? colors.bg,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: '#0F0F1A',
  },
  saveRow: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    fontWeight: '700',
    color: '#0F0F1A',
    fontSize: 15,
  },
  errorText: {
    fontSize: 13,
    color: colors.error ?? '#EF4444',
    marginBottom: 6,
    textAlign: 'center',
  },
})
```

- [ ] **Step 8: Verify TypeScript**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | grep profile
```
Expected: no errors.

- [ ] **Step 9: Manual test**

1. Open the Profile tab.
2. Scroll to the new "Learning Profile" section.
3. Tap Country → confirm picker opens and filters.
4. Select a country → confirm it shows in the row.
5. Toggle chips → confirm Save button appears.
6. Tap Save → confirm button disappears (dirty = false).
7. Reload the app → confirm selections persist.

- [ ] **Step 10: Commit**

```bash
git add apps/mobile/app/(tabs)/profile.tsx
git commit -m "feat: add Learning Profile section to Profile tab

Country picker, focus chips, and interest chips — all editable
post-onboarding. Dirty tracking + Save button pattern.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review Checklist

Run this against the spec before calling the feature complete.

**Spec coverage:**

| Spec requirement | Task |
|-----------------|------|
| 5-step wizard, single file, currentStep state | Task 9 |
| Horizontal slide animation | Task 9 |
| Progress dots (5) at top | Task 9 |
| Step 0 — welcome hero, headline, tagline | Task 9 |
| Step 1 — 6 info cards (all 6 tabs including Journal/Write/Speak) | Task 9 |
| Step 2 — display name + country picker | Task 9 |
| Step 3 — multi-select focus chips | Task 9 |
| Step 4 — daily target chip selector, default 20 | Task 9 |
| Completion: parallel PATCH + navigate to /placement | Task 9 |
| API error on step 4: inline error, no navigation | Task 9 |
| All strings in OTA-updatable config file | Task 6 |
| Nav gate: session + no onboardingCompletedAt → /onboarding | Task 10 |
| Never show wizard again once onboardingCompletedAt set | Tasks 7 + 10 |
| Gate evaluates only after profile resolves (return null while loading) | Task 10 |
| PATCH /v1/user/profile accepts onboardingCompletedAt | Task 3 |
| GET /v1/user/learner-profile — null-safe defaults | Task 4 |
| PATCH /v1/user/learner-profile — upsert, partial | Task 4 |
| DB backfill: existing users get onboarding_completed_at | Task 2 |
| country column added to learner_profiles | Task 2 |
| ⓘ button added to Journal tab | Task 11 |
| ⓘ button added to Write tab | Task 11 |
| ⓘ button added to Speak tab | Task 11 |
| Learning Profile section in Profile tab | Task 12 |
| Country + focus + interests all editable post-onboarding | Task 12 |
| Save button with dirty tracking | Task 12 |
| TOTAL_JOUYOU_KANJI fixed: 2294 → 2136 | Task 1 |

**Type consistency check:**
- `UserProfile.onboardingCompletedAt` is `string | null` (ISO string from API) — matched in hook + layout gate + PATCH payload
- `LearnerProfile` fields match API response: `country: string | null`, `reasonsForLearning: string[]`, `interests: string[]`
- `updateLearnerProfile` in `useLearnerProfile` accepts `Partial<LearnerProfile>` — matches usage in `onboarding.tsx` and `profile.tsx`
- `clearProfileCache` exported from `useProfile.ts`, imported in `auth.store.ts`
- `clearLearnerProfileCache` exported from `useLearnerProfile.ts`, imported in `auth.store.ts`
