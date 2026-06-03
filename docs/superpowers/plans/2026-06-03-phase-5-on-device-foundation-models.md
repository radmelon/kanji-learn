# Phase 5 — On-Device Apple Foundation Models Enablement (Plan 3a of Phase 5)

> **For agentic workers:** This plan is **build- and device-gated**. The shared/logic tasks (Tasks 1, 5) are subagent-TDD-executable; the New-Architecture flip, the library install, and the on-device probe (Tasks 2–4, 6) require `expo prebuild`, Xcode, and a real iOS-26 Apple-Intelligence device — they are **operator-driven, with the agent guiding**. Steps use checkbox (`- [ ]`) syntax. Do NOT dispatch a sandbox subagent to run prebuild/device builds.

> **STATUS — EXECUTED + MERGED 2026-06-03** (merge `97321b8`, verified on-device iPhone 15 Pro / iOS 26.5). **API CORRECTION:** the real `@react-native-ai/apple@0.12.0` surface is the **direct `AppleFoundationModels` TurboModule** (`isAvailable()` + `generateText(messages, options): Promise<Array<{type:'text', text}>>`), NOT the blog's `foundationModels.generateText` shown in the Task 3/4 code blocks below — the **as-shipped** code is in `apps/mobile/src/mnemonics/assembleOnDevice.ts`. We did NOT adopt the Vercel AI SDK (`expo install ai` → ai@6 vs the lib's documented v5). The mobile jest unit test (Task 4 Step 1) was skipped (ts-jest/workspace/native-module friction) — guard logic verified on-device + `buildAssemblyPrompt` unit-tested in shared. Full write-up: [findings/2026-06-03-on-device-foundation-models.md](../findings/2026-06-03-on-device-foundation-models.md).

**Goal:** Enable React Native New Architecture and integrate `@react-native-ai/apple` so the app can assemble a mnemonic story **on-device** via Apple Foundation Models, exposed to the co-creation flow (Plan 3b) as a single `assembleOnDevice(slots)` seam that **throws when unavailable** so the cascade falls back to cloud/template. Verified end-to-end on the operator's iPhone 15 Pro (iOS 26).

**Architecture:** The on-device tier is one async function, `assembleOnDevice(slots): Promise<string>`, living in `apps/mobile/src/mnemonics/`. It reuses the **same** co-creation prompt as the cloud tier — so that prompt + system string are first extracted to `@kanji-learn/shared` (one source of truth for cloud and on-device). The native capability comes from `@react-native-ai/apple` (`foundationModels.generateText`), which is **autolinked** but **requires New Architecture + iOS 26**. New Arch is flipped app-wide (a one-way intent: all subsequent builds, including production, run New Arch), gated behind a full regression smoke.

**Tech Stack:** Expo SDK 54 (RN 0.81), `@react-native-ai/apple` (preview), TypeScript, vitest (shared), jest (mobile), Xcode + `expo prebuild` / `expo run:ios`.

**Spec:** [docs/superpowers/specs/2026-05-31-phase-5-mnemonic-cocreation-design.md](../specs/2026-05-31-phase-5-mnemonic-cocreation-design.md) §7.3 (three-tier cascade; on-device = Apple Foundation Models), §16 Q2 (resolved: a maintained community wrapper exists — `@react-native-ai/apple`).

**Decision (2026-06-03):** Operator chose to include the on-device tier **now** (not defer to pre-launch). Device confirmed: iPhone 15 Pro on **iOS 26**, so on-device generation is verifiable.

---

## Preconditions (verify before Task 2)

- [ ] **Device:** iPhone 15 Pro on **iOS 26** with Apple Intelligence enabled (Settings → Apple Intelligence & Siri → on; model downloaded). Foundation Models are unavailable if Apple Intelligence is off or still downloading.
- [ ] **Mac + Xcode** capable of building for iOS 26 (Xcode 26+). A connected device for `expo run:ios --device`.
- [ ] **Clean working tree** on a fresh branch `phase-5-on-device` (worktree).
- [ ] **Heads-up — one-way intent:** enabling New Architecture changes every subsequent build (including production B-cuts). Plan the next EAS cut accordingly. It is reversible (flip the flag back) but the intent is to keep it on.

---

## File Structure

```
packages/shared/src/mnemonics/assembly-prompt.ts        # NEW: COCREATION_SYSTEM_PROMPT + buildAssemblyPrompt (moved from API)
packages/shared/src/mnemonics/assembly-prompt.test.ts   # NEW: pure unit tests
packages/shared/src/mnemonics/index.ts                  # export the new module
apps/api/src/services/mnemonic.service.ts               # import prompt from shared (delete the local copies)

apps/mobile/app.json                                     # newArchEnabled: true
apps/mobile/package.json                                 # add @react-native-ai/apple
apps/mobile/src/mnemonics/assembleOnDevice.ts            # NEW: the on-device seam
apps/mobile/src/mnemonics/assembleOnDevice.test.ts       # NEW: fallback/guard jest test (native mocked)
apps/mobile/app/(dev)/foundation-probe.tsx               # TEMP probe screen (removed in Task 6)
```

---

### Task 1: Extract the co-creation assembly prompt to `@kanji-learn/shared` (TDD, subagent-OK)

The cloud tier (Plan 2, `mnemonic.service.ts`) has a private `COCREATION_SYSTEM_PROMPT` + `buildAssemblyPrompt(slots)`. The on-device tier needs the identical prompt. Move both to shared so there is one source of truth.

**Files:**
- Create: `packages/shared/src/mnemonics/assembly-prompt.ts`
- Create: `packages/shared/src/mnemonics/assembly-prompt.test.ts`
- Modify: `packages/shared/src/mnemonics/index.ts`
- Modify: `apps/api/src/services/mnemonic.service.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/mnemonics/assembly-prompt.test.ts
import { describe, it, expect } from 'vitest'
import { buildAssemblyPrompt, COCREATION_SYSTEM_PROMPT } from './assembly-prompt'
import type { AssemblerSlots } from './types'

const slots: AssemblerSlots = {
  kanji: '持', kanjiMeaning: 'hold', reading: 'もつ',
  components: [{ char: '扌', name: 'tehen', meaning: 'hand', imageKeyword: 'a hand grasping' }],
  locationName: 'Beppu Station', anchor: 'a yellow vending machine',
}

describe('buildAssemblyPrompt', () => {
  it('includes kanji, meaning, reading, components, place, and anchor', () => {
    const p = buildAssemblyPrompt(slots)
    expect(p).toContain('持')
    expect(p).toContain('hold')
    expect(p).toContain('もつ')
    expect(p).toContain('扌 (hand)')
    expect(p).toContain('Beppu Station')
    expect(p).toContain('a yellow vending machine')
  })
  it('notes "no mapped components" when components is empty', () => {
    expect(buildAssemblyPrompt({ ...slots, components: [] })).toContain('no mapped components')
  })
  it('appends optional personal detail + reading wordplay when present', () => {
    const p = buildAssemblyPrompt({ ...slots, personalDetail: 'a blue scarf', readingPlay: 'motsu→motorbike' })
    expect(p).toContain('a blue scarf')
    expect(p).toContain('motsu→motorbike')
  })
  it('has a non-empty system prompt', () => {
    expect(COCREATION_SYSTEM_PROMPT.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @kanji-learn/shared exec vitest run src/mnemonics/assembly-prompt.test.ts`
Expected: FAIL — cannot resolve `./assembly-prompt`.

- [ ] **Step 3: Implement (lift the exact code from the API service)**

```ts
// packages/shared/src/mnemonics/assembly-prompt.ts
import type { AssemblerSlots } from './types'

export const COCREATION_SYSTEM_PROMPT = `You are Buddy, a warm study companion helping a learner BUILD their own memory hook for a kanji.
You are given real details the learner just gave you: where they are, something they can see, the kanji's component parts and meaning, and its reading.
Weave ALL of them into one vivid 2–3 sentence second-person scene that connects the new kanji to what they already see and know (learning is constructed: new → known).
Name each component's meaning, ground it in their place, use their anchor detail, and surface the reading naturally. Concrete and surprising, never generic. Output ONLY the story — no preamble, no labels.`

export function buildAssemblyPrompt(slots: AssemblerSlots): string {
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

- [ ] **Step 4: Export from the barrel**

In `packages/shared/src/mnemonics/index.ts`, add:
```ts
export * from './assembly-prompt'
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @kanji-learn/shared exec vitest run src/mnemonics/assembly-prompt.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Refactor the API service to import from shared (delete the local copies)**

In `apps/api/src/services/mnemonic.service.ts`:
- Add to the shared import: `import { COCREATION_SYSTEM_PROMPT, buildAssemblyPrompt } from '@kanji-learn/shared'` (merge with the existing value import line; keep `updateEffectiveness`/`EFFECTIVENESS_DEFAULT`).
- DELETE the local `const COCREATION_SYSTEM_PROMPT = …` and `function buildAssemblyPrompt(slots) { … }` at the bottom of the file (they now come from shared). `assembleFromSlots` keeps calling `COCREATION_SYSTEM_PROMPT` / `buildAssemblyPrompt` — now the imported ones.

- [ ] **Step 7: Verify the API still typechecks + its assemble test passes**

Run: `pnpm --filter @kanji-learn/api typecheck` → 0 errors.
Run: `pnpm --filter @kanji-learn/api exec vitest run test/integration/mnemonic-cocreation.test.ts` → PASS (5 tests; the assemble tests still pass with the shared prompt).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/mnemonics/assembly-prompt.ts packages/shared/src/mnemonics/assembly-prompt.test.ts packages/shared/src/mnemonics/index.ts apps/api/src/services/mnemonic.service.ts
git commit -m "refactor(shared): extract co-creation assembly prompt (one source for cloud + on-device)

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@me.com>
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Enable New Architecture + regression gate (operator-driven build)

New Architecture is required by `@react-native-ai/apple`. Flip it, regenerate native projects, build to the device, and **regression-smoke the existing app** before adding the library — so any New-Arch breakage is isolated from the library work.

**Files:**
- Modify: `apps/mobile/app.json`

- [ ] **Step 1: Flip the flag**

In `apps/mobile/app.json`, set `"newArchEnabled": true` (it is currently `false`). Leave the custom config plugins (`withXcode16Fix`, `withWatchApp`, `withWatchConnectivity`) unchanged.

- [ ] **Step 2: Regenerate native projects**

```bash
cd apps/mobile
npx expo prebuild --clean
```
Watch for plugin errors from the Watch config plugins under New Arch. **The current Watch app/module is slated for deprecation (operator, 2026-06-03 — a standing to-do to reconceptualize the watchOS role), so it is NOT a hard constraint on this flip.** If `withWatchApp`/`withWatchConnectivity` fail under New Arch, **disabling them is an acceptable resolution** — comment them out of `app.json` `plugins` (and note it) rather than blocking the on-device work on a module that's being retired anyway. Only the main app must survive the flip.

- [ ] **Step 3: Build + run on the device**

```bash
npx expo run:ios --device   # select the iPhone 15 Pro
```
(Local run keeps iteration free; an EAS `development` profile build is the fallback if local prebuild is problematic.)

- [ ] **Step 4: Regression smoke (GATE — must pass before Task 3)**

On the device, exercise the core app under New Arch:
- [ ] App launches; Dashboard renders; navigation across all tabs works.
- [ ] A full Study loop: flashcard → writing → speaking → quiz → Session Complete (no crashes, gestures/animations fine).
- [ ] Browse + kanji detail (radical pills, stroke order, TTS).
- [ ] Speech recognition (Speaking leg) and notifications still function.
- [ ] ~~Watch connectivity~~ — **skip; the Watch app is being deprecated** (don't gate the flip on it; if its plugins were disabled in Step 2, that's expected).

**If the MAIN APP regresses:** capture it, report, and decide (fix vs. revert the flag). Do NOT proceed to Task 3 on a broken New-Arch build. (Watch breakage is NOT a regression for this purpose — see Step 2.)

- [ ] **Step 5: Commit the flag (only after the gate passes)**

```bash
git add apps/mobile/app.json
git commit -m "build(mobile): enable New Architecture (prereq for on-device Foundation Models)

Regression-smoked on iPhone 15 Pro / iOS 26: study loop, browse, speech, notifications, watch.

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@me.com>
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> Do NOT commit the generated `ios/` directory if this project is managed-workflow (prebuild output is typically gitignored). Only commit `app.json`.

---

### Task 3: Install `@react-native-ai/apple` + on-device probe (GO/NO-GO)

Prove the library builds on this Expo 54 + New-Arch setup and actually generates text on the device before wiring it into the flow.

**Files:**
- Modify: `apps/mobile/package.json`
- Create (TEMP): `apps/mobile/app/(dev)/foundation-probe.tsx`

- [ ] **Step 1: Install**

```bash
cd apps/mobile
npx expo install @react-native-ai/apple
npx expo prebuild --clean
```
If `expo install` warns of an Expo-version mismatch (the library docs mention "Expo Canary"), DO NOT auto-upgrade to Canary. Note the exact warning and the resolved version, and let the probe (Step 3) be the real test of whether Expo 54 stable is sufficient. If it genuinely cannot build on 54, STOP and report — an Expo upgrade is its own decision, not part of this task.

- [ ] **Step 2: Write a temporary probe screen**

Read the installed package's TypeScript types first (`node_modules/@react-native-ai/apple`) to confirm the exact export + availability API; the README shows `foundationModels.generateText([{ role, content }], { schema? })`. If the package exposes a dedicated availability method (e.g. `isAvailable()`/`availability`), use it; otherwise treat a thrown error from `generateText` as "unavailable."

```tsx
// apps/mobile/app/(dev)/foundation-probe.tsx — TEMPORARY (removed in Task 6)
import { useState } from 'react'
import { View, Text, Button, ScrollView } from 'react-native'
import { foundationModels } from '@react-native-ai/apple'

export default function FoundationProbe() {
  const [out, setOut] = useState('(idle)')
  async function run() {
    setOut('generating…')
    try {
      const res = await foundationModels.generateText([
        { role: 'user', content: 'In one short sentence, greet a Japanese learner named Buddy.' },
      ])
      // `res` shape may be a string or { text }. Log the raw value and adapt in Task 4.
      setOut(typeof res === 'string' ? res : JSON.stringify(res))
    } catch (e) {
      setOut(`UNAVAILABLE / ERROR: ${String(e)}`)
    }
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '700' }}>Foundation Models probe</Text>
      <Button title="Generate one sentence" onPress={run} />
      <Text selectable>{out}</Text>
    </ScrollView>
  )
}
```

- [ ] **Step 3: Run on the device + GO/NO-GO**

```bash
npx expo run:ios --device
```
Navigate to `/foundation-probe`, tap Generate.
- **GO:** a coherent on-device sentence appears (no network — toggle airplane mode to confirm it's truly on-device). Record the exact return shape of `res` (string vs `{ text }`) — Task 4 needs it.
- **NO-GO:** if it reports UNAVAILABLE/ERROR, capture the message. Common causes: Apple Intelligence off/still-downloading, device not eligible, or a build/linking issue. Resolve or report; do not proceed to Task 4 until a real generation succeeds.

- [ ] **Step 4: Commit the dependency (probe stays temporarily)**

```bash
git add apps/mobile/package.json apps/mobile/pnpm-lock.yaml apps/mobile/app/\(dev\)/foundation-probe.tsx
git commit -m "feat(mobile): add @react-native-ai/apple + on-device probe (verified on iOS 26)

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@me.com>
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Implement the `assembleOnDevice` seam (mobile; guard logic TDD, generation device-verified)

**Files:**
- Create: `apps/mobile/src/mnemonics/assembleOnDevice.ts`
- Create: `apps/mobile/src/mnemonics/assembleOnDevice.test.ts`

- [ ] **Step 1: Write the failing jest test (native module mocked)**

```ts
// apps/mobile/src/mnemonics/assembleOnDevice.test.ts
import { assembleOnDevice, OnDeviceUnavailableError } from './assembleOnDevice'

const slots = {
  kanji: '持', kanjiMeaning: 'hold', reading: 'もつ',
  components: [{ char: '扌', name: 'tehen', meaning: 'hand', imageKeyword: 'a hand grasping' }],
  locationName: 'Beppu Station', anchor: 'a yellow vending machine',
}

jest.mock('@react-native-ai/apple', () => ({
  foundationModels: { generateText: jest.fn() },
}))
import { foundationModels } from '@react-native-ai/apple'
const mockGen = foundationModels.generateText as jest.Mock

describe('assembleOnDevice', () => {
  afterEach(() => mockGen.mockReset())

  it('returns the trimmed on-device story on success', async () => {
    mockGen.mockResolvedValue('At Beppu Station, a hand holds a warm can.  ')
    await expect(assembleOnDevice(slots)).resolves.toBe('At Beppu Station, a hand holds a warm can.')
  })

  it('throws OnDeviceUnavailableError when the native call rejects', async () => {
    mockGen.mockRejectedValue(new Error('model unavailable'))
    await expect(assembleOnDevice(slots)).rejects.toBeInstanceOf(OnDeviceUnavailableError)
  })

  it('throws OnDeviceUnavailableError on empty output (so the cascade falls back)', async () => {
    mockGen.mockResolvedValue('   ')
    await expect(assembleOnDevice(slots)).rejects.toBeInstanceOf(OnDeviceUnavailableError)
  })
})
```

> Confirm the mobile app's jest config picks up `src/**/*.test.ts` (mirror an existing mobile unit test's location/pattern). If the mobile app has no jest setup for plain TS modules, colocate per the existing convention (check `apps/mobile/package.json` `jest` config / existing `*.test.ts`). If mobile has NO unit-test harness at all, keep this test but run it via the shared/api runner is not possible — in that case, make `buildAssemblyPrompt` the tested unit (already covered in Task 1) and verify `assembleOnDevice`'s guard logic by inspection + the on-device run in Step 4. Report which path applies.

- [ ] **Step 2: Implement**

```ts
// apps/mobile/src/mnemonics/assembleOnDevice.ts
import { foundationModels } from '@react-native-ai/apple'
import { buildAssemblyPrompt, COCREATION_SYSTEM_PROMPT, type AssemblerSlots } from '@kanji-learn/shared'

/** Thrown when on-device generation is unavailable or yields nothing — the
 *  cascade catches this and falls to the next tier (template). */
export class OnDeviceUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(`On-device assembly unavailable: ${String(cause ?? 'no output')}`)
    this.name = 'OnDeviceUnavailableError'
  }
}

/** Assemble a mnemonic story on-device via Apple Foundation Models.
 *  Throws OnDeviceUnavailableError on any failure/empty output. */
export async function assembleOnDevice(slots: AssemblerSlots): Promise<string> {
  let raw: unknown
  try {
    raw = await foundationModels.generateText([
      { role: 'system', content: COCREATION_SYSTEM_PROMPT },
      { role: 'user', content: buildAssemblyPrompt(slots) },
    ])
  } catch (e) {
    throw new OnDeviceUnavailableError(e)
  }
  // Probe (Task 3) recorded the exact shape; normalize string | { text }.
  const text = (typeof raw === 'string' ? raw : (raw as { text?: string })?.text ?? '').trim()
  if (!text) throw new OnDeviceUnavailableError()
  return text
}
```

> Adapt the `{ role: 'system', … }` placement and the return-shape normalization to what the probe actually showed in Task 3. If the library does not accept a `system` role, prepend `COCREATION_SYSTEM_PROMPT` to the user content instead.

- [ ] **Step 3: Run the guard test**

Run the mobile unit test per the harness confirmed in Step 1. Expected: PASS (3 tests).

- [ ] **Step 4: On-device verification (the real gate)**

Temporarily wire `assembleOnDevice(slots)` into the probe screen (replace the hello-world call with a real `slots` object for 持) and run on the device. Confirm a coherent, component-aware story comes back on-device (airplane mode on). This proves the seam end-to-end before Plan 3b consumes it.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/mnemonics/assembleOnDevice.ts apps/mobile/src/mnemonics/assembleOnDevice.test.ts
git commit -m "feat(mobile): assembleOnDevice seam over Apple Foundation Models (throws→cascade fallback)

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@me.com>
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Document the New-Arch flip + on-device tier (shared, subagent-OK)

**Files:**
- Modify: `docs/superpowers/runbooks/2026-06-01-phase5-data-cleanup.md` (or a new short note) + the pre-launch checklist in `docs/handoff.md`.

- [ ] **Step 1: Record the New-Arch enablement** as a pre-launch/infra note: New Architecture is now ON (affects all builds incl. production); the on-device tier requires iOS 26 + Apple Intelligence; `assembleOnDevice` throws→falls back so keyless/older devices still work via cloud/template.
- [ ] **Step 2: Note the testing-phase ordering** still applies: cascade is cloud-first during testing; on-device becomes first for keyless users at the pre-launch gate (memory `project_testing_phase_flags`).
- [ ] **Step 3: Commit** the doc with both co-author lines.

---

### Task 6: Remove the temporary probe (cleanup)

- [ ] **Step 1:** Delete `apps/mobile/app/(dev)/foundation-probe.tsx` (and any temporary wiring in Task 4 Step 4).

```bash
git rm apps/mobile/app/\(dev\)/foundation-probe.tsx
```

- [ ] **Step 2:** Build once more to the device; confirm the app launches and the probe route is gone.
- [ ] **Step 3: Commit**

```bash
git commit -m "chore(mobile): remove temporary Foundation Models probe screen

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@me.com>
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** §7.3 on-device tier (Apple Foundation Models) → Tasks 2–4 ✓ · §16 Q2 (community wrapper exists: `@react-native-ai/apple`) → confirmed ✓ · one-source prompt for cloud + on-device → Task 1 ✓ · graceful fallback when unavailable (`OnDeviceUnavailableError`) → Task 4 ✓.

**Risk register (this plan's whole reason for existing):**
- **New Architecture flip** is app-wide and affects production builds — gated behind a full regression smoke of the **main app** (Task 2 Step 4). The Watch config plugins are **no longer a blocker** (the Watch app is being deprecated); if they break under New Arch, disable them (Task 2 Step 2).
- **Preview library + Expo-version fit** — if Expo 54 stable can't build the lib, Task 3 Step 1 stops rather than auto-upgrading to Canary (that's a separate decision).
- **Device dependency** — every "real" gate (Task 2 Step 4, Task 3 Step 3, Task 4 Step 4) runs on the operator's iOS-26 device; these are not sandbox-executable.
- **No silent on-device requirement** — `assembleOnDevice` throws on any failure, so the Plan 3b cascade always has cloud + template beneath it; the feature never hard-depends on Apple Intelligence.

**Placeholder scan:** the two genuinely-unknown bits (the exact availability API and the `generateText` return shape) are *discovered on-device in Task 3 and adapted in Task 4* — that's the probe's purpose, not an unscoped TODO. Tasks 1 and 5 are fully concrete.

**Out of scope (Plan 3b):** the trigger wiring, the `CoCreationSession` state machine, the cloud→on-device→template **cascade** (which calls `assembleOnDevice`), reverse-geocoding, the create-flow UI, persistence via `/cocreated`, manual "Build a hook", and exposing `kanji.components` in the kanji read API. Plan 3b consumes this plan's `assembleOnDevice` seam.

---

## Plan sequence (Phase 5)

1. **Foundation** — shared pure logic. ✅ merged.
2. **Data & API** — endpoints + IDS backfill + cleanup. ✅ merged.
3. **Mobile co-creation:** **3a (this plan)** on-device Foundation Models enablement → **3b** the co-creation flow (trigger → create state machine → cloud→on-device→template cascade → persistence → manual entry → expose `kanji.components`).
4. **Quiz + reinforce/deepen + surfacing.**
