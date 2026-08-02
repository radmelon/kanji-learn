# Coaching Analyzer (Slice 1 — the pure analyzer) Implementation Plan

> **Canonical URL — hand this to a new session:**
> https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/plans/2026-08-02-coaching-analyzer-slice1.md

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic engine that turns a `LearnerSnapshot` into ranked, typed `Finding[]` — every number the coaching feature will ever show a learner, computed and tested with no database, no LLM, and no clock.

**Architecture:** One new directory, `packages/shared/src/coaching/`, entirely pure. A contracts module defines `Finding` and `LearnerSnapshot`; nine detector functions each own their own 0..1 magnitude mapping; a selection module ranks by `magnitude × confidence × novelty`; `analyze()` composes them. Template copy for every kind ships in the same slice because the spec makes it non-negotiable. Nothing here imports from `apps/`, touches Postgres, or calls `Date.now()`.

**Tech Stack:** TypeScript, vitest (the shared lane — `pnpm --filter @kanji-learn/shared test`), no new dependencies.

---

## Scope: this is slice 1 of 6, and that is deliberate

The spec's §12 says plainly: *"This is a large spec — comparable to Phase 7. It should not become one undifferentiated plan."* It then names six independently shippable slices. This plan implements **slice 1 only**:

> **1. The pure analyzer** — `Finding`, the taxonomy, `analyze()`, and the selection policy. No surfaces, no LLM, no API. Entirely shared-lane tested. Nothing user-visible; everything downstream depends on it.

**Nothing in this plan is user-visible.** That is the point — it is the spine. Slices 2–6 (snapshot assembly + notebook surface, the conversational surface, companion mode, the IRT explainer, the goal beat) each get their own plan, written after this one lands and against the real shapes it produced.

**Why slice 1 first, rather than a thin vertical:** every number the feature will ever say to a learner is computed here. Getting it wrong is a coaching system that confidently states falsehoods — which is the exact failure mode B-228 and B-229 both were. Testing it costs sub-second runs in a lane that exists today.

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include these.

- **Purity.** `packages/shared/src/coaching/` must not import from `apps/`, must not perform I/O, and must not read a clock. Time enters through `snapshot.now`. Verified by a test in Task 10.
- **The load-bearing invariant (§1):** *"The LLM receives findings, never raw data."* Nothing in this slice emits prose containing a computed number that is not already a field on the `Finding`.
- **`magnitude` is normalised per kind, not globally (§2).** *"Each kind owns its mapping to 0..1 and documents it beside its implementation."* There is no universal scale.
- **`confidence` exists so the voice can hedge honestly (§2).** *"A finding from four observations must not be spoken like one from four hundred."*
- **Every finding kind ships with template copy (§1).** *"Non-negotiable: Phase 7's entire HIGH-defect wave was the template floor failing to complete."*
- **`mechanics_explainer` is template, always, never LLM (§3)** — *"Buddy must not improvise about his own algorithm."*
- **`level_estimate` never emits a bare label (§3)** — θ with its credible interval, *"probably N3, possibly N2"*.
- **Selection decay must be monotonically decreasing in recency and must never reach zero (§4).** Both are testable contract, not implementation detail.
- **Findings per surface is a parameter, not a constant (§14.1).** The owner accepted 2–3 for v1 *"as a dial we can tune later"*. `select()` takes the count as an argument with a default.
- **No new dependencies.** The shared package has exactly one devDependency beyond TypeScript.

## File Structure

```
packages/shared/src/coaching/
  types.ts            Finding, FindingKind, Evidence, LearnerSnapshot + sub-shapes
  magnitude.ts        normaliseLinear, normaliseSaturating, confidenceFromCount
  detectors/
    reading-lag.ts    detectReadingLag
    leech.ts          detectLeech
    commitment-gap.ts detectCommitmentGap
    hook-coverage.ts  detectHookCoverage   (carries §14.4's offer rule)
    orient.ts         detectLevelEstimate, detectMechanicsExplainer
    fluency.ts        detectFluencyGain, detectThetaDelta
    milestones.ts     detectHardestCleared, detectRetestDue
  selection.ts        novelty, select
  copy.ts             templateCopy — the offline floor, one entry per kind
  analyze.ts          analyze
  index.ts            barrel
```

Each detector is its own file because each owns a documented magnitude mapping and its own test file, and because a reviewer should be able to reject one detector while approving its neighbour. `orient.ts`, `fluency.ts` and `milestones.ts` each hold two closely-related kinds that share inputs.

Tests are colocated as `<name>.test.ts`, matching every other module in `packages/shared/src`.

---

### Task 1: Contracts and magnitude helpers

**Files:**
- Create: `packages/shared/src/coaching/types.ts`
- Create: `packages/shared/src/coaching/magnitude.ts`
- Test: `packages/shared/src/coaching/magnitude.test.ts`

**Interfaces:**
- Consumes: `JlptLevel`, `SrsStatus` from `packages/shared/src/types.ts`.
- Produces: `Finding`, `FindingKind`, `Evidence`, `LearnerSnapshot` and its sub-shapes; `normaliseLinear(value, zeroAt, oneAt)`, `normaliseSaturating(value, scale)`, `confidenceFromCount(n, scale)` — all `(…numbers) => number` returning 0..1.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/coaching/magnitude.test.ts
import { describe, it, expect } from 'vitest'
import { normaliseLinear, normaliseSaturating, confidenceFromCount } from './magnitude'

describe('normaliseLinear', () => {
  it('is 0 at or below zeroAt and 1 at or above oneAt', () => {
    expect(normaliseLinear(0.1, 0.2, 1.0)).toBe(0)
    expect(normaliseLinear(0.2, 0.2, 1.0)).toBe(0)
    expect(normaliseLinear(1.0, 0.2, 1.0)).toBe(1)
    expect(normaliseLinear(9.9, 0.2, 1.0)).toBe(1)
  })

  it('interpolates in between', () => {
    expect(normaliseLinear(0.6, 0.2, 1.0)).toBeCloseTo(0.5, 6)
  })

  it('handles a degenerate range without dividing by zero', () => {
    expect(normaliseLinear(5, 3, 3)).toBe(1)
    expect(normaliseLinear(1, 3, 3)).toBe(0)
  })
})

describe('normaliseSaturating', () => {
  it('is 0 at 0 and approaches 1 without reaching it', () => {
    expect(normaliseSaturating(0, 10)).toBe(0)
    expect(normaliseSaturating(1000, 10)).toBeLessThan(1)
    expect(normaliseSaturating(1000, 10)).toBeGreaterThan(0.99)
  })

  it('is monotonically increasing', () => {
    let prev = -1
    for (const v of [0, 1, 2, 5, 10, 20, 50]) {
      const n = normaliseSaturating(v, 10)
      expect(n).toBeGreaterThan(prev)
      prev = n
    }
  })

  it('clamps negative input to 0 rather than returning a negative magnitude', () => {
    expect(normaliseSaturating(-5, 10)).toBe(0)
  })
})

describe('confidenceFromCount', () => {
  it('is 0 with no observations — absent data must never speak', () => {
    expect(confidenceFromCount(0, 20)).toBe(0)
  })

  it('rises with observations and never reaches 1', () => {
    expect(confidenceFromCount(4, 20)).toBeLessThan(confidenceFromCount(40, 20))
    expect(confidenceFromCount(10_000, 20)).toBeLessThan(1)
  })

  it('hedges a four-observation finding well below a four-hundred one (spec §2)', () => {
    expect(confidenceFromCount(4, 20)).toBeLessThan(0.3)
    expect(confidenceFromCount(400, 20)).toBeGreaterThan(0.9)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/coaching/magnitude.test.ts`
Expected: FAIL — `Failed to resolve import "./magnitude"`.

- [ ] **Step 3: Write the contracts**

```ts
// packages/shared/src/coaching/types.ts
//
// Contracts for Buddy's coaching analysis (spec §2).
//
// `LearnerSnapshot` is the ONLY input to the analyzer. Everything the feature
// will ever tell a learner is computed from this shape, with no I/O and no
// clock — `now` is passed in. Slice 2 fills it from Postgres; slice 1 proves
// the arithmetic without a database.

import type { JlptLevel, SrsStatus } from '../types'

export type FindingKind =
  // Direct — findings that change behaviour (priority 1)
  | 'reading_lag' | 'leech' | 'commitment_gap' | 'hook_coverage'
  // Orient — trust and understanding (priority 2)
  | 'level_estimate' | 'mechanics_explainer'
  // Motivate — reasons to come back (priority 3)
  | 'fluency_gain' | 'theta_delta' | 'hardest_cleared' | 'retest_due'

/** Priority band per §3. Lower sorts first when scores tie. */
export const FINDING_PRIORITY: Record<FindingKind, 1 | 2 | 3> = {
  reading_lag: 1, leech: 1, commitment_gap: 1, hook_coverage: 1,
  level_estimate: 2, mechanics_explainer: 2,
  fluency_gain: 3, theta_delta: 3, hardest_cleared: 3, retest_due: 3,
}

/**
 * A specific value behind a finding. The LLM sees these; it never sees a row.
 * `label` is display-safe text already computed here, so the voice layer has
 * nothing left to calculate — that is the load-bearing invariant of §1.
 */
export interface Evidence {
  label: string
  value: number | string
  kanjiId?: number
  character?: string
}

export interface Finding {
  kind: FindingKind
  /** 0..1, normalised per kind — see each detector's documented mapping. */
  magnitude: number
  /** 0..1, how much data backs it. 0 means "do not speak this". */
  confidence: number
  evidence: Evidence[]
  /** ISO date first raised; null when this is the first time. */
  since: string | null
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

export interface PlacementItemOutcome {
  kanjiId: number
  character: string
  meaningCorrect: boolean
  /** null when the reading half was not asked for this item. */
  readingCorrect: boolean | null
  /** Population reading penalty for this item — `reading_lag` must exceed it. */
  readingOffset: number
  difficultyAtAsk: number
}

export interface PlacementSnapshot {
  theta: number
  se: number
  /** ISO. */
  completedAt: string
  level: JlptLevel
  /** 80% credible interval, so `level_estimate` is never a bare label (§3). */
  thetaLow: number
  thetaHigh: number
  levelLow: JlptLevel
  levelHigh: JlptLevel
  /** The session before the latest. null when only one exists — `theta_delta`
   *  needs two (§3). */
  previous: { theta: number; se: number; completedAt: string } | null
  items: PlacementItemOutcome[]
}

export interface CardSnapshot {
  kanjiId: number
  character: string
  status: SrsStatus
  lapses: number
  readingStage: number | null
  /** remembered→learning transitions inside the window. */
  regressions: number
  /** Mean response ms over the older and newer halves of the window; null when
   *  that half holds no reviews. `fluency_gain` needs both. */
  responseMsEarly: number | null
  responseMsLate: number | null
  /** Accuracy (0..1) over the same two halves. Fluency only counts at flat
   *  accuracy — faster *and* wronger is not a gain. */
  accuracyEarly: number | null
  accuracyLate: number | null
  /** Recent grades, newest last, 0–5 scale. Used to pick the kanji
   *  `hook_coverage` offers to work on (§14.4). */
  recentQualities: number[]
  /** Whether this kanji has a co-created hook. */
  hasCoCreatedHook: boolean
}

export interface QuizOutcome {
  kanjiId: number
  questionType: string
  correct: boolean
  /** ISO. */
  answeredAt: string
}

export interface ReviewSnapshot {
  cards: CardSnapshot[]
  quiz: QuizOutcome[]
}

export interface CommitmentSnapshot {
  promisedMinutes: number
  actualMinutes: number
  /** ISO dates bounding the commitment period. */
  periodStart: string
  periodEnd: string
}

export interface HookSnapshot {
  /** Co-created hooks only — `generationMethod = 'cocreated'`. */
  count: number
  /** ISO date of the most recent co-created hook; null when none exist. */
  latestAt: string | null
  /** Buddy session dates, newest first. §14.4's trigger needs the second one. */
  sessionDates: string[]
  /** Mean lapses for cards with vs without a hook — the evidence hooks help.
   *  null when either group is empty. */
  lapsesWithHook: number | null
  lapsesWithoutHook: number | null
}

/** What the previous analysis said, read back from the superseded notebook
 *  entry. This is the memory that makes decay work (§4). */
export interface PriorFinding {
  kind: FindingKind
  /** ISO date the kind was FIRST raised. */
  since: string
  /** ISO date it was MOST RECENTLY raised. */
  lastRaisedAt: string
}

export interface LearnerSnapshot {
  /** ISO. The analyzer has no clock; time enters here. */
  now: string
  placement: PlacementSnapshot | null
  reviews: ReviewSnapshot
  commitment: CommitmentSnapshot | null
  hooks: HookSnapshot
  priorFindings: PriorFinding[]
}
```

- [ ] **Step 4: Write the magnitude helpers**

```ts
// packages/shared/src/coaching/magnitude.ts
//
// Shared normalisation. Spec §2: magnitude is normalised PER KIND, not
// globally — there is no scale on which "readings lag by 0.4 logits" and
// "missed the commitment by 20 minutes" are comparable, and pretending
// otherwise silently biases selection toward whichever kind produces larger
// raw numbers. These helpers are the vocabulary each kind uses to state its
// own mapping; they are not a universal scale.

/** Linear ramp: 0 at or below `zeroAt`, 1 at or above `oneAt`. */
export function normaliseLinear(value: number, zeroAt: number, oneAt: number): number {
  if (oneAt <= zeroAt) return value >= oneAt ? 1 : 0
  if (value <= zeroAt) return 0
  if (value >= oneAt) return 1
  return (value - zeroAt) / (oneAt - zeroAt)
}

/**
 * Saturating ramp for unbounded counts: 0 at 0, asymptotic to 1.
 * `scale` is the value at which it reaches ~63%.
 */
export function normaliseSaturating(value: number, scale: number): number {
  if (value <= 0) return 0
  return 1 - Math.exp(-value / scale)
}

/**
 * Confidence from observation count (§2: "a finding from four observations
 * must not be spoken like one from four hundred"). Zero observations returns
 * exactly 0, which is the signal to say nothing at all.
 */
export function confidenceFromCount(n: number, scale: number): number {
  if (n <= 0) return 0
  return normaliseSaturating(n, scale)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run src/coaching/magnitude.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/coaching/types.ts packages/shared/src/coaching/magnitude.ts packages/shared/src/coaching/magnitude.test.ts
git commit -m "feat(coaching): Finding contract, LearnerSnapshot, and per-kind magnitude helpers"
```

---

### Task 2: `reading_lag`

**Files:**
- Create: `packages/shared/src/coaching/detectors/reading-lag.ts`
- Test: `packages/shared/src/coaching/detectors/reading-lag.test.ts`

**Interfaces:**
- Consumes: `LearnerSnapshot`, `Finding` (Task 1); `normaliseLinear`, `confidenceFromCount` (Task 1).
- Produces: `detectReadingLag(snapshot: LearnerSnapshot): Finding | null`.

**The subtlety a reviewer must check:** the spec says the gap must be **beyond the population `readingOffset`**. Readings are harder than meanings *for everyone* — `kanji_difficulty.readingOffset` is exactly that population penalty, and `bReading = b + readingOffset`. A learner whose readings trail by the population amount has no finding. Only the excess counts.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/coaching/detectors/reading-lag.test.ts
import { describe, it, expect } from 'vitest'
import { detectReadingLag } from './reading-lag'
import type { LearnerSnapshot, PlacementItemOutcome } from '../types'

function item(o: Partial<PlacementItemOutcome> = {}): PlacementItemOutcome {
  return {
    kanjiId: 1, character: '日',
    meaningCorrect: true, readingCorrect: true,
    readingOffset: 0.3, difficultyAtAsk: 0,
    ...o,
  }
}

function snap(items: PlacementItemOutcome[]): LearnerSnapshot {
  return {
    now: '2026-08-02T00:00:00.000Z',
    placement: {
      theta: 0, se: 0.4, completedAt: '2026-08-01T00:00:00.000Z',
      level: 'N3', thetaLow: -0.5, thetaHigh: 0.5, levelLow: 'N4', levelHigh: 'N3',
      previous: null, items,
    },
    reviews: { cards: [], quiz: [] },
    commitment: null,
    hooks: { count: 0, latestAt: null, sessionDates: [], lapsesWithHook: null, lapsesWithoutHook: null },
    priorFindings: [],
  }
}

describe('detectReadingLag', () => {
  it('returns null with no placement at all', () => {
    const s = snap([])
    s.placement = null
    expect(detectReadingLag(s)).toBeNull()
  })

  it('returns null when no item had its reading half asked', () => {
    expect(detectReadingLag(snap([item({ readingCorrect: null })]))).toBeNull()
  })

  it('THE CORE CASE: no finding when the gap is only the population offset', () => {
    // Meanings 100%, readings 70%. Mean readingOffset 0.3 in logit terms maps
    // to an expected accuracy gap of exactly 0.3 here, so the excess is 0.
    const items = [
      ...Array.from({ length: 7 }, (_, i) => item({ kanjiId: i, readingCorrect: true })),
      ...Array.from({ length: 3 }, (_, i) => item({ kanjiId: 100 + i, readingCorrect: false })),
    ]
    const f = detectReadingLag(snap(items))
    expect(f).toBeNull()
  })

  it('fires when readings trail by MORE than the population offset', () => {
    const items = [
      ...Array.from({ length: 3 }, (_, i) => item({ kanjiId: i, readingCorrect: true })),
      ...Array.from({ length: 7 }, (_, i) => item({ kanjiId: 100 + i, readingCorrect: false })),
    ]
    const f = detectReadingLag(snap(items))!
    expect(f).not.toBeNull()
    expect(f.kind).toBe('reading_lag')
    expect(f.magnitude).toBeGreaterThan(0)
    expect(f.confidence).toBeGreaterThan(0)
  })

  it('never fires when readings BEAT meanings', () => {
    const items = [
      item({ kanjiId: 1, meaningCorrect: false, readingCorrect: true }),
      item({ kanjiId: 2, meaningCorrect: false, readingCorrect: true }),
      item({ kanjiId: 3, meaningCorrect: true, readingCorrect: true }),
    ]
    expect(detectReadingLag(snap(items))).toBeNull()
  })

  it('carries the two accuracies and the offset as evidence, already labelled', () => {
    const items = [
      ...Array.from({ length: 2 }, (_, i) => item({ kanjiId: i, readingCorrect: true })),
      ...Array.from({ length: 8 }, (_, i) => item({ kanjiId: 100 + i, readingCorrect: false })),
    ]
    const f = detectReadingLag(snap(items))!
    const labels = f.evidence.map((e) => e.label)
    expect(labels).toContain('meaning accuracy')
    expect(labels).toContain('reading accuracy')
    expect(labels).toContain('expected reading penalty')
  })

  it('hedges on thin data — 3 items is far less confident than 30', () => {
    const thin = [
      item({ kanjiId: 1, readingCorrect: false }),
      item({ kanjiId: 2, readingCorrect: false }),
      item({ kanjiId: 3, readingCorrect: false }),
    ]
    const thick = Array.from({ length: 30 }, (_, i) => item({ kanjiId: i, readingCorrect: false }))
    expect(detectReadingLag(snap(thin))!.confidence)
      .toBeLessThan(detectReadingLag(snap(thick))!.confidence)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/coaching/detectors/reading-lag.test.ts`
Expected: FAIL — `Failed to resolve import "./reading-lag"`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/coaching/detectors/reading-lag.ts
import type { Finding, LearnerSnapshot } from '../types'
import { confidenceFromCount, normaliseLinear } from '../magnitude'

/**
 * Readings trailing meanings by MORE than the population expects.
 *
 * Readings are harder than meanings for everybody — that is what
 * `kanji_difficulty.readingOffset` measures, and why `bReading = b +
 * readingOffset`. A learner trailing by the population amount is normal and
 * must produce no finding; only the EXCESS is a finding about them.
 *
 * MAGNITUDE MAPPING (this kind's own scale, per §2): the excess accuracy gap,
 * linear from 0 at LAG_FLOOR to 1 at LAG_CEILING. Below the floor the gap is
 * within noise for a ~13-item placement.
 */
const LAG_FLOOR = 0.1
const LAG_CEILING = 0.6
/** Reaches ~63% confidence at 20 answered reading items. */
const CONFIDENCE_SCALE = 20

export function detectReadingLag(snapshot: LearnerSnapshot): Finding | null {
  const placement = snapshot.placement
  if (!placement) return null

  const asked = placement.items.filter((i) => i.readingCorrect !== null)
  if (asked.length === 0) return null

  const meaningAccuracy = asked.filter((i) => i.meaningCorrect).length / asked.length
  const readingAccuracy = asked.filter((i) => i.readingCorrect === true).length / asked.length

  const observedGap = meaningAccuracy - readingAccuracy
  if (observedGap <= 0) return null

  // The population already predicts SOME gap. Only what exceeds it is theirs.
  const expectedGap =
    asked.reduce((sum, i) => sum + i.readingOffset, 0) / asked.length
  const excess = observedGap - expectedGap
  if (excess <= 0) return null

  const magnitude = normaliseLinear(excess, LAG_FLOOR, LAG_CEILING)
  if (magnitude === 0) return null

  return {
    kind: 'reading_lag',
    magnitude,
    confidence: confidenceFromCount(asked.length, CONFIDENCE_SCALE),
    evidence: [
      { label: 'meaning accuracy', value: round2(meaningAccuracy) },
      { label: 'reading accuracy', value: round2(readingAccuracy) },
      { label: 'expected reading penalty', value: round2(expectedGap) },
      { label: 'items with a reading asked', value: asked.length },
    ],
    since: null, // stamped by select() in Task 9
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run src/coaching/detectors/reading-lag.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/coaching/detectors/reading-lag.ts packages/shared/src/coaching/detectors/reading-lag.test.ts
git commit -m "feat(coaching): reading_lag — only the gap BEYOND the population reading offset"
```

---

### Task 3: `leech`

**Files:**
- Create: `packages/shared/src/coaching/detectors/leech.ts`
- Test: `packages/shared/src/coaching/detectors/leech.test.ts`

**Interfaces:**
- Consumes: `LearnerSnapshot`, `CardSnapshot`, `Finding`; `normaliseSaturating`, `confidenceFromCount`.
- Produces: `detectLeech(snapshot: LearnerSnapshot): Finding | null`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/coaching/detectors/leech.test.ts
import { describe, it, expect } from 'vitest'
import { detectLeech } from './leech'
import type { CardSnapshot, LearnerSnapshot } from '../types'

function card(o: Partial<CardSnapshot> = {}): CardSnapshot {
  return {
    kanjiId: 1, character: '日', status: 'reviewing',
    lapses: 0, readingStage: null, regressions: 0,
    responseMsEarly: null, responseMsLate: null,
    accuracyEarly: null, accuracyLate: null,
    recentQualities: [], hasCoCreatedHook: false,
    ...o,
  }
}

function snap(cards: CardSnapshot[]): LearnerSnapshot {
  return {
    now: '2026-08-02T00:00:00.000Z',
    placement: null,
    reviews: { cards, quiz: [] },
    commitment: null,
    hooks: { count: 0, latestAt: null, sessionDates: [], lapsesWithHook: null, lapsesWithoutHook: null },
    priorFindings: [],
  }
}

describe('detectLeech', () => {
  it('returns null with no cards', () => {
    expect(detectLeech(snap([]))).toBeNull()
  })

  it('returns null when nothing is lapsing', () => {
    expect(detectLeech(snap([card({ lapses: 1 }), card({ kanjiId: 2, lapses: 0 })]))).toBeNull()
  })

  it('fires on a card past the lapse threshold', () => {
    const f = detectLeech(snap([card({ kanjiId: 9, character: '難', lapses: 6 })]))!
    expect(f.kind).toBe('leech')
    expect(f.magnitude).toBeGreaterThan(0)
  })

  it('counts a remembered→learning regression as evidence too', () => {
    const f = detectLeech(snap([card({ kanjiId: 9, character: '難', lapses: 4, regressions: 3 })]))!
    expect(f).not.toBeNull()
    const worst = f.evidence.find((e) => e.character === '難')
    expect(worst).toBeDefined()
  })

  it('names the worst offenders, worst first, capped at 3', () => {
    const cards = [
      card({ kanjiId: 1, character: '一', lapses: 5 }),
      card({ kanjiId: 2, character: '二', lapses: 9 }),
      card({ kanjiId: 3, character: '三', lapses: 7 }),
      card({ kanjiId: 4, character: '四', lapses: 6 }),
    ]
    const f = detectLeech(snap(cards))!
    const named = f.evidence.filter((e) => e.character !== undefined)
    expect(named).toHaveLength(3)
    expect(named[0]!.character).toBe('二')
    expect(named[1]!.character).toBe('三')
  })

  it('grows with the number of leeches, not just the worst one', () => {
    const one = detectLeech(snap([card({ kanjiId: 1, lapses: 5 })]))!
    const many = detectLeech(snap(
      Array.from({ length: 12 }, (_, i) => card({ kanjiId: i, lapses: 5 })),
    ))!
    expect(many.magnitude).toBeGreaterThan(one.magnitude)
  })

  it('ignores burned cards — a mastered kanji that lapsed long ago is history', () => {
    expect(detectLeech(snap([card({ lapses: 8, status: 'burned' })]))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/coaching/detectors/leech.test.ts`
Expected: FAIL — `Failed to resolve import "./leech"`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/coaching/detectors/leech.ts
import type { CardSnapshot, Evidence, Finding, LearnerSnapshot } from '../types'
import { confidenceFromCount, normaliseSaturating } from '../magnitude'

/**
 * Cards that keep falling over: high lapse counts, or repeated
 * remembered→learning regressions.
 *
 * MAGNITUDE MAPPING (this kind's own scale, per §2): saturating in the NUMBER
 * of leeches, not in the worst one's lapse count. Ten cards lapsing four times
 * is a study-strategy problem; one card lapsing forty times is one bad card.
 * The first is what a coach should raise.
 */
const LAPSE_THRESHOLD = 4
const REGRESSION_THRESHOLD = 2
/** Reaches ~63% magnitude at 6 leeches. */
const COUNT_SCALE = 6
const CONFIDENCE_SCALE = 8
const MAX_NAMED = 3

function leechScore(c: CardSnapshot): number {
  return c.lapses + c.regressions
}

function isLeech(c: CardSnapshot): boolean {
  // A burned card is out of rotation; its history is not actionable advice.
  if (c.status === 'burned') return false
  return c.lapses >= LAPSE_THRESHOLD || c.regressions >= REGRESSION_THRESHOLD
}

export function detectLeech(snapshot: LearnerSnapshot): Finding | null {
  const leeches = snapshot.reviews.cards.filter(isLeech)
  if (leeches.length === 0) return null

  const worst = [...leeches].sort((a, b) => leechScore(b) - leechScore(a))

  const evidence: Evidence[] = [
    { label: 'kanji lapsing repeatedly', value: leeches.length },
    ...worst.slice(0, MAX_NAMED).map((c): Evidence => ({
      label: 'lapses',
      value: c.lapses,
      kanjiId: c.kanjiId,
      character: c.character,
    })),
  ]

  return {
    kind: 'leech',
    magnitude: normaliseSaturating(leeches.length, COUNT_SCALE),
    confidence: confidenceFromCount(snapshot.reviews.cards.length, CONFIDENCE_SCALE),
    evidence,
    since: null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run src/coaching/detectors/leech.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/coaching/detectors/leech.ts packages/shared/src/coaching/detectors/leech.test.ts
git commit -m "feat(coaching): leech — scaled by how MANY cards lapse, not the worst one"
```

---

### Task 4: `commitment_gap`

**Files:**
- Create: `packages/shared/src/coaching/detectors/commitment-gap.ts`
- Test: `packages/shared/src/coaching/detectors/commitment-gap.test.ts`

**Interfaces:**
- Consumes: `LearnerSnapshot`, `CommitmentSnapshot`, `Finding`; `normaliseLinear`.
- Produces: `detectCommitmentGap(snapshot: LearnerSnapshot): Finding | null`.

**Note on scope:** the *register* in which this is delivered — silent / direct / frank — is the §8 frankness escalator, which depends on a goal that v1 only collects (slice 6). This detector computes the gap; nothing here decides tone.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/coaching/detectors/commitment-gap.test.ts
import { describe, it, expect } from 'vitest'
import { detectCommitmentGap } from './commitment-gap'
import type { CommitmentSnapshot, LearnerSnapshot } from '../types'

function snap(commitment: CommitmentSnapshot | null): LearnerSnapshot {
  return {
    now: '2026-08-02T00:00:00.000Z',
    placement: null,
    reviews: { cards: [], quiz: [] },
    commitment,
    hooks: { count: 0, latestAt: null, sessionDates: [], lapsesWithHook: null, lapsesWithoutHook: null },
    priorFindings: [],
  }
}

const period = { periodStart: '2026-07-26T00:00:00.000Z', periodEnd: '2026-08-02T00:00:00.000Z' }

describe('detectCommitmentGap', () => {
  it('returns null when no commitment was made', () => {
    expect(detectCommitmentGap(snap(null))).toBeNull()
  })

  it('returns null when the commitment was met', () => {
    expect(detectCommitmentGap(snap({ promisedMinutes: 70, actualMinutes: 70, ...period }))).toBeNull()
  })

  it('returns null when the commitment was BEATEN — that is not a gap', () => {
    expect(detectCommitmentGap(snap({ promisedMinutes: 70, actualMinutes: 120, ...period }))).toBeNull()
  })

  it('returns null for a rounding-error shortfall', () => {
    expect(detectCommitmentGap(snap({ promisedMinutes: 70, actualMinutes: 68, ...period }))).toBeNull()
  })

  it('fires on a real shortfall and scales with the PROPORTION missed', () => {
    const half = detectCommitmentGap(snap({ promisedMinutes: 70, actualMinutes: 35, ...period }))!
    const none = detectCommitmentGap(snap({ promisedMinutes: 70, actualMinutes: 0, ...period }))!
    expect(half.kind).toBe('commitment_gap')
    expect(none.magnitude).toBeGreaterThan(half.magnitude)
  })

  it('treats a proportion, not an absolute — 5 of 10 minutes is as bad as 50 of 100', () => {
    const small = detectCommitmentGap(snap({ promisedMinutes: 10, actualMinutes: 5, ...period }))!
    const large = detectCommitmentGap(snap({ promisedMinutes: 100, actualMinutes: 50, ...period }))!
    expect(small.magnitude).toBeCloseTo(large.magnitude, 6)
  })

  it('is fully confident — this is a promise and a measurement, not an inference', () => {
    const f = detectCommitmentGap(snap({ promisedMinutes: 70, actualMinutes: 10, ...period }))!
    expect(f.confidence).toBe(1)
  })

  it('handles a zero promise without dividing by zero', () => {
    expect(detectCommitmentGap(snap({ promisedMinutes: 0, actualMinutes: 0, ...period }))).toBeNull()
  })

  it('carries promised and actual as evidence', () => {
    const f = detectCommitmentGap(snap({ promisedMinutes: 70, actualMinutes: 10, ...period }))!
    expect(f.evidence).toEqual(
      expect.arrayContaining([
        { label: 'minutes promised', value: 70 },
        { label: 'minutes studied', value: 10 },
      ]),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/coaching/detectors/commitment-gap.test.ts`
Expected: FAIL — `Failed to resolve import "./commitment-gap"`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/coaching/detectors/commitment-gap.ts
import type { Finding, LearnerSnapshot } from '../types'
import { normaliseLinear } from '../magnitude'

/**
 * Promised minutes versus actual.
 *
 * MAGNITUDE MAPPING (this kind's own scale, per §2): the PROPORTION of the
 * promise missed, linear from 0 at SLACK to 1 at a total miss. Proportional
 * rather than absolute, because missing 5 of 10 promised minutes is the same
 * broken promise as missing 50 of 100 — an absolute scale would only ever
 * raise this for ambitious learners.
 *
 * NOTE ON REGISTER: how bluntly this is said is §8's frankness escalator,
 * which keys on the goal date collected in slice 6. Nothing here decides tone.
 */
const SLACK = 0.05

export function detectCommitmentGap(snapshot: LearnerSnapshot): Finding | null {
  const c = snapshot.commitment
  if (!c || c.promisedMinutes <= 0) return null

  const missed = c.promisedMinutes - c.actualMinutes
  if (missed <= 0) return null

  const proportionMissed = missed / c.promisedMinutes
  const magnitude = normaliseLinear(proportionMissed, SLACK, 1)
  if (magnitude === 0) return null

  return {
    kind: 'commitment_gap',
    magnitude,
    // A promise and a measurement. There is nothing to be uncertain about.
    confidence: 1,
    evidence: [
      { label: 'minutes promised', value: c.promisedMinutes },
      { label: 'minutes studied', value: c.actualMinutes },
    ],
    since: null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run src/coaching/detectors/commitment-gap.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/coaching/detectors/commitment-gap.ts packages/shared/src/coaching/detectors/commitment-gap.test.ts
git commit -m "feat(coaching): commitment_gap — proportional to the promise, not absolute"
```

---

### Task 5: `hook_coverage` — an offer, not a score

**Files:**
- Create: `packages/shared/src/coaching/detectors/hook-coverage.ts`
- Test: `packages/shared/src/coaching/detectors/hook-coverage.test.ts`

**Interfaces:**
- Consumes: `LearnerSnapshot`, `HookSnapshot`, `CardSnapshot`, `Finding`; `confidenceFromCount`.
- Produces: `detectHookCoverage(snapshot: LearnerSnapshot): Finding | null`, and the exported helper `pickHookCandidate(cards: CardSnapshot[], quiz: QuizOutcome[]): CardSnapshot | null`.

**This task implements the owner's §14.4 decision, which changed the finding's nature.** The spec originally asked how to *phrase* "you've built no hooks" so it invites rather than scores. The owner's answer removes the sentence: the finding carries **a named kanji the learner is actually failing** and becomes an offer to co-author a hook. That promotes it from a report to a `Direct` action.

Two trigger halves, and the second is the one a naive zero-check misses:
1. `count === 0`, **or**
2. no hook created since the session-before-last — the learner who built three hooks in week one and none since.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/coaching/detectors/hook-coverage.test.ts
import { describe, it, expect } from 'vitest'
import { detectHookCoverage, pickHookCandidate } from './hook-coverage'
import type { CardSnapshot, HookSnapshot, LearnerSnapshot, QuizOutcome } from '../types'

function card(o: Partial<CardSnapshot> = {}): CardSnapshot {
  return {
    kanjiId: 1, character: '日', status: 'reviewing',
    lapses: 0, readingStage: null, regressions: 0,
    responseMsEarly: null, responseMsLate: null,
    accuracyEarly: null, accuracyLate: null,
    recentQualities: [], hasCoCreatedHook: false,
    ...o,
  }
}

const NO_HOOKS: HookSnapshot = {
  count: 0, latestAt: null, sessionDates: [], lapsesWithHook: null, lapsesWithoutHook: null,
}

function snap(hooks: Partial<HookSnapshot>, cards: CardSnapshot[] = [], quiz: QuizOutcome[] = []): LearnerSnapshot {
  return {
    now: '2026-08-02T00:00:00.000Z',
    placement: null,
    reviews: { cards, quiz },
    commitment: null,
    hooks: { ...NO_HOOKS, ...hooks },
    priorFindings: [],
  }
}

const STRUGGLING = card({ kanjiId: 42, character: '難', recentQualities: [1, 1, 3, 1] })

describe('detectHookCoverage — trigger', () => {
  it('fires when the learner has no hooks at all', () => {
    const f = detectHookCoverage(snap({ count: 0 }, [STRUGGLING]))!
    expect(f.kind).toBe('hook_coverage')
  })

  it('THE HALF A ZERO-CHECK MISSES: fires when none is newer than the session-before-last', () => {
    const f = detectHookCoverage(snap({
      count: 3,
      latestAt: '2026-06-01T00:00:00.000Z',
      sessionDates: ['2026-08-01T00:00:00.000Z', '2026-07-25T00:00:00.000Z', '2026-07-18T00:00:00.000Z'],
    }, [STRUGGLING]))!
    expect(f).not.toBeNull()
    expect(f.kind).toBe('hook_coverage')
  })

  it('stays quiet when a hook was built since the session-before-last', () => {
    expect(detectHookCoverage(snap({
      count: 3,
      latestAt: '2026-07-28T00:00:00.000Z',
      sessionDates: ['2026-08-01T00:00:00.000Z', '2026-07-25T00:00:00.000Z', '2026-07-18T00:00:00.000Z'],
    }, [STRUGGLING]))).toBeNull()
  })

  it('stays quiet with hooks and fewer than two sessions to judge against', () => {
    expect(detectHookCoverage(snap({
      count: 2,
      latestAt: '2026-06-01T00:00:00.000Z',
      sessionDates: ['2026-08-01T00:00:00.000Z'],
    }, [STRUGGLING]))).toBeNull()
  })

  it('returns null when there is no struggling kanji to offer — an offer needs a subject', () => {
    expect(detectHookCoverage(snap({ count: 0 }, [card({ recentQualities: [4, 5, 4] })]))).toBeNull()
  })
})

describe('detectHookCoverage — the offer', () => {
  it('names a specific kanji', () => {
    const f = detectHookCoverage(snap({ count: 0 }, [STRUGGLING]))!
    const target = f.evidence.find((e) => e.label === 'suggested kanji')!
    expect(target.character).toBe('難')
    expect(target.kanjiId).toBe(42)
  })

  it('carries the hooks-help evidence when both groups exist', () => {
    const f = detectHookCoverage(snap({
      count: 0, lapsesWithHook: 1.2, lapsesWithoutHook: 3.4,
    }, [STRUGGLING]))!
    const labels = f.evidence.map((e) => e.label)
    expect(labels).toContain('average lapses with a hook')
    expect(labels).toContain('average lapses without one')
  })

  it('omits the comparison rather than inventing it when a group is empty', () => {
    const f = detectHookCoverage(snap({ count: 0, lapsesWithHook: null, lapsesWithoutHook: 3.4 }, [STRUGGLING]))!
    expect(f.evidence.map((e) => e.label)).not.toContain('average lapses with a hook')
  })
})

describe('pickHookCandidate', () => {
  it('returns null when nothing is struggling', () => {
    expect(pickHookCandidate([card({ recentQualities: [4, 5, 5] })], [])).toBeNull()
  })

  it('prefers the kanji with the most Again/Hard grades', () => {
    const cards = [
      card({ kanjiId: 1, character: '一', recentQualities: [1, 4, 4] }),
      card({ kanjiId: 2, character: '二', recentQualities: [1, 1, 1, 3] }),
    ]
    expect(pickHookCandidate(cards, [])!.character).toBe('二')
  })

  it('counts repeated quiz failures too', () => {
    const cards = [
      card({ kanjiId: 1, character: '一', recentQualities: [1, 4] }),
      card({ kanjiId: 2, character: '二', recentQualities: [1, 4] }),
    ]
    const quiz: QuizOutcome[] = [
      { kanjiId: 2, questionType: 'meaning_recall', correct: false, answeredAt: '2026-08-01T00:00:00.000Z' },
      { kanjiId: 2, questionType: 'meaning_recall', correct: false, answeredAt: '2026-07-30T00:00:00.000Z' },
    ]
    expect(pickHookCandidate(cards, quiz)!.character).toBe('二')
  })

  it('never offers a kanji that already has a hook', () => {
    const cards = [card({ kanjiId: 1, character: '一', recentQualities: [1, 1, 1], hasCoCreatedHook: true })]
    expect(pickHookCandidate(cards, [])).toBeNull()
  })

  it('is deterministic on a tie — same input, same kanji, every call', () => {
    const cards = [
      card({ kanjiId: 7, character: '七', recentQualities: [1, 1] }),
      card({ kanjiId: 3, character: '三', recentQualities: [1, 1] }),
    ]
    const first = pickHookCandidate(cards, [])!.kanjiId
    for (let i = 0; i < 5; i++) expect(pickHookCandidate(cards, [])!.kanjiId).toBe(first)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/coaching/detectors/hook-coverage.test.ts`
Expected: FAIL — `Failed to resolve import "./hook-coverage"`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/coaching/detectors/hook-coverage.ts
import type { CardSnapshot, Evidence, Finding, LearnerSnapshot, QuizOutcome } from '../types'
import { confidenceFromCount } from '../magnitude'

/**
 * Hook coverage — reframed by the owner on 2026-08-02 (spec §14.4).
 *
 * The spec originally asked how to PHRASE "you've built no hooks" so it
 * invites rather than scores. The owner's answer was not to say it at all:
 * the finding carries a NAMED KANJI the learner is actually failing and
 * becomes an offer to co-author a hook. That is why this is a Direct finding
 * (priority 1) and not a Motivate one — it changes behaviour and says what to
 * do next.
 *
 * TRIGGER, both halves:
 *   1. no hooks at all, OR
 *   2. none newer than the session-before-last — the learner who built three
 *      in week one and stopped, whom a pure zero-check never fires for.
 *
 * MAGNITUDE MAPPING (this kind's own scale, per §2): 1.0 with no hooks at all,
 * OFFER_MAGNITUDE when hooks exist but have gone stale. A learner who has
 * never used the feature needs the offer more than one who has drifted.
 */
const NO_HOOKS_MAGNITUDE = 1
const STALE_MAGNITUDE = 0.6
/** Grades at or below this count as struggling — Again (1) and Hard (3). */
const STRUGGLE_QUALITY = 3
const MIN_STRUGGLE_SIGNALS = 2
const CONFIDENCE_SCALE = 10

/**
 * The kanji to offer. Ranked by struggle evidence: Again/Hard grades plus
 * failed quiz answers. Ties break on `kanjiId` so the same snapshot always
 * yields the same offer — a coach that suggests a different kanji each time
 * you reload is not a coach.
 */
export function pickHookCandidate(
  cards: CardSnapshot[],
  quiz: QuizOutcome[],
): CardSnapshot | null {
  const quizFailures = new Map<number, number>()
  for (const q of quiz) {
    if (q.correct) continue
    quizFailures.set(q.kanjiId, (quizFailures.get(q.kanjiId) ?? 0) + 1)
  }

  const scored = cards
    // Offering a hook for a kanji that already has one is not an offer.
    .filter((c) => !c.hasCoCreatedHook)
    .map((c) => ({
      card: c,
      score:
        c.recentQualities.filter((q) => q <= STRUGGLE_QUALITY).length +
        (quizFailures.get(c.kanjiId) ?? 0),
    }))
    .filter((s) => s.score >= MIN_STRUGGLE_SIGNALS)

  if (scored.length === 0) return null

  scored.sort((a, b) => b.score - a.score || a.card.kanjiId - b.card.kanjiId)
  return scored[0]!.card
}

/** True when no hook has been built since the session before last. */
function hooksHaveGoneStale(snapshot: LearnerSnapshot): boolean {
  const { latestAt, sessionDates } = snapshot.hooks
  // Needs two sessions to have a "session before last" to measure against.
  const sessionBeforeLast = sessionDates[1]
  if (!sessionBeforeLast) return false
  if (!latestAt) return true
  return Date.parse(latestAt) < Date.parse(sessionBeforeLast)
}

export function detectHookCoverage(snapshot: LearnerSnapshot): Finding | null {
  const hasNone = snapshot.hooks.count === 0
  const isStale = hooksHaveGoneStale(snapshot)
  if (!hasNone && !isStale) return null

  // An offer needs a subject. With nothing to work on, say nothing —
  // "you've built no hooks" with no kanji attached is the scoring sentence
  // §14.4 exists to remove.
  const candidate = pickHookCandidate(snapshot.reviews.cards, snapshot.reviews.quiz)
  if (!candidate) return null

  const evidence: Evidence[] = [
    { label: 'hooks built', value: snapshot.hooks.count },
    {
      label: 'suggested kanji',
      value: candidate.character,
      kanjiId: candidate.kanjiId,
      character: candidate.character,
    },
  ]

  // Only claim hooks help when both sides of the comparison exist.
  const { lapsesWithHook, lapsesWithoutHook } = snapshot.hooks
  if (lapsesWithHook !== null && lapsesWithoutHook !== null) {
    evidence.push(
      { label: 'average lapses with a hook', value: lapsesWithHook },
      { label: 'average lapses without one', value: lapsesWithoutHook },
    )
  }

  return {
    kind: 'hook_coverage',
    magnitude: hasNone ? NO_HOOKS_MAGNITUDE : STALE_MAGNITUDE,
    confidence: confidenceFromCount(snapshot.reviews.cards.length, CONFIDENCE_SCALE),
    evidence,
    since: null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run src/coaching/detectors/hook-coverage.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/coaching/detectors/hook-coverage.ts packages/shared/src/coaching/detectors/hook-coverage.test.ts
git commit -m "feat(coaching): hook_coverage as an OFFER on a named kanji, per the owner's 2026-08-02 review"
```

---

### Task 6: `level_estimate` and `mechanics_explainer`

**Files:**
- Create: `packages/shared/src/coaching/detectors/orient.ts`
- Test: `packages/shared/src/coaching/detectors/orient.test.ts`

**Interfaces:**
- Consumes: `LearnerSnapshot`, `PlacementSnapshot`, `Finding`; `normaliseLinear`.
- Produces: `detectLevelEstimate(snapshot: LearnerSnapshot): Finding | null`, `detectMechanicsExplainer(snapshot: LearnerSnapshot): Finding | null`.

**Two hard constraints from §3**, both asserted below: `level_estimate` must **never emit a bare label** — the interval is not optional garnish — and `mechanics_explainer` must be **template, always, never LLM**.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/coaching/detectors/orient.test.ts
import { describe, it, expect } from 'vitest'
import { detectLevelEstimate, detectMechanicsExplainer } from './orient'
import type { LearnerSnapshot, PlacementSnapshot } from '../types'

function placement(o: Partial<PlacementSnapshot> = {}): PlacementSnapshot {
  return {
    theta: 0.4, se: 0.35, completedAt: '2026-08-01T00:00:00.000Z',
    level: 'N3', thetaLow: -0.1, thetaHigh: 0.9,
    levelLow: 'N4', levelHigh: 'N2',
    previous: null, items: [],
    ...o,
  }
}

function snap(p: PlacementSnapshot | null): LearnerSnapshot {
  return {
    now: '2026-08-02T00:00:00.000Z',
    placement: p,
    reviews: { cards: [], quiz: [] },
    commitment: null,
    hooks: { count: 0, latestAt: null, sessionDates: [], lapsesWithHook: null, lapsesWithoutHook: null },
    priorFindings: [],
  }
}

describe('detectLevelEstimate', () => {
  it('returns null with no placement', () => {
    expect(detectLevelEstimate(snap(null))).toBeNull()
  })

  it('ALWAYS carries the interval, never a bare label (spec §3)', () => {
    const f = detectLevelEstimate(snap(placement()))!
    const labels = f.evidence.map((e) => e.label)
    expect(labels).toContain('most likely level')
    expect(labels).toContain('lower bound')
    expect(labels).toContain('upper bound')
  })

  it('reports a tight estimate more confidently than a wide one', () => {
    const tight = detectLevelEstimate(snap(placement({ se: 0.2, levelLow: 'N3', levelHigh: 'N3' })))!
    const wide = detectLevelEstimate(snap(placement({ se: 1.1, levelLow: 'N5', levelHigh: 'N1' })))!
    expect(tight.confidence).toBeGreaterThan(wide.confidence)
  })

  it('is low magnitude — orienting, not urgent', () => {
    expect(detectLevelEstimate(snap(placement()))!.magnitude).toBeLessThan(0.6)
  })
})

describe('detectMechanicsExplainer', () => {
  it('is present whenever a placement exists — the learner has seen the machinery', () => {
    expect(detectMechanicsExplainer(snap(placement()))).not.toBeNull()
  })

  it('returns null with no placement — nothing to explain yet', () => {
    expect(detectMechanicsExplainer(snap(null))).toBeNull()
  })

  it('carries NO computed evidence — it is template copy, never LLM (spec §3)', () => {
    const f = detectMechanicsExplainer(snap(placement()))!
    expect(f.evidence).toEqual([])
  })

  it('is always fully confident and lowest magnitude — it never competes for a slot', () => {
    const f = detectMechanicsExplainer(snap(placement()))!
    expect(f.confidence).toBe(1)
    expect(f.magnitude).toBeLessThan(0.2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/coaching/detectors/orient.test.ts`
Expected: FAIL — `Failed to resolve import "./orient"`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/coaching/detectors/orient.ts
import type { Finding, LearnerSnapshot } from '../types'
import { normaliseLinear } from '../magnitude'

/**
 * Where the learner is, stated honestly.
 *
 * §3 is emphatic: θ WITH ITS CREDIBLE INTERVAL — "probably N3, possibly N2".
 * Never a bare label. A point estimate from ~13 items presented as fact is the
 * kind of overclaim that destroys trust the first time it is wrong, and the
 * interval is the whole reason an IRT placement is defensible at that length.
 *
 * MAGNITUDE MAPPING (this kind's own scale, per §2): fixed and low. This
 * orients rather than demands action, and it should not crowd out a Direct
 * finding. Priority banding in selection does most of the work; the low
 * magnitude keeps it honest within its own band.
 */
const LEVEL_ESTIMATE_MAGNITUDE = 0.5
/** SE at or below this is a tight estimate; at or above, barely informative. */
const SE_TIGHT = 0.3
const SE_LOOSE = 1.2

export function detectLevelEstimate(snapshot: LearnerSnapshot): Finding | null {
  const p = snapshot.placement
  if (!p) return null

  // Wide interval → low confidence. Inverted because a LARGE se is LESS certain.
  const confidence = 1 - normaliseLinear(p.se, SE_TIGHT, SE_LOOSE)

  return {
    kind: 'level_estimate',
    magnitude: LEVEL_ESTIMATE_MAGNITUDE,
    confidence,
    evidence: [
      { label: 'most likely level', value: p.level },
      { label: 'lower bound', value: p.levelLow },
      { label: 'upper bound', value: p.levelHigh },
      { label: 'ability estimate', value: Math.round(p.theta * 100) / 100 },
      { label: 'standard error', value: Math.round(p.se * 100) / 100 },
    ],
    since: null,
  }
}

/**
 * The IRT two-liner plus a pointer to Profile (§7).
 *
 * TEMPLATE, ALWAYS. NEVER LLM. §3: "Buddy must not improvise about his own
 * algorithm." The explanation never changes, so there is nothing for a model
 * to add and everything for it to get wrong. It therefore carries NO evidence
 * — there is no number in it — and the copy layer (Task 10) must emit it
 * verbatim.
 */
const MECHANICS_MAGNITUDE = 0.1

export function detectMechanicsExplainer(snapshot: LearnerSnapshot): Finding | null {
  if (!snapshot.placement) return null
  return {
    kind: 'mechanics_explainer',
    magnitude: MECHANICS_MAGNITUDE,
    confidence: 1,
    evidence: [],
    since: null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run src/coaching/detectors/orient.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/coaching/detectors/orient.ts packages/shared/src/coaching/detectors/orient.test.ts
git commit -m "feat(coaching): level_estimate always carries its interval; mechanics_explainer is template-only"
```

---

### Task 7: `fluency_gain` and `theta_delta`

**Files:**
- Create: `packages/shared/src/coaching/detectors/fluency.ts`
- Test: `packages/shared/src/coaching/detectors/fluency.test.ts`

**Interfaces:**
- Consumes: `LearnerSnapshot`, `CardSnapshot`, `Finding`; `normaliseLinear`, `confidenceFromCount`.
- Produces: `detectFluencyGain(snapshot: LearnerSnapshot): Finding | null`, `detectThetaDelta(snapshot: LearnerSnapshot): Finding | null`.

**The trap in `fluency_gain`:** §3 says *response time falling **at constant accuracy***. Faster and wronger is not a gain — it is guessing, and praising it would train the wrong behaviour. Accuracy must not have dropped materially.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/coaching/detectors/fluency.test.ts
import { describe, it, expect } from 'vitest'
import { detectFluencyGain, detectThetaDelta } from './fluency'
import type { CardSnapshot, LearnerSnapshot, PlacementSnapshot } from '../types'

function card(o: Partial<CardSnapshot> = {}): CardSnapshot {
  return {
    kanjiId: 1, character: '日', status: 'reviewing',
    lapses: 0, readingStage: null, regressions: 0,
    responseMsEarly: 4000, responseMsLate: 4000,
    accuracyEarly: 0.8, accuracyLate: 0.8,
    recentQualities: [], hasCoCreatedHook: false,
    ...o,
  }
}

function snap(cards: CardSnapshot[], placement: PlacementSnapshot | null = null): LearnerSnapshot {
  return {
    now: '2026-08-02T00:00:00.000Z',
    placement,
    reviews: { cards, quiz: [] },
    commitment: null,
    hooks: { count: 0, latestAt: null, sessionDates: [], lapsesWithHook: null, lapsesWithoutHook: null },
    priorFindings: [],
  }
}

describe('detectFluencyGain', () => {
  it('returns null when nothing has both halves measured', () => {
    expect(detectFluencyGain(snap([card({ responseMsEarly: null })]))).toBeNull()
  })

  it('returns null when response time did not fall', () => {
    expect(detectFluencyGain(snap([card({ responseMsEarly: 3000, responseMsLate: 3500 })]))).toBeNull()
  })

  it('fires when response time falls at flat accuracy', () => {
    const f = detectFluencyGain(snap([
      card({ kanjiId: 1, responseMsEarly: 6000, responseMsLate: 3000 }),
      card({ kanjiId: 2, responseMsEarly: 5000, responseMsLate: 2500 }),
    ]))!
    expect(f.kind).toBe('fluency_gain')
    expect(f.magnitude).toBeGreaterThan(0)
  })

  it('THE TRAP: does NOT fire when they got faster by getting sloppier', () => {
    expect(detectFluencyGain(snap([
      card({ responseMsEarly: 6000, responseMsLate: 2000, accuracyEarly: 0.9, accuracyLate: 0.5 }),
    ]))).toBeNull()
  })

  it('tolerates a small accuracy wobble — flat does not mean identical', () => {
    const f = detectFluencyGain(snap([
      card({ responseMsEarly: 6000, responseMsLate: 3000, accuracyEarly: 0.82, accuracyLate: 0.79 }),
    ]))
    expect(f).not.toBeNull()
  })

  it('still fires when accuracy IMPROVED alongside the speed-up', () => {
    const f = detectFluencyGain(snap([
      card({ responseMsEarly: 6000, responseMsLate: 3000, accuracyEarly: 0.6, accuracyLate: 0.9 }),
    ]))
    expect(f).not.toBeNull()
  })

  it('reports the improvement as a percentage in evidence', () => {
    const f = detectFluencyGain(snap([card({ responseMsEarly: 4000, responseMsLate: 2000 })]))!
    expect(f.evidence.map((e) => e.label)).toContain('percent faster')
  })
})

function placement(o: Partial<PlacementSnapshot> = {}): PlacementSnapshot {
  return {
    theta: 0.8, se: 0.3, completedAt: '2026-08-01T00:00:00.000Z',
    level: 'N2', thetaLow: 0.3, thetaHigh: 1.3, levelLow: 'N3', levelHigh: 'N2',
    previous: { theta: 0.1, se: 0.4, completedAt: '2026-06-01T00:00:00.000Z' },
    items: [],
    ...o,
  }
}

describe('detectThetaDelta', () => {
  it('returns null with no placement', () => {
    expect(detectThetaDelta(snap([], null))).toBeNull()
  })

  it('returns null with only one session — the delta needs two (spec §3)', () => {
    expect(detectThetaDelta(snap([], placement({ previous: null })))).toBeNull()
  })

  it('fires on a real rise', () => {
    const f = detectThetaDelta(snap([], placement()))!
    expect(f.kind).toBe('theta_delta')
    expect(f.magnitude).toBeGreaterThan(0)
  })

  it('returns null when the movement is inside the noise of the two estimates', () => {
    expect(detectThetaDelta(snap([], placement({
      theta: 0.15, se: 0.5,
      previous: { theta: 0.1, se: 0.5, completedAt: '2026-06-01T00:00:00.000Z' },
    })))).toBeNull()
  })

  it('does not fire on a DROP — this is a Motivate finding, not a scolding', () => {
    expect(detectThetaDelta(snap([], placement({
      theta: -0.6,
      previous: { theta: 0.8, se: 0.3, completedAt: '2026-06-01T00:00:00.000Z' },
    })))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/coaching/detectors/fluency.test.ts`
Expected: FAIL — `Failed to resolve import "./fluency"`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/coaching/detectors/fluency.ts
import type { CardSnapshot, Finding, LearnerSnapshot } from '../types'
import { confidenceFromCount, normaliseLinear } from '../magnitude'

/**
 * Getting faster without getting worse.
 *
 * §3 calls this "the finding most likely to exist in a thin week", which is
 * exactly why it must be strict: it will be reached for often, and praise
 * that is not earned is worse than silence.
 *
 * THE TRAP: §3 says response time falling AT CONSTANT ACCURACY. Faster and
 * wronger is guessing, and congratulating it trains the behaviour. Accuracy
 * must not have fallen by more than ACCURACY_SLACK; a RISE is fine.
 *
 * MAGNITUDE MAPPING (this kind's own scale, per §2): the proportional drop in
 * mean response time, linear from 0 at SPEEDUP_FLOOR to 1 at SPEEDUP_CEILING.
 */
const ACCURACY_SLACK = 0.05
const SPEEDUP_FLOOR = 0.1
const SPEEDUP_CEILING = 0.5
const CONFIDENCE_SCALE = 15

function hasBothHalves(c: CardSnapshot): boolean {
  return (
    c.responseMsEarly !== null && c.responseMsLate !== null &&
    c.responseMsEarly > 0 && c.responseMsLate > 0
  )
}

function accuracyHeld(c: CardSnapshot): boolean {
  if (c.accuracyEarly === null || c.accuracyLate === null) return false
  return c.accuracyLate >= c.accuracyEarly - ACCURACY_SLACK
}

export function detectFluencyGain(snapshot: LearnerSnapshot): Finding | null {
  const measurable = snapshot.reviews.cards.filter(hasBothHalves)
  if (measurable.length === 0) return null

  // Faster-but-sloppier cards are excluded outright rather than averaged in,
  // so a genuinely improving card cannot be cancelled by a guessed one.
  const honest = measurable.filter(accuracyHeld)
  if (honest.length === 0) return null

  const early = honest.reduce((s, c) => s + c.responseMsEarly!, 0) / honest.length
  const late = honest.reduce((s, c) => s + c.responseMsLate!, 0) / honest.length
  if (late >= early) return null

  const proportionFaster = (early - late) / early
  const magnitude = normaliseLinear(proportionFaster, SPEEDUP_FLOOR, SPEEDUP_CEILING)
  if (magnitude === 0) return null

  return {
    kind: 'fluency_gain',
    magnitude,
    confidence: confidenceFromCount(honest.length, CONFIDENCE_SCALE),
    evidence: [
      { label: 'percent faster', value: Math.round(proportionFaster * 100) },
      { label: 'average seconds before', value: Math.round(early / 100) / 10 },
      { label: 'average seconds now', value: Math.round(late / 100) / 10 },
      { label: 'kanji measured', value: honest.length },
    ],
    since: null,
  }
}

/**
 * Ability movement between the two most recent placements (§3: needs ≥2).
 *
 * MAGNITUDE MAPPING (this kind's own scale, per §2): the rise in logits,
 * linear from 0 at the combined noise of the two estimates to 1 at
 * DELTA_CEILING. Requiring the movement to clear the noise floor is what stops
 * this congratulating someone for measurement error.
 *
 * Rises only. This sits in the Motivate band — a drop is real information, but
 * delivering it as a "reason to come back" is the wrong instrument, and
 * `retest_due` already covers a decayed estimate.
 */
const DELTA_CEILING = 1.5

export function detectThetaDelta(snapshot: LearnerSnapshot): Finding | null {
  const p = snapshot.placement
  if (!p?.previous) return null

  const rise = p.theta - p.previous.theta
  if (rise <= 0) return null

  // Combined standard error of the difference of two independent estimates.
  const noise = Math.sqrt(p.se * p.se + p.previous.se * p.previous.se)
  const magnitude = normaliseLinear(rise, noise, DELTA_CEILING)
  if (magnitude === 0) return null

  return {
    kind: 'theta_delta',
    magnitude,
    confidence: 1 - normaliseLinear(noise, 0.3, 1.5),
    evidence: [
      { label: 'ability then', value: Math.round(p.previous.theta * 100) / 100 },
      { label: 'ability now', value: Math.round(p.theta * 100) / 100 },
      { label: 'measured on', value: p.completedAt.slice(0, 10) },
      { label: 'previously measured on', value: p.previous.completedAt.slice(0, 10) },
    ],
    since: null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run src/coaching/detectors/fluency.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/coaching/detectors/fluency.ts packages/shared/src/coaching/detectors/fluency.test.ts
git commit -m "feat(coaching): fluency_gain requires flat accuracy; theta_delta must clear combined noise"
```

---

### Task 8: `hardest_cleared` and `retest_due`

**Files:**
- Create: `packages/shared/src/coaching/detectors/milestones.ts`
- Test: `packages/shared/src/coaching/detectors/milestones.test.ts`

**Interfaces:**
- Consumes: `LearnerSnapshot`, `Finding`; `normaliseLinear`; `widenForStaleness` from `../../placement-difficulty`.
- Produces: `detectHardestCleared(snapshot: LearnerSnapshot): Finding | null`, `detectRetestDue(snapshot: LearnerSnapshot): Finding | null`.

**`retest_due` reuses `widenForStaleness`,** which already exists at `packages/shared/src/placement-difficulty.ts:190` with signature `(se: number, daysElapsed: number, drift?: number) => number`. §3 is specific about the framing this enables: *the value of the test increases if it is repeated*, not *please take a test*.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/coaching/detectors/milestones.test.ts
import { describe, it, expect } from 'vitest'
import { detectHardestCleared, detectRetestDue } from './milestones'
import type { LearnerSnapshot, PlacementItemOutcome, PlacementSnapshot } from '../types'

function item(o: Partial<PlacementItemOutcome> = {}): PlacementItemOutcome {
  return {
    kanjiId: 1, character: '日',
    meaningCorrect: true, readingCorrect: true,
    readingOffset: 0.3, difficultyAtAsk: 0,
    ...o,
  }
}

function placement(o: Partial<PlacementSnapshot> = {}): PlacementSnapshot {
  return {
    theta: 0.4, se: 0.3, completedAt: '2026-08-01T00:00:00.000Z',
    level: 'N3', thetaLow: -0.1, thetaHigh: 0.9, levelLow: 'N4', levelHigh: 'N3',
    previous: null, items: [],
    ...o,
  }
}

function snap(p: PlacementSnapshot | null, now = '2026-08-02T00:00:00.000Z'): LearnerSnapshot {
  return {
    now,
    placement: p,
    reviews: { cards: [], quiz: [] },
    commitment: null,
    hooks: { count: 0, latestAt: null, sessionDates: [], lapsesWithHook: null, lapsesWithoutHook: null },
    priorFindings: [],
  }
}

describe('detectHardestCleared', () => {
  it('returns null with no placement', () => {
    expect(detectHardestCleared(snap(null))).toBeNull()
  })

  it('returns null when nothing was answered correctly', () => {
    expect(detectHardestCleared(snap(placement({
      items: [item({ meaningCorrect: false, difficultyAtAsk: 1.5 })],
    })))).toBeNull()
  })

  it('names the hardest item answered correctly', () => {
    const f = detectHardestCleared(snap(placement({
      items: [
        item({ kanjiId: 1, character: '一', difficultyAtAsk: -1 }),
        item({ kanjiId: 2, character: '鬱', difficultyAtAsk: 2.1 }),
        item({ kanjiId: 3, character: '三', difficultyAtAsk: 0.2 }),
      ],
    })))!
    const named = f.evidence.find((e) => e.character !== undefined)!
    expect(named.character).toBe('鬱')
  })

  it('ignores a hard item that was answered WRONG', () => {
    const f = detectHardestCleared(snap(placement({
      items: [
        item({ kanjiId: 1, character: '易', difficultyAtAsk: 0.1 }),
        item({ kanjiId: 2, character: '鬱', difficultyAtAsk: 2.5, meaningCorrect: false }),
      ],
    })))!
    expect(f.evidence.find((e) => e.character !== undefined)!.character).toBe('易')
  })

  it('scales with how hard the cleared item was', () => {
    const easy = detectHardestCleared(snap(placement({ items: [item({ difficultyAtAsk: -1 })] })))
    const hard = detectHardestCleared(snap(placement({ items: [item({ difficultyAtAsk: 2.5 })] })))!
    expect(hard.magnitude).toBeGreaterThan(easy?.magnitude ?? 0)
  })
})

describe('detectRetestDue', () => {
  it('returns null with no placement', () => {
    expect(detectRetestDue(snap(null))).toBeNull()
  })

  it('stays quiet on a fresh, tight estimate', () => {
    expect(detectRetestDue(snap(
      placement({ se: 0.25, completedAt: '2026-08-01T00:00:00.000Z' }),
      '2026-08-02T00:00:00.000Z',
    ))).toBeNull()
  })

  it('fires once the estimate has decayed with time', () => {
    const f = detectRetestDue(snap(
      placement({ se: 0.4, completedAt: '2026-01-01T00:00:00.000Z' }),
      '2026-08-02T00:00:00.000Z',
    ))!
    expect(f.kind).toBe('retest_due')
    expect(f.magnitude).toBeGreaterThan(0)
  })

  it('grows the longer the estimate goes unrefreshed', () => {
    const older = detectRetestDue(snap(placement({ se: 0.4, completedAt: '2025-08-01T00:00:00.000Z' }), '2026-08-02T00:00:00.000Z'))!
    const newer = detectRetestDue(snap(placement({ se: 0.4, completedAt: '2026-02-01T00:00:00.000Z' }), '2026-08-02T00:00:00.000Z'))!
    expect(older.magnitude).toBeGreaterThan(newer.magnitude)
  })

  it('reports the widened interval, not the stale stored one', () => {
    const f = detectRetestDue(snap(placement({ se: 0.4, completedAt: '2026-01-01T00:00:00.000Z' }), '2026-08-02T00:00:00.000Z'))!
    const widened = f.evidence.find((e) => e.label === 'current uncertainty')!
    expect(Number(widened.value)).toBeGreaterThan(0.4)
  })

  it('is always fully confident — this is arithmetic on our own estimate', () => {
    const f = detectRetestDue(snap(placement({ se: 0.4, completedAt: '2026-01-01T00:00:00.000Z' }), '2026-08-02T00:00:00.000Z'))!
    expect(f.confidence).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/coaching/detectors/milestones.test.ts`
Expected: FAIL — `Failed to resolve import "./milestones"`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/coaching/detectors/milestones.ts
import type { Finding, LearnerSnapshot } from '../types'
import { normaliseLinear } from '../magnitude'
import { widenForStaleness } from '../../placement-difficulty'

/**
 * The hardest item the learner actually got right — §3: "concrete, earned
 * praise". Specific beats generic: naming the kanji is the whole value, so a
 * correct answer is required and difficulty alone is not enough.
 *
 * MAGNITUDE MAPPING (this kind's own scale, per §2): the cleared item's
 * difficulty in logits, linear from 0 at PRAISE_FLOOR to 1 at PRAISE_CEILING.
 * Below the floor, clearing it is not news.
 */
const PRAISE_FLOOR = -1
const PRAISE_CEILING = 2.5

export function detectHardestCleared(snapshot: LearnerSnapshot): Finding | null {
  const p = snapshot.placement
  if (!p) return null

  const cleared = p.items.filter((i) => i.meaningCorrect)
  if (cleared.length === 0) return null

  const hardest = cleared.reduce((a, b) => (b.difficultyAtAsk > a.difficultyAtAsk ? b : a))

  return {
    kind: 'hardest_cleared',
    magnitude: normaliseLinear(hardest.difficultyAtAsk, PRAISE_FLOOR, PRAISE_CEILING),
    confidence: 1,
    evidence: [
      {
        label: 'hardest kanji cleared',
        value: hardest.character,
        kanjiId: hardest.kanjiId,
        character: hardest.character,
      },
      { label: 'item difficulty', value: Math.round(hardest.difficultyAtAsk * 100) / 100 },
    ],
    since: null,
  }
}

/**
 * The estimate has decayed enough that repeating the test is worth something.
 *
 * §3: this is the mechanism behind "revisit periodically" — Buddy suggests a
 * retake AT THE STATISTICALLY RIGHT MOMENT rather than on a calendar, framed
 * as the owner framed it: THE VALUE OF THE TEST INCREASES IF IT IS REPEATED,
 * not "please take a test". The copy layer owns that framing; this owns when.
 *
 * Reuses `widenForStaleness` (packages/shared/src/placement-difficulty.ts),
 * which is already what `getSessionPrior` uses to age a stored SE.
 *
 * MAGNITUDE MAPPING (this kind's own scale, per §2): the WIDENED se, linear
 * from 0 at RETEST_FLOOR to 1 at RETEST_CEILING. Keyed on the widened value,
 * not elapsed days, so a learner whose estimate was already loose is prompted
 * sooner than one whose was tight — which is the point.
 */
const RETEST_FLOOR = 0.5
const RETEST_CEILING = 1.2

export function detectRetestDue(snapshot: LearnerSnapshot): Finding | null {
  const p = snapshot.placement
  if (!p) return null

  const daysElapsed = Math.max(
    0,
    (Date.parse(snapshot.now) - Date.parse(p.completedAt)) / 86_400_000,
  )
  const widened = widenForStaleness(p.se, daysElapsed)

  const magnitude = normaliseLinear(widened, RETEST_FLOOR, RETEST_CEILING)
  if (magnitude === 0) return null

  return {
    kind: 'retest_due',
    magnitude,
    confidence: 1,
    evidence: [
      { label: 'current uncertainty', value: Math.round(widened * 100) / 100 },
      { label: 'uncertainty when measured', value: Math.round(p.se * 100) / 100 },
      { label: 'days since the test', value: Math.round(daysElapsed) },
    ],
    since: null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run src/coaching/detectors/milestones.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/coaching/detectors/milestones.ts packages/shared/src/coaching/detectors/milestones.test.ts
git commit -m "feat(coaching): hardest_cleared names an earned win; retest_due keys on the widened SE"
```

---

### Task 9: The selection policy

**Files:**
- Create: `packages/shared/src/coaching/selection.ts`
- Test: `packages/shared/src/coaching/selection.test.ts`

**Interfaces:**
- Consumes: `Finding`, `FindingKind`, `PriorFinding`, `FINDING_PRIORITY` (Task 1).
- Produces: `novelty(kind, priors, now): number`, `select(findings, priors, now, count?): Finding[]`. `count` defaults to `DEFAULT_FINDING_COUNT` (3).

**Two properties are the testable contract (§4)**, not implementation detail:
1. **Monotonically decreasing** in how recently the kind was raised.
2. **Never reaches zero** — *"a finding that has been true for six weeks is not less important than a new one — it is more important, and going quiet on it is the coaching failure this policy exists to prevent."*

**And §14.1:** the count is a **parameter, not a constant**, so it can be tuned without a code change.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/coaching/selection.test.ts
import { describe, it, expect } from 'vitest'
import { novelty, select, DEFAULT_FINDING_COUNT, NOVELTY_FLOOR } from './selection'
import type { Finding, FindingKind, PriorFinding } from './types'

const NOW = '2026-08-02T00:00:00.000Z'

function prior(kind: FindingKind, lastRaisedDaysAgo: number, sinceDaysAgo = lastRaisedDaysAgo): PriorFinding {
  const day = 86_400_000
  return {
    kind,
    since: new Date(Date.parse(NOW) - sinceDaysAgo * day).toISOString(),
    lastRaisedAt: new Date(Date.parse(NOW) - lastRaisedDaysAgo * day).toISOString(),
  }
}

function finding(kind: FindingKind, magnitude: number, confidence = 1): Finding {
  return { kind, magnitude, confidence, evidence: [], since: null }
}

describe('novelty', () => {
  it('is 1 for a kind never raised before', () => {
    expect(novelty('leech', [], NOW)).toBe(1)
  })

  it('PROPERTY 1: monotonically decreasing in how RECENTLY it was raised', () => {
    const ages = [0, 1, 3, 7, 14, 30, 90]
    const values = ages.map((d) => novelty('leech', [prior('leech', d)], NOW))
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!)
    }
  })

  it('PROPERTY 2: never reaches zero, even raised moments ago', () => {
    expect(novelty('leech', [prior('leech', 0)], NOW)).toBeGreaterThan(0)
    expect(novelty('leech', [prior('leech', 0)], NOW)).toBe(NOVELTY_FLOOR)
  })

  it('never exceeds 1', () => {
    expect(novelty('leech', [prior('leech', 3650)], NOW)).toBeLessThanOrEqual(1)
  })

  it('is unaffected by a prior for a DIFFERENT kind', () => {
    expect(novelty('leech', [prior('commitment_gap', 0)], NOW)).toBe(1)
  })
})

describe('select', () => {
  it('returns at most `count`, defaulting to DEFAULT_FINDING_COUNT', () => {
    const findings = (['leech', 'reading_lag', 'commitment_gap', 'hook_coverage', 'retest_due'] as FindingKind[])
      .map((k) => finding(k, 0.8))
    expect(select(findings, [], NOW)).toHaveLength(DEFAULT_FINDING_COUNT)
  })

  it('SPEC §14.1: the count is a parameter, not a constant', () => {
    const findings = (['leech', 'reading_lag', 'commitment_gap'] as FindingKind[]).map((k) => finding(k, 0.8))
    expect(select(findings, [], NOW, 1)).toHaveLength(1)
    expect(select(findings, [], NOW, 2)).toHaveLength(2)
  })

  it('drops findings with zero confidence — absent data must never speak', () => {
    expect(select([finding('leech', 0.9, 0)], [], NOW)).toEqual([])
  })

  it('ranks by magnitude x confidence x novelty', () => {
    const strong = finding('leech', 0.9)
    const weak = finding('retest_due', 0.2)
    expect(select([weak, strong], [], NOW, 1)[0]!.kind).toBe('leech')
  })

  it('a hedged finding loses to a confident one of equal magnitude', () => {
    const sure = finding('leech', 0.6, 1.0)
    const unsure = finding('reading_lag', 0.6, 0.2)
    expect(select([unsure, sure], [], NOW, 1)[0]!.kind).toBe('leech')
  })

  it('demotes — but does NOT silence — a finding raised last week', () => {
    const stale = finding('leech', 0.9)
    const fresh = finding('retest_due', 0.5)
    const priors = [prior('leech', 1)]
    expect(select([stale, fresh], priors, NOW, 1)[0]!.kind).toBe('retest_due')
    expect(select([stale, fresh], priors, NOW, 2).map((f) => f.kind)).toContain('leech')
  })

  it('breaks a tie on priority band — Direct before Orient before Motivate', () => {
    const motivate = finding('retest_due', 0.5)
    const direct = finding('leech', 0.5)
    expect(select([motivate, direct], [], NOW, 1)[0]!.kind).toBe('leech')
  })

  it('stamps `since` from the prior so persistence is visible to the voice', () => {
    const priors = [prior('leech', 2, 40)]
    const out = select([finding('leech', 0.9)], priors, NOW, 1)
    expect(out[0]!.since).toBe(priors[0]!.since)
  })

  it('leaves `since` null for a genuinely new finding', () => {
    expect(select([finding('leech', 0.9)], [], NOW, 1)[0]!.since).toBeNull()
  })

  it('is deterministic — same input, same order, every call', () => {
    const findings = (['leech', 'reading_lag', 'commitment_gap'] as FindingKind[]).map((k) => finding(k, 0.5))
    const first = select(findings, [], NOW).map((f) => f.kind)
    for (let i = 0; i < 5; i++) {
      expect(select(findings, [], NOW).map((f) => f.kind)).toEqual(first)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/coaching/selection.test.ts`
Expected: FAIL — `Failed to resolve import "./selection"`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/coaching/selection.ts
import { FINDING_PRIORITY, type Finding, type FindingKind, type PriorFinding } from './types'

/**
 * Selection: severity x novelty, with decay (spec §4).
 *
 * Rank by `magnitude x confidence x novelty(kind, since)` and take the top N.
 *
 * TWO PROPERTIES ARE THE TESTABLE CONTRACT, and both exist because of what
 * they rule out:
 *
 *   1. MONOTONICALLY DECREASING in how recently the kind was raised.
 *   2. NEVER REACHES ZERO. "A finding that has been true for six weeks is not
 *      less important than a new one — it is more important, and going quiet
 *      on it is the coaching failure this policy exists to prevent."
 *
 * §4 explicitly REJECTS a hard novelty gate (goes silent on the most important
 * problem precisely because it is persistent) and fixed lens rotation
 * (arbitrary; reports whatever the lens sees rather than what matters).
 * Neither may be reintroduced here.
 */

/** Novelty of a kind raised moments ago. Above zero, by contract. */
export const NOVELTY_FLOOR = 0.25
/** Days at which a raised kind recovers ~63% of the way back to full novelty. */
export const NOVELTY_HALFLIFE_DAYS = 14

/**
 * Default findings per surface. §14.1: the owner accepted 2–3 "as a dial we
 * can tune later on", so this is a DEFAULT for a parameter, never an inlined
 * constant. Changing the number must not require touching detector code.
 */
export const DEFAULT_FINDING_COUNT = 3

export function novelty(
  kind: FindingKind,
  priors: readonly PriorFinding[],
  now: string,
): number {
  const prior = priors.find((p) => p.kind === kind)
  if (!prior) return 1

  const daysSince = Math.max(
    0,
    (Date.parse(now) - Date.parse(prior.lastRaisedAt)) / 86_400_000,
  )
  // Floor at NOVELTY_FLOOR when just raised, rising asymptotically to 1.
  return NOVELTY_FLOOR + (1 - NOVELTY_FLOOR) * (1 - Math.exp(-daysSince / NOVELTY_HALFLIFE_DAYS))
}

export function select(
  findings: readonly Finding[],
  priors: readonly PriorFinding[],
  now: string,
  count: number = DEFAULT_FINDING_COUNT,
): Finding[] {
  const scored = findings
    // Zero confidence means absent data. It must never speak.
    .filter((f) => f.confidence > 0)
    .map((f) => {
      const prior = priors.find((p) => p.kind === f.kind)
      return {
        // `since` carries how long this has been true, which is what lets the
        // voice escalate: "readings again — let's try something different".
        finding: { ...f, since: prior?.since ?? null },
        score: f.magnitude * f.confidence * novelty(f.kind, priors, now),
      }
    })

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      FINDING_PRIORITY[a.finding.kind] - FINDING_PRIORITY[b.finding.kind] ||
      a.finding.kind.localeCompare(b.finding.kind),
  )

  return scored.slice(0, Math.max(0, count)).map((s) => s.finding)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run src/coaching/selection.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/coaching/selection.ts packages/shared/src/coaching/selection.test.ts
git commit -m "feat(coaching): selection by magnitude x confidence x novelty, decay floored above zero"
```

---

### Task 10: `analyze()`, the template floor, and the global invariants

**Files:**
- Create: `packages/shared/src/coaching/copy.ts`
- Create: `packages/shared/src/coaching/analyze.ts`
- Create: `packages/shared/src/coaching/index.ts`
- Modify: `packages/shared/src/index.ts` (add the barrel export)
- Test: `packages/shared/src/coaching/analyze.test.ts`

**Interfaces:**
- Consumes: every detector (Tasks 2–8), `select` (Task 9).
- Produces: `analyze(snapshot: LearnerSnapshot, count?: number): Finding[]`, `templateCopy(finding: Finding): string`, and the barrel re-export from `@kanji-learn/shared`.

**Why template copy is in this slice and not a later one.** §1: *"Every finding kind ships with template copy. Non-negotiable: Phase 7's entire HIGH-defect wave was the template floor failing to complete."* Offline, or with the LLM down, Buddy must still say the true thing. If it lands with the LLM surface instead, the floor is what gets cut when that slice runs long.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/coaching/analyze.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { analyze } from './analyze'
import { templateCopy } from './copy'
import { FINDING_PRIORITY, type FindingKind, type LearnerSnapshot } from './types'

const ALL_KINDS = Object.keys(FINDING_PRIORITY) as FindingKind[]

const EMPTY: LearnerSnapshot = {
  now: '2026-08-02T00:00:00.000Z',
  placement: null,
  reviews: { cards: [], quiz: [] },
  commitment: null,
  hooks: { count: 0, latestAt: null, sessionDates: [], lapsesWithHook: null, lapsesWithoutHook: null },
  priorFindings: [],
}

describe('analyze', () => {
  it('THE §10 INVARIANT: absent data produces no finding with confidence > 0', () => {
    for (const f of analyze(EMPTY)) {
      expect(f.confidence).toBe(0)
    }
    expect(analyze(EMPTY)).toEqual([])
  })

  it('returns at most the requested count', () => {
    const rich: LearnerSnapshot = {
      ...EMPTY,
      placement: {
        theta: 0.9, se: 0.9, completedAt: '2026-01-01T00:00:00.000Z',
        level: 'N2', thetaLow: 0, thetaHigh: 1.8, levelLow: 'N3', levelHigh: 'N1',
        previous: { theta: 0.1, se: 0.3, completedAt: '2025-11-01T00:00:00.000Z' },
        items: [
          { kanjiId: 1, character: '鬱', meaningCorrect: true, readingCorrect: false, readingOffset: 0.1, difficultyAtAsk: 2.2 },
          { kanjiId: 2, character: '日', meaningCorrect: true, readingCorrect: false, readingOffset: 0.1, difficultyAtAsk: 0.1 },
          { kanjiId: 3, character: '一', meaningCorrect: true, readingCorrect: false, readingOffset: 0.1, difficultyAtAsk: -0.5 },
        ],
      },
      commitment: { promisedMinutes: 70, actualMinutes: 5, periodStart: '2026-07-26T00:00:00.000Z', periodEnd: '2026-08-02T00:00:00.000Z' },
    }
    expect(analyze(rich, 2).length).toBeLessThanOrEqual(2)
    expect(analyze(rich, 2).length).toBeGreaterThan(0)
  })

  it('is deterministic', () => {
    const first = JSON.stringify(analyze(EMPTY))
    for (let i = 0; i < 3; i++) expect(JSON.stringify(analyze(EMPTY))).toBe(first)
  })

  it('never returns a magnitude or confidence outside 0..1', () => {
    const s: LearnerSnapshot = {
      ...EMPTY,
      commitment: { promisedMinutes: 1, actualMinutes: 0, periodStart: '2026-07-26T00:00:00.000Z', periodEnd: '2026-08-02T00:00:00.000Z' },
    }
    for (const f of analyze(s)) {
      expect(f.magnitude).toBeGreaterThanOrEqual(0)
      expect(f.magnitude).toBeLessThanOrEqual(1)
      expect(f.confidence).toBeGreaterThanOrEqual(0)
      expect(f.confidence).toBeLessThanOrEqual(1)
    }
  })
})

describe('templateCopy — the offline floor (spec §1)', () => {
  it('EVERY kind has copy. This is the non-negotiable one', () => {
    for (const kind of ALL_KINDS) {
      const text = templateCopy({ kind, magnitude: 0.5, confidence: 0.5, evidence: [], since: null })
      expect(text.length, `${kind} has no template copy`).toBeGreaterThan(0)
    }
  })

  it('hedges a low-confidence finding differently from a confident one', () => {
    const low = templateCopy({ kind: 'reading_lag', magnitude: 0.8, confidence: 0.1, evidence: [], since: null })
    const high = templateCopy({ kind: 'reading_lag', magnitude: 0.8, confidence: 0.95, evidence: [], since: null })
    expect(low).not.toBe(high)
  })

  it('escalates a finding that has been true for weeks (spec §4)', () => {
    const fresh = templateCopy({ kind: 'reading_lag', magnitude: 0.8, confidence: 0.9, evidence: [], since: null })
    const persistent = templateCopy({ kind: 'reading_lag', magnitude: 0.8, confidence: 0.9, evidence: [], since: '2026-06-01T00:00:00.000Z' })
    expect(persistent).not.toBe(fresh)
  })
})

describe('purity (global constraint)', () => {
  const DIR = __dirname

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? sources(join(dir, e.name))
        : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')
          ? [join(dir, e.name)]
          : [],
    )
  }

  it('imports nothing from apps/', () => {
    for (const file of sources(DIR)) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/from ['"].*apps\//)
    }
  })

  it('reads no clock — time enters through snapshot.now', () => {
    for (const file of sources(DIR)) {
      const src = readFileSync(file, 'utf8')
      expect(src, `${file} calls Date.now()`).not.toMatch(/Date\.now\(\)/)
      expect(src, `${file} constructs an ambient date`).not.toMatch(/new Date\(\s*\)/)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/coaching/analyze.test.ts`
Expected: FAIL — `Failed to resolve import "./analyze"`.

- [ ] **Step 3: Write the template floor**

```ts
// packages/shared/src/coaching/copy.ts
import type { Finding, FindingKind } from './types'

/**
 * The offline floor (spec §1).
 *
 * "Every finding kind ships with template copy. Non-negotiable: Phase 7's
 * entire HIGH-defect wave was the template floor failing to complete."
 *
 * Offline, or with the LLM down, Buddy still says the true thing — just less
 * warmly. This lives in slice 1 rather than with the LLM surface precisely so
 * it cannot be the thing that gets cut when a later slice runs long.
 *
 * NOTE: these are FRAMES, not final voice. The LLM's job is to say the same
 * true thing warmly; its input is the Finding, never a row (§1).
 */

const BASE: Record<FindingKind, string> = {
  reading_lag:
    'Your readings are trailing your meanings by more than the usual gap.',
  leech:
    'A handful of kanji keep slipping back no matter how often they come round.',
  commitment_gap:
    'You studied less than you promised yourself this period.',
  hook_coverage:
    'Building a hook for a kanji you keep missing tends to make it stick. Want to make one together?',
  level_estimate:
    'Your placement puts you around this level, with some room either side.',
  // §3: template, always, never LLM. Buddy must not improvise about his own
  // algorithm, so this string is the whole finding.
  mechanics_explainer:
    'Your level comes from a statistical technique called IRT — the test gets harder when you do well, which is how it can say something useful in about a dozen questions. There is a fuller explanation in your Profile.',
  fluency_gain:
    'You are answering faster than you were, without losing accuracy.',
  theta_delta:
    'Your ability estimate has moved up since your last placement.',
  hardest_cleared:
    'You cleared the hardest kanji the test put in front of you.',
  retest_due:
    'Your placement estimate has drifted since it was taken. Repeating the test now would sharpen it — the value of the test goes up when it is repeated.',
}

/** Below this, say it as a suspicion rather than a fact (§2). */
const HEDGE_BELOW = 0.4
/** Above this many days as a live finding, name the persistence (§4). */
const ESCALATE_AFTER_DAYS = 21

export function templateCopy(finding: Finding, now?: string): string {
  const base = BASE[finding.kind]

  // mechanics_explainer is fixed copy by contract — no hedging, no escalation.
  if (finding.kind === 'mechanics_explainer') return base

  let text = base

  if (finding.confidence < HEDGE_BELOW) {
    text = `Early signal, so take it lightly: ${lowerFirst(text)}`
  }

  if (finding.since) {
    const reference = now ? Date.parse(now) : Date.parse(finding.since)
    const days = (reference - Date.parse(finding.since)) / 86_400_000
    if (!now || days >= ESCALATE_AFTER_DAYS) {
      text = `${text} This has been true for a while now — worth trying something different.`
    }
  }

  return text
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}
```

- [ ] **Step 4: Write `analyze()` and the barrels**

```ts
// packages/shared/src/coaching/analyze.ts
import type { Finding, LearnerSnapshot } from './types'
import { select, DEFAULT_FINDING_COUNT } from './selection'
import { detectReadingLag } from './detectors/reading-lag'
import { detectLeech } from './detectors/leech'
import { detectCommitmentGap } from './detectors/commitment-gap'
import { detectHookCoverage } from './detectors/hook-coverage'
import { detectLevelEstimate, detectMechanicsExplainer } from './detectors/orient'
import { detectFluencyGain, detectThetaDelta } from './detectors/fluency'
import { detectHardestCleared, detectRetestDue } from './detectors/milestones'

/**
 * The whole analyzer (spec §1). Pure: no I/O, no LLM, no clock.
 *
 * Every number the coaching feature will ever show a learner is computed
 * behind this function, which is why it is testable in the shared lane with
 * no database, sub-second, in CI today.
 */
const DETECTORS: ((s: LearnerSnapshot) => Finding | null)[] = [
  detectReadingLag,
  detectLeech,
  detectCommitmentGap,
  detectHookCoverage,
  detectLevelEstimate,
  detectMechanicsExplainer,
  detectFluencyGain,
  detectThetaDelta,
  detectHardestCleared,
  detectRetestDue,
]

export function analyze(
  snapshot: LearnerSnapshot,
  count: number = DEFAULT_FINDING_COUNT,
): Finding[] {
  const found = DETECTORS
    .map((detect) => detect(snapshot))
    .filter((f): f is Finding => f !== null)

  return select(found, snapshot.priorFindings, snapshot.now, count)
}
```

```ts
// packages/shared/src/coaching/index.ts
export * from './types'
export * from './magnitude'
export * from './selection'
export * from './copy'
export * from './analyze'
export * from './detectors/reading-lag'
export * from './detectors/leech'
export * from './detectors/commitment-gap'
export * from './detectors/hook-coverage'
export * from './detectors/orient'
export * from './detectors/fluency'
export * from './detectors/milestones'
```

Then add one line to `packages/shared/src/index.ts`, after the existing `export * from './notebook/assemble'`:

```ts
export * from './coaching'
```

- [ ] **Step 5: Run the full shared lane**

Run: `pnpm --filter @kanji-learn/shared test`
Expected: PASS. All pre-existing tests still green, plus the coaching suites.

- [ ] **Step 6: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: `Tasks: 4 successful, 4 total`. The barrel export is now visible to `apps/api` and `apps/mobile`, so a name collision with an existing shared export surfaces here.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/coaching/ packages/shared/src/index.ts
git commit -m "feat(coaching): analyze() composes the detectors; template floor ships with slice 1"
```

---

## Self-Review

**1. Spec coverage.**

| Spec section | Task |
|---|---|
| §1 pure `analyze()` | 10 |
| §1 template floor, non-negotiable | 10 |
| §1 LLM sees findings, never raw data | Enforced by `Evidence` carrying pre-labelled values (Task 1) |
| §2 Finding contract | 1 |
| §2 magnitude normalised per kind | 1, and documented in every detector |
| §2 confidence hedges honestly | 1, asserted in Tasks 2–8 |
| §3 all four Direct kinds | 2, 3, 4, 5 |
| §3 both Orient kinds | 6 |
| §3 all four Motivate kinds | 7, 8 |
| §3 `retest_due` reuses `widenForStaleness` | 8 |
| §4 selection, decay, both properties | 9 |
| §10 no finding with confidence > 0 on absent data | 10 |
| §14.1 count is a dial | 9 (`select`'s `count` parameter) |
| §14.4 `hook_coverage` is an offer on a named kanji | 5 |

**Deliberately out of this slice, each with its own plan:** §5 two modes, §6 cadence and triggers, §7 the Profile IRT section, §8 goal collection, and snapshot assembly from Postgres. §14.2 (companion mode's single prompt) and the §8 third escalator option land in slices 3–4 and 6 respectively.

**2. Placeholder scan.** No TBDs. Every code step carries complete, runnable code. Every test step carries real assertions with expected pass/fail output.

**3. Type consistency.** `LearnerSnapshot` field names used in Tasks 2–8 (`placement.items`, `reviews.cards`, `reviews.quiz`, `commitment`, `hooks`, `priorFindings`, `now`) all match Task 1's definition. `detect*` all return `Finding | null`. `select(findings, priors, now, count?)` matches its call in Task 10. `widenForStaleness(se, daysElapsed)` matches the real signature at `packages/shared/src/placement-difficulty.ts:190`.

**One thing a slice-2 author must know:** every detector sets `since: null`, and `select()` is the only place that stamps it from `priorFindings`. A future caller that skips `select()` and uses raw detector output will silently lose the persistence signal that makes §4's escalating framing work.

## Two risks worth naming before execution

**1. The thresholds in this plan are reasoned, not calibrated.** `LAPSE_THRESHOLD = 4`, `NOVELTY_HALFLIFE_DAYS = 14`, `SE_LOOSE = 1.2` and their siblings are defensible starting points, not measured ones. They are all named constants at the top of their modules for exactly that reason. Expect to tune them against real snapshots once slice 2 can produce them — and prefer tuning to rewriting.

**2. `readingOffset` semantics need one confirmation in slice 2.** Task 2 treats the mean `readingOffset` as directly comparable to an accuracy gap. `readingOffset` is stored in **logits** (`bReading = b + readingOffset`), and an accuracy difference is a **probability**. Over the narrow range of a placement these track each other closely enough for a threshold comparison, and the test fixtures are written in those terms — but when slice 2 wires real data in, verify the resulting magnitudes look sane on a live snapshot before trusting them. If they do not, convert through `probCorrect(theta, b)` from `packages/shared/src/placement.ts` rather than adjusting `LAG_FLOOR` until it looks right.
