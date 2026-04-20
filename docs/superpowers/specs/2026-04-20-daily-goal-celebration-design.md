# Daily-Goal Celebration + Flash-Race Fix — Design

**Date:** 2026-04-20
**Scope:** Mobile-only UX work that clarifies daily-goal semantics without changing behaviour. Ships in B126 alongside the PitchAccentReading contrast fix.
**Status:** Design approved during B125 verification discussion. Awaiting implementation plan.

---

## Problem

During B125 verification the owner observed behaviour that "feels inconsistent" around daily study sessions:

- Session 1: 5 cards (per `profile.dailyGoal = 5`).
- Session 2, 10–15 minutes later: 5 more cards (different kanji).
- Session 3, within 10 minutes of Session 2: briefly renders the "All caught up! No reviews due right now." empty state for ~2 seconds, then loads 5 more cards.

The confusion has two root causes:

**1. No UX cue about daily-goal progress.** The current flow has a session-level cap (`dailyGoal` → `loadQueue(limit)`) but no daily-level signal. `daily_stats.reviewed` vs. `profile.dailyGoal` is never surfaced on the Dashboard. There is no "you hit your target today" moment and no running counter. The user has no way to answer "am I done for today?" without doing the arithmetic themselves.

**2. Rendering race on Study-tab mount.** [`apps/mobile/src/stores/review.store.ts:68`](../../apps/mobile/src/stores/review.store.ts:68) initialises with `isLoading: false, queue: []`. The empty-state branch in [`apps/mobile/app/(tabs)/study.tsx:356`](../../apps/mobile/app/(tabs)/study.tsx:356) fires when `!isLoading && queue.length === 0` — which is *true* for one render before the `useEffect` fires `loadQueue()`. The recent `[profile]`-gated effect (`a9c91fd`) widened this window slightly, because `loadQueue` now waits for `profile` to resolve, during which time `isLoading` stays `false` and `queue` stays empty. Result: the empty state flashes on every cold study-tab mount, even when cards are genuinely available.

---

## Non-Goals (intentional)

Some options considered during the brainstorm were **rejected on purpose**:

- **Daily hard cap.** Blocking users from studying past `dailyGoal` is paternalistic and duplicates what the future Three-Modality Learning Loop ([ENHANCEMENTS.md § Future / Big Ideas](../../ENHANCEMENTS.md)) will achieve through pedagogy rather than gating. Anki permits unlimited same-day review; so should we.
- **Split "goal / practice more" CTAs.** Adds UI surface without underlying behavioural change the user would benefit from. Was briefly considered, then reconsidered once the owner pushed back on restricting same-day re-reviews.
- **Server-enforced goal tracking.** Not necessary for a celebration pattern. Client-side reading of `daily_stats.reviewed` is sufficient for the signalling this design provides.
- **"Practice more" queue that only serves new unseen kanji.** Same reasoning as above.

The design is deliberately **soft-target**: goal is a target, not a cap. Users who want to keep going, do. Users who want validation that they've met their commitment, get a clear ✓.

---

## Design

### Behaviour — unchanged

- Server `/v1/review/queue?limit=N` continues to return due cards plus new-unseen fill up to `limit`. No changes.
- Mobile continues to call `loadQueue(profile.dailyGoal)`. No changes.
- No daily cap, no gating, no secondary CTA.

### UX signals — additive

**1. Dashboard progress indicator**

On [`apps/mobile/app/(tabs)/index.tsx`](../../apps/mobile/app/(tabs)/index.tsx), add a small progress line *below or alongside* the existing "Start Today's Reviews" CTA showing today's progress toward the daily goal:

- Below goal: `3 / 5 cards today` (muted grey).
- At or above goal: `5 / 5 today ✓` or `7 / 5 today ✓` (success-coloured check, count keeps climbing if user continues past goal).
- Zero state (`reviewed = 0`): either hide the indicator or render `0 / 5 today` — whichever reads cleaner in place. Plan phase picks one after a simulator glance.

Data source: `daily_stats.reviewed` for today, via whatever endpoint the Dashboard already uses to pull today's stats. Plan phase confirms the exact endpoint (likely `/v1/analytics/summary` or an equivalent today-stats query) and extends the response if the field isn't already present.

**2. Goal celebration at crossing**

Triggered **inside [`SessionComplete.tsx`](../../apps/mobile/src/components/study/SessionComplete.tsx)**, not on the Dashboard. Rationale: the moment the user crosses the goal is always at a Session Complete screen (it's the only path that writes `daily_stats.reviewed`). Celebrating there makes the cause-and-effect obvious.

Detection: the component needs to know whether *this session* is the one that crossed the threshold. Compute from props:

- `reviewedBefore = daily_stats.reviewed before this session`
- `reviewedAfter = reviewedBefore + totalItems`
- `crossed = reviewedBefore < dailyGoal && reviewedAfter >= dailyGoal`

If `crossed`, render a one-line banner above the confidence ring:

> `🎉 Daily goal met — nice work.`

The banner is transient per-session — it appears on the Session Complete that did the crossing, never again until a new day. Already-met sessions (user studying past goal) show nothing extra; they see the standard Session Complete screen. Burned-kanji celebration (existing `burned > 0` path in `motivationalMessage`) takes precedence if both would apply — show the burned message, skip the goal banner, since crossing while also burning is an unusual double event and the burned message is more informative.

Plan phase adds two new props to `SessionComplete`: `reviewedBefore: number` and `dailyGoal: number`, threaded from `study.tsx`. The Study screen fetches these before calling `finishSession` (it already has `profile.dailyGoal`; `reviewedBefore` is read from the same endpoint the Dashboard uses).

**3. Honest empty state — flash-race fix**

Change [`apps/mobile/src/stores/review.store.ts:68`](../../apps/mobile/src/stores/review.store.ts:68) initial state from `isLoading: false` to `isLoading: true`. The Study screen's "All caught up!" branch becomes unreachable until `loadQueue()` has actually completed and set `isLoading: false`, at which point `queue.length === 0` is the genuine server-returned-nothing state.

Side effect accepted: the Study tab will show its loading spinner for ~100ms longer on first mount. This is strictly better than showing a wrong "caught up" message for the same duration.

Corollary: the "All caught up!" copy itself is honest as-is. "No reviews due right now. Come back later." is what it should say when the server returns zero — which will now only happen when it's actually true.

---

## Architecture & Data Flow

**Nothing new server-side.** All changes live in `apps/mobile/`.

```
daily_stats.reviewed (existing)
         │
         ▼
Dashboard (reads today-stats)
  └─► Progress indicator "3 / 5 today"
         │
         ▼ (user taps Start Today's Reviews)
Study screen
  └─► SessionComplete (receives reviewedBefore + dailyGoal as props)
         └─► Celebration banner when crossed
              │
              ▼ (user taps Done)
Dashboard re-reads today-stats
  └─► Progress indicator now "5 / 5 today ✓"
```

---

## Testing

### Unit tests (new)

Add `SessionComplete.goalCelebration.test.ts`:

- `crossed` derivation: before=4, after=9, goal=5 → true.
- `crossed` derivation: before=5, after=10, goal=5 → false (already met before this session).
- `crossed` derivation: before=0, after=3, goal=5 → false (below goal after session).
- `crossed` derivation: before=0, after=5, goal=5 → true (boundary — first session that hits goal).
- Burned override wins over goal celebration: burned=1, crossed=true → render burned message, no goal banner.

This means extracting a small pure helper (likely `didCrossGoal(reviewedBefore, totalItems, dailyGoal): boolean` in `SessionComplete.messaging.ts` alongside the existing `motivationalMessage`).

### Manual verification on device

After B126 lands in TestFlight:

1. **Progress indicator:**
   - Fresh day: Dashboard shows `0 / 5 today` (or hidden zero state — per plan choice).
   - Complete a partial session (3 cards): Dashboard now shows `3 / 5 today`.
   - Complete a full session (5 cards): Dashboard shows `5 / 5 today ✓`.
2. **Goal celebration:**
   - Partial → goal-crossing session: banner appears.
   - Goal-already-met → further session: no banner.
   - Burned kanji on the same crossing session: burned message shows, goal banner suppressed.
3. **Flash-race fix:**
   - Background app for 10+ minutes, reopen, tap Study tab. Should show loading spinner briefly, then cards — never the "All caught up" flash.
   - Genuinely exhausted queue (rare in practice): "All caught up!" still renders when server returns zero.

---

## Rollout

- Mobile-only. No API deploy, no migration.
- Ships in **B126** alongside the PitchAccentReading contrast fix (`a704ad2`). Single EAS build covers both.
- Tracker hygiene: close the "feels inconsistent" user-reported UX gap as part of the B126 verification checklist. The flash-race gets its own BUGS.md entry (separate from the earlier `a9c91fd` race fix, which was a different root cause).

---

## Interaction with Three-Modality Learning Loop (future)

This design explicitly leaves room for the **Three-Modality Learning Loop** ([ROADMAP.md Phase 6 row 23](../../ROADMAP.md), [ENHANCEMENTS.md § Future / Big Ideas](../../ENHANCEMENTS.md)) to replace the soft-target celebration with a real pedagogical gate once that initiative ships. When Three-Modality lands:

- The `3 / 5 cards today` progress indicator becomes the *first* of three-modality metrics on the Dashboard (flashcards, writing, speaking).
- The goal celebration becomes a *batch-complete* celebration that also indicates writing + speaking are now unlocked.
- The honest empty-state behaviour is preserved.

The soft-target celebration in this B126 design is a low-cost interim step that **does not** require redoing once Three-Modality arrives — the progress-tracking machinery and the crossing-detection helper are reusable.
