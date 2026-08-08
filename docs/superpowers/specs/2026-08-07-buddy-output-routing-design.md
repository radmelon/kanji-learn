# Buddy output routing — which finding reaches which surface, and when

**Date:** 2026-08-07
**Status:** Design, approved in brainstorm. Not yet planned or implemented.
**Canonical:** https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-07-buddy-output-routing-design.md

---

## 1. The problem

Nobody owns where Buddy's output surfaces.

The coaching design's [§12](2026-08-01-buddy-coaching-analysis-design.md) slices the
work six ways — pure analyzer, snapshot assembly + notebook surface, conversational
surface, companion mode, IRT explainer + Profile section, goal beat. **None of them
owns placement.** Slice 2 owns *writing* the notebook entry ("template copy only");
no slice asks whether the notebook is the right destination for a given finding.

Slice 5 is the exception that proves it. The IRT explainer is the only coaching
content ever routed to a surface other than the notebook — it went to Profile — and
§12 flags it as *"independent of everything above."* Putting output somewhere new
was, structurally, an orphan.

**The consequence is that everything lands in one place on one cadence.** All
coaching output → `notebook_entries` → the Journal tab, gated by
`ANALYSIS_STALE_HOURS = 6`. Nothing chose that; it is what the slicing produced.

### 1.1 The evidence that this is costing something

`analyze()` takes `DEFAULT_FINDING_COUNT = 3` (`packages/shared/src/coaching/selection.ts:32`).
Verified by live render on 2026-08-07: **7 of 10 finding kinds fire for real
learners, and 3 reach the learner.** `reading_lag` and `retest_due` had been firing
all along and silently losing the cut — shipped-but-unread, for weeks.

That cap is not a content decision. **It is a placement decision made by default**,
because one entry in one tab is the only surface that exists.

A second instance, from the same render: `mechanics_explainer` — a static string
that never changes — **won** a Journal slot against `leech`, which was naming 23
struggling kanji. It won because it had never been raised, so its novelty was 1.0.
A finding that explains the placement test was displacing a live diagnostic,
because the Journal is the only place either of them can go.

### 1.2 Why this is a parent, not a task

Four entries across two sections of `ENHANCEMENTS.md` are the same missing decision:

| Entry | The placement question inside it |
|---|---|
| The placement test ends without analysis | The analysis already exists and already renders — it arrives in the Journal days later instead of at the test. |
| Explanatory content is never brought to the learner | 61 written blocks behind ⓘ; the open question is *at which panel, on what trigger*. |
| Review the Journal's UI/UX | What the Journal should hold **once it is no longer the only destination**. |
| Co-authored hooks: Journal or Progress | Already an explicit placement question. |

This spec settles the first. It produces the model and the table the others need.

---

## 2. Scope

**In scope.** Routing for the **ten coaching finding kinds** produced by
`analyze()` — the kinds in `FINDING_PRIORITY`. They have a taxonomy, magnitude,
confidence, novelty and a selection function, so a routing table has something real
to key on.

**Out of scope, deliberately:**

- **The 61 ⓘ explanation blocks.** They have no magnitude and no trigger; routing
  them means inventing a trigger model that findings do not need. That is the
  "Buddy should tour" entry, and it is a different design.
- **Nudges, Buddy moments, notebook onboarding entries, weekly-session utterances.**
  Four shipped subsystems with different triggers and lifecycles. Naming them here
  would produce a spec nobody can implement.
- **Journal presentation.** What the Journal *looks like* is the Journal UI/UX
  entry, and it is downstream of this: its layout depends on what it still holds
  once it is no longer the only destination.

---

## 3. The model

Two orthogonal dimensions. Neither existed before; both are what make the routing
table small enough to read.

### 3.1 Surface type

A property of the **surface**, not of the finding.

| Type | Capped | Rotates | Burns novelty | Surfaces |
|---|---|---|---|---|
| **Record** | no | no | no | Journal, Tutor report |
| **Event** | yes | yes | yes | Placement completion, Session Complete, Progress card stack, Weekly session |

A **record surface** is opened on purpose by someone who wants the complete
picture. Capping it, rotating it, or worrying about nagging are all category
errors. A **event surface** interrupts a moment; it shows few things, rotates so
the same sentence does not follow the learner around, and is subject to the
once-per-cycle rule in §6.

This distinction is why the Journal is uncapped and Session Complete shows one
sentence. It turns "should this surface be capped?" from a per-surface guess into
a property of the type.

### 3.2 Audience

Each finding kind declares `audiences: ('learner' | 'tutor')[]`.

One mechanism, two different reasons, each recorded on its row in §4. This is
deliberately not two booleans (`learnerOnly`, `withheldFromTutor`) — that would
encode the same mechanism twice and let the two drift.

**The consent boundary, decided 2026-08-07.** A learner opting into a tutor share
agreed to share **progress data**. That covers Buddy's read of their *capability*.
It does not obviously cover Buddy's read of their *diligence*. So diagnostics are
shared and judgement is withheld — see `commitment_gap` in §4.

---

## 4. The routing table

Lives at `packages/shared/src/coaching/routing.ts` as
`Record<FindingKind, RoutingRule>`. `Record` over `FindingKind` makes it
exhaustive **at compile time**: a new finding kind will not build until someone
decides where it goes. That is the single most valuable guarantee here, because
the failure this spec exists to fix is a kind quietly having no home.

Every finding always goes to **every record surface its audience allows**. The
table declares which **event** surfaces each kind is additionally eligible for;
§6's once-per-cycle rule then picks at most one of them.

| Kind | Anchor | Eligible event surfaces | Audiences |
|---|---|---|---|
| `level_estimate` | event — the test just taken | Placement, Progress | learner, tutor |
| `hardest_cleared` | event — worthless a week later | Placement | learner, tutor |
| `mechanics_explainer` | event — explains the test you just took | Placement | **learner** |
| `theta_delta` | event — only new at the second test | Placement | learner, tutor |
| `retest_due` | record — a standing drift | Progress | learner, tutor |
| `reading_lag` | record — a standing imbalance | Progress | learner, tutor |
| `leech` | record — but actionable right after a lapse | Session Complete, Progress | learner, tutor |
| `hook_coverage` | event — you just missed it | Session Complete | learner, tutor |
| `fluency_gain` | event — praise about the session | Session Complete | learner, tutor |
| `commitment_gap` | record — a period, not a moment | Weekly session, Progress | **learner** |

The **anchor** column is rationale carried in the artifact. It is not read by any
code. It exists so that changing a row means arguing with the reason it was set.

### 4.1 Rows that need their reasoning recorded

These four are the ones a future reader is most likely to change without knowing
what they are undoing. **Each must appear as a comment on its row in
`routing.ts`, not only in this spec** — a spec is not where someone editing a
table is looking.

**`hook_coverage` → Session Complete is a precedent, not an invention.**
`apps/mobile/app/(tabs)/study.tsx` already records that the co-creation offer was
deliberately moved out of mid-card and to Session Complete (parent spec §4.1),
because interrupting retrieval to offer a hook damages the retrieval. Routing the
finding that *motivates* a hook to the same place the offer already lands is
consistency with a decision this project already made and paid for.

**`commitment_gap` is barred from Session Complete on purpose.** Telling someone
who has just finished studying that they studied less than they promised is the
wrong instrument at the wrong moment. It is period-anchored: the weekly session is
where the period is reviewed. Its detector already notes that tone is §8's
frankness escalator's business and nothing in the detector decides it — placement
is the other half of that restraint.

**`mechanics_explainer` moving to Placement fixes something live.** On 2026-08-07
it won a Journal slot against `leech` — a static explainer displacing a diagnostic
naming 23 struggling kanji — because it had never been raised so its novelty was
1.0. It explains the placement test; it belongs at the placement test. Moving it
stops it competing with live diagnostics for a slot it never should have contended.

**`mechanics_explainer` and `commitment_gap` are `learner`-only, for different
reasons — do not collapse them.** `mechanics_explainer` is the only kind whose
subject is the **app** rather than the **learner**; a tutor does not need Buddy
explaining the tool to them. `commitment_gap` is excluded on **consent**: it is a
judgement about diligence, and a progress share does not obviously authorise it.
If the consent decision is ever revisited, only the second row should move.

---

## 5. Where routing is applied

**Server-side, one endpoint:**

```
GET /v1/buddy/findings?surface=<placement|session_complete|progress|weekly>
```

It reads the current analysis, filters by the routing table, applies the
once-per-cycle rule, records what it returned, and responds with rendered
sentences. The same shape for all four event surfaces, rather than each growing a
bespoke payload.

**Record surfaces do not use this endpoint**, and this is not an oversight. The
Journal is already served by the notebook assembly, and the tutor report by its
token route (§9). Both are uncapped, neither rotates, and neither burns novelty
(§8), so routing them through an endpoint whose whole job is the once-per-cycle
rule would mean passing flags to disable most of it. The `surface` parameter
therefore admits event surfaces only.

### 5.1 The GET has a write side effect, and that is the chosen trade

Returning a finding marks it surfaced. This is impure. The honest alternative — a
separate acknowledge `POST` — is worse: more round trips, and a client that
navigates away never sends it, so findings never burn and the repetition rule
silently stops working.

**The failure mode of marking-on-read is that a finding is consumed by a screen
the learner never actually saw.** That is survivable *because* of §3.1: record
surfaces are uncapped, so a burned finding is **delayed, never lost** — it is
still in the Journal, and it becomes eligible again next cycle. Under an
exclusive-routing model this same choice would have been a data-loss bug.

### 5.2 Placement completion bypasses the staleness gate

A learner finishing a placement test needs an analysis that **includes that test**.
`ANALYSIS_STALE_HOURS = 6` would hand them the pre-test analysis.

This is the same class of error as the deploy-verification trap in
`docs/SOP.md`: **a signal that predates the event cannot describe the event.** The
placement route therefore forces a refresh rather than honouring the gate. This is
the one surface that does so, and it needs a regression test (§9).

### 5.3 Rejected: applying the table client-side

`packages/shared` is imported by mobile, so the table would be reachable. But the
once-per-cycle rule needs cross-surface state, and putting that in the client means
four screens racing on local storage. Routing stays where the analysis already
lives.

---

## 6. Cycle state and repetition

**A finding is spoken on at most one event surface per analysis cycle.** Record
surfaces are exempt — they are not "speaking".

State lives on the notebook entry row:

```
source.surfaced: { [kind]: { at: ISO, on: Surface } }
```

Per-analysis by construction, and reset when a new analysis supersedes the row.

**Deliberately not on `PriorFinding`.** `packages/shared/src/coaching/persistence.ts`
carries a documented subtlety — "TRANSITION-ONLY RESTAMPING" — about what
`carryForward` must and must not re-stamp, and why restamping everything makes the
learner see different content on every open. Threading a second lifecycle through
that mechanism risks a subtle bug for no gain.

---

## 7. Caps

`DEFAULT_FINDING_COUNT = 3` stops being a global constant and becomes a per-surface
parameter.

| Surface | Cap | Why |
|---|---|---|
| Journal | unlimited | It is the ledger. This is what ends the silent 7-of-10 loss. |
| Tutor report | unlimited | A record surface; a tutor wants the complete picture. |
| Placement completion | 3 | Four kinds are eligible, but `theta_delta` only fires on a retest. |
| Session Complete | 1 | The learner is leaving. One sentence or none. |
| Progress card stack | 2 | Browsing, not transiting. |
| Weekly session | **delegated — not a number** | See §7.1. |

Ranking within a surface stays `magnitude × confidence × novelty`. Only the cut
moves.

### 7.1 The weekly session is eligibility-filtered, not cap-limited

This row is the one place where "which findings" and "how many" split apart, and
an earlier draft of this spec contradicted itself by calling the weekly session
both routed (§4, §5) and "unchanged" (here).

**Resolved:** the routing table constrains *which* findings the weekly session may
speak — `commitment_gap` is eligible there, `hardest_cleared` is not — and **slice
3's analysis mode continues to own how many it speaks and how it words them.**
The endpoint returns the eligible set; slice 3 selects within it.

So this spec *does* change the weekly session: it can no longer reach for a
finding the table does not route to it. It does not change slice 3's selection or
its prompt.

---

## 8. 🔴 The novelty trap

**Uncapping the Journal would silently break novelty rotation.** This is the one
interaction in this design most likely to be got wrong by an implementer reading
only §7.

`carryForward` stamps the findings that were **selected**, and that decay is what
lets an unshown finding rise and eventually win a slot. If "selected" becomes
"everything written to the Journal", then every kind decays equally every cycle,
novelty flattens to a constant, and the ranking collapses to
`magnitude × confidence`. Session Complete — cap 1, three eligible kinds — would
then show the same sentence every session, forever.

**Resolution: novelty stamps on event-surface exposure, not on the Journal write.**

The Journal is a record; reading a ledger does not burn a finding's right to be
*spoken*. This keeps `carryForward`'s existing meaning intact — it has always
stamped "what was shown to the learner" — and simply makes "shown" mean "spoken on
an event surface", now that a second kind of surface exists.

Restated as an invariant for the implementer:

> **Writing to a record surface must never call `carryForward`.**

---

## 9. Tutor report

The tutor report is a **record surface** with audience `tutor` (§3).

**Integration point: the analysis prompt, not a new rendering.**
`apps/api/src/services/tutor-analysis.service.ts` already assembles
`=== STUDENT PROFILE ===`, `=== PROGRESS ===`, `=== VELOCITY ===`,
`=== QUIZ ACCURACY BY TYPE ===`, `=== PLACEMENT HISTORY ===` and `=== EFFORT ===`
and hands them to an LLM to derive insight from raw numbers. A
`=== WHAT BUDDY HAS NOTICED ===` section feeds that same call pre-computed,
already-verified statements instead — strictly better raw material, no new surface
to build.

**Built from `evidence`, never from `templateCopy`.** Finding copy is
second-person: *"You promised 60 minutes… and studied 16."* That does not belong in
a tutor report. The copy floor made every formatter read structured, labelled
`evidence` through constants shared with the detector that writes it, so a tutor
rendering can use the evidence directly and skip the sentence entirely. This
sidesteps the voice problem rather than maintaining a parallel set of third-person
strings that would drift.

---

## 10. Testing

This feature has an unusually clear record on what catches defects in it: **ten
found by rendering against live data, zero by tests.** 541 shared tests passed
through every one of them. The testing story is weighted accordingly.

**Compile-time.** `Record<FindingKind, RoutingRule>` — a new kind does not build
until it is routed. The most valuable guarantee available, and it is free.

**Pure unit tests** (`packages/shared`): the routing filter, the once-per-cycle
rule, per-surface caps, audience filtering, and one test asserting no kind maps to
an empty event-surface list without an explicit annotation.

**Integration tests** (`apps/api`): the endpoint per surface; marking-on-read;
and specifically that **placement completion bypasses `ANALYSIS_STALE_HOURS`**
(§5.2) — a regression test for a trap this project has hit twice in different
forms.

**Tutor-specific assertions**, because this is exactly the class that ships wrong
and is only noticed by a human reading real output:

- No tutor-facing payload contains second-person copy.
- `commitment_gap` and `mechanics_explainer` never appear in a tutor payload.

**The acceptance check, not a nice-to-have: `scripts/coaching-smoke-render.mjs
--surface <name>`.** It already drives the production path and already has
`--as-of`, so a placement surface can be rendered at the instant a learner actually
finished a test rather than against a fixture. `--surface tutor` renders what a
tutor would receive.

**Explicitly not testable by fixture: whether the routing *feels* right.** A table
can be provably consistent and still put the wrong sentence in front of someone.
The per-surface smoke render is what makes that judgeable, and it needs a human
reading it before this ships.

---

## 11. Suggested slicing

**This design is larger than one shippable increment**, and saying so here is
cheaper than discovering it mid-plan. It spans `packages/shared` (the table and
rules), `apps/api` (endpoint, tutor prompt, staleness bypass) and `apps/mobile`
(four consuming screens).

A slicing that keeps each step independently shippable and independently
verifiable:

| Slice | Contents | Ships what |
|---|---|---|
| **1** | `routing.ts`, audience filter, per-surface caps, the §8 novelty invariant, and the Journal going uncapped | The silent 7-of-10 loss ends. **No new surface.** Verifiable entirely by the existing smoke render. |
| **2** | The endpoint + placement completion, including the §5.2 staleness bypass | Closes the New Learner Experience placement entry — the highest-value single route. |
| **3** | Session Complete + Progress card stack | The two study-loop surfaces, which share a shape. |
| **4** | Tutor report — the `=== WHAT BUDDY HAS NOTICED ===` prompt section | Different audience, different code path, no mobile work. Genuinely independent. |

⚠️ **Slice 1 is the one that must not be skipped or merged.** It carries the
novelty invariant (§8), and every later slice depends on the ranking still
rotating. Shipping any event surface before it means shipping a surface that
shows the same sentence forever.

**Mobile slices need an EAS build; slices 1 and 4 do not.** Slice 4 is therefore
available at any time regardless of the build cycle.

---

## 12. Open items

1. **Whether `level_estimate` belongs on the Progress card stack at all**, or
   should be Placement-only. It is the one row where the anchor is genuinely
   ambiguous — the level is event-anchored to the test but stays true until the
   next one. Left on both; tune against a real render.
2. **The Progress card stack cap of 2 is a guess.** Like the notebook spec's §14.1,
   it is "a number to tune against real sessions, not to guess once."
3. **What happens on a surface with no eligible findings.** Render nothing, or a
   fallback? Leaning render nothing — silence is honest and this project has an
   explicit precedent that a formatter which cannot build its sentence returns
   `null` rather than emitting a broken one. Needs confirming against a real
   placement completion with a thin analysis.

---

## 13. Out of scope

- The 61 ⓘ explanation blocks and any tour mechanism (§2).
- Journal presentation and layout — downstream of this.
- Where co-authored hooks live — a sibling placement question, unblocked by this
  model but not answered by it.
- The weekly session's own selection logic, which slice 3 owns.
- A per-share learner toggle for tutor visibility of findings. Considered during
  the brainstorm and deferred: it adds a settings surface, a schema column and a
  default to argue about. The §3.2 consent boundary is the answer for now.
