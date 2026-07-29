# SRS → FSRS Terminology & Attribution Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix copy that describes fixed-interval / SM-2-style scheduling the app hasn't run since the FSRS-5 migration (migration `0024`), and credit FSRS — currently credited nowhere — the same way `about.tsx` already credits KANJIDIC2 and KanjiVG.

**Architecture:** Pure copy and one new attribution card. No logic changes, no new types. Verification is TypeScript compiling plus a grep-based regression check that the specific wrong phrases are gone — there is no runtime behavior to unit-test here, and inventing assertions on English prose would be testing the wrong thing.

**Tech Stack:** React Native / Expo Router (existing `InfoSection`/`AttributionCard` patterns, unchanged).

## Global Constraints

- **"SRS" as a category term is not wrong and should not be blanket-replaced.** FSRS *is* a spaced repetition system; describing the status ladder or a review session generically as "SRS" is accurate. The bug is specifically: (a) strings that describe *fixed-interval, ease-factor, or SM-2-style* mechanics FSRS does not have, and (b) FSRS never being named anywhere. Fix those. Leave generic, accurate "SRS" usage alone — do not manufacture churn.
- **Scope, confirmed with the owner beyond the design spec's own file list:** `apps/mobile/app/(tabs)/progress.tsx`, `apps/mobile/app/(tabs)/index.tsx`, `apps/mobile/app/kanji/[id].tsx`, `apps/mobile/app/about.tsx`, `README.md`, `packages/db/src/schema.ts:123`. `browse.tsx` and `study.tsx` also match `SRS` but only in internal variable names and code comments, never rendered — out of scope, no user-facing text to fix there.
- **Verified facts to use, not invent:** FSRS's reference implementation `open-spaced-repetition/ts-fsrs` is **MIT licensed** (confirmed via `gh api repos/open-spaced-repetition/ts-fsrs`). Lead author **Jarrett Ye** (GitHub: `L-M-Sherlock`); the project describes itself as community-driven under the **Open Spaced Repetition** organization.
- **Verified from `packages/shared/src/srs.ts`:** a lapse (rating "Again") *shrinks* stability by a formula, capped at the current stability — it does **not** reset to a fixed "1 day." Any copy claiming a hard reset to 1 day is factually wrong under FSRS and must be corrected, not merely reworded.
- **No new tests** — this is prose. The check per task is: TypeScript compiles, and a grep for the specific retired phrase(s) returns nothing in the changed file.

---

### Task 1: `progress.tsx` — fix the one factually wrong string, name FSRS once

**Files:**
- Modify: `apps/mobile/app/(tabs)/progress.tsx`

- [ ] **Step 1: Fix the fixed-checkpoint claim (the only factual error on this screen)**

Find (inside `INFO_CONFIDENCE`, the `'Confidence vs retention'` entry):

```typescript
    title: 'Confidence vs retention',
    body: 'High confidence today doesn\'t mean permanent retention. The SRS confirms retention by making you recall a kanji again at 1 month, 3 months, 6 months. Only confident recall (Good/Easy) across all those intervals earns a burn.',
```

Replace with:

```typescript
    title: 'Confidence vs retention',
    body: 'High confidence today doesn\'t mean permanent retention. FSRS, the scheduling algorithm behind your reviews, only marks a kanji burned once its computed memory stability crosses roughly 6 months — reached through a sequence of confident recalls (Good/Easy) at gradually widening intervals, not a fixed 1/3/6-month checklist.',
```

The original claimed fixed calendar checkpoints (1, 3, 6 months); FSRS computes a continuously-growing stability value per card from your actual review history — there are no fixed checkpoints to hit.

- [ ] **Step 2: Name FSRS at the natural anchor point**

Find (the first, untitled entry in `INFO_BREAKDOWN`):

```typescript
const INFO_BREAKDOWN: InfoSection[] = [
  {
    body: 'Your kanji are sorted into five SRS stages. Each stage reflects how deeply the character is embedded in your long-term memory based on your review history.',
  },
```

Replace with:

```typescript
const INFO_BREAKDOWN: InfoSection[] = [
  {
    body: 'Your kanji are sorted into five stages by FSRS, the spaced-repetition algorithm behind your reviews. Each stage reflects how deeply the character is embedded in your long-term memory based on your review history.',
  },
```

- [ ] **Step 3: Verify no stale phrase remains and typecheck**

Run:
```bash
grep -n "1 month, 3 months, 6 months" apps/mobile/app/\(tabs\)/progress.tsx
```
Expected: no output (phrase is gone).

```bash
pnpm --filter @kanji-learn/mobile typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/mobile/app/(tabs)/progress.tsx"
git commit -m "fix(mobile): progress.tsx — correct fixed-checkpoint claim, credit FSRS

'Confidence vs retention' described 1/3/6-month fixed checkpoints
FSRS does not have — it grows stability continuously from review
history. Also names FSRS at the breakdown panel's natural anchor.
Generic 'SRS' usage elsewhere on this screen is accurate and left
unchanged."
```

---

### Task 2: `index.tsx` — remove the fabricated SM-2/Woźniak attribution

**Files:**
- Modify: `apps/mobile/app/(tabs)/index.tsx`

This is the file with the real problem: a paragraph naming Piotr Woźniak's SM-2 algorithm as *"the basis for this app's scheduling engine"* — false since the FSRS migration — plus two strings describing SM-2-style fixed doubling and a hard reset to 1 day, which `srs.ts` (Global Constraints) confirms FSRS does not do.

- [ ] **Step 1: Rewrite the burning-definition example (soften the implied fixed sequence)**

Find (inside `INFO_VELOCITY`, the `'What does "burning" a kanji mean? 🔥'` entry):

```typescript
    title: 'What does "burning" a kanji mean? 🔥',
    body: 'Every time you answer a card correctly, the SRS stretches its next review further into the future (1 day → 4 days → 2 weeks → 2 months…). When the interval grows to roughly 6 months, the kanji is marked as burned. Burned means you\'ve demonstrated genuine long-term recall — not just short-term familiarity. The character moves out of active rotation and surfaces only as an occasional surprise check to confirm you haven\'t forgotten it.',
```

Replace with:

```typescript
    title: 'What does "burning" a kanji mean? 🔥',
    body: 'Every time you answer a card correctly, FSRS stretches its next review further into the future — how far depends on how easily you recalled it and the character\'s own difficulty, so the pace varies card to card rather than following one fixed sequence. When the interval grows to roughly 6 months, the kanji is marked as burned. Burned means you\'ve demonstrated genuine long-term recall — not just short-term familiarity. The character moves out of active rotation and surfaces only as an occasional surprise check to confirm you haven\'t forgotten it.',
```

- [ ] **Step 2: Replace the false Woźniak/SM-2 attribution**

Find (inside `INFO_ACTIVITY`, the `'What is Spaced Repetition?'` entry):

```typescript
    title: 'What is Spaced Repetition?',
    body: 'Spaced Repetition is a learning technique that exploits the way human memory works: we forget things on a predictable curve, but a well-timed review resets and strengthens the memory. By scheduling reviews at the last possible moment before forgetting, the system forces your brain to work just hard enough to rebuild the memory — making it stick longer each time.\n\nThe underlying science goes back to psychologist Hermann Ebbinghaus, who mapped the "Forgetting Curve" in 1885. The modern algorithmic form — using an ease factor and expanding intervals — was pioneered by Piotr Woźniak in his SuperMemo software (1987). His SM-2 algorithm remains the foundation of most SRS apps today, and is the basis for this app\'s scheduling engine.',
```

Replace with:

```typescript
    title: 'What is Spaced Repetition?',
    body: 'Spaced Repetition is a learning technique that exploits the way human memory works: we forget things on a predictable curve, but a well-timed review resets and strengthens the memory. By scheduling reviews at the last possible moment before forgetting, the system forces your brain to work just hard enough to rebuild the memory — making it stick longer each time.\n\nThe underlying science goes back to psychologist Hermann Ebbinghaus, who mapped the "Forgetting Curve" in 1885. This app\'s scheduling engine runs FSRS (Free Spaced Repetition Scheduler), an open-source algorithm led by researcher Jarrett Ye that models each card\'s memory stability directly from your review history, rather than applying one fixed formula to every card. See the About screen for full credit.',
```

This is the fabricated-attribution fix — the false "SM-2 is the basis for this app's scheduling engine" claim is gone, replaced with the true one.

- [ ] **Step 3: Fix the fixed-doubling / hard-reset-to-1-day claim**

Find (inside `INFO_ACTIVITY`, the `'How intervals expand'` entry):

```typescript
    title: 'How intervals expand',
    body: 'Every time you answer a card correctly, its next review interval roughly doubles (e.g. 1 day → 4 days → 10 days → 3 weeks…). A wrong answer resets the interval back to 1 day. Over time, characters you know well drift to monthly or biannual reviews, while characters you struggle with stay in heavy daily rotation.',
```

Replace with:

```typescript
    title: 'How intervals expand',
    body: 'Every time you answer a card correctly, FSRS grows its computed memory strength for that character, pushing the next review further out — the exact jump depends on the character\'s difficulty and your past accuracy on it, not a fixed multiplier. A wrong answer shrinks that memory strength instead of resetting it to zero, so a well-established card recovers faster than a brand-new one would. Over time, characters you know well drift to monthly or biannual reviews, while characters you struggle with stay in heavy daily rotation.',
```

The original claimed a fixed ~2x multiplier and a hard reset to 1 day on any miss; `calculateNextReview` in `packages/shared/src/srs.ts` does neither — stability shrinks proportionally on a lapse, capped at the pre-lapse value, never reset to a fixed floor.

- [ ] **Step 4: Name FSRS at the velocity panel's natural anchor**

Find (inside `INFO_VELOCITY`, the first, untitled entry):

```typescript
const INFO_VELOCITY: InfoSection[] = [
  {
    body: 'Velocity tracks how actively and effectively you\'re learning kanji over time — not just how many cards you tap through, but how deeply you\'re building lasting memory. It is powered by a Spaced Repetition System (SRS), a scheduling method that times each review for the exact moment your brain is about to forget the character.',
  },
```

Replace with:

```typescript
const INFO_VELOCITY: InfoSection[] = [
  {
    body: 'Velocity tracks how actively and effectively you\'re learning kanji over time — not just how many cards you tap through, but how deeply you\'re building lasting memory. It is powered by FSRS, an open-source spaced-repetition algorithm that times each review for the exact moment your brain is about to forget the character.',
  },
```

- [ ] **Step 5: Verify the retired phrases are gone and typecheck**

Run:
```bash
grep -n "Woźniak\|SM-2\|SuperMemo\|resets the interval back to 1 day\|roughly doubles" apps/mobile/app/\(tabs\)/index.tsx
```
Expected: no output.

```bash
pnpm --filter @kanji-learn/mobile typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "apps/mobile/app/(tabs)/index.tsx"
git commit -m "fix(mobile): index.tsx — remove fabricated SM-2/Woźniak attribution

The most severe instance of the SRS/FSRS terminology problem: home
tab's 'What is Spaced Repetition?' panel named Piotr Woźniak's SM-2
as 'the basis for this app's scheduling engine' — false since the
FSRS-5 migration (0024). Replaced with accurate FSRS credit. Also
fixes two strings describing fixed-multiplier growth and a hard reset
to 1 day; srs.ts's lapse formula does neither. Generic 'SRS' usage
elsewhere on this screen is accurate and left unchanged."
```

---

### Task 3: `kanji/[id].tsx` — rename the "SRS Progress" card title

**Files:**
- Modify: `apps/mobile/app/kanji/[id].tsx`

**Interfaces:** none — a single JSX string literal, no props or types change.

- [ ] **Step 1: Rename the card title**

Find:

```typescript
            <Card title="SRS Progress">
```

Replace with:

```typescript
            <Card title="Review Progress">
```

`SRS_LABELS`, `SRS_COLORS`, and the `srsStatusBadge`/`srsStatusText` style keys are internal identifiers, never rendered — left unchanged; renaming them is unrelated churn.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/mobile/app/kanji/[id].tsx"
git commit -m "fix(mobile): rename kanji detail 'SRS Progress' card to 'Review Progress'

Not a factual error, but this screen was in scope for the
terminology sweep and the title implied a specific algorithm without
crediting it. Internal SRS_LABELS/SRS_COLORS identifiers are unchanged."
```

---

### Task 4: `about.tsx` — credit FSRS

**Files:**
- Modify: `apps/mobile/app/about.tsx`

**Interfaces:**
- Consumes: the existing `AttributionCard` component (defined in this same file, unchanged signature: `{ title, badge, badgeColor, icon, children }`).

- [ ] **Step 1: Add the FSRS card, alongside the existing KANJIDIC2 and KanjiVG cards**

Find (the KanjiVG `AttributionCard` closes, then the AI/Anthropic card opens):

```typescript
        </AttributionCard>

        {/* AI / Anthropic attribution */}
        <AttributionCard
          title="AI-Generated Mnemonics"
```

Replace with (inserting the new card between KanjiVG and AI/Anthropic — grouping it with the other "how the app works" credits rather than after the open-source-libraries catch-all):

```typescript
        </AttributionCard>

        {/* FSRS attribution */}
        <AttributionCard
          title="Spaced Repetition Algorithm"
          badge="MIT License"
          badgeColor={colors.info}
          icon="repeat"
        >
          <Text style={styles.attrBody}>
            Your review schedule is computed by{' '}
            <Text style={styles.bold}>FSRS</Text> (Free Spaced Repetition
            Scheduler), an open-source algorithm led by researcher{' '}
            <Text style={styles.bold}>Jarrett Ye</Text> and the{' '}
            <Text style={styles.bold}>Open Spaced Repetition</Text> community.
            FSRS estimates each card's memory stability from your actual
            review history, rather than applying one fixed schedule to every
            card.
          </Text>
          <TouchableOpacity
            style={styles.attrLink}
            onPress={() => Linking.openURL('https://github.com/open-spaced-repetition')}
          >
            <Ionicons name="open-outline" size={14} color={colors.accent} />
            <Text style={styles.attrLinkText}>github.com/open-spaced-repetition</Text>
          </TouchableOpacity>
        </AttributionCard>

        {/* AI / Anthropic attribution */}
        <AttributionCard
          title="AI-Generated Mnemonics"
```

`icon="repeat"` — verify this glyph name exists in the installed `@expo/vector-icons` Ionicons set before committing (Step 2); if not, substitute `"sync"` or `"refresh"`, both standard Ionicons names used for repetition/cycling.

- [ ] **Step 2: Verify the icon name resolves and typecheck**

Run:
```bash
grep -rn '"repeat"' node_modules/@expo/vector-icons/build/Ionicons* 2>/dev/null || echo "NOT FOUND — use sync or refresh instead"
```
If `NOT FOUND`, edit the card to use `icon="sync"` instead of `icon="repeat"`.

```bash
pnpm --filter @kanji-learn/mobile typecheck
```
Expected: no errors — `CardProps.icon` is typed `keyof typeof Ionicons.glyphMap`, so an invalid name fails typecheck, not just at runtime.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/about.tsx
git commit -m "feat(mobile): credit FSRS on the About screen

KANJIDIC2 and KanjiVG were carefully attributed here; the FSRS
scheduling algorithm the app runs was credited nowhere. Adds a card
matching the existing AttributionCard pattern: MIT license, Jarrett
Ye / Open Spaced Repetition, link to the GitHub org."
```

---

### Task 5: `README.md` — fix the SM-2 claim, add FSRS

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Fix the schema table's stale description**

Find (in the `## Database Schema (key tables)` code block):

```
user_kanji_progress — SM-2 SRS state per user per kanji (status, ease, interval,
                      next_review_at, reading_stage)
```

Replace with:

```
user_kanji_progress — FSRS-5 state per user per kanji (status, stability,
                      difficulty, next_review_at, reading_stage)
```

`ease`/`interval` were the SM-2-era column names; the table has held `stability`/`difficulty` since migration `0024`.

- [ ] **Step 2: Fix the architecture-notes bullet**

Find (in `## Architecture Notes`):

```
- **SRS algorithm** — SM-2 with statuses: `unseen → learning → reviewing → remembered → burned`
```

Replace with:

```
- **Scheduling algorithm** — FSRS-5 (Free Spaced Repetition Scheduler, open-source, MIT licensed — see `packages/shared/src/srs.ts`), with statuses: `unseen → learning → reviewing → remembered → burned`
```

- [ ] **Step 3: Verify the stale claim is gone**

Run:
```bash
grep -n "SM-2" README.md
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): fix stale SM-2 references — engine has been FSRS-5 since migration 0024

Database Schema table and Architecture Notes both still described
the pre-migration SM-2 column names and algorithm."
```

---

### Task 6: `schema.ts:123` — fix the dangling ACKNOWLEDGEMENTS reference

**Files:**
- Modify: `packages/db/src/schema.ts:122-123`

No `ACKNOWLEDGEMENTS` file exists anywhere in the tree (verified: only CocoaPods build artifacts match that name). The attribution this comment points at already lives in `apps/mobile/app/about.tsx` (Task 4 adds the FSRS card there too) — correcting the comment to point at the real location is simpler than creating a second, redundant attribution file that could drift out of sync with the in-app one.

- [ ] **Step 1: Fix the comment**

Find:

```typescript
    // ── KANJIDIC2 reference codes ──────────────────────────────────────────
    // Sourced from KANJIDIC2 (EDRDG, CC BY-SA 4.0). See ACKNOWLEDGEMENTS.
```

Replace with:

```typescript
    // ── KANJIDIC2 reference codes ──────────────────────────────────────────
    // Sourced from KANJIDIC2 (EDRDG, CC BY-SA 4.0). Full attribution in the
    // app's About screen (apps/mobile/app/about.tsx) — no standalone
    // ACKNOWLEDGEMENTS file exists in this repo.
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @kanji-learn/db typecheck`
Expected: no errors (comment-only change).

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema.ts
git commit -m "fix(db): correct dangling ACKNOWLEDGEMENTS reference in schema.ts

No such file exists in the repo (only CocoaPods build artifacts match
the name). The attribution it pointed at lives in the app's About
screen — point the comment there instead of creating a second,
easily-stale copy."
```

---

## Self-Review Notes

**Spec coverage:** §13's three numbered items (progress.tsx sweep, FSRS credited nowhere, dangling ACKNOWLEDGEMENTS comment) are covered by Tasks 1, 4, 6. The user-confirmed scope expansion (index.tsx, kanji/[id].tsx) is covered by Tasks 2–3, with the reasoning for the expansion recorded in Global Constraints rather than silently absorbed. §13 point 4 ("new copy must not inherit the wrong vocabulary") is a forward-looking guideline for other plans, not an action item here — nothing to implement.

**Placeholder scan:** none — every string replacement shows exact before/after text; the FSRS attribution facts (license, author, org) are cited from verified sources (`gh api`, WebFetch), not invented.

**Type consistency:** `AttributionCard`'s `CardProps` shape (`title`, `badge`, `badgeColor`, `icon`, `children`) is unchanged by Task 4 — the new card is a consumer, not a modification, and Step 2 explicitly guards the one real risk (an invalid Ionicons glyph name) with a typecheck-enforced check rather than assuming it resolves.
