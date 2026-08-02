# Buddy's coaching analysis — design

> **Canonical URL — hand this to a new session:**
> https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-01-buddy-coaching-analysis-design.md

Written 2026-08-01, from a brainstorm with the owner.

## The problem

A learner finishes a placement test and is told a level and a seeded count.
Buddy never mentions it again. There is no path from *"we measured you"* to
*"here is what that means and what to do about it."*

Meanwhile the app records a great deal that nobody ever reads back: response
times on every review, a hint-used flag, lapse counts, FSRS stability and
difficulty transitions, quiz results by question type, hooks the learner wrote
in their own words with the anchors they chose, weekly commitments, and daily
minutes. None of it is surfaced as anything a person could act on.

**This spec covers turning that into constructive analysis and coaching in
Buddy's voice.**

## Scope

**In:** a deterministic analyzer producing typed findings; a selection policy;
two conversational modes; the notebook and weekly-session surfaces; the IRT
explainer; goal collection.

**Out, deliberately — each is its own spec:**

| Not here | Why separate |
|---|---|
| Kanji content quality — gloss ranking, item keying, example-sentence selection, the curated fact store | Independent, and contains a live placement-validity bug. **Next spec.** |
| Using quiz results to calibrate item difficulty | Statistical work with its own risks. Third spec. |
| Apple Watch / geofenced hook reminders | Parked. Captured to Open Brain. |
| The pace arithmetic for `goal_pace_gap` | v2 — see §8. v1 collects the goal only. |

## 1. Architecture

Three units, following shapes this repo already uses.

### `packages/shared/src/coaching/findings.ts` — pure

```
analyze(snapshot: LearnerSnapshot): Finding[]
```

No I/O, no LLM, no clock (time is passed in). **Every number in the feature is
computed here**, so every number is testable in the shared lane — no database,
sub-second, and it runs in CI today.

### `apps/api/src/services/buddy/coaching.service.ts`

Assembles `LearnerSnapshot` from Postgres — mirrors `learner-state.service.ts`,
which already does this shape of work. Calls `analyze`, applies the selection
policy (§4), writes the notebook entry.

### `apps/api/src/services/buddy/coaching-prompt.ts`

Turns selected findings into a prompt. Mirrors `meeting-prompt.ts`. **Voice
only.**

### Data flow

```
trigger → snapshot → [pure analyze()] → Finding[]
                                          ↓
                          [select: severity × novelty, decayed]
                                          ↓
                        ┌─────────────────┴─────────────────┐
                  notebook entry                     conversation
              (supersede by source_kind)            (LLM voices them)
```

### The load-bearing invariant

**The LLM receives findings, never raw data.** It is given
`{kind: 'reading_lag', magnitude: 0.8, evidence: [...]}` and returns Buddy's
voice. It never sees a table or a row, so it cannot compute a statistic, and
therefore cannot invent one.

This is the same split as `beats.ts` (pure engine) + cloud tier (voice) from
Phase 7. It also means the analysis can be tested end-to-end without an LLM.

**Every finding kind ships with template copy.** Non-negotiable: Phase 7's
entire HIGH-defect wave was the template floor failing to complete. Offline, or
with the LLM down, Buddy still says the true thing — just less warmly.

## 2. The Finding contract

```ts
interface Finding {
  kind: FindingKind        // stable identity across weeks — see §4
  magnitude: number        // 0..1, normalised severity/size
  confidence: number       // 0..1, how much data backs it
  evidence: Evidence[]     // the specific rows/values behind it
  since: string | null     // ISO date first raised, null if new
}
```

`kind` + `since` are what make decay work. Without a stable identity, "have we
said this before?" is undecidable.

`confidence` exists so the voice can hedge honestly. A finding from four
observations must not be spoken like one from four hundred.

**`magnitude` is normalised per kind, not globally.** There is no universal
scale on which "readings lag by 0.4 logits" and "missed the commitment by 20
minutes" are comparable, and pretending otherwise would silently bias selection
toward whichever kind happens to produce larger raw numbers. Each kind owns its
mapping to 0..1 and documents it beside its implementation.

## 3. The v1 taxonomy

### Direct — findings that change behaviour (priority 1)

| Kind | Computed from | Source |
|---|---|---|
| `reading_lag` | reading vs meaning accuracy gap **beyond** the population `readingOffset` | `placement_results.meaningCorrect`/`readingCorrect`, `kl_test_results.questionType`, `user_kanji_progress.readingStage` |
| `leech` | high `lapses`; repeated `remembered→learning` | `user_kanji_progress`, `review_logs.prevStatus`/`nextStatus` |
| `commitment_gap` | promised vs actual minutes | `daily_stats.studyTimeMs` vs `buddy_commitments` |
| `hook_coverage` | how many co-created hooks exist, and whether hooked kanji lapse less | `mnemonics` (`generationMethod = 'cocreated'`), `user_kanji_progress.lapses` |

### Orient — trust and understanding (priority 2)

| Kind | Notes |
|---|---|
| `level_estimate` | θ **with its credible interval**: "probably N3, possibly N2". Never a bare label |
| `mechanics_explainer` | The IRT two-liner + pointer to Profile. **Template, always. Never LLM** — Buddy must not improvise about his own algorithm |

### Motivate — reasons to come back (priority 3)

| Kind | Notes |
|---|---|
| `fluency_gain` | response time falling at constant accuracy. **The finding most likely to exist in a thin week** |
| `theta_delta` | movement since the last placement (needs ≥2 sessions) |
| `hardest_cleared` | highest `difficultyAtAsk` passed — concrete, earned praise |
| `retest_due` | `abilitySe` / credible-interval width past threshold |

### Cut from v1, with reasons

- **`hint_dependence`** — the hint only renders when the learner has their *own
  co-created* hook for that card (`attachHookData` filters
  `generationMethod = 'cocreated'` and `userId`), then waits out a deliberate
  delay. The owner had never encountered it. The signal is **rare, not merely
  weak**. `hook_coverage` replaces it and is the better finding: it tells the
  learner to build hooks and shows evidence they help.
- **`failing_hook`** — same sparsity. Revisit once `hook_coverage` moves.
- **`goal_pace_gap`** — deferred to v2, see §8.

### `retest_due` is the mechanism behind "revisit periodically"

`widenForStaleness` already exists in `packages/shared`. Buddy suggests a
retake **at the statistically right moment** — when the estimate has decayed —
rather than on a calendar. Framed as the owner framed it: *the value of the
test increases if it is repeated*, not *please take a test*.

## 4. Selection: severity × novelty, with decay

Rank by `magnitude × confidence × novelty(kind, since)`. Take the top 2–3.

The exact decay curve is an implementation choice, but it must satisfy two
properties, and these are the testable contract:

1. **Monotonically decreasing** in how recently the kind was last raised.
2. **Never reaches zero.** A finding that has been true for six weeks is not
   less important than a new one — it is more important, and going quiet on it
   is the coaching failure this policy exists to prevent.

`novelty` decays a finding that was raised recently, but **never to zero** — a
persistent problem should still be raised, with escalating framing:

> week 1 — "your readings are lagging your meanings"
> week 3 — "readings again — let's try something different"

Repetition becomes a signal instead of a bug. The prior notebook entry is the
memory: `notebook_entries` supersede-by-source-kind means exactly one current
analysis exists, and the superseded history *is* the trajectory. That is what
lets Buddy say *"last month I noticed your readings lagging — that's closed
now."*

**Rejected:** a hard novelty gate (goes silent on the most important problem
precisely because it is persistent) and fixed lens rotation (arbitrary, and
reports whatever the lens sees rather than what matters).

## 5. Two modes

### Analysis mode — findings exist

Buddy reports the top 2–3.

### Companion mode — nothing new worth reporting

Buddy talks: mood, effort, the hooks the learner has made, the kanji behind
them, and help making one stick or adjusting it.

**Companion mode is not a fallback, it is the common case.** Most weeks will
have no materially new finding, so it gets first-class design. Analysis makes
the feature credible; conversation is what makes someone open it again when
nothing has changed.

Companion mode draws on the same snapshot: recent hooks, which anchors the
learner reaches for, their `source: 'environment' | 'known_knowledge'` pattern,
and their stated interests.

**No external lookups in v1.** Facts come from what we hold — `kanji.components`
(already backfilled), meanings, readings, the learner's own hook. Three reasons,
recorded so they are not relitigated:

1. LLM kanji etymology is a hallucination minefield, and a learner cannot detect
   the error. A false origin story becomes the foundation of a mnemonic.
2. A web round-trip on the *common* path is the expensive path made routine.
3. **Learner details must never leave the system in a search query.** If
   enrichment is added later (the curated store, spec 2), the learner half of
   any query stays local.

## 6. Cadence and triggers

The analyzer runs and refreshes the notebook entry on:

- **placement completion** — immediate, this is the moment the learner is asking
  "what does that mean?"
- **the weekly Buddy session** — when one occurs
- **on demand** — opening the notebook entry

**Deliberately not tied solely to the weekly session.** As of 2026-08-01, an
appointment is consumed by completing it, and no choice of `buddy_day` makes
another due inside the period (`anchorIsNewPeriod` compares against the last
completed session). Hanging the whole feature off that state machine would make
it silent for a week at a time through no fault of its own.

## 7. The IRT explainer

Two surfaces, deliberately different depths:

- **Buddy, in conversation** — two sentences, template, plus a pointer:
  *"a statistical technique called IRT — there's a fuller explanation in your
  Profile."*
- **Profile → a new section** — the real explanation with references: what Item
  Response Theory is, why the test gets harder when you do well, why it stops
  early, why ~13 items can say something about 2,294 kanji, and why repeating it
  makes it more valuable.

The mechanics explanation is a **trust** feature, not a content feature. Every
property of an adaptive test is alarming until explained. And because the
explanation never changes, it is template copy — cheap, correct, and immune to
Buddy improvising about his own internals.

## 8. Goal collection — v1 collects, v2 computes

**v1: a new meeting beat asking for the target** — a level and a date, or
explicitly "no exam, just progress." JLPT sittings are the first Sunday of July
and December: a static table, no API.

This is the highest-value question Buddy could ask that he currently does not.
`reasonsForLearning` is free text — *"I want to read manga"* is not a target.

**v2: `goal_pace_gap`** — the honest arithmetic between current θ, the target,
the date, and the committed minutes.

The motivating case, from the owner, 2026-08-01: asked an LLM what N4 → N2
requires, was told **65–105 min/day**. His KanjiBuddy commitment is **10
min/day**. Nothing in the app notices, and it is the most useful thing anyone
could tell him.

**Deferred deliberately.** A wrong pace model delivered frankly is worse than no
pace model, and today the hours-per-kanji constant would be invented from
nothing. Collecting the goal in v1 costs one beat and makes v2 possible; the
arithmetic can then be calibrated against real `daily_stats` throughput.

### The JLPT date is the frankness escalator

It makes directness *principled* rather than arbitrary, and it answers how to
gate `commitment_gap`:

| Distance to sitting | Register |
|---|---|
| > 6 months | Silent, or framed as possibility |
| 2–6 months | Direct — "at 10 minutes a day this target isn't reachable. Raise the commitment, or move the target?" |
| < 2 months | Frank — narrow the scope, or shift to the next sitting |

Not "never two weeks running" — **proportional to the stakes.** Missing a
commitment in January with no exam booked barely matters. Missing it in October
with December booked is the thing a coach exists to say.

## 9. Failure modes

| Failure | Behaviour |
|---|---|
| LLM unavailable / offline | Template copy per finding kind. Buddy still says the true thing |
| No findings at all | Companion mode |
| No study activity at all | Absence is itself a finding — "you haven't studied since Tuesday; shall we make this week smaller?" beats a fabricated statistic. The schema already has an `absence` intervention type |
| Snapshot assembly partially fails | Analyze what arrived; findings carry `confidence`, so thin data speaks quietly rather than not at all |
| Learner has no placement at all | Every non-placement finding still works. `level_estimate` and `theta_delta` are simply absent |

## 10. Testing

- **`analyze()` in the shared lane** — no DB, no LLM. Every finding kind gets
  cases at boundary magnitudes, plus one asserting no input combination produces
  a finding with `confidence > 0` on absent data.
- **Selection policy in the shared lane** — decay behaviour across simulated
  weeks, including the "persistent problem still surfaces, with escalation" case.
- **Snapshot assembly in the API integration lane** — against the local test DB.
  Rebuild it first (`docs/local-test-db.md`); a stale one reads ~5 phantom
  failures.
- **No test asserts LLM prose.** The contract under test is that the LLM is
  handed the right findings and that template output is correct without it.

## 11. Open decisions

1. **How many findings per surface?** 2–3 proposed. Untested against real copy.
2. **Does companion mode need its own beat engine**, or is it a single
   free-conversation prompt with the snapshot as context? Leaning the latter for
   v1.
3. **Tier-2 daily cap** — flagged unsized in the 2026-08-01 handoff and still
   unsized. Companion mode is conversational and will be the common path, so
   this needs a number before launch, not after.
4. **`hook_coverage` phrasing** when coverage is zero. "You've built no hooks"
   is true and useless. Needs copy that invites rather than scores.

## 12. Suggested slicing

This is a large spec — comparable to Phase 7. It should not become one
undifferentiated plan. Each slice below is independently shippable and leaves
the app working:

1. **The pure analyzer** — `Finding`, the taxonomy, `analyze()`, and the
   selection policy. No surfaces, no LLM, no API. Entirely shared-lane tested.
   Nothing user-visible; everything downstream depends on it.
2. **Snapshot assembly + the notebook surface** — the service, the DB reads, the
   superseding entry. Template copy only. First user-visible slice, and it
   works with the LLM off.
3. **The conversational surface** — the prompt module, analysis mode in the
   weekly session, and the LLM voice over slice 1's findings.
4. **Companion mode** — the common path, and the one most likely to need copy
   iteration once it can be seen.
5. **The IRT explainer + Profile section** — independent of everything above and
   can land at any point.
6. **The goal beat** — collection only, per §8.

Slices 1–2 are the spine. 5 and 6 can be reordered freely.

## 13. Dependencies

- **None blocking.** Every v1 finding computes from data confirmed present on
  2026-08-01.
- Spec 2 (content quality) would materially improve `level_estimate`'s inputs —
  the placement item key is currently `meanings[0]` from an unranked dictionary
  order — but this spec does not wait on it.
