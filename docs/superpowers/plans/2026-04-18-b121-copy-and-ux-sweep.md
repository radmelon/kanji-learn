# B121 Copy & UX Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single B121 TestFlight build bundling 7 low-risk polish items surfaced by the B120 verification pass.

**Architecture:** All changes are client-side (mobile only, no API/DB changes). Five items are pure string edits; two introduce small logic (Dashboard `useFocusEffect` wiring and Take Quiz empty-state branching). Everything bundles into one PR to amortize the $2 EAS build cost and give the user one coherent manual verification pass.

**Tech Stack:** React Native + Expo (Expo Router), TypeScript, Jest (node env) for unit tests.

---

## Scope

**In scope:**
1. Accuracy → Confidence copy flip (SRS contexts only)
2. Dashboard auto-refresh on tab focus (`useFocusEffect` + small `useInterventions` refactor)
3. Take Quiz empty state rewrite + "Start studying" CTA
4. Onboarding findHelp footer: append motivational line
5. JLPT color legend under the stacked bar

**Out of scope (deferred to Build 2/3):** weighted 3/2/1/0 scoring, mnemonic gating, meaning/reading visual cue, invite banner, post-delete cascade, leaderboard metrics, nudge/poke. Each will have its own plan.

## Testing Strategy

The mobile app has minimal Jest coverage (`apps/mobile/test/unit/oauth.test.ts` only) and no React Native component-level testing infra (`@testing-library/react-native` is not installed). Setting that up for 7 polish items would balloon scope.

For this build:
- **Primary automated gate:** `pnpm --filter @kanji-learn/mobile typecheck` must pass with zero errors.
- **No new unit tests** — the one hook logic change (`useInterventions` refresh) is trivial and verified at runtime via TestFlight.
- **Final gate:** TestFlight B121 manual verification checklist (section at the end of this plan).

Build 2 (study-screen overhaul, weighted scoring) is a better forcing function for introducing `@testing-library/react-native`. We will revisit then.

---

## File Structure

| File | Purpose | Touched by |
|---|---|---|
| `apps/mobile/src/components/study/SessionComplete.tsx` | Session Complete screen label | Task 1 |
| `apps/mobile/app/(tabs)/index.tsx` | Dashboard — Drill Weak Spots copy + useFocusEffect | Tasks 1, 3 |
| `apps/mobile/app/(tabs)/progress.tsx` | Progress tab info panel copy | Task 1 |
| `apps/mobile/src/hooks/useInterventions.ts` | Expose a `refresh()` function | Task 2 |
| `apps/mobile/app/test.tsx` | Quiz screen empty-state branching + CTA | Task 4 |
| `apps/mobile/src/config/onboarding-content.ts` | Onboarding findHelp footer | Task 5 |
| `apps/mobile/src/components/ui/JlptProgressGrid.tsx` | Add legend under the stacked bar | Task 6 |

---

## Task 1: Accuracy → Confidence copy flip (SRS contexts only)

Flip every user-facing "accuracy" string that refers to SRS self-grading. Writing and voice practice strings (objective scores) stay untouched.

**Files:**
- Modify: `apps/mobile/src/components/study/SessionComplete.tsx:59`
- Modify: `apps/mobile/app/(tabs)/index.tsx:214`
- Modify: `apps/mobile/app/(tabs)/progress.tsx` (lines 177 and 180)

- [ ] **Step 1: Flip SessionComplete label**

File: `apps/mobile/src/components/study/SessionComplete.tsx`, line 59.

Change:
```tsx
<Text style={styles.accuracyLabel}>accuracy</Text>
```
to:
```tsx
<Text style={styles.accuracyLabel}>confidence</Text>
```

Leave the CSS class name `accuracyLabel` as-is — it's internal and renaming it would bloat the diff. Same for the `accuracy` / `accColor` variables in that file (lines 36, 38, 46, 51, 58, 81). They're local-scope computed values; no user sees them.

- [ ] **Step 2: Flip Drill Weak Spots dialog copy**

File: `apps/mobile/app/(tabs)/index.tsx`, line 214.

Change:
```tsx
'Great news — your accuracy is above 65% on all recently reviewed kanji. Keep it up!',
```
to:
```tsx
'Great news — your confidence is above 65% on all recently reviewed kanji. Keep it up!',
```

- [ ] **Step 3: Flip Progress tab session-history info panel copy**

File: `apps/mobile/app/(tabs)/progress.tsx`.

At line 177 — change body:
```tsx
    body: 'A log of your last 30 completed SRS review sessions. Each row shows when the session occurred, how many cards you reviewed, how long it took, and your accuracy for that session.',
```
to:
```tsx
    body: 'A log of your last 30 completed SRS review sessions. Each row shows when the session occurred, how many cards you reviewed, how long it took, and your confidence for that session.',
```

At line 180 — change title:
```tsx
    title: 'Accuracy colour coding',
```
to:
```tsx
    title: 'Confidence colour coding',
```

**Do NOT touch these "accuracy" strings in `progress.tsx`** (they describe objective writing/voice scores and are correct as-is):
- Line 145 (`INFO_WRITING` body: "stroke-by-stroke accuracy when drawing kanji")
- Line 148 (`INFO_WRITING` title: "Avg accuracy")
- Line 149 (`INFO_WRITING` body: "average stroke accuracy score")
- Line 412 (`VelocityItem label="Avg accuracy"` under the Writing section)
- Line 490 (`VelocityItem label="Accuracy"` under the Voice section)

Also do NOT touch the `accuracyRow` / `accuracyCircle` / `accuracyPct` style keys, the `AccuracyRow` helper component name (line 698), or the `accuracyPct` field on session history rows — none of these surface to the user as text. Renaming them would bloat the diff without user-visible change and can be picked up in a later refactor if ever needed.

- [ ] **Step 4: Typecheck**

Run:
```bash
pnpm --filter @kanji-learn/mobile typecheck
```
Expected: `Tasks: successful` with zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/study/SessionComplete.tsx apps/mobile/app/\(tabs\)/index.tsx apps/mobile/app/\(tabs\)/progress.tsx
git commit -m "fix(mobile): flip accuracy→confidence in SRS-context copy"
```

---

## Task 2: Add refresh function to useInterventions

Task 3 will call every Dashboard data hook's refresh function in a `useFocusEffect`. `useInterventions` currently fires its fetch inline in a `useEffect` and exposes only `{ interventions, dismiss }`. Refactor so the hook returns a stable `refresh` callback.

**Files:**
- Modify: `apps/mobile/src/hooks/useInterventions.ts`

- [ ] **Step 1: Refactor the hook to expose refresh**

Replace the full contents of `apps/mobile/src/hooks/useInterventions.ts` with:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'

export interface Intervention {
  id: string
  type: 'absence' | 'velocity_drop' | 'plateau'
  triggeredAt: string
  message: string
  payload: Record<string, unknown>
}

export function useInterventions() {
  const [interventions, setInterventions] = useState<Intervention[]>([])

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<Intervention[]>('/v1/interventions')
      setInterventions(data)
    } catch {
      // Silently fail — banner is a non-critical UX hint.
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const dismiss = useCallback(async (id: string) => {
    await api.post(`/v1/interventions/${id}/resolve`)
    setInterventions((prev) => prev.filter((i) => i.id !== id))
  }, [])

  return { interventions, dismiss, refresh }
}
```

**Key points:**
- `refresh` is wrapped in `useCallback` with empty deps so its reference is stable across renders — required so Task 3's `useFocusEffect` deps don't churn.
- `dismiss` is now wrapped in `useCallback` for the same reason (Dashboard may pass it to children).
- Behavior is unchanged: the hook still fetches on mount, still silently swallows errors.

- [ ] **Step 2: Typecheck**

Run:
```bash
pnpm --filter @kanji-learn/mobile typecheck
```
Expected: Zero TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/hooks/useInterventions.ts
git commit -m "refactor(mobile): expose refresh from useInterventions hook"
```

---

## Task 3: Dashboard auto-refresh via useFocusEffect

Add a `useFocusEffect` to the Dashboard tab so returning from a study session (or any other screen) triggers a refresh of all data hooks. Cached data keeps rendering during the refetch — no loading flash.

**Files:**
- Modify: `apps/mobile/app/(tabs)/index.tsx`

- [ ] **Step 1: Import useFocusEffect from expo-router**

At the top of `apps/mobile/app/(tabs)/index.tsx`, update the `expo-router` import (currently just `useRouter`) to also bring in `useFocusEffect`:

Change:
```tsx
import { useRouter } from 'expo-router'
```
to:
```tsx
import { useRouter, useFocusEffect } from 'expo-router'
```

- [ ] **Step 2: Destructure refresh functions from all data hooks**

In the `Dashboard` component (around lines 180–185), change the hook destructuring from:

```tsx
  const { profile } = useProfile()
  const { summary, isLoading, isStale, refresh } = useAnalytics()
  const { data: quizData } = useQuizAnalytics()
  const { interventions, dismiss } = useInterventions()
  const { leaderboard } = useSocial()
```
to:
```tsx
  const { profile, refresh: refreshProfile } = useProfile()
  const { summary, isLoading, isStale, refresh } = useAnalytics()
  const { data: quizData, refresh: refreshQuiz } = useQuizAnalytics()
  const { interventions, dismiss, refresh: refreshInterventions } = useInterventions()
  const { leaderboard, loadAll: refreshSocial } = useSocial()
```

Notes:
- `useSocial` exposes `loadAll` (not `refresh`); we alias it to `refreshSocial` for consistency.
- `useProfile`, `useAnalytics`, `useQuizAnalytics` all already expose `refresh`.

- [ ] **Step 3: Wire up useFocusEffect**

Immediately after the hook destructuring block (before the `// Tracks which panel's info section is currently open` comment on line 187), insert:

```tsx
  useFocusEffect(
    useCallback(() => {
      refresh()
      refreshProfile()
      refreshQuiz()
      refreshInterventions()
      refreshSocial()
    }, [refresh, refreshProfile, refreshQuiz, refreshInterventions, refreshSocial])
  )
```

**Why `useCallback`:** `useFocusEffect` re-invokes its callback every time the callback reference changes. Wrapping in `useCallback` with the 5 refresh functions as deps means it re-runs only when those references change — i.e. essentially never, since each is `useCallback`-stable in its own hook.

**Why all five:** The user's observation was about Dashboard metrics stale after a study session. Analytics is the primary offender, but `useQuizAnalytics` drives the quiz-accuracy breakdown, `useSocial` drives the leaderboard preview, `useInterventions` drives the banner, and `useProfile` drives the greeting. Refreshing all on focus covers the "friend accepted me while I was studying" and "intervention banner needs to reappear" cases too.

- [ ] **Step 4: Typecheck**

Run:
```bash
pnpm --filter @kanji-learn/mobile typecheck
```
Expected: Zero TypeScript errors.

**Stability note:** All 5 refresh functions are already `useCallback`-wrapped in their respective hooks (`useAnalytics.fetch` in [useAnalytics.ts:62](apps/mobile/src/hooks/useAnalytics.ts:62), `useSocial.loadAll` in [useSocial.ts:40](apps/mobile/src/hooks/useSocial.ts:40), etc., and the new `useInterventions.refresh` from Task 2). Their references are stable, so `useFocusEffect`'s callback fires once per focus — not every render. No infinite-refetch risk.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(tabs\)/index.tsx
git commit -m "feat(mobile): auto-refresh Dashboard data on tab focus"
```

---

## Task 4: Take Quiz empty state rewrite + "Start studying" CTA

Today, a brand-new user with zero reviews who taps Take Quiz on the Dashboard lands on `/test`. The API returns an empty array, the screen sets `loadError = 'No quiz questions available yet — study more kanji first.'` and enters the generic error state, which displays:

> Couldn't load quiz questions.
> Check your connection and try again.
> No quiz questions available yet — study more kanji first.
> [Retry] [Go Back]

The "connection" copy is misleading (it's a no-data issue) and the Retry button loops. Fix: branch on the empty-data case and show a dedicated empty-state view with an accurate subtitle and a "Start studying" CTA.

**Files:**
- Modify: `apps/mobile/app/test.tsx`

- [ ] **Step 1: Add an 'empty' status variant**

`apps/mobile/app/test.tsx` declares a `ScreenStatus` type alias at line 12. Change:

```ts
type ScreenStatus = 'loading' | 'question' | 'feedback' | 'complete' | 'error'
```
to:
```ts
type ScreenStatus = 'loading' | 'question' | 'feedback' | 'complete' | 'error' | 'empty'
```

The `useState<ScreenStatus>` declaration on line 51 does not need to change — it picks up the extended union automatically.

- [ ] **Step 2: Route the no-data case to the empty status**

In `loadQuestions` (starts around line 67), locate the block that handles an empty API response (currently around lines 73–77):

```tsx
      if (!data || data.length === 0) {
        setLoadError('No quiz questions available yet — study more kanji first.')
        setStatus('error')
        return
      }
```

Change it to:
```tsx
      if (!data || data.length === 0) {
        setLoadError(null)
        setStatus('empty')
        return
      }
```

(We clear `loadError` so it doesn't leak into any other error-rendering path.)

- [ ] **Step 3: Render the empty-state view**

Find the existing error-state render block. Based on the current file shape it starts around line 159:

```tsx
  if (status === 'error') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centeredFull}>
          <Ionicons name="alert-circle-outline" size={64} color={colors.error} />
          <Text style={styles.loadingText}>Couldn't load quiz questions.{'\n'}Check your connection and try again.</Text>
          {loadError && <Text style={styles.errorDetail}>{loadError}</Text>}
          <TouchableOpacity style={styles.retryButton} onPress={() => loadQuestions(quizModeIdx)}>
            <Ionicons name="refresh" size={16} color="#fff" />
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
            <Text style={styles.closeButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }
```

Insert a NEW block directly above this one (not replacing it — the old error block still handles real connection errors):

```tsx
  if (status === 'empty') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centeredFull}>
          <Ionicons name="school-outline" size={64} color={colors.primary} />
          <Text style={styles.loadingText}>Quizzes unlock once you've studied some kanji.</Text>
          <Text style={styles.errorDetail}>Complete a study session to build a pool of questions based on what you've seen.</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => router.replace('/(tabs)/study')}>
            <Ionicons name="play" size={16} color="#fff" />
            <Text style={styles.retryButtonText}>Start studying</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
            <Text style={styles.closeButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }
```

**Why `router.replace` (not `router.push`):** The user is on `/test`, which is a modal-style screen pushed from the Dashboard. `replace` unwinds that route so pressing Back from `/(tabs)/study` returns to the Dashboard, not the quiz error screen. `push` would stack `/study` on top of `/test`, leaving the broken quiz state behind them.

**Why reuse `styles.retryButton` / `styles.closeButton`:** Keeps the visual footprint identical to the existing error state so we're not introducing new design tokens in a polish build.

- [ ] **Step 4: Typecheck**

Run:
```bash
pnpm --filter @kanji-learn/mobile typecheck
```
Expected: Zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/test.tsx
git commit -m "fix(mobile): dedicated empty state + Start studying CTA on quiz screen"
```

---

## Task 5: Onboarding findHelp footer — append motivational line

**Files:**
- Modify: `apps/mobile/src/config/onboarding-content.ts:51`

- [ ] **Step 1: Update the findHelp footer string**

In `apps/mobile/src/config/onboarding-content.ts`, locate the `findHelp` block (starts around line 23). Change the footer field (line 51):

From:
```ts
    footer: "You don't need to memorise any of this now.",
```
to:
```ts
    footer: "You don't need to memorise any of this now. Studying daily is the key to making progress.",
```

**Why one string, not two lines:** The panel's footer renders as a single `<Text>` element. Keeping both sentences in one string preserves that. If the UI requires wrapping, the rendering engine handles it.

**OTA note:** This file is explicitly OTA-updatable via Expo EAS Update (see the header comment in the file). This copy change will take effect on the next EAS Update push without a rebuild — but we're bundling it into B121 anyway since the bundle ships a full build already.

- [ ] **Step 2: Typecheck**

Run:
```bash
pnpm --filter @kanji-learn/mobile typecheck
```
Expected: Zero TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/config/onboarding-content.ts
git commit -m "chore(mobile): add motivational line to onboarding findHelp footer"
```

---

## Task 6: JLPT color legend

Add a compact legend (colored dot + label for each of the 4 SRS stages) beneath the JLPT stacked bars so users can interpret the color segments without guessing. The legend lives inside `JlptProgressGrid` so both the Dashboard and any other consumer get it automatically.

**Files:**
- Modify: `apps/mobile/src/components/ui/JlptProgressGrid.tsx`

- [ ] **Step 1: Add legend render + styles**

Open `apps/mobile/src/components/ui/JlptProgressGrid.tsx`. The file currently defines a single `JlptProgressGrid` component that maps over `JLPT_LEVELS` and renders one `styles.row` per level inside a `styles.grid` wrapper.

Wrap the existing `<View style={styles.grid}>` return in a parent container and append a legend below it. Replace the entire `return (...)` block in the component body (the outermost `<View style={styles.grid}>...</View>` plus its contents) with the following.

Keep every existing child and style untouched — only the outer wrapper and the new legend are added:

```tsx
  return (
    <View style={styles.wrapper}>
      <View style={styles.grid}>
        {JLPT_LEVELS.map((level) => {
          const levelTotal = JLPT_KANJI_COUNTS[level]
          const raw = jlptProgress[level]
          const bd: JlptBreakdown =
            typeof raw === 'number'
              ? { learning: 0, reviewing: 0, remembered: 0, burned: raw }
              : raw ?? { learning: 0, reviewing: 0, remembered: 0, burned: 0 }
          const total = bd.learning + bd.reviewing + bd.remembered + bd.burned
          return (
            <View key={level} style={styles.row}>
              <Text style={styles.level}>{level}</Text>
              <View style={styles.track}>
                {bd.learning > 0 && (
                  <View
                    style={[
                      styles.seg,
                      { width: `${(bd.learning / levelTotal) * 100}%`, backgroundColor: colors.learning },
                    ]}
                  />
                )}
                {bd.reviewing > 0 && (
                  <View
                    style={[
                      styles.seg,
                      { width: `${(bd.reviewing / levelTotal) * 100}%`, backgroundColor: colors.reviewing },
                    ]}
                  />
                )}
                {bd.remembered > 0 && (
                  <View
                    style={[
                      styles.seg,
                      { width: `${(bd.remembered / levelTotal) * 100}%`, backgroundColor: colors.remembered },
                    ]}
                  />
                )}
                {bd.burned > 0 && (
                  <View
                    style={[
                      styles.seg,
                      { width: `${(bd.burned / levelTotal) * 100}%`, backgroundColor: colors.burned },
                    ]}
                  />
                )}
              </View>
              <Text style={styles.count}>
                {total}/{levelTotal}
              </Text>
            </View>
          )
        })}
      </View>
      <View style={styles.legend}>
        <LegendDot color={colors.learning} label="Learning" />
        <LegendDot color={colors.reviewing} label="Reviewing" />
        <LegendDot color={colors.remembered} label="Remembered" />
        <LegendDot color={colors.burned} label="Burned" />
      </View>
    </View>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  )
}
```

Then update the `StyleSheet.create` block to add the four new style keys. Change the existing styles block from:

```ts
const styles = StyleSheet.create({
  grid: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  level: { ...typography.caption, color: colors.textMuted, width: 24, fontWeight: '700' },
  track: {
    flex: 1,
    height: 6,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.full,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  seg: { height: '100%' },
  count: { ...typography.caption, color: colors.textMuted, width: 64, textAlign: 'right' },
})
```
to:
```ts
const styles = StyleSheet.create({
  wrapper: { gap: spacing.sm },
  grid: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  level: { ...typography.caption, color: colors.textMuted, width: 24, fontWeight: '700' },
  track: {
    flex: 1,
    height: 6,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.full,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  seg: { height: '100%' },
  count: { ...typography.caption, color: colors.textMuted, width: 64, textAlign: 'right' },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
})
```

**Why a sibling `<View style={styles.wrapper}>`:** The grid's existing `styles.grid` uses `gap: spacing.xs` for tight row spacing — reusing that for the legend would make the legend crowd the last row. A separate wrapper gives the legend `paddingTop: spacing.xs` breathing room without disrupting the grid's rhythm.

**Why `LegendDot` is a local component:** Four near-identical inline JSX blocks would bloat the render. A 6-line local helper is DRY without over-abstracting.

**Color tokens reused:** `colors.learning`, `colors.reviewing`, `colors.remembered`, `colors.burned` are already defined in `src/theme` (the grid uses them on lines 35, 43, 51, 59). No new tokens introduced.

- [ ] **Step 2: Typecheck**

Run:
```bash
pnpm --filter @kanji-learn/mobile typecheck
```
Expected: Zero TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/ui/JlptProgressGrid.tsx
git commit -m "feat(mobile): add color legend under JLPT progress grid"
```

---

## Post-task checklist (before cutting B121)

- [ ] **Full typecheck across the monorepo** (catches any cross-package breakage):

  ```bash
  pnpm -r typecheck
  ```
  Expected: All packages pass.

- [ ] **Run existing tests** (oauth.test.ts + any API tests):

  ```bash
  pnpm -r test
  ```
  Expected: All pass.

- [ ] **Review the combined diff** before pushing:

  ```bash
  git log --oneline origin/main..HEAD
  git diff origin/main..HEAD --stat
  ```
  Expected: 6 commits, ~7 files modified.

- [ ] **Push to main:**

  ```bash
  git push origin main
  ```

- [ ] **Cut B121 via EAS** (from `apps/mobile`, not repo root — see HANDOFF.md):

  ```bash
  cd apps/mobile
  eas build --platform ios --profile production --auto-submit
  ```

  EAS will auto-increment the build number and auto-submit to TestFlight. Expect ~15 min for Apple processing.

---

## Verification Plan (TestFlight B121 manual checklist)

Run through all six items once B121 lands in TestFlight.

### 1. Accuracy → Confidence copy
- [ ] Complete a short study session. On the Session Complete screen, the big percentage ring shows **"confidence"** below the number (not "accuracy").
- [ ] From Dashboard, tap "Drill Weak Spots" while your confidence is above 65%. Alert reads **"your confidence is above 65%"** (not "accuracy").
- [ ] Progress tab → tap the ⓘ on Session History → the info panel reads **"confidence for that session"** in the body and **"Confidence colour coding"** as the title.
- [ ] Progress tab → tap the ⓘ on Writing Practice → the info panel still says **"stroke-by-stroke accuracy"** / **"Avg accuracy"** (writing context — unchanged).
- [ ] Progress tab → tap the ⓘ on Speaking Practice → still says **"Accuracy"** where applicable (voice context — unchanged).

### 2. Dashboard auto-refresh
- [ ] Open the Dashboard. Note the "Remembered" / JLPT bars / streak / daily-goal values.
- [ ] Tap Study → complete a session that should change at least one of those values (e.g. review enough cards to tick a JLPT bar or move a card to remembered).
- [ ] Return to Dashboard tab. **Metrics update immediately without a pull-to-refresh.**
- [ ] Verify there is no infinite-refetch loop: open the Network tab / server logs if accessible, or simply watch the Dashboard for a few seconds — it should be idle, not constantly loading.

### 3. Take Quiz empty state
- [ ] Sign up a fresh throwaway account. Decline placement. Do zero reviews.
- [ ] From Dashboard, tap **"Take a Quiz"**.
- [ ] Screen shows the empty state (school icon, not alert icon) with copy **"Quizzes unlock once you've studied some kanji."** and a **"Start studying"** primary button.
- [ ] Tap "Start studying" → lands on the Study tab (not layered on top of the quiz screen).
- [ ] Back-navigate from Study — should return to Dashboard, not to the quiz screen.

### 4. Onboarding footer
- [ ] Sign up another throwaway account. Proceed through onboarding to the "Help is always one tap away" screen.
- [ ] Footer text includes both sentences: **"You don't need to memorise any of this now. Studying daily is the key to making progress."**

### 5. JLPT color legend
- [ ] Dashboard → scroll to the JLPT progress section. A legend with 4 colored dots + labels ("Learning", "Reviewing", "Remembered", "Burned") appears beneath the stacked bars.
- [ ] Each dot's color matches the corresponding bar segment color.

### 6. No regressions
- [ ] Sign out → sign back in via email/password, Google, Apple. All land on tabs cleanly.
- [ ] Complete a full review session end-to-end. Grading buttons (Again/Hard/Good/Easy) still work. Mnemonic still auto-reveals on Hard or Again (unchanged in this build — Build 2 handles the mnemonic trigger rework).
- [ ] Delete Account flow still works (core flow — relational cascade cleanup ships in Build 3).

---

## Expected file-level diff summary

```
apps/mobile/src/components/study/SessionComplete.tsx   | 2 +-
apps/mobile/app/(tabs)/index.tsx                       | ~15 changed
apps/mobile/app/(tabs)/progress.tsx                    | 4 +-
apps/mobile/src/hooks/useInterventions.ts              | ~25 changed
apps/mobile/app/test.tsx                               | ~30 added
apps/mobile/src/config/onboarding-content.ts           | 2 +-
apps/mobile/src/components/ui/JlptProgressGrid.tsx     | ~45 added
```

Expected total: ~7 files, ~90 lines net added, 6 commits.
