# Speaking Progressive-Hints Refactor — Design Spec

**Date:** 2026-04-22
**Target build:** TBD (next EAS build after this spec + implementation plan are approved)
**Status:** Draft pending user review
**Supersedes:** The mobile portion of `docs/superpowers/specs/2026-04-19-vocab-as-drill-unit-design.md` Phase 4 ("Mobile — vocab drill + pitch UI + toggle"). Phases 1–3 of that spec shipped in B125/B127 and remain the foundation; this doc completes Phase 4 and folds in Phase 5 tracker hygiene.

---

## Summary

Replace the single-shot Speaking evaluator with a **four-tier progressive-hint ladder**. Each wrong answer reveals one more scaffold; the learner sees maximum support only when genuinely stuck. Introduces an **amber target-kanji chip** inside the vocab word so the learner always knows which kanji drives the card, and a new **`attempts_count` column on `voice_attempts`** so retry behaviour is recorded for future SRS use (without being consumed yet). Bundles the **cross-user cleanup of pre-homophone-fix `voice_attempts` rows** as a one-shot pre-work step so Progress-page speaking metrics recover from the old evaluator's false-negative rows.

**One-line architecture:** A client-side `attempts` counter in `voice.tsx` drives which scaffolds are visible on each attempt; the server evaluation endpoint is unchanged except for accepting and storing `attempts_count`. No change to the queue builder, vocab selection, SM-2 scheduling, or confidence math.

## Why this spec exists

Build 3-C Phase 4 ("vocab-as-drill-unit") partially shipped in B125/B127: vocab-level prompts, the `PitchAccentReading` component, migrations 0019/0020, and the `show_pitch_accent` user toggle are all live. What did not ship is the pedagogical UX that was scoped as part of Phase 4:

- The learner has no visual indication of which kanji in the vocab word is being drilled (only the session context hints at it).
- Every scaffold is either always-on or always-off per card — no progressive reveal as the learner demonstrates difficulty.
- Retries aren't first-class; a wrong answer ends the card.
- Pre-2026-04-19 `voice_attempts` rows (recorded by the broken homophone evaluator) inflate the miss-rate on the Progress page's speaking metrics, making "accuracy" meaningless for any kanji the learner drilled before the fix.

This refactor completes Phase 4's pedagogical layer, captures data for the future Learning Engine brainstorm, and clears the stale-metrics debt.

## What ships together

| # | Name | Layer |
|---|------|-------|
| 1 | Target-kanji amber chip inside vocab word (theme-aware) | Mobile + theme |
| 2 | Progressive-reveal attempt ladder (tries 1 / 2 / 3 / 4+) | Mobile |
| 3 | Multi-attempt retry loop with "Not quite. Try again." interstitial | Mobile |
| 4 | Shared Success card with both kanji-level and vocab-level meanings | Mobile |
| 5 | `voice_attempts.attempts_count smallint NOT NULL DEFAULT 1` | DB migration |
| 6 | `POST /v1/review/reading-eval` accepts `attemptsCount` and stores verbatim | API |
| 7 | `voicePrompt.targetKanji` added to server response | API |
| 8 | Force-reveal pitch accent on try 4+ regardless of user toggle | Mobile |
| 9 | Hide difficulty picker JSX (preserve SecureStore value for future enhancement) | Mobile |
| 10 | Pre-work DELETE of all `voice_attempts` rows before 2026-04-19 | DB ops |
| 11 | Phase 5 tracker hygiene: close homophone entry in BUGS.md, flip related ENHANCEMENTS.md items to Shipped | Docs |

## Explicit non-goals

- **No SRS or confidence math change.** SM-2 scheduling, `daily_stats`, streak, and the quality-score pipeline are untouched. `attempts_count` is collected only.
- **No difficulty-picker behaviour.** The picker is hidden, not redesigned. Restoration as a "starting-tier" preference is a staged enhancement documented in `ENHANCEMENTS.md`.
- **No vocab-level SRS.** Reading drills still attribute progress to the target kanji, not the vocab word.
- **No Android-specific verification** (same carve-out as the original Phase 4 spec).
- **No fix for the TTS volume bug** logged this session. Separate investigation — manual verification of this refactor should note any volume regressions observed, not attempt to fix them.
- **No new endpoint** — the existing reading-eval endpoint is extended in place.

---

## Architecture

```
Learner taps mic
  → POST /v1/review/reading-eval { attemptsCount, spoken, ... }
      → server evaluates (existing logic, homophone expansion intact)
      → inserts voice_attempts row with attempts_count = N
      → returns { correct, feedback, ... } (unchanged shape)

Mobile receives result:
  if correct:
    render Success card with kanji + vocab meanings → manual Next Kanji tap
  else:
    attempts += 1
    show "Not quite. Try again." inline interstitial (~1.5s)
    re-render card with attempt-N scaffolds visible
```

**Layers touched:**

| Layer | Change |
|---|---|
| DB | Migration `0022_voice_attempts_attempts_count.sql` |
| Drizzle schema | Add `attemptsCount: smallint('attempts_count').notNull().default(1)` |
| Shared types | `VoicePrompt.targetKanji: string` added |
| API service | `reading-eval.service.ts` accepts + persists `attemptsCount` |
| API route | `review.ts` Zod schema accepts `attemptsCount` |
| API queue builder | `srs.service.ts::getReadingQueue` attaches `targetKanji` to `voicePrompt` |
| Mobile — voice tab | `apps/mobile/app/(tabs)/voice.tsx` — attempt state, layout gating, picker removal, Success card |
| Mobile — evaluator | `apps/mobile/src/components/voice/VoiceEvaluator.tsx` — new reveal props, target chip, vocab meaning in success render |
| Mobile — theme | `colors.targetChipBg` and `colors.targetChipText` semantic tokens added to `apps/mobile/src/theme/index.ts` |

---

## Components & state machine

### Attempt state (in `voice.tsx`)

One counter, four derived booleans, no extra state:

```ts
const [attempts, setAttempts] = useState(0)

const showKunOn     = attempts >= 1
const showMeaning   = attempts >= 1          // kanji-level meaning
const showHiragana  = attempts >= 2
const forcePitch    = attempts >= 3          // overrides user toggle
const showVocabMeaning = attempts >= 3       // vocab meaning on try 4+ and Success card
const canBail       = attempts >= 3          // Next Kanji visible outside Success card
```

The counter is zero-indexed for *wrong results received*. After the first wrong response, `attempts` becomes 1 and try-2 layout renders.

**Wire-format note:** the server field `attempts_count` is 1-indexed (which try within the card this row represents). The client sends `attempts + 1` on each POST, so the first mic press sends `attemptsCount: 1`, the second sends `2`, and so on. Keep the local `attempts` counter zero-indexed for the reveal-gate arithmetic above; convert only at the POST boundary.

### State transitions

| Event | Effect |
|---|---|
| Queue loads / card advances | `attempts = 0`, `evaluated = false`, interstitial cleared |
| Server returns `correct: false` | `attempts += 1`, show interstitial briefly, reset evaluator to listening-ready |
| Server returns `correct: true` | Render Success card (includes Next Kanji button) |
| User taps Next Kanji (Success path) | Advance `currentIndex`; reset per card-start |
| User taps Next Kanji (bail path, `attempts >= 3`) | Advance `currentIndex`. **No new `voice_attempts` row written** — `voice_attempts` records speech attempts only. The card's outcome is derived from the last row: `passed=true` at any point → card counted remembered; otherwise counted missed. |
| User taps mic while bail button visible | Standard attempt flow — counter keeps climbing |
| Network or server error | **Do NOT increment `attempts`.** Show existing error banner with retry. No row written. |

### `VoiceEvaluator.tsx` prop contract

```ts
interface Props {
  // existing:
  kanjiId: number
  character: string
  correctReadings: string[]
  readingLabel?: string
  onResult?: (result: EvalResult) => void
  strict?: boolean
  voicePrompt?: VoicePrompt          // now includes targetKanji

  // new:
  attempts: number                   // sent in POST body + drives force-pitch
  revealHiragana: boolean
  revealPitch: boolean               // force overrides user toggle when true
  revealVocabMeaning: boolean        // show vocab meaning line on try 4+ / Success

  // retire:
  // hideHint — superseded by the reveal flags above
}
```

Internals:
- Vocab render wraps the target character in `<TargetChip>`:
  ```tsx
  <Text style={styles.character}>
    {Array.from(voicePrompt.word).map((c, i) =>
      c === (voicePrompt.targetKanji ?? character)
        ? <TargetChip key={i}>{c}</TargetChip>
        : <Text key={i}>{c}</Text>
    )}
  </Text>
  ```
  Chip renders around **every** occurrence of the target kanji (rare edge case like 人人 drilling for 人).
- Hiragana hint gated on `revealHiragana`.
- `PitchAccentReading` receives `enabled={showPitchAccent || revealPitch}`.
- `attempts` included in the request body on `POST /v1/review/reading-eval`.
- Vocab meaning line renders when `revealVocabMeaning` is true.

### Target-kanji chip (`TargetChip`)

A tiny presentational wrapper around `<Text>`:

```tsx
function TargetChip({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={styles.targetChip}
      accessibilityLabel={`target kanji ${children}`}
    >
      {children}
    </Text>
  )
}
```

`styles.targetChip` references the new theme tokens:
```ts
targetChip: {
  backgroundColor: colors.targetChipBg,
  color: colors.targetChipText,
  paddingHorizontal: 6,
  borderRadius: 8,
}
```

### "Not quite. Try again." interstitial

Inline amber-tinted banner rendered below the evaluator, above the mic, on `attempts > 0 && !evaluated && lastResult?.correct === false`. Auto-dismisses after ~1.5s or on next mic tap, whichever comes first. Single line of copy, no buttons.

### Difficulty picker disposal

Remove the JSX at `voice.tsx:237–262` (toggle chevron + picker dropdown). Preserve:
- The `difficulty` state variable
- The `changeDifficulty` callback
- The `DIFFICULTY_KEY` SecureStore read/write

Add a comment:
```ts
// Difficulty state persists for future restoration as a "starting-tier"
// preference; UI hidden during the progressive-hints refactor. See
// ENHANCEMENTS.md — "Voice drill: restore difficulty-picker as a
// starting-tier preference".
```

### Success card

New render branch when `evaluated && lastResult?.correct === true`. Replaces today's inline result row.

```
┌────────────────────────────────┐
│  ✓                             │
│  Correct!                      │
│                                │
│  [指-chip]導                   │
│  しどう                        │
│  ───────────                   │
│  Kanji (指): finger; point to; │
│              indicate          │
│  Word (指導): guidance;        │
│               instruction      │
│  ───────────                   │
│  [ Next Kanji → ]              │
└────────────────────────────────┘
```

Both meanings explicitly labelled so the pedagogical distinction (kanji-as-building-block vs compound-as-word) is clear. No mic button on this card — evaluation is complete.

---

## API + DB contract

### Migration `0022_voice_attempts_attempts_count.sql`

```sql
-- Add attempts_count to voice_attempts.
-- Represents which try within the card produced this row (1, 2, 3, …).
-- Defaults to 1 so legacy rows stay semantically correct.

ALTER TABLE voice_attempts
  ADD COLUMN attempts_count smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN voice_attempts.attempts_count IS
  'Which try within the card this row represents. 1 = first attempt. '
  'Collection-only as of the Speaking refactor (2026-04-22) — not consumed '
  'by SRS or confidence math. Future Learning Engine brainstorm will decide '
  'how to incorporate.';
```

**Rollback:** `ALTER TABLE voice_attempts DROP COLUMN attempts_count;` — safe; no reader depends on it.

### Drizzle schema update

`packages/db/src/schema.ts`, inside `voiceAttempts`, before `attemptedAt`:

```ts
attemptsCount: smallint('attempts_count').notNull().default(1),
```

### `POST /v1/review/reading-eval` — request body delta

```ts
// New field:
attemptsCount: z.number().int().min(1).max(50),   // upper bound prevents pathological values
```

Behaviour:
- Omitted → Zod default 1 (backwards compat for any cached older clients).
- Out-of-range or non-integer → 400 with Zod error.
- Valid → forwarded unchanged into `voice_attempts` insert.

Response shape unchanged. Server does not echo `attemptsCount` back — the client owns the counter.

### `VoicePrompt` extension (shared type)

```ts
interface VoicePrompt {
  type: 'vocab'
  word: string          // e.g. "指導"
  reading: string       // e.g. "しどう"
  meaning: string       // vocab-level meaning, e.g. "guidance; instruction"
  pitchPattern: number[]
  targetKanji: string   // NEW — always one character drawn from `word`
}
```

**Invariant:** `voicePrompt.word.includes(voicePrompt.targetKanji) === true`. Enforced at queue-build time in `srs.service.ts::getReadingQueue`.

**Client fallback:** `voicePrompt.targetKanji ?? currentItem.character` — safety net if a cached older API response lacks the field.

### Pre-work one-shot SQL

Run **once** against prod immediately after the migration lands, **before** the mobile build ships:

```sql
DELETE FROM voice_attempts
WHERE attempted_at < '2026-04-19T00:00:00Z';
```

**Scope:** all users. Every pre-homophone-fix row is mathematically invalid (the evaluator couldn't correctly score homophone drills at the time), so cross-user cleanup is safer than a per-user approach that leaves uninvestigated accounts dirty.

**Capture before/after row counts** in the deploy handoff:
```sql
SELECT count(*) FROM voice_attempts WHERE attempted_at < '2026-04-19';
-- Expect 0 after the DELETE.
```

**Irreversible** by design. Documented in the implementation plan as a one-way door.

### Theme tokens

Add to `apps/mobile/src/theme/index.ts`:

```ts
// Dark theme:
targetChipBg:   '#F4A261',  // accent (amber)
targetChipText: '#1A1A2E',  // dark

// Light theme (when light theme ships):
targetChipBg:   '#E07B2A',  // accentDark
targetChipText: '#FFFFFF',  // white
```

Contrast validation:

| Pair | Dark theme | Light theme |
|---|---|---|
| Chip bg vs chip text | `#F4A261` on `#1A1A2E` = ~7.9:1 (AA normal) | `#E07B2A` on `#FFFFFF` = ~4:1 (AA-large; vocab is ≥18pt) |
| Chip bg vs card bg | `#F4A261` on `#1A1A2E` = ~7.9:1 | `#E07B2A` on `#F5F5F5` = ~4.1:1 (AA graphical) |

---

## Error handling + edge cases

### Error states

| Failure | Behaviour |
|---|---|
| Mic permission denied | Existing handling; no attempt recorded. |
| Network fail on POST | Do NOT increment `attempts`. Show existing error banner with retry. No row written. |
| Server 5xx | Same as network fail — don't advance state. |
| Server 200 malformed payload | Treat as wrong (conservative); increment `attempts`; row written; log to Sentry. |
| User kills app mid-drill | State is component-local; next session fresh. No persistence needed. |

### Edge cases

- **Target kanji appears multiple times in the vocab word.** Chip all occurrences.
- **`voicePrompt` absent (legacy fallback).** Legacy kanji-only render branch in `VoiceEvaluator.tsx` still works; attempt ladder still gates scaffolds. No target chip (no vocab word to anchor it in).
- **User taps Next Kanji while mic is listening (bail from try 4+).** Stop recognizer; no eval request was sent so no new `voice_attempts` row is written; advance. No orphaned mic sessions. The prior wrong-attempt row remains the last one on file for this card.
- **Pitch data missing for the vocab.** `PitchAccentReading` degrades to plain hiragana (existing behaviour). Log to Sentry as a data-quality issue.
- **`targetKanji` present but not in `word` (data inconsistency).** Render word without chip; log to Sentry. Invariant violation at the data layer.

### Empty states

- **Reading queue empty.** Existing "All caught up" — no change.
- **`voicePrompt.meaning` absent.** Render an empty meaning line at try 2+ rather than showing "undefined" or breaking layout.

---

## Accessibility

**Screen reader:**
- Target chip `accessibilityLabel={`target kanji ${char}`}` so VoiceOver announces "target kanji 指" separately from the rest of the word.
- Reveal transitions announced via `AccessibilityInfo.announceForAccessibility`:
  - Wrong result → *"Not quite. Try again. More hints revealed."*
  - Try-3 hiragana reveal → *"Reading hint: しどう"*
  - Try-4+ pitch force-reveal → *"Pitch accent revealed"*
  - Correct → *"Correct. The word is 指導, shidō, meaning guidance."*
- Success card's Next Kanji button: `accessibilityHint="Advances to the next kanji"`.

**Reduced motion:** Mic-pulse `Animated` loop gated on `AccessibilityInfo.isReduceMotionEnabled()`. Fallback: static mic icon.

**Contrast:** See theme-token table above. Both themes clear WCAG 2.1 AA for their respective type-size category.

**Haptics:**
- Wrong result → `Haptics.NotificationFeedbackType.Warning`.
- Correct result → `Haptics.NotificationFeedbackType.Success`.
- Bail-out from try 4+ → no haptic (deliberate exit, neither win nor loss).

---

## Testing

### Unit tests

**`reading-eval.service.ts`:**
- `attemptsCount: 1 | 3` → row has matching `attempts_count`.
- `attemptsCount` omitted → Zod default 1.
- Invalid (`0`, `-1`, `51`, `"two"`) → 400.

**`VoiceEvaluator.tsx` (component):**
- Target chip on target kanji only (non-target chars render plain).
- Chip renders on all occurrences when target appears multiple times.
- `attempts=0` → no kun/on, meaning, hiragana, vocab-meaning; pitch honours `showPitchAccent` toggle.
- `attempts=1` → kun/on + kanji meaning visible.
- `attempts=2` → hiragana visible.
- `attempts=3` → pitch force-revealed even with `showPitchAccent=false`; vocab meaning visible.
- Success card shows both kanji-level and vocab-level meanings.
- "Not quite. Try again." interstitial renders on `attempts > 0 && !correct`.
- `voicePrompt` absent → legacy render; ladder still gates scaffolds.
- `targetKanji` not in `word` → render without chip; log warning.

### Integration tests

**Full attempt sequence (new test in API suite):**
```
POST attemptsCount=1 wrong   → 200, correct:false
POST attemptsCount=2 wrong   → 200, correct:false
POST attemptsCount=3 right   → 200, correct:true
Query voice_attempts         → 3 rows with attempts_count = 1, 2, 3
Last row passed = true.
```

**Validation:**
- `attemptsCount: 0 | -1 | 51 | "two"` → 400.
- Missing → 200, default 1 applied.

### Manual verification (on-device exit criteria)

**UI/flow:**
- [ ] Try 1 matches the ladder mockup: amber chip on target kanji only; nothing else.
- [ ] Wrong → "Not quite. Try again." interstitial appears briefly and auto-dismisses.
- [ ] Try 2 reveals kun/on + kanji meaning (not vocab meaning).
- [ ] Try 3 reveals hiragana under vocab word.
- [ ] Try 4+ force-reveals pitch overlay (verified with user pitch toggle OFF); vocab meaning appears; Next Kanji button visible.
- [ ] Correct on any try → Success card shows ✓ + both meanings + Next Kanji.
- [ ] Bail from try 4+ → card marked missed; next card's Try 1 fresh.
- [ ] Pitch force-reveal gracefully degrades when pitch data missing.

**Theme + a11y:**
- [ ] Target chip readable in dark theme.
- [ ] When light theme exists, chip switches to `accentDark` + white text and stays readable.
- [ ] VoiceOver announces each reveal transition.
- [ ] Reduce Motion → mic pulse disabled; static icon.

**Data:**
- [ ] New `voice_attempts` rows have `attempts_count` values matching actual retry counts.
- [ ] Progress page speaking-accuracy panel no longer shows universal 0%.
- [ ] Session Complete counts, streak, daily_stats unchanged (regression).

**Pre-work confirmation:**
- [ ] Capture `SELECT count(*) FROM voice_attempts WHERE attempted_at < '2026-04-19'` *before* DELETE.
- [ ] Run DELETE.
- [ ] Recapture count *after* (expect 0).
- [ ] Record both in handoff note.

### Exit criteria

All manual-verification checkboxes green. Specifically:
1. Full 4-try ladder verified on a vocab word *with* pitch data (e.g., 指導) and one *without* (to exercise the graceful-degrade path).
2. Both themes' chip contrast verified (light theme deferred if not yet shipped — document expectation for its future rollout).
3. VoiceOver announces transitions on at least one device.
4. No regressions in Session Complete, streak, daily_stats, SRS scheduling.
5. DELETE row-count delta recorded.

---

## Deploy order

1. **Merge migration + schema update.** Apply to prod via Supabase migrations CLI. Verify `\d voice_attempts` shows `attempts_count`.
2. **Deploy API.** Smoke-test that `POST /v1/review/reading-eval` accepts the new field (200 response on synthetic payload).
3. **Run the cross-user DELETE.** Capture row-count delta in commit/handoff.
4. **EAS build mobile.** Install on device.
5. **On verification pass:**
   - Flip `voice_attempts` cleanup entry + Speaking refactor entry to `✅ Shipped` in `ENHANCEMENTS.md`.
   - Close the Build 3-C homophone entry in `BUGS.md` — the structural Phase 4 fix is now fully live.

## Rollback

| Component | Rollback |
|---|---|
| Migration 0022 | `ALTER TABLE voice_attempts DROP COLUMN attempts_count;` — safe. |
| API | Prior version ignored `attemptsCount` naturally; forward-compatible. Previous App Runner image redeployable without data migration. |
| Mobile | EAS build rollback via TestFlight. |
| Pre-work DELETE | **One-way door — not reversible.** Data was known-invalid by design. |

---

## Deferred / staged enhancements (future hooks)

- **`attempts_count` → SRS integration.** Owner explicitly framed `attempts_count` as an objective retrieval-difficulty signal analogous to the subjective Again/Hard/Good/Easy self-grade. Wire-up belongs in the upcoming *Learning Engine / Advanced Study / AI Study Plan / Three-Modality Loops* brainstorm. Do not touch SM-2 in this refactor.
- **Difficulty picker restoration as a "starting-tier" preference.** Maps the existing `kl:voice_difficulty` SecureStore value onto where on the ladder a drill starts. Logged in `ENHANCEMENTS.md` with the rationale that the ladder's baseline needs to be validated in isolation first.
- **Android verification.** Same carve-out as the original Phase 4 spec.

---

## Open questions resolved (audit trail)

| Question | Decision |
|---|---|
| Target-kanji visual indicator | Option A — amber chip behind the target character, theme-aware |
| Relationship to Build 3-C Phase 4 | This refactor **completes** Phase 4 + folds in Phase 5 hygiene |
| `attempts_count` storage | New column on `voice_attempts`; collection-only (no SRS wiring yet) |
| Column name | `attempts_count` (not `attempt_number`) |
| On-success behaviour | Manual advance via Next Kanji button at every tier (no auto-advance) |
| Max-retry / bail | No forced stop; Next Kanji button appears as bail option from try 4+ onward; bail counts as missed |
| Pitch accent on try 4+ | Force-revealed regardless of user toggle |
| `attempts_count` ownership | Client owns the counter; passes it in POST body; server stores verbatim |
| `TargetChip` data source | Server adds `targetKanji` to `voicePrompt`; client fallback to `currentItem.character` |
| Difficulty picker | JSX removed; state + SecureStore preserved for future restoration |
| Meaning semantics | Kanji meaning on try 2+; vocab meaning on try 4+ and Success card; both labelled on Success card |
| Pre-work DELETE scope | Cross-user — all pre-2026-04-19 `voice_attempts` rows wiped |
| Interstitial style | Inline banner, not full-screen modal; auto-dismisses ~1.5s |
| Target chip multi-occurrence | Chip every occurrence of target kanji within the word |
