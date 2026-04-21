# B126 UX Polish Bundle — Design

**Date:** 2026-04-20
**Scope:** Polish bundle for B126. Four additive changes plus the already-committed PitchAccentReading contrast fix (`a704ad2`):
1. Daily-goal celebration + progress indicator (clarifies "am I done for today?" semantics without adding a cap).
2. Rendering-race fix for the `"All caught up!"` flash.
3. Speak icons on vocab rows in the study-card reveal panel (parity with the kanji details page).
4. Surface three Kanjidic2 reference codes already present in the DB on the kanji details page (Hadamitzky-Spahn, Kyōiku grade, frequency rank).

**Deployment footprint:** Mobile EAS build (B126) **plus one API deploy**. Prior sections (1–3) are mobile-only; section 4 requires the API to extend its `/v1/kanji/:id` response to include the three new fields.

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

**4. Speak icons on study-card reveal vocab rows (parity gap)**

During B125 verification it was noted that the kanji **details page** (`/kanji/[id]`) has speak icons on every vocab row and sentence row (shipped in B124 commit `dd6c5f7`), but the **study-card reveal panel** (`KanjiCard.tsx`) has speak icons only on the kun/on reading groups, not on vocab rows. This is an oversight from the B124 scope and was missed again when PitchAccentReading was integrated in Phase 4 Task 23.

Fix: in the `exampleVocab.map` block in [`KanjiCard.tsx`](../../apps/mobile/src/components/study/KanjiCard.tsx) around line 316, add a `<SpeakButton>` to each vocab row using the exact existing pattern already in use for kun/on groups at lines 285 and 305:

- `groupKey = `vocab-${i}`` — distinct per vocab entry so the `speakingGroup` state correctly highlights only the active one.
- `onPress={() => speakSequence([v.word], `vocab-${i}`)}` — reuses the existing `speakSequence` helper and its mount-safety guards.
- Uses the existing `SpeakButton` component defined later in the file (no new component needed).

Small layout adjustment: the current vocab row is a horizontal flex row ending in the meaning text. The SpeakButton appends cleanly after the meaning — or, if visual tests show the row becoming too crowded in small-screen widths, it can sit at `flex: 1` with the SpeakButton right-aligned. Plan phase picks one after a simulator glance.

No new imports, no new state machinery — the `speakingGroup` / `setSpeakingGroup` refs and the `speakSequence` callback are already in scope at line ~69 and ~161 respectively.

**5. Surface Kanjidic2 reference codes on the kanji details page (Hadamitzky-Spahn, Kyōiku grade, frequency rank)**

Phase 2 migration 0019 added three columns to the `kanji` table — `grade`, `frequency_rank`, `hadamitzky_spahn` — and the seed populated them (grade 99.2%, frequency_rank 93.8%, hadamitzky_spahn 98.3% of the 2,294-kanji corpus). The data has been sitting in the DB since 2026-04-20 but is not exposed through the API or rendered anywhere in the mobile UI. Raised during B125 verification; the owner learned kanji from the Hadamitzky-Spahn *Kanji & Kana* reference and expected it surfaced by now.

**API change** (`apps/api/src/routes/kanji.ts` around line 218 in the `/v1/kanji/:id` handler):

Extend the SELECT for the kanji detail record to include the three new columns. They already exist on the Drizzle `kanji` schema (`apps/db/src/schema.ts`) via migration 0019 — no schema.ts edit is required, just reference them in the `select({ ... })` shape so they appear on the response object:

```ts
        jisCode: kanji.jisCode,
        nelsonClassic: kanji.nelsonClassic,
        nelsonNew: kanji.nelsonNew,
        morohashiIndex: kanji.morohashiIndex,
        morohashiVolume: kanji.morohashiVolume,
        morohashiPage: kanji.morohashiPage,
        grade: kanji.grade,                       // NEW
        frequencyRank: kanji.frequencyRank,       // NEW
        hadamitzkySpahn: kanji.hadamitzkySpahn,   // NEW
```

No other API-level changes required — the endpoint simply emits three more optional fields on its response.

**Mobile change** ([`apps/mobile/app/kanji/[id].tsx`](../../apps/mobile/app/kanji/[id].tsx)):

*Type extension* around line 59 — add the three fields to `KanjiDetail`:

```ts
  // Cross-reference codes
  jisCode: string | null
  nelsonClassic: number | null
  nelsonNew: number | null
  morohashiIndex: number | null
  morohashiVolume: number | null
  morohashiPage: number | null
  grade: number | null                  // NEW  — Kyōiku grade 1–6, JHS 8, Jinmeiyō 9, 10
  frequencyRank: number | null          // NEW  — rank 1–2500 (lower = more frequent)
  hadamitzkySpahn: number | null        // NEW  — Hadamitzky-Spahn reference index
```

*Render* around line 499 — extend the Cross-references block. The existing `if (any-of-these != null)` guard needs its check list extended so the block shows when only Hadamitzky/grade/freq are present (currently would hide if all of JIS/Nelson/Morohashi are null but Hadamitzky is set):

```tsx
{(kanji.nelsonClassic != null
  || kanji.nelsonNew != null
  || kanji.morohashiIndex != null
  || kanji.jisCode != null
  || kanji.grade != null
  || kanji.frequencyRank != null
  || kanji.hadamitzkySpahn != null) && (
    <Card title="Cross-references">
      {kanji.jisCode != null && <RefRow label="JIS Code" value={kanji.jisCode} />}
      {kanji.grade != null && <RefRow label="Kyōiku Grade" value={formatGrade(kanji.grade)} />}
      {kanji.frequencyRank != null && <RefRow label="Frequency" value={`#${kanji.frequencyRank} of ~2500`} />}
      {kanji.nelsonClassic != null && <RefRow label="Nelson Classic" value={`#${kanji.nelsonClassic}`} onPress={...} />}
      {kanji.nelsonNew != null && <RefRow label="New Nelson" value={`#${kanji.nelsonNew}`} onPress={...} />}
      {kanji.hadamitzkySpahn != null && <RefRow label="Hadamitzky-Spahn" value={`#${kanji.hadamitzkySpahn}`} />}
      {kanji.morohashiIndex != null && <RefRow label="Morohashi" value={`#${kanji.morohashiIndex}, vol. ${kanji.morohashiVolume}, p. ${kanji.morohashiPage}`} />}
    </Card>
  )
}
```

Ordering intent: **JIS → Kyōiku Grade → Frequency → Nelson (Classic, New) → Hadamitzky-Spahn → Morohashi**. Groups the three *learner-oriented* codes (grade, frequency, Hadamitzky — the ones a student references while studying) near the top, and the two *scholarly-lookup* codes (Nelson, Morohashi) at the bottom. Plan phase may tweak if a simulator glance shows a cleaner ordering.

*Grade formatter* — add a small helper, either inline or alongside the existing `formatNextReview` helper around line 99:

```ts
function formatGrade(g: number): string {
  if (g >= 1 && g <= 6) return `${g}`            // Kyōiku 1st–6th grade (elementary)
  if (g === 8) return 'Junior High'              // Jōyō kanji taught in JHS
  if (g === 9 || g === 10) return 'Jinmeiyō'     // Name-use kanji
  return `${g}`                                   // Unknown — surface raw value
}
```

(Mapping is per the Kanjidic2 grade attribute definition — see the upstream DTD. Grade 7 does not exist in Kanjidic2.)

**Explicitly deferred (out of scope for B126):**

- Grade *badge* adjacent to the JLPT pill (currently tracked under ENHANCEMENTS E11 Grade-Level Kyōiku with silver/gold badge design).
- Frequency *indicator bar* or percentile treatment — the text `#500 of ~2500` is enough for now.
- Deep links from Hadamitzky-Spahn to any external resource — the upstream book is a print reference, no URL.

**Testing (automated):** none new required at this scope — the API change is a pure SELECT extension with optional fields; the mobile change is conditional RefRow rendering. Existing unit test coverage for the route and details page is sufficient.

**Testing (manual verification on B126):**

1. Open kanji details for a common elementary kanji (e.g. `水`) — should show Kyōiku Grade `1`, Frequency `#{small number}`, Hadamitzky-Spahn `#{small number}`.
2. Open a JHS-level Jōyō kanji (e.g. `憂`) — should show Kyōiku Grade `Junior High`.
3. Open a Jinmeiyō kanji (e.g. `倖` from the B4 top-up list) — Kyōiku Grade `Jinmeiyō`, no frequency rank (Jinmeiyō kanji are rarely in the 2,500-frequency corpus).
4. Open a kanji that somehow has all reference codes null — card hides cleanly (confirms the guard list expansion works both ways).

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
4. **Study-card vocab speak icons:**
   - Start a reading-stage card with non-empty example vocab, reveal the card. Each vocab row shows a speak icon.
   - Tap a vocab-row speak icon: TTS plays the vocab word in Japanese; icon state cycles (volume-medium-outline → volume-high → back to outline) as on the details page.
   - Tap a different vocab-row speak icon while one is playing: first one stops, second one starts. (Existing `speakingGroupRef` mutex handles this.)
5. **Kanjidic2 reference codes on kanji details:**
   - Common elementary kanji (e.g. `水`): Cross-references card shows Kyōiku Grade `1`, Frequency `#{small}`, Hadamitzky-Spahn `#{small}`.
   - JHS-level Jōyō kanji (e.g. `憂`): Kyōiku Grade shows `Junior High`.
   - Jinmeiyō kanji (e.g. `倖`): Kyōiku Grade shows `Jinmeiyō`; Frequency row omitted when null.
   - Before B126 mobile reaches TestFlight, verify the API deploy succeeded by hitting `/v1/kanji/2` (or any known ID) with an auth token and confirming the response body includes `grade`, `frequencyRank`, `hadamitzkySpahn`.

---

## Rollout

- **Mobile + one API deploy.** Sections 1–3 are mobile-only. Section 5 (Kanjidic2 reference codes) requires the API to return three additional fields from `/v1/kanji/:id`.
- Deploy order: ship the API change first (so by the time B126 rolls out through TestFlight, the new fields are already populated on responses). API deploy uses the canonical `DOCKER_CONTEXT=default ./scripts/deploy-api.sh` path.
- Mobile ships in **B126** alongside the PitchAccentReading contrast fix (`a704ad2`). Single EAS build covers sections 1–5.
- No DB migration required — migration 0019 already created the columns back in Phase 2.
- Tracker hygiene: close the "feels inconsistent" user-reported UX gap as part of the B126 verification checklist. The flash-race gets its own BUGS.md entry (separate from the earlier `a9c91fd` race fix, which was a different root cause). Flip the "Surface Kanjidic2 references" expectation to Shipped under the ENHANCEMENTS entry that describes the Phase 2 data-layer landing, or add a new entry if none exists.

---

## Interaction with Three-Modality Learning Loop (future)

This design explicitly leaves room for the **Three-Modality Learning Loop** ([ROADMAP.md Phase 6 row 23](../../ROADMAP.md), [ENHANCEMENTS.md § Future / Big Ideas](../../ENHANCEMENTS.md)) to replace the soft-target celebration with a real pedagogical gate once that initiative ships. When Three-Modality lands:

- The `3 / 5 cards today` progress indicator becomes the *first* of three-modality metrics on the Dashboard (flashcards, writing, speaking).
- The goal celebration becomes a *batch-complete* celebration that also indicates writing + speaking are now unlocked.
- The honest empty-state behaviour is preserved.

The soft-target celebration in this B126 design is a low-cost interim step that **does not** require redoing once Three-Modality arrives — the progress-tracking machinery and the crossing-detection helper are reusable.
