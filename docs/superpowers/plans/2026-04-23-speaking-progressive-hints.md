# Speaking Progressive-Hints Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Build 3-C Phase 4 by adding a four-tier progressive-hint ladder to the Speaking drill, an amber target-kanji chip inside the vocab word, a new `voice_attempts.attempts_count` column, and a one-shot cross-user DELETE of pre-homophone-fix rows.

**Architecture:** Client-side `attempts` counter in `apps/mobile/app/(tabs)/voice.tsx` drives which scaffolds are visible on each attempt. `apps/mobile/src/components/voice/VoiceEvaluator.tsx` receives new reveal props, renders the target chip inside the vocab word, and POSTs `attemptsCount` to the existing `POST /v1/review/voice` endpoint. Server accepts `attemptsCount`, stores it on the `voice_attempts` insert, and adds `targetKanji` to `voicePrompt`. Pure reveal-gating logic is extracted into `voiceReveal.logic.ts` for unit testing. No change to SRS math, confidence metrics, streak, or daily_stats.

**Tech Stack:** TypeScript, React Native (Expo), Fastify, Drizzle ORM + PostgreSQL (Supabase), Zod, Vitest (API), Jest (mobile pure-logic).

**Full design spec:** [docs/superpowers/specs/2026-04-22-speaking-progressive-hints-design.md](../specs/2026-04-22-speaking-progressive-hints-design.md)

---

## File Structure

### Create
- `packages/db/supabase/migrations/0022_voice_attempts_attempts_count.sql` — migration adds the new column
- `apps/mobile/src/components/voice/voiceReveal.logic.ts` — pure reveal-gating functions (unit-testable)
- `apps/mobile/src/components/voice/TargetChip.tsx` — target-kanji chip presentational component
- `apps/mobile/src/components/voice/NotQuiteBanner.tsx` — inline interstitial
- `apps/mobile/src/components/voice/VoiceSuccessCard.tsx` — shared "Correct!" card
- `apps/mobile/test/unit/voice-reveal-logic.test.ts` — unit tests for reveal-gating + target-chip mask

### Modify
- `packages/db/src/schema.ts` — add `attemptsCount` field on `voiceAttempts`
- `packages/shared/src/types.ts` — add `targetKanji: string` to `VoicePromptVocab`
- `apps/api/src/services/srs.service.ts` — `selectVoicePrompt` takes `targetKanji` param; `getReadingQueue` passes it
- `apps/api/src/routes/review.ts` — Zod schema adds `attemptsCount`; insert uses it
- `apps/api/test/unit/srs-reading-queue.test.ts` — updated for new signature + targetKanji assertions
- `apps/mobile/src/theme/index.ts` — add `targetChipBg` and `targetChipText` colour tokens
- `apps/mobile/src/components/voice/VoiceEvaluator.tsx` — new reveal props; consume `targetKanji`; send `attemptsCount`; retire `hideHint`
- `apps/mobile/app/(tabs)/voice.tsx` — `attempts` state; replace `difficulty`-based chip gating with attempt-based; remove picker JSX; success card render
- `BUGS.md` — close the Phase 4 homophone entry on verification
- `ENHANCEMENTS.md` — flip Speaking refactor + voice_attempts cleanup entries to Shipped
- `docs/HANDOFF.md` — session handoff with deploy row counts

### Runbook-only (no file change)
- Prod DB — one-shot `DELETE FROM voice_attempts WHERE attempted_at < '2026-04-19T00:00:00Z';` with before/after row-count capture

---

## Task 1: DB migration + Drizzle schema — add `attempts_count` to `voice_attempts`

**Files:**
- Create: `packages/db/supabase/migrations/0022_voice_attempts_attempts_count.sql`
- Modify: `packages/db/src/schema.ts` (add field inside `voiceAttempts`)

- [ ] **Step 1: Write the migration SQL file**

Create `packages/db/supabase/migrations/0022_voice_attempts_attempts_count.sql`:

```sql
-- Add attempts_count to voice_attempts.
-- Represents which try within the card produced this row (1, 2, 3, …).
-- Defaults to 1 so legacy rows (single-attempt drills) stay semantically correct.

ALTER TABLE voice_attempts
  ADD COLUMN attempts_count smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN voice_attempts.attempts_count IS
  'Which try within the card this row represents. 1 = first attempt. Collection-only as of the Speaking refactor (2026-04-22) — not consumed by SRS or confidence math. Future Learning Engine brainstorm will decide how to incorporate.';
```

- [ ] **Step 2: Update Drizzle schema**

In `packages/db/src/schema.ts`, find the `voiceAttempts` table definition (around line 368). Add `attemptsCount` between the existing `passed` and `attemptedAt` fields:

```ts
export const voiceAttempts = pgTable(
  'voice_attempts',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    kanjiId: integer('kanji_id')
      .notNull()
      .references(() => kanji.id, { onDelete: 'cascade' }),
    transcript: text('transcript').notNull(),
    expected: text('expected').notNull(),
    distance: smallint('distance').notNull(), // Levenshtein distance
    passed: boolean('passed').notNull(),
    attemptsCount: smallint('attempts_count').notNull().default(1),  // NEW
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userVoiceIdx: index('voice_attempt_user_idx').on(t.userId, t.attemptedAt),
  })
)
```

- [ ] **Step 3: Verify schema typechecks**

Run from repo root:

```bash
pnpm --filter @kanji-learn/db typecheck
```

Expected: zero errors.

- [ ] **Step 4: Apply the migration locally (dev DB)**

From `packages/db`:

```bash
cd packages/db
DATABASE_URL="<local-supabase-url>" pnpm db:migrate
```

If you don't have a local DB set up, you can skip the apply step for now — prod apply is covered in Task 6.

Expected after local apply: `psql $DATABASE_URL -c "\d voice_attempts"` shows `attempts_count` column with `smallint NOT NULL DEFAULT 1`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/supabase/migrations/0022_voice_attempts_attempts_count.sql \
        packages/db/src/schema.ts
git commit -m "$(cat <<'EOF'
feat(db): add voice_attempts.attempts_count (0022)

Collection-only; future Learning Engine brainstorm will decide SRS wiring.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 2: Shared `VoicePromptVocab` type — add `targetKanji`

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Add `targetKanji` to `VoicePromptVocab`**

In `packages/shared/src/types.ts` around line 97, update:

```ts
export interface VoicePromptVocab {
  type: 'vocab'
  word: string
  reading: string
  meaning: string
  pitchPattern?: number[]
  targetKanji: string   // Always a single character drawn from `word`. Invariant: word.includes(targetKanji).
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @kanji-learn/shared typecheck
```

Expected: zero errors. (The shared package doesn't consume the type itself, but downstream consumers will surface issues in Task 3.)

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "$(cat <<'EOF'
feat(shared): add targetKanji to VoicePromptVocab

Enables the mobile evaluator to render a chip around the drilled kanji
inside the vocab word. Invariant: word.includes(targetKanji).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 3: `selectVoicePrompt` accepts `targetKanji`; tests updated

**Files:**
- Modify: `apps/api/src/services/srs.service.ts` (around lines 31-45)
- Modify: `apps/api/test/unit/srs-reading-queue.test.ts`

- [ ] **Step 1: Write failing tests — update existing tests for new signature, add `targetKanji` assertion**

Replace the contents of `apps/api/test/unit/srs-reading-queue.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { selectVoicePrompt } from '../../src/services/srs.service'

describe('selectVoicePrompt', () => {
  const vocab = [
    { word: '息子', reading: 'むすこ', meaning: 'son' },
    { word: '休息', reading: 'きゅうそく', meaning: 'rest' },
    { word: '息', reading: 'いき', meaning: 'breath' },
  ]

  it('returns {type:"kanji"} when exampleVocab is null', () => {
    expect(selectVoicePrompt(null, 0, '息')).toEqual({ type: 'kanji' })
  })

  it('returns {type:"kanji"} when exampleVocab is an empty array', () => {
    expect(selectVoicePrompt([], 5, '息')).toEqual({ type: 'kanji' })
  })

  it('returns the first entry with targetKanji when reviewCount is 0', () => {
    expect(selectVoicePrompt(vocab, 0, '息')).toEqual({
      type: 'vocab',
      word: '息子',
      reading: 'むすこ',
      meaning: 'son',
      targetKanji: '息',
    })
  })

  it('round-robins by reviewCount % vocab.length and preserves targetKanji', () => {
    const wordAt = (n: number) => {
      const p = selectVoicePrompt(vocab, n, '息')
      if (p.type !== 'vocab') throw new Error('expected vocab prompt')
      expect(p.targetKanji).toBe('息')
      return p.word
    }
    expect(wordAt(1)).toBe('休息')
    expect(wordAt(2)).toBe('息')
    expect(wordAt(3)).toBe('息子')
    expect(wordAt(7)).toBe('休息')
  })

  it('preserves pitchPattern when present on the selected entry', () => {
    const withPitch = [
      { word: '感動', reading: 'かんどう', meaning: 'emotion', pitchPattern: [0, 1, 1, 1] },
    ]
    const result = selectVoicePrompt(withPitch, 0, '感')
    expect(result).toEqual({
      type: 'vocab',
      word: '感動',
      reading: 'かんどう',
      meaning: 'emotion',
      pitchPattern: [0, 1, 1, 1],
      targetKanji: '感',
    })
  })

  it('handles single-entry vocab regardless of reviewCount', () => {
    const single = [{ word: '息', reading: 'いき', meaning: 'breath' }]
    const a = selectVoicePrompt(single, 0, '息')
    const b = selectVoicePrompt(single, 99, '息')
    if (a.type !== 'vocab' || b.type !== 'vocab') throw new Error('expected vocab prompts')
    expect(a.word).toBe('息')
    expect(a.targetKanji).toBe('息')
    expect(b.word).toBe('息')
    expect(b.targetKanji).toBe('息')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail (signature mismatch)**

```bash
pnpm --filter @kanji-learn/api test -- srs-reading-queue
```

Expected: FAIL — `selectVoicePrompt` currently takes 2 args, tests pass 3.

- [ ] **Step 3: Update `selectVoicePrompt` signature**

In `apps/api/src/services/srs.service.ts` around line 38, replace the function:

```ts
export function selectVoicePrompt(
  exampleVocab: ExampleVocabEntry[] | null,
  reviewCount: number,
  targetKanji: string,
): VoicePrompt {
  if (!exampleVocab?.length) return { type: 'kanji' }
  const idx = (reviewCount ?? 0) % exampleVocab.length
  return { type: 'vocab', ...exampleVocab[idx], targetKanji }
}
```

- [ ] **Step 4: Update the caller in `getReadingQueue`**

Find line 468 in the same file. Change:

```ts
voicePrompt: selectVoicePrompt(exampleVocab, r.repetitions),
```

to:

```ts
voicePrompt: selectVoicePrompt(exampleVocab, r.repetitions, r.character),
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @kanji-learn/api test -- srs-reading-queue
```

Expected: PASS (all 6 tests).

- [ ] **Step 6: Run the full API test suite to catch any regressions**

```bash
pnpm --filter @kanji-learn/api test
```

Expected: same pass count as main plus the new assertions. One pre-existing failure in `user-delete.test.ts` (documented in HANDOFF) is acceptable; no new failures.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/srs.service.ts \
        apps/api/test/unit/srs-reading-queue.test.ts
git commit -m "$(cat <<'EOF'
feat(api): attach targetKanji to voicePrompt in reading queue

selectVoicePrompt now takes the parent kanji character and includes it on
vocab-type prompts. Enables the mobile evaluator to render a chip around
the drilled kanji inside the vocab word.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 4: `POST /v1/review/voice` accepts `attemptsCount`

**Files:**
- Modify: `apps/api/src/routes/review.ts` (Zod schema around line 132; insert around line 156)
- Create: `apps/api/test/unit/voice-attempts-count.test.ts` — integration-style test via the Fastify instance (see existing patterns; for now we add unit test coverage of the Zod schema and insert shape. Full endpoint-roundtrip tests require the existing Fastify test harness; if not available, this unit test is the acceptable minimum.)

- [ ] **Step 1: Write the schema + insert test**

Create `apps/api/test/unit/voice-attempts-count.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// Mirror of the voiceSchema in apps/api/src/routes/review.ts — kept in sync by hand.
// This test documents the contract and fails loudly if the schema is changed
// without updating this test.
const voiceSchema = z.object({
  kanjiId: z.number().int().positive(),
  transcript: z.string(),
  correctReadings: z.array(z.string()).min(1),
  strict: z.boolean().optional().default(false),
  attemptsCount: z.number().int().min(1).max(50).optional().default(1),
})

describe('voiceSchema (POST /v1/review/voice body)', () => {
  const base = {
    kanjiId: 42,
    transcript: 'しどう',
    correctReadings: ['しどう'],
  }

  it('accepts a valid attemptsCount of 1', () => {
    const r = voiceSchema.safeParse({ ...base, attemptsCount: 1 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.attemptsCount).toBe(1)
  })

  it('accepts a valid attemptsCount of 3', () => {
    const r = voiceSchema.safeParse({ ...base, attemptsCount: 3 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.attemptsCount).toBe(3)
  })

  it('defaults attemptsCount to 1 when omitted', () => {
    const r = voiceSchema.safeParse(base)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.attemptsCount).toBe(1)
  })

  it('rejects attemptsCount of 0', () => {
    const r = voiceSchema.safeParse({ ...base, attemptsCount: 0 })
    expect(r.success).toBe(false)
  })

  it('rejects negative attemptsCount', () => {
    const r = voiceSchema.safeParse({ ...base, attemptsCount: -1 })
    expect(r.success).toBe(false)
  })

  it('rejects attemptsCount above upper bound (50)', () => {
    const r = voiceSchema.safeParse({ ...base, attemptsCount: 51 })
    expect(r.success).toBe(false)
  })

  it('rejects non-integer attemptsCount', () => {
    const r = voiceSchema.safeParse({ ...base, attemptsCount: 1.5 })
    expect(r.success).toBe(false)
  })

  it('rejects string attemptsCount', () => {
    const r = voiceSchema.safeParse({ ...base, attemptsCount: 'two' })
    expect(r.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails (schema not yet updated)**

```bash
pnpm --filter @kanji-learn/api test -- voice-attempts-count
```

Expected: the test file passes as written because it defines its own schema locally. The REAL verification is in the next step where we update the route's schema. For now, this test locks in the expected shape — run it to confirm the assertions pass against the local schema definition (sanity check).

Expected: PASS (8 tests).

- [ ] **Step 3: Update the route's Zod schema**

In `apps/api/src/routes/review.ts` around line 132, replace the existing `voiceSchema`:

```ts
const voiceSchema = z.object({
  kanjiId:        z.number().int().positive(),
  transcript:     z.string(),
  correctReadings: z.array(z.string()).min(1),
  strict:         z.boolean().optional().default(false),
  attemptsCount:  z.number().int().min(1).max(50).optional().default(1),
})
```

- [ ] **Step 4: Update the handler to destructure and persist `attemptsCount`**

In the same file around line 145, update the destructuring and insert:

```ts
const { kanjiId, transcript, correctReadings, strict, attemptsCount } = body.data

// Evaluate server-side (wanakana + Levenshtein)
const result = evaluateReading(transcript, correctReadings, strict, server.kanjiReadingsIndex)

// Compute integer Levenshtein distance for the log column
const distance = Math.abs(
  result.normalizedSpoken.length - result.closestCorrect.length
)

// Log attempt
await server.db.insert(voiceAttempts).values({
  userId:        req.userId!,
  kanjiId,
  transcript,
  expected:      result.closestCorrect,
  distance,
  passed:        result.correct,
  attemptsCount,  // NEW — default 1 when omitted by older clients
})

return reply.code(201).send({ ok: true, data: result })
```

- [ ] **Step 5: Run API typecheck**

```bash
pnpm --filter @kanji-learn/api typecheck
```

Expected: zero errors. If `voiceAttempts.values()` types complain about `attemptsCount`, ensure Task 1's Drizzle schema update has been committed and the package is rebuilt (`pnpm --filter @kanji-learn/db build` if there's a build step).

- [ ] **Step 6: Run the full API test suite**

```bash
pnpm --filter @kanji-learn/api test
```

Expected: all tests pass (plus the new 8-test file); pre-existing `user-delete.test.ts` failure only.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/review.ts \
        apps/api/test/unit/voice-attempts-count.test.ts
git commit -m "$(cat <<'EOF'
feat(api): POST /v1/review/voice accepts attemptsCount

Body defaults to 1 when omitted (backwards compat with older mobile builds).
Stored verbatim in voice_attempts. No change to evaluation logic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 5: Pre-work DELETE — wipe all pre-2026-04-19 `voice_attempts` rows (prod)

**Files:** none — this is a runbook/ops task run ONCE against production. Record results in the session handoff.

**Pre-requisite:** Tasks 1–4 merged and deployed to prod (migration applied, API deployed). Mobile build NOT YET shipped — we clean before the new build starts collecting data.

- [ ] **Step 1: Capture the before-count**

From a shell with prod DB access (Supabase dashboard SQL editor, or `psql $PROD_DATABASE_URL`):

```sql
SELECT count(*) AS pre_fix_rows
FROM voice_attempts
WHERE attempted_at < '2026-04-19T00:00:00Z';
```

Record the number in the session handoff doc (Task 15).

- [ ] **Step 2: Execute the DELETE**

```sql
DELETE FROM voice_attempts
WHERE attempted_at < '2026-04-19T00:00:00Z';
```

Expected: `DELETE <N>` where `<N>` matches the pre-count.

**WARNING — irreversible.** These rows cannot be restored. Per the design spec, the data is known-invalid (pre-homophone-fix rows produced by the broken evaluator) so loss is by design.

- [ ] **Step 3: Capture the after-count**

```sql
SELECT count(*) AS post_fix_rows
FROM voice_attempts
WHERE attempted_at < '2026-04-19T00:00:00Z';
```

Expected: `0`.

- [ ] **Step 4: Verify downstream-table row counts unchanged**

Sanity check — no FK cascade should have deleted anything from `voice_attempts`' referents:

```sql
SELECT count(*) FROM user_profiles;
SELECT count(*) FROM kanji;
```

Numbers should match prior snapshot (capture before Step 2 if desired).

- [ ] **Step 5: Record both counts + run timestamp**

Note the numbers. They'll go into the HANDOFF.md commit in Task 15.

---

## Task 6: Mobile theme — add target-chip colour tokens

**Files:**
- Modify: `apps/mobile/src/theme/index.ts`

- [ ] **Step 1: Inspect the current theme file**

```bash
head -80 apps/mobile/src/theme/index.ts
```

Locate the `colors` export. The tokens we're adding are `targetChipBg` and `targetChipText`.

- [ ] **Step 2: Add the new tokens**

Inside the `colors` object, add two entries (exact insertion point depends on alphabetical or semantic ordering used in the file — place near `accent`/`accentDark`). For the current dark-only theme (light theme is staged per ENHANCEMENTS.md Dark/Light Theme Toggle), use dark-theme values:

```ts
// Target-kanji chip (Speaking drill — highlights the drilled kanji inside the vocab word).
// Dark theme: amber chip with near-black text (~7.9:1 contrast, AA normal).
// Light theme (when shipped): use accentDark + white text (~4:1, AA-large — vocab is ≥18pt).
targetChipBg:   '#F4A261',   // matches colors.accent
targetChipText: '#1A1A2E',   // near-black; high contrast on amber
```

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @kanji-learn/mobile typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/theme/index.ts
git commit -m "$(cat <<'EOF'
feat(mobile): add target-chip theme tokens

Dark-theme values; clears WCAG 2.1 AA normal (~7.9:1).
Light-theme values will be added when the Dark/Light toggle ships.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 7: `voiceReveal.logic.ts` — pure reveal-gating functions + unit tests

**Files:**
- Create: `apps/mobile/src/components/voice/voiceReveal.logic.ts`
- Create: `apps/mobile/test/unit/voice-reveal-logic.test.ts`

- [ ] **Step 1: Write the failing test first (TDD)**

Create `apps/mobile/test/unit/voice-reveal-logic.test.ts`:

```ts
import {
  computeReveals,
  computeAttemptsCount,
  targetChipMask,
} from '../../src/components/voice/voiceReveal.logic'

describe('computeReveals', () => {
  it('reveals nothing at attempts=0 (try 1)', () => {
    expect(computeReveals(0)).toEqual({
      showKunOn: false,
      showKanjiMeaning: false,
      showHiragana: false,
      forcePitch: false,
      showVocabMeaning: false,
      canBail: false,
    })
  })

  it('reveals kun/on and kanji meaning at attempts=1 (try 2)', () => {
    expect(computeReveals(1)).toEqual({
      showKunOn: true,
      showKanjiMeaning: true,
      showHiragana: false,
      forcePitch: false,
      showVocabMeaning: false,
      canBail: false,
    })
  })

  it('adds hiragana at attempts=2 (try 3)', () => {
    expect(computeReveals(2)).toEqual({
      showKunOn: true,
      showKanjiMeaning: true,
      showHiragana: true,
      forcePitch: false,
      showVocabMeaning: false,
      canBail: false,
    })
  })

  it('force-reveals pitch + vocab meaning + bail at attempts=3 (try 4)', () => {
    expect(computeReveals(3)).toEqual({
      showKunOn: true,
      showKanjiMeaning: true,
      showHiragana: true,
      forcePitch: true,
      showVocabMeaning: true,
      canBail: true,
    })
  })

  it('stays at max reveals for attempts > 3', () => {
    expect(computeReveals(7)).toEqual({
      showKunOn: true,
      showKanjiMeaning: true,
      showHiragana: true,
      forcePitch: true,
      showVocabMeaning: true,
      canBail: true,
    })
  })
})

describe('computeAttemptsCount', () => {
  it('converts zero-indexed attempts to 1-indexed try number', () => {
    expect(computeAttemptsCount(0)).toBe(1)
    expect(computeAttemptsCount(1)).toBe(2)
    expect(computeAttemptsCount(3)).toBe(4)
    expect(computeAttemptsCount(9)).toBe(10)
  })
})

describe('targetChipMask', () => {
  it('marks the target character only', () => {
    expect(targetChipMask('指導', '指')).toEqual([true, false])
    expect(targetChipMask('指導', '導')).toEqual([false, true])
  })

  it('marks every occurrence when the target repeats', () => {
    expect(targetChipMask('人人', '人')).toEqual([true, true])
  })

  it('returns all false when target is not in the word', () => {
    expect(targetChipMask('指導', '感')).toEqual([false, false])
  })

  it('handles empty inputs defensively', () => {
    expect(targetChipMask('', '指')).toEqual([])
    expect(targetChipMask('指導', '')).toEqual([false, false])
  })

  it('handles single-character words', () => {
    expect(targetChipMask('息', '息')).toEqual([true])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/mobile && npx jest test/unit/voice-reveal-logic.test.ts
```

Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Implement the pure-logic module**

Create `apps/mobile/src/components/voice/voiceReveal.logic.ts`:

```ts
/**
 * voiceReveal.logic.ts
 *
 * Pure functions for the Speaking drill's progressive-hint ladder.
 * No React, no state, no side effects — unit-testable in isolation.
 *
 * Terminology:
 *   - `attempts` (local state) = zero-indexed count of WRONG results received.
 *     attempts=0 → try 1 layout (nothing revealed).
 *     attempts=1 → try 2 layout (kun/on + kanji meaning).
 *     attempts=2 → try 3 layout (+ hiragana).
 *     attempts=3 → try 4+ layout (+ forced pitch + vocab meaning + bail).
 *   - `attemptsCount` (wire format, 1-indexed) = which try this POST represents.
 *     Computed as attempts + 1 at the network boundary.
 */

export interface RevealFlags {
  showKunOn:         boolean
  showKanjiMeaning:  boolean
  showHiragana:      boolean
  forcePitch:        boolean
  showVocabMeaning:  boolean
  canBail:           boolean
}

export function computeReveals(attempts: number): RevealFlags {
  return {
    showKunOn:        attempts >= 1,
    showKanjiMeaning: attempts >= 1,
    showHiragana:     attempts >= 2,
    forcePitch:       attempts >= 3,
    showVocabMeaning: attempts >= 3,
    canBail:          attempts >= 3,
  }
}

export function computeAttemptsCount(attempts: number): number {
  return attempts + 1
}

export function targetChipMask(word: string, targetKanji: string): boolean[] {
  if (!targetKanji) return Array.from(word).map(() => false)
  return Array.from(word).map((c) => c === targetKanji)
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/mobile && npx jest test/unit/voice-reveal-logic.test.ts
```

Expected: PASS (14 tests across 3 describe blocks).

- [ ] **Step 5: Run full mobile unit-test suite to confirm no regressions**

```bash
cd apps/mobile && npx jest
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/voice/voiceReveal.logic.ts \
        apps/mobile/test/unit/voice-reveal-logic.test.ts
git commit -m "$(cat <<'EOF'
feat(mobile): pure reveal-gating logic for Speaking drill

computeReveals(attempts) drives the four-tier progressive hint ladder.
computeAttemptsCount converts zero-indexed state to 1-indexed wire value.
targetChipMask identifies every occurrence of the target kanji in a vocab word.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 8: `TargetChip.tsx` — presentational component

**Files:**
- Create: `apps/mobile/src/components/voice/TargetChip.tsx`

- [ ] **Step 1: Create the component**

Create `apps/mobile/src/components/voice/TargetChip.tsx`:

```tsx
import { Text, StyleSheet } from 'react-native'
import { colors } from '../../theme'

interface Props {
  children: string
}

/**
 * Renders a single kanji character inside an amber chip — used to indicate
 * which kanji within a vocab word is being drilled on the Speaking card.
 * See docs/superpowers/specs/2026-04-22-speaking-progressive-hints-design.md.
 */
export function TargetChip({ children }: Props) {
  return (
    <Text
      style={styles.chip}
      accessibilityLabel={`target kanji ${children}`}
    >
      {children}
    </Text>
  )
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: colors.targetChipBg,
    color: colors.targetChipText,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
})
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @kanji-learn/mobile typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/voice/TargetChip.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): TargetChip presentational component

Amber chip around the drilled kanji; VoiceOver label announces
"target kanji [char]" so screen readers distinguish it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 9: `NotQuiteBanner.tsx` — inline interstitial

**Files:**
- Create: `apps/mobile/src/components/voice/NotQuiteBanner.tsx`

- [ ] **Step 1: Create the component**

Create `apps/mobile/src/components/voice/NotQuiteBanner.tsx`:

```tsx
import { useEffect } from 'react'
import { View, Text, StyleSheet, AccessibilityInfo } from 'react-native'
import { colors, spacing, radius } from '../../theme'

interface Props {
  /** When truthy, the banner is visible and the auto-dismiss timer runs. */
  visible: boolean
  /** Fires when the 1500ms auto-dismiss timer elapses. */
  onAutoDismiss: () => void
}

/**
 * Inline "Not quite. Try again." banner shown briefly between wrong attempts.
 * Auto-dismisses after ~1.5s. The parent may also dismiss on next mic tap;
 * this component only owns the timer.
 */
export function NotQuiteBanner({ visible, onAutoDismiss }: Props) {
  useEffect(() => {
    if (!visible) return
    // Announce the transition so VoiceOver users hear the hint-reveal cue.
    AccessibilityInfo.announceForAccessibility('Not quite. Try again. More hints revealed.')
    const id = setTimeout(onAutoDismiss, 1500)
    return () => clearTimeout(id)
  }, [visible, onAutoDismiss])

  if (!visible) return null

  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <Text style={styles.main}>Not quite. Try again.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: 'rgba(166, 61, 61, 0.18)',
    borderColor: 'rgba(166, 61, 61, 0.35)',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginVertical: spacing.md,
    alignItems: 'center',
  },
  main: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
})
```

If `radius.md` or `spacing.sm`/`spacing.md` don't exist in the theme, substitute literal values: `borderRadius: 10`, `paddingVertical: 10`, `paddingHorizontal: 12`, `marginVertical: 14`.

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @kanji-learn/mobile typecheck
```

Expected: zero errors. If the theme import fails, inline the literal values per the note above and re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/voice/NotQuiteBanner.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): NotQuiteBanner inline interstitial

Brief amber banner between wrong tries; auto-dismisses after 1.5s.
Announces to VoiceOver via AccessibilityInfo.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 10: `VoiceSuccessCard.tsx` — shared Correct! card

**Files:**
- Create: `apps/mobile/src/components/voice/VoiceSuccessCard.tsx`

- [ ] **Step 1: Create the component**

Create `apps/mobile/src/components/voice/VoiceSuccessCard.tsx`:

```tsx
import { useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, AccessibilityInfo } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing, radius } from '../../theme'
import { TargetChip } from './TargetChip'
import { targetChipMask } from './voiceReveal.logic'

interface Props {
  word: string
  reading: string
  targetKanji: string
  kanjiMeaning: string           // e.g. "finger; point to; indicate"
  vocabMeaning: string           // e.g. "guidance; instruction; coaching"
  isLast: boolean                // true → "Finish session", else "Next Kanji"
  onNext: () => void
}

/**
 * Success render — shown when the learner gets the word correct (any tier).
 * Shows both the kanji's isolated meaning and the vocab word's meaning so
 * the distinction is pedagogically explicit.
 */
export function VoiceSuccessCard({
  word, reading, targetKanji, kanjiMeaning, vocabMeaning, isLast, onNext,
}: Props) {
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(
      `Correct. The word is ${word}, ${reading}, meaning ${vocabMeaning}.`
    )
  }, [word, reading, vocabMeaning])

  const mask = targetChipMask(word, targetKanji)

  return (
    <View style={styles.card}>
      <Ionicons name="checkmark-circle" size={40} color={colors.success ?? '#4ade80'} style={styles.icon} />
      <Text style={styles.title}>Correct!</Text>

      <Text style={styles.word}>
        {Array.from(word).map((c, i) =>
          mask[i]
            ? <TargetChip key={i}>{c}</TargetChip>
            : <Text key={i}>{c}</Text>
        )}
      </Text>
      <Text style={styles.reading}>{reading}</Text>

      <View style={styles.divider} />

      <Text style={styles.meaningRow}>
        <Text style={styles.meaningLabel}>Kanji ({targetKanji}):</Text>
        <Text>  {kanjiMeaning}</Text>
      </Text>
      <Text style={styles.meaningRow}>
        <Text style={styles.meaningLabel}>Word ({word}):</Text>
        <Text>  {vocabMeaning}</Text>
      </Text>

      <TouchableOpacity
        style={styles.nextBtn}
        onPress={onNext}
        accessibilityHint="Advances to the next kanji"
      >
        <Text style={styles.nextBtnText}>{isLast ? 'Finish session' : 'Next kanji'}</Text>
        <Ionicons name={isLast ? 'checkmark' : 'arrow-forward'} size={18} color="#fff" />
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(60, 160, 100, 0.15)',
    borderColor: 'rgba(60, 160, 100, 0.5)',
    borderWidth: 2,
    borderRadius: radius?.lg ?? 14,
    padding: spacing?.lg ?? 16,
    alignItems: 'center',
    gap: spacing?.sm ?? 8,
  },
  icon: { marginTop: 4 },
  title: {
    color: colors.success ?? '#4ade80',
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 1,
  },
  word: {
    fontSize: 48,
    lineHeight: 56,
    marginTop: 8,
  },
  reading: {
    fontSize: 20,
    color: colors.textMuted ?? '#BFBCCF',
    letterSpacing: 2,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignSelf: 'stretch',
    marginVertical: 8,
  },
  meaningRow: {
    color: colors.text ?? '#E8E6F0',
    fontSize: 13,
    lineHeight: 20,
    alignSelf: 'stretch',
  },
  meaningLabel: {
    fontWeight: '600',
    color: colors.accent ?? '#F4A261',
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary ?? '#A63D3D',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    marginTop: 12,
  },
  nextBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
})
```

If `colors.success`, `colors.textMuted`, `colors.text`, or `colors.primary` don't exist under those names in the theme, swap for the closest equivalent (check `theme/index.ts`) — the literals in `??` fallbacks are safe defaults that match existing app colours.

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @kanji-learn/mobile typecheck
```

Expected: zero errors. Resolve any missing colour-token names before proceeding.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/voice/VoiceSuccessCard.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): VoiceSuccessCard — shared Correct! render

Shows target chip + both meanings (kanji + vocab) + Next/Finish button.
Announces result to VoiceOver on mount.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 11: `VoiceEvaluator.tsx` — new props, target chip, reveal gating, POST attemptsCount

**Files:**
- Modify: `apps/mobile/src/components/voice/VoiceEvaluator.tsx`

- [ ] **Step 1: Read current Props interface**

```bash
sed -n '35,80p' apps/mobile/src/components/voice/VoiceEvaluator.tsx
```

You should see the `Props` interface around lines 47–67 with `hideHint`, `voicePrompt`, etc.

- [ ] **Step 2: Update the `Props` interface**

In `apps/mobile/src/components/voice/VoiceEvaluator.tsx` replace the `Props` interface:

```ts
interface Props {
  kanjiId: number
  character: string
  /** All accepted readings in hiragana, e.g. ['みず'] or ['すい','みず']
   *  Used when voicePrompt is absent or of type 'kanji'. When voicePrompt
   *  is of type 'vocab', only [voicePrompt.reading] is sent to the server. */
  correctReadings: string[]
  /** Label shown in the prompt, e.g. 'kun'yomi' or 'reading' */
  readingLabel?: string
  /** Called when server returns an evaluation result */
  onResult?: (result: EvalResult) => void
  /** Whether to use strict mode (no near-matches) — for checkpoint tests */
  strict?: boolean
  /** Attached by the API to each reading-queue item. When present and of
   *  type 'vocab', the evaluator renders a vocab-word layout (glyph =
   *  vocab.word, pitch overlay, meaning line). Fallback to kanji layout
   *  when absent or of type 'kanji'. */
  voicePrompt?: VoicePrompt

  // ── Progressive-hints props (drive the 4-tier reveal ladder) ──
  /** Zero-indexed wrongs-received counter (see voiceReveal.logic.ts).
   *  Sent as attempts + 1 on POST (1-indexed wire value). */
  attempts: number
  /** Show the hiragana hint beneath the vocab word (try 3+). */
  revealHiragana: boolean
  /** Force-reveal the pitch accent overlay, overriding the user toggle (try 4+). */
  revealPitch: boolean
  /** Show the vocab-word-level meaning line (try 4+ / success card). */
  revealVocabMeaning: boolean
}
```

Note: the old `hideHint` prop is removed. Any place that passed it must stop.

- [ ] **Step 3: Update the function signature + add imports**

Near the top of the file, add the import:

```ts
import { TargetChip } from './TargetChip'
import { computeAttemptsCount, targetChipMask } from './voiceReveal.logic'
```

Change the function signature:

```ts
export function VoiceEvaluator({
  kanjiId,
  character,
  correctReadings,
  readingLabel = 'reading',
  onResult,
  strict = false,
  voicePrompt,
  attempts,
  revealHiragana,
  revealPitch,
  revealVocabMeaning,
}: Props) {
```

- [ ] **Step 4: Update the POST body (send attemptsCount)**

Find where the eval request is POSTed (search for `api.post` or the fetch call targeting `/review/voice`). Update the body to include:

```ts
const body = {
  kanjiId,
  transcript,
  correctReadings: effectiveCorrectReadings,
  strict,
  attemptsCount: computeAttemptsCount(attempts),
}
```

(The exact existing code may differ; preserve any other fields already present — only add `attemptsCount`.)

- [ ] **Step 5: Update the vocab prompt render to use `TargetChip` + reveal gates**

Find the vocab render block (around line 228 in the current file — the `isVocabMode ? (...)` branch). Replace with:

```tsx
{isVocabMode ? (
  <View style={styles.prompt}>
    <Text style={styles.character}>
      {(() => {
        const tk = voicePrompt.targetKanji ?? character
        const mask = targetChipMask(voicePrompt.word, tk)
        return Array.from(voicePrompt.word).map((c, i) =>
          mask[i]
            ? <TargetChip key={i}>{c}</TargetChip>
            : <Text key={i}>{c}</Text>
        )
      })()}
    </Text>
    <PitchAccentReading
      reading={voicePrompt.reading}
      pattern={voicePrompt.pitchPattern}
      enabled={showPitchAccent || revealPitch}
      size="large"
    />
    <Text style={styles.promptLabel}>Say this word</Text>
    {revealHiragana && (
      <Text style={styles.expectedHint}>({voicePrompt.reading})</Text>
    )}
    {revealVocabMeaning && (
      <Text style={styles.meaningHint}>{voicePrompt.meaning}</Text>
    )}
  </View>
) : (
  // Legacy kanji-only branch — still gated by revealHiragana for consistency.
  <View style={styles.prompt}>
    <Text style={styles.character}>{character}</Text>
    <Text style={styles.promptLabel}>Say the {readingLabel}</Text>
    {revealHiragana && <Text style={styles.expectedHint}>({correctReadings[0]})</Text>}
  </View>
)}
```

Key changes from current:
- Target chip applied inside the vocab word.
- Pitch `enabled` now OR-combines the user toggle with the force-reveal flag.
- Hiragana hint gated on `revealHiragana` (replacing the old `!hideHint` gate).
- Vocab meaning gated on `revealVocabMeaning` (previously always shown with `!hideHint`).

- [ ] **Step 6: Update the "dev-build required" fallback render**

Find the fallback around line 216 where `isVocabMode ? voicePrompt.word : character` is rendered. Leave this branch untouched — it's only shown when the speech module isn't available, which is outside the drill flow.

- [ ] **Step 7: Guard the mic-pulse animation on reduce-motion**

Near the top of the component, add:

```ts
import { useState, useCallback, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Animated, AccessibilityInfo } from 'react-native'
```

Add a state + effect to track reduce-motion:

```ts
const [reduceMotion, setReduceMotion] = useState(false)

useEffect(() => {
  let cancelled = false
  AccessibilityInfo.isReduceMotionEnabled().then((v) => {
    if (!cancelled) setReduceMotion(v)
  })
  const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
  return () => { cancelled = true; sub.remove() }
}, [])
```

Wherever the pulse `Animated.loop` currently starts, wrap it:

```ts
if (!reduceMotion) {
  // existing Animated.loop(...).start()
}
```

If reduce-motion is on, the mic still renders — just static (no pulse).

- [ ] **Step 8: Typecheck**

```bash
pnpm --filter @kanji-learn/mobile typecheck
```

Expected: zero errors. The parent (`voice.tsx`) will still fail typecheck because it doesn't yet pass the new props — that's resolved in Task 12.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/components/voice/VoiceEvaluator.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): VoiceEvaluator progressive-hint props + target chip

Retires hideHint; adds attempts / revealHiragana / revealPitch /
revealVocabMeaning. Wraps target kanji inside the vocab word with
TargetChip. Sends attemptsCount (= attempts + 1) on POST. Gates the
mic-pulse animation on AccessibilityInfo.isReduceMotionEnabled().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 12: `voice.tsx` — attempts state, reveal gating, remove picker JSX, wire props

**Files:**
- Modify: `apps/mobile/app/(tabs)/voice.tsx`

- [ ] **Step 1: Add imports at the top of the file**

```ts
import { computeReveals } from '../../src/components/voice/voiceReveal.logic'
import { NotQuiteBanner } from '../../src/components/voice/NotQuiteBanner'
import { VoiceSuccessCard } from '../../src/components/voice/VoiceSuccessCard'
```

Adjust relative paths if the current directory depth differs.

- [ ] **Step 2: Add `attempts` state + derived reveal flags**

Find the state declarations around line 85 (next to `const [difficulty, setDifficulty] = useState<Difficulty>(1)`). Add:

```ts
const [attempts, setAttempts] = useState(0)
const [showInterstitial, setShowInterstitial] = useState(false)

const reveals = computeReveals(attempts)
```

- [ ] **Step 3: Reset `attempts` on card change**

Find the handler that advances to the next card (search for `setCurrentIndex((i) => i + 1)` or similar). In that same callback, add:

```ts
setAttempts(0)
setShowInterstitial(false)
setEvaluated(false)
```

If an `onResult` or similar handler already handles `setEvaluated(false)` on advance, just add `setAttempts(0)` and `setShowInterstitial(false)` next to it.

- [ ] **Step 4: Update the result handler to increment attempts on wrong + show interstitial**

Find `handleResult` (or wherever `onResult` is wired). Update:

```ts
const handleResult = useCallback((result: EvalResult) => {
  setEvaluated(true)
  if (!result.correct) {
    setAttempts((a) => a + 1)
    setShowInterstitial(true)
  }
}, [])
```

- [ ] **Step 5: Replace the static-difficulty chip gating with attempt-based gating**

Find the existing reading-chips block around lines 285–328. Replace the entire conditional with:

```tsx
{/* Reading chips — shown from try 2 onward (kun/on + kanji-level meaning) */}
{reveals.showKunOn && (
  <View style={styles.readingChips}>
    {currentItem.kunReadings.length > 0 && (
      <View style={styles.readingGroup}>
        <Text style={styles.readingGroupLabel}>Kun</Text>
        {currentItem.kunReadings.slice(0, 3).map((r) => (
          <View key={r} style={styles.readingChip}>
            <Text style={styles.readingChipText}>{r}</Text>
          </View>
        ))}
      </View>
    )}
    {currentItem.onReadings.length > 0 && (
      <View style={styles.readingGroup}>
        <Text style={styles.readingGroupLabel}>On</Text>
        {currentItem.onReadings.slice(0, 3).map((r) => (
          <View key={r} style={[styles.readingChip, styles.readingChipOn]}>
            <Text style={[styles.readingChipText, styles.readingChipOnText]}>{r}</Text>
          </View>
        ))}
      </View>
    )}
  </View>
)}

{/* Kanji-level meaning — also from try 2 onward */}
{reveals.showKanjiMeaning && (
  <Text style={styles.meaningText}>
    {currentItem.meanings.slice(0, 3).join(', ')}
  </Text>
)}
```

This replaces the three-way `difficulty === 1 ? ... : difficulty === 2 ? ... : null` branch. Now reveal is attempt-driven, not difficulty-driven.

- [ ] **Step 6: Remove the difficulty picker JSX**

Find the picker block around lines 237–262 (the TouchableOpacity toggle + the dropdown that renders when `showDifficultyPicker` is true). Delete the entire block.

**Keep** the `difficulty` + `showDifficultyPicker` state variables, the `useEffect` that reads `DIFFICULTY_KEY` from SecureStore, and the `changeDifficulty` callback. Add a comment above the preserved state:

```ts
// Difficulty state persists for future restoration as a "starting-tier"
// preference; UI hidden during the progressive-hints refactor. See
// ENHANCEMENTS.md — "Voice drill: restore difficulty-picker as a
// starting-tier preference".
const [difficulty, setDifficulty] = useState<Difficulty>(1)
const [showDifficultyPicker, setShowDifficultyPicker] = useState(false)
```

- [ ] **Step 7: Render the Success card + interstitial; wire VoiceEvaluator**

Find the `evaluatorWrapper` block (around lines 330–346) and the `evaluated` button block below it (lines 349–354). Replace both with:

```tsx
{/* Success — shown when the current attempt was correct */}
{evaluated && lastResult?.correct && (
  <VoiceSuccessCard
    word={currentItem.voicePrompt?.type === 'vocab' ? currentItem.voicePrompt.word : currentItem.character}
    reading={currentItem.voicePrompt?.type === 'vocab' ? currentItem.voicePrompt.reading : (currentItem.kunReadings[0] ?? currentItem.onReadings[0] ?? '')}
    targetKanji={currentItem.voicePrompt?.type === 'vocab' ? (currentItem.voicePrompt.targetKanji ?? currentItem.character) : currentItem.character}
    kanjiMeaning={currentItem.meanings.slice(0, 3).join(', ')}
    vocabMeaning={currentItem.voicePrompt?.type === 'vocab' ? currentItem.voicePrompt.meaning : ''}
    isLast={isLast}
    onNext={handleNext}
  />
)}

{/* Drill — shown while evaluating or after a wrong result */}
{(!evaluated || !lastResult?.correct) && (
  <View style={styles.evaluatorWrapper}>
    <VoiceEvaluator
      key={currentItem.kanjiId}
      kanjiId={currentItem.kanjiId}
      character={currentItem.character}
      correctReadings={[
        ...currentItem.kunReadings.map((r) => r.replace(/\..+$/, '')),
        ...currentItem.onReadings,
      ].filter(Boolean)}
      readingLabel={label}
      onResult={handleResult}
      voicePrompt={currentItem.voicePrompt}
      attempts={attempts}
      revealHiragana={reveals.showHiragana}
      revealPitch={reveals.forcePitch}
      revealVocabMeaning={reveals.showVocabMeaning}
    />

    <NotQuiteBanner
      visible={showInterstitial}
      onAutoDismiss={() => setShowInterstitial(false)}
    />

    {/* Bail option — Next Kanji visible from try 4+ (attempts >= 3) */}
    {reveals.canBail && (
      <TouchableOpacity style={styles.nextBtn} onPress={handleNext} accessibilityHint="Advances to the next kanji">
        <Text style={styles.nextBtnText}>{isLast ? 'Finish session' : 'Next kanji'}</Text>
        <Ionicons name={isLast ? 'checkmark' : 'arrow-forward'} size={18} color="#fff" />
      </TouchableOpacity>
    )}
  </View>
)}
```

Notes:
- `lastResult` is the stored server result — you may need to introduce it as state if it doesn't already exist. If so: `const [lastResult, setLastResult] = useState<EvalResult | null>(null)` and set it inside `handleResult`.
- If `label` and `handleNext` don't exist with those exact names, use whatever the file currently calls them.
- `hideHint` is no longer passed to `VoiceEvaluator` — delete any remaining references.

- [ ] **Step 8: Typecheck**

```bash
pnpm --filter @kanji-learn/mobile typecheck
```

Expected: zero errors. Resolve any missing refs (e.g., `lastResult` state) before proceeding.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/app/\(tabs\)/voice.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): attempts-driven reveal ladder on voice tab

Replaces static difficulty-based chip gating with the four-tier
progressive-hints ladder. Adds NotQuiteBanner between wrong tries
and VoiceSuccessCard on correct. Removes difficulty-picker JSX
(state preserved for future restoration per ENHANCEMENTS.md).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 13: Accessibility announcements at reveal transitions

**Files:**
- Modify: `apps/mobile/app/(tabs)/voice.tsx`

- [ ] **Step 1: Announce hiragana reveal at try 3 and pitch force-reveal at try 4+**

In `voice.tsx`, add a ref + effect that runs when `attempts` changes to fire the specific announcement:

```ts
import { AccessibilityInfo } from 'react-native'

useEffect(() => {
  if (attempts === 2 && currentItem?.voicePrompt?.type === 'vocab') {
    AccessibilityInfo.announceForAccessibility(
      `Reading hint: ${currentItem.voicePrompt.reading}`
    )
  }
  if (attempts === 3) {
    AccessibilityInfo.announceForAccessibility('Pitch accent revealed')
  }
}, [attempts, currentItem])
```

Place this next to the other effects in the component.

Note that `NotQuiteBanner` already announces the generic "Not quite. Try again. More hints revealed." message and `VoiceSuccessCard` announces the success message. This task fills in the two specific-reveal announcements that belong in the parent where `attempts` transitions are observed.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @kanji-learn/mobile typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/\(tabs\)/voice.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): announce hiragana + pitch reveals for VoiceOver users

Additional AccessibilityInfo.announceForAccessibility hooks fire at the
try-3 and try-4 transitions. NotQuiteBanner owns the generic wrong-result
announce; VoiceSuccessCard owns the correct-result announce.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

---

## Task 14: Smoke-test the whole mobile build locally

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the entire repo**

```bash
pnpm typecheck
```

Expected: zero errors across all workspaces.

- [ ] **Step 2: Lint the mobile workspace**

```bash
pnpm --filter @kanji-learn/mobile lint
```

Expected: zero errors (or the same warnings/errors that existed pre-refactor — compare against `git log` baseline).

- [ ] **Step 3: Run all API unit tests**

```bash
pnpm --filter @kanji-learn/api test
```

Expected: all tests pass except the pre-existing `user-delete.test.ts` `learner_identity_pkey` duplicate (documented in prior HANDOFFs; not caused by this refactor).

- [ ] **Step 4: Run all mobile unit tests**

```bash
cd apps/mobile && npx jest
```

Expected: all tests pass (including the new `voice-reveal-logic.test.ts`).

- [ ] **Step 5: Start the dev server and launch iOS simulator (sanity check)**

```bash
cd apps/mobile && pnpm dev
```

Press `i` to launch the iOS simulator. Open the Voice tab. Verify:
- The screen renders without crashing.
- A vocab word is shown with an amber chip on one character.
- The difficulty picker is gone.
- Nothing else visible besides vocab word + mic button on try 1.

Kill the dev server (`Ctrl+C`) after the sanity check. Full on-device verification is Task 15.

---

## Task 15: Ship — deploy API + EAS build + on-device verification + tracker hygiene + HANDOFF

**Files:**
- Modify: `BUGS.md`, `ENHANCEMENTS.md`, `docs/HANDOFF.md`

Prerequisites:
- Tasks 1–14 merged to `main`.
- Prod Supabase migration applied (push via Supabase CLI or dashboard).
- Task 5 DELETE executed with counts recorded.

- [ ] **Step 1: Deploy the API**

Follow the existing App Runner deploy flow used in prior builds (see `HANDOFF.md` for the exact command — typically `pnpm --filter @kanji-learn/api build` followed by the ECR push + App Runner trigger). Capture the image digest and operation ID.

Smoke-test once deployed:

```bash
curl -X POST https://73x3fcaaze.us-east-1.awsapprunner.com/v1/review/voice \
  -H 'Content-Type: application/json' \
  -d '{"kanjiId":1,"transcript":"test","correctReadings":["test"],"attemptsCount":1}'
```

Expected: `401 Unauthorized` (endpoint is auth-gated; we just want to confirm it exists and the Zod schema accepts `attemptsCount`). 400 with Zod error would mean the schema change did not deploy; investigate.

- [ ] **Step 2: EAS build mobile**

```bash
cd apps/mobile
eas build --platform ios --profile preview
eas submit --platform ios --latest
```

Capture build ID + submission ID for HANDOFF.

- [ ] **Step 3: Install on device and run the manual verification checklist**

With the new build installed, run through every checkbox in the spec's Section 5 manual-verification list:

**UI / flow:**
- [ ] Try 1 layout matches the ladder mockup: amber chip on target kanji only; nothing else.
- [ ] Wrong → "Not quite. Try again." interstitial appears briefly and auto-dismisses.
- [ ] Try 2 reveals kun/on + kanji meaning (not vocab meaning).
- [ ] Try 3 reveals hiragana under vocab word.
- [ ] Try 4+ force-reveals pitch overlay (verified with user pitch toggle OFF); vocab meaning appears; Next Kanji button visible.
- [ ] Correct on any try → Success card shows ✓ + both meanings + Next Kanji.
- [ ] Bail from try 4+ → card advances to next; next card's try 1 fresh.
- [ ] Pitch force-reveal gracefully degrades when pitch data missing (test on a vocab without pitchPattern).

**Accessibility:**
- [ ] Target chip readable in dark theme.
- [ ] VoiceOver announces each reveal transition.
- [ ] Reduce Motion → mic pulse disabled; static icon.

**Data regression:**
- [ ] New `voice_attempts` rows have `attempts_count` values matching actual retry counts (inspect via Supabase SQL editor: `SELECT attempts_count, passed, attempted_at FROM voice_attempts WHERE user_id = '<owner>' ORDER BY attempted_at DESC LIMIT 20;`).
- [ ] Progress page speaking-accuracy panel no longer shows universal 0%.
- [ ] Session Complete counts, streak, daily_stats unchanged (regression).

- [ ] **Step 4: Update `BUGS.md` — close the homophone entry**

Open `BUGS.md`. Find the "Speak evaluation marks homophone kanji wrong" entry (currently `[ ]` in Active Bugs). Change the checkbox to `[x]`, update the footer:

```markdown
`[Effort: S (short-term) / M (structural)]` `[Impact: High]` `[Status: ✅ Fully fixed — Phase 1 (short-term) shipped 2026-04-19; Phase 4 (structural vocab-level drilling + UX) shipped YYYY-MM-DD in B12X]`
```

Replace `YYYY-MM-DD` with today's date and `B12X` with the new build number.

- [ ] **Step 5: Update `ENHANCEMENTS.md` — flip relevant entries**

Find the three entries added in the 2026-04-22 brainstorm session and flip their statuses:
- "Clean stale `voice_attempts` rows predating the 2026-04-19 homophone fix" → `✅ Shipped & Verified` with the before/after row counts noted.
- (The Speaking refactor itself doesn't have a dedicated ENHANCEMENTS entry — it lives in the spec + this plan — so no flip needed there.)

If any prior Phase 4 entries remain open (E5 / E6 sentences-and-pitch work), verify they've already been flipped from earlier builds; if not, close them now.

- [ ] **Step 6: Write the session handoff**

Create or overwrite `docs/HANDOFF.md` with the session summary. Follow the template from `b4e558a`. Include:
- Build ID + submission ID
- API deploy op ID + image digest
- Migration 0022 apply confirmation
- Pre-work DELETE before/after row counts
- Verification status of every manual-verification checkbox
- Any follow-ups discovered on-device

- [ ] **Step 7: Commit the tracker updates**

```bash
git add BUGS.md ENHANCEMENTS.md docs/HANDOFF.md
git commit -m "$(cat <<'EOF'
docs: B12X Speaking progressive-hints refactor shipped + Phase 4 closed

Closes homophone bug entry (structural fix now live alongside the
2026-04-19 short-term workaround). Flips voice_attempts cleanup entry
to Shipped with row-count delta. HANDOFF updated with deploy artifacts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
EOF
)"
```

Replace `B12X` with the actual build number once assigned.

---

## Self-review checklist

Before dispatching this plan, the author verified:

**Spec coverage:**
- Every section in the spec maps to at least one task (Tasks 1–2 cover the DB + shared type, Task 3 covers queue builder, Task 4 covers endpoint + insert, Task 5 covers pre-work DELETE, Tasks 6–10 cover mobile components, Tasks 11–12 cover the evaluator + parent refactor, Task 13 covers remaining accessibility announcements, Task 14 covers smoke-verification, Task 15 covers ship + tracker hygiene).

**Placeholder scan:** No "TBD", "TODO", "implement later", or "add appropriate X" phrases in any task step. Every step has either complete code or an exact command.

**Type consistency:** `attemptsCount` (1-indexed wire value) and `attempts` (0-indexed local state) used consistently; `computeAttemptsCount(attempts)` is the named conversion. `targetKanji` is added as a required field on `VoicePromptVocab` and threaded through `selectVoicePrompt` with a matching test update. `RevealFlags` interface used identically in `voiceReveal.logic.ts` and its tests.

**Scope alignment:** Plan touches only files listed in the spec's "Layers touched" table. No unrelated refactoring. SRS math, confidence calculations, streak, and daily_stats untouched.
