# Phase 5 — Contextual Mnemonic Co-Creation (Design)

**Date:** 2026-05-31
**Status:** Design approved in brainstorm; ready for implementation plan
**Supersedes:** the entire pre-Buddy mnemonic system (stock + old user mnemonics)
**Lineage:** April design [§7](2026-04-09-kanji-buddy-design.md) (the signature feature) + the May refresh [§6.4 / §9](2026-05-23-buddy-v2-phase-1-refresh.md) (pulled forward as the first feature that makes Buddy feel like *Buddy*)

---

## 1. Summary

When a kanji repeatedly fails to stick, Buddy steps in at the **end of a study session** and offers to build a personal memory hook *with* the learner — anchored to where they are and what they already know. This is the app's signature pedagogical feature.

The flow is **client-owned**: the mobile app runs the whole co-creation session, assembles the hook (three-tier cascade), and persists the result through a thin API. A failing hook is **deepened, never discarded** (learning is constructed: connect new → known). A freshly-built hook is **tested soon** via a new story → kanji quiz item.

### Design decisions (locked in brainstorm)

| # | Decision |
|---|---|
| Entry | A post-session "Buddy moment" — **at most one action per session**, prioritized. Plus **manual invoke** from a kanji's detail page (covers cold-start). |
| Trigger | **Hybrid**: the single worst kanji that *both* slipped today (Again/Hard or failed quiz) **and** is chronically lapsing (≥3–4 lifetime `lapses`). |
| Elicitation | **Adaptive**: one anchor question → assemble → optional "make it stickier" to layer 1–2 more. |
| Assembly | **Three-tier cascade**, `generatedBy` records the winner. Order is **BYOK-gated** (see §7). |
| Reinforcement | **Full loop** in the same debrief: recall mnemonic → recall kanji; self-report 👍/👎. |
| Deepen (not rebuild) | A struggling hook is **deepened** (append a layer, connect to known knowledge), never overwritten. |
| Radical data | Curated **Kangxi 214** `radical → {meaning, imageKeyword}`, staged N5→N3 first. |
| Voice | The monkey stays **deliberately ambiguous** (learner decides); warm/playful register that reads under either meaning. |
| Quiz | New **story → kanji** quiz item tests a fresh hook (immediate quick-check + early item next session). |
| Cost | **Cloud-first during the testing phase** (operator absorbs cost); **BYOK** makes cloud-first sustainable at scale. Gated before public launch. |

---

## 2. Goals / Non-goals

**Goals (v1):**
- The full create → reinforce → deepen loop, end-to-end, on-device-owned.
- A serviceable, free **template** assembler that works on every device offline, plus on-device and cloud tiers for better prose.
- The radical-meaning dictionary as a reusable shared asset (N5→N3 first).
- The first-test **story → kanji** quiz item.
- Surface hooks where they're useful: kanji detail (home + manual create/deepen) and the flashcard back.
- Discard the old mnemonic system cleanly (behind a safety dump).

**Non-goals (deferred):**
- The Phase 6 **Study Log** (timeline / map-of-memories / tags / photos / audio). The Journal tab is untouched in v1.
- Story → kanji as a **recurring** review modality across all hooks (parking-lot fast-follow; v1 ships only the fresh-hook first-test).
- Android on-device model (Gemini Nano) — no Android build today.
- Per-user FSRS parameter fitting, mnemonic sharing with friends (Phase 4 / social).

---

## 3. Architecture — Approach 1: client-owned flow, thin API

The on-device model and reverse-geocoding *must* run client-side, so the natural and chosen architecture puts the whole flow in the mobile app:

- **Mobile owns** the `CoCreationSession` state machine: candidate selection at session-complete, elicitation, reverse-geocoding, assembly (all three tiers resolved client-side), the reinforcement challenge, the deepen pass, and quiz scheduling.
- **API is thin**: persist the finished mnemonic + `cocreation_context`, update `effectivenessScore` from outcomes, and expose a **cloud-assembly endpoint** (the only server-side intelligence — it holds the Anthropic key). It serves *nothing* during the elicitation flow.
- **Radical dictionary** ships **bundled in `packages/shared`** (small, static, offline, instant).

```
Session Complete (clock stopped)
        │
        ▼
[client] pick single action ── none ──▶ normal summary
        │ (reinforce > create)
        ▼
[client] run flow (consent → teach → location → elicit → assemble → commit)
        │            ├── reverse-geocode (OS, free)         [client]
        │            └── assemble: cloud → on-device → template
        │                        └── cloud tier ──▶ [API] /assemble ──▶ Anthropic
        ▼
[API] persist mnemonic + cocreation_context (optimistic local save + sync)
        ▼
[client] stamp mnemonicQuizDueAt → next session inserts the quiz
```

---

## 4. The post-session Buddy moment & flow state machine

### 4.1 When it fires & what it picks

At **Session Complete** (after the clock stops — never eats study budget), the client evaluates the just-graded cards plus their lifetime state and picks **one** action, in priority order:

1. **Reinforce** (highest) — a kanji that *has a hook* slipped today. Tending an existing hook compounds, so it outranks creating a new one.
   - If that kanji has also passed the **deepen gate** (§6), the reinforce concludes with a *deepen offer*.
2. **Create** — no hooked kanji slipped, but a **hybrid-trigger** kanji (slipped today **and** ≥3–4 lifetime `lapses`) has *no* hook yet.
3. **Nothing** — neither exists; the normal Session Complete summary renders.

This guarantees at most one calm, earned interruption. Everything renders inside the existing Session Complete flow as a Buddy card/sheet with a clear **Not now** escape (which sets a 7-day per-kanji cooldown, §8).

**Manual entry** (cold-start safety net): kanji detail offers **"Build a hook"** (no hook yet) or **"Go deeper"** (hook exists), running the same flows on demand regardless of the trigger.

### 4.2 Create flow — maps to the existing `CoCreationSession.stage` enum

Teaching and recall are **presentational beats within existing stages** — the typed enum (`consent | location_inference | detail_elicitation | assembly | commitment`) is **not changed**.

| Stage | Content |
|---|---|
| `consent` | Buddy's offer: *"持 keeps slipping off the shelf — fourth time. Want to build a hook the monkey can't reach?"* → **Let's do it / Not now** |
| *(teaching beat)* | Before asking anything, Buddy shows the kanji's makeup from the radical dictionary: *"持 is 扌 (hand) beside 寺 (temple)."* Degrades to "this part" for unmapped components. |
| `location_inference` | If location available → reverse-geocode → *"Looks like you're near **Beppu Station**."* If denied/unavailable → text fallback: *"Where are you right now?"* |
| `detail_elicitation` | Q1 = environmental anchor (*"Look around — what's one thing that catches your eye?"*). After assembly, optional **"Make it stickier"** adds Q2 (personal detail) / Q3 (reading wordplay) and re-assembles. |
| `assembly` | Three-tier cascade (§7) weaves location + anchor + component meanings + reading into a story. Draft shown. |
| `commitment` | *"Read it aloud — even a whisper."* Save. Then the **immediate quick-check** quiz (§8). `generatedBy` recorded. |

### 4.3 Reinforce flow — two-step recall

1. *"持 slipped again today. You built a hook — let's test it. Picture Beppu Station… what was the hand reaching for?"* → tap to reveal.
2. *"Good. So — how do you read 持?"* → tap to reveal.
3. **One self-report:** *"Did picturing the scene help you land it?"* → **👍 / Not really**. Drives `effectivenessScore` (§6).
4. If past the deepen gate → deepen offer (§6).

---

## 5. Elicitation (adaptive)

- **Q1 — environmental anchor** (always): *"Look around — what's one thing that catches your eye?"* The assembler maps it onto a component during synthesis.
- After a first draft, an optional **"Make it stickier"** unlocks up to two more, re-assembling each time:
  - **Q2 — personal detail**: e.g. *"What color are you wearing?"* — injects unique sensory memory.
  - **Q3 — reading wordplay**: a prompt that builds a sound-hook around the kanji's reading.
- On a **deepen** pass the elicitation shifts toward **known knowledge** rather than the environment (see §6) — knowledge is portable; the learner may be somewhere new.

End-of-session = low energy, so the default path is **one question → usable hook**; depth is opt-in.

---

## 6. Reinforcement & deepening cadence

### 6.1 `effectivenessScore` (EMA)

Outcome signal = the 👍/👎 self-report (reinforce flow) **or** the story→kanji quiz result (§8). Update:

```
score ← 0.4 · outcome + 0.6 · score      // outcome = 1 (👍 / quiz correct) or 0 (👎 / quiz wrong)
reinforcementCount += 1
lastReinforcedAt = now
```

Starts at the existing `0.5` default. All three fields already exist on the `mnemonics` row — no schema change.

### 6.2 The deepen gate

When a hooked kanji's reinforcement concludes, Buddy offers to **go deeper** if:

```
reinforcementCount ≥ 2  AND  effectivenessScore < 0.35
```

Walking from 0.5: one 👎 → 0.30, two 👎 → 0.18 — so **two unhelpful outcomes in a row** trip it; a 👍 in between lifts the score and buys the hook more time. (Matches the "~2–3 cycles" intent without a hard counter.)

### 6.3 Deepen — additive, never discard

> *"The Beppu-Station hook is fading a little. Let's not toss it — let's give it more to hold onto. What does 持 remind you of that you already know cold? Another kanji, a word, a memory — anything."*

- **Appends a layer** to the existing hook. The original scene stays; the new connection extends it. We keep an ordered `cocreation_context.layers[]` (each: questions/answers/anchors/source) and render the story as a small stack. History is preserved *for free* (additive) — no `previousStories[]` needed.
- **Pulls from known knowledge** (related kanji, a song, a memory), not just the current environment.
- `effectivenessScore` **resets to ~0.5** (a genuine fresh chance now that there's more flesh on it); `reinforcementCount` keeps climbing (full history of tending); `cocreation_context.layerCount` tracks depth.
- **Copy reframe everywhere:** never "rebuild," "start over," or "discard." It's "go deeper," "add another thread," "what does this connect to?"
- Deepen is also available **proactively** from kanji detail ("Go deeper") any time, not only when the gate trips.

---

## 7. Assembly — template, radical dictionary, three-tier cascade

### 7.1 Radical dictionary (bundled in `packages/shared`)

```ts
// radical char → meaning + image keyword
type RadicalEntry = { char: string; meaning: string; imageKeyword: string }
// 扌 → { meaning: 'hand',   imageKeyword: 'a hand reaching out, grasping' }
// 寺 → { meaning: 'temple', imageKeyword: 'a small temple tucked nearby' }
```

- Kangxi 214 + common non-Kangxi components, **staged N5→N3 first**.
- Component chars for a kanji come from the existing `kanji.radicals` (jsonb `string[]`). **Open item:** confirm during planning whether `kanji.radicals` holds full decomposition or only the classifying radical (check `packages/db/src/seeds/backfill-radicals.ts`). If thin, note KRADFILE-style component data as an enrichment.
- Unmapped component → graceful degradation ("this part"); never blocks the flow.
- Reusable beyond this feature (Browse, study, tutor reports).

### 7.2 Template assembler (deterministic, free, universal)

Inputs (slots): kanji (char, meaning, kana reading), mapped components, location name (or user text), anchor (Q1), optional personal detail (Q2) / reading wordplay (Q3).

- Picks from a small library of **sentence frames** selected by a hash of the kanji id (different kanji → different shapes; no mad-libs sameness).
- Asserts every component meaning, the location, the anchor, and the reading appear in the output.

**Worked example** — 持 ("hold"; 扌 hand + 寺 temple), *Beppu Station*, anchor *"yellow vending machine"*:

> "At Beppu Station, a yellow vending machine catches your eye. A **hand** (扌) reaches out and **holds** (持) a hot can from it, right beside a little **temple** (寺) on the platform. *もつ — motsu —* you hold it as the can warms your palm."

Serviceable, not poetry — but it teaches components, roots the kanji in a real place, and includes the reading.

### 7.3 Three-tier cascade & BYOK ordering

`generatedBy` ∈ `template | on_device | cloud` records the winning tier. **Per-user tier order depends on whether the learner has supplied their own Anthropic API key:**

| Phase / user | Order |
|---|---|
| **Testing phase, any user** | **cloud → on-device → template** (cloud uses **our** server key; operator absorbs cost while user count is tiny) |
| **Post-launch, BYOK user** (own key) | **cloud → on-device → template** (cloud uses **their** key, their cost) |
| **Post-launch, keyless user** | **on-device → template** (our key **not** used for assembly) |

- **On-device** = Apple Foundation Models (iPhone 15 **Pro**+ / Apple-Intelligence devices). Needs a native module (Swift + Expo config plugin); **verify whether a maintained community wrapper exists** before estimating build-it-ourselves. Free + private (slots never leave the device).
- **Cloud** = Anthropic, called **via the API** when using our key (`generateHaiku`/`generateSonnet` kept and **adapted** to assemble from the full co-creation slots), or **directly client→Anthropic** when using a BYOK key (key never touches our server). On error → next tier.
- **Template** = always-works offline baseline.

> ⚠️ **Pre-launch gate** (tracked in memory `project_testing_phase_flags.md`): before App Store public release, remove the our-key cloud-first default for keyless users. Keep cloud-first only for BYOK users. At scale, our-key cloud-first = unbounded spend + sends personal data off-device.

### 7.4 BYOK (bring-your-own-key)

- Profile setting: optional **"Use your own Anthropic API key."** Stored in **`expo-secure-store`**, **never logged** (per `feedback_secret_hygiene`). Validated with a cheap test call on entry; invalid/quota error → silently fall back down the cascade.
- BYOK calls Anthropic **directly from the client** (their key, no server round-trip, server never sees it).
- **Scope (decided 2026-05-31):** the cascade *resolution logic* is v1, but the BYOK *settings UI + secure storage* ships as a **pre-launch slice, NOT the first v1 cut**. During the testing phase, keyless cloud-first via our key covers everyone, so no BYOK UI is needed until public launch (it's part of the pre-launch gate, §14).

---

## 8. The story → kanji quiz (first-test of a fresh hook)

A quiz **item** is graded study content (not a Buddy conversation), so it lives **inside** a session.

- **The item:** prompt = the hook's story; response = **4–5 kanji tiles**, one correct. *"Which kanji does this story point to?"*
- **Infrastructure:** reuses the existing loop quiz-leg plumbing (`testSessions` / `testResults`). Adds a new `test_type` (`mnemonic_recall`) and a new card layout. **No new session machinery.**
- **Scheduling:**
  1. On **create or deepen**, the client stamps `cocreation_context.mnemonicQuizDueAt` (≈ now).
  2. **Immediate quick-check:** right after `commitment`, show the story once and pick the kanji (instant testing-effect encoding).
  3. **Next session** that includes the kanji surfaces the quiz as an **early item** (front-loaded while fresh); if the kanji isn't otherwise due, it's slotted in as a one-off.
- **Distractors:** prefer kanji that **share a component/radical** with the target (confusable, via `kanji.radicals`), then same-JLPT-level kanji from the user's deck. Assembled client-side. Never include a duplicate.
- **Outcome → §6 cadence:** correct → bump `effectivenessScore`, clear the due stamp; wrong → nudge down, flag the kanji as a **deepen** candidate for the next Buddy moment.

---

## 9. Surfacing hooks in v1 (pre–Study Log)

1. **Kanji detail page (`kanji/[id]`) — canonical home.** Refactored `MnemonicCard` renders the layered story, the place it was born, and its depth. Manual entry points: **"Build a hook"** (none yet) / **"Go deeper"** (exists).
2. **Flashcard — answer side only.** A hooked kanji shows its hook **after reveal** (never on the prompt side — that would short-circuit retrieval). `KanjiCard` shows it on flip; kanji with no hook show nothing (no stock fallback).

The Journal tab is **untouched** in v1 — timeline / map / tags / photos / audio are Phase 6.

---

## 10. Data model & superseding the old system

### 10.1 Reuse the `mnemonics` table

- `storyText`, `userId`, `latitude`/`longitude`, `locationType`, `effectivenessScore`, `reinforcementCount`, `lastReinforcedAt` — all present.
- `generationMethod = 'cocreated'` — enum value **already exists**. `type = 'user'`.
- **Extend `cocreation_context` jsonb `$type` only (no migration — jsonb is schemaless):**

```ts
cocreationContext: {
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
  mnemonicQuizDueAt?: string   // ISO; cleared after first quiz
  timeOfDay?: string
}
```

### 10.2 Remove cloud-LLM *auto-generation* UX; keep the capability

- `MnemonicNudgeSheet` (old "want me to generate one?") → **replaced** by the co-creation flow.
- `generateHaiku` / `generateSonnet` → **kept and adapted** to assemble from co-creation slots (the cloud tier, §7.3). The `useMnemonics` generate path is **repurposed**, not deleted.

### 10.3 Keep as thin persistence

`getForKanji`, `saveUserMnemonic`, `updateUserMnemonic`, `deleteUserMnemonic`.

### 10.4 Retire the 30-day refresh nudge

`refreshPromptAt`, `getDueForRefresh`, `dismissRefresh`, and the `seed-mnemonics` system seeding — the reinforcement loop (driven by `effectivenessScore`) is the better replacement.

### 10.5 Discard old data (destructive — behind a safety dump)

- Delete the seeded **stock `type='system'`** mnemonics; retire `seed-mnemonics.ts` + `seedSystemMnemonic`.
- Per the refresh, **all pre-Phase-5 mnemonic rows are discarded** — including any user-authored ones (nothing co-created has shipped, so this is effectively every current row). **Operator confirmed (2026-05-31).**
- Done as a one-time cleanup behind a `pg_dump` safety dump (the established clone-rehearsal pattern), reversible for 24h.

---

## 11. Permissions, consent, opt-out, offline/error

**Location — consent by participation, never a blocker.** Reuse the existing `expo-location` foreground flow. Requested only *after* the user accepts the offer, at `location_inference`. Denied/unavailable → text fallback. The whole feature works with zero location access. (Distinct from the milestones `attach_location_to_milestones` toggle — we do **not** piggyback on it.)

**Global opt-out + anti-nag:**
- Profile setting **"Mnemonic coaching"** (default **on**). Off → no automatic Buddy moments; manual "Build a hook" still available.
- Per-offer **"Not now"** → **7-day cooldown** for that kanji. Accepting clears it.

**Offline / error fallbacks:**

| Failure | Behavior |
|---|---|
| Reverse-geocode fails / offline | Text "Where are you?" — no error shown |
| On-device model absent / errors | Fall to next cascade tier |
| Cloud (our key or BYOK) fails | Fall to next cascade tier |
| Persistence POST fails (offline) | **Optimistic local save** + queue, sync on reconnect (same pattern as the offline review queue) — a hook built offline is never lost |
| Component unmapped | Teaching beat → "this part"; flow continues |
| User quits before Session Complete | No Buddy moment that session — nothing half-runs |

The radical dictionary is bundled — no permission, fully offline.

---

## 12. Privacy

- **On-device tier** keeps location + personal answers entirely on-device (preferred ordering once gated).
- **Cloud tier** sends the user's answers and place off-device. Acceptable at low volume; **BYOK** moves that to the user's own account/consent. Flagged as the pre-launch gate (§7.3).
- BYOK keys: `expo-secure-store`, never logged, direct client→Anthropic (per `feedback_secret_hygiene`).
- Discarded mnemonic data is removed behind a safety dump; deletion honors the existing account-delete cascade (`mnemonics.userId … onDelete: cascade`).

---

## 13. Testing strategy

**`packages/shared` (pure unit — highest value):**
- **Template assembler** — output contains every component meaning, location, anchor, reading; frame-variety across kanji ids; graceful degradation on missing component.
- **Radical dictionary** — uniqueness, non-empty `meaning`/`imageKeyword`, N5–N3 coverage assertion (fails loudly on a staged-level gap).
- **Cadence math** — EMA update + `≥2 & <0.35` deepen gate across 👍/👎 sequences; post-deepen reset.
- **Trigger selection** — hybrid "single worst" picker over fake graded cards; ties; empty case.
- **Distractor selection** — target + N distractors, prefers component-sharers, same-level fallback, no duplicates.

**`apps/api` (integration):**
- Persistence round-trip: `generationMethod='cocreated'`, `type='user'`, extended `cocreation_context` jsonb survives (guards the Phase 1' jsonb double-encoding footgun).
- Cloud-assembly endpoint: assembles from slots; on Anthropic error responds so the client can fall back.
- `effectivenessScore` update from a quiz/reinforcement outcome.
- Destructive cleanup migration gets a **clone-rehearsal** before touching live.

**Manual on-device walkthrough (operator's iPhone 15 Pro):** full create flow (**verify the template path first**, then cloud, then on-device); location grant *and* deny; immediate quick-check + next-session quiz; an end-of-session reinforce challenge; a deepen pass after two 👎; the "Mnemonic coaching" off toggle; offline creation → sync.

---

## 14. Pre-launch gating (carry into the infra checklist)

- **Reorder/gate cloud assembly** before App Store public release: keyless users → on-device-first; cloud-first only for BYOK. (Memory: `project_testing_phase_flags.md`.)
- Ship the **BYOK settings UI + secure storage** — deferred from the first v1 cut by decision (§7.4); it's a pre-launch deliverable.

---

## 15. Future / deferred

- **Story → kanji as a recurring review modality** across all hooks (not just the fresh-hook first-test) — parking-lot idea; pairs with the loop quiz leg.
- **Phase 6 Study Log** — timeline / map-of-memories / tags / photos / audio; the co-creation artifacts become its primary content.
- **Android on-device** (Gemini Nano) once an Android build exists.
- **Layered-story UI** polish (rendering the `layers[]` stack as a visible "memory growing over time").
- **Passive effectiveness signal** — fold the kanji's real post-hook lapse behavior into `effectivenessScore` alongside the self-report.

---

## 16. Open questions (resolve at plan time)

1. Does `kanji.radicals` hold full component decomposition or only the classifying radical? (Determines teaching-beat richness — §7.1.)
2. Is there a maintained community Expo module for Apple Foundation Models, or do we build the native bridge? (§7.3.)
3. ~~BYOK UI in the first v1 cut, or as the pre-launch slice?~~ **Resolved (2026-05-31): pre-launch slice, not v1** (§7.4, §14).
4. Immediate quick-check + next-session quiz both in v1 (assumed yes) — confirm the next-session insertion doesn't disrupt the minutes-budget pacing.
