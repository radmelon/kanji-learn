# Session-Complete Feedback Rebalance + dailyGoal Race Fix — Design

**Date:** 2026-04-20
**Scope:** Two small mobile-only changes bundled for the same B125 EAS build as Build 3-C Phase 4.
**Status:** Design approved. Awaiting implementation plan.

---

## Problem

### Problem 1 — Amber "67% confidence" for all-Good sessions feels like failure

After a study session where every card is graded **Good** via the tap buttons, the Session Complete screen renders:

- **67%** confidence score (correct per the weight formula: `Good=2`, normalised by `count × 3`).
- **Amber/warning** colour + **star** icon (because 67 lands in the `≥60 && <80` band).
- Copy: *"Decent effort — review the misses"* — actively misleading when there are **zero** misses.

The number itself is defensible under an **ease-of-recall** framing (option B in the brainstorming discussion): all-Good means "you remembered every card, but it took deliberate effort." That's a valid signal worth preserving. The failure is in the **visual + copy treatment**, which currently frames 67% as mediocre.

Weight formula stays unchanged: `Easy=3, Good=2, Hard=1, Again=0`, normalised to `0–100` by dividing by `count × 3`.

### Problem 2 — dailyGoal race condition produces 20-card sessions when profile=5

Observed on 2026-04-20 after a 1–2 hour app-background gap: the second study session of the day surfaced **20 cards** despite `profile.dailyGoal = 5`.

Root cause in [`apps/mobile/app/(tabs)/study.tsx`](../../../apps/mobile/app/(tabs)/study.tsx):

```ts
const dailyGoal = profile?.dailyGoal ?? 20

useEffect(() => {
  syncPendingSessions()
  if (!useReviewStore.getState().isWeakDrill) {
    loadQueue(dailyGoal)     // fires with stale dailyGoal=20 when profile unresolved
  }
  return () => reset()
}, [])                        // empty deps — effect never re-runs
```

When iOS reclaims app state between sessions, the `useProfile()` hook returns `undefined` during the first render. The effect fires once with `dailyGoal = 20` (the fallback) and never re-runs because its dependency array is empty.

---

## Design

### Change 1 — SessionComplete.tsx threshold + copy rebalance

**File:** `apps/mobile/src/components/study/SessionComplete.tsx`

**New colour/icon thresholds:**

| Range | Colour | Icon |
|---|---|---|
| `accuracy >= 60` | `colors.success` (green) | `checkmark-circle` |
| `accuracy >= 35` | `colors.warning` (amber) | `star` |
| else | `colors.error` (red) | `refresh-circle` |

**New `motivationalMessage` bands** (replace the six-band ladder currently at lines 26–34):

| Range | Copy |
|---|---|
| `accuracy === 100` | `Perfect — effortless recall.` |
| `accuracy >= 85` | `Strong — most of these felt easy.` |
| `accuracy >= 60` | `Solid — consistent recall.` |
| `accuracy >= 35` | `Mixed — some cards still need work.` |
| `<35` | `Rough patch — come back tomorrow.` |

**Retained behaviour:**

- `burned > 0` override message (`🔥 ${burned} kanji burned — locked into long-term memory!`) remains as the top-priority branch, unchanged.
- The **"confidence"** word under the percentage ring stays as-is. Per the Option-B framing, the number represents ease of recall; "confidence" is close enough to that meaning that a relabel is not worth the churn.
- `accuracy` value (= `confidencePct`) is **unchanged**; weight table is **unchanged**.

**Removed:**

- The phrase *"review the misses"* is removed entirely. Under the new bands, only `<35%` sessions genuinely require misses-review, and that case already has explicit "Rough patch" framing.

### Change 2 — study.tsx dailyGoal race fix

**File:** `apps/mobile/app/(tabs)/study.tsx`

**Replace the effect at lines 165–173:**

```ts
useEffect(() => {
  if (!profile) return   // wait for profile so dailyGoal is correct
  syncPendingSessions()
  if (!useReviewStore.getState().isWeakDrill) {
    loadQueue(dailyGoal)
  }
  return () => reset()
}, [profile])
```

**Behaviour change:** if the user changes `dailyGoal` in the Profile tab and returns to the Study tab without unmounting (tab persistence), the queue reloads with the new goal. Previously the queue was pinned to whatever `dailyGoal` was on first mount. This is a small improvement on its own.

**Edge cases considered:**

- `isWeakDrill` branch — preserved; weak-drill path loads its own queue before navigation.
- Profile-hook refetch on session focus (rare) — would re-fire the effect and reload the queue. Acceptable: user isn't mid-session at that point (tab focus transitions imply no active review card is being graded).
- Very slow profile fetch — user sees a loading state until `profile` resolves, then queue loads. Better than loading the wrong queue immediately.

---

## Testing

### Unit tests (new)

Add `apps/mobile/src/components/study/__tests__/SessionComplete.messaging.test.ts`:

- `motivationalMessage(100, 0)` → *"Perfect — effortless recall."*
- `motivationalMessage(85, 0)` → *"Strong — most of these felt easy."*
- `motivationalMessage(67, 0)` → *"Solid — consistent recall."* (the all-Good case)
- `motivationalMessage(40, 0)` → *"Mixed — some cards still need work."*
- `motivationalMessage(20, 0)` → *"Rough patch — come back tomorrow."*
- `motivationalMessage(67, 3)` → `🔥 3 kanji burned — locked into long-term memory!` (burned override beats band)

Because `motivationalMessage` is a top-level function (not exported), it needs a small refactor: export it from `SessionComplete.tsx` so the test can import it. Alternative: extract to a sibling module `SessionComplete.messaging.ts`. Plan phase picks the cleaner option.

### Manual verification (on-device, B125)

For Change 1:

1. Score one full session all-Good via tap. Confirm: green checkmark, "Solid — consistent recall.", no "review the misses" text.
2. Score a session all-Easy. Confirm: "Perfect — effortless recall."
3. Score a session 3×Good + 2×Again on a 5-card goal. Confirm: amber/star, "Mixed — some cards still need work."

For Change 2:

1. Set `dailyGoal = 5` in Profile tab.
2. Complete a 5-card session; see "All caught up!".
3. Background the app for 10+ minutes (or force-close + relaunch) to evict profile cache.
4. Re-open, go to Dashboard, tap "Start Today's Reviews".
5. Confirm: queue loads **5 cards** (not 20).

---

## Not in Scope

- No change to the weight table (`Easy=3, Good=2, Hard=1, Again=0`).
- No rename of the "confidence" label under the percentage ring.
- No distribution-aware logic (rejected as overkill relative to the problem; option 3 in the brainstorm).
- No server-side `confidencePct` formula change — client and server both emit the same value under the unchanged weights.
- No change to the progress tab, dashboard ring, or leaderboard treatments of confidence.

---

## Rollout

- Mobile-only. No API deploy, no migration.
- Ships in the same **B125 EAS build** as Build 3-C Phase 4. No standalone build.
- Independent of Phase 4's vocab-drill changes; can land before, during, or after Phase 4 implementation in the same session.
- Tracker impact: add a `✅ Fixed` entry in `BUGS.md` for the dailyGoal race; consider a `✅ Shipped` entry in `ENHANCEMENTS.md` for the session-complete copy rebalance.
