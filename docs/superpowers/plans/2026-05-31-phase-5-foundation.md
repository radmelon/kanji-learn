# Phase 5 Foundation (Shared Logic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, dependency-free foundation for Phase 5 Contextual Mnemonic Co-Creation in `packages/shared` — the radical dictionary, the template assembler, the cadence math, and the trigger/distractor selectors — fully unit-tested, so the mobile and API layers (Plans 2–4) can consume stable types.

**Architecture:** A new `packages/shared/src/mnemonics/` module mirroring the existing `milestones/` module (types + focused logic files + colocated vitest tests + barrel). Everything here is a pure function over plain data — no I/O, no React, no DB. The mobile app's existing `RADICAL_NAMES` map is refactored to derive from the new shared dictionary so there is one source of truth.

**Tech Stack:** TypeScript, vitest (already configured in `packages/shared`). Run tests with `pnpm --filter @kanji-learn/shared test`.

**Spec:** [docs/superpowers/specs/2026-05-31-phase-5-mnemonic-cocreation-design.md](../specs/2026-05-31-phase-5-mnemonic-cocreation-design.md) — this plan implements §6 (cadence), §7.1–7.2 (dictionary + template assembler), §4.1 (trigger), §8 (distractors).

---

## File Structure

```
packages/shared/src/mnemonics/
  types.ts              # RadicalEntry, AssemblerSlots, ReviewedCard, BuddyMomentAction, constants
  cadence.ts            # updateEffectiveness, shouldDeepen
  cadence.test.ts
  trigger.ts            # pickBuddyMomentAction
  trigger.test.ts
  distractors.ts        # selectDistractors
  distractors.test.ts
  radical-dictionary.ts # RADICAL_DICTIONARY, lookupComponents
  radical-dictionary.test.ts
  assembler.ts          # assembleTemplate (+ private frames/clauses)
  assembler.test.ts
  index.ts              # barrel
packages/shared/src/index.ts            # add: export * from './mnemonics'
apps/mobile/src/constants/radicals.ts   # refactor: derive RADICAL_NAMES from shared dictionary
```

**Why these boundaries:** each file is one pure responsibility and is independently testable. `types.ts` is the only file the other modules (and Plans 2–4) import for shapes — it locks the contract early.

---

### Task 1: Scaffold the module + shared types

**Files:**
- Create: `packages/shared/src/mnemonics/types.ts`
- Create: `packages/shared/src/mnemonics/index.ts`
- Modify: `packages/shared/src/index.ts` (add barrel export)
- Test: `packages/shared/src/mnemonics/types.test.ts`

- [ ] **Step 1: Write `types.ts`**

```ts
// packages/shared/src/mnemonics/types.ts

/** Which assembly tier produced a mnemonic story. */
export type AssemblyTier = 'template' | 'on_device' | 'cloud'

/** One radical/component, enriched for teaching + mnemonic assembly. */
export interface RadicalEntry {
  /** The radical/component character, e.g. '扌'. */
  char: string
  /** Japanese dictionary name (romaji), e.g. 'tehen'. Reused from the mobile RADICAL_NAMES set. */
  name: string
  /** Short English meaning for teaching + assembly, e.g. 'hand'. */
  meaning: string
  /** Vivid image phrase for weaving into a story, e.g. 'a hand reaching out, grasping'. */
  imageKeyword: string
}

/** Structured inputs the assembler (all three tiers) weaves into a story. */
export interface AssemblerSlots {
  kanji: string
  kanjiMeaning: string
  /** Kana reading, e.g. 'もつ'. */
  reading: string
  /** Resolved, mapped components (unmapped ones are filtered out before assembly). */
  components: RadicalEntry[]
  /** Reverse-geocoded place name OR the user's free-text location. */
  locationName: string
  /** Q1 answer — the environmental anchor, e.g. 'a yellow vending machine'. */
  anchor: string
  /** Q2 answer — optional personal detail, e.g. 'a blue shirt'. */
  personalDetail?: string
  /** Q3 answer — optional reading wordplay seed. */
  readingPlay?: string
}

// ── Cadence constants (§6) ────────────────────────────────────────────────
export const EFFECTIVENESS_DEFAULT = 0.5
export const EFFECTIVENESS_ALPHA = 0.4
export const DEEPEN_MIN_REINFORCEMENTS = 2
export const DEEPEN_SCORE_FLOOR = 0.35

// ── Trigger (§4.1) ────────────────────────────────────────────────────────
/** A kanji reviewed in the just-finished session, with the signals the trigger needs. */
export interface ReviewedCard {
  kanjiId: number
  kanji: string
  /** Graded Again/Hard, or failed the quiz leg, this session. */
  struggledToday: boolean
  /** Lifetime FSRS lapse count. */
  lapses: number
  /** Whether a co-created hook already exists for this kanji. */
  hasHook: boolean
}

/** Minimum lifetime lapses to count as "chronically lapsing". */
export const CHRONIC_LAPSE_THRESHOLD = 3

/** The single action the post-session Buddy moment should take. */
export type BuddyMomentAction =
  | { kind: 'reinforce'; kanjiId: number }
  | { kind: 'create'; kanjiId: number }
  | { kind: 'none' }
```

- [ ] **Step 2: Write `index.ts` barrel**

```ts
// packages/shared/src/mnemonics/index.ts
export * from './types'
export * from './cadence'
export * from './trigger'
export * from './distractors'
export * from './radical-dictionary'
export * from './assembler'
```

> Note: the barrel references files created in later tasks. That is fine — TS resolves them once they exist; do not run a shared build until Task 6. The per-file vitest runs in Tasks 2–6 don't need the barrel.

- [ ] **Step 3: Add the barrel to the shared root export**

In `packages/shared/src/index.ts`, add after the `./milestones` line:

```ts
export * from './mnemonics'
```

- [ ] **Step 4: Write the contract test**

```ts
// packages/shared/src/mnemonics/types.test.ts
import { describe, it, expect } from 'vitest'
import {
  EFFECTIVENESS_DEFAULT,
  EFFECTIVENESS_ALPHA,
  DEEPEN_MIN_REINFORCEMENTS,
  DEEPEN_SCORE_FLOOR,
  CHRONIC_LAPSE_THRESHOLD,
} from './types'

describe('mnemonics constants', () => {
  it('pin the agreed cadence + trigger thresholds', () => {
    expect(EFFECTIVENESS_DEFAULT).toBe(0.5)
    expect(EFFECTIVENESS_ALPHA).toBe(0.4)
    expect(DEEPEN_MIN_REINFORCEMENTS).toBe(2)
    expect(DEEPEN_SCORE_FLOOR).toBe(0.35)
    expect(CHRONIC_LAPSE_THRESHOLD).toBe(3)
  })
})
```

- [ ] **Step 5: Run the test (expect FAIL until barrel files exist, then this file PASSES on its own)**

Run: `pnpm --filter @kanji-learn/shared exec vitest run src/mnemonics/types.test.ts`
Expected: PASS (this test only imports `./types`, which exists).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/mnemonics/types.ts packages/shared/src/mnemonics/index.ts packages/shared/src/mnemonics/types.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): scaffold mnemonics module + Phase 5 foundation types"
```

---

### Task 2: Cadence math (EMA + deepen gate)

**Files:**
- Create: `packages/shared/src/mnemonics/cadence.ts`
- Test: `packages/shared/src/mnemonics/cadence.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/src/mnemonics/cadence.test.ts
import { describe, it, expect } from 'vitest'
import { updateEffectiveness, shouldDeepen } from './cadence'
import { EFFECTIVENESS_DEFAULT } from './types'

describe('updateEffectiveness (EMA, alpha=0.4)', () => {
  it('moves a fresh 0.5 score down to 0.30 on a miss', () => {
    expect(updateEffectiveness(EFFECTIVENESS_DEFAULT, 0)).toBeCloseTo(0.30, 5)
  })
  it('moves a fresh 0.5 score up to 0.70 on a hit', () => {
    expect(updateEffectiveness(EFFECTIVENESS_DEFAULT, 1)).toBeCloseTo(0.70, 5)
  })
  it('two misses in a row reach 0.18', () => {
    const afterOne = updateEffectiveness(EFFECTIVENESS_DEFAULT, 0)
    expect(updateEffectiveness(afterOne, 0)).toBeCloseTo(0.18, 5)
  })
})

describe('shouldDeepen (>=2 reinforcements AND score < 0.35)', () => {
  it('is false after a single miss (count 1)', () => {
    expect(shouldDeepen(1, 0.30)).toBe(false)
  })
  it('is true after two misses (count 2, score 0.18)', () => {
    expect(shouldDeepen(2, 0.18)).toBe(true)
  })
  it('is false when the score has recovered above the floor', () => {
    expect(shouldDeepen(3, 0.40)).toBe(false)
  })
  it('is false exactly at the floor (strict <)', () => {
    expect(shouldDeepen(2, 0.35)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @kanji-learn/shared exec vitest run src/mnemonics/cadence.test.ts`
Expected: FAIL — "Failed to resolve import './cadence'".

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/mnemonics/cadence.ts
import {
  EFFECTIVENESS_ALPHA,
  DEEPEN_MIN_REINFORCEMENTS,
  DEEPEN_SCORE_FLOOR,
} from './types'

/** Exponential moving average update. outcome = 1 (helped / quiz correct) or 0 (didn't). */
export function updateEffectiveness(score: number, outcome: 0 | 1): number {
  return EFFECTIVENESS_ALPHA * outcome + (1 - EFFECTIVENESS_ALPHA) * score
}

/** True when a struggling hook should be offered a deepen pass (never a discard). */
export function shouldDeepen(reinforcementCount: number, effectivenessScore: number): boolean {
  return reinforcementCount >= DEEPEN_MIN_REINFORCEMENTS && effectivenessScore < DEEPEN_SCORE_FLOOR
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @kanji-learn/shared exec vitest run src/mnemonics/cadence.test.ts`
Expected: PASS (7 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/mnemonics/cadence.ts packages/shared/src/mnemonics/cadence.test.ts
git commit -m "feat(shared): mnemonic cadence math (EMA effectiveness + deepen gate)"
```

---

### Task 3: Trigger selection (hybrid single-worst)

**Files:**
- Create: `packages/shared/src/mnemonics/trigger.ts`
- Test: `packages/shared/src/mnemonics/trigger.test.ts`

Logic (§4.1): reinforce outranks create; one action; among ties pick the highest `lapses`.
- **reinforce** candidates: `hasHook && struggledToday`.
- **create** candidates: `!hasHook && struggledToday && lapses >= CHRONIC_LAPSE_THRESHOLD`, excluding kanji in the 7-day cooldown set.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/src/mnemonics/trigger.test.ts
import { describe, it, expect } from 'vitest'
import { pickBuddyMomentAction } from './trigger'
import type { ReviewedCard } from './types'

const card = (over: Partial<ReviewedCard>): ReviewedCard => ({
  kanjiId: 1, kanji: '一', struggledToday: false, lapses: 0, hasHook: false, ...over,
})

describe('pickBuddyMomentAction', () => {
  it('returns none when nothing struggled', () => {
    expect(pickBuddyMomentAction([card({ struggledToday: false, lapses: 9 })])).toEqual({ kind: 'none' })
  })

  it('reinforces a hooked kanji that struggled today', () => {
    const cards = [card({ kanjiId: 10, struggledToday: true, hasHook: true, lapses: 1 })]
    expect(pickBuddyMomentAction(cards)).toEqual({ kind: 'reinforce', kanjiId: 10 })
  })

  it('reinforce outranks create even when the create candidate lapses more', () => {
    const cards = [
      card({ kanjiId: 10, struggledToday: true, hasHook: true, lapses: 1 }),   // reinforce
      card({ kanjiId: 20, struggledToday: true, hasHook: false, lapses: 8 }),  // create
    ]
    expect(pickBuddyMomentAction(cards)).toEqual({ kind: 'reinforce', kanjiId: 10 })
  })

  it('creates for a hookless chronic kanji that struggled today', () => {
    const cards = [card({ kanjiId: 20, struggledToday: true, hasHook: false, lapses: 4 })]
    expect(pickBuddyMomentAction(cards)).toEqual({ kind: 'create', kanjiId: 20 })
  })

  it('does NOT create when lapses are below the chronic threshold', () => {
    const cards = [card({ kanjiId: 20, struggledToday: true, hasHook: false, lapses: 2 })]
    expect(pickBuddyMomentAction(cards)).toEqual({ kind: 'none' })
  })

  it('picks the single worst (highest lapses) among create candidates', () => {
    const cards = [
      card({ kanjiId: 20, struggledToday: true, hasHook: false, lapses: 4 }),
      card({ kanjiId: 21, struggledToday: true, hasHook: false, lapses: 7 }),
    ]
    expect(pickBuddyMomentAction(cards)).toEqual({ kind: 'create', kanjiId: 21 })
  })

  it('excludes create candidates in the cooldown set', () => {
    const cards = [card({ kanjiId: 21, struggledToday: true, hasHook: false, lapses: 7 })]
    expect(pickBuddyMomentAction(cards, [21])).toEqual({ kind: 'none' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @kanji-learn/shared exec vitest run src/mnemonics/trigger.test.ts`
Expected: FAIL — cannot resolve `./trigger`.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/mnemonics/trigger.ts
import { CHRONIC_LAPSE_THRESHOLD, type BuddyMomentAction, type ReviewedCard } from './types'

const worstByLapses = (cards: ReviewedCard[]): ReviewedCard | undefined =>
  cards.reduce<ReviewedCard | undefined>(
    (best, c) => (best === undefined || c.lapses > best.lapses ? c : best),
    undefined,
  )

/**
 * Picks at most one action for the post-session Buddy moment.
 * Reinforce (a hooked kanji that struggled today) outranks Create
 * (a hookless, chronically-lapsing kanji that struggled today).
 */
export function pickBuddyMomentAction(
  cards: ReviewedCard[],
  cooldownKanjiIds: number[] = [],
): BuddyMomentAction {
  const reinforce = worstByLapses(cards.filter((c) => c.hasHook && c.struggledToday))
  if (reinforce) return { kind: 'reinforce', kanjiId: reinforce.kanjiId }

  const cooldown = new Set(cooldownKanjiIds)
  const create = worstByLapses(
    cards.filter(
      (c) =>
        !c.hasHook &&
        c.struggledToday &&
        c.lapses >= CHRONIC_LAPSE_THRESHOLD &&
        !cooldown.has(c.kanjiId),
    ),
  )
  if (create) return { kind: 'create', kanjiId: create.kanjiId }

  return { kind: 'none' }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @kanji-learn/shared exec vitest run src/mnemonics/trigger.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/mnemonics/trigger.ts packages/shared/src/mnemonics/trigger.test.ts
git commit -m "feat(shared): post-session Buddy-moment trigger selection (hybrid single-worst)"
```

---

### Task 4: Distractor selection (story→kanji quiz)

**Files:**
- Create: `packages/shared/src/mnemonics/distractors.ts`
- Test: `packages/shared/src/mnemonics/distractors.test.ts`

Logic (§8): return `count` kanjiIds (excluding the target). Prefer pool kanji that **share a radical** with the target; fill remaining from **same JLPT level**; then any. Deterministic ordering (stable input order; no RNG, so it is testable).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/src/mnemonics/distractors.test.ts
import { describe, it, expect } from 'vitest'
import { selectDistractors, type DistractorKanji } from './distractors'

const target: DistractorKanji = { kanjiId: 100, radicals: ['扌', '寺'], jlpt: 5 }

const pool: DistractorKanji[] = [
  { kanjiId: 101, radicals: ['扌', '木'], jlpt: 5 }, // shares 扌
  { kanjiId: 102, radicals: ['寺', '日'], jlpt: 4 }, // shares 寺
  { kanjiId: 103, radicals: ['水'],       jlpt: 5 }, // same level, no shared radical
  { kanjiId: 104, radicals: ['火'],       jlpt: 3 }, // neither
  { kanjiId: 100, radicals: ['扌', '寺'], jlpt: 5 }, // the target itself — must be excluded
]

describe('selectDistractors', () => {
  it('never includes the target kanji', () => {
    const ids = selectDistractors(target, pool, 3)
    expect(ids).not.toContain(100)
  })

  it('prefers radical-sharers first', () => {
    const ids = selectDistractors(target, pool, 2)
    expect(ids).toEqual([101, 102])
  })

  it('fills from same-JLPT once sharers run out', () => {
    const ids = selectDistractors(target, pool, 3)
    expect(ids).toEqual([101, 102, 103])
  })

  it('falls back to anything to reach count', () => {
    const ids = selectDistractors(target, pool, 4)
    expect(ids).toEqual([101, 102, 103, 104])
  })

  it('returns fewer than count if the pool is too small, without duplicates', () => {
    const ids = selectDistractors(target, [pool[0]], 3)
    expect(ids).toEqual([101])
    expect(new Set(ids).size).toBe(ids.length)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @kanji-learn/shared exec vitest run src/mnemonics/distractors.test.ts`
Expected: FAIL — cannot resolve `./distractors`.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/mnemonics/distractors.ts

export interface DistractorKanji {
  kanjiId: number
  radicals: string[]
  jlpt: number
}

/**
 * Picks up to `count` distractor kanjiIds for a story→kanji quiz.
 * Priority: shares a radical with the target → same JLPT level → anything.
 * Deterministic: preserves pool order within each tier; no RNG.
 */
export function selectDistractors(
  target: DistractorKanji,
  pool: DistractorKanji[],
  count: number,
): number[] {
  const targetRadicals = new Set(target.radicals)
  const candidates = pool.filter((k) => k.kanjiId !== target.kanjiId)

  const sharesRadical = (k: DistractorKanji) => k.radicals.some((r) => targetRadicals.has(r))

  const tier1 = candidates.filter(sharesRadical)
  const tier2 = candidates.filter((k) => !sharesRadical(k) && k.jlpt === target.jlpt)
  const tier3 = candidates.filter((k) => !sharesRadical(k) && k.jlpt !== target.jlpt)

  const ordered: number[] = []
  for (const k of [...tier1, ...tier2, ...tier3]) {
    if (ordered.length >= count) break
    if (!ordered.includes(k.kanjiId)) ordered.push(k.kanjiId)
  }
  return ordered
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @kanji-learn/shared exec vitest run src/mnemonics/distractors.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/mnemonics/distractors.ts packages/shared/src/mnemonics/distractors.test.ts
git commit -m "feat(shared): story→kanji quiz distractor selection"
```

---

### Task 5: Radical dictionary (seed set + lookup + coverage gate)

**Files:**
- Create: `packages/shared/src/mnemonics/radical-dictionary.ts`
- Test: `packages/shared/src/mnemonics/radical-dictionary.test.ts`
- Reference (do not import at runtime, copy names from): `apps/mobile/src/constants/radicals.ts`

**Note on the data asset:** the full Kangxi-214 + variants enrichment is mechanical data entry, staged N5→N3 first per the spec. This task ships a **complete, verified seed of the highest-frequency radicals** (enough for the assembler tests and early N5 kanji) plus the **coverage integrity test** that gates further entries. Extending to the full staged set is bounded follow-on data entry guarded by this same test — not a code change.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/src/mnemonics/radical-dictionary.test.ts
import { describe, it, expect } from 'vitest'
import { RADICAL_DICTIONARY, lookupComponents } from './radical-dictionary'

describe('RADICAL_DICTIONARY integrity', () => {
  it('every entry has a non-empty name, meaning, and imageKeyword', () => {
    for (const [char, e] of Object.entries(RADICAL_DICTIONARY)) {
      expect(e.char, `char field matches key for ${char}`).toBe(char)
      expect(e.name.length, `name for ${char}`).toBeGreaterThan(0)
      expect(e.meaning.length, `meaning for ${char}`).toBeGreaterThan(0)
      expect(e.imageKeyword.length, `imageKeyword for ${char}`).toBeGreaterThan(0)
    }
  })

  it('covers a baseline set of high-frequency radicals', () => {
    // These appear across early N5 kanji and are exercised by the assembler tests.
    const required = ['人', '亻', '扌', '寺', '水', '氵', '木', '火', '日', '口', '心', '忄']
    for (const r of required) {
      expect(RADICAL_DICTIONARY[r], `missing required radical ${r}`).toBeDefined()
    }
  })
})

describe('lookupComponents', () => {
  it('maps known chars to entries and drops unknown ones', () => {
    const out = lookupComponents(['扌', '寺', '〇unknown'])
    expect(out.map((e) => e.char)).toEqual(['扌', '寺'])
  })

  it('returns [] when nothing maps (assembler must degrade gracefully)', () => {
    expect(lookupComponents(['〇zzz'])).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @kanji-learn/shared exec vitest run src/mnemonics/radical-dictionary.test.ts`
Expected: FAIL — cannot resolve `./radical-dictionary`.

- [ ] **Step 3: Implement the seed dictionary + lookup**

```ts
// packages/shared/src/mnemonics/radical-dictionary.ts
import type { RadicalEntry } from './types'

/**
 * radical char → { name, meaning, imageKeyword }.
 * Japanese `name` values mirror apps/mobile/src/constants/radicals.ts (部首名);
 * `meaning` + `imageKeyword` are added for teaching + mnemonic assembly.
 * Seeded with high-frequency radicals (N5-first); extend toward Kangxi-214,
 * guarded by radical-dictionary.test.ts coverage assertions.
 */
export const RADICAL_DICTIONARY: Record<string, RadicalEntry> = {
  '人': { char: '人', name: 'hito',       meaning: 'person',  imageKeyword: 'a person walking by' },
  '亻': { char: '亻', name: 'ninben',     meaning: 'person',  imageKeyword: 'a person standing at your side' },
  '扌': { char: '扌', name: 'tehen',      meaning: 'hand',    imageKeyword: 'a hand reaching out, grasping' },
  '手': { char: '手', name: 'te',         meaning: 'hand',    imageKeyword: 'an open hand held up' },
  '寺': { char: '寺', name: 'tera',       meaning: 'temple',  imageKeyword: 'a small temple tucked nearby' },
  '水': { char: '水', name: 'mizu',       meaning: 'water',   imageKeyword: 'water flowing past' },
  '氵': { char: '氵', name: 'sanzui',     meaning: 'water',   imageKeyword: 'three droplets of water on the left' },
  '木': { char: '木', name: 'ki',         meaning: 'tree',    imageKeyword: 'a tree rooted in place' },
  '火': { char: '火', name: 'hi',         meaning: 'fire',    imageKeyword: 'a small fire crackling' },
  '日': { char: '日', name: 'nichi',      meaning: 'sun',     imageKeyword: 'the sun overhead' },
  '月': { char: '月', name: 'tsuki',      meaning: 'moon',    imageKeyword: 'a pale moon' },
  '口': { char: '口', name: 'kuchi',      meaning: 'mouth',   imageKeyword: 'an open mouth' },
  '心': { char: '心', name: 'kokoro',     meaning: 'heart',   imageKeyword: 'a beating heart' },
  '忄': { char: '忄', name: 'risshinben', meaning: 'heart',   imageKeyword: 'a heart standing on the left' },
  '土': { char: '土', name: 'tsuchi',     meaning: 'earth',   imageKeyword: 'a mound of earth' },
  '女': { char: '女', name: 'onna',       meaning: 'woman',   imageKeyword: 'a woman seated' },
  '子': { char: '子', name: 'ko',         meaning: 'child',   imageKeyword: 'a small child' },
  '目': { char: '目', name: 'me',         meaning: 'eye',     imageKeyword: 'a watchful eye' },
  '糸': { char: '糸', name: 'ito',        meaning: 'thread',  imageKeyword: 'a length of thread' },
  '言': { char: '言', name: 'gonben',     meaning: 'speech',  imageKeyword: 'words spoken aloud' },
}

/** Resolves component chars to dictionary entries, dropping any that are not mapped. */
export function lookupComponents(chars: string[]): RadicalEntry[] {
  return chars.map((c) => RADICAL_DICTIONARY[c]).filter((e): e is RadicalEntry => e !== undefined)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @kanji-learn/shared exec vitest run src/mnemonics/radical-dictionary.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/mnemonics/radical-dictionary.ts packages/shared/src/mnemonics/radical-dictionary.test.ts
git commit -m "feat(shared): radical dictionary seed (meaning + imageKeyword) with coverage gate"
```

---

### Task 6: Template assembler

**Files:**
- Create: `packages/shared/src/mnemonics/assembler.ts`
- Test: `packages/shared/src/mnemonics/assembler.test.ts`

Logic (§7.2): deterministic. Pick one of N frames by a hash of the kanji char so different kanji get different shapes. The output MUST contain the location, the anchor, the reading, and every mapped component's meaning. Degrade gracefully when `components` is empty.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/src/mnemonics/assembler.test.ts
import { describe, it, expect } from 'vitest'
import { assembleTemplate } from './assembler'
import { lookupComponents } from './radical-dictionary'
import type { AssemblerSlots } from './types'

const mochi: AssemblerSlots = {
  kanji: '持',
  kanjiMeaning: 'hold',
  reading: 'もつ',
  components: lookupComponents(['扌', '寺']),
  locationName: 'Beppu Station',
  anchor: 'a yellow vending machine',
}

describe('assembleTemplate', () => {
  it('includes the location, anchor, reading, and every component meaning', () => {
    const story = assembleTemplate(mochi)
    expect(story).toContain('Beppu Station')
    expect(story).toContain('a yellow vending machine')
    expect(story).toContain('もつ')
    expect(story).toContain('hand')   // 扌
    expect(story).toContain('temple') // 寺
    expect(story).toContain('持')
  })

  it('is deterministic for the same slots', () => {
    expect(assembleTemplate(mochi)).toBe(assembleTemplate(mochi))
  })

  it('uses different frames for different kanji (no mad-libs sameness)', () => {
    const other: AssemblerSlots = { ...mochi, kanji: '林', kanjiMeaning: 'woods', reading: 'はやし' }
    // Frame choice is a function of the kanji char; these two chars must select different frames.
    const a = assembleTemplate(mochi).replace(/持/g, 'X').replace(/もつ/g, 'Y').replace('hold', 'Z')
    const b = assembleTemplate(other).replace(/林/g, 'X').replace(/はやし/g, 'Y').replace('woods', 'Z')
    expect(a).not.toBe(b)
  })

  it('degrades gracefully when no components map', () => {
    const story = assembleTemplate({ ...mochi, components: [] })
    expect(story).toContain('Beppu Station')
    expect(story).toContain('もつ')
    expect(story).toContain('持')
    expect(story.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @kanji-learn/shared exec vitest run src/mnemonics/assembler.test.ts`
Expected: FAIL — cannot resolve `./assembler`.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/mnemonics/assembler.ts
import type { AssemblerSlots, RadicalEntry } from './types'

/** Sum of UTF-16 code units — a tiny stable hash for deterministic frame choice. */
function charHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % 100000
  return h
}

function componentClause(components: RadicalEntry[]): string {
  if (components.length === 0) return 'Picture it right there in front of you'
  const parts = components.map((c) => `the ${c.meaning} (${c.char}), ${c.imageKeyword}`)
  if (parts.length === 1) return `You see ${parts[0]}`
  return `You see ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function readingClause(slots: AssemblerSlots): string {
  const base = `Say it aloud: ${slots.reading}.`
  return slots.readingPlay ? `${base} ${slots.readingPlay}` : base
}

function detailClause(slots: AssemblerSlots): string {
  return slots.personalDetail ? ` You notice ${slots.personalDetail}.` : ''
}

type Frame = (s: AssemblerSlots) => string

const FRAMES: Frame[] = [
  (s) =>
    `At ${s.locationName}, ${s.anchor} catches your eye. ${componentClause(s.components)} — ` +
    `and that is how you ${s.kanjiMeaning} (${s.kanji}) it.${detailClause(s)} ${readingClause(s)}`,
  (s) =>
    `You are standing at ${s.locationName}. ${capitalize(s.anchor)} is right there. ` +
    `${componentClause(s.components)}. This is ${s.kanji} — to ${s.kanjiMeaning}.${detailClause(s)} ${readingClause(s)}`,
  (s) =>
    `${capitalize(s.anchor)} at ${s.locationName} pulls you in. ${componentClause(s.components)}, ` +
    `locking in ${s.kanji} (${s.kanjiMeaning}).${detailClause(s)} ${readingClause(s)}`,
]

function capitalize(str: string): string {
  return str.length === 0 ? str : str[0].toUpperCase() + str.slice(1)
}

/** Deterministic, model-free assembly of a personal mnemonic from structured slots. */
export function assembleTemplate(slots: AssemblerSlots): string {
  const frame = FRAMES[charHash(slots.kanji) % FRAMES.length]
  return frame(slots)
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @kanji-learn/shared exec vitest run src/mnemonics/assembler.test.ts`
Expected: PASS (4 tests).

> If the "different frames" test fails because 持 and 林 happen to hash to the same frame index, change the test's second kanji to one that selects a different frame (e.g. add a third distinct kanji), or add a fourth frame — do not weaken the assertion.

- [ ] **Step 5: Run the whole shared suite + typecheck the barrel**

Run: `pnpm --filter @kanji-learn/shared test`
Expected: PASS — all mnemonics tests plus the pre-existing `srs`/`milestones` tests.

Run: `pnpm --filter @kanji-learn/shared exec tsc --noEmit`
Expected: 0 errors (the `index.ts` barrel now resolves every mnemonics file).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/mnemonics/assembler.ts packages/shared/src/mnemonics/assembler.test.ts
git commit -m "feat(shared): deterministic template mnemonic assembler"
```

---

### Task 7: Refactor mobile `RADICAL_NAMES` to derive from the shared dictionary

Keep one source of truth: the mobile display map (`RADICAL_NAMES`) should read its names from `RADICAL_DICTIONARY` where present, keeping its own extra entries for radicals not yet in the shared dictionary.

**Files:**
- Modify: `apps/mobile/src/constants/radicals.ts`
- Verify (no change): `apps/mobile/src/components/study/KanjiCard.tsx`, `apps/mobile/app/kanji/[id].tsx` (consumers of `RADICAL_NAMES`)

- [ ] **Step 1: Read the current file to preserve every existing key**

Run: `sed -n '1,410p' apps/mobile/src/constants/radicals.ts`
Confirm the export shape is `export const RADICAL_NAMES: Record<string, string> = { … }`.

- [ ] **Step 2: Prepend a merge from the shared dictionary**

At the top of `apps/mobile/src/constants/radicals.ts`, after the file's doc comment, add:

```ts
import { RADICAL_DICTIONARY } from '@kanji-learn/shared'

// Names sourced from the shared Phase 5 radical dictionary (single source of truth).
// Local entries below extend it for radicals not yet enriched in shared.
const SHARED_NAMES: Record<string, string> = Object.fromEntries(
  Object.values(RADICAL_DICTIONARY).map((e) => [e.char, e.name]),
)
```

Then change the export so the local literal overlays onto the shared names (local literal wins only for keys shared doesn't define — keep shared authoritative where both exist):

```ts
const LOCAL_NAMES: Record<string, string> = {
  // ← the entire existing literal that was previously assigned to RADICAL_NAMES
}

export const RADICAL_NAMES: Record<string, string> = { ...LOCAL_NAMES, ...SHARED_NAMES }
```

> Mechanical edit: rename the existing `export const RADICAL_NAMES = {` literal to `const LOCAL_NAMES = {`, then add the `export const RADICAL_NAMES = { ...LOCAL_NAMES, ...SHARED_NAMES }` line after it. Do not delete any existing entries.

- [ ] **Step 3: Typecheck mobile**

Run: `pnpm --filter @kanji-learn/mobile typecheck`
Expected: 0 errors. (Per the B139 process lesson, this typecheck gate is mandatory before any later EAS build.)

- [ ] **Step 4: Sanity-check a consumer still resolves names**

Run: `grep -n "RADICAL_NAMES" apps/mobile/src/components/study/KanjiCard.tsx apps/mobile/app/kanji/[id].tsx`
Expected: the same usages as before; no signature change (still `Record<string, string>`).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/constants/radicals.ts
git commit -m "refactor(mobile): derive RADICAL_NAMES from the shared radical dictionary"
```

---

## Self-Review

**Spec coverage (this plan's slice):**
- §6 cadence (EMA + deepen gate) → Task 2 ✓
- §4.1 trigger (hybrid single-worst, reinforce > create, cooldown) → Task 3 ✓
- §8 distractors (radical-share → same-JLPT → any) → Task 4 ✓
- §7.1 radical dictionary (meaning + imageKeyword, coverage gate, graceful lookup) → Task 5 ✓
- §7.2 template assembler (all slots present, frame variety, degrade on no components) → Task 6 ✓
- Single source of truth for radical names → Task 7 ✓
- *Out of scope here (Plans 2–4):* `cocreation_context` schema, cloud-assembly endpoint, the destructive cleanup, the mobile flow/state machine, on-device native module, the quiz UI + session insertion, surfacing, opt-out/offline. Tracked in the plan sequence.

**Placeholder scan:** none — every step has runnable code/commands. The radical dictionary's "extend to full Kangxi-214" is explicitly a bounded, test-gated data-entry follow-on, not an unscoped TODO; the seed shipped here is complete and tested.

**Type consistency:** `RadicalEntry`, `AssemblerSlots`, `ReviewedCard`, `BuddyMomentAction`, and the cadence/trigger constants are all defined once in `types.ts` (Task 1) and imported unchanged by Tasks 2–6. `DistractorKanji` is defined in `distractors.ts` (Task 4) and re-exported via the barrel. Function names used across tasks — `updateEffectiveness`, `shouldDeepen`, `pickBuddyMomentAction`, `selectDistractors`, `lookupComponents`, `assembleTemplate`, `RADICAL_DICTIONARY` — match their definitions and the Task 1 barrel.

---

## Plan sequence (for continuity)

This is **Plan 1 of 4** for Phase 5:
1. **Foundation (this plan)** — shared pure logic + dictionary.
2. **Data & API** — extend `cocreation_context` `$type`; keep/adapt `generateHaiku`/`generateSonnet` as the cloud-assembly endpoint from co-creation slots; thin persistence (`saveUserMnemonic` et al. retained); retire the 30-day refresh nudge; the clone-rehearsed destructive cleanup of old `mnemonics` rows.
3. **Mobile co-creation flow** — the `CoCreationSession` state machine (consent → teach → location → elicit → assemble → commit), reverse-geocoding reuse, the three-tier assembly cascade (cloud-first this phase), and the Apple Foundation Models native module (verify community wrapper first).
4. **Quiz, reinforce/deepen & surfacing** — `mnemonic_recall` quiz item + session insertion + immediate quick-check; end-of-session reinforce/deepen UI; `MnemonicCard`/kanji-detail/flashcard surfaces; "Mnemonic coaching" toggle + 7-day cooldown + offline save/sync.
