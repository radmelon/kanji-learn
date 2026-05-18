# Minutes-Based Study Goal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the card-count daily goal with a minutes budget, and make the study session end on a timer instead of a fixed card count.

**Architecture:** The `daily_goal` profile field is reinterpreted from a card count to a minutes value — the name is unit-agnostic so no column rename is needed. The review store gains a `goalMinutes` and ends the session when elapsed time crosses the budget *after the current card is graded* (never a mid-card cut). The UI surfaces — onboarding, profile, SessionComplete, dashboard — shift to a minutes framing. `cards-reviewed` remains a tracked stat, so analytics are unaffected in unit.

**Tech Stack:** React Native / Expo (TypeScript), Zustand, Drizzle ORM + Supabase Postgres, Jest.

**Plan context:** This is **Plan A of three** implementing the Three-Modality Practice Loop spec (`docs/superpowers/specs/2026-05-17-practice-loop-design.md`). Plan A ships independently — the app works, the goal is minutes, the session is a time-boxed flashcard session. Plan B adds the writing/speaking loop legs and the nav restructure; Plan C adds the quiz leg and Browse tab.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0023_daily_goal_minutes.sql` | Create | Reinterpret `daily_goal` as minutes — new default, reset existing rows |
| `packages/db/src/schema.ts` | Modify | `daily_goal` Drizzle default 20 → 15 |
| `apps/mobile/src/config/onboarding-content.ts` | Modify | `dailyTarget` copy + options become minutes |
| `apps/mobile/app/(tabs)/profile.tsx` | Modify | Daily-goal editor: minutes options + label |
| `apps/mobile/src/stores/review.store.ts` | Modify | `goalMinutes` state; session ends on the timer |
| `apps/mobile/src/components/study/SessionComplete.messaging.ts` | Modify | `didCrossGoal` → `didMeetTimeGoal` |
| `apps/mobile/test/unit/SessionComplete.messaging.test.ts` | Modify | Tests for `didMeetTimeGoal` |
| `apps/mobile/src/components/study/SessionComplete.tsx` | Modify | Minutes-based goal banner; drop `reviewedBefore` |
| `apps/mobile/app/(tabs)/study.tsx` | Modify | Drop `reviewedBefore` plumbing; time-remaining indicator; `?? 15` fallback |
| `apps/mobile/app/(tabs)/index.tsx` | Modify | Dashboard: drop the cards-vs-goal fraction |

**Out of scope (deferred):**
- **Watch label.** The Apple Watch shows `daily_goal` from its cached payload; the payload is a bare number and is structurally unchanged, so the Watch keeps working. Updating the Watch's *label* to read "min" is a one-line SwiftUI tweak that requires a manual Xcode build (EAS does not build the watchOS target) — fold it into the next Watch rebuild; it is not a Plan A task.
- **Notification copy** talks about cards *due* / *reviewed* (still valid counts) and needs no change.
- **Queue priority / guaranteed new-kanji allowance.** Spec §3 calls for a guaranteed minimum of new kanji per session so progress never stalls. Plan A relies on the existing `getReviewQueue` ordering (due-first, then new cards fill the remaining slots up to the limit of 50). The explicit guaranteed-new-kanji allowance and the loop's full priority ordering are **Plan B** (loop mechanics) — at the current pre-launch scale the due pile is well under 50, so new cards already get slots.

---

## Task 1: DB migration — `daily_goal` becomes minutes

**Files:**
- Create: `packages/db/supabase/migrations/0023_daily_goal_minutes.sql`
- Modify: `packages/db/src/schema.ts:146`

- [ ] **Step 1: Write the migration SQL**

Create `packages/db/supabase/migrations/0023_daily_goal_minutes.sql`:

```sql
-- 0023_daily_goal_minutes.sql
-- The daily study goal is changing from a card count to a minutes budget.
-- The column name `daily_goal` is unit-agnostic, so it is reused as-is.
-- New default: 15 minutes. Existing rows (pre-launch testers) held card
-- counts (e.g. 20, 50) that would be absurd as minutes, so they are reset
-- to the new default; testers re-pick in Profile.

ALTER TABLE user_profiles ALTER COLUMN daily_goal SET DEFAULT 15;

UPDATE user_profiles SET daily_goal = 15;

COMMENT ON COLUMN user_profiles.daily_goal IS 'Daily study goal, in minutes (was a card count before migration 0023).';
```

- [ ] **Step 2: Update the Drizzle schema default**

In `packages/db/src/schema.ts`, line 146 — change the default:

```ts
  dailyGoal: smallint('daily_goal').notNull().default(15),
```

- [ ] **Step 3: Apply the migration**

Apply `0023_daily_goal_minutes.sql` to the database the same way migrations `0001`–`0022` were applied (the project's standard Supabase migration workflow).

- [ ] **Step 4: Verify**

Run against the database:
```sql
SELECT column_default FROM information_schema.columns
WHERE table_name = 'user_profiles' AND column_name = 'daily_goal';
SELECT id, daily_goal FROM user_profiles;
```
Expected: `column_default` is `15`; every `daily_goal` value is `15`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/supabase/migrations/0023_daily_goal_minutes.sql packages/db/src/schema.ts
git commit -m "$(cat <<'EOF'
feat(db): reinterpret daily_goal as minutes (migration 0023)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 2: Onboarding content — minutes copy and options

**Files:**
- Modify: `apps/mobile/src/config/onboarding-content.ts:79-85`

The onboarding daily-target step is data-driven — `apps/mobile/app/onboarding.tsx` reads `ONBOARDING_CONTENT.dailyTarget.options` and `.defaultOption` and `.headline`. Changing the config updates the screen; no `onboarding.tsx` edit is needed.

- [ ] **Step 1: Rewrite the `dailyTarget` config block**

In `apps/mobile/src/config/onboarding-content.ts`, replace the `dailyTarget` block (lines 79-85):

```ts
  dailyTarget: {
    headline: 'How many minutes per day?',
    options: [5, 10, 15, 20, 30] as number[],
    defaultOption: 15,
    cta: "Let's go",
    saveError: 'Something went wrong. Please try again.',
  },
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/config/onboarding-content.ts
git commit -m "$(cat <<'EOF'
feat(mobile): onboarding daily target asks for minutes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 3: Profile — daily-goal editor uses minutes

**Files:**
- Modify: `apps/mobile/app/(tabs)/profile.tsx:40` (options), `:56` (default state), `:400` (section label)

`profile.tsx` already imports `ONBOARDING_CONTENT` (line 19) — reuse its options so onboarding and profile never drift.

- [ ] **Step 1: Replace the hardcoded `GOAL_OPTIONS`**

In `apps/mobile/app/(tabs)/profile.tsx`, replace line 40:

```ts
const GOAL_OPTIONS = ONBOARDING_CONTENT.dailyTarget.options
```

- [ ] **Step 2: Update the default state value**

Line 56 — change the fallback from `20` to `15`:

```ts
  const [dailyGoal, setDailyGoal] = useState(15)
```

- [ ] **Step 3: Update the section label**

Line 400 — change the `Section` subtitle:

```tsx
        <Section title="Daily Review Goal" subtitle="Minutes per day">
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: no errors. (`GOAL_OPTIONS` is now `number[]` instead of a readonly tuple; it is only consumed by `.map`, so this is compatible.)

- [ ] **Step 5: Commit**

```bash
git add "apps/mobile/app/(tabs)/profile.tsx"
git commit -m "$(cat <<'EOF'
feat(mobile): profile daily-goal editor uses minutes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 4: Review store — time-boxed session

**Files:**
- Modify: `apps/mobile/src/stores/review.store.ts`

The session must end when the minutes budget elapses. The check runs inside `submitResult` (after each grade) so the session always finishes the current card cleanly — never a mid-card cut. Weak-drill and missed-drill mini-sessions stay count-bounded (they set `goalMinutes: 0`, which disables the time check).

- [ ] **Step 1: Add the session-size constant**

In `apps/mobile/src/stores/review.store.ts`, after line 14 (`const PENDING_MAX_AGE_MS = ...`), add:

```ts
// A time-boxed session loads a generous fixed queue and stops on the timer,
// not on a card count. 50 is the API's queue cap (GET /v1/review/queue).
const SESSION_QUEUE_SIZE = 50
```

- [ ] **Step 2: Add `goalMinutes` to the store interface**

In the `ReviewState` interface, add the field after `isWeakDrill` (line 52) and change the `loadQueue` signature:

```ts
  /** True when the current queue was loaded via loadWeakQueue — study.tsx skips its normal loadQueue() call */
  isWeakDrill: boolean
  /** Minutes budget for the current session; 0 = count-bounded (weak/missed drills) */
  goalMinutes: number

  loadQueue: (goalMinutes: number) => Promise<void>
```

- [ ] **Step 3: Initialise `goalMinutes` in the store body**

In the `create<ReviewState>` initial state, after `isWeakDrill: false,` (line 77):

```ts
  isWeakDrill: false,
  goalMinutes: 0,
```

- [ ] **Step 4: Update `loadQueue` to take minutes and request the fixed queue**

Replace the `loadQueue` signature and its first `set` + the queue fetch (lines 79-87):

```ts
  loadQueue: async (goalMinutes) => {
    set({ isLoading: true, isComplete: false, currentIndex: 0, results: [], error: null, isOfflineQueue: false, isWeakDrill: false, goalMinutes })

    // Check for pending sessions immediately (fire-and-forget)
    const pending = await storage.getItem<PendingSession[]>(KEY_PENDING)
    if (pending && pending.length > 0) set({ hasPendingSessions: true })

    try {
      const queue = await api.get<ReviewQueueItem[]>(`/v1/review/queue?limit=${SESSION_QUEUE_SIZE}`)
```

(The rest of `loadQueue` — caching, resume logic, the `catch`/`finally` — is unchanged.)

- [ ] **Step 5: End the session when the budget elapses, inside `submitResult`**

Replace `submitResult` (lines 150-163):

```ts
  submitResult: (result) => {
    const { results, currentIndex, queue, studyStartMs, goalMinutes } = get()
    const newResults = [...results, result]
    const nextIndex = currentIndex + 1

    // The session ends when the queue is exhausted OR — for a time-boxed
    // session (goalMinutes > 0) — when the minutes budget has elapsed. The
    // check runs after the grade, so the current card is always finished.
    const overBudget =
      goalMinutes > 0 && Date.now() - studyStartMs >= goalMinutes * 60_000

    set({
      results: newResults,
      currentIndex: nextIndex,
      isComplete: nextIndex >= queue.length || overBudget,
    })

    // Persist progress so it survives app restarts
    storage.setItem(KEY_PROGRESS, { userId: 'current', results: newResults, studyStartMs })
  },
```

- [ ] **Step 6: Keep weak/missed drills count-bounded**

In `loadWeakQueue`, add `goalMinutes: 0` to the `set` on line 140:

```ts
      set({ queue, studyStartMs: now, currentIndex: 0, results: [], isWeakDrill: true, goalMinutes: 0 })
```

In `loadMissedQueue`, add `goalMinutes: 0` to the `set` on line 266:

```ts
    set({ queue: missedCards, currentIndex: 0, results: [], isComplete: false, studyStartMs: Date.now(), error: null, goalMinutes: 0 })
```

In `reset`, add `goalMinutes: 0` to the `set` on line 272:

```ts
    set({ queue: [], currentIndex: 0, results: [], isComplete: false, studyStartMs: 0, isOfflineQueue: false, isWeakDrill: false, goalMinutes: 0 })
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: one error in `study.tsx` — `loadQueue(dailyGoal)` still type-checks (number → number), so actually expect **no errors**. If `typecheck` reports an unrelated `loadQueue` arity error, it is fixed in Task 7.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/stores/review.store.ts
git commit -m "$(cat <<'EOF'
feat(mobile): time-box the study session on a minutes budget

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 5: `didMeetTimeGoal` — replace the card-count goal check (TDD)

**Files:**
- Modify: `apps/mobile/src/components/study/SessionComplete.messaging.ts`
- Test: `apps/mobile/test/unit/SessionComplete.messaging.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/mobile/test/unit/SessionComplete.messaging.test.ts`, replace any `didCrossGoal` import and `describe` block with a `didMeetTimeGoal` suite:

```ts
import { didMeetTimeGoal } from '../../src/components/study/SessionComplete.messaging'

describe('didMeetTimeGoal', () => {
  it('is true when study time reaches the goal', () => {
    expect(didMeetTimeGoal(15 * 60_000, 15)).toBe(true)
  })
  it('is true when study time exceeds the goal', () => {
    expect(didMeetTimeGoal(20 * 60_000, 15)).toBe(true)
  })
  it('is false when study time is under the goal', () => {
    expect(didMeetTimeGoal(10 * 60_000, 15)).toBe(false)
  })
  it('is false for a zero-length session', () => {
    expect(didMeetTimeGoal(0, 15)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kanji-learn/mobile test SessionComplete.messaging`
Expected: FAIL — `didMeetTimeGoal` is not exported.

- [ ] **Step 3: Implement `didMeetTimeGoal`**

In `apps/mobile/src/components/study/SessionComplete.messaging.ts`, replace the `didCrossGoal` function (lines 24-39) with:

```ts
/**
 * True when this session reached the learner's daily minutes goal. Used by
 * SessionComplete to decide whether to render the 🎉 celebration banner.
 *
 * @param studyTimeMs  duration of the session just completed, in milliseconds
 * @param goalMinutes  the learner's configured target from user_profiles.daily_goal
 */
export function didMeetTimeGoal(studyTimeMs: number, goalMinutes: number): boolean {
  return studyTimeMs >= goalMinutes * 60_000
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @kanji-learn/mobile test SessionComplete.messaging`
Expected: PASS — all four cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/study/SessionComplete.messaging.ts apps/mobile/test/unit/SessionComplete.messaging.test.ts
git commit -m "$(cat <<'EOF'
feat(mobile): didMeetTimeGoal replaces the card-count goal check

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 6: SessionComplete + study.tsx — wire the minutes goal banner

**Files:**
- Modify: `apps/mobile/src/components/study/SessionComplete.tsx`
- Modify: `apps/mobile/app/(tabs)/study.tsx`

`SessionComplete` no longer needs `reviewedBefore` (the card-count goal-crossing input). Removing it also lets `study.tsx` drop the `analyticsSummaryRef` plumbing that only fed it.

- [ ] **Step 1: Update the `SessionComplete` import**

`SessionComplete.tsx` line 5:

```ts
import { motivationalMessage, didMeetTimeGoal } from './SessionComplete.messaging'
```

- [ ] **Step 2: Drop `reviewedBefore` from the `Props` interface**

`SessionComplete.tsx` — replace the `Props` interface (lines 7-20):

```ts
interface Props {
  totalItems: number
  correctItems: number
  confidencePct: number
  newLearned: number
  burned: number
  studyTimeMs: number
  onDone: () => void
  onReview: () => void
  /** user_profiles.daily_goal — the learner's daily minutes target */
  dailyGoal: number
}
```

- [ ] **Step 3: Update the component signature and the banner check**

`SessionComplete.tsx` — replace the function signature (line 31) and the `showGoalBanner` line (line 35):

```ts
export function SessionComplete({ totalItems, correctItems, confidencePct, newLearned, burned, studyTimeMs, onDone, onReview, dailyGoal }: Props) {
  const accuracy = confidencePct
  const wrong = totalItems - correctItems
  const accColor = accuracy >= 60 ? colors.success : accuracy >= 35 ? colors.warning : colors.error
  const showGoalBanner = burned === 0 && didMeetTimeGoal(studyTimeMs, dailyGoal)
```

- [ ] **Step 4: Remove the `reviewedBefore` plumbing from study.tsx**

`reviewedBefore` existed only to feed the old card-count goal banner. Remove every piece of it in `apps/mobile/app/(tabs)/study.tsx`:

1. Delete the import line: `import { useAnalytics } from '../../src/hooks/useAnalytics'`
2. Delete the hook call line: `const { summary: analyticsSummary } = useAnalytics()`
3. In the `sessionSummary` state type, delete `reviewedBefore: number;` — the `useState` generic becomes:
   ```ts
   const [sessionSummary, setSessionSummary] = useState<{
     totalItems: number; correctItems: number; confidencePct: number; newLearned: number; burned: number; studyTimeMs: number
     dailyGoal: number
   } | null>(null)
   ```
4. Delete the `analyticsSummaryRef` ref and its sync effect:
   ```ts
   const analyticsSummaryRef = useRef(analyticsSummary)
   useEffect(() => { analyticsSummaryRef.current = analyticsSummary }, [analyticsSummary])
   ```
   (Delete the explanatory comment block directly above it too.)
5. In `handleFinish`, delete the two lines that compute `reviewedBefore`:
   ```ts
   const today = new Date().toISOString().slice(0, 10)
   const reviewedBefore = analyticsSummaryRef.current?.recentStats.find((r) => r.date === today)?.reviewed ?? 0
   ```
6. In the success-path `setSessionSummary({ ... })` object, delete the `reviewedBefore,` line.
7. In the `catch`-path `setSessionSummary({ ... })` object, delete the `reviewedBefore: 0,` line.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: no errors. (`SessionComplete` is rendered with `{...sessionSummary}`; once `reviewedBefore` is gone from both the state type and the props, they match.)

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/study/SessionComplete.tsx "apps/mobile/app/(tabs)/study.tsx"
git commit -m "$(cat <<'EOF'
feat(mobile): SessionComplete celebrates the minutes goal

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 7: study.tsx — minutes fallback and a time-remaining indicator

**Files:**
- Modify: `apps/mobile/app/(tabs)/study.tsx`

- [ ] **Step 1: Update the `dailyGoal` fallback**

`study.tsx` line 52 — the fallback used until the profile loads:

```ts
  const dailyGoal = profile?.dailyGoal ?? 15
```

(The `loadQueue(dailyGoal)` call sites — the load effect and the error-state "Retry" button — are unchanged; `dailyGoal` is now minutes and `loadQueue` consumes it as `goalMinutes`.)

- [ ] **Step 2: Add time-remaining state driven by a 1s tick**

In `StudySession`, read `studyStartMs` and `goalMinutes` from the store (extend the existing `useReviewStore()` destructure to include them), and add below the other `useState` hooks:

```ts
  const { studyStartMs, goalMinutes } = useReviewStore()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const minutesLeft =
    goalMinutes > 0 && studyStartMs > 0
      ? Math.max(0, Math.ceil((goalMinutes * 60_000 - (now - studyStartMs)) / 60_000))
      : null
```

- [ ] **Step 3: Render the indicator in the session header**

In the main review UI header (the `View` with `styles.header` containing the progress track and `counter`), add — after the `counter` `Text` — a quiet time-remaining label:

```tsx
        {minutesLeft !== null && (
          <Text style={styles.timeLeft}>{minutesLeft}m left</Text>
        )}
```

Add the style to the `styles` `StyleSheet.create` block:

```ts
  timeLeft: { ...typography.caption, color: colors.textMuted, minWidth: 48, textAlign: 'right' },
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/mobile/app/(tabs)/study.tsx"
git commit -m "$(cat <<'EOF'
feat(mobile): show time remaining in the study session header

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 8: Dashboard — drop the cards-vs-goal fraction

**Files:**
- Modify: `apps/mobile/app/(tabs)/index.tsx`

The dashboard's daily-progress widget shows `{reviewedToday} / {dailyGoal} today`. With `dailyGoal` now in minutes, a "12 / 15" reading (cards vs minutes) is incoherent. The widget becomes a plain count of today's reviews; the minutes goal is enforced in the session and celebrated in SessionComplete.

- [ ] **Step 1: Remove the now-unused `dailyGoal`**

`index.tsx` — delete line 186:

```ts
  const dailyGoal = profile?.dailyGoal ?? 20
```

- [ ] **Step 2: Replace the progress widget**

`index.tsx` — replace the daily-progress block (lines 286-294):

```tsx
        {/* Today's review count — informational, no goal comparison */}
        <View style={styles.progressRow}>
          <Text style={styles.progressText}>
            {reviewedToday} reviewed today
          </Text>
        </View>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: no errors. (`profile` is still used for `displayName`, so the `useProfile` import stays.)

- [ ] **Step 4: Commit**

```bash
git add "apps/mobile/app/(tabs)/index.tsx"
git commit -m "$(cat <<'EOF'
feat(mobile): dashboard shows today's review count, not a card goal

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 9: "Keep studying" — continue past the budget

**Files:**
- Modify: `apps/mobile/src/components/study/SessionComplete.tsx`
- Modify: `apps/mobile/app/(tabs)/study.tsx`

Spec §3: after a time-boxed session ends, the learner may continue past the target — the goal is already met, so this is clearly-optional extra effort. Add a "Keep studying" action to Session Complete that starts a fresh time-boxed segment.

- [ ] **Step 1: Add the `onKeepStudying` prop**

`SessionComplete.tsx` — add to the `Props` interface, after `onReview`:

```ts
  onReview: () => void
  /** Start another time-boxed session segment past the daily goal */
  onKeepStudying: () => void
```

Add it to the component's destructured parameters (the `export function SessionComplete({ ... })` line):

```ts
export function SessionComplete({ totalItems, correctItems, confidencePct, newLearned, burned, studyTimeMs, onDone, onReview, onKeepStudying, dailyGoal }: Props) {
```

- [ ] **Step 2: Render the "Keep studying" button**

`SessionComplete.tsx` — in the `{/* Actions */}` block, add the button after the "Back to Dashboard" `TouchableOpacity` and before the `{wrong > 0 && ...}` block:

```tsx
          <TouchableOpacity style={styles.reviewButton} onPress={onKeepStudying} activeOpacity={0.85}>
            <Ionicons name="play-forward" size={16} color={colors.textSecondary} />
            <Text style={styles.reviewText}>Keep studying</Text>
          </TouchableOpacity>
```

- [ ] **Step 3: Wire the handler in study.tsx**

`apps/mobile/app/(tabs)/study.tsx` — in the `<SessionComplete ... />` render, add the `onKeepStudying` prop alongside `onDone` / `onReview`:

```tsx
        onKeepStudying={() => {
          setSessionSummary(null)
          setIsRevealed(false)
          isRevealedRef.current = false
          swipeX.setValue(0)
          loadQueue(dailyGoal)
        }}
```

(`loadQueue` reloads a fresh time-boxed queue and resets `studyStartMs`, so the timer restarts; `setSessionSummary(null)` unmounts the Session Complete screen so the loop renders again.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/study/SessionComplete.tsx "apps/mobile/app/(tabs)/study.tsx"
git commit -m "$(cat <<'EOF'
feat(mobile): add "Keep studying" to continue past the daily goal

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Final verification

- [ ] **Typecheck both packages**

```bash
pnpm --filter @kanji-learn/mobile typecheck
pnpm --filter @kanji-learn/api typecheck
```
Expected: no new errors. (`apps/api` has one pre-existing unrelated error in `test/integration/social-mute.test.ts` — not introduced here.)

- [ ] **Run the mobile test suite**

```bash
pnpm --filter @kanji-learn/mobile test
```
Expected: all green, including the new `didMeetTimeGoal` cases.

- [ ] **On-device walkthrough** (in the next EAS build, or a local dev client)
  - Onboarding's daily-target step offers 5/10/15/20/30 and says "minutes".
  - Profile's "Daily Review Goal" shows "Minutes per day" with the same options; selecting one saves.
  - Set the goal to 5 minutes; start a Study session; confirm the header shows "Nm left" counting down; confirm the session ends (Session Complete appears) after the budget elapses — *after* finishing the card in progress, not mid-card.
  - Confirm Session Complete shows the 🎉 banner when the budget was met.
  - Confirm "Keep studying" on Session Complete starts a fresh timed segment.
  - Confirm the Dashboard shows "N reviewed today" with no goal fraction.

---

## Notes for the executor

- **Order matters:** Task 4 changes `loadQueue`'s signature; Task 7 reads the new `goalMinutes` store field. Do the tasks in order.
- **No new tables.** Task 1 only changes a column default and resets pre-launch test data.
- **The Apple Watch** keeps working unchanged (the payload is a bare number). Its on-screen "daily goal" label still reads as a count until a manual Xcode rebuild updates the SwiftUI string to "min" — bundle that into the next Watch build; it is not blocking.
- **Plan B** (the loop legs + nav restructure) builds on the time-boxed session this plan establishes.
