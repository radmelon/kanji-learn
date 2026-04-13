# Onboarding Tutorial + User Questionnaire — Design Spec
*Phase 2, Item 6 — 2026-04-13*

---

## Overview

New users currently land on the Dashboard immediately after sign-up with no guidance and no profile data collected. This spec defines a 5-step onboarding wizard that runs once for every new user — right after authentication, before the optional placement test. It teaches the app's core UI conventions, collects learner profile data, and gates the main tab interface until complete. The same profile data is also exposed in the Profile tab for ongoing editing, since interests and goals change over time.

---

## Goals

1. Orient new users to where built-in help lives (ⓘ buttons)
2. Collect: display name, country, current focus/goals, interests, daily card target
3. Store answers in `user_profiles` and `learnerProfiles` tables
4. Gate `/(tabs)` until onboarding is complete — frictionlessly (all fields have defaults)
5. Never show the wizard again once `onboardingCompletedAt` is set
6. Keep all onboarding copy in one OTA-updatable config file (no rebuild needed to update text)
7. Surface learner profile fields in the Profile tab for ongoing editing

---

## Non-Goals

- No tutorial slides explaining SRS mechanics — the grading info panel already exists in the study screen
- No back-navigation to earlier onboarding steps from the placement test or tabs
- No per-step skip buttons — the wizard is required, but all fields have defaults so it can be tapped through in ~30 seconds
- No localisation in this iteration

---

## Architecture

### New files

| File | Responsibility |
|------|---------------|
| `apps/mobile/app/onboarding.tsx` | 5-step wizard screen — single file, `currentStep` state, animated slide transitions |
| `apps/mobile/src/config/onboarding-content.ts` | All onboarding strings (headlines, body copy, chip labels, button text) — OTA-updatable |
| `apps/mobile/src/hooks/useLearnerProfile.ts` | New hook — fetch + update learner profile, cached alongside `useProfile` |
| `apps/api/src/routes/learner-profile.ts` | `GET` + `PATCH /v1/user/learner-profile` endpoints |

### Modified files

| File | Change |
|------|--------|
| `apps/mobile/app/_layout.tsx` | Add onboarding gate: session + no `onboardingCompletedAt` → `/onboarding` |
| `apps/mobile/app/(tabs)/profile.tsx` | New "Learning Profile" section (country, focus, interests) |
| `apps/mobile/app/(tabs)/journal.tsx` | Add top-level ⓘ `InfoButton` + `InfoPanel` (mnemonics / refresh explained) |
| `apps/mobile/app/(tabs)/writing.tsx` | Add top-level ⓘ `InfoButton` + `InfoPanel` (stroke-order scoring explained) |
| `apps/mobile/app/(tabs)/voice.tsx` | Add top-level ⓘ `InfoButton` + `InfoPanel` (difficulty levels explained) |
| `apps/api/src/routes/user.ts` | Expose `onboardingCompletedAt` in both `GET` and `PATCH /v1/user/profile` schemas — the layout gate reads it from the GET response |
| `apps/api/src/index.ts` (or router registration file) | Register new `learner-profile` routes |
| `packages/db/supabase/migrations/` | New migration: backfill `onboardingCompletedAt` for existing users |

---

## Database

### Backfill migration

```sql
-- Backfill existing users so they are not shown the onboarding wizard
UPDATE user_profiles
SET onboarding_completed_at = NOW()
WHERE onboarding_completed_at IS NULL;
```

### `learnerProfiles` table (already exists)

Relevant columns used by this feature:

| Column | Type | Notes |
|--------|------|-------|
| `userId` | uuid FK | Links to `user_profiles.id` |
| `country` | text, nullable | ISO 3166-1 alpha-2 code or full name — TBD at implementation |
| `reasonsForLearning` | jsonb (string[]) | Current focus chips |
| `interests` | jsonb (string[]) | Interest chips |
| `onboardingCompletedAt` | timestamp, nullable | Mirror of `user_profiles.onboarding_completed_at` — kept in sync on completion |

The `learnerProfiles` row is created on first `PATCH /v1/user/learner-profile` call (upsert). A user may not have a row until they complete onboarding or update their profile.

---

## API

### `PATCH /v1/user/profile` (existing — extended)

Add `onboardingCompletedAt` to the accepted body schema:

```ts
onboardingCompletedAt?: string  // ISO timestamp — set once on wizard completion
```

No other changes to this endpoint.

### `GET /v1/user/learner-profile` (new)

Returns the current user's `learnerProfiles` row. If no row exists, returns nulls for all fields.

```ts
// Response
{
  country: string | null
  reasonsForLearning: string[]
  interests: string[]
}
```

### `PATCH /v1/user/learner-profile` (new)

Partial update — upserts the row. Accepts any subset of fields. Fields not included in the request are left unchanged.

```ts
// Request body (all optional)
{
  country?: string | null
  reasonsForLearning?: string[]
  interests?: string[]
}

// Response: 200 { ok: true }
```

---

## Mobile: Onboarding Wizard (`app/onboarding.tsx`)

### Navigation gate (`app/_layout.tsx`)

Added to the existing redirect `useEffect`, evaluated after the auth check:

```ts
if (session && profile && !profile.onboardingCompletedAt) {
  router.replace('/onboarding')
  return
}
```

`profile` is already fetched by the existing `useProfile` hook in the layout — no additional fetch required.

### Wizard structure

Single screen managing a `currentStep: 0–4` state. Steps transition with a horizontal slide animation (`Animated` or `react-native-reanimated` — match whatever `placement.tsx` uses). A progress indicator (5 dots) sits at the top of the screen.

| Step | Key | Title (from content config) | Back allowed |
|------|-----|-----------------------------|-------------|
| 0 | `welcome` | Welcome slide | No |
| 1 | `findHelp` | "Help is here" slide | No |
| 2 | `aboutYou` | About you | Yes |
| 3 | `focus` | Right now | Yes |
| 4 | `dailyTarget` | Daily target | Yes |

### Step 0 — Welcome

- Large kanji character (漢) as hero
- Headline: **"Your personal kanji companion."**
- Body: from `onboarding-content.ts`
- Tagline: **"Smarter than flashcards. Friendlier than a textbook."**
- Button: "Get started →"

### Step 1 — Help is here

- Headline: "Help is always one tap away"
- Six info cards (scrollable), each showing an ⓘ icon + tab name + one-line description:
  - **Study** — "Tap ⓘ next to the grade buttons to see what Again / Good / Easy mean"
  - **Dashboard** — "Each stat card has an ⓘ explaining what the number means"
  - **Progress** — "Tap ⓘ on any chart or section for a full explanation"
  - **Journal** — "Tap ⓘ to learn how AI-generated mnemonics work and when to refresh them"
  - **Write** — "Tap ⓘ to understand how stroke-order scoring works"
  - **Speak** — "Tap ⓘ to see how reading evaluation difficulty levels work"
- Footer note: "You don't need to memorise any of this now."
- Button: "Got it →"

**Note:** Journal, Write, and Speak currently have no ⓘ info buttons. Adding a top-level ⓘ button (same `InfoButton` + `InfoPanel` pattern as Dashboard/Progress) to each of those three screens is in scope for this feature so the onboarding slide isn't misleading.

### Step 2 — About you

- Display name: text input, pre-filled from `user.user_metadata.display_name` if available
- Country: tappable field that opens a searchable modal picker
- Country field is optional — stores `null` if not selected; no forced default
- Button: "Next →"

### Step 3 — Right now

- Headline: "What are you focused on right now?"
- Subhead: "You can change this any time in your profile."
- Multi-select chips (labels from `onboarding-content.ts`):
  `Travel` · `JLPT exam` · `Work / Business` · `Anime / Manga` · `Heritage` · `Curiosity` · `Other`
- No minimum selection required — stores empty array if nothing selected
- Button: "Next →"

### Step 4 — Daily target

- Headline: "How many kanji per day?"
- Chip selector: `5` · `10` · `15` · `20` · `30` · `50` — default **20** pre-selected
- Button: "Let's go →"

### Completion sequence (step 4 "Let's go")

Two parallel API calls, then navigate:

```ts
await Promise.all([
  // 1. Save displayName, dailyGoal, mark onboarding complete
  patchProfile({ displayName, dailyGoal, onboardingCompletedAt: new Date().toISOString() }),
  // 2. Save learner profile
  patchLearnerProfile({ country, reasonsForLearning, interests }),
])
router.replace('/placement')
```

On API error: show inline error, keep user on step 4 (do not navigate). Retry on re-tap.

---

## Mobile: `onboarding-content.ts`

All visible strings live here. Structure:

```ts
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
      { location: 'Study', description: 'Tap ⓘ next to the grade buttons to see what Again / Good / Easy mean' },
      { location: 'Dashboard', description: 'Each stat card has an ⓘ explaining what the number means' },
      { location: 'Progress', description: 'Tap ⓘ on any chart or section for a full explanation' },
      { location: 'Journal', description: 'Tap ⓘ to learn how AI-generated mnemonics work and when to refresh them' },
      { location: 'Write', description: 'Tap ⓘ to understand how stroke-order scoring works' },
      { location: 'Speak', description: 'Tap ⓘ to see how reading evaluation difficulty levels work' },
    ],
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
    chips: ['Travel', 'JLPT exam', 'Work / Business', 'Anime / Manga', 'Heritage', 'Curiosity', 'Other'],
    cta: 'Next',
  },
  dailyTarget: {
    headline: 'How many kanji per day?',
    options: [5, 10, 15, 20, 30, 50],
    defaultOption: 20,
    cta: "Let's go",
  },
}
```

---

## Mobile: Profile Tab — Learning Profile Section

### Placement

Added between the existing **Study Settings** block and the **Study Mates** block in `profile.tsx`.

### Fields

| Field | UI Component | Options |
|-------|-------------|---------|
| Country | Tappable row → searchable modal picker | Same picker as onboarding |
| What I'm focused on right now | Multi-select chips | Same 7 options as onboarding step 3 |
| My interests | Multi-select chips | Manga · Anime · Gaming · Literature · Film · Travel · Business · History · Technology · Other |

### Behaviour

- Values loaded from `useLearnerProfile` hook on mount
- Chip selections and country changes update local state immediately (optimistic UI)
- A **"Save"** button appears when local state differs from saved state (dirty tracking)
- On save: `PATCH /v1/user/learner-profile` with changed fields only
- On success: update hook cache, hide Save button
- On error: show inline error toast, keep Save button visible

### `useLearnerProfile` hook

```ts
// apps/mobile/src/hooks/useLearnerProfile.ts
{
  learnerProfile: LearnerProfile | null
  isLoading: boolean
  update: (fields: Partial<LearnerProfile>) => Promise<void>
}
```

Fetches on mount, caches in module-level state (same pattern as `useProfile`). `update()` calls `PATCH /v1/user/learner-profile` and updates the cache optimistically.

---

## `TOTAL_JOUYOU_KANJI` fix

Fix the incorrect constant as part of this work (discovered during spec research):

```ts
// packages/shared/src/constants.ts
export const TOTAL_JOUYOU_KANJI = 2136  // was 2294 (incorrectly included Jinmeiyō)
```

No other changes required — all consumers import the constant.

---

## Error States

| Scenario | Behaviour |
|----------|-----------|
| Network error on onboarding completion | Inline error on step 4, retry on re-tap. Do not navigate. |
| `profile` not yet loaded in `_layout.tsx` | Return null (existing splash behaviour) — gate evaluates once profile resolves |
| `GET /v1/user/learner-profile` 404 (no row) | Hook returns empty defaults — not an error |
| `PATCH` failure in Profile tab | Toast error, keep Save button, local state unchanged |

---

## Out of Scope / Future

- `preferredMnemonicStyle`, `buddyPersonalityPref`, `studyEnvironments` columns exist in `learnerProfiles` but are not surfaced yet — reserved for Phase 6 AI Buddy personalisation
- Native language / proficiency level — not in current schema; add when AI Buddy needs it
- Onboarding re-entry / "redo setup" flow
