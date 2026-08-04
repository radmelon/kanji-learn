# Coaching copy floor — implementation plan

> **Canonical URL — hand this to a new session:**
> https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/plans/2026-08-03-coaching-copy-floor.md

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Spec:
https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-03-coaching-copy-floor-design.md

**Goal:** Every coaching finding renders a specific, actionable sentence built
from its own `Evidence`, instead of a static string that ignores it.

**Architecture:** `templateCopy` becomes a `Record<FindingKind, Formatter>` of
per-kind formatters, each reading its own finding's evidence through
label constants shared with the detector that wrote them. A formatter that
cannot find its evidence returns `null` and the caller falls back to today's
base sentence, so the floor never regresses below what ships now. Two detectors
need new evidence that requires extending `LearnerSnapshot` and the assembly
layer; the other two additions are passthroughs.

**Tech stack:** TypeScript, Vitest. `packages/shared` for the copy and
detectors; `apps/api` only for the snapshot assembly in Task 2.

---

## Global Constraints

Every task's requirements implicitly include these.

1. **Never change an existing `Evidence.label` VALUE.** Slice 3's
   `buildCoachingPrompt` serialises `${e.label}: ${e.value}` into the LLM
   prompt, so a label rename silently changes what the model is told. Task 1
   extracts labels to constants; it must not alter a single string.
2. **A formatter that cannot build its sentence returns `null`.** Never
   `undefined` in output, never a half-built sentence. The caller substitutes
   the base string.
3. **Write full sentences.** Never leave a comparative, a pronoun, or a piece of
   jargon without its referent. "It will tighten as you do more" is the defect
   this plan exists to remove — see the spec's §13.
4. **Every test names, in a comment, the mutation it catches** — and the
   reviewer must confirm that mutation actually turns it red. Slice 3 shipped
   three tests whose comments named mutations they could not catch; all three
   were written by the plan's author and caught only because a reviewer checked
   the claim rather than the code.
5. **The analyzer stays pure.** No I/O, no clock, no `Date.now()`. Time enters
   through `snapshot.now` and formatters receive `now` from their caller.
6. **`mechanics_explainer` keeps its exemption** from hedging and escalation
   (`copy.ts:51`). It is fixed copy by contract.
7. **No migration, no API route change, no mobile change, no EAS build.**
   Task 2 touches `apps/api` only for snapshot assembly.

### Two traps that will not announce themselves

- **`periodEnd` is EXCLUSIVE.** `getLastCompletedPeriod` computes
  `periodEnd = addDays(weekStart, periodDays)` (`commitment.service.ts:253`),
  so a period starting 2026-07-20 has `periodEnd = 2026-07-27` and **covers 20
  to 26**. Copy that renders `periodEnd` raw says "between 20 and 27 July" for a
  period that ended on the 26th. Subtract one day for display. Task 5 has a test
  for exactly this.
- **`leech` emits up to THREE named kanji**, not four. `MAX_NAMED = 3`
  (`leech.ts:34`). A fixture with four is one the detector can never produce.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/shared/src/coaching/types.ts` | Modify | `EVIDENCE_LABELS`; `strokeCount`/`readingCount` on `PlacementItemOutcome`; `windowDays` on `ReviewSnapshot` |
| `packages/shared/src/coaching/detectors/*.ts` | Modify | Use the label constants; emit the new evidence |
| `apps/api/src/services/buddy/coaching.service.ts` | Modify | Supply the three new snapshot fields |
| `packages/shared/src/coaching/copy.ts` | Rewrite | The formatter table, the evidence and date helpers, the ten formatters |

`copy.ts` grows from ~85 lines to roughly 260. That is still one clear
responsibility — turning a `Finding` into a sentence — and splitting the
formatters into a second file would separate them from the base strings they
fall back to. Keep it in one file; revisit if it passes ~400 lines.

---

## Task 1: Evidence labels become exported constants

**Files:**
- Modify: `packages/shared/src/coaching/types.ts` (after the `Evidence` interface, ~line 35)
- Modify: all seven of `packages/shared/src/coaching/detectors/*.ts`
- Test: `packages/shared/src/coaching/labels.test.ts` (create)

**Interfaces:**
- Produces: `EVIDENCE_LABELS`, a frozen `as const` object. Every detector
  imports it; Tasks 4–6 read evidence through it.

**This task must not change behaviour at all.** Its entire value is that a
future rename becomes a compile error in two places instead of a silent
`undefined` in a learner-facing sentence — and, since slice 3, a silent change
to the LLM prompt.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/coaching/labels.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { EVIDENCE_LABELS } from './types'

describe('EVIDENCE_LABELS', () => {
  // MUTATION CAUGHT: changing any label's string value. Since slice 3,
  // buildCoachingPrompt serialises `${label}: ${value}` into the LLM prompt,
  // so a rename silently changes what the model is told about the learner —
  // and no test in apps/api asserts prompt content, by design (parent §10).
  // These values are a wire contract, not an implementation detail.
  it('pins every label string exactly', () => {
    expect(EVIDENCE_LABELS).toEqual({
      KANJI_GIVING_TROUBLE: 'kanji giving trouble',
      ACTIVE_KANJI: 'active kanji',
      LAPSES: 'lapses',
      MOST_LIKELY_LEVEL: 'most likely level',
      LOWER_BOUND: 'lower bound',
      UPPER_BOUND: 'upper bound',
      ABILITY_ESTIMATE: 'ability estimate',
      STANDARD_ERROR: 'standard error',
      MINUTES_PROMISED: 'minutes promised',
      MINUTES_STUDIED: 'minutes studied',
      HOOKS_BUILT: 'hooks built',
      SUGGESTED_KANJI: 'suggested kanji',
      AVG_LAPSES_WITH_HOOK: 'average lapses with a hook',
      AVG_LAPSES_WITHOUT_HOOK: 'average lapses without one',
      MEANING_ACCURACY: 'meaning accuracy',
      READING_ACCURACY: 'reading accuracy',
      EXPECTED_READING_PENALTY: 'expected reading penalty',
      ITEMS_WITH_READING_ASKED: 'items with a reading asked',
      QUIZ_READING_ACCURACY: 'quiz reading accuracy',
      QUIZ_MEANING_ACCURACY: 'quiz meaning accuracy',
      QUIZ_READING_ANSWERS: 'quiz reading answers',
      PERCENT_FASTER: 'percent faster',
      AVG_SECONDS_BEFORE: 'average seconds before',
      AVG_SECONDS_NOW: 'average seconds now',
      KANJI_MEASURED: 'kanji measured',
      ABILITY_THEN: 'ability then',
      ABILITY_NOW: 'ability now',
      MEASURED_ON: 'measured on',
      PREVIOUSLY_MEASURED_ON: 'previously measured on',
      HARDEST_KANJI_CLEARED: 'hardest kanji cleared',
      ITEM_DIFFICULTY: 'item difficulty',
      CURRENT_UNCERTAINTY: 'current uncertainty',
      UNCERTAINTY_WHEN_MEASURED: 'uncertainty when measured',
      DAYS_SINCE_THE_TEST: 'days since the test',
    })
  })

  // MUTATION CAUGHT: two constants pointing at the same string, which would
  // make a formatter's `find(e => e.label === X)` match another kind's
  // evidence item and render the wrong number.
  it('has no duplicate label values', () => {
    const values = Object.values(EVIDENCE_LABELS)
    expect(new Set(values).size).toBe(values.length)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @kanji-learn/shared test -- labels.test.ts
```

Expected: FAIL — `EVIDENCE_LABELS` is not exported from `./types`.

- [ ] **Step 3: Add the constants**

In `packages/shared/src/coaching/types.ts`, immediately after the `Evidence`
interface:

```ts
/**
 * Every `Evidence.label` the detectors emit.
 *
 * Shared between the detector that WRITES a label and the formatter in copy.ts
 * that READS it. Without this, a formatter matches a string literal and a
 * rename yields `undefined` inside a learner-facing sentence — the exact
 * failure mode that produced the note this work exists to fix.
 *
 * ⚠️ These strings are a WIRE CONTRACT, not an implementation detail. Slice 3's
 * buildCoachingPrompt serialises `${label}: ${value}` into the LLM prompt, so
 * renaming one changes what the model is told. labels.test.ts pins them.
 */
export const EVIDENCE_LABELS = {
  KANJI_GIVING_TROUBLE: 'kanji giving trouble',
  ACTIVE_KANJI: 'active kanji',
  LAPSES: 'lapses',
  MOST_LIKELY_LEVEL: 'most likely level',
  LOWER_BOUND: 'lower bound',
  UPPER_BOUND: 'upper bound',
  ABILITY_ESTIMATE: 'ability estimate',
  STANDARD_ERROR: 'standard error',
  MINUTES_PROMISED: 'minutes promised',
  MINUTES_STUDIED: 'minutes studied',
  HOOKS_BUILT: 'hooks built',
  SUGGESTED_KANJI: 'suggested kanji',
  AVG_LAPSES_WITH_HOOK: 'average lapses with a hook',
  AVG_LAPSES_WITHOUT_HOOK: 'average lapses without one',
  MEANING_ACCURACY: 'meaning accuracy',
  READING_ACCURACY: 'reading accuracy',
  EXPECTED_READING_PENALTY: 'expected reading penalty',
  ITEMS_WITH_READING_ASKED: 'items with a reading asked',
  QUIZ_READING_ACCURACY: 'quiz reading accuracy',
  QUIZ_MEANING_ACCURACY: 'quiz meaning accuracy',
  QUIZ_READING_ANSWERS: 'quiz reading answers',
  PERCENT_FASTER: 'percent faster',
  AVG_SECONDS_BEFORE: 'average seconds before',
  AVG_SECONDS_NOW: 'average seconds now',
  KANJI_MEASURED: 'kanji measured',
  ABILITY_THEN: 'ability then',
  ABILITY_NOW: 'ability now',
  MEASURED_ON: 'measured on',
  PREVIOUSLY_MEASURED_ON: 'previously measured on',
  HARDEST_KANJI_CLEARED: 'hardest kanji cleared',
  ITEM_DIFFICULTY: 'item difficulty',
  CURRENT_UNCERTAINTY: 'current uncertainty',
  UNCERTAINTY_WHEN_MEASURED: 'uncertainty when measured',
  DAYS_SINCE_THE_TEST: 'days since the test',
} as const
```

- [ ] **Step 4: Replace every literal in the detectors**

In each of `leech.ts`, `orient.ts`, `commitment-gap.ts`, `hook-coverage.ts`,
`reading-lag.ts`, `fluency.ts`, `milestones.ts`: add
`EVIDENCE_LABELS` to the existing `import type { … } from '../types'` (as a
value import — split it into `import { EVIDENCE_LABELS } from '../types'` if the
file's existing import is `import type`), and replace each `label: '…'` literal
with the matching constant.

Example, `leech.ts:61-67` becomes:

```ts
  const evidence: Evidence[] = [
    { label: EVIDENCE_LABELS.KANJI_GIVING_TROUBLE, value: troubled.length },
    { label: EVIDENCE_LABELS.ACTIVE_KANJI, value: active.length },
    ...worst.slice(0, MAX_NAMED).map((c): Evidence => ({
      label: EVIDENCE_LABELS.LAPSES,
      value: c.lapses,
      kanjiId: c.kanjiId,
      character: c.character,
    })),
  ]
```

Do the same mechanically for the other six files. **Change no values.**

- [ ] **Step 5: Run the shared suite and verify nothing moved**

```bash
pnpm --filter @kanji-learn/shared test
```

Expected: PASS, including every pre-existing detector test unchanged. Those
tests assert label strings directly, so a green suite is the proof that no value
drifted.

- [ ] **Step 6: Prove no literal survived**

```bash
grep -rn "label: '" packages/shared/src/coaching/detectors/ --include="*.ts" | grep -v "\.test\.ts"
```

Expected: no output. Any hit is a literal that escaped the extraction and will
drift silently later. Record the command and its empty result in your report.

⚠️ **Test files are deliberately excluded, and must not be "fixed".**
`commitment-gap.test.ts` pins a literal evidence object via `toEqual`, and that
literal is doing real work: it is an independent assertion of the label values
that does not go through the constants, so it would still fail if
`EVIDENCE_LABELS` and the detector were changed together. Rewriting it to use
the constants would make it circular and delete the only check that survives a
coordinated rename.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/coaching/types.ts packages/shared/src/coaching/detectors packages/shared/src/coaching/labels.test.ts && git commit -m "refactor(coaching): evidence labels become a shared, pinned contract"
```

---

## Task 2: Extend the snapshot contract and its assembly

**Files:**
- Modify: `packages/shared/src/coaching/types.ts` (`PlacementItemOutcome`, `ReviewSnapshot`)
- Modify: `apps/api/src/services/buddy/coaching.service.ts` (`placementItems`, `reviews`)
- Test: `apps/api/test/integration/coaching-snapshot.test.ts` (existing — extend)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `PlacementItemOutcome` gains `strokeCount: number` and
  `readingCount: number`. `ReviewSnapshot` gains `windowDays: number`.
  Task 3 reads all three.

The spec's §5 separates these from the passthroughs because they are the only
part of this work that leaves `packages/shared`.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/integration/coaching-snapshot.test.ts`, inside its
existing describe block. Follow the file's established fixture pattern for
seeding a placement session with results — read it before writing.

```ts
  // MUTATION CAUGHT: shipping hardest_cleared's copy without the features it
  // cites. The sentence claims the test "weighs stroke count and number of
  // readings alongside JLPT level"; if assembly does not supply them the
  // formatter degrades to the vague base string forever, and no shared-lane
  // test would notice because the detector's own fixtures are hand-built.
  it('carries stroke count and reading count on each placement item', async () => {
    const snapshot = await service.assembleSnapshot(USER, NOW, [])
    const item = snapshot.placement!.items.find((i) => i.kanjiId === SEEDED_KANJI_ID)!
    expect(item.strokeCount).toBeGreaterThan(0)
    expect(item.readingCount).toBeGreaterThan(0)
  })

  // MUTATION CAUGHT: hardcoding "a month" in fluency_gain's copy instead of
  // reading the window. REVIEW_WINDOW_DAYS is documented as an assembly
  // parameter; a copy string that inlines it becomes a lie the first time it
  // changes, and nothing else would fail.
  it('carries the review window length on the review snapshot', async () => {
    const snapshot = await service.assembleSnapshot(USER, NOW, [])
    expect(snapshot.reviews.windowDays).toBe(REVIEW_WINDOW_DAYS)
  })
```

Import `REVIEW_WINDOW_DAYS` from `../../src/services/buddy/coaching.service`.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @kanji-learn/api test -- test/integration/coaching-snapshot.test.ts
```

Expected: FAIL — `strokeCount` does not exist on `PlacementItemOutcome`, and
`windowDays` does not exist on `ReviewSnapshot`.

- [ ] **Step 3: Extend the contract**

In `packages/shared/src/coaching/types.ts`, add to `PlacementItemOutcome`:

```ts
  /** Strokes in the character. Part of what the difficulty model weighs, and
   *  what `hardest_cleared` cites to justify calling an item hard. */
  strokeCount: number
  /** Total on- plus kun-readings. Computed in ASSEMBLY, not here — the
   *  analyzer must not learn the shape of a jsonb column. */
  readingCount: number
```

and to `ReviewSnapshot`:

```ts
  /** Length of the window `cards` was computed over. Owned by the assembly
   *  layer (REVIEW_WINDOW_DAYS); carried here so `fluency_gain`'s copy can
   *  state the period without inlining a constant it does not own. */
  windowDays: number
```

- [ ] **Step 4: Supply them in assembly**

In `apps/api/src/services/buddy/coaching.service.ts`, extend the
`placementItems` select (currently at `:274-286`) with the two kanji columns,
and map them:

```ts
      .select({
        kanjiId: placementResults.kanjiId,
        character: kanji.character,
        meaningCorrect: placementResults.meaningCorrect,
        readingCorrect: placementResults.readingCorrect,
        difficultyAtAsk: placementResults.difficultyAtAsk,
        readingOffset: kanjiDifficulty.readingOffset,
        strokeCount: kanji.strokeCount,
        kunReadings: kanji.kunReadings,
        onReadings: kanji.onReadings,
      })
```

and in the `.map()`:

```ts
      strokeCount: r.strokeCount,
      // jsonb string arrays, NOT NULL DEFAULT '[]' — but coalesce anyway, so a
      // hand-seeded test row without them cannot produce NaN in learner copy.
      readingCount: (r.kunReadings?.length ?? 0) + (r.onReadings?.length ?? 0),
```

`kanji` is already `innerJoin`ed, so no join changes.

In `reviews()`, add `windowDays` to the returned object:

```ts
    return {
      cards,
      windowDays: REVIEW_WINDOW_DAYS,
      quiz: quiz.map((q): QuizOutcome => ({ … })),
    }
```

- [ ] **Step 5: Run the API suite**

```bash
pnpm --filter @kanji-learn/api test
```

Expected: PASS in full. Other snapshot consumers must not break — `analyze()`
takes the whole snapshot, so a missing field is a compile error, not a runtime
surprise.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/coaching/types.ts apps/api/src/services/buddy/coaching.service.ts apps/api/test/integration/coaching-snapshot.test.ts && git commit -m "feat(coaching): snapshot carries stroke count, reading count and the review window"
```

---

## Task 3: Detectors emit the missing evidence

**Files:**
- Modify: `packages/shared/src/coaching/detectors/orient.ts` (`level_estimate`)
- Modify: `packages/shared/src/coaching/detectors/milestones.ts` (`hardest_cleared`)
- Modify: `packages/shared/src/coaching/detectors/commitment-gap.ts`
- Modify: `packages/shared/src/coaching/detectors/fluency.ts` (`fluency_gain`)
- Modify: `packages/shared/src/coaching/types.ts` (four new labels)
- Test: the matching `*.test.ts` beside each detector

**Interfaces:**
- Consumes: `EVIDENCE_LABELS` (Task 1); `strokeCount`, `readingCount`,
  `windowDays` (Task 2).
- Produces: four new labels — `PERIOD_START: 'period start'`,
  `PERIOD_END: 'period end'`, `STROKE_COUNT: 'stroke count'`,
  `READING_COUNT: 'reading count'`, `WINDOW_DAYS: 'window days'`. Add each to
  `EVIDENCE_LABELS` **and** to `labels.test.ts`'s pinned object.

`MEASURED_ON` already exists (theta_delta uses it) and is reused by both
`level_estimate` and `hardest_cleared`. Do not add a second constant for it.

- [ ] **Step 1: Write the failing tests**

In `commitment-gap.test.ts`:

```ts
  // MUTATION CAUGHT: emitting the period as one blob, or omitting it. The copy
  // must say "between 20 and 26 July", which needs both ends separately — and
  // periodEnd is EXCLUSIVE, so the formatter subtracts a day. If the detector
  // emits only a duration, that subtraction has nothing to work from.
  it('carries both ends of the commitment period', () => {
    const f = detectCommitmentGap(snapshotWithGap)!
    expect(f.evidence).toContainEqual({ label: EVIDENCE_LABELS.PERIOD_START, value: '2026-07-20' })
    expect(f.evidence).toContainEqual({ label: EVIDENCE_LABELS.PERIOD_END, value: '2026-07-27' })
  })
```

In `orient.test.ts`:

```ts
  // MUTATION CAUGHT: dropping the placement date, which forces level_estimate's
  // copy back to "your placement puts you around this level" — literally the
  // sentence the owner called useless, with "which test and when?" as their
  // first question.
  it('carries the date the placement was taken', () => {
    const f = detectLevelEstimate(snapshot)!
    expect(f.evidence).toContainEqual({ label: EVIDENCE_LABELS.MEASURED_ON, value: '2026-07-29' })
  })
```

In `milestones.test.ts`:

```ts
  // MUTATION CAUGHT: omitting the features that justify calling the item hard.
  // Their absence is why a bare superlative invites a JLPT lookup that makes
  // Buddy look wrong: the owner's hardest-cleared was N3 and outranked two N2
  // kanji, because the model weighs strokes and readings too.
  it('carries stroke count, reading count and the test date', () => {
    const f = detectHardestCleared(snapshot)!
    expect(f.evidence).toContainEqual({ label: EVIDENCE_LABELS.STROKE_COUNT, value: 19 })
    expect(f.evidence).toContainEqual({ label: EVIDENCE_LABELS.READING_COUNT, value: 3 })
    expect(f.evidence).toContainEqual({ label: EVIDENCE_LABELS.MEASURED_ON, value: '2026-07-29' })
  })
```

In `fluency.test.ts`:

```ts
  // MUTATION CAUGHT: dropping the window, which leaves "faster than before"
  // with no period attached — unfalsifiable praise, and the copy would have to
  // inline 30 days to say anything, hardcoding a constant it does not own.
  it('carries the window it measured over', () => {
    const f = detectFluencyGain(snapshot)!
    expect(f.evidence).toContainEqual({ label: EVIDENCE_LABELS.WINDOW_DAYS, value: 30 })
  })
```

Each test's fixture must be extended with the fields Task 2 added. Follow the
existing fixture builders in each file.

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @kanji-learn/shared test
```

Expected: FAIL, four tests, each because the evidence array lacks the entry.

- [ ] **Step 3: Emit the evidence**

`commitment-gap.ts`, in the evidence array:

```ts
      { label: EVIDENCE_LABELS.MINUTES_PROMISED, value: c.promisedMinutes },
      { label: EVIDENCE_LABELS.MINUTES_STUDIED, value: c.actualMinutes },
      { label: EVIDENCE_LABELS.PERIOD_START, value: c.periodStart },
      // EXCLUSIVE — the display layer subtracts a day. Emitted as the contract
      // stores it, so the raw value and the snapshot never disagree.
      { label: EVIDENCE_LABELS.PERIOD_END, value: c.periodEnd },
```

`orient.ts`, `detectLevelEstimate`, appended to its evidence array:

```ts
      { label: EVIDENCE_LABELS.MEASURED_ON, value: p.completedAt.slice(0, 10) },
```

`milestones.ts`, `detectHardestCleared`, appended:

```ts
      { label: EVIDENCE_LABELS.STROKE_COUNT, value: hardest.strokeCount },
      { label: EVIDENCE_LABELS.READING_COUNT, value: hardest.readingCount },
      { label: EVIDENCE_LABELS.MEASURED_ON, value: p.completedAt.slice(0, 10) },
```

`fluency.ts`, `detectFluencyGain`, appended:

```ts
      { label: EVIDENCE_LABELS.WINDOW_DAYS, value: snapshot.reviews.windowDays },
```

- [ ] **Step 4: Run both suites**

```bash
pnpm --filter @kanji-learn/shared test && pnpm --filter @kanji-learn/api test
```

Expected: PASS both. The API suite matters here because `analyze()` runs against
real assembled snapshots in `coaching-refresh.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/coaching && git commit -m "feat(coaching): detectors emit the dates, features and window the copy needs"
```

---

## Task 4: The formatter skeleton, the helpers, and the Orient copy

**Files:**
- Modify: `packages/shared/src/coaching/copy.ts` (rewrite the core)
- Test: `packages/shared/src/coaching/copy.test.ts` (existing — extend)

**Interfaces:**
- Produces:
  ```ts
  type Formatter = (f: Finding) => string | null
  const FORMATTERS: Record<FindingKind, Formatter>
  export function humanDate(iso: string): string          // '2026-07-29' -> '29 July'
  export function humanDateRange(startIso: string, endExclusiveIso: string): string
  ```
  `templateCopy`'s signature is unchanged. Tasks 5 and 6 add formatters to
  `FORMATTERS` and nothing else.

Orient lands here because it is two kinds, one of which is a deletion, so it
proves the skeleton without a large copy surface.

- [ ] **Step 1: Write the failing tests**

Add to `packages/shared/src/coaching/copy.test.ts`:

```ts
describe('humanDate', () => {
  // MUTATION CAUGHT: using toLocaleDateString, whose output depends on the
  // host locale and timezone. The analyzer is pure by contract and CI must not
  // render a different sentence from a developer's machine.
  it('renders an ISO date as a day and month', () => {
    expect(humanDate('2026-07-29')).toBe('29 July')
    expect(humanDate('2026-08-03T17:19:55.000Z')).toBe('3 August')
  })
})

describe('humanDateRange', () => {
  // MUTATION CAUGHT: rendering periodEnd raw. It is EXCLUSIVE
  // (commitment.service.ts:253 computes weekStart + periodDays), so a period
  // starting 20 July ends on the 26th and must not read "27 July". Nothing
  // else in the system would catch an off-by-one in prose.
  it('subtracts a day from the exclusive end', () => {
    expect(humanDateRange('2026-07-20', '2026-07-27')).toBe('20 and 26 July')
  })

  // MUTATION CAUGHT: collapsing to one month name when the period straddles
  // two, which would render "26 and 1 July" for a period ending in August.
  it('names both months when the period straddles them', () => {
    expect(humanDateRange('2026-07-27', '2026-08-03')).toBe('27 July and 2 August')
  })
})

describe('templateCopy — level_estimate', () => {
  // MUTATION CAUGHT: the original defect. "Your placement puts you around this
  // level, with some room either side" answers none of the owner's questions —
  // which test, when, what level, what range.
  it('names the level, the range and the date', () => {
    const text = templateCopy(levelEstimateFinding, NOW)
    expect(text).toContain('29 July')
    expect(text).toContain('N4')
    expect(text).toContain('N5')
    expect(text).toContain('N3')
  })

  // MUTATION CAUGHT: saying the range narrows "as you do more". Verified
  // 2026-08-03: abilityTheta/abilitySe are written ONLY by
  // placement.service.ts:319, on completing a placement test. Read as "more
  // studying", that sentence is FALSE, not merely vague.
  it('says retaking the test narrows the range, not studying', () => {
    const text = templateCopy(levelEstimateFinding, NOW).toLowerCase()
    expect(text).toContain('again')
    expect(text).not.toMatch(/as you do more\b/)
  })

  // MUTATION CAUGHT: returning a half-built sentence when evidence is absent.
  // The degradation path must yield the base string, never "puts you at
  // undefined".
  it('falls back to the base sentence with evidence stripped', () => {
    const text = templateCopy({ ...levelEstimateFinding, evidence: [] }, NOW)
    expect(text).not.toContain('undefined')
    expect(text).toContain('around this level')
  })
})

describe('templateCopy — mechanics_explainer', () => {
  // MUTATION CAUGHT: leaving the Profile pointer in. Re-verified 2026-08-03:
  // Profile has a Placement Test row (profile.tsx:729) and NO IRT section.
  // That string is live in production sending learners to a dead end, on the
  // one finding whose entire purpose is building trust.
  it('no longer points at a Profile page that does not exist', () => {
    const text = templateCopy(mechanicsFinding, NOW)
    expect(text).not.toContain('Profile')
    expect(text).toContain('IRT')
  })
})
```

Define `levelEstimateFinding` and `mechanicsFinding` fixtures at the top of the
new block, using `EVIDENCE_LABELS` for every label.

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @kanji-learn/shared test -- copy.test.ts
```

Expected: FAIL — `humanDate` is not exported, and the level_estimate assertions
fail against the static base string.

- [ ] **Step 3: Rewrite the core of `copy.ts`**

Keep the existing `BASE` record exactly as it is — it is the degradation floor —
**except** for `mechanics_explainer`, whose final sentence is removed:

```ts
  mechanics_explainer:
    'Your level comes from a statistical technique called IRT. The test gets harder when you answer well and easier when you do not, which is how it can say something useful about your level in about a dozen questions.',
```

Add above `templateCopy`:

```ts
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

/**
 * '2026-07-29' or a full ISO timestamp -> '29 July'.
 *
 * Deliberately NOT toLocaleDateString: the analyzer is pure by contract, and a
 * locale- or timezone-dependent sentence would differ between CI and a
 * developer's machine. Parses the date part textually for the same reason —
 * `new Date('2026-07-29')` is UTC midnight and shifts a day west of Greenwich.
 */
export function humanDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso.slice(0, 10)
  return `${d} ${MONTHS[m - 1]}`
}

/**
 * A commitment period, rendered inclusively.
 *
 * ⚠️ `endExclusive` is exactly that. getLastCompletedPeriod computes
 * `periodEnd = addDays(weekStart, periodDays)` (commitment.service.ts:253), so
 * a period starting 20 July has periodEnd 27 July and COVERS 20–26. Rendering
 * the raw value tells the learner about a day they were never measured on.
 */
export function humanDateRange(startIso: string, endExclusiveIso: string): string {
  const start = startIso.slice(0, 10)
  const end = addDaysIso(endExclusiveIso.slice(0, 10), -1)
  const [, startMonth] = start.split('-').map(Number)
  const [, endMonth] = end.split('-').map(Number)
  const startDay = Number(start.split('-')[2])
  return startMonth === endMonth
    ? `${startDay} and ${humanDate(end)}`
    : `${humanDate(start)} and ${humanDate(end)}`
}

/** Calendar-safe ISO date shift, without Date's timezone behaviour. */
function addDaysIso(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00.000Z`) + days * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

/** First evidence value for a label, or undefined. */
function ev(f: Finding, label: string): string | number | undefined {
  return f.evidence.find((e) => e.label === label)?.value
}

/** Every evidence item carrying a label — `leech` emits up to three `lapses`. */
function evAll(f: Finding, label: string): Evidence[] {
  return f.evidence.filter((e) => e.label === label)
}

type Formatter = (f: Finding) => string | null

/**
 * Per-kind copy. A formatter returns `null` when its evidence is absent, and
 * `templateCopy` substitutes BASE[kind] — never a half-built sentence.
 *
 * Tasks 5 and 6 fill the remaining eight.
 */
const FORMATTERS: Record<FindingKind, Formatter> = {
  level_estimate: (f) => {
    const level = ev(f, EVIDENCE_LABELS.MOST_LIKELY_LEVEL)
    const low = ev(f, EVIDENCE_LABELS.LOWER_BOUND)
    const high = ev(f, EVIDENCE_LABELS.UPPER_BOUND)
    const on = ev(f, EVIDENCE_LABELS.MEASURED_ON)
    if (level === undefined || low === undefined || high === undefined || on === undefined) return null
    return `Your placement test on ${humanDate(String(on))} puts you at ${level}, and the honest range runs from ${low} to ${high}. That range is wide because a placement test only asks about a dozen questions. It narrows when you take the placement test again, rather than from day-to-day studying, because your level estimate is only recalculated when you sit the test.`
  },

  // Fixed copy by contract (§3): no evidence to read, so no formatter.
  mechanics_explainer: () => null,

  reading_lag: () => null,
  leech: () => null,
  commitment_gap: () => null,
  hook_coverage: () => null,
  fluency_gain: () => null,
  theta_delta: () => null,
  hardest_cleared: () => null,
  retest_due: () => null,
}
```

and change `templateCopy`'s first two lines:

```ts
export function templateCopy(finding: Finding, now?: string): string {
  const base = FORMATTERS[finding.kind](finding) ?? BASE[finding.kind]
```

Everything below that line — the `mechanics_explainer` early return, the hedge,
the escalation — stays exactly as it is.

- [ ] **Step 4: Run the shared suite**

```bash
pnpm --filter @kanji-learn/shared test
```

Expected: PASS. Pre-existing `copy.test.ts` cases must stay green; the eight
`() => null` formatters guarantee those kinds still render `BASE`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/coaching/copy.ts packages/shared/src/coaching/copy.test.ts && git commit -m "feat(coaching): per-kind formatters, and level_estimate says which test and when"
```

---

## Task 5: The four Direct formatters

**Files:**
- Modify: `packages/shared/src/coaching/copy.ts` (`FORMATTERS`)
- Test: `packages/shared/src/coaching/copy.test.ts`

**Interfaces:**
- Consumes: `FORMATTERS`, `ev`, `evAll`, `humanDate`, `humanDateRange` (Task 4).
- Produces: nothing new. Fills four entries.

These carry the actions, and their wording was reviewed by the owner on
2026-08-03 — see the spec's §6 and §13. **Use the spec's sentences.** They are
not drafts.

- [ ] **Step 1: Write the failing tests**

```ts
describe('templateCopy — leech', () => {
  // MUTATION CAUGHT: "a handful of kanji keep slipping back" — the exact
  // sentence the owner read, whose first question was "which ones?". The
  // evidence names them, with lapse counts, and the old copy ignored it.
  it('names each kanji and its lapse count', () => {
    const text = templateCopy(leechFinding, NOW)
    expect(text).toContain('敗')
    expect(text).toContain('語')
    expect(text).toContain('4 times')
  })

  // MUTATION CAUGHT: naming the kanji but not what to do about them. The
  // finding is Direct — its purpose is changing behaviour, and a list without
  // an action is an observation.
  it('names one kanji to start with, and explains what a hook is', () => {
    const text = templateCopy(leechFinding, NOW)
    expect(text).toContain('hook')
    expect(text.toLowerCase()).toContain('already know')
  })

  // MUTATION CAUGHT: assuming exactly MAX_NAMED kanji. The detector emits
  // BETWEEN ONE AND THREE, and a formatter that indexes worst[1] blindly
  // renders "undefined has lapsed undefined times" for a single-leech learner.
  it('reads correctly with only one named kanji', () => {
    const single = { ...leechFinding, evidence: leechFinding.evidence.slice(0, 3) }
    const text = templateCopy(single, NOW)
    expect(text).not.toContain('undefined')
    expect(text).toContain('敗')
  })

  it('falls back with evidence stripped', () => {
    expect(templateCopy({ ...leechFinding, evidence: [] }, NOW)).not.toContain('undefined')
  })
})

describe('templateCopy — commitment_gap', () => {
  // MUTATION CAUGHT: rendering periodEnd raw. The period 2026-07-20 to
  // 2026-07-27 EXCLUSIVE covers the 20th to the 26th; "between 20 and 27 July"
  // tells the learner they were measured on a day they were not.
  it('renders the period inclusively', () => {
    const text = templateCopy(commitmentGapFinding, NOW)
    expect(text).toContain('between 20 and 26 July')
    expect(text).not.toContain('27 July')
  })

  // MUTATION CAUGHT: reverting to "we will set something you will actually
  // hit", which assumes the learner over-promised and should promise less.
  // The owner replaced it: offer mechanism, and allow that nothing is wrong.
  it('offers mechanism and allows that the week was simply busy', () => {
    const text = templateCopy(commitmentGapFinding, NOW)
    expect(text).toContain('time of day')
    expect(text).toContain('two short study sessions')
    expect(text.toLowerCase()).toContain('busy week')
  })
})

describe('templateCopy — hook_coverage', () => {
  // MUTATION CAUGHT: telling a learner to build a hook without saying what one
  // is. Instruction without explanation cannot be acted on, which reproduces
  // the original defect in a new place.
  it('explains what a hook is before offering to build one', () => {
    const text = templateCopy(hookCoverageFinding, NOW)
    expect(text).toContain('敗')
    expect(text.toLowerCase()).toContain('already know')
    expect(text).toMatch(/hook/i)
  })
})

describe('templateCopy — reading_lag', () => {
  // MUTATION CAUGHT: handling only one evidence shape. reading_lag fires from
  // EITHER placement or quiz and emits different labels for each; a formatter
  // that knows one shape degrades silently half the time, and the degradation
  // is invisible because it still returns a real sentence.
  it('builds the sentence from placement-shaped evidence', () => {
    const text = templateCopy(readingLagPlacementFinding, NOW)
    expect(text).toContain('62%')
    expect(text).toContain('88%')
    expect(text).toContain('24')
  })

  it('builds the sentence from quiz-shaped evidence', () => {
    const text = templateCopy(readingLagQuizFinding, NOW)
    expect(text).toContain('71%')
    expect(text).toContain('90%')
  })

  it('falls back with evidence stripped', () => {
    expect(templateCopy({ ...readingLagQuizFinding, evidence: [] }, NOW))
      .not.toContain('undefined')
  })
})

describe('leech and hook_coverage together', () => {
  // MUTATION CAUGHT: nothing, deliberately — this is the spec's §6.1 decision
  // under observation. Both are Direct, both can be selected, and both explain
  // hooks. The redundancy was accepted rather than engineered away; this test
  // exists so a human reads the combined output at least once.
  it('reads as emphasis rather than repetition', () => {
    const both = analysisBody([leechFinding, hookCoverageFinding], NOW)
    expect(both).not.toContain('undefined')
    // The full definition appears once; leech carries only the short form.
    expect(both.match(/memory holds on to the familiar/g) ?? []).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @kanji-learn/shared test -- copy.test.ts
```

Expected: FAIL on every new case — all four formatters still return `null`.

- [ ] **Step 3: Implement the four formatters**

Replace the four `() => null` placeholders in `FORMATTERS`:

```ts
  leech: (f) => {
    const named = evAll(f, EVIDENCE_LABELS.LAPSES)
      .filter((e) => e.character && typeof e.value === 'number')
    if (named.length === 0) return null
    const [worst] = named
    const list = named
      .map((e) => `${e.character} has lapsed ${e.value} ${e.value === 1 ? 'time' : 'times'}`)
      .join(', ')
    const opener = named.length === 1
      ? 'One kanji keeps'
      : `${capitalise(spell(named.length))} kanji keep`
    return `${opener} slipping back no matter how often they come round: ${list}. The one to work on first is ${worst.character}. Look it up and build a hook for it — a small story or image that ties the character to something you already know — because that is what usually stops a kanji from slipping.`
  },

  hook_coverage: (f) => {
    const suggested = f.evidence.find((e) => e.label === EVIDENCE_LABELS.SUGGESTED_KANJI)
    if (!suggested?.character) return null
    return `${suggested.character} keeps catching you out. When something new will not stick, it usually helps to connect it to something you already know well: that connection is what we call a hook. It can be a small story, an image, or a resemblance to a word or a thing you are already familiar with, and it works because memory holds on to the familiar far more readily than the unfamiliar. Would you like to build one for ${suggested.character} together?`
  },

  commitment_gap: (f) => {
    const promised = ev(f, EVIDENCE_LABELS.MINUTES_PROMISED)
    const studied = ev(f, EVIDENCE_LABELS.MINUTES_STUDIED)
    const start = ev(f, EVIDENCE_LABELS.PERIOD_START)
    const end = ev(f, EVIDENCE_LABELS.PERIOD_END)
    if (promised === undefined || studied === undefined) return null
    const when = start !== undefined && end !== undefined
      ? ` between ${humanDateRange(String(start), String(end))}`
      : ''
    return `You promised ${Math.round(Number(promised))} minutes${when} and studied ${Math.round(Number(studied))}. It is worth discussing whether we should try shifting the time of day when you study, or try two short study sessions in a day. Or maybe it was just a busy week.`
  },

  reading_lag: (f) => {
    // Two evidence shapes — placement and quiz. Handle both, or degrade.
    const placementReading = ev(f, EVIDENCE_LABELS.READING_ACCURACY)
    const placementMeaning = ev(f, EVIDENCE_LABELS.MEANING_ACCURACY)
    const placementCount = ev(f, EVIDENCE_LABELS.ITEMS_WITH_READING_ASKED)
    const quizReading = ev(f, EVIDENCE_LABELS.QUIZ_READING_ACCURACY)
    const quizMeaning = ev(f, EVIDENCE_LABELS.QUIZ_MEANING_ACCURACY)
    const quizCount = ev(f, EVIDENCE_LABELS.QUIZ_READING_ANSWERS)

    const reading = placementReading ?? quizReading
    const meaning = placementMeaning ?? quizMeaning
    const count = placementCount ?? quizCount
    if (reading === undefined || meaning === undefined || count === undefined) return null

    return `Your readings are trailing your meanings, ${pct(reading)} against ${pct(meaning)} across ${count} answers, which is a wider gap than most people have. Next time you study, try saying the reading aloud before you reveal the answer.`
  },
```

with two helpers beside `ev`:

```ts
/** 0.62 -> '62%'. Evidence accuracies are proportions, per the detectors. */
function pct(v: string | number): string {
  return `${Math.round(Number(v) * 100)}%`
}

/**
 * Small counts read better as words in prose: 'three readings', 'Two kanji'.
 * Always lowercase — capitalise at the call site when it starts a sentence, so
 * there is one spelling table rather than a cased and an uncased copy of it.
 */
function spell(n: number): string {
  return ['zero', 'one', 'two', 'three', 'four', 'five'][n] ?? String(n)
}

/** 'two' -> 'Two'. Only for a word that opens a sentence. */
function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
```

`copy.ts`'s import must widen to bring in the value and the extra type:

```ts
import { EVIDENCE_LABELS, type Evidence, type Finding, type FindingKind } from './types'
```

- [ ] **Step 4: Run the shared suite**

```bash
pnpm --filter @kanji-learn/shared test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/coaching/copy.ts packages/shared/src/coaching/copy.test.ts && git commit -m "feat(coaching): the four Direct findings name the kanji, the period and the move"
```

---

## Task 6: The four Motivate formatters, and the global undefined guard

**Files:**
- Modify: `packages/shared/src/coaching/copy.ts` (`FORMATTERS`)
- Test: `packages/shared/src/coaching/copy.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4 and 5.
- Produces: nothing new. Fills the last four entries and closes the defect class.

- [ ] **Step 1: Write the failing tests**

```ts
describe('templateCopy — fluency_gain', () => {
  // MUTATION CAUGHT: "the shape of something becoming automatic" — evocative
  // and unfalsifiable. And inlining "a month" instead of reading the window,
  // which hardcodes a constant this layer does not own.
  it('names the speed, the window and the kanji count', () => {
    const text = templateCopy(fluencyFinding, NOW)
    expect(text).toContain('22%')
    expect(text).toContain('41')
    expect(text).toContain('30 days')
  })
})

describe('templateCopy — theta_delta', () => {
  // MUTATION CAUGHT: "real movement, not noise" without saying why it is not
  // noise. The detector compares the rise against sqrt(se² + prevSe²) — the
  // combined standard error — so the claim has a stateable basis.
  it('names both estimates, both dates, and why it is not noise', () => {
    const text = templateCopy(thetaDeltaFinding, NOW)
    expect(text).toContain('0.31')
    expect(text).toContain('0.68')
    expect(text).toContain('12 July')
    expect(text).toContain('29 July')
    expect(text.toLowerCase()).toContain('uncertainty')
  })
})

describe('templateCopy — hardest_cleared', () => {
  // MUTATION CAUGHT: a bare superlative. The owner's hardest-cleared was 願
  // (N3) and it outranked two N2 kanji, so "the hardest one" invites a JLPT
  // lookup that makes Buddy look wrong. The sentence must carry its own basis.
  it('names the kanji and justifies calling it hardest', () => {
    const text = templateCopy(hardestFinding, NOW)
    expect(text).toContain('願')
    expect(text).toContain('19 strokes')
    expect(text).toContain('three readings')
    expect(text).toContain('JLPT')
  })
})

describe('templateCopy — retest_due', () => {
  // MUTATION CAUGHT: "the value of the test goes up when it is repeated" —
  // true, obscure, and it never says where to go. Profile has a Placement Test
  // row (profile.tsx:729), so the location can be named honestly.
  it('names the elapsed days, what retaking achieves, and where', () => {
    const text = templateCopy(retestFinding, NOW)
    expect(text).toContain('34 days')
    expect(text).toContain('Profile')
    expect(text.toLowerCase()).toContain('narrow')
    // 'uncertainty' is the analyzer's word, not a learner's.
    expect(text).not.toContain('uncertainty')
  })
})

describe('no formatter ever renders undefined', () => {
  // MUTATION CAUGHT: the whole defect class this work exists to prevent. Any
  // formatter that interpolates a missing evidence value produces the string
  // "undefined" inside a sentence a learner reads. Checking every kind against
  // both full and stripped evidence is cheaper than trusting ten formatters.
  it.each(ALL_KINDS)('%s renders cleanly with full and with stripped evidence', (kind) => {
    const full = FIXTURES[kind]
    expect(templateCopy(full, NOW)).not.toContain('undefined')
    expect(templateCopy({ ...full, evidence: [] }, NOW)).not.toContain('undefined')
    expect(templateCopy({ ...full, evidence: [] }, NOW).trim()).not.toBe('')
  })
})
```

`ALL_KINDS` is `Object.keys(FINDING_PRIORITY) as FindingKind[]`, and `FIXTURES`
is a `Record<FindingKind, Finding>` assembled from the fixtures defined across
Tasks 4–6. Building it forces every kind to have one, which is the point.

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @kanji-learn/shared test -- copy.test.ts
```

Expected: FAIL on the four kind-specific blocks. The `undefined` matrix should
already pass — it is a guard, not a driver. **Confirm it can fail** by
temporarily interpolating a missing label into one formatter, observing red,
and reverting. Record that transcript.

- [ ] **Step 3: Implement the four formatters**

```ts
  fluency_gain: (f) => {
    const faster = ev(f, EVIDENCE_LABELS.PERCENT_FASTER)
    const measured = ev(f, EVIDENCE_LABELS.KANJI_MEASURED)
    const window = ev(f, EVIDENCE_LABELS.WINDOW_DAYS)
    if (faster === undefined || measured === undefined || window === undefined) return null
    return `You are answering about ${faster}% faster than you were ${window} days ago, across ${measured} kanji, and your accuracy has not slipped while doing it. Speed usually improves before anything else does, so this is a sign that recalling these characters is becoming automatic rather than effortful.`
  },

  theta_delta: (f) => {
    const then = ev(f, EVIDENCE_LABELS.ABILITY_THEN)
    const now = ev(f, EVIDENCE_LABELS.ABILITY_NOW)
    const thenOn = ev(f, EVIDENCE_LABELS.PREVIOUSLY_MEASURED_ON)
    const nowOn = ev(f, EVIDENCE_LABELS.MEASURED_ON)
    if (then === undefined || now === undefined || thenOn === undefined || nowOn === undefined) return null
    return `Your ability estimate has risen from ${then} to ${now} between your placement tests on ${humanDate(String(thenOn))} and ${humanDate(String(nowOn))}. That rise is larger than the uncertainty in both measurements combined, so it is real progress rather than the test landing differently on the day.`
  },

  hardest_cleared: (f) => {
    const kanji = f.evidence.find((e) => e.label === EVIDENCE_LABELS.HARDEST_KANJI_CLEARED)
    const strokes = ev(f, EVIDENCE_LABELS.STROKE_COUNT)
    const readings = ev(f, EVIDENCE_LABELS.READING_COUNT)
    if (!kanji?.character || strokes === undefined || readings === undefined) return null
    return `You cleared ${kanji.character}, which was the hardest item the test put in front of you: it has ${strokes} strokes and ${spell(Number(readings))} readings. The test weighs stroke count and number of readings alongside JLPT level, which is why ${kanji.character} counted as harder than some kanji at an easier JLPT level that you also saw.`
  },

  retest_due: (f) => {
    const days = ev(f, EVIDENCE_LABELS.DAYS_SINCE_THE_TEST)
    if (days === undefined) return null
    return `You took your placement test ${days} days ago, and the estimate of your level has drifted since then because it has had no new information. You can take the test again from your Profile, and doing so would narrow the range around your level rather than simply repeating what you already know.`
  },
```

`spell` and `capitalise` are already defined in Task 5 — reuse them rather than
adding a second spelling table.

Note `hardest_cleared` deliberately does **not** name a specific JLPT level it
outranked — the finding's evidence does not carry the other items, and inventing
"some N2 kanji" from a fixture would be a claim the analyzer cannot support.

- [ ] **Step 4: Run every affected suite**

```bash
pnpm --filter @kanji-learn/shared test && pnpm --filter @kanji-learn/api test
```

Expected: PASS both. The API suite covers `analysisBody`'s output landing in
notebook rows and in slice 3's template fallback.

- [ ] **Step 5: Read the actual output once, as a human would**

Add a temporary script or a `console.log` in a scratch test that renders all ten
kinds with full evidence, run it, and **paste the ten sentences into your
report.** Delete the scratch afterwards.

This step exists because every automated check in this plan asserts substrings.
Slice 2 passed every test it had and still produced a note the owner called
worthless. Nothing here proves the sentences read well — a person has to look.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/coaching/copy.ts packages/shared/src/coaching/copy.test.ts && git commit -m "feat(coaching): the four Motivate findings carry their own basis"
```

---

## Final verification

- [ ] Both suites, in full:

```bash
pnpm --filter @kanji-learn/shared test && pnpm --filter @kanji-learn/api test
```

- [ ] Typecheck the packages that consume the changed contract:

```bash
pnpm --filter @kanji-learn/api typecheck
```

- [ ] Confirm no literal labels remain:

```bash
grep -rn "label: '" packages/shared/src/coaching/ --include="*.ts" | grep -v "\.test\.ts"
```

Expected: empty.

## Deploy

**No migration and no EAS build.** This is an API deploy only — the notebook
entry is written server-side and slice 3's template fallback is server-side.

Verification per `docs/SOP.md` needs response content, and the honest canary is
the notebook entry itself: after the rollout, force a refresh for a learner with
findings and read the row.

```bash
./scripts/with-live-db.sh psql -c "SELECT left(body, 400) FROM notebook_entries WHERE source->>'kind' = 'coaching_analysis' AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 3"
```

The pass condition is not "a row exists" — slice 2 already produced rows. It is
**that the text names specific kanji, dates and levels.** If it still reads "a
handful of kanji keep slipping back", the formatters are degrading and the
`null` path is being taken in production for a reason no test reproduced.
