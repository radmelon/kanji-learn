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

> **All four were reviewed by the owner on 2026-08-02. See §14 for the
> decisions and their consequences — statuses below are a summary only.**

1. ✅ **How many findings per surface?** 2–3 proposed. Untested against real
   copy. → **Accepted for v1, but as a tunable parameter rather than a
   constant.** Buddy self-tuning deferred: it needs a delivery-outcome signal
   that does not exist yet. See §14.
2. ✅ **Does companion mode need its own beat engine**, or is it a single
   free-conversation prompt with the snapshot as context? Leaning the latter for
   v1. → **Closed: the single prompt. No separate beat engine in v1.**
3. 🔴 **Tier-2 daily cap** — flagged unsized in the 2026-08-01 handoff and still
   unsized. Companion mode is conversational and will be the common path, so
   this needs a number before launch, not after. → **Still unsized. §14 records
   what the cap is, that production runs the default of 50/user/day, and that
   the day boundary is UTC.** The number itself is still owed.
4. ✅ **`hook_coverage` phrasing** when coverage is zero. "You've built no hooks"
   is true and useless. Needs copy that invites rather than scores. →
   **Dissolved rather than answered: the finding becomes an offer to co-author
   a hook on a named kanji the data says the learner is failing.** Promotes it
   to a `Direct` finding. One interaction with `CoCreationSheet` still to
   design — see §14.

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

---

## 14. Owner review — 2026-08-02

Feedback on §11 (open decisions) and §8. Recorded verbatim in substance; the
commentary under each item is the implementation consequence, not the owner's
words.

### §11.1 — findings per surface: **2–3 accepted, but make it a dial**

> *"Sounds ok to start with. Should we make this a dial we can tune later on?
> Maybe something that Buddy can tune himself?"*

**Resolved for v1: accepted, as configuration rather than a constant.** The
selection policy in §4 must take the count as a parameter, not hardcode 2–3, so
changing it is a config edit and not a code change. Cheap now, expensive to
retrofit once three surfaces read it.

**"Buddy tunes it himself" is deferred, and the reason is worth stating:
self-tuning needs a signal to tune against, and we do not have one.** To raise
or lower the count on its own the system needs to know whether a surface landed
— dismissals, time-on-surface, whether a finding was acted on, session length
after delivery. None of that is instrumented today. Adding the dial in v1 is
what makes the loop *possible* later; building the loop now would tune against
nothing.

Sequencing that falls out of this: **instrument delivery outcomes when the
surfaces ship (slices 2–4)**, even before anything reads them. That is the
input a v2 auto-tuner needs, and it is near-free while the surfaces are being
written.

### §11.2 — companion mode beat engine: **CLOSED**

> *"Accepting the '…a single free-conversation prompt with the snapshot as
> context' for v1."*

No separate beat engine. Decision closed; §5's leaning is now the spec.

### §11.3 — tier-2 daily cap: **explained, still unsized**

The owner asked what this is. Answering it here so the next reader does not
have to re-derive it, verified against the running system 2026-08-02:

Buddy's LLM router (`apps/api/src/services/llm/router.ts`) has three tiers —
**1** on-device, **2** cloud (Groq primary, Gemini secondary), **3** Claude
(opt-in). Each user gets a per-day call budget per tier, enforced in
`apps/api/src/services/llm/rate-limit.ts` by a single atomic
`INSERT … ON CONFLICT DO UPDATE … WHERE call_count < cap` against
`buddy_llm_usage`; zero rows returned is the "blocked" signal, so there is no
race window and no compensating write.

| | Env var | Default | Live value |
|---|---|---|---|
| Tier 2 | `BUDDY_TIER2_DAILY_CAP_PER_USER` | 50 | **50** |
| Tier 3 | `BUDDY_TIER3_DAILY_CAP_PER_USER` | 5 | **5** |

**Neither is set as a runtime environment variable on App Runner** (checked
2026-08-02), so production runs the `env.ts` defaults.

**Why this is the item that could make the feature expensive before anyone
notices:** every other Buddy surface costs *one* call per event. Companion mode
is a conversation — **each turn is a tier-2 call.** 50/user/day was sized for
occasional structured beats, not for chat, and it has never been revisited.
A number chosen deliberately for a conversational surface is still owed, and it
is owed *before* launch, not after the first bill.

**Also worth knowing, and newly relevant:** the day boundary is **UTC**, not the
learner's timezone — an explicit Phase 0 simplification documented in
`rate-limit.ts`. In Japan that means the cap resets at **9am JST**, mid-morning.
This compounds with the timezone issue recorded in the 2026-08-02 handoff
(no route writes `user_profiles.timezone`).

#### Update 2026-08-03 — verified against AWS, and the shape of the decision has changed

Everything above still holds. Three things are now confirmed rather than
assumed, and one of them reframes what has to be decided.

**The caps are genuinely unset.** Checked via `apprunner describe-service`:
neither `BUDDY_TIER2_DAILY_CAP_PER_USER` nor `BUDDY_TIER3_DAILY_CAP_PER_USER`
appears in `RuntimeEnvironmentVariables` **or** in `RuntimeEnvironmentSecrets`.
Production runs the `env.ts` defaults — **tier 2 = 50/user/day, tier 3 = 5**.

**Tier 2 is correctly configured.** `GROQ_API_KEY` and `GEMINI_API_KEY` are both
wired as App Runner secrets, alongside `ANTHROPIC_API_KEY`. So the near-zero
tier-2 usage is **not** a broken provider — do not go looking for one.

**Live usage, for whatever it is worth (very little):**

| Tier | User-days | Total calls | Max in a day |
|---|---|---|---|
| tier 2 | 2 | 4 | 2 |
| tier 3 | 109 | 155 | 5 — the cap, hit once |

Tier 3 splits 67 days at 1 call, 40 at 2, one at 3, one at 5. This is the
"occasional structured beat" pattern the current caps were sized for, and it
says **nothing** about conversational load, because no conversational surface
exists yet.

#### 🛑 The part that is not about a number: tier 2 THROWS

`BuddyLLMRouter.route()` (`router.ts:101-125`) is **tier 1 → on-device, falling
through to tier 2; tier 3 → Claude if opted in, falling through to tier 2;
otherwise tier 2 directly.** Tier 2 is the **universal floor**, not a middle
rung. That is why tier-3 traffic dominates today: requests classify as tier 3
and a premium-opted-in learner is served by Claude, so the floor is never
reached.

When tier 3's cap is hit, `tryClaude` returns `{}` and the request falls through
to tier 2 — graceful. When **tier 2's** cap is hit:

```ts
throw new BuddyLLMError('Tier 2 daily cap reached; no lower tier available')
```

There is nowhere lower to go. **The tier-2 cap is not a throttle; it is the
point at which Buddy hard-fails.**

This matters most for companion mode. §1 makes the template floor
non-negotiable for findings — *"offline, or with the LLM down, Buddy still says
the true thing, just less warmly"* — and analysis mode has that floor.
**Companion mode is free conversation and has no floor to fall back to.** So the
question is not only "what number", it is "what does a learner see on the turn
after the cap".

#### 🛑 Tier 1 is a stub on the server — the "free" floor does not exist on the API path

Verified 2026-08-03. This is not in the original §11.3 framing and it changes
the option set.

`server.ts:94` wires the router's `onDevice` slot to
**`AppleFoundationStubProvider`**, whose `isAvailable()` returns `false`
unconditionally and whose `generateCompletion` throws *"cannot generate on the
server"*. Its own header says why:

> Server-side placeholder for Apple Foundation Models. The real provider lives
> in the mobile app (Phase 2) and runs on-device.

That is structural, not an oversight — a server cannot run an on-device model.
The slot exists so the router has a uniformly-typed provider and so telemetry
can measure on-device coverage. **Every tier-1 request through the API emits an
`unavailable` skip and falls through to tier 2.**

**But iOS native AI is genuinely implemented — in the client, bypassing the
router.** `apps/mobile/src/mnemonics/assembleOnDevice.ts` imports
`AppleFoundationModels` from `@react-native-ai/apple` (the real TurboModule) and
runs its own cascade — on-device → cloud → template — sharing
`buildAssemblyPrompt` and `COCREATION_SYSTEM_PROMPT` with the cloud tier so the
output stays consistent. It never touches the server router.

**Consequence for slices 3–4, and it is the whole reason this is recorded
here:** the free tier that would naturally absorb cheap conversational chatter
**does not exist on the path the conversational surface will use.** Companion
mode goes through the API, so its turns classify as tier 1 or 2, land on tier 2
either way, and count against the 50/day cap that *throws* when exhausted.
Reading tier 1 as a working cost floor — as the table above invites — is wrong
for anything server-routed.

**This opens a fourth option that belongs in the decision below:** build
companion mode's cheap turns **client-side**, following the pattern
`assembleOnDevice.ts` already proves, with the server cascade as fallback. That
is the only version of "tier 1 absorbs the chatter" actually available today,
and it converts on-device from a telemetry placeholder into a real cost floor.
It is also a materially different slice 4 — client-first rather than
API-first — so it wants deciding before that slice is planned, not during.

#### What actually has to be decided — three things, one of them a number

1. **The degradation.** Today it is an exception mid-conversation. Options: a
   template close ("let's pick this up tomorrow"), dropping to on-device for the
   remainder, or refusing to open companion mode when the remaining budget is
   under a threshold. `remainingForTier(userId, tier)` already exists on the
   rate-limiter interface, so a pre-flight check is available without new code.
2. **Whether a per-day cap is even the right shape** for a conversational
   surface, versus a per-conversation turn limit — which fails far more legibly
   to a learner.
3. **Where the cheap turns run** — server (tier 2, metered, throws when
   exhausted) or client (on-device, free, already proven for mnemonics). See
   the tier-1 finding above; this is not a implementation detail, it decides
   slice 4's shape.
4. **The number**, sized from cost-per-turn.

**Recommendation: decide the degradation first, and set the number last.** A
conversational surface that throws mid-chat is a worse failure than one that
closes gracefully at turn 20, and the number cannot be calibrated until slice 3
produces a real token measurement. Setting it now would be calibrating against
nothing — which is exactly what this spec talks itself out of doing for
`goal_pace_gap` in §8.

**Also still true and still unaddressed:** the day boundary is UTC
(`rate-limit.ts` derives it from `toISOString().slice(0,10)`), so the cap resets
at 9am JST — mid-morning for a Japanese learner who exhausted it the previous
evening. No route writes `user_profiles.timezone`, so per-learner boundaries are
not currently plumbable anyway.

### §11.4 — `hook_coverage`: **reframed from a report into an offer**

The owner replaced the phrasing question with a rule:

> *"If 0 or no new since 2 buddy sessions ago, pick a kanji that data suggests
> is Hard or Again or repeatedly failed on Quizzes and offer to co-author a hook
> during Buddy session."*

**This resolves the open decision by dissolving it.** §11.4 asked how to phrase
"you've built no hooks" so it invites rather than scores. The answer is not to
say it at all — the finding becomes an **action with a named kanji attached**.

Consequences for the taxonomy:

- **Trigger:** `hookCount == 0` **OR** no hook created since the
  session-before-last. The second half is the important one — it catches the
  learner who built three hooks in week one and none since, whom a pure
  zero-check never fires for.
- **The finding must carry a specific kanji**, chosen from grading and quiz
  evidence: repeated Again/Hard, or repeated quiz failures. This is a
  `Direct`-class finding (priority 1), not `Motivate` — it changes behaviour
  and names what to do.
- **The data exists.** `review_logs` carries per-kanji quality history and
  `test_results` carries quiz outcomes; §13's "no blocking dependencies" holds.
  Picking the kanji is a shared-lane pure function over that evidence and
  should be tested as one.
- **It hands companion mode something to do.** Co-authoring a hook is a
  concrete activity for the common path, which otherwise has only free
  conversation.

⚠️ **One interaction to design, not assume:** co-creation already has its own
entry points and its own `CoCreationSheet`. Offering it *inside* a Buddy session
needs a decision about whether the sheet opens over the session or the session
hands off to it — and B-224's history says the co-creation commit path is
subtle. Size this before slicing it.

### §8 — the frankness escalator is missing a third option

The owner asked whether *"narrow the scope"* at `< 2 months` means:

> *"Let's target N3 level for the next JLPT window. You're solidly in the range
> now, and with a little more effort you can crush it on the JLPT at N3."*

**No — and the question exposes a gap.** The table's two options each hold one
variable fixed:

| Move | Sitting | Target level | Coverage |
|---|---|---|---|
| Narrow the scope | same | same | **reduced** |
| Shift to the next sitting | **moved** | same | same |
| **Lower the target level** ← missing | either | **moved** | same |

The owner's phrasing is the third row, and it is the one a coach reaches for
first, because it is the only one that can be delivered as **good news**: it
requires knowing the learner is *already solidly in range* for the lower level
— which is exactly what θ and the level bands provide, and which `504b1ea` had
to fix before the claim could be trusted.

**Add it to the §8 table as a first-class option**, and note the register
difference: the existing rows are framed as concessions ("this target isn't
reachable"), the owner's is framed as a target being *claimed*. Same arithmetic,
opposite emotional direction, and the second one is more likely to be acted on.

`goal_pace_gap` (v2) is what computes which of the three to offer.
