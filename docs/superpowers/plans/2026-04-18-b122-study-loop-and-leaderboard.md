# Build 2: Study Loop + Leaderboard Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 6 study-loop and leaderboard enhancements on top of Build 1 (B121 commits already merged to `main`). The whole bundle lands as one TestFlight cut when the user is ready.

**Architecture:** Mixed stack — mobile-heavy with two backend changes (weighted confidence SQL and leaderboard columns). No DB migrations required; every underlying column already exists.

**Tech Stack:** React Native + Expo Router (TypeScript), Fastify API (TypeScript), Drizzle ORM over Postgres, Zustand state + custom hooks.

---

## Scope

**In scope (6 tasks):**
1. Mnemonic auto-reveal narrowed to "Again" only
2. Weighted 3/2/1/0 confidence scoring (Easy=3, Good=2, Hard=1, Again=0) — server SQL + client Session Complete math
3. "Show mnemonic" button on Kanji details page (cached reveal + Regenerate)
4. Meaning-vs-Reading study-card visual cue (violet/amber border + label + tint)
5. Dashboard "Invite a study mate" dismissible banner (0 mates + 7-day dismiss gate)
6. Leaderboard: add `totalDaysStudied` + `rememberedCount` columns, sort streak → days → remembered

**Out of scope (Build 3):** Post-delete relational cascade + farewell push, nudge/poke feature with Watch haptics.

## Testing Strategy

Same as Build 1: `pnpm --filter @kanji-learn/mobile typecheck` and `pnpm --filter @kanji-learn/api typecheck` as the mechanical gates. No new Jest tests — mobile has no React Native testing library, and API integration tests require `TEST_DATABASE_URL` (not set). Manual TestFlight verification is the final gate, checklist at the end of this plan.

---

## File Structure

| File | Purpose | Touched by |
|---|---|---|
| `apps/mobile/app/(tabs)/study.tsx` | Narrow mnemonic trigger to Again-only | Task 1 |
| `apps/api/src/services/analytics.service.ts` | Weighted confidence SQL | Task 2 |
| `apps/mobile/src/stores/review.store.ts` | Compute weighted confidence for Session Complete | Task 2 |
| `apps/mobile/src/components/study/SessionComplete.tsx` | Use weighted confidence prop | Task 2 |
| `apps/mobile/app/(tabs)/study.tsx` | Pass new `confidencePct` into SessionComplete | Task 2 |
| `apps/mobile/app/kanji/[id].tsx` | Add Mnemonic section with reveal + Regenerate | Task 3 |
| `apps/mobile/src/theme/index.ts` | Add `colors.meaningCue` violet token | Task 4 |
| `apps/mobile/src/components/study/KanjiCard.tsx` | Apply meaning/reading border + tint | Task 4 |
| `apps/mobile/src/components/ui/InviteMateBanner.tsx` | New component (create) | Task 5 |
| `apps/mobile/app/(tabs)/index.tsx` | Mount the banner | Task 5 |
| `apps/api/src/services/social.service.ts` | Extend leaderboard SQL with days + remembered | Task 6 |
| `packages/shared/src/types.ts` | Extend `LeaderboardEntry` type | Task 6 |
| `apps/mobile/src/hooks/useSocial.ts` | Extend client `LeaderboardEntry` | Task 6 |
| `apps/mobile/app/(tabs)/index.tsx` | Render new columns in leaderboard preview | Task 6 |

---

## Task 1: Mnemonic auto-reveal — Again only

Today, the mnemonic nudge sheet appears after grading a card **Hard (quality=3) OR Again (quality=1)** (excluding compound review). Narrow to **Again only**.

**Files:**
- Modify: `apps/mobile/app/(tabs)/study.tsx:221`

- [ ] **Step 1: Narrow the condition**

In `apps/mobile/app/(tabs)/study.tsx`, locate the grade handler around lines 210–240. The condition on line 221 currently reads:

```tsx
      if ((quality === 1 || quality === 3) && item.reviewType !== 'compound') {
```

Change to:
```tsx
      if (quality === 1 && item.reviewType !== 'compound') {
```

(We keep the `item.reviewType !== 'compound'` guard — compound reviews have their own UX and should not trigger the nudge.)

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @kanji-learn/mobile typecheck
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/\(tabs\)/study.tsx
git commit -m "fix(mobile): mnemonic auto-reveal only on Again (quality=1), not Hard"
```

---

## Task 2: Weighted 3/2/1/0 confidence scoring

**Context (important — read before implementing):**

The mobile app grades cards with 4 buttons that map to SM-2 quality values already stored in `review_logs.quality` (`smallint`):

| Button | quality value | New weight |
|---|---|---|
| Easy | 5 | 3 |
| Good | 4 | 2 |
| Hard | 3 | 1 |
| Again | 1 | 0 |

(Quality 0 and 2 are not produced by current UI but may exist in legacy data from SM-2 edge cases — treat both as weight 0.)

Since the raw 0–5 quality is stored per review, no data migration is needed — we just change the aggregation formula. Historical reviews naturally reflect the new formula on read.

**Weighted formula:** `SUM(weight) / (3 × COUNT(*)) × 100`

Today there are TWO confidence computations that need updating:

1. **Server, `getConfidenceRate`** in [apps/api/src/services/analytics.service.ts](apps/api/src/services/analytics.service.ts) — currently queries `daily_stats.correct` (a pre-computed binary rollup). **Replace** with a weighted query over `review_logs`.
2. **Server, `getConfidenceByType`** in the same file — currently uses `count(*) filter (where quality >= 4)`. Change to weighted.
3. **Client, Session Complete screen** — currently computes `accuracy = correctItems / totalItems × 100`. Replace with a weighted sum over the session's per-card grades.

Quiz scoring (`test_results.correct`) stays binary — not touched.

**Files:**
- Modify: `apps/api/src/services/analytics.service.ts`
- Modify: `apps/mobile/src/stores/review.store.ts`
- Modify: `apps/mobile/src/components/study/SessionComplete.tsx`
- Modify: `apps/mobile/app/(tabs)/study.tsx`

- [ ] **Step 1: Add a shared weighted-confidence helper on the server**

In `apps/api/src/services/analytics.service.ts`, somewhere near the top of the file (after imports, before any method definitions — a module-local SQL fragment), add:

```ts
// Weighted confidence: Easy=3, Good=2, Hard=1, Again=0. Normalized to 0–100.
// quality 5/4/3/1 map to weights 3/2/1/0; quality 0 and 2 (not produced by
// current UI but possible in legacy SM-2 data) map to 0.
const WEIGHTED_CONFIDENCE_SQL = sql<number>`
  COALESCE(
    ROUND(
      SUM(
        CASE
          WHEN ${reviewLogs.quality} = 5 THEN 3
          WHEN ${reviewLogs.quality} = 4 THEN 2
          WHEN ${reviewLogs.quality} = 3 THEN 1
          ELSE 0
        END
      )::numeric / NULLIF(COUNT(*) * 3, 0) * 100
    )::int,
    0
  )
`
```

Ensure `sql` is imported from `drizzle-orm` at the top of the file (it almost certainly already is — don't add a duplicate import).

- [ ] **Step 2: Replace `getConfidenceRate` to use weighted SQL over review_logs**

Locate the existing `getConfidenceRate` method (lines ~172–188). It currently queries `daily_stats`. Replace the entire method body with a weighted query over `review_logs`:

```ts
  async getConfidenceRate(userId: string, sinceDays = 7): Promise<number> {
    const since = new Date()
    since.setDate(since.getDate() - sinceDays)

    const row = await this.db
      .select({ confidence: WEIGHTED_CONFIDENCE_SQL })
      .from(reviewLogs)
      .where(and(
        eq(reviewLogs.userId, userId),
        gte(reviewLogs.createdAt, since),
      ))

    return row[0]?.confidence ?? 0
  }
```

**Do NOT** remove the `daily_stats` import — it's still used elsewhere (streaks, activity tracking). We're only changing the confidence-metric source.

If `and`, `eq`, `gte` aren't already imported from `drizzle-orm`, add them to the existing drizzle import statement.

- [ ] **Step 3: Replace `getConfidenceByType` to use weighted SQL**

Locate `getConfidenceByType` (lines ~146–168). It currently computes `count(*) filter (where quality >= 4)` per review type. Replace the body with:

```ts
  async getConfidenceByType(userId: string, sinceDays = 7): Promise<Record<string, AccuracyTypeStat>> {
    const since = new Date()
    since.setDate(since.getDate() - sinceDays)

    const rows = await this.db
      .select({
        reviewType: reviewLogs.reviewType,
        total: sql<number>`count(*)::int`,
        // We keep a binary-ish "correct" count for tooltip/breakdown purposes:
        // quality >= 4 (Good or Easy) counts as "confident" in the per-type split.
        correct: sql<number>`count(*) filter (where ${reviewLogs.quality} >= 4)::int`,
        confidence: WEIGHTED_CONFIDENCE_SQL,
      })
      .from(reviewLogs)
      .where(and(
        eq(reviewLogs.userId, userId),
        gte(reviewLogs.createdAt, since),
      ))
      .groupBy(reviewLogs.reviewType)

    const byType: Record<string, AccuracyTypeStat> = {}
    for (const row of rows) {
      byType[row.reviewType] = {
        total: row.total,
        correct: row.correct,
        pct: row.confidence,
      }
    }
    return byType
  }
```

**Key semantic note:** `pct` is now the weighted confidence percentage. `correct` is retained because existing API/mobile callers destructure it; callers that only read `pct` will get the weighted value for free. The mobile `AccuracyTypeStat` interface (in `apps/mobile/src/hooks/useAnalytics.ts:15`) has fields `total`, `correct`, `pct` — unchanged.

- [ ] **Step 4: Server-side typecheck**

```bash
pnpm --filter @kanji-learn/api typecheck
```
Expected: zero errors.

- [ ] **Step 5: Commit the server half**

```bash
git add apps/api/src/services/analytics.service.ts
git commit -m "feat(api): weighted 3/2/1/0 confidence scoring (Easy/Good/Hard/Again)"
```

- [ ] **Step 6: Update review store to expose a weighted confidence for session summary**

The Session Complete screen needs a weighted session-local confidence. The review store already tracks `results: ReviewResult[]` with each `ReviewResult.quality`. Expose a derived value.

Open `apps/mobile/src/stores/review.store.ts`. Locate the `finishSession` method (you'll find it returns an object with `burned` and `studyTimeMs` today — see the `ReviewState` interface around line 58).

Before `finishSession` returns, compute `confidencePct` from the collected `results` and include it in the returned object. Change the return signature of `finishSession` from:

```ts
  finishSession: () => Promise<{ burned: number; studyTimeMs: number } | null>
```
to:
```ts
  finishSession: () => Promise<{ burned: number; studyTimeMs: number; confidencePct: number } | null>
```

Inside the method, before building the return value, compute:

```ts
      const weightForQuality = (q: number): number => {
        if (q === 5) return 3
        if (q === 4) return 2
        if (q === 3) return 1
        return 0
      }
      const { results } = get()
      const totalReviews = results.length
      const confidencePct = totalReviews > 0
        ? Math.round(
            (results.reduce((sum, r) => sum + weightForQuality(r.quality), 0) /
              (totalReviews * 3)) * 100
          )
        : 0
```

Include `confidencePct` in the returned object alongside `burned` and `studyTimeMs`.

**Locate the full `finishSession` method body** in `apps/mobile/src/stores/review.store.ts`. Add the `weightForQuality` helper and `confidencePct` computation at the top of the method (after any existing early-return guards, before the server call or final state setters). Include `confidencePct` in both the resolved value and any internally stored session summary if one exists.

- [ ] **Step 7: Update SessionComplete to accept confidencePct**

Open `apps/mobile/src/components/study/SessionComplete.tsx`. Change the `Props` interface (lines 6–14) from:

```tsx
interface Props {
  totalItems: number
  correctItems: number
  newLearned: number
  burned: number
  studyTimeMs: number
  onDone: () => void
  onReview: () => void
}
```
to:
```tsx
interface Props {
  totalItems: number
  correctItems: number
  confidencePct: number
  newLearned: number
  burned: number
  studyTimeMs: number
  onDone: () => void
  onReview: () => void
}
```

Update the function destructure on line 35 from:
```tsx
export function SessionComplete({ totalItems, correctItems, newLearned, burned, studyTimeMs, onDone, onReview }: Props) {
```
to:
```tsx
export function SessionComplete({ totalItems, correctItems, confidencePct, newLearned, burned, studyTimeMs, onDone, onReview }: Props) {
```

Replace the `accuracy` computation on line 36 from:
```tsx
  const accuracy = totalItems > 0 ? Math.round((correctItems / totalItems) * 100) : 0
```
to:
```tsx
  const accuracy = confidencePct
```

(We alias to `accuracy` so the rest of the component — `accColor`, threshold checks, the local var references — continues to work without renames. This is a backing-value swap, not a UX rename. The user-facing label already says "confidence" from Build 1.)

**Keep `correctItems` in the props** — it is consumed further down the file for the "correct" vs "wrong" breakdown boxes (`const wrong = totalItems - correctItems` on line 37, and render on later lines). Do not remove it.

- [ ] **Step 8: Pass confidencePct from study.tsx into SessionComplete**

Open `apps/mobile/app/(tabs)/study.tsx`. Find where `SessionComplete` is rendered. The props come from the result of `finishSession()` plus the in-memory review store state. You must capture the new `confidencePct` off the `finishSession` return value and pass it as a new prop.

Locate the call to `finishSession` (search for `finishSession(` in the file). Today it destructures `{ burned, studyTimeMs }`. Extend to include `confidencePct`:

```tsx
// Before:
const summary = await finishSession()
// … (later) <SessionComplete ... />
```

Whether the summary is stored in local state or used inline, add `confidencePct` to the passed props on the `<SessionComplete>` JSX element:

```tsx
<SessionComplete
  totalItems={/* existing */}
  correctItems={/* existing */}
  confidencePct={summary?.confidencePct ?? 0}
  newLearned={/* existing */}
  burned={/* existing */}
  studyTimeMs={/* existing */}
  onDone={/* existing */}
  onReview={/* existing */}
/>
```

If the component stores `summary` in state (e.g. `const [summary, setSummary] = useState<...>()`), update the state type accordingly:

```ts
type SessionSummary = { burned: number; studyTimeMs: number; confidencePct: number }
```

- [ ] **Step 9: Mobile typecheck**

```bash
pnpm --filter @kanji-learn/mobile typecheck
```
Expected: zero errors. If TS complains that `summary` is missing `confidencePct`, verify Steps 6 and 8.

- [ ] **Step 10: Commit the client half**

```bash
git add apps/mobile/src/stores/review.store.ts apps/mobile/src/components/study/SessionComplete.tsx apps/mobile/app/\(tabs\)/study.tsx
git commit -m "feat(mobile): weighted session confidence on Session Complete screen"
```

---

## Task 3: "Show mnemonic" button on Kanji details page

Add a Mnemonic section to the Kanji details page. Default state: show the most recent cached mnemonic (via `useMnemonics(kanjiId)`) if one exists; else show a "Generate mnemonic" button. When a mnemonic is visible, also show a "Regenerate" secondary button.

**Files:**
- Modify: `apps/mobile/app/kanji/[id].tsx`

- [ ] **Step 1: Wire up the useMnemonics hook**

Open `apps/mobile/app/kanji/[id].tsx`. Near the top of the component (after the existing data-fetch hooks), add:

```tsx
import { useMnemonics } from '../../src/hooks/useMnemonics'
// … inside the component, after other hooks …
const { mnemonics, isLoading: mnemonicLoading, isGenerating, load: loadMnemonics, generate: generateMnemonic } = useMnemonics(kanjiId)
```

Trigger a load once the kanji id is known. The hook already caches to AsyncStorage, so this is cheap and idempotent. Use a `useEffect`:

```tsx
useEffect(() => {
  if (kanjiId) loadMnemonics()
}, [kanjiId, loadMnemonics])
```

**Note on `kanjiId`:** The details screen reads it from `useLocalSearchParams` (see existing `id` parsing). Use whatever numeric variable is already in scope (likely `kanjiId` or similar after parsing).

- [ ] **Step 2: Add the Mnemonic section**

Find the existing ScrollView sections on the details page (meanings, readings, stroke order, related kanji, SRS progress). Insert a new section between readings and stroke order (or wherever visually appropriate — pick the position that matches the existing section ordering and rhythm).

```tsx
<View style={styles.section}>
  <Text style={styles.sectionTitle}>Mnemonic</Text>
  {mnemonicLoading && mnemonics.length === 0 ? (
    <ActivityIndicator color={colors.primary} />
  ) : mnemonics.length > 0 ? (
    <>
      <Text style={styles.mnemonicText}>{mnemonics[0].storyText}</Text>
      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => generateMnemonic('haiku')}
        disabled={isGenerating}
      >
        <Ionicons name="refresh" size={16} color={colors.primary} />
        <Text style={styles.secondaryButtonText}>
          {isGenerating ? 'Regenerating…' : 'Regenerate'}
        </Text>
      </TouchableOpacity>
    </>
  ) : (
    <TouchableOpacity
      style={styles.primaryButton}
      onPress={() => generateMnemonic('haiku')}
      disabled={isGenerating}
    >
      <Ionicons name="sparkles" size={16} color="#fff" />
      <Text style={styles.primaryButtonText}>
        {isGenerating ? 'Generating…' : 'Generate mnemonic'}
      </Text>
    </TouchableOpacity>
  )}
</View>
```

Ensure `ActivityIndicator`, `TouchableOpacity`, `Ionicons`, `colors` are already imported in the file (they almost certainly are for other sections). If not, add to existing imports.

- [ ] **Step 3: Add the required styles**

In the existing `StyleSheet.create({...})` block at the bottom of the file, add these keys (check first whether any of the names collide with existing keys — rename if so, prefixing with `mnemonic`):

```ts
  mnemonicText: {
    ...typography.body,
    color: colors.textPrimary,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignSelf: 'flex-start',
  },
  primaryButtonText: {
    ...typography.body,
    color: '#fff',
    fontWeight: '600',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    alignSelf: 'flex-start',
  },
  secondaryButtonText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
```

**If `primaryButton` / `secondaryButton` already exist in this file's styles,** reuse them — do not duplicate. Use read-then-decide: read the existing styles, and only add keys that don't already exist.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @kanji-learn/mobile typecheck
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/kanji/\[id\].tsx
git commit -m "feat(mobile): show-mnemonic section on Kanji details page"
```

---

## Task 4: Meaning vs Reading visual cue on study card

Apply three cues to the study-card prompt based on `item.reviewType`:
- **Meaning** prompts: **violet** border (new token `colors.meaningCue = #7C3AED`) + 5–8% opacity tint
- **Reading** prompts: **amber** border (existing `colors.accent = #F4A261`) + 5–8% opacity tint
- Both: the label below the kanji ("What does this mean?" / "How do you read this?") is already rendered via `PROMPT_LABELS` at [KanjiCard.tsx:219](apps/mobile/src/components/study/KanjiCard.tsx:219) — no label change needed, just styling.
- **Writing** and **Compound** prompts: unchanged (leave the default neutral styling).

**Files:**
- Modify: `apps/mobile/src/theme/index.ts`
- Modify: `apps/mobile/src/components/study/KanjiCard.tsx`

- [ ] **Step 1: Add the violet theme token**

Open `apps/mobile/src/theme/index.ts`. In the `colors` object (around lines 16–20 in the existing theme), add a new key `meaningCue: '#7C3AED'`. Do not reorganize existing tokens — just append.

If the theme file is larger than expected and uses sub-groups (e.g. separate `semantic`, `brand`, `srs` sections), place it alongside the general UI tokens — not inside an SRS-status group.

- [ ] **Step 2: Compute the border + tint colors per review type**

Open `apps/mobile/src/components/study/KanjiCard.tsx`. Locate the kanji display area. Based on the ground-truth report, the `kanjiArea` region is at ~line 593 with `minHeight: 180`; the prompt label renders at line 219 via `PROMPT_LABELS[item.reviewType]`.

Near the top of the component body (before the JSX return), derive the cue colors:

```tsx
  const cueColor =
    item.reviewType === 'meaning' ? colors.meaningCue :
    item.reviewType === 'reading' ? colors.accent :
    null
  const cueTint = cueColor ? `${cueColor}14` : 'transparent' // 14 hex = ~8% opacity
```

(`${cueColor}14` appends the alpha byte to the hex, giving ~8% opacity. React Native accepts 8-digit hex colors.)

- [ ] **Step 3: Apply the cue to the kanji display container**

Find the container wrapping the kanji glyph + prompt label (likely `<View style={styles.kanjiArea}>` or similar). Augment its style prop to conditionally add border + background when a cue color is active:

```tsx
<View
  style={[
    styles.kanjiArea,
    cueColor && {
      borderWidth: 2,
      borderColor: cueColor,
      backgroundColor: cueTint,
      borderRadius: radius.lg,
    },
  ]}
>
  {/* existing kanji glyph + PROMPT_LABELS[item.reviewType] label */}
</View>
```

**Do not break the existing layout:** if `kanjiArea` already has a `borderRadius` or `padding`, the conditional style merges on top — the existing radius wins if specified in the base style, so confirm the base style's `borderRadius` matches `radius.lg` (or adjust the conditional).

If `radius` is not yet imported from the theme, add it to the existing theme-import line at the top of `KanjiCard.tsx`.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @kanji-learn/mobile typecheck
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/theme/index.ts apps/mobile/src/components/study/KanjiCard.tsx
git commit -m "feat(mobile): meaning/reading visual cue on study card (violet/amber)"
```

---

## Task 5: Dashboard "Invite a study mate" banner

Create a new dismissible banner component. Mount it on the Dashboard. Banner shows when:
- `friends.length === 0`, AND
- last dismiss was ≥ 7 days ago (or never).

Tap banner body → navigate to the Profile tab's Study Mates section (existing entry point).
Tap X → persist `Date.now()` to `storage` under key `kl:invite_mate_dismissed_at`; banner hides for 7 days.

**Files:**
- Create: `apps/mobile/src/components/ui/InviteMateBanner.tsx`
- Modify: `apps/mobile/app/(tabs)/index.tsx`

- [ ] **Step 1: Create the banner component**

Create `apps/mobile/src/components/ui/InviteMateBanner.tsx` with the following contents. It encapsulates all storage + cooldown logic internally so the Dashboard only mounts it and passes an `onInvite` handler.

```tsx
import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { storage } from '../../lib/storage'
import { colors, spacing, radius, typography } from '../../theme'

const STORAGE_KEY = 'kl:invite_mate_dismissed_at'
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

interface Props {
  /** Callback when the user taps the banner body to accept the CTA */
  onInvite: () => void
  /** How many study mates the user currently has — banner only shows when 0 */
  mateCount: number
}

export function InviteMateBanner({ onInvite, mateCount }: Props) {
  const [hidden, setHidden] = useState<boolean>(true)

  useEffect(() => {
    let cancelled = false
    async function check() {
      if (mateCount > 0) {
        setHidden(true)
        return
      }
      const dismissedAt = await storage.getItem<number>(STORAGE_KEY)
      const stillCooling = dismissedAt && Date.now() - dismissedAt < COOLDOWN_MS
      if (!cancelled) setHidden(!!stillCooling)
    }
    check()
    return () => { cancelled = true }
  }, [mateCount])

  const handleDismiss = async () => {
    await storage.setItem(STORAGE_KEY, Date.now())
    setHidden(true)
  }

  if (hidden) return null

  return (
    <TouchableOpacity style={styles.banner} onPress={onInvite} activeOpacity={0.85}>
      <Ionicons name="people" size={20} color={colors.primary} style={styles.icon} />
      <View style={styles.textWrap}>
        <Text style={styles.title}>Study with a friend</Text>
        <Text style={styles.subtitle}>Invite a study mate to compare progress and stay motivated.</Text>
      </View>
      <TouchableOpacity onPress={handleDismiss} hitSlop={12} style={styles.dismiss}>
        <Ionicons name="close" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  icon: { marginLeft: spacing.xs },
  textWrap: { flex: 1, gap: 2 },
  title: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  subtitle: { ...typography.caption, color: colors.textMuted },
  dismiss: { padding: spacing.xs },
})
```

**Theme-token note:** If `colors.bgSurface`, `colors.textPrimary`, `colors.textMuted`, `colors.primary` don't all exist, the typecheck will fail loud. Adjust to the actual available tokens (the Dashboard already uses these names in Build 1 work, so they should be present).

- [ ] **Step 2: Mount the banner on the Dashboard**

Open `apps/mobile/app/(tabs)/index.tsx`. Add the import at the top of the imports block (group with the other `../../src/components/ui/...` imports):

```tsx
import { InviteMateBanner } from '../../src/components/ui/InviteMateBanner'
```

`useSocial` returns a `friends` array. Destructure it alongside the existing `leaderboard` / `loadAll: refreshSocial`:

```tsx
  const { friends, leaderboard, loadAll: refreshSocial } = useSocial()
```

Inside the `ScrollView` on the Dashboard, find the existing `InterventionBanner` mount (you'll see it in the JSX — search for `<InterventionBanner`). Mount the new banner **directly below** `InterventionBanner`:

```tsx
<InviteMateBanner
  mateCount={friends.length}
  onInvite={() => router.push('/(tabs)/profile')}
/>
```

(The Profile tab hosts the Study Mates section — tapping navigates there. If the Profile tab's Study Mates sub-section has a dedicated route, prefer that; otherwise a push to `/(tabs)/profile` is acceptable for this build.)

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @kanji-learn/mobile typecheck
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/ui/InviteMateBanner.tsx apps/mobile/app/\(tabs\)/index.tsx
git commit -m "feat(mobile): dismissible invite-a-study-mate banner on Dashboard"
```

---

## Task 6: Leaderboard — days-studied + remembered columns

Extend the leaderboard with two new per-entry metrics:
- `totalDaysStudied`: lifetime count of distinct days the user has logged at least one review. Source: `SELECT COUNT(DISTINCT date) FROM daily_stats WHERE user_id = $1 AND reviewed > 0`.
- `rememberedCount`: count of kanji the user has progressed to `remembered` OR `burned`. Source: `SELECT COUNT(*) FROM user_kanji_progress WHERE user_id = $1 AND status IN ('remembered', 'burned')`.

Update the leaderboard sort to: streak → totalDaysStudied → rememberedCount (descending on each).

Propagate the new fields through the shared type, the mobile hook type, and the Dashboard's leaderboard preview render.

**Files:**
- Modify: `apps/api/src/services/social.service.ts`
- Modify: `packages/shared/src/types.ts` (if `LeaderboardEntry` lives there; else wherever the shared type is)
- Modify: `apps/mobile/src/hooks/useSocial.ts`
- Modify: `apps/mobile/app/(tabs)/index.tsx` (leaderboard preview)

### Step 1: Locate the canonical LeaderboardEntry type

Before changing server code, determine where `LeaderboardEntry` is defined:
- If it lives in `packages/shared/src/types.ts` (or is exported from `@kanji-learn/shared`), extend it there — both server and client import from shared.
- If the server has its own local definition inside `social.service.ts` or a types file, the client in `useSocial.ts` has a parallel definition. Extend both.

Run:
```bash
grep -rn "interface LeaderboardEntry\|type LeaderboardEntry" packages/shared apps/api apps/mobile --include="*.ts" --include="*.tsx"
```

Report findings before continuing. This informs which files Step 2 touches.

- [ ] **Step 2: Extend the LeaderboardEntry type(s)**

Wherever `LeaderboardEntry` is defined (likely both `packages/shared` and `apps/mobile/src/hooks/useSocial.ts` — possibly `apps/api/src/services/social.service.ts` as well), add two new fields. The existing shape (per `useSocial.ts:18–26`) is:

```ts
export interface LeaderboardEntry {
  userId: string
  displayName: string | null
  streak: number
  totalReviewed: number
  totalBurned: number
  dailyAverage: number
  isMe: boolean
}
```

Extend to:
```ts
export interface LeaderboardEntry {
  userId: string
  displayName: string | null
  streak: number
  totalReviewed: number
  totalBurned: number
  totalDaysStudied: number
  rememberedCount: number
  dailyAverage: number
  isMe: boolean
}
```

Add to every location where this interface is declared. Do not duplicate; if one file re-exports from shared, only edit the canonical definition.

- [ ] **Step 3: Extend the leaderboard SQL in social.service.ts**

Open `apps/api/src/services/social.service.ts`. Locate `getLeaderboard` (lines ~150–225 per ground truth).

Current code fetches two intermediate maps:
- `reviewedMap` — non-unseen kanji per user
- `burnedMap` — burned kanji per user

Add two more aggregations:

```ts
    // Lifetime distinct study days per user.
    const daysStudiedRows = await this.db
      .select({
        userId: dailyStats.userId,
        days: sql<number>`count(distinct ${dailyStats.date})::int`,
      })
      .from(dailyStats)
      .where(and(
        inArray(dailyStats.userId, targetIds),
        gt(dailyStats.reviewed, 0),
      ))
      .groupBy(dailyStats.userId)
    const daysStudiedMap = new Map(daysStudiedRows.map((r) => [r.userId, r.days]))

    // Remembered + burned kanji per user.
    const rememberedRows = await this.db
      .select({
        userId: userKanjiProgress.userId,
        count: sql<number>`count(*)::int`,
      })
      .from(userKanjiProgress)
      .where(and(
        inArray(userKanjiProgress.userId, targetIds),
        inArray(userKanjiProgress.status, ['remembered', 'burned']),
      ))
      .groupBy(userKanjiProgress.userId)
    const rememberedMap = new Map(rememberedRows.map((r) => [r.userId, r.count]))
```

Ensure `gt` and `inArray` are imported from `drizzle-orm` at the top of the file (both are commonly already imported — don't duplicate).

When building each `LeaderboardEntry` (the existing loop around line ~210), add:

```ts
        totalDaysStudied: daysStudiedMap.get(uid) ?? 0,
        rememberedCount: rememberedMap.get(uid) ?? 0,
```

- [ ] **Step 4: Update the sort comparator**

Find the return at ~line 224:

```ts
return entries.sort((a, b) => b.streak - a.streak || b.totalReviewed - a.totalReviewed)
```

Replace with:
```ts
return entries.sort((a, b) =>
  b.streak - a.streak ||
  b.totalDaysStudied - a.totalDaysStudied ||
  b.rememberedCount - a.rememberedCount
)
```

- [ ] **Step 5: Render the new columns in the Dashboard leaderboard preview**

Open `apps/mobile/app/(tabs)/index.tsx`. Find where the leaderboard preview is rendered (it iterates `leaderboard` from `useSocial` and renders N rows with displayName + streak + burned count).

Without redesigning the row, add a compact third/fourth stat slot showing the new values. The exact visual placement depends on the current row layout — if the row is `<displayName>   <streak>🔥   <burned>💎` today, extend to `<displayName>   <streak>🔥   <days>📅   <remembered>🌱`.

Pick emojis/icons that clearly differ from existing ones (suggestion: `calendar` outline icon for days, `leaf` or `school` for remembered). If the row is already cramped, hide the new columns behind a "tap for detail" pattern — but a simple inline render is preferred for this build.

**Do not** break the existing row render. If the current render is tabular with fixed widths, reduce each column's width proportionally to fit. If it uses flex, add two more `<View>` children with matching flex properties.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @kanji-learn/api typecheck
pnpm --filter @kanji-learn/mobile typecheck
```
Expected: zero errors on both.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/social.service.ts packages/shared/src/types.ts apps/mobile/src/hooks/useSocial.ts apps/mobile/app/\(tabs\)/index.tsx
git commit -m "feat(leaderboard): add days-studied + remembered columns; sort streak→days→remembered"
```

(Adjust the `git add` list based on which files actually changed in Step 1's type-location audit.)

---

## Post-task checklist (before pushing B122)

- [ ] **Full monorepo typecheck:**
  ```bash
  pnpm -r typecheck
  ```
  Expected: all 4 packages pass.

- [ ] **Review combined diff:**
  ```bash
  git log --oneline origin/main..HEAD
  git diff origin/main..HEAD --stat
  ```
  Expected: ~8–10 commits across ~12–15 files.

- [ ] **Push to main:**
  ```bash
  git push origin main
  ```

- [ ] **Do NOT cut EAS yet** — the user will decide when to cut a combined TestFlight build bundling Build 1 + Build 2.

---

## Verification Plan (combined Build 1 + Build 2 TestFlight)

All Build 1 items from `2026-04-18-b121-copy-and-ux-sweep.md` plus the 6 Build 2 items. In order:

### Build 1 items (from prior plan)
- [ ] Accuracy → Confidence copy (Session Complete, Drill Weak Spots, Progress info panel)
- [ ] Dashboard auto-refresh after study session
- [ ] Take Quiz empty state + CTA
- [ ] Onboarding findHelp footer motivational line
- [ ] JLPT color legend

### Build 2 items
- [ ] **Mnemonic Again-only**: Grade a card Hard (quality=3). Mnemonic nudge does NOT appear. Grade another Again (quality=1). Mnemonic nudge DOES appear.
- [ ] **Weighted confidence**: Complete a session mixing Easy/Good/Hard/Again grades. Session Complete shows a percentage that reflects weighted scoring — NOT simple `correct/total`. Dashboard confidence ring updates to the same weighted value on next focus.
- [ ] **Show mnemonic on Kanji details**: Open any kanji detail page (via Journal, study card detail drawer, or direct navigation). Mnemonic section is visible. If a mnemonic exists, it renders with a Regenerate button. If none exists, Generate mnemonic button is shown. Tap Generate → loading state → mnemonic appears.
- [ ] **Meaning/Reading cue**: Start a study session. Meaning prompts have a violet border + tint. Reading prompts have an amber border + tint. Writing/Compound prompts look unchanged.
- [ ] **Invite-a-mate banner**: Sign up throwaway account with zero study mates. Dashboard shows "Study with a friend" banner. Tap X → banner hides. Force-quit the app and reopen: banner stays hidden. Change device date forward 8 days (or wait) → banner reappears.
- [ ] **Leaderboard**: View leaderboard on Dashboard. New columns for days-studied and remembered count visible. Users sort by streak first, then days, then remembered.

### Regression spot-checks
- [ ] Sign in with email/password, Apple, Google — all land on tabs cleanly.
- [ ] Delete Account flow still works (relational cascade cleanup remains deferred to Build 3).
- [ ] Pull-to-refresh on Dashboard still works (coexists with the new auto-refresh).

---

## Expected diff summary

```
packages/shared/src/types.ts                              |  2 +
apps/api/src/services/analytics.service.ts                | ~40 changed
apps/api/src/services/social.service.ts                   | ~35 added
apps/mobile/app/(tabs)/index.tsx                          | ~20 added
apps/mobile/app/(tabs)/study.tsx                          |  5 +/-
apps/mobile/app/kanji/[id].tsx                            | ~60 added
apps/mobile/src/components/study/KanjiCard.tsx            | ~15 added
apps/mobile/src/components/study/SessionComplete.tsx      |  8 +/-
apps/mobile/src/components/ui/InviteMateBanner.tsx        | 65 added (new file)
apps/mobile/src/hooks/useSocial.ts                        |  2 +
apps/mobile/src/stores/review.store.ts                    | ~18 added
apps/mobile/src/theme/index.ts                            |  1 +
```

Total: ~12 files touched, ~270 net lines added, ~8 commits.
