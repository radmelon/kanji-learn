# Phase 5 — Mobile Co-Creation Flow (Plan 3b of Phase 5)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. The API + pure-logic tasks (1–5) are subagent-TDD-executable; the sheet UI + wiring (6–8) are React-Native screens best verified on-device (operator's iPhone 15 Pro), with the agent guiding. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the **create** half of the contextual mnemonic co-creation feature on-device: at Session Complete, Buddy offers to build a memory hook for the single worst chronically-slipping kanji; the learner answers one anchor question; the app assembles a story via the **cloud → on-device → template** cascade, shows it, and persists it. Plus the manual "Build a hook" entry from kanji detail (cold-start). Reinforce/deepen, the quiz, and the broader surfacing are Plan 4.

**Architecture:** The mobile app owns the whole flow (the API is the thin Plan-2 persistence + the cloud-assembly endpoint). A `useCoCreation` reducer hook drives the `CoCreationSession` stages (`consent → location_inference → detail_elicitation → assembly → commitment`, already typed in `@kanji-learn/shared`). Pure helpers (`buildSlots`, `buildContext`, the `assembleStory` cascade) live in `apps/mobile/src/mnemonics/` and are unit-tested. The UI is one multi-step Modal sheet matching the existing `MnemonicNudgeSheet` pattern. The trigger reuses the shared `pickBuddyMomentAction`.

**Tech Stack:** Expo SDK 54 (New Arch — see Plan 3a), TypeScript, the mobile `api` client (`apps/mobile/src/lib/api.ts`), `expo-location`, vitest/jest. Shared helpers from `@kanji-learn/shared`: `pickBuddyMomentAction`, `ReviewedCard`, `assembleTemplate`, `lookupComponents`, `AssemblerSlots`, `CoCreationContext`, `CoCreationSession`, `buildAssemblyPrompt`.

**Spec:** [docs/superpowers/specs/2026-05-31-phase-5-mnemonic-cocreation-design.md](../specs/2026-05-31-phase-5-mnemonic-cocreation-design.md) §3 (client-owned flow), §4 (post-session moment + create flow stages), §5 (adaptive elicitation), §7 (cascade), §9.1 (kanji-detail manual entry), §11 (consent/offline).

**Depends on:**
- **Plan 2 (merged):** `POST /v1/mnemonics/assemble`, `POST /:kanjiId/cocreated`; `kanji.components` column.
- **Plan 3a:** `apps/mobile/src/mnemonics/assembleOnDevice.ts` (the on-device seam) + `buildAssemblyPrompt`/`COCREATION_SYSTEM_PROMPT` in shared. Execute 3a Tasks 1 & 4 before Task 3 here (or temporarily stub `assembleOnDevice` to throw).

**Out of scope (Plan 4):** reinforce/deepen UI, the `mnemonic_recall` quiz, `MnemonicCard`/flashcard surfacing, the "Mnemonic coaching" toggle + 7-day cooldown persistence, removing the old refresh-nudge mobile callers.

---

## File Structure

```
apps/api/src/routes/kanji.ts                       # expose kanji.components
apps/api/src/services/mnemonic.service.ts          # getBuddyMomentContext
apps/api/src/routes/mnemonics.ts                   # POST /buddy-moment-context
apps/api/test/integration/mnemonic-cocreation.test.ts  # + context endpoint test

apps/mobile/src/mnemonics/assembleStory.ts         # cloud→on-device→template cascade
apps/mobile/src/mnemonics/assembleStory.test.ts
apps/mobile/src/mnemonics/buildSlots.ts            # kanji + answers + place → AssemblerSlots & CoCreationContext
apps/mobile/src/mnemonics/buildSlots.test.ts
apps/mobile/src/mnemonics/locationName.ts          # coords → reverse-geocoded place name (text fallback)
apps/mobile/src/mnemonics/useCoCreation.ts         # the CoCreationSession reducer/state machine
apps/mobile/src/mnemonics/useCoCreation.test.ts
apps/mobile/src/mnemonics/cocreationApi.ts         # thin typed wrappers over the Plan 2 endpoints
apps/mobile/src/components/mnemonics/CoCreationSheet.tsx   # the multi-step Modal sheet
apps/mobile/app/(tabs)/study.tsx                   # post-session Buddy moment wiring
apps/mobile/app/kanji/[id].tsx                     # manual "Build a hook" entry
```

---

### Task 1: Expose `kanji.components` in the kanji read API (TDD)

The teaching beat + slot assembly need each kanji's `components` (`string[]`, the IDS decomposition from Plan 2). The `GET /v1/kanji/:id` route currently returns `radicals` but not `components` (Plan 2 deferred this).

**Files:**
- Modify: `apps/api/src/routes/kanji.ts`
- Test: `apps/api/test/integration/` (add or extend a kanji-route test)

- [ ] **Step 1: Write the failing test**

Add an integration test that asserts the kanji payload includes `components`. Mirror the existing kanji-route test harness if one exists; otherwise add `apps/api/test/integration/kanji-components.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { buildTestApp } from '../helpers/test-app'
import { kanjiRoutes } from '../../src/routes/kanji'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const USER = '00000000-0000-0000-0000-0000000ca501'

afterAll(async () => { await client.end() })

describe('GET /v1/kanji/:id', () => {
  let id: number
  beforeAll(async () => {
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
    await db.insert(schema.userProfiles).values({ id: USER, displayName: 'K', timezone: 'UTC' })
    const [k] = await db.select({ id: schema.kanji.id }).from(schema.kanji).limit(1)
    id = k.id
    await db.update(schema.kanji).set({ components: ['扌', '寺'] as unknown as string[] }).where(sql`id = ${id}`)
  })
  it('returns the components array', async () => {
    const app = await buildTestApp({ plugin: kanjiRoutes, opts: { prefix: '/v1/kanji' } })
    const res = await app.inject({ method: 'GET', url: `/v1/kanji/${id}`, headers: { 'x-test-user-id': USER } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.components).toEqual(['扌', '寺'])
    await app.close()
  })
})
```

> Verify the real route plugin export name + prefix (`kanjiRoutes` / `/v1/kanji`) and the auth requirement; adapt the import/headers to match the existing kanji route. If a kanji-route integration test already exists, extend it instead of creating a new file.

- [ ] **Step 2: Run → FAIL** (`data.components` is `undefined`).

- [ ] **Step 3: Implement — mirror the `radicals` field exactly**

In `apps/api/src/routes/kanji.ts` (GET `/:id` handler, ~lines 205–265 per recon): wherever `radicals: kanji.radicals` appears in the `.select({...})`, add `components: kanji.components`; and wherever the response object maps `radicals` (via the `toArr<...>()` helper this route uses for jsonb arrays), add the parallel `components: toArr<string>(row.components)`. Follow the `radicals` field's exact pattern — same helper, same place.

- [ ] **Step 4: Run → PASS.** Then `pnpm --filter @kanji-learn/api typecheck` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/kanji.ts apps/api/test/integration/kanji-components.test.ts
git commit -m "feat(api): expose kanji.components in the kanji read route (Phase 5 teaching beat)

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@me.com>
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Buddy-moment context endpoint (TDD)

At Session Complete the client has graded `kanjiId`s but not their lifetime `lapses` or whether a co-created hook exists. `pickBuddyMomentAction` needs both. Add one batch endpoint.

**Files:**
- Modify: `apps/api/src/services/mnemonic.service.ts`
- Modify: `apps/api/src/routes/mnemonics.ts`
- Test: `apps/api/test/integration/mnemonic-cocreation.test.ts`

- [ ] **Step 1: Add the service method**

In `mnemonic.service.ts`, add (importing `userKanjiProgress` from `@kanji-learn/db` alongside the existing `mnemonics, kanji` import, and `inArray` from `drizzle-orm`):

```ts
export interface BuddyMomentCard {
  kanjiId: number
  kanji: string
  lapses: number
  hasHook: boolean
}

/** Per-kanji signals the post-session Buddy moment needs: lifetime lapses +
 *  whether a co-created hook already exists. */
async getBuddyMomentContext(userId: string, kanjiIds: number[]): Promise<BuddyMomentCard[]> {
  if (kanjiIds.length === 0) return []
  const [chars, progress, hooks] = await Promise.all([
    this.db.select({ id: kanji.id, character: kanji.character }).from(kanji).where(inArray(kanji.id, kanjiIds)),
    this.db.select({ kanjiId: userKanjiProgress.kanjiId, lapses: userKanjiProgress.lapses })
      .from(userKanjiProgress)
      .where(and(eq(userKanjiProgress.userId, userId), inArray(userKanjiProgress.kanjiId, kanjiIds))),
    this.db.select({ kanjiId: mnemonics.kanjiId })
      .from(mnemonics)
      .where(and(eq(mnemonics.userId, userId), inArray(mnemonics.kanjiId, kanjiIds), eq(mnemonics.generationMethod, 'cocreated'))),
  ])
  const lapseBy = new Map(progress.map((p) => [p.kanjiId, p.lapses]))
  const hookSet = new Set(hooks.map((h) => h.kanjiId))
  return chars.map((c) => ({
    kanjiId: c.id,
    kanji: c.character,
    lapses: lapseBy.get(c.id) ?? 0,
    hasHook: hookSet.has(c.id),
  }))
}
```

> Confirm `userKanjiProgress.lapses` exists (added by the FSRS migration, Spec 1.5). If the column is named differently, use the real name.

- [ ] **Step 2: Add the route**

In `apps/api/src/routes/mnemonics.ts`, add a schema + route (after the `/deepen` route):

```ts
const buddyContextSchema = z.object({ kanjiIds: z.array(z.number().int().positive()).max(100) })

  // POST /v1/mnemonics/buddy-moment-context — lapses + hasHook for graded kanji
  server.post(
    '/buddy-moment-context',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const body = buddyContextSchema.safeParse(req.body)
      if (!body.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
      }
      const data = await service.getBuddyMomentContext(req.userId!, body.data.kanjiIds)
      return reply.send({ ok: true, data })
    }
  )
```

- [ ] **Step 3: Write the failing test**

Append to `mnemonic-cocreation.test.ts` (reuses `USER`, `db`, the helpers). Seed a `user_kanji_progress` row with a known `lapses` and confirm the co-created row from the earlier cocreated test makes `hasHook` true:

```ts
describe('POST /v1/mnemonics/buddy-moment-context', () => {
  let kanjiId: number
  beforeAll(async () => {
    const [row] = await db.select().from(mnemonics).where(eq(mnemonics.userId, USER))
    kanjiId = row.kanjiId // the kanji with a co-created hook from the cocreated test
    await db.execute(sql`DELETE FROM user_kanji_progress WHERE user_id = ${USER} AND kanji_id = ${kanjiId}`)
    // Insert a progress row with lapses=4 (fields beyond these use table defaults; adapt to NOT NULL columns).
    await db.insert(schema.userKanjiProgress).values({ userId: USER, kanjiId, lapses: 4 } as any)
  })
  it('returns lapses + hasHook=true for a hooked, lapsing kanji', async () => {
    const app = await buildTestApp({ plugin: mnemonicRoutes, opts: { prefix: '/v1/mnemonics' } })
    const res = await app.inject({
      method: 'POST', url: '/v1/mnemonics/buddy-moment-context',
      headers: { 'x-test-user-id': USER }, payload: { kanjiIds: [kanjiId] },
    })
    expect(res.statusCode).toBe(200)
    const card = res.json().data[0]
    expect(card).toMatchObject({ kanjiId, lapses: 4, hasHook: true })
    expect(typeof card.kanji).toBe('string')
    await app.close()
  })
})
```

> `user_kanji_progress` has NOT-NULL FSRS columns (stability/difficulty/status/etc.). The `.values({...} as any)` insert must satisfy them — fill required columns with valid defaults (read the schema). If that's fiddly, instead set `lapses` via an UPDATE on an existing progress row for `USER`, or assert `lapses: 0` (the `?? 0` fallback) and only pin `hasHook`. Keep the test deterministic.

- [ ] **Step 4: Run → PASS** (the cocreation test file now has 6). Typecheck 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/mnemonic.service.ts apps/api/src/routes/mnemonics.ts apps/api/test/integration/mnemonic-cocreation.test.ts
git commit -m "feat(api): buddy-moment-context endpoint (batch lapses + hasHook for the trigger)

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@me.com>
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: The assembly cascade `assembleStory` (mobile, TDD with mocks)

**Files:**
- Create: `apps/mobile/src/mnemonics/cocreationApi.ts`
- Create: `apps/mobile/src/mnemonics/assembleStory.ts`
- Create: `apps/mobile/src/mnemonics/assembleStory.test.ts`

- [ ] **Step 1: Thin typed API wrappers**

```ts
// apps/mobile/src/mnemonics/cocreationApi.ts
import { api } from '../lib/api'
import type { AssemblerSlots, CoCreationContext, ReviewedCard } from '@kanji-learn/shared'

export const assembleCloud = (slots: AssemblerSlots) =>
  api.post<{ storyText: string; generatedBy: 'cloud' }>('/v1/mnemonics/assemble', slots)

export const saveCoCreated = (
  kanjiId: number,
  payload: { storyText: string; context: CoCreationContext; latitude?: number; longitude?: number },
) => api.post<{ id: string }>(`/v1/mnemonics/${kanjiId}/cocreated`, payload)

export const fetchBuddyMomentContext = (kanjiIds: number[]) =>
  api.post<Array<Pick<ReviewedCard, 'kanjiId' | 'kanji' | 'lapses' | 'hasHook'>>>(
    '/v1/mnemonics/buddy-moment-context', { kanjiIds },
  )
```

> Confirm the `api` client's method shape (`api.post<T>(path, body) => Promise<T>` unwrapping `{ ok, data }`) from `apps/mobile/src/lib/api.ts` and adapt if the import is a default vs named export.

- [ ] **Step 2: Write the failing cascade test**

```ts
// apps/mobile/src/mnemonics/assembleStory.test.ts
import { assembleStory } from './assembleStory'

jest.mock('./cocreationApi', () => ({ assembleCloud: jest.fn() }))
jest.mock('./assembleOnDevice', () => ({
  assembleOnDevice: jest.fn(),
  OnDeviceUnavailableError: class extends Error {},
}))
import { assembleCloud } from './cocreationApi'
import { assembleOnDevice } from './assembleOnDevice'
const cloud = assembleCloud as jest.Mock
const onDevice = assembleOnDevice as jest.Mock

const slots = {
  kanji: '持', kanjiMeaning: 'hold', reading: 'もつ',
  components: [{ char: '扌', name: 'tehen', meaning: 'hand', imageKeyword: 'a hand grasping' }],
  locationName: 'Beppu Station', anchor: 'a yellow vending machine',
}

afterEach(() => { cloud.mockReset(); onDevice.mockReset() })

describe('assembleStory (cloud-first testing-phase order)', () => {
  it('uses cloud when it succeeds', async () => {
    cloud.mockResolvedValue({ storyText: 'cloud story', generatedBy: 'cloud' })
    await expect(assembleStory(slots)).resolves.toEqual({ storyText: 'cloud story', generatedBy: 'cloud' })
    expect(onDevice).not.toHaveBeenCalled()
  })
  it('falls to on-device when cloud throws', async () => {
    cloud.mockRejectedValue(new Error('network'))
    onDevice.mockResolvedValue('device story')
    await expect(assembleStory(slots)).resolves.toEqual({ storyText: 'device story', generatedBy: 'on_device' })
  })
  it('falls to the template when cloud AND on-device fail', async () => {
    cloud.mockRejectedValue(new Error('network'))
    onDevice.mockRejectedValue(new Error('unavailable'))
    const res = await assembleStory(slots)
    expect(res.generatedBy).toBe('template')
    expect(res.storyText).toContain('Beppu Station') // the shared template asserts the slots
  })
})
```

- [ ] **Step 3: Implement the cascade**

```ts
// apps/mobile/src/mnemonics/assembleStory.ts
import { assembleTemplate, type AssemblerSlots, type AssemblyTier } from '@kanji-learn/shared'
import { assembleCloud } from './cocreationApi'
import { assembleOnDevice } from './assembleOnDevice'

export interface AssembledStory { storyText: string; generatedBy: AssemblyTier }

/**
 * Cloud → on-device → template. Cloud-first during the testing phase
 * (operator absorbs cost). Each tier falls through on any error; the
 * template always succeeds (pure, offline). See spec §7.3.
 */
export async function assembleStory(slots: AssemblerSlots): Promise<AssembledStory> {
  try {
    const r = await assembleCloud(slots)
    if (r?.storyText?.trim()) return { storyText: r.storyText.trim(), generatedBy: 'cloud' }
  } catch { /* fall through */ }
  try {
    const text = await assembleOnDevice(slots)
    if (text?.trim()) return { storyText: text.trim(), generatedBy: 'on_device' }
  } catch { /* fall through */ }
  return { storyText: assembleTemplate(slots), generatedBy: 'template' }
}
```

> Pre-launch note (spec §7.3 / memory `project_testing_phase_flags`): keyless users must flip to on-device-first before public release. Leave a `// PRE-LAUNCH: reorder for keyless users` comment at the top of `assembleStory`.

- [ ] **Step 4: Run the mobile test → PASS (3).** (Confirm the mobile jest harness per Plan 3a Task 4's note.)

- [ ] **Step 5: Commit** (both co-author lines).

---

### Task 4: Slot + context builders (mobile, pure, TDD)

**Files:**
- Create: `apps/mobile/src/mnemonics/buildSlots.ts`
- Create: `apps/mobile/src/mnemonics/buildSlots.test.ts`

These turn a kanji payload + the learner's answers + a place name into the `AssemblerSlots` (for assembly) and the `CoCreationContext` (for persistence).

- [ ] **Step 1: Failing test**

```ts
// apps/mobile/src/mnemonics/buildSlots.test.ts
import { buildSlots, buildContext } from './buildSlots'

const kanji = { character: '持', meanings: ['hold', 'have'], kunReadings: ['も.つ'], onReadings: ['ジ'], components: ['扌', '寺'] }
const answers = { anchor: 'a yellow vending machine', locationName: 'Beppu Station' }

describe('buildSlots', () => {
  it('maps components through the shared dictionary and picks meaning + kana reading', () => {
    const s = buildSlots(kanji, answers)
    expect(s.kanji).toBe('持')
    expect(s.kanjiMeaning).toBe('hold')
    expect(s.reading).toBe('もつ')               // kun reading, dots stripped → kana
    expect(s.components.map((c) => c.char)).toEqual(['扌', '寺'])
    expect(s.components[0].meaning).toBe('hand') // from the shared RADICAL_DICTIONARY
    expect(s.locationName).toBe('Beppu Station')
    expect(s.anchor).toBe('a yellow vending machine')
  })
  it('degrades to on-reading kana when there is no kun reading', () => {
    expect(buildSlots({ ...kanji, kunReadings: [] }, answers).reading).toBe('ジ')
  })
})

describe('buildContext', () => {
  it('produces a single environment layer + components + generatedBy + a quiz-due stamp', () => {
    const ctx = buildContext(kanji, answers, 'cloud', '2026-06-03T00:00:00.000Z')
    expect(ctx.layerCount).toBe(1)
    expect(ctx.layers[0].source).toBe('environment')
    expect(ctx.layers[0].anchor).toBe('a yellow vending machine')
    expect(ctx.components).toEqual([{ char: '扌', meaning: 'hand' }, { char: '寺', meaning: 'temple' }])
    expect(ctx.generatedBy).toBe('cloud')
    expect(ctx.locationName).toBe('Beppu Station')
    expect(ctx.mnemonicQuizDueAt).toBe('2026-06-03T00:00:00.000Z')
  })
})
```

- [ ] **Step 2: Implement**

```ts
// apps/mobile/src/mnemonics/buildSlots.ts
import { lookupComponents, type AssemblerSlots, type CoCreationContext, type AssemblyTier } from '@kanji-learn/shared'

export interface KanjiForHook {
  character: string
  meanings: string[]
  kunReadings: string[]
  onReadings: string[]
  components: string[]
}
export interface HookAnswers {
  anchor: string
  locationName: string
  personalDetail?: string
  readingPlay?: string
}

/** kun reading like "も.つ" → kana "もつ"; falls back to the first on-reading. */
function pickReading(k: KanjiForHook): string {
  const kun = k.kunReadings[0]
  if (kun) return kun.replace(/[.\-・]/g, '')
  return k.onReadings[0] ?? ''
}

export function buildSlots(k: KanjiForHook, a: HookAnswers): AssemblerSlots {
  return {
    kanji: k.character,
    kanjiMeaning: k.meanings[0] ?? '',
    reading: pickReading(k),
    components: lookupComponents(k.components),
    locationName: a.locationName,
    anchor: a.anchor,
    personalDetail: a.personalDetail,
    readingPlay: a.readingPlay,
  }
}

export function buildContext(
  k: KanjiForHook,
  a: HookAnswers,
  generatedBy: AssemblyTier,
  quizDueAtIso: string,
): CoCreationContext {
  const mapped = lookupComponents(k.components).map((c) => ({ char: c.char, meaning: c.meaning }))
  const questions = ['Look around — what is one thing that catches your eye?']
  const answers = [a.anchor]
  if (a.personalDetail) { questions.push('A personal detail?'); answers.push(a.personalDetail) }
  if (a.readingPlay) { questions.push('A sound for the reading?'); answers.push(a.readingPlay) }
  return {
    layers: [{ questions, answers, anchor: a.anchor, source: 'environment' }],
    layerCount: 1,
    locationName: a.locationName,
    components: mapped,
    generatedBy,
    mnemonicQuizDueAt: quizDueAtIso,
  }
}
```

- [ ] **Step 3: Run → PASS.** **Step 4: Commit** (both co-author lines).

---

### Task 5: `useCoCreation` state machine (mobile reducer, TDD)

The hook drives the `CoCreationSession` stages, performs assembly + persistence, and exposes a flat state the sheet renders. The reducer transitions are unit-tested; the async effects (assemble/save/geocode) are injected so they're mockable.

**Files:**
- Create: `apps/mobile/src/mnemonics/locationName.ts`
- Create: `apps/mobile/src/mnemonics/useCoCreation.ts`
- Create: `apps/mobile/src/mnemonics/useCoCreation.test.ts`

- [ ] **Step 1: Location-name helper**

```ts
// apps/mobile/src/mnemonics/locationName.ts
import * as Location from 'expo-location'
import { tryGetCoordsForCapture } from '../utils/location'

export interface PlaceResult { name: string; latitude?: number; longitude?: number }

/** Foreground coords → reverse-geocoded place name. Returns null if location
 *  is unavailable/denied so the flow falls back to a text question. Never throws. */
export async function getPlaceName(): Promise<PlaceResult | null> {
  const coords = await tryGetCoordsForCapture()
  if (!coords) return null
  try {
    const [place] = await Location.reverseGeocodeAsync({ latitude: coords.lat, longitude: coords.lon })
    const name = place?.city || place?.district || place?.region || place?.country
    if (!name) return null
    return { name, latitude: coords.lat, longitude: coords.lon }
  } catch {
    return null
  }
}
```

> `tryGetCoordsForCapture()` returns `{ lat, lon, accuracy? } | null` (`apps/mobile/src/utils/location.ts`); the reverse-geocode mirrors `MnemonicCard.tsx`.

- [ ] **Step 2: Failing reducer test** — assert the stage transitions and that committing assembles+saves. Inject fake `assemble`/`save`/`getPlace` so no network/native is needed:

```ts
// apps/mobile/src/mnemonics/useCoCreation.test.ts
import { coCreationReducer, initialCoCreation, type CoCreationDeps } from './useCoCreation'

const kanji = { character: '持', meanings: ['hold'], kunReadings: ['も.つ'], onReadings: ['ジ'], components: ['扌', '寺'] }

describe('coCreationReducer', () => {
  it('starts at consent', () => {
    expect(initialCoCreation(kanji).stage).toBe('consent')
  })
  it('accept → location_inference', () => {
    const s = coCreationReducer(initialCoCreation(kanji), { type: 'ACCEPT' })
    expect(s.stage).toBe('location_inference')
  })
  it('LOCATION_SET → detail_elicitation with the place name', () => {
    let s = coCreationReducer(initialCoCreation(kanji), { type: 'ACCEPT' })
    s = coCreationReducer(s, { type: 'LOCATION_SET', name: 'Beppu Station', latitude: 33.2, longitude: 131.5 })
    expect(s.stage).toBe('detail_elicitation')
    expect(s.locationName).toBe('Beppu Station')
  })
  it('ANCHOR_SET → assembly, DRAFT_READY stores the story + tier', () => {
    let s = coCreationReducer(initialCoCreation(kanji), { type: 'ACCEPT' })
    s = coCreationReducer(s, { type: 'LOCATION_SET', name: 'Beppu Station' })
    s = coCreationReducer(s, { type: 'ANCHOR_SET', anchor: 'a yellow vending machine' })
    expect(s.stage).toBe('assembly')
    s = coCreationReducer(s, { type: 'DRAFT_READY', storyText: 'a story', generatedBy: 'cloud' })
    expect(s.draft).toBe('a story')
    expect(s.generatedBy).toBe('cloud')
  })
  it('COMMITTED → commitment stage with the saved id', () => {
    const base = { ...initialCoCreation(kanji), stage: 'assembly' as const, draft: 'x', generatedBy: 'cloud' as const }
    expect(coCreationReducer(base, { type: 'COMMITTED', mnemonicId: 'abc' }).stage).toBe('commitment')
  })
})
```

- [ ] **Step 3: Implement the reducer + hook**

```ts
// apps/mobile/src/mnemonics/useCoCreation.ts
import { useReducer, useCallback } from 'react'
import type { AssemblyTier } from '@kanji-learn/shared'
import { buildSlots, buildContext, type KanjiForHook, type HookAnswers } from './buildSlots'
import { assembleStory } from './assembleStory'
import { saveCoCreated } from './cocreationApi'
import { getPlaceName } from './locationName'

type Stage = 'consent' | 'location_inference' | 'detail_elicitation' | 'assembly' | 'commitment'

export interface CoCreationState {
  kanji: KanjiForHook
  stage: Stage
  locationName?: string
  latitude?: number
  longitude?: number
  anchor?: string
  personalDetail?: string
  readingPlay?: string
  draft?: string
  generatedBy?: AssemblyTier
  mnemonicId?: string
  assembling: boolean
  saving: boolean
  error?: string
}

type Action =
  | { type: 'ACCEPT' }
  | { type: 'LOCATION_SET'; name: string; latitude?: number; longitude?: number }
  | { type: 'LOCATION_TEXT'; name: string }
  | { type: 'ANCHOR_SET'; anchor: string }
  | { type: 'ASSEMBLING' }
  | { type: 'DRAFT_READY'; storyText: string; generatedBy: AssemblyTier }
  | { type: 'STICKIER'; personalDetail?: string; readingPlay?: string }
  | { type: 'SAVING' }
  | { type: 'COMMITTED'; mnemonicId: string }
  | { type: 'ERROR'; message: string }

export const initialCoCreation = (kanji: KanjiForHook): CoCreationState => ({
  kanji, stage: 'consent', assembling: false, saving: false,
})

export function coCreationReducer(s: CoCreationState, a: Action): CoCreationState {
  switch (a.type) {
    case 'ACCEPT': return { ...s, stage: 'location_inference' }
    case 'LOCATION_SET': return { ...s, stage: 'detail_elicitation', locationName: a.name, latitude: a.latitude, longitude: a.longitude }
    case 'LOCATION_TEXT': return { ...s, stage: 'detail_elicitation', locationName: a.name }
    case 'ANCHOR_SET': return { ...s, stage: 'assembly', anchor: a.anchor }
    case 'ASSEMBLING': return { ...s, assembling: true, error: undefined }
    case 'DRAFT_READY': return { ...s, assembling: false, draft: a.storyText, generatedBy: a.generatedBy }
    case 'STICKIER': return { ...s, personalDetail: a.personalDetail ?? s.personalDetail, readingPlay: a.readingPlay ?? s.readingPlay }
    case 'SAVING': return { ...s, saving: true, error: undefined }
    case 'COMMITTED': return { ...s, saving: false, stage: 'commitment', mnemonicId: a.mnemonicId }
    case 'ERROR': return { ...s, assembling: false, saving: false, error: a.message }
    default: return s
  }
}

/** Dependency seams so the reducer's async effects are mockable in tests. */
export interface CoCreationDeps {
  assemble: typeof assembleStory
  save: typeof saveCoCreated
  getPlace: typeof getPlaceName
  nowIso: () => string
}
const defaultDeps: CoCreationDeps = { assemble: assembleStory, save: saveCoCreated, getPlace: getPlaceName, nowIso: () => new Date().toISOString() }

export function useCoCreation(kanji: KanjiForHook, deps: CoCreationDeps = defaultDeps) {
  const [state, dispatch] = useReducer(coCreationReducer, kanji, initialCoCreation)

  const accept = useCallback(async () => {
    dispatch({ type: 'ACCEPT' })
    const place = await deps.getPlace()
    if (place) dispatch({ type: 'LOCATION_SET', name: place.name, latitude: place.latitude, longitude: place.longitude })
    // else: stay in location_inference; the sheet shows the "Where are you?" text input → LOCATION_TEXT
  }, [deps])

  const setLocationText = useCallback((name: string) => dispatch({ type: 'LOCATION_TEXT', name }), [])

  const submitAnchor = useCallback(async (anchor: string, extra?: { personalDetail?: string; readingPlay?: string }) => {
    dispatch({ type: 'ANCHOR_SET', anchor })
    if (extra) dispatch({ type: 'STICKIER', ...extra })
    dispatch({ type: 'ASSEMBLING' })
    try {
      const a: HookAnswers = { anchor, locationName: state.locationName ?? 'where you are', personalDetail: extra?.personalDetail, readingPlay: extra?.readingPlay }
      const { storyText, generatedBy } = await deps.assemble(buildSlots(kanji, a))
      dispatch({ type: 'DRAFT_READY', storyText, generatedBy })
    } catch (e) {
      dispatch({ type: 'ERROR', message: String(e) })
    }
  }, [deps, kanji, state.locationName])

  const commit = useCallback(async () => {
    if (!state.draft || !state.generatedBy || !state.anchor) return
    dispatch({ type: 'SAVING' })
    try {
      const answers: HookAnswers = { anchor: state.anchor, locationName: state.locationName ?? 'where you are', personalDetail: state.personalDetail, readingPlay: state.readingPlay }
      const ctx = buildContext(kanji, answers, state.generatedBy, deps.nowIso())
      const saved = await deps.save(kanjiId(kanji, state), { storyText: state.draft, context: ctx, latitude: state.latitude, longitude: state.longitude })
      dispatch({ type: 'COMMITTED', mnemonicId: saved.id })
    } catch (e) {
      dispatch({ type: 'ERROR', message: String(e) })
    }
  }, [deps, kanji, state])

  return { state, accept, setLocationText, submitAnchor, commit }
}

// The kanji payload carries its numeric id at the call site; thread it through.
function kanjiId(_k: KanjiForHook, _s: CoCreationState): number { throw new Error('inject kanjiId at the call site') }
```

> **Implementer note:** `KanjiForHook` deliberately omits the numeric `id` (the builders don't need it). `saveCoCreated` does. Add a `kanjiId: number` field to the hook's input (extend `useCoCreation(kanji, kanjiId, deps?)`) and use it in `commit` — replace the throwing `kanjiId(...)` stub. The reducer tests don't exercise `commit`'s save, so they stay green; the sheet passes the real id.

- [ ] **Step 4: Run the reducer test → PASS.** **Step 5: Commit** (both co-author lines).

---

### Task 6: The co-creation sheet UI (mobile; device-verified)

A multi-step Modal sheet mirroring `apps/mobile/src/components/study/MnemonicNudgeSheet.tsx` (Modal + `Pressable` backdrop + `ScrollView`, theme tokens `colors.bgCard`/`colors.primary`/`colors.border`/`colors.textSecondary`). It renders one stage at a time from `useCoCreation` state.

**Files:**
- Create: `apps/mobile/src/components/mnemonics/CoCreationSheet.tsx`

- [ ] **Step 1: Build the component**

Props: `{ visible: boolean; kanji: KanjiForHook & { id: number }; onClose: () => void; onSaved?: (mnemonicId: string) => void }`. Internally call `useCoCreation(kanji, kanji.id)`. Render by `state.stage`:

- **consent** — Buddy's offer copy (`"持 keeps slipping off the shelf — want to build a hook the monkey can't reach?"`, kanji char + meaning interpolated) + the **teaching beat** line built from `lookupComponents(kanji.components)`: *"持 is 扌 (hand) beside 寺 (temple)."* (degrade to "this part" for unmapped). Buttons: **Let's do it** → `accept()`; **Not now** → `onClose()` (Plan 4 will add the 7-day cooldown write; here just close).
- **location_inference** — if `state.locationName` is set, show *"Looks like you're near {name}."* and auto-advance; else a `TextInput` *"Where are you right now?"* → `setLocationText(value)`.
- **detail_elicitation** — Q1 `TextInput`: *"Look around — what's one thing that catches your eye?"* → **Build it** calls `submitAnchor(value)`.
- **assembly** — while `state.assembling` show a spinner; when `state.draft` is set, show the story in a card + a small `generatedBy` tag, plus **Make it stickier** (reveals Q2 color/detail + Q3 reading inputs → `submitAnchor(state.anchor!, { personalDetail, readingPlay })` to re-assemble) and **Save this** → `commit()`. *"Read it aloud — even a whisper."* microcopy above Save.
- **commitment** — confirmation (*"Saved. We'll quick-check it in a moment."*) + **Done** → `onSaved?.(state.mnemonicId!)` then `onClose()`. (The immediate quick-check quiz is Plan 4; here just confirm + close.)
- **error** — if `state.error`, show a gentle retry line; the template tier means assembly itself never hard-fails, so errors here are save/network — offer **Try again** (`commit()`).

Follow `MnemonicNudgeSheet`'s StyleSheet/structure for the Modal shell, handle, header, scroll body, footer button. Reuse its theme tokens; do not introduce a new sheet library.

- [ ] **Step 2: Device verification** (operator's iPhone): run the full create path from a manual entry point (Task 8) end-to-end — consent → (grant location AND deny→text) → anchor → draft (confirm a cloud story; airplane-mode → template) → make-it-stickier → save → confirm a `mnemonics` row with `generation_method='cocreated'` (Supabase spot-check on the RAD account). The post-session trigger path is Task 7.
- [ ] **Step 3: Commit** (both co-author lines).

---

### Task 7: Post-session Buddy moment wiring (mobile; device-verified)

At Session Complete, fetch context for the just-graded kanji, pick the action, and render the sheet for a `create`. (`reinforce` is Plan 4 — for now, a `reinforce` result is treated as "none" so nothing misfires.)

**Files:**
- Modify: `apps/mobile/app/(tabs)/study.tsx`

- [ ] **Step 1: Build the trigger glue**

In `study.tsx`'s `handleFinish` (~line 366, where `sessionSummary` is set): after the session summary is computed, collect the distinct graded `kanjiId`s and per-kanji "struggled today" from the store's `results` (`apps/mobile/src/stores/review.store.ts` — `quality === 1 || quality === 3` ⇒ Again/Hard ⇒ struggled; also treat a failed quiz leg as struggled if that signal is available). Then:

```ts
import { pickBuddyMomentAction, type ReviewedCard } from '@kanji-learn/shared'
import { fetchBuddyMomentContext } from '../../src/mnemonics/cocreationApi'

// inside handleFinish, after sessionSummary is set:
const gradedIds = [...new Set(results.map((r) => r.kanjiId))]
const struggledById = new Map<number, boolean>()
for (const r of results) if (r.quality === 1 || r.quality === 3) struggledById.set(r.kanjiId, true)
try {
  const ctx = await fetchBuddyMomentContext(gradedIds)
  const cards: ReviewedCard[] = ctx.map((c) => ({
    kanjiId: c.kanjiId, kanji: c.kanji,
    struggledToday: struggledById.get(c.kanjiId) ?? false,
    lapses: c.lapses, hasHook: c.hasHook,
  }))
  const action = pickBuddyMomentAction(cards) // cooldown set wired in Plan 4
  if (action.kind === 'create') {
    setBuddyMomentKanjiId(action.kanjiId)      // new state → renders CoCreationSheet
  }
  // action.kind === 'reinforce' | 'none' → no-op in Plan 3b
} catch { /* a Buddy moment is best-effort; never block Session Complete */ }
```

- [ ] **Step 2: Render the sheet**

Add `buddyMomentKanjiId` state. When set, fetch that kanji's full payload (the app already loads kanji detail via the kanji API / a store) and render `<CoCreationSheet visible kanji={...} onClose={() => setBuddyMomentKanjiId(null)} />` over the Session Complete screen. The sheet is modal, so Session Complete stays mounted beneath.

> The trigger must be **non-blocking and at most one sheet per session** (spec §4.1). It runs after the clock has stopped (Session Complete), so it never eats study budget. Wrap the whole thing so any failure silently degrades to the normal summary.

- [ ] **Step 3: Device verification** — on an account with a chronically-lapsing, hookless kanji that you grade Again/Hard this session: complete a session → the Buddy moment offers to build a hook for exactly that kanji → full create path → saved. Grade nothing badly → no Buddy moment. At most one offer per session.
- [ ] **Step 4: Commit** (both co-author lines).

---

### Task 8: Manual "Build a hook" from kanji detail (mobile; device-verified)

Cold-start safety net (spec §4.1 / §9.1): kanji detail offers **Build a hook** when no co-created hook exists.

**Files:**
- Modify: `apps/mobile/app/kanji/[id].tsx`

- [ ] **Step 1:** In the kanji-detail mnemonic section, when the kanji has no co-created hook, add a **Build a hook** button that opens `<CoCreationSheet visible kanji={thisKanji} ... />` (the detail screen already has the kanji payload incl. the new `components` from Task 1). On `onSaved`, refresh the mnemonic view. (The full `MnemonicCard` refactor + "Go deeper" is Plan 4; here add only the create entry.)
- [ ] **Step 2: Device verification** — open a kanji with no hook → Build a hook → create path → saved → the detail screen reflects it.
- [ ] **Step 3: Commit** (both co-author lines).

---

## Self-Review

**Spec coverage:** §3 client-owned flow (mobile drives; thin API) → Tasks 3–8 ✓ · §4.1 post-session single-action trigger (create acted; reinforce→Plan 4) → Task 7 ✓ · §4.2 create-flow stages + teaching beat → Tasks 5–6 ✓ · §5 adaptive elicitation (Q1 + optional make-it-stickier) → Tasks 5–6 ✓ · §7.2–7.3 cloud→on-device→template cascade, cloud-first testing phase → Task 3 ✓ · §9.1 kanji-detail manual entry → Task 8 ✓ · §11 location consent-by-participation + text fallback → Task 5 (`getPlaceName` returns null → text) ✓ · components exposure (Plan 2 forward dep) → Task 1 ✓.

**Placeholder scan:** one intentional seam — `useCoCreation`'s `kanjiId(...)` stub throws with an explicit implementer note to thread the numeric id at the call site (the builders don't need it; `saveCoCreated` does). Task 6's UI references the `MnemonicNudgeSheet` pattern by file rather than re-pasting its full StyleSheet — appropriate given the established design system. Everything else is complete code or a precise file:line/pattern reference.

**Type consistency:** `AssemblerSlots`, `CoCreationContext`, `AssemblyTier`, `ReviewedCard`, `lookupComponents`, `assembleTemplate`, `pickBuddyMomentAction` all come from `@kanji-learn/shared` unchanged. `assembleOnDevice`/`OnDeviceUnavailableError` from Plan 3a. `KanjiForHook`/`HookAnswers` defined once in `buildSlots.ts` and imported by the hook. The cascade's `generatedBy` values (`cloud`/`on_device`/`template`) match `AssemblyTier` and the `contextSchema` enum from Plan 2.

**Risks / notes:**
- **Mobile jest harness** — Tasks 3–5 assume the mobile app can run plain-TS unit tests (same open item as Plan 3a Task 4). Confirm at Task 3; if absent, the pure logic (`assembleStory`, `buildSlots`, the reducer) can be tested by temporarily running under the shared/api vitest or by adding a minimal jest config — report which path.
- **Reinforce deferred** — `pickBuddyMomentAction` may return `reinforce`; Plan 3b no-ops it. That means a session where the only candidate is a hooked-but-slipping kanji shows no moment until Plan 4. Acceptable for this slice; noted so it's not mistaken for a bug.
- **Cloud-first cost** — every create hits Anthropic via our key during testing (operator absorbs). The pre-launch reorder is flagged in `assembleStory` + memory.

---

## Plan sequence (Phase 5)

1. Foundation ✅ · 2. Data & API ✅ · **3. Mobile co-creation: 3a (on-device enablement) → 3b (this plan, the create flow)** · 4. Quiz + reinforce/deepen + surfacing.
