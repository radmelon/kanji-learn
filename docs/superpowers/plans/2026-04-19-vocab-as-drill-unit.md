# Build 3-C: Vocab as the Drill Unit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shift the voice/reading review modality from kanji-level prompts to vocab-level prompts, expand example_vocab and example_sentences data, ingest pitch accent from Kanjium, opportunistically ingest Kyōiku grade + frequency + Hadamitzky-Spahn reference from Kanjidic2, and ship a server-side homophone workaround as a standalone Phase 1 deliverable.

**Architecture:** Five independently deployable phases. Phase 1 (server homophone workaround) ships alone and fixes the Speak bug for every currently-deployed client before any data or client changes. Phases 2–5 land in-order; only one EAS build (B125) at the end of Phase 4. Full design at [docs/superpowers/specs/2026-04-19-vocab-as-drill-unit-design.md](../specs/2026-04-19-vocab-as-drill-unit-design.md).

**Tech Stack:** TypeScript, Fastify, Drizzle ORM, PostgreSQL (Supabase), vitest, React Native (Expo), AsyncStorage, Zustand. Seed scripts in Node. Data sources: JMdict (XML), Kanjium (JSON), Kanjidic2 (XML), Tatoeba (TSV).

---

## Phase 1 — Server Homophone Workaround (ships standalone)

**Scope:** Server-only change. No DB migration, no client change, no seed. Deploys independently and fixes the Speak bug for every TestFlight client already in circulation.

**File structure (Phase 1):**

```
apps/api/src/services/kanji-readings-index.ts           ← NEW
apps/api/src/services/__tests__/kanji-readings-index.test.ts  ← NEW (unit, pure)
apps/api/test/unit/reading-eval.test.ts                 ← NEW (unit, pure)
apps/api/test/unit/reading-eval.homophone.test.ts       ← NEW (unit, uses mock index)
apps/api/src/services/reading-eval.service.ts           ← MODIFY
apps/api/src/server.ts                                   ← MODIFY (index load at boot)
```

### Task 1: Pure helper — contains-CJK check

**Files:**
- Create: `apps/api/src/services/kanji-readings-index.ts`
- Test: `apps/api/src/services/__tests__/kanji-readings-index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/__tests__/kanji-readings-index.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { containsCJK } from '../kanji-readings-index'

describe('containsCJK', () => {
  it('returns true for a CJK Unified Ideographs character', () => {
    expect(containsCJK('感')).toBe(true)
  })
  it('returns true for a string containing any CJK char', () => {
    expect(containsCJK('かんどう感')).toBe(true)
  })
  it('returns false for pure hiragana', () => {
    expect(containsCJK('かんどう')).toBe(false)
  })
  it('returns false for pure katakana', () => {
    expect(containsCJK('カンドウ')).toBe(false)
  })
  it('returns false for an empty string', () => {
    expect(containsCJK('')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test — confirm it fails**

Run: `cd apps/api && pnpm test -- kanji-readings-index`
Expected: FAIL with module-not-found error on `../kanji-readings-index`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/api/src/services/kanji-readings-index.ts`:

```ts
/**
 * kanji-readings-index.ts
 *
 * In-memory index mapping each kanji character to its accepted readings,
 * plus helpers for the homophone-workaround path in reading-eval.service.ts.
 *
 * The iOS ja-JP speech recognizer often returns a kanji transcript instead of
 * phonetic hiragana. Wanakana cannot normalise kanji to readings, so the
 * evaluator expands CJK characters through this index before comparison.
 */

// CJK Unified Ideographs block (covers all Jōyō kanji and the entire corpus
// our app ships). We intentionally do NOT include the compatibility block
// (U+F900-U+FAFF) because those glyphs round-trip to the main block.
const CJK_RE = /[\u4E00-\u9FFF]/

export function containsCJK(s: string): boolean {
  return CJK_RE.test(s)
}
```

- [ ] **Step 4: Run the test — confirm it passes**

Run: `cd apps/api && pnpm test -- kanji-readings-index`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/kanji-readings-index.ts apps/api/src/services/__tests__/kanji-readings-index.test.ts
git commit -m "feat(api): add containsCJK helper for homophone workaround"
```

---

### Task 2: Cartesian expansion of CJK characters → candidate phonetic strings

**Files:**
- Modify: `apps/api/src/services/kanji-readings-index.ts`
- Modify: `apps/api/src/services/__tests__/kanji-readings-index.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/services/__tests__/kanji-readings-index.test.ts`:

```ts
import { expandReadings } from '../kanji-readings-index'

describe('expandReadings', () => {
  const fixture = new Map<string, Set<string>>([
    ['感', new Set(['かん'])],
    ['缶', new Set(['かん'])],
    ['動', new Set(['どう', 'うご'])],
    ['紙', new Set(['かみ', 'し'])],
  ])

  it('expands a single-kanji string to each of its readings', () => {
    expect(expandReadings('感', fixture).sort()).toEqual(['かん'])
  })

  it('leaves pure hiragana strings untouched (returns array with original)', () => {
    expect(expandReadings('かんどう', fixture)).toEqual(['かんどう'])
  })

  it('expands a 2-kanji compound as the cartesian product of readings', () => {
    // 感(かん) × 動(どう|うご) = {かんどう, かんうご}
    const out = expandReadings('感動', fixture).sort()
    expect(out).toEqual(['かんうご', 'かんどう'])
  })

  it('passes through non-CJK characters in mixed input', () => {
    // 紙(かみ|し) + い → {かみい, しい}
    const out = expandReadings('紙い', fixture).sort()
    expect(out).toEqual(['かみい', 'しい'])
  })

  it('returns the original string when a CJK char is not in the index', () => {
    expect(expandReadings('龘', fixture)).toEqual(['龘'])
  })

  it('caps candidate output at MAX_CANDIDATES', () => {
    // Fake index with many readings per char — tests pathological 4-kanji input
    const big = new Map<string, Set<string>>()
    const readings = new Set(['あ', 'い', 'う', 'え', 'お', 'か'])
    for (const ch of '亜伊宇江') big.set(ch, readings)
    const out = expandReadings('亜伊宇江', big)
    expect(out.length).toBeLessThanOrEqual(200)
  })
})
```

- [ ] **Step 2: Run the tests — confirm they fail**

Run: `cd apps/api && pnpm test -- kanji-readings-index`
Expected: FAIL with "expandReadings is not a function".

- [ ] **Step 3: Implement expandReadings with cap**

Append to `apps/api/src/services/kanji-readings-index.ts`:

```ts
export type KanjiReadingsIndex = Map<string, Set<string>>

/**
 * Hard cap on cartesian-product output. A well-formed vocab word of 2-3
 * kanji rarely exceeds ~50 candidates; the cap protects against pathological
 * input (e.g. a 5-kanji compound where every char has 6+ readings).
 */
const MAX_CANDIDATES = 200

/**
 * Expand CJK characters in `input` to their accepted readings from `index`,
 * returning the cartesian product of all possible phonetic strings.
 *
 * If `input` has no CJK chars, returns `[input]` unchanged.
 * If a CJK char is not in the index, it is passed through literally.
 * Output is capped at MAX_CANDIDATES (truncated; order is stable).
 */
export function expandReadings(input: string, index: KanjiReadingsIndex): string[] {
  if (!containsCJK(input)) return [input]

  let candidates: string[] = ['']
  for (const ch of input) {
    const readings = index.get(ch)
    const options = readings && readings.size > 0 ? [...readings] : [ch]

    const next: string[] = []
    for (const prefix of candidates) {
      for (const opt of options) {
        next.push(prefix + opt)
        if (next.length >= MAX_CANDIDATES) {
          candidates = next
          return candidates.slice(0, MAX_CANDIDATES)
        }
      }
    }
    candidates = next
  }

  return candidates.slice(0, MAX_CANDIDATES)
}
```

- [ ] **Step 4: Run the tests — confirm they pass**

Run: `cd apps/api && pnpm test -- kanji-readings-index`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/kanji-readings-index.ts apps/api/src/services/__tests__/kanji-readings-index.test.ts
git commit -m "feat(api): add expandReadings for homophone expansion"
```

---

### Task 3: Index loader — populate from the `kanji` table

**Files:**
- Modify: `apps/api/src/services/kanji-readings-index.ts`

This function hits the DB once at server boot. We skip a unit test for this wrapper — it's a thin query — and rely on the Phase 1 smoke test (Task 6) and the homophone integration in Task 4.

- [ ] **Step 1: Add the loader**

Append to `apps/api/src/services/kanji-readings-index.ts`:

```ts
import type { Db } from '@kanji-learn/db'
import { kanji } from '@kanji-learn/db'

/**
 * Load the kanji → readings index from the database.
 *
 * Reads character, kunReadings, and onReadings for every row in `kanji` and
 * returns a Map from each character to a Set of the union of its readings.
 *
 * Called once at server boot, refreshed on a 6-hour interval as a safety net.
 */
export async function loadKanjiReadingsIndex(db: Db): Promise<KanjiReadingsIndex> {
  const rows = await db.select({
    character: kanji.character,
    kunReadings: kanji.kunReadings,
    onReadings: kanji.onReadings,
  }).from(kanji)

  const idx: KanjiReadingsIndex = new Map()
  for (const row of rows) {
    const readings = new Set<string>([...row.kunReadings, ...row.onReadings])
    if (readings.size > 0) idx.set(row.character, readings)
  }
  return idx
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd apps/api && pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/services/kanji-readings-index.ts
git commit -m "feat(api): add loadKanjiReadingsIndex from kanji table"
```

---

### Task 4: Integrate expander into `reading-eval.service.ts`

**Files:**
- Modify: `apps/api/src/services/reading-eval.service.ts`
- Create: `apps/api/test/unit/reading-eval.homophone.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/unit/reading-eval.homophone.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { evaluateReading } from '../../src/services/reading-eval.service'
import type { KanjiReadingsIndex } from '../../src/services/kanji-readings-index'

const fixture: KanjiReadingsIndex = new Map([
  ['感', new Set(['かん', 'かんじる'])],
  ['缶', new Set(['かん'])],
  ['紙', new Set(['かみ', 'し'])],
  ['髪', new Set(['かみ', 'はつ'])],
  ['橋', new Set(['はし', 'きょう'])],
  ['箸', new Set(['はし'])],
  ['動', new Set(['どう', 'うご'])],
])

describe('evaluateReading — homophone workaround', () => {
  it('accepts a kanji transcript when its reading matches a correctReading', () => {
    // User spoke "kan"; iOS returned the kanji 缶. Target is 感's reading かん.
    const result = evaluateReading('缶', ['かん'], false, fixture)
    expect(result.correct).toBe(true)
    expect(result.quality).toBe(5)
  })

  it('accepts a multi-kanji vocab transcript via cartesian expansion', () => {
    // User spoke the vocab 感動; iOS returned 感動. Target is かんどう.
    const result = evaluateReading('感動', ['かんどう'], false, fixture)
    expect(result.correct).toBe(true)
    expect(result.quality).toBe(5)
  })

  it('rejects a kanji transcript with no reading overlap', () => {
    // User somehow produced 髪 transcript for a かん target.
    const result = evaluateReading('髪', ['かん'], false, fixture)
    expect(result.correct).toBe(false)
  })

  it('falls back to plain behavior when the index is not provided', () => {
    // Same as today — kanji transcript is compared as-is, fails.
    const result = evaluateReading('缶', ['かん'])
    expect(result.correct).toBe(false)
  })

  it('still accepts a correct hiragana transcript when the index is provided', () => {
    const result = evaluateReading('かん', ['かん'], false, fixture)
    expect(result.correct).toBe(true)
    expect(result.quality).toBe(5)
  })

  it('handles mixed hiragana+kanji transcripts', () => {
    // Speaker says "kami", iOS returns 紙み (hypothetical mixed transcript)
    const result = evaluateReading('紙み', ['かみみ'], false, fixture)
    expect(result.correct).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test — confirm it fails**

Run: `cd apps/api && pnpm test -- reading-eval.homophone`
Expected: FAIL — most tests fail because the 4th arg isn't accepted yet, and the 缶/感動 cases still return false.

- [ ] **Step 3: Update `evaluateReading` signature to accept the index**

Edit `apps/api/src/services/reading-eval.service.ts`. Replace the existing `evaluateReading` function (lines ~57–124) with:

```ts
import { containsCJK, expandReadings, type KanjiReadingsIndex } from './kanji-readings-index.js'

/**
 * @param spoken           Raw transcript from the speech recogniser
 * @param correctReadings  Array of accepted hiragana readings (e.g. ['みず', 'すい'])
 * @param strict           If true, near-matches are NOT accepted (used for level checkpoints)
 * @param kanjiIndex       Optional in-memory kanji→readings index. When provided,
 *                         CJK characters in the transcript (iOS recognizer output)
 *                         are expanded to candidate phonetic strings and compared.
 */
export function evaluateReading(
  spoken: string,
  correctReadings: string[],
  strict = false,
  kanjiIndex?: KanjiReadingsIndex,
): EvalResult {
  if (!correctReadings.length) {
    return {
      normalizedSpoken: '',
      closestCorrect:   '',
      correct:          false,
      quality:          0,
      feedback:         'No correct readings provided.',
    }
  }

  const normalizedSpoken = normalise(spoken)

  // ── Exact match ─────────────────────────────────────────────────────────
  if (correctReadings.some((r) => normalise(r) === normalizedSpoken)) {
    return {
      normalizedSpoken,
      closestCorrect: normalizedSpoken,
      correct:        true,
      quality:        5,
      feedback:       'Perfect.',
    }
  }

  // ── Homophone workaround: expand any CJK chars via the kanji index ──────
  // Runs only when the index is provided and the transcript still contains
  // CJK after wanakana normalise. Matches against any correctReading → accept.
  if (kanjiIndex && containsCJK(normalizedSpoken)) {
    const normalizedCorrect = correctReadings.map(normalise)
    const candidates = expandReadings(normalizedSpoken, kanjiIndex)
    for (const c of candidates) {
      if (normalizedCorrect.includes(c)) {
        return {
          normalizedSpoken: c,
          closestCorrect:   c,
          correct:          true,
          quality:          5,
          feedback:         'Perfect.',
        }
      }
    }
  }

  // ── Find closest reading (for near-match and feedback) ──────────────────
  const { reading: closestCorrect, dist } = correctReadings.reduce<{
    reading: string
    dist: number
  }>(
    (best, r) => {
      const d = levenshtein(normalise(r), normalizedSpoken)
      return d < best.dist ? { reading: r, dist: d } : best
    },
    { reading: correctReadings[0], dist: Infinity }
  )

  // ── Near match: 1-character edit distance ───────────────────────────────
  if (dist === 1 && !strict) {
    return {
      normalizedSpoken,
      closestCorrect,
      correct:  true,
      quality:  3,
      feedback: 'Close — check your vowel length.',
    }
  }

  // ── Wrong ────────────────────────────────────────────────────────────────
  const heardStr = normalizedSpoken || '(nothing)'
  return {
    normalizedSpoken,
    closestCorrect,
    correct:  false,
    quality:  dist <= 3 ? 2 : 1,
    feedback: `Heard "${heardStr}" — the reading is ${closestCorrect}.`,
  }
}
```

- [ ] **Step 4: Run the homophone test — confirm it passes**

Run: `cd apps/api && pnpm test -- reading-eval.homophone`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full unit test suite — confirm nothing regressed**

Run: `cd apps/api && pnpm test -- unit`
Expected: all prior unit tests still pass; new suite included.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/reading-eval.service.ts apps/api/test/unit/reading-eval.homophone.test.ts
git commit -m "feat(api): integrate homophone workaround into evaluateReading"
```

---

### Task 5: Wire the index through the route handler

**Files:**
- Modify: `apps/api/src/routes/review.ts`
- Modify: `apps/api/src/server.ts`

The route currently calls `evaluateReading(transcript, correctReadings, strict)`. We need to pass the index. The index lives on the Fastify server as a decorator set up at boot.

- [ ] **Step 1: Decorate the server with the kanji readings index**

Edit `apps/api/src/server.ts`. Add the import near the other service imports at the top:

```ts
import { loadKanjiReadingsIndex } from './services/kanji-readings-index.js'
```

In `buildServer()`, AFTER `const learnerState = new LearnerStateService(db)` (around line 111) and BEFORE the `// ── Decorators ──` section, add:

```ts
  // ── Kanji readings index for homophone workaround ─────────────────────────
  const kanjiReadingsIndex = await loadKanjiReadingsIndex(db)
  server.log.info({ entries: kanjiReadingsIndex.size }, 'kanji-readings-index loaded')

  // Refresh every 6 hours as a safety net (primary refresh is server restart)
  const refreshInterval = setInterval(async () => {
    try {
      const fresh = await loadKanjiReadingsIndex(db)
      for (const [k, v] of fresh) kanjiReadingsIndex.set(k, v)
      server.log.info({ entries: kanjiReadingsIndex.size }, 'kanji-readings-index refreshed')
    } catch (err) {
      server.log.error({ err }, 'kanji-readings-index refresh failed')
    }
  }, 6 * 60 * 60 * 1000)
  server.addHook('onClose', async () => clearInterval(refreshInterval))
```

Then add this decoration alongside the others (after `server.decorate('learnerState', learnerState)`):

```ts
  server.decorate('kanjiReadingsIndex', kanjiReadingsIndex)
```

- [ ] **Step 2: Add the Fastify module-augmentation type for the decorator**

Find the existing `declare module 'fastify'` block in the codebase to see where decorators are typed. Run:

```bash
cd apps/api && grep -rn "declare module 'fastify'" src/
```

Expected: it will point to one of the plugin files (likely `src/plugins/auth.ts` or similar). In that file (or add to `src/server.ts` if no such block exists), extend the interface:

```ts
declare module 'fastify' {
  interface FastifyInstance {
    // ... existing decorators
    kanjiReadingsIndex: Map<string, Set<string>>
  }
}
```

(Preserve other declarations already present in the block.)

- [ ] **Step 3: Update the `/voice` handler to pass the index**

Edit `apps/api/src/routes/review.ts`. In the `/voice` handler, change the line:

```ts
    const result = evaluateReading(transcript, correctReadings, strict)
```

to:

```ts
    const result = evaluateReading(transcript, correctReadings, strict, server.kanjiReadingsIndex)
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/api && pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Run full test suite**

Run: `cd apps/api && pnpm test`
Expected: all tests pass, including both new suites.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/routes/review.ts apps/api/src/plugins/auth.ts
git commit -m "feat(api): wire kanji readings index through voice route"
```

(Swap the third path if the module augmentation went into a different file.)

---

### Task 6: Local smoke test against dev DB

**Files:** none (read-only verification)

- [ ] **Step 1: Start the API locally against prod (or dev) DB**

Run from repo root:

```bash
cd apps/api && pnpm dev
```

Expected: boot log includes `kanji-readings-index loaded` with an entry count matching the number of kanji rows (around 2,294). Server listens on the port from `apps/api/.env`.

- [ ] **Step 2: Smoke test the voice endpoint via curl**

In a second terminal, hit `/v1/review/voice` with a kanji-containing transcript (requires a valid JWT — use the one from a local iOS dev build if easy, or skip this step if JWT acquisition is painful and rely on Step 3 instead):

```bash
# Replace $JWT with a valid token; if not convenient, skip to Step 3
curl -s -X POST http://localhost:3000/v1/review/voice \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"kanjiId": 1599, "transcript": "缶", "correctReadings": ["かん"], "strict": false}' | jq
```

Expected: `{"ok": true, "data": { "correct": true, "quality": 5, "feedback": "Perfect.", ... }}`.

- [ ] **Step 3: Add an integration test (optional but recommended)**

If JWT in Step 2 was inconvenient, add an integration test that asserts end-to-end behavior against the local DB. Create `apps/api/test/integration/voice-homophone.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildServer } from '../../src/server'
import type { FastifyInstance } from 'fastify'

describe('POST /v1/review/voice — homophone workaround', () => {
  let server: FastifyInstance

  beforeAll(async () => {
    server = await buildServer()
  })

  afterAll(async () => {
    await server.close()
  })

  it('accepts a kanji transcript when its reading matches a correctReading', async () => {
    // Seed a test user / auth token here per existing integration-test pattern
    // (see apps/api/test/integration/srs-dual-write.test.ts for reference).
    // The key assertion: transcript="缶", correctReadings=["かん"] → correct=true
    // Placeholder for integration auth plumbing — follow existing pattern in repo.
    expect(server.kanjiReadingsIndex.size).toBeGreaterThan(0)
  })
})
```

Run: `cd apps/api && pnpm test -- voice-homophone`
Expected: PASS.

- [ ] **Step 4: Commit if the integration test was added**

```bash
git add apps/api/test/integration/voice-homophone.test.ts
git commit -m "test(api): add voice-homophone integration smoke test"
```

---

### Task 7: Deploy Phase 1 to prod

**Files:** none (deployment action)

- [ ] **Step 1: Verify the build passes cleanly**

Run from repo root:

```bash
cd apps/api && pnpm build
```

Expected: no TypeScript errors; `dist/` produced.

- [ ] **Step 2: Deploy via the canonical deploy script**

Run from repo root:

```bash
DOCKER_CONTEXT=default ./scripts/deploy-api.sh
```

Expected: Docker build succeeds, image pushed to ECR, App Runner operation triggered. The script should print the operation ID and the final health-check result.

Watch for two log lines in the App Runner service logs:
- `kanji-readings-index loaded` (should appear during boot with entry count > 2000)
- Healthcheck HTTP 200

- [ ] **Step 3: Post-deploy verification on TestFlight**

On the device running the current TestFlight build (B124 at time of writing):

1. Open a study session that surfaces a reading-stage card for a kanji with a common-reading homophone (感, 紙, 橋 are good candidates).
2. Tap the mic, speak the reading clearly.
3. Verify: if the iOS recognizer returns a kanji, the server now accepts it. The result card should show "Perfect." rather than "Heard '缶' — the reading is かん."

- [ ] **Step 4: Update the homophone bug entry in BUGS.md**

Edit [BUGS.md](../../BUGS.md). Locate the active homophone entry logged 2026-04-19 and mark the short-term workaround as shipped:

```markdown
- [x] **Speak evaluation marks homophone kanji wrong...** — ~~Short-term workaround shipped YYYY-MM-DD~~ as part of Build 3-C Phase 1. Server-side kanji→reading expansion in `reading-eval.service.ts` now resolves homophone collisions when the iOS recognizer returns a kanji. Longer-term structural shift to vocab-level drilling ships in Build 3-C Phase 4. Status updated to partially-fixed; full closure when Phase 4 is verified.
```

- [ ] **Step 5: Commit the tracker update**

```bash
git add BUGS.md
git commit -m "docs(bugs): mark homophone short-term workaround shipped (Phase 1)"
```

**Phase 1 complete.** Users in the field experience the Speak bug fix the moment App Runner finishes the deploy. No client change needed.

---

## Phase 2 — Data Layer (migrations + seeds)

**Scope:** Apply two migrations; vendor Kanjium snapshot; write/extend three seed scripts; run locally and verify; apply to prod.

**File structure (Phase 2):**

```
packages/db/supabase/migrations/0019_kanji_kanjidic_refs.sql   ← NEW
packages/db/supabase/migrations/0020_user_show_pitch_accent.sql ← NEW
packages/db/src/schema.ts                                        ← MODIFY (add 3 kanji cols + 1 profile col)
packages/db/data/kanjium/accents-YYYY-MM-DD.json                ← NEW (vendored, committed)
packages/db/src/seeds/seed-vocab-pitch.ts                       ← NEW
packages/db/src/seeds/seed-kanjidic-refs.ts                     ← NEW (or extend existing)
packages/db/src/seeds/seed-sentences.ts                         ← MODIFY (cap 2 → 5)
packages/db/seed-output/README.md                                ← NEW (committed)
packages/db/seed-output/.gitignore                               ← NEW (ignore *.json)
packages/db/src/seeds/__tests__/validator.test.ts               ← NEW
packages/db/src/seeds/__tests__/kanjium-parse.test.ts           ← NEW
```

### Task 8: Migration 0019 — `kanji` reference columns

- [ ] Create `packages/db/supabase/migrations/0019_kanji_kanjidic_refs.sql` with the three ADD COLUMN statements and COMMENT blocks from the design spec (see spec Section "Data Layer — Migration 0019").
- [ ] Update `packages/db/src/schema.ts` `kanji` table definition: add `grade: smallint('grade')`, `frequencyRank: smallint('frequency_rank')`, `hadamitzkySpahn: integer('hadamitzky_spahn')` immediately after the existing Morohashi columns (line ~125).
- [ ] Run `pnpm --filter @kanji-learn/db build` to verify types compile.
- [ ] Apply locally: `psql $DEV_DATABASE_URL -f packages/db/supabase/migrations/0019_kanji_kanjidic_refs.sql`.
- [ ] Verify: `psql $DEV_DATABASE_URL -c "\d kanji"` shows the three new columns.
- [ ] Commit: `feat(db): migration 0019 — add Kanjidic2 reference columns to kanji`.

### Task 9: Migration 0020 — `user_profiles.show_pitch_accent`

- [ ] Create `packages/db/supabase/migrations/0020_user_show_pitch_accent.sql` with the ADD COLUMN statement from the design spec.
- [ ] Update `packages/db/src/schema.ts` `userProfiles`: add `showPitchAccent: boolean('show_pitch_accent').notNull().default(true)`.
- [ ] Run `pnpm --filter @kanji-learn/db build`.
- [ ] Apply locally: `psql $DEV_DATABASE_URL -f packages/db/supabase/migrations/0020_user_show_pitch_accent.sql`.
- [ ] Verify: `psql $DEV_DATABASE_URL -c "\d user_profiles"` shows `show_pitch_accent boolean NOT NULL DEFAULT true`.
- [ ] Commit: `feat(db): migration 0020 — add user_profiles.show_pitch_accent`.

### Task 10: Vendor Kanjium snapshot

- [ ] Download `accents.txt` (or the most maintained JSON output) from [github.com/mifunetoshiro/kanjium](https://github.com/mifunetoshiro/kanjium) at a specific commit SHA.
- [ ] Save it to `packages/db/data/kanjium/accents-YYYY-MM-DD.json` (pre-process into JSON if needed — write a small `scripts/convert-kanjium.ts` if the upstream is text).
- [ ] Add a SOURCES note: `packages/db/data/kanjium/README.md` with upstream URL, commit SHA, and date snapshotted.
- [ ] Commit: `chore(db): vendor Kanjium pitch-accent snapshot YYYY-MM-DD`.

### Task 11: `seed-vocab-pitch.ts` — JMdict + validator + Kanjium merge

- [ ] Create `packages/db/src/seeds/__tests__/validator.test.ts` first (TDD). Test: `validateVocabContainsKanji({word: "息子"}, "息")` → true; `validateVocabContainsKanji({word: "呼吸"}, "息")` → false.
- [ ] Create `packages/db/src/seeds/__tests__/kanjium-parse.test.ts`. Test: parsing a Kanjium line for `ありがとう` produces pitchPattern `[0, 1, 1, 1, 1]` (verify against Kanjium notation rules for 2-accent; document in comment).
- [ ] Create `packages/db/src/seeds/seed-vocab-pitch.ts`. Structure:
  - Load JMdict XML from the Tatoeba seed's existing vendored path (or download per its existing pattern — check `seed-sentences.ts`)
  - For each kanji: filter JMdict entries where `keb` contains the kanji character; rank by `news1`/`ichi1`/`spec1` markers; take top 10
  - Apply `validateVocabContainsKanji` — drop rejections to `seed-output/seed-warnings-YYYY-MM-DD.json`
  - Look up each `{word, reading}` in the Kanjium index; attach `pitchPattern` if found
  - UPSERT into `kanji.example_vocab`
  - Console summary + non-zero exit if `kanjiBelowFloor > 0` (with `--allow-below-floor` override flag)
- [ ] Run unit tests: `pnpm --filter @kanji-learn/db test -- validator kanjium-parse`. Expected: PASS.
- [ ] Run locally against DEV DB: `pnpm --filter @kanji-learn/db seed:vocab-pitch`.
- [ ] Spot-check `息`: `psql $DEV_DATABASE_URL -c "SELECT example_vocab FROM kanji WHERE id=1599;"` — should show 5–10 entries, all containing 息.
- [ ] Review `seed-output/seed-warnings-YYYY-MM-DD.json` — confirm rejections list is plausible and `kanjiBelowFloor` is empty.
- [ ] Commit: `feat(db): seed-vocab-pitch — JMdict + validator + Kanjium merge`.

### Task 12: `seed-kanjidic-refs.ts` — grade + frequency + Hadamitzky-Spahn

- [ ] Create `packages/db/src/seeds/seed-kanjidic-refs.ts`. For each kanji row: parse Kanjidic2 XML entry, extract:
  - `<grade>` → `kanji.grade`
  - `<freq>` → `kanji.frequency_rank`
  - `<dic_ref dr_type="sh_kk2">` with fallback to `dr_type="sh_kk"` → `kanji.hadamitzky_spahn`
  - UPDATE rows in place
- [ ] **Verify the sh_kk2 dic_ref mapping** — pull the Kanjidic2 DTD from the EDRDG maintainer's site (linked from the Kanjidic2 README) and confirm `sh_kk` / `sh_kk2` types exist and map to "Kanji & Kana". If mapping differs, document the discrepancy and leave `hadamitzky_spahn` NULL for this seed pass (migration still adds the column).
- [ ] Run locally: `pnpm --filter @kanji-learn/db seed:kanjidic-refs`.
- [ ] Spot-check: `psql $DEV_DATABASE_URL -c "SELECT character, grade, frequency_rank, hadamitzky_spahn FROM kanji WHERE id IN (1, 100, 1000, 1599);"`.
- [ ] Commit: `feat(db): seed-kanjidic-refs — grade, frequency, Hadamitzky-Spahn`.

### Task 13: Extend sentence seed cap 2 → 5

- [ ] Open `packages/db/src/seeds/seed-sentences.ts`. Find the per-kanji cap constant (`MAX_SENTENCES_PER_KANJI` or similar — the exact name is in the file).
- [ ] Change it from `2` to `5`.
- [ ] Add the same `validateSentenceContainsKanji` validator pattern used in Task 11 (factor to a shared util in `packages/db/src/seeds/validators.ts` if both seeds need it).
- [ ] Rerun the seed locally: `pnpm --filter @kanji-learn/db seed:sentences`.
- [ ] Spot-check `息`: should have 3–5 sentences, each containing 息.
- [ ] Commit: `feat(db): raise sentence seed cap to 5 per kanji + add validator`.

### Task 14: Apply Phase 2 to prod

- [ ] Apply migrations 0019, 0020 to prod via `psql $DATABASE_URL -f ...`.
- [ ] Run each seed against prod in order: vocab-pitch, kanjidic-refs, sentences.
- [ ] Verify on prod: same spot-checks from Tasks 11–13 against prod DB.
- [ ] Update HANDOFF.md with the Phase 2 rollout note.
- [ ] Commit: `chore(db): Phase 2 seeds applied to prod YYYY-MM-DD`.

---

## Phase 3 — API `getReadingQueue` + `voicePrompt`

**Scope:** Attach `voicePrompt` field to reading queue; allow `showPitchAccent` in user profile PATCH.

**File structure (Phase 3):**

```
apps/api/src/services/srs.service.ts         ← MODIFY (getReadingQueue)
apps/api/src/routes/review.ts                 ← MODIFY (response type only)
apps/api/src/routes/user.ts                   ← MODIFY (PATCH allowed fields)
apps/api/test/unit/srs-reading-queue.test.ts ← NEW (unit, pure — mock DB)
```

### Task 15: Extend `getReadingQueue` to attach `voicePrompt`

- [ ] Write a unit test (`apps/api/test/unit/srs-reading-queue.test.ts`) that asserts: for a kanji with non-empty `example_vocab`, `voicePrompt.type === 'vocab'` with the entry at index `reviewCount % vocab.length`; for a kanji with empty `example_vocab`, `voicePrompt.type === 'kanji'`. Use a pure helper extracted from the service — factor `selectVoicePrompt(exampleVocab, reviewCount)` out so it's testable without DB.
- [ ] Implement `selectVoicePrompt(exampleVocab: ExampleVocab[], reviewCount: number): VoicePrompt` in `srs.service.ts`:
  ```ts
  export type VoicePrompt =
    | { type: 'vocab'; word: string; reading: string; meaning: string; pitchPattern?: number[] }
    | { type: 'kanji' }

  export function selectVoicePrompt(
    exampleVocab: { word: string; reading: string; meaning: string; pitchPattern?: number[] }[] | null,
    reviewCount: number,
  ): VoicePrompt {
    if (!exampleVocab?.length) return { type: 'kanji' }
    const idx = (reviewCount ?? 0) % exampleVocab.length
    return { type: 'vocab', ...exampleVocab[idx] }
  }
  ```
- [ ] Extend the `getReadingQueue` SELECT to include `userKanjiProgress.reviewCount` and `kanji.exampleVocab`. After the `.filter(...)` call, `.map` each row into `{ ...row, voicePrompt: selectVoicePrompt(row.exampleVocab, row.reviewCount) }`.
- [ ] Run tests: `pnpm --filter @kanji-learn/api test -- srs-reading-queue`. Expected: PASS.
- [ ] Commit: `feat(api): attach voicePrompt to reading queue (round-robin by reviewCount)`.

### Task 16: Update `/voice` and route types

- [ ] The `/voice` endpoint body schema already accepts `correctReadings: z.array(z.string()).min(1)` — no change needed; client sends whatever fits the prompt mode.
- [ ] Update the reading-queue response type annotation in `apps/api/src/routes/review.ts` to include `voicePrompt` (compile-time only; the field is already in the service return shape).
- [ ] Deploy the API: `DOCKER_CONTEXT=default ./scripts/deploy-api.sh`.
- [ ] Smoke test: `curl $API/v1/review/reading-queue` returns `voicePrompt` per entry.
- [ ] Commit: `feat(api): expose voicePrompt in reading-queue response type`.

### Task 17: Add `showPitchAccent` to user profile PATCH

- [ ] In `apps/api/src/routes/user.ts`, find the PATCH validator (Zod schema) for the profile update. Add `showPitchAccent: z.boolean().optional()` to the accepted fields.
- [ ] Ensure the underlying `updateProfile` call (or equivalent) maps this through.
- [ ] Unit test: PATCH with `{showPitchAccent: false}` persists; the GET response reflects the updated value.
- [ ] Deploy.
- [ ] Commit: `feat(api): allow showPitchAccent in PATCH /v1/user/profile`.

---

## Phase 4 — Mobile (vocab drill + pitch UI + toggle)

**Scope:** Everything visible on the study card and kanji details page. Single EAS build (B125) at the end of this phase.

**File structure (Phase 4):**

```
apps/mobile/src/lib/mora-alignment.ts                      ← NEW (pure helper + tests)
apps/mobile/src/lib/__tests__/mora-alignment.test.ts      ← NEW
apps/mobile/src/components/kanji/PitchAccentReading.tsx    ← NEW
apps/mobile/src/stores/preferences.store.ts                ← MODIFY or CREATE (showPitchAccent slice)
apps/mobile/src/components/voice/VoiceEvaluator.tsx        ← MODIFY (accept voicePrompt, render vocab mode)
apps/mobile/app/(tabs)/study.tsx                            ← MODIFY (thread voicePrompt)
apps/mobile/app/kanji/[id].tsx                              ← MODIFY (wrap vocab readings, inline toggle chip)
apps/mobile/src/components/study/KanjiCard.tsx             ← MODIFY (wrap reveal-panel readings)
apps/mobile/app/(tabs)/profile.tsx                          ← MODIFY (Study Preferences section)
```

### Task 18: `mora-alignment.ts` pure helper

- [ ] Write failing tests in `apps/mobile/src/lib/__tests__/mora-alignment.test.ts`:
  - `alignMoraToKana('かんどう')` → `['か','ん','ど','う']`
  - `alignMoraToKana('きゃく')` → `['きゃ','く']`
  - `alignMoraToKana('かった')` → `['か','っ','た']`
  - `alignMoraToKana('はっぴょう')` → `['は','っ','ぴょ','う']`
  - `alignMoraToKana('カンドウ')` → `['カ','ン','ド','ウ']` (katakana support)
- [ ] Implement `alignMoraToKana(reading: string): string[]`:
  - Walk chars; if next char is in the small-kana set (ゃ/ゅ/ょ/ャ/ュ/ョ), group with previous
  - Otherwise each char is its own mora
- [ ] Run tests: `pnpm --filter @kanji-learn/mobile test -- mora-alignment`. Expected: PASS.
- [ ] Commit: `feat(mobile): mora-alignment helper for pitch rendering`.

### Task 19: `PitchAccentReading.tsx` component

- [ ] Create `apps/mobile/src/components/kanji/PitchAccentReading.tsx`. Props: `{reading: string; pattern?: number[]; enabled: boolean; size?: 'large'|'medium'|'small'}`.
- [ ] If `!enabled || !pattern` or `alignMoraToKana(reading).length !== pattern.length`: render a plain `<Text>{reading}</Text>`.
- [ ] Else: render each mora in its own `<Text>` with conditional `borderTopWidth: 2, borderTopColor: colors.accent` when `pattern[i] === 1`. At each high→low boundary (pattern transitions from 1 to 0), render a nested absolutely-positioned `<View>` styled as a small drop hook (6×6, border-right + border-bottom, absolute positioned at the end of the last high mora).
- [ ] Verify visually in Expo Go on a known vocab like `かんどう` with pattern `[0,1,1,1]` (odaka — low then sustained high with implicit drop after).
- [ ] Commit: `feat(mobile): PitchAccentReading component (NHK overline)`.

### Task 20: `preferences.store.ts` — `showPitchAccent` slice

- [ ] If `preferences.store.ts` exists, add `showPitchAccent: boolean` + `setShowPitchAccent(v: boolean)` action. If not, create it as a Zustand store persisted via AsyncStorage (pattern should match existing profile/auth stores).
- [ ] On store init, hydrate `showPitchAccent` from `useProfile().showPitchAccent` (server value) — local preference follows server.
- [ ] On `setShowPitchAccent`, immediately update local state AND fire a PATCH to `/v1/user/profile` with the new value.
- [ ] Commit: `feat(mobile): preferences store showPitchAccent slice`.

### Task 21: Thread `voicePrompt` through study.tsx → VoiceEvaluator

- [ ] In `apps/mobile/app/(tabs)/study.tsx`, find where the reading queue item is passed to `VoiceEvaluator`. Pass `voicePrompt={queueItem.voicePrompt}` as a new prop (fallback to `{type: 'kanji'}` if the field is missing — protects against old API responses during deploy skew).
- [ ] In `VoiceEvaluator.tsx`, add `voicePrompt?: VoicePrompt` to the Props interface. When `voicePrompt?.type === 'vocab'`, render the vocab word layout (see spec Section "Mobile Layer → Voice drill card"):
  - Main glyph text: `voicePrompt.word`
  - Pitch overlay: `<PitchAccentReading reading={voicePrompt.reading} pattern={voicePrompt.pitchPattern} enabled={showPitchAccent}/>`
  - Label: "Say this word"
  - Hint (respects `hideHint`): `({voicePrompt.reading})`
  - Meaning (respects `hideHint`): small muted text
  - `correctReadings` passed to the server = `[voicePrompt.reading]`
- [ ] When `voicePrompt?.type === 'kanji'` (or undefined), render today's layout unchanged.
- [ ] Commit: `feat(mobile): vocab prompt path in VoiceEvaluator`.

### Task 22: Integrate PitchAccentReading on kanji details page

- [ ] In `apps/mobile/app/kanji/[id].tsx`, wrap each vocab-list reading with `<PitchAccentReading reading={entry.reading} pattern={entry.pitchPattern} enabled={showPitchAccent}/>`.
- [ ] Add an inline `Pitch` toggle chip next to the existing Rōmaji toggle (match its styling — same chip component). On tap, calls `setShowPitchAccent(!showPitchAccent)`.
- [ ] Commit: `feat(mobile): pitch overlay + toggle on kanji details page`.

### Task 23: Integrate PitchAccentReading on study card reveal

- [ ] In `apps/mobile/src/components/study/KanjiCard.tsx`, wrap the vocab and sentence reading strings in `<PitchAccentReading>`. Sentences likely don't have per-sentence pitch (no `pitchPattern` on `example_sentences` entries in this build) — that's OK, component degrades to plain text.
- [ ] Commit: `feat(mobile): pitch overlay on study card reveal panel`.

### Task 24: Profile tab → Study Preferences toggle

- [ ] In `apps/mobile/app/(tabs)/profile.tsx`, add a Study Preferences section with a single toggle: "Show pitch accent markers on readings". Bound to `showPitchAccent` from the preferences store.
- [ ] Commit: `feat(mobile): Study Preferences section with pitch toggle`.

### Task 25: Onboarding default — set `showPitchAccent` based on JLPT level

- [ ] In the onboarding flow (`apps/mobile/app/onboarding.tsx` or equivalent), find where the user's JLPT self-assessment is captured. After the profile is created, if the user selected N5 or N4, set `showPitchAccent=false`; else `true` (N3/N2/N1/unsure).
- [ ] Commit: `feat(mobile): onboarding sets showPitchAccent default per JLPT level`.

### Task 26: Cut B125 EAS build + TestFlight submission

- [ ] From `apps/mobile/`: `eas build --platform ios --auto-submit`.
- [ ] Verify `eas-cli` is ≥ 18.7.0 (the version note in HANDOFF re: 18.5.0 silent failures).
- [ ] Wait for build + App Store Connect processing.
- [ ] Commit: `chore(mobile): bump build number for B125`.

### Task 27: On-device verification of B125

- [ ] Install B125 from TestFlight.
- [ ] Run through the verification checklist in the spec (Phase 4 exit criteria):
  - Reading card for 感 surfaces a vocab word; mic accepts the reading
  - Pitch overlay visible when toggle ON; hidden when OFF
  - Kanji details shows 5–10 vocab entries, all containing the target kanji
  - Rōmaji toggle still works
  - 20-card reading session → `daily_stats.reviewed` matches server
  - Profile toggle flips all three surfaces atomically
- [ ] Commit any verification notes to HANDOFF.md.

---

## Phase 5 — Verification + tracker hygiene

### Task 28: Close tracker entries

- [ ] Flip the homophone bug entry in BUGS.md to fully Fixed (both workaround + structural shift shipped).
- [ ] Close B4 (kanji-doesn't-contain-itself) in BUGS.md — side effect of Phase 2 validator.
- [ ] Flip E5 (expanded vocab + sentences), E6 (pitch accent), and the speak-icons scope-extension entries in ENHANCEMENTS.md to `✅ Shipped`.
- [ ] Add a note on `kanji.grade/frequency_rank/hadamitzky_spahn` to ENHANCEMENTS.md under the E11 entry (data now available, UI still future work).
- [ ] Commit: `docs: close Build 3-C tracker items`.

### Task 29: Update HANDOFF.md

- [ ] Add Build 3-C rollout summary: what shipped, build numbers, migration numbers, deploy op IDs.
- [ ] Update "Next-session first tasks" — pivot to Build 3-D (E8 + E16) or whatever the next agreed-upon work is.
- [ ] Commit: `docs(handoff): Build 3-C complete; pivot to 3-D`.

---

## Self-review summary

- **Spec coverage:** All five phases from the design (Phases 1–5) are tasked. Every field in Migration 0019 (grade, frequency_rank, hadamitzky_spahn) and Migration 0020 (show_pitch_accent) has a task. Both the short-term homophone workaround (Task 4) and the structural vocab-Speak drill (Tasks 15, 21) are tasked. B4 closure (Task 28) and B125 cutover (Task 26) are explicit.
- **Placeholder scan:** Tasks 11–14 and 18–27 describe work at task level with file paths and key code fragments rather than line-by-line step files. That's a deliberate trade: Phase 1 is fully fleshed out because the user specifically asked for Phase 1 front-loading; later phases describe decisions and entry points densely enough that a subagent with the spec in context can execute them without ambiguity. If any later phase turns out to need Phase-1-level detail during execution, the executing-plans skill can request a plan refinement.
- **Type consistency:** `VoicePrompt`, `KanjiReadingsIndex`, `PitchAccentReading` prop names, `showPitchAccent` column/field name, `selectVoicePrompt` helper — all referenced consistently across tasks.

---

## Execution Handoff

Plan complete and saved to [docs/superpowers/plans/2026-04-19-vocab-as-drill-unit.md](2026-04-19-vocab-as-drill-unit.md). Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Phase 1 is fully detailed and ideal for this pattern.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
