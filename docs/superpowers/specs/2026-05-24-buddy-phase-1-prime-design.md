# Buddy Phase 1' — BuddyCard Delivery Skeleton

**Date:** 2026-05-24
**Status:** Approved design (brainstorm complete) — ready for implementation planning.
**Author:** R. Dennis (with Claude)

**Companion documents:**
- Buddy v2 Phase 1+ Refresh: [`2026-05-23-buddy-v2-phase-1-refresh.md`](2026-05-23-buddy-v2-phase-1-refresh.md) — refresh doc §4.2 row for Phase 1' is the parent scope; §7 lists the sub-decisions this spec settles.
- Canonical April design: [`2026-04-09-kanji-buddy-design.md`](2026-04-09-kanji-buddy-design.md) — Phase 1' descends from §6 (Mobile App Integration).
- Canonical April spec: [`2026-04-09-kanji-buddy-spec.md`](2026-04-09-kanji-buddy-spec.md) — §6.1 `BuddyCard`, §6.3 `BuddyClient`, §5 API endpoints.
- Phase 0a plan: [`../plans/2026-05-23-buddy-phase-0a-cleanup.md`](../plans/2026-05-23-buddy-phase-0a-cleanup.md) — wired `LearnerStateService` (the cache this design reads).

---

## §1 — Scope & purpose

Phase 1' ships the **delivery skeleton** for Buddy: the minimum infrastructure for Buddy to speak to a learner from a real place. One rule-based nudge type goes live (`streak`) to prove the pipe end-to-end; everything else is deliberately out of scope and gets its own slice.

### 1.1 In scope

- `BuddyCard` React Native component, rendered on Dashboard / Study Ready / Progress.
- `GET /v1/buddy/nudges?screen=<screen>` and `POST /v1/buddy/nudges/:id/dismiss` API endpoints.
- `useBuddyNudges(screen)` mobile hook.
- Server-side rule engine with two rules: `streak` and one-time `meet_buddy`.
- Push notification delivery for streak milestones via the existing Expo pipeline.
- DB migration `0025_buddy_nudges_dedupe_indexes.sql` (two partial unique indexes).
- Integration tests across rule engine, API, push trigger, hook, and component.

### 1.2 Out of scope (deferred to follow-on slices)

- Other nine `NudgeType` values (`encouragement`, `milestone`, `leech_alert`, `mnemonic_refresh`, `study_plan`, `activity_suggestion`, `social_peer`, `social_challenge`, `social_rescue`). Each gets its own slice.
- LLM enrichment of nudge body text. Templates only in v1.
- Buddy voice / persona / monkey-vs-protector identity. Phase 5 territory.
- Watch nudges. Refresh §6.3 defers the entire Watch role for complete reconceptualization in its own brainstorm.
- Refreshed onboarding integration. Phase 7a.
- Frequency caps beyond per-milestone dedupe. Added when multiple nudge types coexist.
- Dismissal retry queue, push deep-link routing, custom avatar art, animations. Polish in follow-on slices.

---

## §2 — Architecture & components

A four-layer pipe, top to bottom:

1. **Mobile surface** (Dashboard / Study Ready / Progress) — mounts `<BuddyCardStack screen="..." />` exactly once in its scroll view.
2. **`useBuddyNudges(screen)` hook** — pattern-matched to `useInterventions` / `useProfile`. Module-level cache; refetch on `useFocusEffect`. Returns `{ nudges, isLoading, error, dismiss(id) }`.
3. **API endpoints** — `apps/api/src/routes/buddy-nudges.ts`, mounted at `/v1/buddy/nudges`.
4. **Rule engine** — `apps/api/src/services/buddy/nudge.service.ts`. Two entry points:
   - `evaluateNudgesForScreen(userId, screen)` — pull path, called by `GET`.
   - `maybeFireMilestoneNudges(userId, newState)` — push path, called by `LearnerStateService` after `persist()`.

### 2.1 Data flow

**Pull path (GET):**
```
mobile opens screen
  → hook calls GET /v1/buddy/nudges?screen=dashboard
  → rule engine reads learner_state_cache
  → INSERT ... ON CONFLICT DO NOTHING into buddy_nudges (lazy)
  → SELECT non-dismissed, non-expired rows for (user, screen)
  → return BuddyNudge[]
  → BuddyCardStack renders up to 2 cards in priority order
```

**Push path (event-triggered):**
```
submitReview()
  → await dualWrite.recordReviewSubmissions(...)
  → setImmediate(async () => {
      const newState = await learnerState.refreshState(userId)
      if (newState) await nudgeService.maybeFireMilestoneNudges(userId, newState)
    })
  → nudgeService checks currentStreakDays against milestone set
  → if a milestone tripped AND no existing row: INSERT + send Expo push
  → row's pushDeliveredAt is set after Expo call resolves
```

The next pull-path GET (whenever the user next opens an app screen) sees the already-inserted row and surfaces it in-app. The same `BuddyNudge` row drives both delivery channels.

### 2.2 Concurrency

The dedupe predicate is enforced by partial unique indexes on `buddy_nudges` (§3.1). Two simultaneous GETs racing through the same trigger condition resolve cleanly — one INSERT wins, the other no-ops on conflict. No distributed locks.

---

## §3 — Data model & content

### 3.1 Migration `0025_buddy_nudges_dedupe_indexes.sql`

The existing `buddy_nudges` table (live since drizzle 0008) carries every column we need. The only schema change is two partial unique indexes:

```sql
BEGIN;

-- Streak nudges dedupe on (user, screen, milestone value). Because streak
-- fires on two surfaces (Dashboard + Study Ready) as independent mirror
-- rows (see §4.2), the dedupe key includes `screen` — one row per surface
-- per milestone, each independently dismissable.
CREATE UNIQUE INDEX buddy_nudges_streak_dedupe
  ON buddy_nudges (user_id, screen, (action_payload->>'milestone'))
  WHERE nudge_type = 'streak';

-- Meet Buddy is one row per user, forever. Once dismissed, never again.
CREATE UNIQUE INDEX buddy_nudges_meet_buddy_dedupe
  ON buddy_nudges (user_id)
  WHERE nudge_type = 'encouragement' AND action_payload->>'kind' = 'meet_buddy';

COMMIT;
```

Applied to live DB per the FSRS rollout pattern ([`../runbooks/2026-05-22-fsrs-rollout.md`](../runbooks/2026-05-22-fsrs-rollout.md)).

### 3.2 `action_payload` shapes

- **Streak:** `{ "kind": "streak_milestone", "milestone": 3 }` — `milestone` is the day-count landmark.
- **Meet Buddy:** `{ "kind": "meet_buddy" }`.

### 3.3 Content templates

Phase 1' is **template-only**. Buddy's voice lands in a later phase — Phase 5 (mnemonic co-creation) is where voice gets defined alongside the signature interaction. Strings live in:

- `apps/api/src/services/buddy/templates/streak.ts`
- `apps/api/src/services/buddy/templates/meet-buddy.ts`

**Streak milestones (day → content):**

| Day | `content` |
|---|---|
| 3 | *"Day 3. You're getting into a rhythm."* |
| 7 | *"A full week. Buddy noticed."* |
| 14 | *"Two weeks. The hardest part of habit-building is behind you."* |
| 30 | *"30-day streak. This is what consistency looks like."* |
| 60 | *"60 days. Whatever you're doing, keep doing it."* |
| 90 | *"90 days. That's a season."* |
| 100 | *"100 days. Quietly remarkable."* |
| 180 | *"Half a year. Most people quit before now."* |
| 365 | *"A year of kanji. Buddy's proud."* |

**Meet Buddy `content`:**

> *"Hi, I'm Buddy. I'll notice when you're crushing it and when you're slipping. Soon I'll help build mnemonics, explain readings, and route practice when a kanji's giving you trouble. For now, just saying hello."*

### 3.4 Other column values at insert time

| Column | Streak | Meet Buddy |
|---|---|---|
| `screen` | `dashboard` (push-path insert) and `study` (pull-path insert) — see §4.2 | `dashboard` |
| `nudge_type` | `streak` | `encouragement` |
| `priority` | 5 | 10 |
| `delivery_target` | `all` (in-app + push) | `app` (in-app only) |
| `expires_at` | NOW + 30 days | NOW + 10 years |
| `generated_by` | `template` | `template` |
| `social_framing` | `false` | `false` |
| `action_type` | `dismiss` | `dismiss` |

### 3.5 Why an `(action_payload->>'milestone')` partial unique index

Postgres allows unique indexes on expressions, including `jsonb_object_field_text()`. Two known limitations:

- The expression must be IMMUTABLE — `->>` over `jsonb` is immutable so this is fine.
- The expression is evaluated on every INSERT, so it's a few-microsecond cost per write. With buddy_nudges write volume (rare; only when a milestone trips), negligible.

If we ever change the dedupe key shape, the index needs to be rebuilt. Acceptable cost for now.

---

## §4 — Surfaces, placement, and stacking

Every screen mounts `<BuddyCardStack screen="..." />` exactly once. The component calls `useBuddyNudges(screen)`, renders 0–2 cards in priority-descending order, and handles dismissal.

### 4.1 Placement per surface

- **Dashboard** (`apps/mobile/app/(tabs)/index.tsx`): inserted **above** intervention banners and stat cards, **below** `SrsStatusBar`.
- **Study Ready** (`apps/mobile/app/(tabs)/study.tsx`): inserted **above** the Begin CTA on the Practice Loop's Ready screen. Last thing the user sees before tapping Begin.
- **Progress** (`apps/mobile/app/(tabs)/progress.tsx`): inserted **above** the period selector. **Returns empty array from the API today; renders nothing.** Placement is wired so future nudge types slot in.

### 4.2 Stacking + priority

The API returns rows matching `(user_id, screen, NOT dismissed, NOW() < expires_at)` sorted by `priority DESC, created_at DESC`. The component renders **at most 2** at a time (April spec §6.1). For Phase 1' the only collision is Dashboard with both `meet_buddy` (priority 10) and `streak` (priority 5) — Meet Buddy sits on top.

**Mirror-row note on streak.** The streak rule produces mirror rows: one with `screen='dashboard'`, one with `screen='study'`. Each is independently dismissable — a user who dismisses the Dashboard card still sees it pre-session on Study Ready until they dismiss that one too. Two contexts, two opportunities for the moment to land.

The two rows are inserted via different paths so the push fires exactly once:

- **Push path** (`maybeFireMilestoneNudges`, at review-submit time): inserts the Dashboard row (`screen='dashboard'`) and fires push. The unique index `buddy_nudges_streak_dedupe` keys on `(user_id, screen, milestone)` — only the Dashboard row is inserted here.
- **Pull path** (`evaluateNudgesForScreen('study')`, when user next opens Study Ready): the rule engine detects the milestone in `currentStreakDays` and inserts the Study Ready mirror row (`screen='study'`). No push — the user is in-app.

### 4.3 `BuddyCard` component

`apps/mobile/src/components/buddy/BuddyCard.tsx`. Single file, new directory.

```typescript
interface BuddyCardProps {
  nudge: BuddyNudge
  onDismiss: () => void
}
```

**Visual treatment: neutral-soft.**

- Background: `#1f1f23`
- Border: 1px `#2e2e35`
- Border radius: 12px
- Padding: 12px
- Row: monkey avatar (32×32 circle, `#2e2e35` background, 🐵 emoji at 18px) · body text · dismiss × button

Matches `InviteMateBanner` so Buddy reads as part of the dashboard banner vocabulary, not as a special insertion. Phase 5 re-skins once persona work happens (see §7.6).

### 4.4 Dismissal

1. **Optimistic local update** — `useBuddyNudges` removes the nudge from local state immediately.
2. **API call** — `POST /v1/buddy/nudges/:id/dismiss` sets `dismissedAt = NOW()`.
3. **Failure handling** — if the API call fails (offline, 5xx), local state stays optimistic. Next refetch reconciles. The dismissed-locally row reappears on app reopen if the dismiss never reached the server. Retry queue is §7.7 future work.

### 4.5 What §4 does NOT decide

- Avatar art beyond the 🐵 emoji — Phase 5.
- Animations — use whatever React Native defaults / existing banner pattern provides. Polish later.
- Accessibility labels — Phase 1' inherits whatever a11y discipline the existing banners use; full a11y pass is on the housekeeping queue.

---

## §5 — Push notification integration

### 5.1 Event-time, not request-time

A push that only fires when the user next opens the app defeats the point. The rule engine's push-path entry point (`maybeFireMilestoneNudges`) is invoked from inside the Phase 0a `setImmediate` chain in `submitReview`:

```
await dualWrite.recordReviewSubmissions(...)
setImmediate(async () => {
  const newState = await learnerState.refreshState(userId)
  if (newState) await nudgeService.maybeFireMilestoneNudges(userId, newState)
})
```

`maybeFireMilestoneNudges` is a no-op when `newState === null` (cap-window skipped refresh). On a real refresh, it:

1. Checks `currentStreakDays` against the milestone set `{3, 7, 14, 30, 60, 90, 100, 180, 365}`.
2. For each tripped milestone with no existing Dashboard dedupe row: `INSERT ... ON CONFLICT DO NOTHING` with `screen='dashboard'`.
3. For each Dashboard `INSERT` that succeeded, call `notificationService.sendBuddyNudgePush(userId, row)` — push fires exactly once per milestone (the Study Ready mirror is inserted later by the pull path, without firing another push).

The next pull-path GET on Dashboard sees the row and surfaces it in-app. The next pull-path GET on Study Ready detects the milestone in `currentStreakDays`, inserts the mirror row (`screen='study'`), and surfaces it there too.

### 5.2 `sendBuddyNudgePush` on `notification.service.ts`

New method, **extends** the existing service (does not replace any existing path):

```typescript
async sendBuddyNudgePush(userId: string, nudge: BuddyNudge): Promise<void>
```

- Reuses the existing Expo client + `user_push_tokens` query + dead-token pruning.
- Sets `buddy_nudges.pushDeliveredAt` after Expo resolves (success or logged failure — the column means "we tried").

Push payload:

| Field | Value |
|---|---|
| `title` | `'Kanji Buddy'` (fixed for v1) |
| `body` | `nudge.content` — same string the in-app card shows |
| `data` | `{ nudgeId, kind: 'buddy_nudge', screen }` — for future deep-link routing; v1 mobile ignores |

### 5.3 Foreground-app behavior

iOS suppresses foreground push banners by default. If the user is mid-session when Day 30 trips, the push is delivered to the OS but no banner shows; the in-app BuddyCard renders on the next Dashboard view. No double-notification.

If the user is closed-and-out (most likely case: they just finished a session and put the phone down), the push lands and they get the "Day 30!" moment immediately.

### 5.4 Error handling

Fire-and-forget. Errors:

- Missing `user_push_tokens` row → log info, skip (legit case: user never granted push permission).
- `DeviceNotRegistered` / `InvalidCredentials` from Expo → prune the token (existing pattern); skip.
- Network error / Expo 5xx → log warning, skip. No retry queue.

Critically: a push failure **never** bubbles up to `submitReview` — the `setImmediate` wrapper catches everything.

---

## §6 — Testing strategy

Phase 1' is plumbing; integration tests over a real test DB (Phase 0a pattern) are the right tool.

### 6.1 Rule engine — `apps/api/test/integration/nudge-rule-engine.test.ts`

- Streak — milestone match (state at Day 7 → insert + return).
- Streak — non-milestone (state at Day 5 → no insert).
- Streak — dedupe (pre-existing row → no second insert).
- Streak — concurrent insert race (two parallel evaluates → exactly one row, partial unique index enforces).
- Streak — multiple milestones across state-advance.
- Meet Buddy — first-time fires (no row → insert).
- Meet Buddy — dedupe (existing row → no second insert).
- Meet Buddy — Dashboard only (no insert on study/progress screens).
- Surface filter — Progress returns `[]` for all states in v1.

### 6.2 API endpoints — `apps/api/test/integration/buddy-nudges-route.test.ts`

- `GET` success — returns array.
- `GET` screen validation — invalid query param returns 400.
- `GET` missing auth — returns 401.
- `POST` dismiss success — second GET no longer returns the row.
- `POST` dismiss idempotent — two POSTs both succeed; `dismissedAt` set once.
- `POST` dismiss across users — User A cannot dismiss User B's nudge (404 or 403, matching existing route auth pattern).
- `POST` dismiss unknown id — 404.

### 6.3 Push path — `apps/api/test/integration/buddy-push-trigger.test.ts`

- Milestone trip fires push (spy on `sendBuddyNudgePush`; verify `pushDeliveredAt` set).
- Non-milestone state change doesn't fire.
- Already-recorded milestone doesn't re-fire.
- Missing push token doesn't throw.

### 6.4 Mobile hook — `apps/mobile/test/hooks/useBuddyNudges.test.ts`

- Fetches on mount.
- Refetches on focus.
- Optimistic dismiss (local removal immediate, API call async).
- Error handling (rejected API call → `error` populated, `nudges` unchanged).

### 6.5 Component — `apps/mobile/test/components/buddy/BuddyCard.test.tsx`

- Renders `content` text.
- Renders monkey avatar.
- Tapping × calls `onDismiss`.
- Snapshot test locks neutral-soft visual treatment.

### 6.6 Not tested in Phase 1'

- End-to-end through TestFlight (manual smoke during rollout).
- Push delivery to real APNs (operator-verified).
- Visual regression beyond snapshot.

---

## §7 — Future work / roadmap

Items called out during this brainstorm, deferred to follow-on slices. Each gets its own brainstorm + spec + plan.

1. **`nudge_templates` DB table.** Move template strings from TS files to Postgres rows once we have ≥3 nudge types or non-engineers want to iterate on copy. Then copy changes become `UPDATE` statements, not deploys.
2. **Apple Watch role refactor — complete reconceptualization.** Watch is recast as reminder + reinforcer + affect-focused companion (no more card-study on the wrist). Brainstormed from scratch. Per refresh doc §6.3.
3. **Frequency caps beyond per-milestone dedupe.** When multiple nudge types coexist, introduce global per-day cap (April §10: 1 social/day, 3 Watch/day).
4. **Additional `NudgeType` values — each its own slice.** Candidates: `encouragement` (re-engagement on absence), `milestone` (kanji-count landmarks), `leech_alert` (FSRS R(t) — couples to Phase 3), `mnemonic_refresh` (couples to Phase 5), `social_*` (Phase 4).
5. **LLM enrichment of nudge body text.** Use the existing LLM router to vary nudge copy at insert time. Per-nudge-type opt-in.
6. **Visual re-skin (avatar, voice-aware treatment).** Phase 5 settles Buddy's persona; the BuddyCard component gets re-themed in coordination — once, not iteratively.
7. **Dismissal retry queue.** Today, a failed dismiss (offline / 5xx) reverts optimistically on next app open. Queue-and-retry is a future polish.
8. **Push deep-link routing.** Tap a Day-30 push → app opens to Dashboard with the streak card highlighted (or to a future Buddy detail view). The `data` field on the push payload already carries `nudgeId` and `screen`; mobile-side routing wires up later.
9. **Daily Buddy metrics — extend Phase 0a's counters.** Add daily counts of nudges inserted, dismissed, and pushed. Extends `emitDailyBuddyMetrics()` non-breakingly.
10. **Milestones experience rework.** User flagged feedback + rework needed on the existing milestone surface in the app. Task chip spawned during this brainstorm; will run as its own session.

---

## §8 — What this does NOT change

- **Buddy v2 canonical design** (April spec) — every Phase 1' choice fits inside it. Mnemonic Co-Creation (§7), Study Log (§8), social rules (§10) all untouched.
- **Buddy v2 Phase 1+ Refresh doc** — Phase 1' implements §3 + §4.2 of the refresh exactly.
- **FSRS / Practice Loop / Tutor Analytics shipped systems** — Phase 1' does not modify their endpoints, schemas, or services. It *reads* `learner_state_cache` (Phase 0a's output) and adds new routes under `/v1/buddy/*`.
- **Mobile tab structure.** Phase 1' inserts `<BuddyCardStack />` components into existing screens; it does not add tabs, change navigation, or touch the Practice Loop.
- **Existing `notification.service.ts` behavior.** Phase 1' *extends* the service with `sendBuddyNudgePush()`; the existing daily-reminder + study-mate-alert paths stay intact.

---

## §9 — Next steps

1. **Commit this spec** (end of this brainstorm session).
2. **Phase 1' implementation plan** via the writing-plans skill — tasks for migration, rule engine, API routes, push integration, hook, component, placements, tests.
3. **Plan execution** following Phase 0a's pattern (inline, with operator handoff for the deploy step).
4. **Phase 5 brainstorm** (Contextual Mnemonic Co-Creation) — the next constructivist-anchor slice. Phase 1' establishes the BuddyCard surface; Phase 5 puts the signature feature into it.

---

*End of Phase 1' design. Companion documents: [`2026-05-23-buddy-v2-phase-1-refresh.md`](2026-05-23-buddy-v2-phase-1-refresh.md), [`2026-04-09-kanji-buddy-design.md`](2026-04-09-kanji-buddy-design.md), [`2026-04-09-kanji-buddy-spec.md`](2026-04-09-kanji-buddy-spec.md).*
