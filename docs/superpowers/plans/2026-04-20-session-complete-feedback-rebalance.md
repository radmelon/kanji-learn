# Session-Complete Feedback Rebalance + dailyGoal Race Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recalibrate the Session Complete screen so all-Good sessions (67%) read as a healthy success instead of amber-star "Decent effort — review the misses"; and fix the `dailyGoal` race condition in `study.tsx` that surfaces 20-card sessions when `profile` is unresolved on mount.

**Architecture:** Two mobile-only changes bundled for the same B125 EAS build. Change 1 extracts `motivationalMessage` to a pure module for isolation + testability, then re-tunes the colour/icon thresholds in `SessionComplete.tsx` (≥80/≥60 → ≥60/≥35) and swaps in new copy. Change 2 gates the queue-load effect on `profile` being defined so `dailyGoal` isn't read as its `20` fallback. Weight formula and "confidence" label stay unchanged.

**Tech Stack:** TypeScript, React Native (Expo), Zustand, Jest (ts-jest preset, `testMatch: test/**/*.test.ts`).

**Spec reference:** [docs/superpowers/specs/2026-04-20-session-complete-feedback-rebalance-design.md](../specs/2026-04-20-session-complete-feedback-rebalance-design.md)

---

## File Structure

```
apps/mobile/src/components/study/SessionComplete.messaging.ts   ← NEW (pure helper)
apps/mobile/test/unit/SessionComplete.messaging.test.ts         ← NEW (unit tests)
apps/mobile/src/components/study/SessionComplete.tsx            ← MODIFY (thresholds + import)
apps/mobile/app/(tabs)/study.tsx                                ← MODIFY (effect dep array)
BUGS.md                                                          ← MODIFY (log race-condition fix)
ENHANCEMENTS.md                                                  ← MODIFY (log rebalance shipped)
```

---

## Task 1: Extract `motivationalMessage` with new bands (TDD)

**Files:**
- Create: `apps/mobile/src/components/study/SessionComplete.messaging.ts`
- Create: `apps/mobile/test/unit/SessionComplete.messaging.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/test/unit/SessionComplete.messaging.test.ts`:

```ts
import { motivationalMessage } from '../../src/components/study/SessionComplete.messaging'

describe('motivationalMessage', () => {
  it('returns the burned override when burned > 0', () => {
    expect(motivationalMessage(67, 3)).toBe('🔥 3 kanji burned — locked into long-term memory!')
  })

  it('returns the perfect message for accuracy === 100', () => {
    expect(motivationalMessage(100, 0)).toBe('Perfect — effortless recall.')
  })

  it('returns the strong message for accuracy >= 85', () => {
    expect(motivationalMessage(90, 0)).toBe('Strong — most of these felt easy.')
    expect(motivationalMessage(85, 0)).toBe('Strong — most of these felt easy.')
  })

  it('returns the solid message for accuracy >= 60 (includes all-Good 67%)', () => {
    expect(motivationalMessage(67, 0)).toBe('Solid — consistent recall.')
    expect(motivationalMessage(60, 0)).toBe('Solid — consistent recall.')
    expect(motivationalMessage(84, 0)).toBe('Solid — consistent recall.')
  })

  it('returns the mixed message for accuracy in [35, 60)', () => {
    expect(motivationalMessage(59, 0)).toBe('Mixed — some cards still need work.')
    expect(motivationalMessage(35, 0)).toBe('Mixed — some cards still need work.')
  })

  it('returns the rough-patch message for accuracy < 35', () => {
    expect(motivationalMessage(34, 0)).toBe('Rough patch — come back tomorrow.')
    expect(motivationalMessage(0, 0)).toBe('Rough patch — come back tomorrow.')
  })
})
```

- [ ] **Step 2: Run the test — confirm it fails**

Run from repo root:
```
cd apps/mobile && pnpm exec jest SessionComplete.messaging
```

Expected: FAIL with "Cannot find module '../../src/components/study/SessionComplete.messaging'".

- [ ] **Step 3: Create the pure module**

Create `apps/mobile/src/components/study/SessionComplete.messaging.ts`:

```ts
/**
 * SessionComplete.messaging.ts
 *
 * Pure message-bucket function for the Session Complete screen. Extracted
 * from SessionComplete.tsx so it can be unit-tested without the full
 * React Native render path.
 *
 * Bands reflect an "ease-of-recall" framing: the weighted confidence
 * score (Easy=3, Good=2, Hard=1, Again=0, normalised by count × 3)
 * represents how effortful recall felt, not whether the card was
 * answered. All-Good sessions land at 67%, which is a healthy
 * consistent-recall outcome — the copy should reinforce that.
 */

export function motivationalMessage(accuracy: number, burned: number): string {
  if (burned > 0) return `🔥 ${burned} kanji burned — locked into long-term memory!`
  if (accuracy === 100) return 'Perfect — effortless recall.'
  if (accuracy >= 85) return 'Strong — most of these felt easy.'
  if (accuracy >= 60) return 'Solid — consistent recall.'
  if (accuracy >= 35) return 'Mixed — some cards still need work.'
  return 'Rough patch — come back tomorrow.'
}
```

- [ ] **Step 4: Run the test — confirm it passes**

Run:
```
cd apps/mobile && pnpm exec jest SessionComplete.messaging
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components/study/SessionComplete.messaging.ts apps/mobile/test/unit/SessionComplete.messaging.test.ts
git commit -m "feat(mobile): extract motivationalMessage with ease-of-recall bands"
```

---

## Task 2: Update `SessionComplete.tsx` thresholds + import

**Files:**
- Modify: `apps/mobile/src/components/study/SessionComplete.tsx`

- [ ] **Step 1: Replace the inline `motivationalMessage` function and colour/icon thresholds**

Open `apps/mobile/src/components/study/SessionComplete.tsx`. Delete the inline `motivationalMessage` function (lines 26–34 in the current file) and add an import. The current code block is:

```ts
function motivationalMessage(accuracy: number, burned: number): string {
  if (burned > 0) return `🔥 ${burned} kanji burned — locked into long-term memory!`
  if (accuracy === 100) return 'Perfect session — flawless execution!'
  if (accuracy >= 90) return 'Outstanding! Near-perfect recall.'
  if (accuracy >= 80) return 'Great work — solid retention.'
  if (accuracy >= 70) return 'Good session — keep the streak going.'
  if (accuracy >= 60) return 'Decent effort — review the misses.'
  return 'Tough session — come back tomorrow and you\'ll improve.'
}
```

Remove it. Add this import near the top of the file (alongside the other imports):

```ts
import { motivationalMessage } from './SessionComplete.messaging'
```

- [ ] **Step 2: Update the colour threshold**

Find the line (currently line 39):

```ts
  const accColor = accuracy >= 80 ? colors.success : accuracy >= 60 ? colors.warning : colors.error
```

Replace with:

```ts
  const accColor = accuracy >= 60 ? colors.success : accuracy >= 35 ? colors.warning : colors.error
```

- [ ] **Step 3: Update the icon-name threshold**

Find the Ionicons name ternary inside the `<View style={styles.hero}>` block (currently line 47):

```ts
            name={accuracy >= 80 ? 'checkmark-circle' : accuracy >= 60 ? 'star' : 'refresh-circle'}
```

Replace with:

```ts
            name={accuracy >= 60 ? 'checkmark-circle' : accuracy >= 35 ? 'star' : 'refresh-circle'}
```

- [ ] **Step 4: Typecheck the mobile app**

Run:
```
cd apps/mobile && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 5: Re-run messaging tests to confirm nothing regressed**

Run:
```
cd apps/mobile && pnpm exec jest SessionComplete.messaging
```

Expected: PASS (6 tests — same output as Task 1 Step 4).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/study/SessionComplete.tsx
git commit -m "feat(mobile): rebalance Session Complete colour/icon bands to ≥60/≥35"
```

---

## Task 3: Fix `study.tsx` dailyGoal race condition

**Files:**
- Modify: `apps/mobile/app/(tabs)/study.tsx`

- [ ] **Step 1: Update the queue-load effect to wait for `profile`**

Open `apps/mobile/app/(tabs)/study.tsx`. Find the effect block (currently lines 165–173):

```ts
  useEffect(() => {
    syncPendingSessions()
    // Skip loadQueue when arriving from "Drill Weak Spots" — the weak queue
    // was already loaded by loadWeakQueue() before navigation and must not be overwritten.
    if (!useReviewStore.getState().isWeakDrill) {
      loadQueue(dailyGoal)
    }
    return () => reset()
  }, [])
```

Replace with:

```ts
  useEffect(() => {
    // Wait for profile to resolve so `dailyGoal` isn't read as its 20
    // fallback during the first render. Without this guard, a backgrounded
    // app whose profile cache was evicted loads a 20-card queue for users
    // whose actual dailyGoal is smaller.
    if (!profile) return
    syncPendingSessions()
    // Skip loadQueue when arriving from "Drill Weak Spots" — the weak queue
    // was already loaded by loadWeakQueue() before navigation and must not be overwritten.
    if (!useReviewStore.getState().isWeakDrill) {
      loadQueue(dailyGoal)
    }
    return () => reset()
  }, [profile])
```

- [ ] **Step 2: Typecheck**

Run:
```
cd apps/mobile && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/\(tabs\)/study.tsx
git commit -m "fix(mobile): gate study-queue load on profile to prevent 20-card race"
```

---

## Task 4: Update BUGS.md + ENHANCEMENTS.md trackers

**Files:**
- Modify: `BUGS.md`
- Modify: `ENHANCEMENTS.md`

- [ ] **Step 1: Add a new bug entry for the race condition in BUGS.md**

Open `BUGS.md`. After the entry at line 98 (the previous dailyGoal-hardcoded-to-20 entry, already marked Fixed in B123), add a new entry immediately below it:

```markdown
- [x] **Study queue re-surfaces 20 cards after a profile cache eviction** — ~~FIXED~~ 2026-04-20 (Build 3-C session). Distinct from the B123 fix: the root cause here was the `useEffect(..., [])` at `study.tsx:165` firing on mount before `useProfile()` resolved, causing `dailyGoal` to read as its `20` fallback. Reproduces when the app is backgrounded for 1–2 hours (iOS reclaims profile cache) and the user taps Start Today's Reviews cold. Fix gates the effect on `profile` and depends on `[profile]` so it re-fires once the profile hydrates. Ships in B125.

  `[Effort: XS]` `[Impact: Med]` `[Status: ✅ Fixed]`
```

- [ ] **Step 2: Add a shipped-enhancement entry for the Session Complete rebalance in ENHANCEMENTS.md**

Open `ENHANCEMENTS.md`. Locate an appropriate insertion point near other recently-shipped mobile UX entries (e.g., next to the B124 Session Complete counts / speak-icons entries — grep for "Remembered/Missed" or "SessionComplete" to find the neighbourhood). Add:

```markdown
- [x] **Session Complete "confidence" copy + colour bands recalibrated** — ~~SHIPPED~~ 2026-04-20 (Build 3-C session). Threshold bands shifted from ≥80 / ≥60 to ≥60 / ≥35 so all-Good sessions (67%) now render with the green checkmark + "Solid — consistent recall." copy instead of amber-star "Decent effort — review the misses" (which leaked failure framing when there were zero misses). Weight table unchanged; "confidence" label unchanged. `motivationalMessage` extracted to `SessionComplete.messaging.ts` so the band logic is unit-tested independently of the React render path. Ships in B125.

  `[Effort: XS]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped]`
```

- [ ] **Step 3: Commit tracker updates**

```bash
git add BUGS.md ENHANCEMENTS.md
git commit -m "docs: log Session Complete rebalance + dailyGoal race fix in trackers"
```

---

## Self-review summary

- **Spec coverage:** Every section of the spec maps to a task. Thresholds (Task 2 Steps 2–3), copy rewrite (Task 1), dailyGoal race (Task 3), unit tests (Task 1), tracker hygiene (Task 4). No spec requirement is unaddressed.
- **Placeholder scan:** No TBD / TODO / "similar to Task N" / "add error handling" phrases. Every code block is concrete.
- **Type consistency:** `motivationalMessage(accuracy: number, burned: number): string` is used identically in the test (Task 1 Step 1), the implementation (Task 1 Step 3), and the import site (Task 2 Step 1). The `profile` identifier used in Task 3 is already in scope at [`study.tsx:50`](../../apps/mobile/app/(tabs)/study.tsx:50) via `const { profile } = useProfile()`, so no new declaration is needed.
- **No EAS build in this plan:** bundling with B125 (Phase 4) is explicit in the spec. Do not cut a dedicated build here.

---

## Execution Handoff

Plan complete and saved to [docs/superpowers/plans/2026-04-20-session-complete-feedback-rebalance.md](2026-04-20-session-complete-feedback-rebalance.md). Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks. Small plan; overhead isn't worth it here.
2. **Inline Execution (recommended for this small plan)** — Execute tasks in this session using executing-plans, batch through the four tasks with a single checkpoint after Task 2 (Change 1 complete).

Which approach?
