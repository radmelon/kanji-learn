# Build 3-C Design — Vocab as the Drill Unit

**Date:** 2026-04-19
**Target build:** B125 (single EAS build at end of mobile phase)
**Status:** Draft pending user review

---

## Summary

The voice/reading review modality shifts from **kanji-level prompts** (show `感`, speak `かん`) to **vocab-level prompts** (show `感動`, speak `かんどう`). All other review modalities — meaning recall, writing, quiz — remain kanji-level. SRS scheduling remains kanji-level. This build also expands the `example_vocab` and `example_sentences` data, ingests pitch accent from Kanjium, opportunistically ingests Kyōiku grade data from Kanjidic2, and ships a server-side homophone workaround as a standalone safety net.

### Why this build exists

The current Speak evaluation is unreliable for any kanji with a common-reading homophone. Root cause (logged in BUGS.md, 2026-04-19): the iOS `ja-JP` speech recognizer performs lexical conversion and often returns a *kanji* transcript rather than phonetic hiragana; the server's `wanakana.toHiragana` cannot convert kanji to readings, so exact-match fails even when the learner spoke correctly. Switching the drill surface to multi-character vocab dramatically reduces lexical ambiguity, and pitch accent (E6) naturally belongs on vocab entries, not isolated kanji. E5 (vocab expansion) supplies the data; both land together as one umbrella.

### What ships together

| # | Name | Layer |
|---|------|-------|
| 1 | E5 vocab + sentence expansion (5–10 vocab, 3–5 sentences per kanji; closes B4) | DB / seed scripts |
| 2 | E6 Kanjium pitch ingest (Tokyo-primary pattern only) | DB / seed scripts |
| 3 | Vocab-Speak drill (voicePrompt on reading queue; vocab-as-prompt UX) | API + mobile |
| 4 | Homophone short-term fix (server-side kanji→reading expansion) | API |
| 5 | Opportunistic Kanjidic2 grade ingest (unblocks E11; no UI in 3-C) | DB / seed scripts |

### Explicit non-goals

- **E8** Drill Weak Spots scope refinement → Build 3-D
- **E16** Broaden streak → Build 3-D
- **E11** Grade-level badges UI / leaderboard column / social notifications — data-only here; feature ships separately
- **Vocab as primary SRS unit** — logged as future refinement; kanji-level SRS unchanged
- Dedicated on-yomi vs kun-yomi voice drills (distinction dropped in voice modality)
- Pitch notation styles other than NHK overline (locked)
- Multi-pattern pitch variants / dialectal / heiban-drift (locked to Tokyo primary)
- Android platform-specific verification (deferred; same API, should work)
- Any change to core SRS math, daily_stats, confidence analytics, or streak logic
- Pre-launch items (Supabase us-east-1 migration, Secrets Manager migration)

---

## Architecture

**One-line summary:** The reading/voice modality's *prompt* and *target answer* become vocab-level; everything downstream of the grade stays kanji-level and unchanged.

### Data flow (voice drill only)

```
Dashboard/Study tab
  → srs.service.ts::getReadingQueue
      returns kanji with an attached "voicePrompt" field
      (vocab-as-prompt chosen at queue time: rotated example_vocab entry,
       or {type:"kanji"} fallback if example_vocab is empty)
  → Mobile Study screen renders reading card:
      if voicePrompt.type === "vocab":
        render vocab word + pitch overlay (if toggle on)
        VoiceEvaluator evaluates against [vocab.reading]
      else:
        render kanji alone (today's behavior)
        VoiceEvaluator evaluates against [...kanji.onyomi, ...kanji.kunyomi]
  → POST /v1/review/voice with {kanjiId, transcript, correctReadings}
      evaluateReading() runs:
        1. wanakana normalise (unchanged)
        2. NEW: expand any remaining CJK chars via kanji-readings lookup
        3. exact match / Levenshtein as today
  → grade (0-5) feeds kanji's SRS (unchanged)
```

### What stays untouched

- SRS math (`user_kanji_progress` stage transitions, SM-2 intervals)
- `daily_stats`, streak logic, confidence/accuracy analytics
- Meaning-recall flow (kanji → meaning)
- Writing practice, quiz modalities
- Non-voice consumers of `example_vocab` (browse list, sentence cards) — they render whatever the expanded data contains
- Batched review submit path (fix from commit `d137b9c`)
- RLS policies — no new tables

---

## Data Layer

### Schema changes

Two small migrations and one jsonb field extension.

**Migration 0019** — `kanji.grade smallint` (nullable):

```sql
ALTER TABLE kanji ADD COLUMN grade smallint;
COMMENT ON COLUMN kanji.grade IS
  'Kyōiku grade from Kanjidic2: 1-6 = elementary grades, 8 = remaining Jōyō,
   9-10 = Jinmeiyō. NULL for kanji absent from Kanjidic2.';
```

**Migration 0020** — `user_profiles.show_pitch_accent boolean default true`:

```sql
ALTER TABLE user_profiles
  ADD COLUMN show_pitch_accent boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN user_profiles.show_pitch_accent IS
  'Whether pitch accent overlays render on readings. Default set per JLPT level
   at onboarding (N5/N4 → false, N3+/unsure → true). User-toggleable.';
```

The SQL-level default (`true`) applies to existing users who don't go through the new-user onboarding gate. For genuinely new signups, the onboarding flow writes an explicit value based on JLPT self-assessment — which may be `false` for beginners. Same column, two write paths; no conflict.

**`example_vocab` jsonb field extension** (no migration — jsonb is schemaless):

```jsonc
{
  "word": "感動",
  "reading": "かんどう",
  "meaning": "being deeply moved, emotion",
  "pitchPattern": [0, 1, 1, 1]   // optional; 0 = low mora, 1 = high mora
}
```

Entries without `pitchPattern` render without overlay. Same array schema for `example_sentences` — unchanged, just more entries.

### Seed pipeline

**Three data sources merged in one new script, `packages/db/src/seeds/seed-vocab-pitch.ts`:**

1. **JMdict** (vocabulary) — XML dump. Filter entries whose `keb` (kanji spelling) contains the target kanji. Rank by frequency markers (`news1`, `ichi1`, `spec1`, JLPT). Take top 5–10 per kanji.
2. **Kanjium** (pitch) — vendored snapshot at `packages/db/data/kanjium/accents-YYYY-MM-DD.json`. Look up `{word, reading}`; take first-listed (Tokyo-primary) pattern; convert to mora-flag array.
3. **Validator** — every `example_vocab` entry must satisfy `entry.word.includes(targetKanji)`. Rejects dropped with warning log (closes B4).

**Kanjidic2 seed** — either extends the above script or a new `seed-grade.ts`. Parses Kanjidic2 XML, extracts `<grade>` per kanji, writes to `kanji.grade`. Runs once; idempotent on re-run.

**Tatoeba sentence re-seed** — existing `packages/db/src/seeds/seed-sentences.ts` runs with cap raised from 2 to 5. Same validator: sentence must contain the target kanji.

**Seed warnings output:**

- Path: `packages/db/seed-output/seed-warnings-YYYY-MM-DD.json` (gitignored)
- Includes: summary counts, per-rejection records, below-floor kanji (<3 vocab)
- Console summary printed at end of run
- Seed script exits nonzero if any kanji is below floor (override with `--allow-below-floor` during development)
- Committed `packages/db/seed-output/README.md` explains what lives there

**No runtime dependency on any of these sources** — all resolved at seed time, results baked into the `kanji` table.

### Data volume

- ~2,294 kanji × ~7 vocab avg ≈ ~16K `example_vocab` entries
- ~2,294 kanji × ~4 sentences avg ≈ ~9K `example_sentences` entries
- Kanjium lookups: in-memory hash joins, negligible
- Total seed runtime: minutes, not hours

---

## Server Layer

Three changes in `apps/api/`, each independently deployable.

### Homophone workaround (`reading-eval.service.ts`)

**New in-memory index** loaded at server boot from the `kanji` table:

```ts
const kanjiReadingsIndex: Map<string, Set<string>> = new Map()
// "感" → {"かん", "かんじる", "かんずる"}
// "缶" → {"かん"}
```

~2,294 entries × ~5 readings each = ~11K entries; negligible memory. Primary refresh trigger is server restart (kanji readings only change on redeploys that include a seed). Secondary TTL of 6 hours as a safety net for the rare case where a seed runs without redeploying the API.

**Evaluation flow** (additive — the existing exact-match and Levenshtein paths are unchanged; expansion runs only if CJK chars survive normalise):

```
normalized = toHiragana(spoken)                        // wanakana, unchanged
if containsCJK(normalized):
  candidates = expand(normalized, kanjiReadingsIndex)  // cartesian, capped at 200
  for c in candidates:
    if c matches any correctReading: return correct, quality=5
  // fall through to old Levenshtein path with original normalized string
```

**New file:** `apps/api/src/services/kanji-readings-index.ts` — loads + exposes `expandKanjiToReadings(normalized): string[]`.

**Tests:** `apps/api/src/services/__tests__/reading-eval.homophone.test.ts` — fixtures for 感/缶, 紙/髪, 橋/箸 families; compound cases (感動, 紙袋).

### Vocab selection in `getReadingQueue`

Attach a `voicePrompt` field to each reading-queue item in `apps/api/src/services/srs.service.ts`:

```ts
type VoicePrompt =
  | { type: 'vocab'; word: string; reading: string; meaning: string; pitchPattern?: number[] }
  | { type: 'kanji' }

const vocab = kanji.example_vocab
if (vocab?.length) {
  const idx = (ukg.reviewCount ?? 0) % vocab.length   // round-robin rotation
  voicePrompt = { type: 'vocab', ...vocab[idx] }
} else {
  voicePrompt = { type: 'kanji' }
}
```

**Rotation:** indexed by `user_kanji_progress.reviewCount` — every vocab in the list surfaces once before repeating. Deterministic, stateless, free.

### `/v1/review/voice` — unchanged structurally

Request body unchanged. Mobile client sends `correctReadings` scoped to the prompt mode:
- Vocab mode: `[voicePrompt.reading]` (single-element)
- Fallback mode: `[...kanji.onyomi, ...kanji.kunyomi]` (today's behavior)

Server evaluates against whatever readings the client supplies. `voice_attempts` log schema unchanged.

### User profile field

Add `showPitchAccent` to the allowed PATCH fields in `apps/api/src/routes/user.ts`. Defaulted at onboarding per user's self-reported JLPT level.

### Files touched (server)

- NEW: `apps/api/src/services/kanji-readings-index.ts`
- NEW: `apps/api/src/services/__tests__/reading-eval.homophone.test.ts`
- `apps/api/src/services/reading-eval.service.ts` — call expand when CJK present
- `apps/api/src/services/srs.service.ts` — attach `voicePrompt` in `getReadingQueue`
- `apps/api/src/routes/review.ts` — reading-queue response type
- `apps/api/src/routes/user.ts` — allow `showPitchAccent` in PATCH
- `apps/api/src/server.ts` — load kanji-readings index at boot

---

## Mobile Layer

### Voice drill card — vocab prompt

`VoiceEvaluator.tsx` accepts a new `voicePrompt` prop. When `voicePrompt.type === 'vocab'`, the card renders:

```
    [vocab word, kanjiLarge typography]
    [pitch overlay if enabled + pattern present]
    "Say this word"                          ← label swap
    (hiragana reading)                        ← hint, respects hideHint
    small muted meaning text                  ← context; respects hideHint
    [ mic button ]
```

The meaning line follows the same `hideHint` prop behavior as the reading hint — shown by default, hidden together in Prompted/Recall/Challenge difficulty modes.

When `voicePrompt.type === 'kanji'`, today's layout renders unchanged. Fallback path stays live for kanji lacking vocab.

### Pitch accent component

New shared component: `apps/mobile/src/components/kanji/PitchAccentReading.tsx`.

```tsx
<PitchAccentReading
  reading="かんどう"
  pattern={[0, 1, 1, 1]}
  enabled={showPitch}
  size="large" | "medium" | "small"
/>
```

- If `enabled === false` OR `pattern` missing → plain reading (indistinguishable from today's text)
- If enabled + pattern present → NHK-style overline: per-mora `<Text>` with conditional `borderTopWidth` on high morae, a small drop hook at high→low boundaries via absolutely-positioned `<View>`
- Pure React Native — no SVG, no font combining chars

**Mora alignment helper** — `apps/mobile/src/lib/mora-alignment.ts`:

```ts
function alignMoraToKana(reading: string): string[]
```

- Small kana (ゃ/ゅ/ょ) group with preceding kana: `きゃく` → `['きゃ', 'く']`
- Sokuon (っ), hatsuon (ん), long vowel (ー) stand alone: `かった` → `['か', 'っ', 'た']`
- Returns null + dev warning if `pattern.length !== morae.length`

Pure function with full unit-test coverage; no RN dependency.

### Three render surfaces, one component

All three locations call the same `<PitchAccentReading>`:

1. Kanji details page (`apps/mobile/app/kanji/[id].tsx`) — example-vocab list
2. Study card reveal panel (`apps/mobile/src/components/study/KanjiCard.tsx`) — vocab/sentence rows
3. Voice drill prompt (`apps/mobile/src/components/voice/VoiceEvaluator.tsx`) — above the vocab word

One component, three consumers. Toggle flips all three atomically via the `enabled` prop bound to `preferences.showPitchAccent`.

### Preference toggle

Follows the existing Rōmaji toggle pattern:

- **Persistent storage:** `user_profiles.show_pitch_accent` (migration 0020) + zustand `preferences.store.ts` mirror for snappy UI
- **Default at account creation:**
  - Onboarding JLPT self-assessment N5 or N4 → `false`
  - Onboarding JLPT self-assessment N3, N2, N1, or "unsure" → `true`
- **Surfaces:**
  1. Profile tab → Study Preferences → "Show pitch accent markers on readings"
  2. Inline chip on kanji details page, adjacent to the existing Rōmaji chip

Toggling either surface writes through to the profile; both surfaces reflect the same source of truth.

### Files touched (mobile)

- NEW: `apps/mobile/src/components/kanji/PitchAccentReading.tsx`
- NEW: `apps/mobile/src/lib/mora-alignment.ts` + tests
- `apps/mobile/src/stores/preferences.store.ts` — add `showPitchAccent` slice
- `apps/mobile/app/kanji/[id].tsx` — wrap example-vocab readings + add inline toggle chip
- `apps/mobile/src/components/study/KanjiCard.tsx` — wrap reveal-panel vocab/sentence readings
- `apps/mobile/src/components/voice/VoiceEvaluator.tsx` — render pitch overlay + vocab prompt path
- `apps/mobile/app/(tabs)/study.tsx` — thread `voicePrompt` from queue item
- `apps/mobile/app/(tabs)/profile.tsx` — Study Preferences section with toggle

---

## Rollout Sequencing

Five phases. Each earlier phase is independently deployable and reversible. Only **one EAS build** (B125) at end of Phase 4.

### Phase 1 — Server homophone workaround (~0.5 session)

Ships alone. Fixes the Speak bug for every reading card today — including the plain-kanji prompts still in the field.

- `kanji-readings-index.ts` + `expandKanjiToReadings()`
- Wire into `reading-eval.service.ts`
- Homophone fixture tests
- Deploy: `DOCKER_CONTEXT=default ./scripts/deploy-api.sh`

**Exit:** on whatever TestFlight build is currently in testers' hands (B124 at time of writing), tapping Speak on a reading card that previously misheard 缶 now accepts it. No client change required — the fix is purely server-side.

### Phase 2 — Data layer (~1 session)

1. Apply migrations 0019, 0020 to prod via `psql`
2. Vendor Kanjium snapshot to `packages/db/data/kanjium/`
3. Write `seed-vocab-pitch.ts` (JMdict + validator + Kanjium merge)
4. Extend / add Kanjidic2 seed for `kanji.grade`
5. Rerun Tatoeba sentence seed (cap 2 → 5)
6. Run seeds locally against a dev DB first; verify counts; spot-check 息 for B4 closure; then apply migrations + seeds to prod via `psql`

**Exit:** `SELECT example_vocab FROM kanji WHERE id=1599` returns 5–10 entries, all containing 息, at least one with `pitchPattern`.

### Phase 3 — API `getReadingQueue` `voicePrompt` (~0.3 session)

- Extend `SrsService.getReadingQueue`
- Update `review.ts` response type
- Add `showPitchAccent` to PATCH allowed fields
- Deploy

**Exit:** `GET /v1/review/reading-queue` includes `voicePrompt` per entry. B124 clients (unaware of the field) continue to work.

### Phase 4 — Mobile (~1.5 sessions)

Order of work:
1. `mora-alignment.ts` + tests (pure helper, fast TDD)
2. `PitchAccentReading.tsx` (can integrate with null pattern before visual polish)
3. Thread `voicePrompt` through study.tsx → VoiceEvaluator; render vocab-mode path
4. Integrate PitchAccentReading into three surfaces
5. `preferences.store.ts` slice + Profile toggle + details-page chip
6. **One EAS build** → B125

**Exit (on-device B125 verification):**
- Reading card for 感 surfaces 感動; mic accepts かんどう
- Empty-vocab kanji fall back to plain-kanji prompt cleanly
- Pitch overlay renders on 感動 when `showPitchAccent=true`; hides when false
- Profile toggle flips pitch across all three surfaces atomically
- Rōmaji toggle still works (regression check)
- 20-card reading session: `daily_stats.reviewed` matches server counts (regression check from B123)

### Phase 5 — Verification + tracker (~0.3 session)

- B125 on-device pass
- Close B4 (validator handles it as Phase 2 side effect)
- Close the homophone bug logged 2026-04-19
- Flip E5, E6 to Shipped
- Update HANDOFF.md

**Total: ~3.5 sessions. One EAS build.**

---

## Testing Strategy

### Unit tests (fast, pure)

- `reading-eval.homophone.test.ts` — 感/缶, 紙/髪, 橋/箸; vocab cases (感動, 紙袋); pathological-input cap
- `mora-alignment.test.ts` — きゃく, かった, long vowels, katakana readings, mismatch-returns-null
- `seed-vocab-validator.test.ts` — 息子 accepted, 呼吸 rejected under target kanji 息
- `kanjium-parse.test.ts` — ありがとう, 橋, 箸 produce expected pitchPattern arrays

### Integration tests

- `getReadingQueue` returns `voicePrompt` for vocab-bearing kanji; fallback for empty-vocab kanji; rotation advances by `reviewCount`
- `/v1/review/voice` with transcript `"缶"` against `["かん"]` returns `correct: true`

### Manual B125 verification checklist (entered into HANDOFF on delivery)

- [ ] Reading card for 感 surfaces a vocab word; speaking it is accepted
- [ ] Pitch overlay visible on 感動 when toggle ON; hidden when OFF
- [ ] Kanji details → example vocab list shows 5–10 entries, all containing the target
- [ ] Rōmaji toggle regression (still toggles romaji independently)
- [ ] 20-card reading session completes; daily_stats counts match server
- [ ] Profile → Study Preferences → pitch toggle flips all three surfaces

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Kanjium coverage gaps for rare vocab | Medium | Null `pitchPattern` handled; UI omits overlay |
| JMdict parse produces archaic/rare entries | Medium | Frequency-marker ranking; validator catches misaligned entries |
| Seed regression loses existing curated vocab | Low | Seed runs locally first; spot-check; review seed-warnings before prod apply |
| Existing users get pitch default=true and find it noisy | Low | Onboarding gates new users' default; existing users can toggle off |
| iOS recognizer returns kanji we can't resolve in our DB | Low-med | Homophone workaround covers 2,294 known kanji; edge-case misses fall back to today's behavior (no regression) |
| Cartesian explosion on 4+ kanji vocab | Very low | 200-candidate cap in expander |
| Pitch pattern length ≠ mora count (bad data) | Low | Mora-aligner returns null; component renders plain reading + dev warning |

---

## Open questions

None at time of writing — all scoping decisions resolved in 2026-04-19 brainstorming session (Q1–Q7 + two sub-decisions on sequencing and warning log location).
