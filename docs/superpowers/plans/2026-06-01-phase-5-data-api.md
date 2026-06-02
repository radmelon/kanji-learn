# Phase 5 — Data & API Implementation Plan (Plan 2 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data + thin-API layer for Phase 5 Contextual Mnemonic Co-Creation — the extended `cocreation_context` shape, a KRADFILE component-decomposition backfill (so the teaching beat has full components, not just the classifying radical), the cloud-assembly endpoint, co-created persistence + effectiveness/deepen mutations — and retire the superseded auto-generation/refresh/seed machinery behind a clone-rehearsed destructive cleanup.

**Architecture:** The mobile app owns the co-creation flow (Plan 3); this layer is **thin persistence + one piece of server intelligence (cloud assembly)**. We extend the existing `mnemonics` table (no row-shape migration — `cocreation_context` is jsonb) and add ONE new `kanji.components` column (KRADFILE decomposition) alongside the existing `kanji.radicals` (classifying radical, left untouched so Browse's "shares a radical" feature does not regress). The cloud assembler reuses the existing Anthropic client via an injectable seam so it is testable without network calls. The destructive cleanup follows the FSRS clone-rehearsal pattern (`docs/superpowers/runbooks/2026-05-22-fsrs-rollout.md`).

**Tech Stack:** TypeScript, Drizzle ORM (postgres-js), Fastify, vitest (api integration tests under `apps/api/test/integration/`), Anthropic SDK, raw `psql -f` migrations. The shared pure logic (`updateEffectiveness`, `AssemblerSlots`) already exists from Plan 1 in `packages/shared/src/mnemonics/`.

**Spec:** [docs/superpowers/specs/2026-05-31-phase-5-mnemonic-cocreation-design.md](../specs/2026-05-31-phase-5-mnemonic-cocreation-design.md) — this plan implements §7.1 (KRADFILE enrichment — operator-approved 2026-06-01), §7.3 (cloud tier), §10.1 (`cocreation_context` `$type`), §10.2–10.4 (keep/adapt cloud capability; retire refresh nudge), §10.5 (destructive cleanup), §13 (api integration tests).

**Recon resolved (2026-06-01):** `kanji.radicals` (`schema.ts:115`) holds only the single classifying Kangxi radical (`backfill-radicals.ts:340` writes `[radChar]`). `mnemonicGenerationMethodEnum` already includes `'cocreated'` (`schema.ts:78-82`). The jsonb double-encoding fix is present (`packages/db/src/client.ts`). `packages/db` does NOT depend on `@kanji-learn/shared`, so the schema's `$type` stays inline; the canonical `CoCreationContext` type lives in shared for the app/API.

---

## File Structure

```
packages/shared/src/mnemonics/types.ts        # ADD: CoCreationContext, CoCreationLayer interfaces
packages/shared/src/mnemonics/types.test.ts   # ADD: shape-pinning test

packages/db/src/schema.ts                      # ADD kanji.components col; EXTEND mnemonics.cocreationContext $type
packages/db/supabase/migrations/0026_kanji_components.sql   # NEW migration (applied via psql)
packages/db/src/seeds/backfill-components.ts   # NEW KRADFILE backfill (mirrors backfill-radicals.ts)
packages/db/src/seeds/backfill-components.test.ts  # NEW pure-parser unit test (uses api vitest? see Task 3)
packages/db/package.json                       # ADD seed:backfill-components script; REMOVE seed:mnemonics
packages/db/src/seeds/seed-mnemonics.ts        # DELETE

apps/api/src/services/mnemonic.service.ts      # injectable Anthropic seam; assembleFromSlots; saveCoCreatedMnemonic;
                                               # recordOutcome; applyDeepen; extend MnemonicRecord/toRecord;
                                               # REMOVE getDueForRefresh/dismissRefresh/seedSystemMnemonic + refresh stamping
apps/api/src/routes/mnemonics.ts               # ADD /assemble, /:kanjiId/cocreated, /:id/outcome, /:id/deepen;
                                               # REMOVE /refresh + /:id/refresh/dismiss
apps/api/test/integration/mnemonic-cocreation.test.ts  # NEW integration tests

scripts/cleanup-old-mnemonics.mjs              # NEW destructive cleanup (clone-rehearsed)
docs/superpowers/runbooks/2026-06-01-phase5-data-cleanup.md  # NEW runbook
```

**Why these boundaries:** `CoCreationContext` is defined once in shared (the contract mobile + API + the schema comment all reference). The new `kanji.components` column is additive and isolated — no existing feature reads it. The cloud assembler is injected so it is unit-testable. The destructive cleanup is a standalone script + runbook, executed only at the coordinated Phase 5 cut, never inside a dev test run.

---

### Task 1: Shared `CoCreationContext` type (the persisted jsonb contract)

**Files:**
- Modify: `packages/shared/src/mnemonics/types.ts`
- Test: `packages/shared/src/mnemonics/types.test.ts`

- [ ] **Step 1: Add the interfaces to `types.ts`**

Append to `packages/shared/src/mnemonics/types.ts` (after the existing `BuddyMomentAction` block):

```ts
// ── Persisted co-creation context (spec §10.1) ─────────────────────────────
// Written to mnemonics.cocreation_context (jsonb). The mobile flow assembles
// this client-side; the API persists it verbatim. The db schema mirrors this
// shape inline in an $type<>() annotation (packages/db has no shared dep).

/** One additive layer of a co-created hook. Deepening appends a layer; nothing is discarded. */
export interface CoCreationLayer {
  questions: string[]
  answers: string[]
  anchor?: string
  source: 'environment' | 'known_knowledge'
}

/** Full structured context behind a co-created mnemonic story. */
export interface CoCreationContext {
  layers: CoCreationLayer[]
  layerCount: number
  locationName?: string
  components: Array<{ char: string; meaning: string }>
  generatedBy: AssemblyTier
  /** ISO timestamp; set on create/deepen, cleared after the first story→kanji quiz. */
  mnemonicQuizDueAt?: string
  timeOfDay?: string
}
```

- [ ] **Step 2: Add the shape-pinning test**

Append to `packages/shared/src/mnemonics/types.test.ts`:

```ts
import type { CoCreationContext } from './types'

describe('CoCreationContext', () => {
  it('accepts a fully-populated layered context', () => {
    const ctx: CoCreationContext = {
      layers: [
        { questions: ['Look around — what catches your eye?'], answers: ['a yellow vending machine'], anchor: 'a yellow vending machine', source: 'environment' },
        { questions: ['What does this connect to?'], answers: ['my old bike'], source: 'known_knowledge' },
      ],
      layerCount: 2,
      locationName: 'Beppu Station',
      components: [{ char: '扌', meaning: 'hand' }, { char: '寺', meaning: 'temple' }],
      generatedBy: 'cloud',
      mnemonicQuizDueAt: '2026-06-01T00:00:00.000Z',
      timeOfDay: 'evening',
    }
    expect(ctx.layerCount).toBe(ctx.layers.length)
    expect(ctx.components.map((c) => c.char)).toEqual(['扌', '寺'])
    expect(ctx.generatedBy).toBe('cloud')
  })
})
```

> Note: `types.test.ts` already exists from Plan 1 with a `describe('mnemonics constants', …)` block and a top-level `import { describe, it, expect } from 'vitest'`. Add the new `import type` line at the top with the other imports and append the new `describe` block.

- [ ] **Step 3: Run the shared suite + typecheck**

Run: `pnpm --filter @kanji-learn/shared exec vitest run src/mnemonics/types.test.ts`
Expected: PASS.

Run: `pnpm --filter @kanji-learn/shared exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/mnemonics/types.ts packages/shared/src/mnemonics/types.test.ts
git commit -m "feat(shared): CoCreationContext persisted jsonb contract (Phase 5 §10.1)

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@me.com>"
```

---

### Task 2: Schema — `kanji.components` column + extended `cocreation_context` `$type`

**Files:**
- Modify: `packages/db/src/schema.ts` (kanji table ~line 115; mnemonics table ~line 292)
- Create: `packages/db/supabase/migrations/0026_kanji_components.sql`

- [ ] **Step 1: Add the `components` column to the `kanji` table**

In `packages/db/src/schema.ts`, immediately AFTER the existing `radicals` line (`:115`):

```ts
    radicals: jsonb('radicals').$type<string[]>().notNull().default([]),
    // Full KRADFILE component decomposition (Phase 5 teaching beat + distractors).
    // Distinct from `radicals` (the single classifying Kangxi radical, which drives
    // Browse "shares a radical"). Backfilled by seeds/backfill-components.ts.
    components: jsonb('components').$type<string[]>().notNull().default([]),
```

- [ ] **Step 2: Extend the `mnemonics.cocreationContext` `$type`**

In `packages/db/src/schema.ts`, REPLACE the existing inline type (`:292-296`):

```ts
    // Nullable jsonb — Drizzle already infers `T | null` from the missing .notNull().
    cocreationContext: jsonb('cocreation_context').$type<{
      questions: string[]
      answers: string[]
      timeOfDay?: string
    }>(),
```

with (mirrors `@kanji-learn/shared` `CoCreationContext` — kept inline because packages/db has no shared dep):

```ts
    // Nullable jsonb — Drizzle infers `T | null` from the missing .notNull().
    // Shape mirrors @kanji-learn/shared `CoCreationContext` (spec §10.1). Kept
    // inline because packages/db does not depend on @kanji-learn/shared.
    cocreationContext: jsonb('cocreation_context').$type<{
      layers: Array<{
        questions: string[]
        answers: string[]
        anchor?: string
        source: 'environment' | 'known_knowledge'
      }>
      layerCount: number
      locationName?: string
      components: Array<{ char: string; meaning: string }>
      generatedBy: 'template' | 'on_device' | 'cloud'
      mnemonicQuizDueAt?: string
      timeOfDay?: string
    }>(),
```

- [ ] **Step 3: Write the SQL migration**

Create `packages/db/supabase/migrations/0026_kanji_components.sql`:

```sql
-- 0026_kanji_components.sql
-- Phase 5: add full component decomposition to kanji (KRADFILE-sourced).
-- Distinct from `radicals` (single classifying Kangxi radical). Additive,
-- non-destructive: no existing feature reads this column.

ALTER TABLE kanji
  ADD COLUMN IF NOT EXISTS components jsonb NOT NULL DEFAULT '[]'::jsonb;
```

> No SQL change is needed for `cocreation_context` — it is an existing jsonb column; the `$type` change is compile-time only.

- [ ] **Step 4: Typecheck the db package**

Run: `pnpm --filter @kanji-learn/db typecheck`
Expected: 0 errors.

- [ ] **Step 5: Apply the migration to the local clone DB (and verify)**

Run (against the local test/clone DB — NOT live; see runbook for live):
```bash
psql "$TEST_DATABASE_URL" -f packages/db/supabase/migrations/0026_kanji_components.sql
psql "$TEST_DATABASE_URL" -c "\d kanji" | grep components
```
Expected: `components | jsonb | not null | '[]'::jsonb` present.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/supabase/migrations/0026_kanji_components.sql
git commit -m "feat(db): kanji.components column + extended cocreation_context \$type (Phase 5)

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@me.com>"
```

---

### Task 3: Component backfill from IDS — first-level decomposition (clone-rehearsed data task)

> **Source decision (2026-06-01, during execution):** the original plan named KRADFILE, but KRADFILE decomposes to *atomic radical-lookup primitives* (持 → 寸 土 扎) and uses substitute glyphs that do NOT match our radical dictionary — it cannot produce the operator's teaching beat (持 = 扌 + 寺). **Switched to IDS** (cjkvi-ids `ids.txt`), which gives the *first-level structural decomposition* (持 → ⿰扌寺 → [扌, 寺]) using the exact codepoints our Plan 1 radical dictionary already keys on (扌=U+624C, 寺=U+5BFA, 言=U+8A00). UTF-8, no EUC-JP.

**Files:**
- Create: `packages/db/src/seeds/backfill-components.ts`
- Create: `packages/db/src/seeds/backfill-components.test.ts`
- Modify: `packages/db/package.json` (add `seed:backfill-components` script)

This mirrors `backfill-radicals.ts` (download → parse → backfill). IDS `ids.txt` is UTF-8, tab-separated (`U+XXXX\t字\t⿰扌寺`). The pure parser (`parseIds`) is unit-tested; the backfill itself is verified by clone-rehearsal + spot-check (the repo convention for data scripts — same as backfill-radicals/FSRS replay). Attribution: cjkvi-ids (CHISE/free-licensed) — note in `ACKNOWLEDGEMENTS` as a follow-up.

- [ ] **Step 1: Write the failing parser test**

Create `packages/db/src/seeds/backfill-components.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseIds } from './backfill-components'

// IDS format: `U+XXXX\t字\t<ids>`, tab-separated. Lines starting with # are comments.
// IDS strings use Ideographic Description Characters (⿰⿱…, U+2FF0–U+2FFF) which
// are stripped to leave the first-level component characters. A char that
// decomposes only to itself (atomic) maps to [].
const SAMPLE = [
  '#comment',
  'U+6301\t持\t⿰扌寺',
  'U+6797\t林\t⿰木木',
  'U+8A9E\t語\t⿰言吾',
  'U+4E00\t一\t一',                    // atomic → []
  'U+5840\t塀\t⿰土屏[GTV]\t⿰土屏[J]', // variant columns + region tag → take first
  '',
].join('\n')

describe('parseIds', () => {
  it('strips IDCs to first-level components (the teaching-beat split)', () => {
    const map = parseIds(SAMPLE)
    expect(map.get('持')).toEqual(['扌', '寺'])
    expect(map.get('語')).toEqual(['言', '吾'])
  })

  it('keeps repeated components (林 = two trees)', () => {
    expect(parseIds(SAMPLE).get('林')).toEqual(['木', '木'])
  })

  it('maps an atomic kanji to [] (decomposes only to itself)', () => {
    expect(parseIds(SAMPLE).get('一')).toEqual([])
  })

  it('takes the first IDS variant and drops region tags', () => {
    expect(parseIds(SAMPLE).get('塀')).toEqual(['土', '屏'])
  })

  it('skips comment and blank lines', () => {
    expect(parseIds(SAMPLE).has('#comment')).toBe(false)
  })
})
```

- [ ] **Step 2: Decide the test runner for the db package**

`packages/db` has no vitest config yet. Add a minimal one so this parser test runs (mirrors how Spec 1.5 added vitest to `packages/shared`).

Create `packages/db/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

Add to `packages/db/package.json` `scripts` (alongside the existing entries):

```json
    "test": "vitest run",
```

And add `vitest` to `packages/db` devDependencies (match the version used by `packages/shared`):

```bash
# from repo root — pin to the same vitest the workspace already uses
pnpm --filter @kanji-learn/db add -D vitest
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @kanji-learn/db exec vitest run src/seeds/backfill-components.test.ts`
Expected: FAIL — "Failed to resolve import './backfill-components'".

- [ ] **Step 4: Implement the backfill script**

Create `packages/db/src/seeds/backfill-components.ts`:

```ts
/**
 * backfill-components.ts
 *
 * Fills `kanji.components` with the FIRST-LEVEL structural decomposition
 * (e.g. 持 → [扌, 寺]) from IDS (cjkvi-ids). Distinct from `kanji.radicals`
 * (single classifying Kangxi radical). IDS is UTF-8 — no encoding step.
 *
 * Source: https://github.com/cjkvi/cjkvi-ids (CHISE/free-licensed).
 *
 * Usage:
 *   pnpm --filter @kanji-learn/db seed:backfill-components
 */

import 'dotenv/config'
import { createWriteStream, readFileSync, existsSync } from 'fs'
import https from 'https'
import { fileURLToPath } from 'node:url'

const IDS_URL = 'https://raw.githubusercontent.com/cjkvi/cjkvi-ids/master/ids.txt'
const LOCAL_PATH = '/tmp/cjkvi-ids.txt'

// ─── Pure parser (unit-tested) ────────────────────────────────────────────────

/**
 * Parse cjkvi-ids `ids.txt` → Map<kanji, first-level components[]>.
 * Each line: `U+XXXX<TAB>字<TAB><IDS>[<TAB>variant IDS…]`. We take the first
 * IDS column, drop any `[region]` tag, strip Ideographic Description Characters
 * (U+2FF0–U+2FFF) and entity markers, and keep the remaining component chars.
 * A char that decomposes only to itself (atomic) maps to [].
 */
export function parseIds(text: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const cols = line.split('\t')
    if (cols.length < 3) continue
    const char = cols[1]
    if (!char || [...char].length !== 1) continue
    const ids = cols[2].replace(/\[[^\]]*\]/g, '').trim()
    const components = [...ids].filter((ch) => {
      const cp = ch.codePointAt(0)!
      if (cp >= 0x2ff0 && cp <= 0x2fff) return false // IDCs ⿰⿱⿲…
      if (ch === '〾' || ch === '？' || ch === '?' || ch === '&' || ch === ';') return false
      return true
    })
    if (components.length === 0) continue
    if (components.length === 1 && components[0] === char) { map.set(char, []); continue }
    map.set(char, components)
  }
  return map
}

// ─── Download (UTF-8, no decode) ───────────────────────────────────────────────

async function download(): Promise<string> {
  if (existsSync(LOCAL_PATH)) {
    console.log(`ℹ  Using cached IDS at ${LOCAL_PATH}`)
    return readFileSync(LOCAL_PATH, 'utf-8')
  }
  console.log('⬇  Downloading cjkvi-ids ids.txt…')
  const text: string = await new Promise((resolve, reject) => {
    https
      .get(IDS_URL, (res) => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
        let buf = ''
        res.setEncoding('utf-8')
        res.on('data', (c) => (buf += c))
        res.on('end', () => resolve(buf))
      })
      .on('error', reject)
  })
  createWriteStream(LOCAL_PATH).end(text)
  console.log('✓  Downloaded.')
  return text
}

// ─── Backfill (DB imports are lazy so the parser stays test-importable) ────────

async function backfill(map: Map<string, string[]>): Promise<void> {
  const { db } = await import('../client.js')
  const { kanji } = await import('../schema.js')
  const { eq } = await import('drizzle-orm')

  const rows = await db.select({ id: kanji.id, character: kanji.character }).from(kanji)
  console.log(`\n📝 ${rows.length} kanji in DB — backfilling components…`)

  let updated = 0
  let missing = 0
  for (const row of rows) {
    const components = map.get(row.character)
    if (!components) { missing++; continue }
    await db
      .update(kanji)
      .set({ components: JSON.stringify(components) as unknown as string[] })
      .where(eq(kanji.id, row.id))
    updated++
    if (updated % 100 === 0) process.stdout.write(`\r  ${updated}/${rows.length}…`)
  }

  console.log(`\n\n✅ Done.  Updated: ${updated}   No IDS entry: ${missing}`)
  const [mochi] = await db.select().from(kanji).where(eq(kanji.character, '持'))
  console.log(`   Spot-check 持 components: ${JSON.stringify(mochi?.components)}`)
}

async function run(): Promise<void> {
  const text = await download()
  const map = parseIds(text)
  console.log(`✓  Parsed ${map.size} IDS entries.`)
  await backfill(map)
  process.exit(0)
}

// Only run as a CLI, never on test import.
const isCli = process.argv[1] === fileURLToPath(import.meta.url)
if (isCli) {
  run().catch((err) => {
    console.error('✖ backfill-components failed:', err)
    process.exit(1)
  })
}
```

> The `JSON.stringify(...) as unknown as string[]` cast mirrors `backfill-radicals.ts:340`. DB imports are lazy (`await import`) so the pure `parseIds` is importable in the unit test without `DATABASE_URL`.

- [ ] **Step 5: Run the parser test to verify it passes**

Run: `pnpm --filter @kanji-learn/db exec vitest run src/seeds/backfill-components.test.ts`
Expected: PASS (3 tests). The `run()` call at module bottom does NOT execute under vitest because the import is the test target — but to be safe, the `run().catch(...)` executes on import. Guard it so the test import does not trigger a live download:

Wrap the bottom of `backfill-components.ts`:

```ts
// Only run as a CLI, never on test import.
import { fileURLToPath } from 'node:url'
const isCli = process.argv[1] === fileURLToPath(import.meta.url)
if (isCli) {
  run().catch((err) => {
    console.error('✖ backfill-components failed:', err)
    process.exit(1)
  })
}
```

Replace the bare `run().catch(...)` block from Step 4 with this guarded version. Re-run the test:

Run: `pnpm --filter @kanji-learn/db exec vitest run src/seeds/backfill-components.test.ts`
Expected: PASS, no network call.

- [ ] **Step 6: Add the seed script to `package.json`**

In `packages/db/package.json` `scripts`, add after `seed:backfill-radicals`:

```json
    "seed:backfill-components": "tsx src/seeds/backfill-components.ts",
```

- [ ] **Step 7: Clone-rehearse the backfill (against a clone, not live)**

Per the FSRS clone-rehearsal pattern (`docs/superpowers/runbooks/2026-05-22-fsrs-rollout.md`): apply `0026` to a fresh clone of live, run the backfill, spot-check.

```bash
# DATABASE_URL pointed at the local clone for this run only
pnpm --filter @kanji-learn/db seed:backfill-components
```
Expected console: `Spot-check 持 components: ["寺","扌"]` (or `["扌","寺"]` — order is KRADFILE's), plus a high `Updated` count and small `No KRADFILE entry` count. Manually confirm 持 contains BOTH 扌 and 寺 (the gap this whole task closes), and 語 contains 言.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/seeds/backfill-components.ts packages/db/src/seeds/backfill-components.test.ts packages/db/vitest.config.ts packages/db/package.json pnpm-lock.yaml
git commit -m "feat(db): IDS first-level component backfill (Phase 5 teaching beat)

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@me.com>
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Cloud-assembly endpoint (injectable Anthropic seam)

**Files:**
- Modify: `apps/api/src/services/mnemonic.service.ts`
- Modify: `apps/api/src/routes/mnemonics.ts`
- Test: `apps/api/test/integration/mnemonic-cocreation.test.ts`

The cloud tier assembles a story from the full co-creation slots and returns it (no DB write — the client persists separately). Make the Anthropic client injectable so the route is testable without a network call.

- [ ] **Step 1: Add the injectable seam to the service constructor**

In `apps/api/src/services/mnemonic.service.ts`, REPLACE the import block (`:1-5`):

```ts
import Anthropic from '@anthropic-ai/sdk'
import { and, eq, isNull, lte } from 'drizzle-orm'
import { mnemonics, kanji } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import { MNEMONIC_REFRESH_DAYS, updateEffectiveness, EFFECTIVENESS_DEFAULT } from '@kanji-learn/shared'
import type { AssemblerSlots, CoCreationContext } from '@kanji-learn/shared'
```

> Keep `isNull`/`lte`/`MNEMONIC_REFRESH_DAYS` for now — `getDueForRefresh`/`dismissRefresh` still use them until Task 7 removes both the methods and these imports together.

REPLACE the constructor + field (`:31-36`):

```ts
/** Minimal seam over Anthropic.messages.create so the cloud tier is testable. */
export interface AnthropicLike {
  messages: {
    create(args: {
      model: string
      max_tokens: number
      system: string
      messages: { role: 'user'; content: string }[]
    }): Promise<{ content: Array<{ type: string; text?: string }> }>
  }
}

export class MnemonicService {
  private anthropic: AnthropicLike

  constructor(private db: Db, anthropic?: AnthropicLike) {
    this.anthropic =
      anthropic ?? (new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) as unknown as AnthropicLike)
  }
```

- [ ] **Step 2: Add `assembleFromSlots` + the co-creation prompt**

In `mnemonic.service.ts`, add this method (after `getForKanji`, before `generateHaiku`):

```ts
  // ── Cloud-tier assembly from co-creation slots (spec §7.3) ────────────────

  /** Weaves the co-creation slots into a personal story via Claude. Throws on
   *  Anthropic error so the client can fall to the next cascade tier. */
  async assembleFromSlots(slots: AssemblerSlots): Promise<string> {
    const res = await this.anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: COCREATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildAssemblyPrompt(slots) }],
    })
    const block = res.content[0]
    const text = block?.type === 'text' ? block.text?.trim() : undefined
    if (!text) throw new Error('Cloud assembly returned no text')
    return text
  }
```

At the bottom of the file, after `MNEMONIC_SYSTEM_PROMPT`, add:

```ts
const COCREATION_SYSTEM_PROMPT = `You are Buddy, a warm study companion helping a learner BUILD their own memory hook for a kanji.
You are given real details the learner just gave you: where they are, something they can see, the kanji's component parts and meaning, and its reading.
Weave ALL of them into one vivid 2–3 sentence second-person scene that connects the new kanji to what they already see and know (learning is constructed: new → known).
Name each component's meaning, ground it in their place, use their anchor detail, and surface the reading naturally. Concrete and surprising, never generic. Output ONLY the story — no preamble, no labels.`

function buildAssemblyPrompt(slots: AssemblerSlots): string {
  const components = slots.components.length
    ? slots.components.map((c) => `${c.char} (${c.meaning})`).join(', ')
    : 'no mapped components'
  const lines = [
    `Kanji: ${slots.kanji} — means "${slots.kanjiMeaning}", read ${slots.reading}.`,
    `Components: ${components}.`,
    `Place: ${slots.locationName}.`,
    `They are looking at: ${slots.anchor}.`,
  ]
  if (slots.personalDetail) lines.push(`Personal detail: ${slots.personalDetail}.`)
  if (slots.readingPlay) lines.push(`Reading wordplay seed: ${slots.readingPlay}.`)
  return lines.join('\n')
}
```

- [ ] **Step 3: Add the `/assemble` route**

In `apps/api/src/routes/mnemonics.ts`, add the slots schema near the other schemas (after `generateSchema`):

```ts
const assembleSchema = z.object({
  kanji: z.string().min(1),
  kanjiMeaning: z.string().min(1),
  reading: z.string().min(1),
  components: z
    .array(z.object({ char: z.string(), name: z.string(), meaning: z.string(), imageKeyword: z.string() }))
    .default([]),
  locationName: z.string().min(1),
  anchor: z.string().min(1),
  personalDetail: z.string().optional(),
  readingPlay: z.string().optional(),
})
```

Add the route inside `mnemonicRoutes` (after the `/generate` route):

```ts
  // POST /v1/mnemonics/assemble — cloud-tier story assembly (no DB write)
  server.post(
    '/assemble',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const body = assembleSchema.safeParse(req.body)
      if (!body.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
      }
      try {
        const storyText = await service.assembleFromSlots(body.data)
        return reply.send({ ok: true, data: { storyText, generatedBy: 'cloud' } })
      } catch {
        // Signal the client to fall to the next cascade tier (on-device / template).
        return reply.code(502).send({ ok: false, error: 'Assembly failed', code: 'ASSEMBLY_FAILED' })
      }
    }
  )
```

- [ ] **Step 4: Write the failing integration test**

Create `apps/api/test/integration/mnemonic-cocreation.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@kanji-learn/db'
import { buildTestApp } from '../helpers/test-app'
import { mnemonicRoutes } from '../../src/routes/mnemonics'
import { MnemonicService, type AnthropicLike } from '../../src/services/mnemonic.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER = '00000000-0000-0000-0000-0000000c0c01'

// A fake Anthropic that returns canned text — no network.
const fakeOk: AnthropicLike = {
  messages: { create: async () => ({ content: [{ type: 'text', text: 'At Beppu Station a hand holds a can.' }] }) },
}
const fakeErr: AnthropicLike = {
  messages: { create: async () => { throw new Error('rate limited') } },
}

let app: Awaited<ReturnType<typeof buildTestApp>>

afterAll(async () => { await app?.close(); await client.end() })

const SLOTS = {
  kanji: '持', kanjiMeaning: 'hold', reading: 'もつ',
  components: [{ char: '扌', name: 'tehen', meaning: 'hand', imageKeyword: 'a hand grasping' }],
  locationName: 'Beppu Station', anchor: 'a yellow vending machine',
}

describe('POST /v1/mnemonics/assemble', () => {
  it('returns assembled cloud story on success', async () => {
    app = await buildTestApp({
      plugin: async (s) => mnemonicRoutes.call(null, s),
      opts: {},
    })
    // The route builds its own MnemonicService(server.db). Override it by
    // re-registering with an injected service: simplest path is a dedicated
    // test plugin (see Step 5). For now assert via the injected-service plugin.
    expect(true).toBe(true)
  })
})
```

> The route file constructs `new MnemonicService(server.db)` internally, so the fake client cannot be injected through the existing plugin. Step 5 makes the service injectable into the route plugin. Defer the real assertions to Step 6.

- [ ] **Step 5: Make the route plugin accept an injected service (for testability)**

In `apps/api/src/routes/mnemonics.ts`, change the plugin signature so an existing service can be passed (production still constructs its own):

```ts
export async function mnemonicRoutes(
  server: FastifyInstance,
  opts?: { service?: MnemonicService },
) {
  const service = opts?.service ?? new MnemonicService(server.db)
```

> Fastify passes the register `opts` object as the second plugin argument, so `app.register(mnemonicRoutes, { service })` injects it. Production registration in `apps/api/src/server.ts` is unchanged (no opts → constructs its own).

- [ ] **Step 6: Replace the test body with real assertions**

Replace the `describe('POST /v1/mnemonics/assemble', …)` block:

```ts
describe('POST /v1/mnemonics/assemble', () => {
  it('returns the assembled cloud story on success', async () => {
    const app = await buildTestApp({
      plugin: mnemonicRoutes,
      opts: { prefix: '/v1/mnemonics', service: new MnemonicService(db, fakeOk) },
    })
    const res = await app.inject({
      method: 'POST', url: '/v1/mnemonics/assemble',
      headers: { 'x-test-user-id': USER }, payload: SLOTS,
    })
    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.ok).toBe(true)
    expect(json.data.generatedBy).toBe('cloud')
    expect(json.data.storyText).toContain('Beppu Station')
    await app.close()
  })

  it('returns 502 ASSEMBLY_FAILED so the client can fall back', async () => {
    const app = await buildTestApp({
      plugin: mnemonicRoutes,
      opts: { prefix: '/v1/mnemonics', service: new MnemonicService(db, fakeErr) },
    })
    const res = await app.inject({
      method: 'POST', url: '/v1/mnemonics/assemble',
      headers: { 'x-test-user-id': USER }, payload: SLOTS,
    })
    expect(res.statusCode).toBe(502)
    expect(res.json().code).toBe('ASSEMBLY_FAILED')
    await app.close()
  })
})
```

Remove the now-unused top-level `app` / `afterAll` if every test manages its own app; keep one `afterAll(async () => { await client.end() })` for the shared `client`.

> `buildTestApp`'s `RouteSpec` already supports `{ plugin, opts }`. Passing `service` inside `opts` reaches the plugin as the second arg (Fastify merges register options). The `prefix` keeps URLs production-shaped.

- [ ] **Step 7: Run the test**

Run: `pnpm --filter @kanji-learn/api exec vitest run test/integration/mnemonic-cocreation.test.ts`
Expected: PASS (2 tests). No network call (fakes used).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/mnemonic.service.ts apps/api/src/routes/mnemonics.ts apps/api/test/integration/mnemonic-cocreation.test.ts
git commit -m "feat(api): cloud-tier mnemonic assembly endpoint (injectable, falls back on error)

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@me.com>"
```

---

### Task 5: Co-created persistence (`saveCoCreatedMnemonic` + route)

**Files:**
- Modify: `apps/api/src/services/mnemonic.service.ts`
- Modify: `apps/api/src/routes/mnemonics.ts`
- Test: `apps/api/test/integration/mnemonic-cocreation.test.ts`

- [ ] **Step 1: Extend `MnemonicRecord` + `toRecord` to carry the co-creation fields**

In `mnemonic.service.ts`, REPLACE the `MnemonicRecord` interface (`:9-22`):

```ts
export interface MnemonicRecord {
  id: string
  kanjiId: number
  userId: string | null
  type: 'system' | 'user'
  storyText: string
  imagePrompt: string | null
  imageUrl: string | null
  latitude: number | null
  longitude: number | null
  generationMethod: 'system' | 'user' | 'cocreated'
  locationType: string | null
  cocreationContext: CoCreationContext | null
  effectivenessScore: number
  reinforcementCount: number
  lastReinforcedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
```

REPLACE `toRecord` (`:270-285`):

```ts
  private toRecord(row: typeof mnemonics.$inferSelect): MnemonicRecord {
    return {
      id: row.id,
      kanjiId: row.kanjiId,
      userId: row.userId,
      type: row.type,
      storyText: row.storyText,
      imagePrompt: row.imagePrompt,
      imageUrl: row.imageUrl,
      latitude: row.latitude,
      longitude: row.longitude,
      generationMethod: row.generationMethod,
      locationType: row.locationType,
      cocreationContext: (row.cocreationContext as CoCreationContext | null) ?? null,
      effectivenessScore: row.effectivenessScore,
      reinforcementCount: row.reinforcementCount,
      lastReinforcedAt: row.lastReinforcedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }
```

- [ ] **Step 2: Add `saveCoCreatedMnemonic`**

In `mnemonic.service.ts`, add (after `saveUserMnemonic`):

```ts
  // ── Persist a co-created mnemonic (client-owned flow; spec §10.1/§10.3) ────

  async saveCoCreatedMnemonic(
    kanjiId: number,
    userId: string,
    storyText: string,
    context: CoCreationContext,
    coords?: { latitude: number; longitude: number },
  ): Promise<MnemonicRecord> {
    const [row] = await this.db
      .insert(mnemonics)
      .values({
        kanjiId,
        userId,
        type: 'user',
        generationMethod: 'cocreated',
        storyText,
        imagePrompt: null,
        cocreationContext: context,
        locationType: context.locationName ?? null,
        latitude: coords?.latitude,
        longitude: coords?.longitude,
        // No refreshPromptAt — the 30-day nudge is retired (Task 7).
      })
      .returning()
    return this.toRecord(row)
  }
```

- [ ] **Step 3: Add the `/:kanjiId/cocreated` route**

In `apps/api/src/routes/mnemonics.ts`, add the schema (after `assembleSchema`):

```ts
const layerSchema = z.object({
  questions: z.array(z.string()),
  answers: z.array(z.string()),
  anchor: z.string().optional(),
  source: z.enum(['environment', 'known_knowledge']),
})
const contextSchema = z.object({
  layers: z.array(layerSchema),
  layerCount: z.number().int().nonnegative(),
  locationName: z.string().optional(),
  components: z.array(z.object({ char: z.string(), meaning: z.string() })),
  generatedBy: z.enum(['template', 'on_device', 'cloud']),
  mnemonicQuizDueAt: z.string().optional(),
  timeOfDay: z.string().optional(),
})
const cocreatedSchema = z.object({
  storyText: z.string().min(1).max(2000),
  context: contextSchema,
}).merge(coordsSchema)
```

Add the route (after `/assemble`):

```ts
  // POST /v1/mnemonics/:kanjiId/cocreated — persist a finished co-created hook
  server.post<{ Params: { kanjiId: string } }>(
    '/:kanjiId/cocreated',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const kanjiId = Number(req.params.kanjiId)
      if (!Number.isInteger(kanjiId) || kanjiId < 1) {
        return reply.code(400).send({ ok: false, error: 'Invalid kanjiId', code: 'VALIDATION_ERROR' })
      }
      const body = cocreatedSchema.safeParse(req.body)
      if (!body.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
      }
      const coords =
        body.data.latitude !== undefined && body.data.longitude !== undefined
          ? { latitude: body.data.latitude, longitude: body.data.longitude }
          : undefined
      const saved = await service.saveCoCreatedMnemonic(
        kanjiId, req.userId!, body.data.storyText, body.data.context, coords,
      )
      return reply.code(201).send({ ok: true, data: saved })
    }
  )
```

- [ ] **Step 4: Write the failing round-trip test**

Append to `mnemonic-cocreation.test.ts` (this is the spec §13 jsonb-survival guard):

```ts
import { eq, sql } from 'drizzle-orm'
import { kanji, mnemonics, userProfiles } from '@kanji-learn/db'

const CTX = {
  layers: [{ questions: ['q'], answers: ['a yellow vending machine'], anchor: 'a yellow vending machine', source: 'environment' as const }],
  layerCount: 1,
  locationName: 'Beppu Station',
  components: [{ char: '扌', meaning: 'hand' }, { char: '寺', meaning: 'temple' }],
  generatedBy: 'cloud' as const,
  mnemonicQuizDueAt: '2026-06-01T00:00:00.000Z',
}

describe('POST /v1/mnemonics/:kanjiId/cocreated', () => {
  let kanjiId: number
  beforeAll(async () => {
    await db.execute(sql`DELETE FROM mnemonics WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
    await db.insert(userProfiles).values({ id: USER, displayName: 'CoCreate', timezone: 'UTC' })
    const [k] = await db.select({ id: kanji.id }).from(kanji).limit(1)
    kanjiId = k.id
  })

  it('persists generationMethod=cocreated and the layered context survives round-trip', async () => {
    const app = await buildTestApp({ plugin: mnemonicRoutes, opts: { prefix: '/v1/mnemonics' } })
    const res = await app.inject({
      method: 'POST', url: `/v1/mnemonics/${kanjiId}/cocreated`,
      headers: { 'x-test-user-id': USER },
      payload: { storyText: 'A hand holds a can at Beppu Station.', context: CTX, latitude: 33.2, longitude: 131.5 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.generationMethod).toBe('cocreated')
    await app.close()

    // Read straight from the DB — the jsonb must be a real object, not a
    // double-encoded string (guards the Phase 1' footgun).
    const [row] = await db.select().from(mnemonics).where(eq(mnemonics.userId, USER))
    expect(row.cocreationContext).toMatchObject({ layerCount: 1, generatedBy: 'cloud' })
    expect(row.cocreationContext!.components.map((c) => c.char)).toEqual(['扌', '寺'])
    // SQL-side ->> proves it is stored as an object (NULL would mean double-encoded).
    const probe = await db.execute(
      sql`SELECT cocreation_context->>'generatedBy' AS gen FROM mnemonics WHERE user_id = ${USER}`,
    )
    expect((probe[0] as { gen: string }).gen).toBe('cloud')
  })
})
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @kanji-learn/api exec vitest run test/integration/mnemonic-cocreation.test.ts`
Expected: PASS (3 tests now).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/mnemonic.service.ts apps/api/src/routes/mnemonics.ts apps/api/test/integration/mnemonic-cocreation.test.ts
git commit -m "feat(api): persist co-created mnemonics + layered context (jsonb round-trip tested)

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@me.com>"
```

---

### Task 6: Effectiveness outcome + deepen mutations

**Files:**
- Modify: `apps/api/src/services/mnemonic.service.ts`
- Modify: `apps/api/src/routes/mnemonics.ts`
- Test: `apps/api/test/integration/mnemonic-cocreation.test.ts`

- [ ] **Step 1: Add `recordOutcome` + `applyDeepen` to the service**

In `mnemonic.service.ts`, add (after `saveCoCreatedMnemonic`):

```ts
  // ── Reinforcement outcome → EMA effectiveness (spec §6.1) ──────────────────

  /** outcome = 1 (👍 / quiz correct) or 0 (👎 / quiz wrong). */
  async recordOutcome(mnemonicId: string, userId: string, outcome: 0 | 1): Promise<MnemonicRecord | null> {
    const [existing] = await this.db
      .select()
      .from(mnemonics)
      .where(and(eq(mnemonics.id, mnemonicId), eq(mnemonics.userId, userId)))
    if (!existing) return null

    const [updated] = await this.db
      .update(mnemonics)
      .set({
        effectivenessScore: updateEffectiveness(existing.effectivenessScore, outcome),
        reinforcementCount: existing.reinforcementCount + 1,
        lastReinforcedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(mnemonics.id, mnemonicId), eq(mnemonics.userId, userId)))
      .returning()
    return updated ? this.toRecord(updated) : null
  }

  // ── Deepen: append a layer, reset score, keep history (spec §6.3) ──────────

  /** Replaces story + context with the deepened versions; resets effectiveness
   *  to the default (fresh chance) while reinforcementCount keeps climbing. */
  async applyDeepen(
    mnemonicId: string,
    userId: string,
    storyText: string,
    context: CoCreationContext,
  ): Promise<MnemonicRecord | null> {
    const [updated] = await this.db
      .update(mnemonics)
      .set({
        storyText,
        cocreationContext: context,
        effectivenessScore: EFFECTIVENESS_DEFAULT,
        updatedAt: new Date(),
      })
      .where(and(eq(mnemonics.id, mnemonicId), eq(mnemonics.userId, userId)))
      .returning()
    return updated ? this.toRecord(updated) : null
  }
```

- [ ] **Step 2: Add the routes**

In `apps/api/src/routes/mnemonics.ts`, add schemas (after `cocreatedSchema`):

```ts
const outcomeSchema = z.object({ outcome: z.union([z.literal(0), z.literal(1)]) })
const deepenSchema = z.object({
  storyText: z.string().min(1).max(2000),
  context: contextSchema,
})
```

Add the routes (after `/:kanjiId/cocreated`):

```ts
  // POST /v1/mnemonics/:id/outcome — record a reinforcement/quiz outcome
  server.post<{ Params: { id: string } }>(
    '/:id/outcome',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const body = outcomeSchema.safeParse(req.body)
      if (!body.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
      }
      const updated = await service.recordOutcome(req.params.id, req.userId!, body.data.outcome)
      if (!updated) return reply.code(404).send({ ok: false, error: 'Mnemonic not found', code: 'NOT_FOUND' })
      return reply.send({ ok: true, data: updated })
    }
  )

  // POST /v1/mnemonics/:id/deepen — append a layer (additive; never discard)
  server.post<{ Params: { id: string } }>(
    '/:id/deepen',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const body = deepenSchema.safeParse(req.body)
      if (!body.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
      }
      const updated = await service.applyDeepen(req.params.id, req.userId!, body.data.storyText, body.data.context)
      if (!updated) return reply.code(404).send({ ok: false, error: 'Mnemonic not found', code: 'NOT_FOUND' })
      return reply.send({ ok: true, data: updated })
    }
  )
```

- [ ] **Step 3: Write the failing tests**

Append to `mnemonic-cocreation.test.ts`:

```ts
describe('outcome + deepen mutations', () => {
  let mnemonicId: string
  beforeAll(async () => {
    const [row] = await db.select().from(mnemonics).where(eq(mnemonics.userId, USER))
    mnemonicId = row.id // the row created by the cocreated test above
  })

  it('a 👎 outcome moves effectiveness 0.5 → 0.30 and bumps reinforcementCount', async () => {
    const app = await buildTestApp({ plugin: mnemonicRoutes, opts: { prefix: '/v1/mnemonics' } })
    const res = await app.inject({
      method: 'POST', url: `/v1/mnemonics/${mnemonicId}/outcome`,
      headers: { 'x-test-user-id': USER }, payload: { outcome: 0 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.effectivenessScore).toBeCloseTo(0.3, 5)
    expect(res.json().data.reinforcementCount).toBe(1)
    await app.close()
  })

  it('deepen resets effectiveness to 0.5 and replaces the context, keeping count', async () => {
    const deepened = { ...CTX, layerCount: 2, layers: [...CTX.layers, { questions: ['connect?'], answers: ['my bike'], source: 'known_knowledge' as const }] }
    const app = await buildTestApp({ plugin: mnemonicRoutes, opts: { prefix: '/v1/mnemonics' } })
    const res = await app.inject({
      method: 'POST', url: `/v1/mnemonics/${mnemonicId}/deepen`,
      headers: { 'x-test-user-id': USER },
      payload: { storyText: 'Now also like my old bike.', context: deepened },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.effectivenessScore).toBeCloseTo(0.5, 5)
    expect(res.json().data.reinforcementCount).toBe(1) // unchanged by deepen
    expect(res.json().data.cocreationContext.layerCount).toBe(2)
    await app.close()
  })
})
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @kanji-learn/api exec vitest run test/integration/mnemonic-cocreation.test.ts`
Expected: PASS (5 tests). These run after the cocreated test in file order (vitest runs `describe`s top-to-bottom within a file; `fileParallelism:false` keeps files serial).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/mnemonic.service.ts apps/api/src/routes/mnemonics.ts apps/api/test/integration/mnemonic-cocreation.test.ts
git commit -m "feat(api): effectiveness-outcome + deepen mutations (EMA update, additive deepen)

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@me.com>"
```

---

### Task 7: Retire the 30-day refresh nudge (server side)

The reinforcement loop (effectivenessScore) replaces the 30-day refresh. Remove the server capability; stop stamping `refreshPromptAt` on new writes. The column stays (harmless; not dropped). The mobile callers (`useRefreshDue`, `MnemonicNudgeSheet`) are removed in Plan 4 — this branch ships as a unit, so the transient mismatch never reaches a deployed build.

**Files:**
- Modify: `apps/api/src/services/mnemonic.service.ts`
- Modify: `apps/api/src/routes/mnemonics.ts`

- [ ] **Step 1: Remove the refresh service methods**

In `mnemonic.service.ts`, DELETE `getDueForRefresh` (`:140-153`) and `dismissRefresh` (`:157-165`).

- [ ] **Step 2: Stop stamping `refreshPromptAt` in `saveMnemonic`**

REPLACE the private `saveMnemonic` (`:247-268`) — drop the refresh date entirely:

```ts
  private async saveMnemonic(data: {
    kanjiId: number
    userId: string | null
    type: 'system' | 'user'
    storyText: string
    imagePrompt: string | null
    latitude?: number
    longitude?: number
  }): Promise<MnemonicRecord> {
    const [row] = await this.db.insert(mnemonics).values(data).returning()
    return this.toRecord(row)
  }
```

- [ ] **Step 3: Stop clearing `refreshPromptAt` in `updateUserMnemonic`**

In `updateUserMnemonic` (`:107`), REPLACE:

```ts
    if (storyText !== undefined) { patch.storyText = storyText; patch.refreshPromptAt = null }
```

with:

```ts
    if (storyText !== undefined) patch.storyText = storyText
```

- [ ] **Step 4: Remove the refresh routes**

In `apps/api/src/routes/mnemonics.ts`, DELETE the `GET /refresh` route (`:123-131`) and the `POST /:id/refresh/dismiss` route (`:133-141`).

- [ ] **Step 5: Drop the now-unused imports**

In `mnemonic.service.ts`, `getDueForRefresh`/`dismissRefresh` are gone, so their imports are dead. REPLACE the import block top:

```ts
import { and, eq } from 'drizzle-orm'
```

(removing `isNull`, `lte`) and remove `MNEMONIC_REFRESH_DAYS` from the `@kanji-learn/shared` import — leaving `import { updateEffectiveness, EFFECTIVENESS_DEFAULT } from '@kanji-learn/shared'`.

- [ ] **Step 5b: Typecheck the api package (confirms no dangling refs)**

Run: `pnpm --filter @kanji-learn/api typecheck`
Expected: 0 errors. If `isNull`/`lte`/`MNEMONIC_REFRESH_DAYS` are still referenced anywhere, this fails — remove the reference.

- [ ] **Step 6: Run the full api test suite (nothing references the removed routes)**

Run: `pnpm --filter @kanji-learn/api test`
Expected: PASS (no test referenced the refresh routes; the new cocreation suite is green).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/mnemonic.service.ts apps/api/src/routes/mnemonics.ts
git commit -m "refactor(api): retire 30-day refresh nudge (superseded by effectiveness loop)

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@me.com>"
```

---

### Task 8: Retire the seed system + clone-rehearsed destructive cleanup

**Files:**
- Delete: `packages/db/src/seeds/seed-mnemonics.ts`
- Modify: `packages/db/package.json` (remove `seed:mnemonics`; fix the `seed` chain)
- Modify: `apps/api/src/services/mnemonic.service.ts` (remove `seedSystemMnemonic`)
- Create: `scripts/cleanup-old-mnemonics.mjs`
- Create: `docs/superpowers/runbooks/2026-06-01-phase5-data-cleanup.md`

- [ ] **Step 1: Remove `seedSystemMnemonic` from the service**

In `mnemonic.service.ts`, DELETE the `seedSystemMnemonic` method (`:169-184`).

- [ ] **Step 2: Delete the seed script + deregister it**

```bash
git rm packages/db/src/seeds/seed-mnemonics.ts
```

In `packages/db/package.json` `scripts`: DELETE the `"seed:mnemonics": …` line, and change the `seed` chain from:

```json
    "seed": "pnpm seed:kanji && pnpm seed:kanjidic2 && pnpm seed:mnemonics"
```

to:

```json
    "seed": "pnpm seed:kanji && pnpm seed:kanjidic2"
```

- [ ] **Step 3: Write the destructive cleanup script**

Create `scripts/cleanup-old-mnemonics.mjs` (modeled on `scripts/replay-srs-fsrs.mjs` — idempotent, `--dry-run` aware):

```js
#!/usr/bin/env node
// cleanup-old-mnemonics.mjs
// Phase 5 §10.5: discard ALL pre-Phase-5 mnemonic rows (system + user).
// Operator confirmed 2026-05-31. Nothing co-created has shipped, so this is
// effectively every current row. RUN ONLY AFTER a pg_dump safety dump (runbook).
//
// Usage:
//   node scripts/cleanup-old-mnemonics.mjs --dry-run   # count only
//   node scripts/cleanup-old-mnemonics.mjs             # delete

import postgres from 'postgres'

const DRY = process.argv.includes('--dry-run')
const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL required'); process.exit(1) }

const sql = postgres(url, { ssl: url.includes('sslmode=disable') ? false : 'require', max: 1 })

const [{ count }] = await sql`SELECT count(*)::int AS count FROM mnemonics`
console.log(`Found ${count} mnemonic rows.`)

if (DRY) {
  console.log('[dry-run] no rows deleted.')
} else {
  const deleted = await sql`DELETE FROM mnemonics RETURNING id`
  console.log(`✅ Deleted ${deleted.length} rows.`)
}

await sql.end()
process.exit(0)
```

- [ ] **Step 4: Write the runbook**

Create `docs/superpowers/runbooks/2026-06-01-phase5-data-cleanup.md`:

```markdown
# Phase 5 Data Cleanup Runbook (2026-06-01)

Applies: migration `0026_kanji_components.sql`, the KRADFILE component backfill,
and the destructive old-mnemonics cleanup. Follows the FSRS clone-rehearsal
pattern (docs/superpowers/runbooks/2026-05-22-fsrs-rollout.md).

## Order of operations (LIVE — only at the coordinated Phase 5 cut)

1. **Safety dump (reversible for 24h):**
   `pg_dump "$DATABASE_URL" -t mnemonics -t kanji > /tmp/phase5-safety/live-<ts>.sql`
2. **Apply the column migration:**
   `psql "$DATABASE_URL" -f packages/db/supabase/migrations/0026_kanji_components.sql`
3. **Backfill components:**
   `DATABASE_URL=<live> pnpm --filter @kanji-learn/db seed:backfill-components`
   Spot-check: `psql "$DATABASE_URL" -c "SELECT components FROM kanji WHERE character='持'"` → contains 扌 and 寺.
4. **Dry-run the cleanup:** `node scripts/cleanup-old-mnemonics.mjs --dry-run` → sanity-check the count.
5. **Destructive cleanup:** `node scripts/cleanup-old-mnemonics.mjs` → deletes all mnemonic rows.
6. **Smoke:** API `/health` 200; create one co-created hook on the RAD account; confirm it persists with `generation_method='cocreated'`.

## Clone-rehearsal (BEFORE merge — mandatory)

Restore a fresh `pg_dump` of live into a local Docker Postgres, run steps 2–5 against it,
confirm: components populated, all old rows gone, a fresh co-created insert round-trips.

## Rollback

Restore the safety dump within 24h: `psql "$DATABASE_URL" < /tmp/phase5-safety/live-<ts>.sql`.
```

- [ ] **Step 5: Typecheck + test (confirm nothing referenced the removed seed)**

Run: `pnpm --filter @kanji-learn/api typecheck && pnpm --filter @kanji-learn/db typecheck`
Expected: 0 errors.

Run: `pnpm --filter @kanji-learn/api test`
Expected: PASS.

- [ ] **Step 6: Clone-rehearse the cleanup (against a clone, not live)**

```bash
# DATABASE_URL pointed at the local clone (already has 0026 + components from Task 3 Step 7)
node scripts/cleanup-old-mnemonics.mjs --dry-run   # prints the count
node scripts/cleanup-old-mnemonics.mjs             # deletes
psql "$DATABASE_URL" -c "SELECT count(*) FROM mnemonics"  # expect 0
```

- [ ] **Step 7: Commit**

```bash
git add packages/db/package.json apps/api/src/services/mnemonic.service.ts scripts/cleanup-old-mnemonics.mjs docs/superpowers/runbooks/2026-06-01-phase5-data-cleanup.md
git rm --cached packages/db/src/seeds/seed-mnemonics.ts 2>/dev/null || true
git commit -m "chore(db): retire system-mnemonic seed; add clone-rehearsed Phase 5 cleanup + runbook

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@me.com>"
```

---

### Task 9: Full-package verification sweep

- [ ] **Step 1: Workspace typecheck**

Run: `pnpm --filter @kanji-learn/shared typecheck && pnpm --filter @kanji-learn/db typecheck && pnpm --filter @kanji-learn/api typecheck`
Expected: 0 errors across all three.

- [ ] **Step 2: Shared + api test suites**

Run: `pnpm --filter @kanji-learn/shared test && pnpm --filter @kanji-learn/api test`
Expected: shared green (incl. Task 1's CoCreationContext test); api green (incl. the 5 cocreation tests).

- [ ] **Step 3: Confirm the cloud-assembly endpoint is registered in production wiring**

Run: `grep -rn "mnemonicRoutes" apps/api/src/server.ts`
Expected: the existing registration is unchanged and still mounts under `/v1/mnemonics` (the new routes ride the same prefix; no opts passed → service self-constructs).

- [ ] **Step 4: Final commit if any sweep fix was needed** (otherwise skip)

```bash
git add -A
git commit -m "chore: Phase 5 data/API verification sweep

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@me.com>"
```

---

## Self-Review

**Spec coverage (this plan's slice):**
- §7.1 KRADFILE component enrichment (operator-approved v1) → Task 2 (column) + Task 3 (backfill) ✓
- §7.3 cloud tier (adapt Anthropic capability; fall back on error) → Task 4 ✓
- §10.1 extended `cocreation_context` `$type` (layers/layerCount/locationName/components/generatedBy/mnemonicQuizDueAt/timeOfDay) → Task 1 (shared type) + Task 2 (schema mirror) ✓
- §10.2 keep/adapt cloud capability, drop auto-gen UX (server keeps `/generate`; mobile UX removed in Plan 4) → Task 4 (kept), noted ✓
- §10.3 thin persistence (`getForKanji`/`saveUserMnemonic`/`update`/`delete` retained; `saveCoCreatedMnemonic` added) → Task 5 ✓
- §10.4 retire 30-day refresh nudge → Task 7 ✓
- §10.5 destructive cleanup behind safety dump, clone-rehearsed → Task 8 ✓
- §6.1 effectiveness EMA from outcome → Task 6 (uses shared `updateEffectiveness`) ✓
- §6.3 deepen = additive + reset score, keep count → Task 6 ✓
- §13 api integration tests (persistence round-trip guarding jsonb double-encoding; assemble assembles + falls back on error; effectiveness update; cleanup clone-rehearsal) → Tasks 4–6, 8 ✓

**Out of scope (later plans), with the one forward dependency called out:**
- **Plan 3 prerequisite:** the kanji read API (`apps/api/src/routes/kanji.ts`) must surface the new `kanji.components` field so the mobile teaching beat can render it. Deferred to Plan 3 (which explores `kanji.ts` during its own recon) rather than guessing that route's internals here. **Do not lose this** — it is recorded in memory `project-phase5-status`.
- Mobile removal of `useRefreshDue` / `MnemonicNudgeSheet` (callers of the now-deleted refresh routes) → Plan 4.
- The `mnemonic_recall` quiz, the `CoCreationSession` state machine, the three-tier cascade client wiring, surfacing → Plans 3–4.
- Live application of `0026` + backfill + cleanup → executed at the coordinated Phase 5 cut per the runbook, not during plan execution (clone-rehearsal IS part of execution).

**Placeholder scan:** none. Every step has runnable code/commands. The KRADFILE URL + EUC-JP decode are concrete; if the EDRDG path drifts at execution time that is a one-line fix, not an unscoped TODO. The data backfill is verified by clone-rehearsal + spot-check (the repo convention for `backfill-*` scripts), with the pure parser unit-tested.

**Type consistency:** `CoCreationContext` / `CoCreationLayer` are defined once in `packages/shared/src/mnemonics/types.ts` (Task 1), imported by the api service (Tasks 4–6), mirrored inline in `schema.ts` with a pointer comment (Task 2, because packages/db has no shared dep), and validated by `contextSchema`/`layerSchema` in the routes (Task 5). `AssemblerSlots` is the Plan 1 shared type reused by `assembleFromSlots` + `assembleSchema`. `MnemonicRecord` is extended once (Task 5) and every method returns it. Method names — `assembleFromSlots`, `saveCoCreatedMnemonic`, `recordOutcome`, `applyDeepen` — match across service + routes + tests. The injected `AnthropicLike` seam (Task 4) is the same type the constructor accepts and the tests supply.

---

## Plan sequence (for continuity)

This is **Plan 2 of 4** for Phase 5:
1. **Foundation** — shared pure logic + dictionary. ✅ MERGED (`d78ad1f`).
2. **Data & API (this plan)** — `cocreation_context` `$type`, `kanji.components` + KRADFILE backfill, cloud-assembly endpoint, co-created persistence + effectiveness/deepen, retire refresh/seed, clone-rehearsed cleanup.
3. **Mobile co-creation flow** — `CoCreationSession` machine (the type exists at `buddy-types.ts:230`), reverse-geocode reuse, three-tier cascade wiring (cloud-first this phase), Apple Foundation Models native module (verify a community Expo wrapper first), **and expose `kanji.components` in the kanji read API** (the forward dependency above).
4. **Quiz, reinforce/deepen & surfacing** — `mnemonic_recall` quiz item + session insertion + immediate quick-check; end-of-session reinforce/deepen UI; `MnemonicCard`/kanji-detail/flashcard surfaces; "Mnemonic coaching" toggle + 7-day cooldown; remove the old refresh-nudge mobile callers; offline save/sync.
