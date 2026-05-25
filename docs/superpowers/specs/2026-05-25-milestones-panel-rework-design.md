# Milestones Panel Rework — Design

**Date:** 2026-05-25
**Status:** Spec — awaiting implementation plan
**Supersedes:** ROADMAP.md "Phase 3 #13 — Milestones panel refactor" (the original captured spec; this design subsumes it with refinements from the 2026-05-25 brainstorm)

## 1. Motivation

Milestones recognize student progress to reinforce effort. The current implementation accumulates badges cumulatively (e.g., "1 kanji seen," "100 kanji seen," "500 kanji seen" all displayed at once), which will sprawl as users progress. We rework the panel so that each category surfaces *only the most recent badge earned*, with the next threshold shown in an "Up Next" list. We also broaden the categories (add Kanji Remembered, Grade-level tiered badges), tighten the streak and count ladders, and start persisting `achievedAt` so users can see when each milestone was reached.

## 2. Goals

- Replace cumulative badge display with a **replacement rule** — one most-recent badge per category.
- Add new categories: **Kanji Remembered** (count) and **Grade-level** (Kyouiku grades 1–9, tiered bronze/silver/gold).
- Unify all numeric ladders (Seen / Remembered / Burned) on a single threshold scheme.
- Add an **"Up Next"** list naming the next threshold per category, so retired badges remain motivating.
- Persist `achievedAt` per crossing; surface it via tap → bottom-sheet.
- WCAG 2.1 AA contrast on all badge text and tier labels.

## 3. Non-goals (this rework)

- Buddy nudge wiring. Detection emits events to `learner_state_cache.recentMilestones`; Buddy phases consume them on their own cadence. Phase 1' (in progress) already plans the streak-milestone nudge — it will read these events when it lands.
- Watch surface — no milestone display on watchOS in this rework.
- Animations / celebration effects on threshold crossing — render-only, no transitions.
- E2E browser tests.

## 4. Categories and threshold ladders

| Category | Ladder / criterion |
|---|---|
| Kanji seen | 10, 50, 100, 250, 500, 750, 1000, 1250, 1500, 2000 |
| Kanji remembered | 10, 50, 100, 250, 500, 750, 1000, 1250, 1500, 2000 |
| Kanji burned | 10, 50, 100, 250, 500, 750, 1000, 1250, 1500, 2000 |
| Streak days | 3, 7, 10, 14, 21, 28, 35, 42, 49, then +7 forever (open-ended) |
| JLPT level (N5 → N1) | Per level, two tiers: **Silver** (all kanji remembered or burned) and **Gold** (all kanji burned). Gated: Silver+ at N5 unlocks N4 detection, etc. |
| Grade-level (Kyouiku 1–9) | Per grade, three tiers: **Bronze** (`learning == 0` AND `remembered > reviewing` AND `burned > remembered`), **Silver** (all remembered or burned), **Gold** (all burned). Gated: Silver+ at grade `g` unlocks grade `g+1` detection. |

Ladders and tier definitions are shared between server detection and mobile presentation via a `packages/` module (final package location chosen in the implementation plan). No duplication.

## 5. Display rules (mobile)

- **Core row:** one badge per numeric category (Seen, Remembered, Burned, Streak) plus one JLPT badge — five badges max, only categories the user has earned.
  - **JLPT badge selection** (two-step): within each N-level, the highest tier supersedes (Gold over Silver). Across N-levels, the badge with the most-recent `achievedAt` wins. Example: if a user has N5-Gold (earned 6 months ago) and N4-Silver (earned yesterday), the JLPT badge shows N4-Silver — celebrating current effort, not peak mastery. N5-Silver, if recorded, is hidden behind N5-Gold's higher tier.
- **Grade-level row:** up to **3 most-recently-earned** grade badges. The most-recent tier wins per grade. If gating leaves only 1–2 grades earned, the row shows fewer. If zero grades earned, the row is hidden entirely.
- **Up Next list:** below the active rows. One entry per category not yet maxed (numeric categories list `(current / threshold)` progress; tier categories list `(kanji to go)`). Streak always has a next entry. JLPT Up Next respects gating (does not surface a higher N-level until lower is Silver+).
- **Sort:** within each row, most-recently-earned first. Grandfathered entries sort to the bottom within ties; among grandfathered entries themselves, tiebreaker is grade number descending (grade row) — so a migrated user with grandfathered grades 1–5 sees grades 3, 4, 5 in the row (frontier first).
- **Tap UX:** any badge tap → bottom-sheet with category icon, label, and the earned date. Real `achievedAt` → locale-formatted ("Earned May 21, 2026"). Sentinel `"grandfathered"` → "Earned before this update".
- **Empty states:** if the user has no core crossings, render *"Your first milestone awaits — start studying to earn your first badge"*. Grade-level row hidden when empty.
- **Theming:** every text/icon uses explicit `theme.milestones.*` tokens. New tokens: `theme.milestones.tier.{bronze,silver,gold}.{bg,border,label}`, each verified ≥ 4.5:1 contrast on the panel background. No reliance on RN system defaults; no `opacity:` for hierarchy.

## 6. Architecture

```
Server (apps/api)                          Mobile (apps/mobile)
─────────────────                          ────────────────────
Post-review refresh hook                   <MilestonesSection>
  └→ LearnerStateService.refresh()           ├─ reads recentMilestones
       ├─ existing: counts, streak,          │   from useLearnerState()
       │   learner state                     ├─ applies selectActiveBadges
       └─ NEW: MilestoneDetector             │   (replacement + cap + sort)
            ├─ compute current               ├─ <CoreBadgesRow>
            │   "should-have" set            ├─ <GradeBadgesRow>
            ├─ diff vs recentMilestones      ├─ <UpNextList>
            │   (idempotent)                 │   (computeUpNext from counts)
            └─ append new entries            └─ <MilestoneDateSheet>
                with achievedAt                  (bottom-sheet on tap)

Storage: learner_state_cache.recentMilestones
         (jsonb, already in schema, currently empty)

Wire: existing GET /v1/learner-state fetch ships recentMilestones
      to the client — no new endpoint
```

## 7. Data model

`learner_state_cache.recentMilestones` is a jsonb array (column exists, currently empty). Each entry:

```ts
type MilestoneEntry = {
  type:        MilestoneType;
  threshold:   number | GradeTier;        // number for count/streak; tier for grade/jlpt
  payload?:    {                          // category-specific extras
    level?: 'N5' | 'N4' | 'N3' | 'N2' | 'N1';
    grade?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    tier?:  'bronze' | 'silver' | 'gold';
  };
  achievedAt:  string;                    // ISO timestamp OR sentinel "grandfathered"
  location?:   {                          // OPTIONAL — present only if user opted in
    lat:       number;                    //   AND location capture succeeded at refresh
    lon:       number;
    accuracy?: number;                    // meters (best-effort)
  };
};

type MilestoneType =
  | 'kanji_seen'
  | 'kanji_remembered'
  | 'kanji_burned'
  | 'streak_days'
  | 'jlpt_level'
  | 'grade_level';

type GradeTier = 'bronze' | 'silver' | 'gold';
```

Grandfathered sentinel is the string `"grandfathered"` (uniform shape — no separate boolean flag).

**Schema additions:**
- Index `kanji_grade_idx` on `kanji.grade` (per-grade aggregation in detection).

No other schema changes — `recentMilestones` column already exists.

## 8. Server-side detection

New module: `apps/api/src/services/milestones/` exporting `MilestoneDetector`. Called from `LearnerStateService.refresh()` after counts are computed.

```
detectCrossings(currentCounts, perGradeState, perJlptState, existing):
  newEntries = []

  // 1. Numeric ladders: seen / remembered / burned / streak
  for category in [seen, remembered, burned, streak]:
    for threshold in LADDERS[category] where threshold <= currentCounts[category]:
      if not existing.has({type: category, threshold}):
        newEntries.push({type: category, threshold})

  // 2. JLPT — independent tier evaluation per level, gated N5 → N1
  prevJlptUnlocked = true   // N5 always eligible
  for level in [N5, N4, N3, N2, N1]:
    if !prevJlptUnlocked: break
    state = perJlptState[level]
    for tier in [silver, gold]:                    // independent evaluation
      if jlptTierRule(state, tier):
        if not existing.has({type: jlpt_level, payload: {level, tier}}):
          newEntries.push({type: jlpt_level, payload: {level, tier}})
    // Gate next level on the strongest rule that currently holds
    prevJlptUnlocked = jlptTierRule(state, silver) || jlptTierRule(state, gold)

  // 3. Grade-level — independent tier evaluation per grade, gated 1 → 9
  prevGradeUnlocked = true   // grade 1 always eligible
  for grade in 1..9:
    if !prevGradeUnlocked: break
    state = perGradeState[grade]
    for tier in [bronze, silver, gold]:            // independent evaluation
      if gradeTierRule(state, tier):
        if not existing.has({type: grade_level, payload: {grade, tier}}):
          newEntries.push({type: grade_level, payload: {grade, tier}})
    prevGradeUnlocked = gradeTierRule(state, silver) || gradeTierRule(state, gold)

  return newEntries
```

**Why independent tier evaluation instead of "emit all tiers up to current":**
Under the tightened Bronze rule (`burned > remembered`), Bronze is no longer implied by Silver — a user with mostly-remembered, little-burned state can be Silver-eligible while failing Bronze. Independent evaluation records only the tiers actually crossed. The display side already shows the highest tier per grade, so user-visible behaviour is identical; the change makes the event log honest.

**Tier rules** (shared with mobile presentation; each rule evaluated independently):
- `gradeTierRule(state, tier)`:
  - `gold`: `learning + reviewing + remembered == 0` AND `burned > 0`
  - `silver`: `learning + reviewing == 0` AND `(remembered + burned) > 0`
  - `bronze`: `learning == 0` AND `remembered > reviewing` AND `burned > remembered`
- `jlptTierRule(state, tier)`:
  - `gold`: `learning + reviewing + remembered == 0` AND `burned > 0`
  - `silver`: `learning + reviewing == 0` AND `(remembered + burned) > 0`
  - (no Bronze for JLPT)

**Key properties:**
- **Idempotent.** Re-running on the same state emits nothing. Safe on every refresh.
- **Sticky on the way up.** Recorded entries persist; replacement is purely a render concern.
- **Gating enforced at detection.** A raw-eligible higher level/grade is silently skipped until the prerequisite is met.
- **No new triggers.** Post-review refresh is the only firing point. Streak crossings happen on the study-day that earns them.

**Required inputs for detection** (refresh hook computes these alongside its existing work):
- `currentCounts` (already computed)
- `perGradeState`: per-grade counts of `learning / reviewing / remembered / burned` — joins user SRS rows to `kanji.grade`
- `perJlptState`: same shape, joined on `kanji.jlptLevel`

## 9. Migration

One-shot grandfather pass on first refresh after deploy.

```
refresh(userId):
  cache = loadOrInitCache(userId)
  counts, perGradeState, perJlptState = computeFromSrsState()

  if cache.recentMilestones is empty AND userHasExistingHistory(userId):
    // one-shot grandfather pass
    grandfathered = detectCrossings(counts, perGradeState, perJlptState, existing: [])
    cache.recentMilestones = grandfathered.map(e => ({ ...e, achievedAt: "grandfathered" }))
  else:
    newEntries = detectCrossings(counts, perGradeState, perJlptState, existing: cache.recentMilestones)
    cache.recentMilestones.push(...newEntries.map(e => ({ ...e, achievedAt: nowIso() })))

  persist(cache)
```

- **`userHasExistingHistory`:** any row in the SRS-state table with `created_at < <deploy timestamp>`. New users (no pre-deploy history) skip the grandfather pass and get real timestamps from their first crossing.
- **No SQL migration script.** Per-user lazy migration on first post-deploy refresh.
- **Safety guard:** if `recentMilestones` is unexpectedly non-empty, skip the grandfather pass and treat existing entries as authoritative.

## 10. Mobile rendering — components and files

New directory: `apps/mobile/src/components/milestones/`
- `MilestonesSection.tsx` — top-level; reads `useLearnerState()`; orchestrates rows
- `CoreBadgesRow.tsx` — horizontal scroll of non-grade badges
- `GradeBadgesRow.tsx` — horizontal scroll of up to 3 grade badges
- `MilestoneBadge.tsx` — single badge card (used by both rows)
- `GradeBadge.tsx` — tier-styled variant (bronze / silver / gold)
- `UpNextList.tsx` — vertical list of next thresholds
- `MilestoneDateSheet.tsx` — bottom-sheet shown on any badge tap

Reworked: `apps/mobile/src/constants/milestones.ts`
- Remove `computeMilestones()` (old flat-array generator).
- Export `LADDERS` constant (re-export from shared package).
- Export `selectActiveBadges(milestones) → { core, grade }` — applies replacement + grade cap + sort.
- Export `computeUpNext(counts, milestones, perGradeState, perJlptState) → UpNextEntry[]`.
- Export `formatAchievedAt(achievedAt: string) → string` — handles the grandfathered sentinel.

Reworked: [apps/mobile/app/(tabs)/progress.tsx](apps/mobile/app/(tabs)/progress.tsx)
- Replace the inline `MilestonesSection` block at line 272 with an import from the new components directory.

Theme tokens: add `theme.milestones.tier.{bronze,silver,gold}.{bg,border,label}` to the mobile theme module. Starting values from the v2 mockup (`#f5b07a` / `#f0f0f0` / `#ffe066` family); implementer verifies WCAG AA at implementation time.

## 11. Location capture (opt-in)

Records *where* each milestone was earned, for later use by mnemonic co-creation and Buddy celebration nudges. Nothing in this rework displays the location; this section lays the plumbing.

**User setting** (new Profile/Settings toggle):
- Label: *"Attach location to milestones"* (final copy chosen at implementation)
- Default: **OFF**. User must explicitly opt in. Toggling ON triggers the platform location-permission prompt if not already granted.
- Stored alongside other user settings (`user_profiles` or equivalent — final location chosen at implementation).

**Mobile capture flow:**
- When sending the request that triggers a `LearnerStateService.refresh()`:
  - If the setting is OFF, send no location.
  - If ON and OS permission is granted, attempt a single foreground location read with a short timeout (low-accuracy mode is fine — we don't need GPS lock).
  - If capture fails for any reason (permission denied at OS level, timeout, hardware off, airplane mode), proceed without location. No retry, no error surfaced to the user.
- Attach to the request body as `clientContext: { location: { lat, lon, accuracy? } }` when available.

**Server persistence:**
- On refresh, if the request body includes `clientContext.location`, stamp `location` on every newly created milestone entry from that refresh pass.
- Existing entries are never updated retroactively.
- Grandfathered entries get no location (we don't know historical positions).

**Privacy boundary:**
- Location is stored only on milestone entries. It is *not* aggregated into a separate location-history table.
- Toggling the setting OFF later does not delete past entries' locations — those represent a moment the user opted in. (A separate "delete my milestone locations" affordance is out of scope; flag for a later privacy-controls phase.)
- Location is the user's own data and is never shared outside their account.

**iOS/Android setup:**
- iOS: add `NSLocationWhenInUseUsageDescription` to `apps/mobile/app.json` with copy referencing milestone enrichment.
- Android: add `ACCESS_COARSE_LOCATION` (coarse is sufficient — we don't need fine-grained).

**Out of scope this rework:**
- Reverse geocoding (lat/lon → place name). Defer until a consuming feature lands.
- Display of location anywhere in the UI.
- Background location, geofencing, "places you study often" surfaces.
- Bulk export / delete-my-locations affordance.

## 12. Testing

**Server unit tests** — `apps/api/src/services/milestones/__tests__/`:
- Numeric ladder single + multiple crossings in one pass
- Idempotency (two calls, same state, second emits nothing)
- Stickiness on the way down (count drops, no revocation)
- Streak ladder beyond 49
- Grade gating blocks / unblocks
- Grade tier progression (bronze → silver → gold within a grade)
- **Tightened Bronze rule**: state where `remembered > reviewing` AND `learning == 0` but `burned <= remembered` → no Bronze emitted
- **Tightened Bronze rule**: state where `burned > remembered > reviewing` AND `learning == 0` → Bronze emitted
- **Independent tier evaluation**: state that is Silver-eligible but fails Bronze (lots remembered, little burned) → emits Silver only, not Bronze
- JLPT gating and Silver-then-Gold progression per level
- JLPT has no Bronze
- Migration grandfather pass populates with `"grandfathered"` sentinel
- Migration skip for new users (no pre-deploy history)
- Migration skip if cache already populated
- **Location persistence**: refresh request with `clientContext.location` → newly created entries have `location` field
- **Location absent**: refresh request without `clientContext.location` → newly created entries omit `location`
- **Location not applied retroactively**: existing entries' `location` never modified

**Server integration test** — `LearnerStateService.refresh()` end-to-end against a test DB. Pattern: commit 1807a72.

**Mobile unit tests** — `apps/mobile/src/constants/__tests__/milestones.test.ts`:
- `selectActiveBadges` replacement rule, grade cap (3 most recent), per-grade highest tier, grandfathered sort
- `computeUpNext` open-ended streak, JLPT next tier, JLPT gated, fully maxed user

**Mobile component smoke tests** — react-native-testing-library renders of `MilestonesSection` with fixture data. Verify badge counts, tap opens `MilestoneDateSheet`, grandfathered label text.

**Manual on-device:**
- WCAG AA contrast on each tier badge
- Bottom-sheet tap response
- Long labels on iPhone SE width
- Empty-state copy on a fresh test account
- Location-setting toggle (default OFF) → enabling triggers OS permission prompt; subsequent refresh stamps `location` on new entries; toggle OFF stops stamping but doesn't touch existing entries
- Location permission denied at OS level → refresh proceeds normally, no entries get `location`

## 13. Decisions log (from 2026-05-25 brainstorm)

| Decision | Choice | Rationale |
|---|---|---|
| JLPT badges | Keep with replacement rule | Preserves shipped feature without sprawl |
| JLPT tier criterion | Silver and Gold only (no Bronze) | Matches grade-level Silver/Gold; Bronze is grade-level-specific |
| JLPT gating | Same as grade-level (N5 Silver+ unlocks N4) | Rigorous progression; matches grade-level spirit |
| Grade-level display cap | 3 most-recently earned | Consistent with "sort by most recent" rule throughout the panel |
| Seen ladder | Same as remembered/burned | Symmetric across count categories |
| Detection location | Server-side on post-review refresh hook | Single source of truth; reuses existing infrastructure; feeds Buddy nudges in later phase |
| Buddy nudge wiring | Out of scope | Keeps rework focused; Buddy phases consume events |
| Migration strategy | Lazy recompute + `"grandfathered"` sentinel | Simple, honest, no SQL migration script |
| Date sentinel shape | `achievedAt: "grandfathered"` string | Uniform shape; no separate boolean flag |
| Streak ladder | Open-ended (+7 forever) | No artificial ceiling |
| Date UX | Bottom-sheet on tap | Lighter than modal |
| Constants/helpers sharing | Shared `packages/` module | Avoid logic duplication between server and mobile |
| Bronze tier criterion | Tightened: `learning == 0` AND `remembered > reviewing` AND `burned > remembered` | Requires substantive burning activity for Bronze, not just memorization-vs-review progress |
| Tier emission | Independent per-tier evaluation | Tightened Bronze breaks the "Silver implies Bronze" assumption; emit only tiers actually crossed |
| Location field | Optional `{lat, lon, accuracy?}` on each entry | Future use: mnemonic co-creation, Buddy celebration nudges |
| Location privacy default | Opt-in toggle, default OFF | Privacy-conservative; user explicitly chooses to enrich milestones with location |
| Reverse geocoding | Deferred to consuming feature | YAGNI for this rework; lat/lon is enough to plumb the data |
| Location display | Out of scope (no UI surfacing this rework) | Pure plumbing; consumers (mnemonics / Buddy nudges) own display |

## 14. Acceptance criteria

- [ ] Panel renders the 5 active categories (Seen / Remembered / Burned / Streak / JLPT) with at most one badge each.
- [ ] Grade-level row renders up to 3 most-recently-earned tier badges, with WCAG AA contrast.
- [ ] Up Next list shows the next threshold per non-maxed category, with progress for count categories.
- [ ] Tap on a badge opens a bottom-sheet with locale-formatted date OR "Earned before this update".
- [ ] Server detection runs idempotently on every post-review refresh; no duplicate entries appear in `recentMilestones`.
- [ ] First refresh after deploy for an existing user grandfathers their current active state with the sentinel; subsequent crossings get real timestamps.
- [ ] New users (no pre-deploy SRS history) skip the grandfather pass entirely.
- [ ] Bronze grade-level rule requires `burned > remembered`; a Silver-eligible user who fails this earns Silver-only (no Bronze) and that is reflected in `recentMilestones`.
- [ ] Profile setting "Attach location to milestones" exists, defaults OFF, and triggers the OS location-permission prompt on first enable.
- [ ] When the setting is ON and OS permission is granted, new milestone entries persist `location: { lat, lon, accuracy? }`; when OFF or permission denied, entries omit the field.
- [ ] iOS `NSLocationWhenInUseUsageDescription` and Android `ACCESS_COARSE_LOCATION` are wired in [apps/mobile/app.json](apps/mobile/app.json).
- [ ] All server unit tests pass; mobile unit tests pass; on-device manual verification clean.
- [ ] No client-side `computeMilestones()` usage remains; old flat-array path deleted.
