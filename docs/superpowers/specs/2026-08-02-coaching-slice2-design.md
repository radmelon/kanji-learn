# Coaching analyzer slice 2 — snapshot assembly + the notebook surface

> **Canonical URL — hand this to a new session:**
> https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-02-coaching-slice2-design.md

Parent spec:
https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-01-buddy-coaching-analysis-design.md

Slice 1 (merged, PR #9):
https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/plans/2026-08-02-coaching-analyzer-slice1.md

This is the **spec refresh** the 2026-08-02 handoff said slice 2 was waiting on.
It is written against the shapes slice 1 actually produced, and it corrects the
parent spec where execution disproved it.

Slice 2 is §12's second slice: *"snapshot assembly + the notebook surface — the
service, the DB reads, the superseding entry. Template copy only. First
user-visible slice, and it works with the LLM off."*

---

## 0. What this refresh corrects

### §13 "Dependencies — None blocking" was wrong, and so was the handoff's correction

§13 says every v1 finding computes from data confirmed present. The 2026-08-02
handoff called that false and predicted slice 2 "needs a migration first" —
specifically a JSONB column or a findings table for `priorFindings`, and a
`buddy_sessions` table for `HookSnapshot.sessionDates`.

**Both fields already have sources. Neither needs a new table or column.**

| Field | Source | Cost |
|---|---|---|
| `priorFindings` | `notebook_entries.source` — already `jsonb` (`0032_notebook.sql:18`), already unconstrained, already the supersede key via `source->>'kind'` | Widen `writeKeyedEntry`, which hardcodes `source: { kind }` |
| `HookSnapshot.sessionDates` | `buddy_commitments.week_start WHERE source='session'` | Generalise `getMostRecentAgreed`'s `limit(1)` |

`sessionDates` deserves emphasis: this is **already the app's definition of "a
Buddy session happened."** `CommitmentService.getMostRecentAgreed`
(`apps/api/src/services/buddy/commitment.service.ts:50`) filters exactly this
way, and both `buddy-session.ts:74` and `notification.service.ts:499` feed the
result to `evaluateAppointment` as `lastSessionDate`. Inventing a second
definition would let two parts of the system disagree about the same learner —
which is the failure mode `0031`'s header describes.

**§14's narrower claim is untouched.** Its "§13's 'no blocking dependencies'
holds" is about `review_logs`/`test_results` supplying `hook_coverage`'s
evidence. That is true and stays.

### Slice 2 does carry a migration — one index

Not the schema redesign the handoff anticipated. See §6.

### §11.3 (tier-2 daily cap) does not gate this slice

Slice 2 is template copy and runs with the LLM off. The cap binds slices 3–4.
It is still owed before launch; finishing slice 2 does not resolve it.

### §11.4's `CoCreationSheet` interaction is a slice 3 concern

The notebook renders `hook_coverage`'s offer as text with the named kanji slice
1 already picks. Whether the sheet opens over a Buddy session or the session
hands off to it is a slice 3 design problem and must not be inherited here.

---

## 1. Two defects found while specifying this

Both were found by reading slice 1's detectors against the real onboarding
flow. Neither is a slice 1 bug: both detectors are correct given correct
inputs, and *which* inputs they get is snapshot assembly's job — which is this
slice.

### 🔴 `commitment_gap` fires at maximum score the moment a commitment is agreed

`detectCommitmentGap` never reads `periodStart`/`periodEnd`. It uses only
`promisedMinutes` and `actualMinutes`. Given the current period at the instant
a session ends (live values: 4 days × 15 min):

- `missed` = 60 − 0 = 60
- `proportionMissed` = 1.0 → `magnitude` = **1.0**
- `confidence` = **1**, set deliberately — "a promise and a measurement"
- score = 1.0 × 1.0 × novelty 1.0 = **the maximum any finding can score**

So a learner agrees to study four days a week and Buddy's notebook immediately
leads with *"You studied less than you promised yourself this period."* It is
not confined to onboarding — it recurs at the **start of every commitment
period**.

**Resolved in §3: the reckoning speaks about the last COMPLETED period.**

### ✅ `hook_coverage` is already safe at t=0, by design

`pickHookCandidate` requires `score >= MIN_STRUGGLE_SIGNALS` (2) from
Again/Hard grades plus quiz failures. A new learner has neither, so
`detectHookCoverage` returns null at line 82 — §14.4's *"an offer needs a
subject"* guard. `confidenceFromCount(0, 10)` would also be 0, and `select()`
drops zero-confidence findings. Double-protected. Recorded so a later change
does not remove one guard believing the other is decorative.

---

## 2. Trigger proximity — the onboarding double-fire

The first Buddy session suggests taking the placement test. A learner who does
it immediately fires **session end** and **placement completion** minutes
apart.

**With `commitment_gap` corrected, first-session end produces zero findings:**

| Detector | At first-session end |
|---|---|
| `commitment_gap` | silent — no completed period exists |
| `hook_coverage` | silent — no struggle evidence, no candidate |
| `reading_lag`, `leech`, `fluency_gain` | no evidence |
| `level_estimate`, `mechanics_explainer`, `theta_delta`, `hardest_cleared`, `retest_due` | all need placement |

Nothing is written, nothing is stamped, and the placement run is simply the
first real analysis. **The scenario resolves itself once the period is
correct** — the double-fire was never the root cause.

**Empty selection writes nothing.** When `select()` returns `[]`, slice 2
writes no entry and supersedes nothing; any existing entry stands until there
is something better to say. (§5's companion mode is the slice 3–4 answer to
"nothing to report"; slice 2's answer is silence.)

### The general case still needs the coalescing window

An established learner ending a session and retaking placement right after:
the session run stamps its picks, then placement unlocks `level_estimate` and
friends at novelty 1.0, which displace them. The displaced finding paid full
novelty cost for an entry nobody opened.

Bounded and self-healing — floor 0.25 recovers to ~0.30 in a day and ~0.55 in a
week, so it resurfaces by the next session — but `since` resets, restarting the
21-day escalation clock in `copy.ts`.

**Rule: a run within `COALESCE_WINDOW_MINUTES` (default 60) of the previous one
inherits the OLDER row's stamps**, so back-to-back runs count as one episode.

⚠️ **Coalescing keys off the row's `created_at`, NOT its `analyzedAt`.** An
earlier draft said `analyzedAt`, and implementation on 2026-08-03 proved that
inverts §4's central guarantee.

`analyzedAt` moves on *every* in-place update, but the "read priors from the row
before" rule presumes the previous row was **created** by this episode. §5's
unchanged-selection rule guarantees the opposite in the steady state: one row is
updated in place forever and the chain never grows, so that single live row *is*
the pre-episode state. Keying on `analyzedAt` therefore treats a row that is
weeks old as "moments earlier", reads priors from a row that does not exist,
and stamps `since = now` on every finding — permanently, since each later run
carries the reset forward. A finding continuously true since March would read
`since: today`, which is the precise inversion of *"a finding that has been true
for six weeks is not less important than a new one — it is more important."*

**Accepted tradeoff on the first episode.** When coalescing is correctly true
but the latest row is the *first ever* coaching row, "the row before" does not
exist. Priors then fall back to the latest row itself rather than to nothing.
That preserves `since` at the cost of re-flooring novelty for kinds the previous
run introduced. §4 ranks persistence above novelty, so preserving `since` is the
design-aligned choice; the novelty cost is bounded and recovers within days.

---

## 3. Snapshot assembly

`assembleSnapshot(userId, now): Promise<LearnerSnapshot>` — every field, with
its source. This table is the contract; a planner should not have to re-derive
it.

| Field | Source |
|---|---|
| `now` | Request time, ISO. The analyzer has no clock. |
| `placement` | Latest completed `placement_sessions` + its `placement_results`. `previous` is the one before it, null when only one exists. |
| `placement.items[].readingOffset` | `kanji_difficulty`, **not** `placement_results`. Constant 0.4 for every kanji — see slice 1's calibration on why the per-item framing is fiction. |
| `reviews.cards` | `user_kanji_progress` (status, lapses, `reading_stage`) joined to `review_logs` over the window below. |
| `reviews.quiz` | `kl_test_results`. Question types are the five that exist on live — see the caveat block on `QuizOutcome`. |
| `commitment` | **Last COMPLETED, non-`default`, non-superseded `buddy_commitments` row** (`superseded_at IS NULL`). See below, and the fortnightly caveat in §11. |
| `commitment.promisedMinutes` | Computed: `minutes_per_day × days_committed`. Not stored. |
| `commitment.actualMinutes` | `SUM(daily_stats.study_time_ms)` over the period ÷ 60000. `daily_stats.date` is `text` `YYYY-MM-DD`, so ISO range comparison is lexical and safe. |
| `hooks.count` / `latestAt` | `mnemonics WHERE generation_method='cocreated'`. |
| `hooks.sessionDates` | `buddy_commitments.week_start WHERE source='session'`, newest first. |
| `hooks.lapsesWithHook` / `WithoutHook` | Mean `user_kanji_progress.lapses` split on hook existence; null when either group is empty. |
| `priorFindings` | §4. |

### The commitment period rule

**Pass the most recent commitment whose period has ENDED**, excluding
`source='default'`.

- **Why completed only:** the reckoning is a statement about a finished period,
  which is what the weekly session is for. This is what removes the defect in
  §1. A brand-new learner has no completed period → `commitment` is null →
  `detectCommitmentGap` returns null at its first guard.
- **Why not `default`:** `assembleNotebook` already treats `default` as "the
  learner agreed nothing", and `buddy_commitments.source`'s own schema comment
  says a missed `rolled_forward` is not a broken promise "because the learner
  never turned up to agree it". `default` is weaker still. `rolled_forward` is
  included — the register difference is §8's frankness escalator, which is
  slice 6.
- **Period length** is `buddy_interval_weeks × 7` days from `week_start`, not a
  hardcoded 7. Fortnightly learners exist by design (`0030_weekly_buddy_review.sql`).

⚠️ **`copy.ts` needs a matching edit.** `commitment_gap`'s base string says
*"this period"*; once it can only describe a finished period it must say so.
This touches `packages/shared`, which is in the EAS Preview paths filter — that
lane currently **skips** without `EXPO_TOKEN`, so no build fires, but check
before enabling the token.

### The review window

`CardSnapshot`'s `regressions`, `responseMsEarly/Late` and `accuracyEarly/Late`
are all defined relative to "the window", and **slice 1 never fixed its
length** — it is an assembly parameter and this is the slice that owns it.

**30 days, split at the midpoint into two 15-day halves.** Both halves must be
non-empty for `fluency_gain` to speak; slice 1's contract already returns null
otherwise. Exposed as a constant, not inlined.

`regressions` is retained but expected to be 0 — production has never recorded
a `remembered→learning` transition (slice 1 calibration). `leech` sums
`lapses + regressions`, so it degrades to a pure lapse count. Do not remove the
field on that basis; a zero-valued signal is not a dead one.

---

## 4. Where `priorFindings` lives

**`notebook_entries.source` JSONB, read from the most recent
`coaching_analysis` row REGARDLESS of `superseded_at`** — that is,
`WHERE user_id = $1 AND source->>'kind' = 'coaching_analysis'
ORDER BY created_at DESC LIMIT 1`, with no `superseded_at` predicate.

```json
{
  "kind": "coaching_analysis",
  "analyzedAt": "2026-08-02T14:31:00.000Z",
  "findings": [
    { "kind": "reading_lag", "since": "2026-07-12", "lastRaisedAt": "2026-07-26" }
  ],
  "correction": { "at": "2026-07-30T09:12:00.000Z", "kinds": ["leech"] }
}
```

Reading past superseded rows is what makes the memory survive deletion:
`supersedeEntry(userId, id, null)` marks the row superseded but **never removes
it** (`notebook.service.ts:187`). A learner deleting Buddy's observation must
not silently reset the coaching memory and make every finding novel again.

It also implements §4 literally — *"the superseded history **is** the
trajectory."*

### Restamp rule — transition only

`carryForward(priors, selected, now)` is a **pure function in
`packages/shared/src/coaching/persistence.ts`**, shared-lane tested. It does not
belong in a service where testing it requires a database.

- `since` = the prior's `since`, or `now` when the kind was not in the previous
  analysis.
- `lastRaisedAt` = the prior's `lastRaisedAt` when the kind **was** in the
  previous analysis; `now` only on a transition from absent to selected.

⚠️ **It takes three arguments, not four, and it knows nothing about coalescing.**
An earlier draft gave it a `previousAnalyzedAt` parameter and made it decide the
coalescing window itself. That was wrong twice over: the window is keyed off the
row's `created_at`, not `analyzedAt` (see §2's ⚠️ for why `analyzedAt` inverts
§4), and "which row counts as history" is a question about database rows, which
has no business inside a pure function.

**Coalescing is entirely the caller's decision.** `CoachingService.refresh`
picks *which* row's findings to pass as `priors` — the row before the latest
when coalescing, the latest otherwise — and `carryForward` applies the stamp
rule to whatever it is handed. Slice 3 must not reintroduce the four-argument
form.

**Why transition-only.** Restamping every selected finding on every write
re-floors novelty each run, so run 1 picks A/B/C, run 2 sees D/E at novelty 1.0
and displaces them, run 3 flips back — the learner sees different content on
each open. Throttling the write rate only slows that; it does not remove it.
Transition-only also lets a persistent finding's novelty **recover while it is
on display**, which is exactly §4's stated intent: *"a finding that has been
true for six weeks is not less important than a new one — it is more
important."*

**`since` carries from the immediately preceding analysis only.** A kind that
drops out and later returns starts a new episode, which is more truthful than
claiming unbroken continuity. Full history stays reconstructible by walking the
superseded chain — that is what slice 3 needs for *"last month I noticed your
readings lagging — that's closed now."*

### The correction signal

When the most recent `coaching_analysis` row is `author='learner'`, the learner
edited what Buddy wrote. The next run supersedes as normal and records
`correction: { at, kinds }` on the new row — the kinds that were on display
when they intervened.

This is §14.1's delivery-outcome instrumentation, **server-side**, which is why
slice 2 stays API-only. It also preserves spec decision #4: a learner-authored
row superseding a buddy-authored one *is* the correction signal.

Note the mechanism that makes this work: `supersedeEntry` copies
`existing.source` into the replacement (`notebook.service.ts:202`), so a
learner edit carries the findings payload forward and priors are never lost.

⚠️ **A learner-authored row must never be updated in place.** That same
`source` copy is what makes this dangerous: the learner's replacement is live,
keyed `coaching_analysis`, and carries the *inherited* `analyzedAt`, so it
becomes `readLatestKeyed`'s answer and looks recent. An in-place update then
overwrites the learner's own words with `analysisBody(...)` while `author`
stays `'learner'` — their text destroyed, Buddy's analysis rendered as theirs.

The trigger is ordinary, not a race: the learner edits Buddy's fresh
observation five minutes later, which is *when* corrections happen, and a
session completes twenty minutes after that.

**The in-place path therefore requires `author === 'buddy'` as well as a live
row.** A learner-authored latest row takes the insert path, which supersedes it
and preserves their words in the chain — which is what "overwrite, but record
the correction" was always supposed to mean.

---

## 5. Writing the entry

**One entry per analysis, not one per finding.** `sourceKind =
'coaching_analysis'`, `kind = 'observation'`, `author = 'buddy'`.

§4 says exactly one current analysis exists. Per-kind entries would leave a
stale live row every time a finding dropped out of the selection, needing
retirement logic that has no trigger to hang off.

**Body** = `analysisBody(selected, now)`, a new export in `copy.ts` joining
each finding's `templateCopy` with a blank line.

### When to write, and when not to

| Selection vs. stored | Action |
|---|---|
| Empty | Write nothing, supersede nothing. Any existing entry stands until there is something better to say. |
| **Unchanged** | **`UPDATE` `source.analyzedAt` in place. Do NOT supersede and re-insert.** |
| Changed | Supersede and insert, per `writeKeyedEntry`. |

The unchanged case matters because `writeKeyedEntry` unconditionally supersedes
and re-inserts. On the notebook-open path that is a duplicate row every
`ANALYSIS_STALE_HOURS` with byte-identical content, and it pollutes the
superseded chain — which §4 relies on being the trajectory, and which slice 3
needs for *"last month I noticed your readings lagging — that's closed now."*
A chain of forty identical rows is not a trajectory.

An in-place `analyzedAt` update also keeps the staleness gate honest without
manufacturing history.

⚠️ **`templateCopy` must be called with `now`.** `copy.ts:62` reads
`if (!now || days >= ESCALATE_AFTER_DAYS)` — omit `now` and every finding with
a `since` escalates immediately to *"This has been true for a while now"*,
regardless of age. Silent, and no existing test catches it.

### The surface needs no mobile code

`assembleNotebook` buckets entries by `kind` alone, and `NotebookBody.tsx:80`
maps over `view.sections` generically. A `kind: 'observation'` entry renders
under **"What Buddy notices"** with zero client changes, and is learner-editable
because buddy-authored entries get `editableBy: ['learner', 'buddy']` — which
is precisely the correction signal §4 above depends on.

**Slice 2 is therefore API-only and needs no EAS build.** Deliberate, given the
allowance resets 2026-08-04.

Deferred to slice 3, which needs a build anyway for the conversational surface:
a distinct coaching card, rendering `Evidence` values (slice 1 computes
display-safe `label`/`value` pairs that this slice discards), and client-side
instrumentation (time-on-surface, dismissals, acted-on).

---

## 6. Triggers, cadence, and the index

| Trigger | Behaviour |
|---|---|
| Placement completion | Always re-analyse. §6: *"immediate, this is the moment the learner is asking 'what does that mean?'"* |
| Weekly session completion | Always re-analyse. |
| `GET /v1/buddy/notebook` | Re-analyse only when `source.analyzedAt` is older than `ANALYSIS_STALE_HOURS` (**default 6**, a tunable per §14.1's dial precedent). |

Bounding the notebook-open path keeps snapshot assembly off a hot read path
while still satisfying §6's "on demand" and its stated goal of not being silent
for a week at a time. A side-effecting GET is already the established pattern
here — `ensureFirstOpen` inserts on read.

### A tutor-submitted note is deliberately NOT a trigger

Considered and rejected 2026-08-02. **Nothing a tutor writes reaches
`LearnerSnapshot`**, so re-running `analyze()` when a note lands returns
identical findings. Verified — the tutor path's complete set of write targets:

| Service | Writes |
|---|---|
| `tutor-sharing.service.ts` | `tutorShares`, `tutorNotes` |
| `tutor-analysis.service.ts` | `tutorAnalysisCache` |
| `tutor-report.service.ts` | *(read-only)* |

None is read by the snapshot. A trigger that cannot change its own output is
worse than an absent one: it implies Buddy responds to tutors, and a later
reader has to re-derive that it does nothing. That is the same shape as the
dead detectors slice 1's calibration caught — indistinguishable from a healthy
one with nothing to report.

Freshness is already covered without it: the learner opens the notebook to read
the note, the GET fires, and the staleness gate re-analyses if anything actually
moved.

**This is a gap, not a non-issue** — tutor input is the highest-authority signal
in the system and is currently invisible to coaching. §10 records the tractable
way in.

### The migration — one partial unique index

`writeKeyedEntry` is check-then-act: it finds the live keyed row, inserts the
replacement, then supersedes. Unlike `first_open` there is **no partial unique
index** for `coaching_analysis`, so two genuinely concurrent runs both find the
same `existing`, both insert, and the second supersede matches zero rows —
leaving **two live coaching entries, both rendered**. Onboarding is exactly
where near-simultaneous triggers are most likely.

Mirrors `0032_notebook.sql:46`, whose header explains the same reasoning for
`first_open`:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS notebook_entries_coaching_unique
  ON notebook_entries (user_id)
  WHERE source->>'kind' = 'coaching_analysis' AND superseded_at IS NULL;
```

### ⚠️ The index requires reordering `writeKeyedEntry` first

**An earlier draft of this section claimed `writeKeyedEntry` already supersedes
before inserting. It does not, and the claim was checked and disproved during
implementation on 2026-08-02.**

`notebook.service.ts:137` inserts the replacement and `:143` supersedes the
original — insert first. Both rows therefore satisfy the index predicate at the
same instant, so **the second coaching write for any learner fails with 23505.**
Not a race: the ordinary path, single-threaded. Verified by replaying that exact
statement order against the local test database with the index in place.

`supersedeEntry` in the same file documents the hazard precisely
(`notebook.service.ts:181-186`) — *"if the insert ran first, the old row (still
live) and the new row would both be live and both match the index predicate at
the same instant, and Postgres would reject the insert with 23505 **regardless
of statement order within the transaction**"* — and orders itself the other way.
`writeKeyedEntry` does the thing that comment warns against. It has never
failed only because no unique index covered `commitment`, its sole caller.

**`writeKeyedEntry` must be reordered to supersede → insert → link before this
index can be relied on.** `supersededBy` references the new row's id, so the
link is a third statement, exactly as `supersedeEntry` already does it.

Once reordered, the losing insert of a genuine race fails on the constraint, as
designed. Note that `writeKeyedEntry` has no `onConflictDoNothing` — unlike
`ensureFirstOpen` — so a genuine race surfaces as an unhandled error rather than
a silent no-op. That is acceptable for a guarded caller, and every call site
added in this slice is wrapped in try/catch.

---

## 7. Files

**New**

- `apps/api/src/services/buddy/coaching.service.ts` — the file §1 already names.
  `assembleSnapshot`, `readPriorFindings`, `refresh(userId, { force })`.
- `packages/shared/src/coaching/persistence.ts` — `carryForward`, pure.
- `packages/db/supabase/migrations/0034_coaching_analysis_index.sql`

**Changed**

- `NotebookService.writeKeyedEntry` — accept a full `source` payload rather than
  hardcoding `{ kind }`.
- `CommitmentService` — add `getSessionDates(userId, limit)`; add the
  last-completed-period lookup.
- `copy.ts` — add `analysisBody`; reword `commitment_gap`'s base string.
- Placement-completion and session-completion routes — call `refresh`.
- The notebook GET route — call `refresh` when stale.

---

## 8. Testing

Per §10, and per slice 1's defect #3: **every verification step names both the
test command and `pnpm typecheck`.** A step that names only a test command
cannot catch a type error in a test file, which is how slice 1 shipped a purity
test that passed vitest and failed typecheck with four errors.

| Lane | Covers |
|---|---|
| Shared | `carryForward` — transition-only stamping, the coalescing window, episode restart after a gap. `analysisBody`. The reworded copy. |
| API integration | `assembleSnapshot` field by field against the local test DB; the commitment period rule (a just-agreed commitment yields `commitment: null`); priors read back across a superseded row; priors surviving a delete; the correction signal; staleness gating. |

**Rebuild the local test DB first** — `docs/local-test-db.md`. A stale one reads
~5 phantom failures. It holds **7 kanji**, not 2,294.

**Do not "refresh" it reflexively** — re-running the migration list on an
existing database strips RLS.

API integration tests authenticate with a bare `x-test-user-id` header. There is
no `test/helpers/auth.ts`, only `test-app.ts`.

### Verifying the deploy

Per `docs/SOP.md`, status codes prove nothing here. Both:

1. An App Runner operation dated today.
2. **Response content** — a canary only the new build returns. For slice 2 that
   is a `coaching_analysis` entry appearing in `GET /v1/buddy/notebook` for a
   learner with a completed commitment period.

---

## 9. Out of scope

- LLM voice over the findings (slice 3).
- Companion mode (slice 4).
- The `CoCreationSheet` interaction for `hook_coverage`'s offer (slice 3, §14.4).
- A distinct coaching visual treatment and client-side instrumentation (slice 3).
- The §11.3 tier-2 daily cap — binds slices 3–4, still owed before launch.
- Evidence rendering. Slice 1 computes it; slice 2 stores the findings but shows
  prose only.
- Tutor notes as kanji evidence — §10, a candidate slice of its own.

---

## 10. Recorded for a later slice — a tutor's note is Japanese the learner has a reason to read

Raised by the owner 2026-08-02, while reviewing §6's rejected tutor trigger.
Recorded here rather than actioned: it is a taxonomy change to a section §14
already reviewed, and slice 2 is full.

### The objection that does not apply

§6 rejects a tutor trigger because a note is free text, and making free text
into evidence needs either an LLM reading prose or brittle keyword matching.

**That is true of the note's MEANING and false of its KANJI.** Extracting kanji
is a set intersection against a closed 2,294-row table — every character either
is or is not in `kanji`. No comprehension, no hallucination surface, and no
breach of §1's invariant that the LLM never sees a row.

### It is already half-built

| Where | What exists |
|---|---|
| `apps/mobile/src/components/notebook/TutorNote.tsx:13` | `KANJI_RE = /[一-鿿]/` — every kanji in a note is already individually tappable for lookup |
| `apps/api/src/services/kanji-readings-index.ts:20` | `CJK_RE = /[一-鿿]/` — the same range, server-side |

Spec decision #8 already committed to the premise, in `TutorNote`'s own header:
*a tutor may write in Japanese deliberately, to make the learner read it.* Notes
are never auto-translated for exactly this reason. What is missing is the join
between the characters in the note and what the learner is actually studying.

### The valuable intersection

`{kanji in note} ∩ {user_kanji_progress}`, split by status:

| Bucket | Use |
|---|---|
| Studying **and** struggling | The best hook candidate in the system — see below |
| Studying and doing fine | Recognition: authentic Japanese the learner can already read |
| Not yet studied | Preview, or noise — needs a level guard |
| Burned / remembered | Evidence of progress against real text |

### Why the hook case is the strongest

`pickHookCandidate` ranks on struggle evidence alone and breaks ties on
`kanjiId`, deliberately — *"a coach that suggests a different kanji each time
you reload is not a coach."* A kanji that **also** appears in a note from the
learner's own teacher strictly dominates an equally-struggling one that does
not: identical struggle signal, plus authentic context to build the mnemonic
around. Mechanically it is a bonus term in a pure function, shared-lane
testable.

It also changes the offer in kind. *"Build a hook for 難"* versus *"your teacher
used 難 writing to you last Tuesday — want to make that one stick?"* A hook
needs something to hang on, and a real memory outperforms an abstract card.

### It suits companion mode's constraints exactly

§5 forbids external lookups in v1 and requires facts to come from what we hold.
A tutor note is precisely that — local, authentic, learner-specific, zero
external calls, zero hallucination surface. It is arguably the best companion
mode material available, and it costs nothing to reach.

### Honest caveats — this is a cold path

- **Live has 1 tutor note and 1 accepted share** (2026-08-02). Real, but barely
  used. Do not size this as a hot path.
- **`tutor_notes.language` defaults to `'en'`.** Many notes will contain no
  kanji at all. Gate on extracted count, not on the column.
- **Short encouragement is mostly kana** and yields nothing.
- **A tutor writing naturally will use kanji far above the learner's level.**
  Intersecting with `user_kanji_progress` handles this; a bare "kanji you do not
  know yet" finding would be noise.

### Ask the tutor to write in Japanese — and tell them why

The value above depends entirely on notes containing kanji, and **nothing
currently asks the tutor for that.** Raised by the owner 2026-08-02.

**Where this lives, and it is cheaper than it sounds.** The tutor composes on a
server-rendered Eta page reached by token — `apps/api/src/templates/report.eta`,
posting to `POST /report/:token/notes` (`apps/api/src/routes/report.ts:134`).
No auth, no client app, **no EAS build**. It is an HTML template edit.

**It is already half-done.** `report.eta:891`'s textarea placeholder reads
*"Write guidance, observations, or encouragement for the student…
日本語でもメモを書けます。"* The invitation exists; what is missing is the
**reason**, which is what would actually change behaviour.

Two additions worth designing:

1. **Say what a Japanese note becomes.** Not "you may write in Japanese" but
   "notes in Japanese become reading practice — they can tap any kanji for a
   lookup, and Buddy will work through it with them." A tutor told the note is
   *material* will write differently from one told it is *permitted*.
2. **Show the tutor what the learner is currently working on.** A short list of
   in-progress and struggling kanji lets a tutor use them deliberately. This is
   the loop closing at its source: the tutor stops being a commentator and
   becomes an author of targeted practice, and the intersection above stops
   being incidental.

**Constraints.**

- **It stays a suggestion, never a requirement.** Decision #8's premise is that
  a tutor writes in Japanese *deliberately*; there are good reasons to choose
  English — nuance, a true beginner, anything pastoral. A nag would degrade the
  notes that matter most.
- **Check the share terms before surfacing a study list.** The tutor already
  receives a report and an analysis under an accepted share, so this is
  plausibly inside existing consent — confirm against `terms.eta` rather than
  assuming it.
- ⚠️ **`addNote` never sets `language`** (`tutor-sharing.service.ts:203`): it
  inserts `{ shareId, noteText }` only, so every note is `'en'` whatever the
  content. Either set it at write time or keep gating on extracted kanji count.
  Do not trust the column.

### How Buddy reinforces it

**Constraint first: §11.2 is CLOSED — companion mode is a single
free-conversation prompt with the snapshot as context, and there is no beat
engine.** What follows is prompt *material*, not a state machine. Anything here
that needs sequencing is a re-opening of §11.2, not an implementation detail.

| Beat | What Buddy does |
|---|---|
| **Orient** | "Your tutor wrote to you. Four of the kanji in it are ones you're studying." Points at the note; never translates it. |
| **Recognise** | "You can already read three of these." Progress against *real text a person wrote to them* — more convincing than any θ number. |
| **Offer the hook** | A struggling kanji from the note becomes the co-creation subject, with the note as the anchor. The strongest version of §14.4's offer. |
| **Read it together** | Encourage a read-through before tapping. `TutorNote` already makes every kanji tappable; Buddy supplies the reason to try first. |
| **Close the loop** | Later: "you read your tutor's note without a lookup." Worth telling the learner, and a candidate line for the outbound tutor report. |

**What Buddy must not do.** Translate the note (decision #8 — translation is an
explicit, visibly-recorded learner choice). Grade or critique the tutor's
writing. Or explain what the tutor *meant* — inferring intent from prose Buddy
cannot verify is precisely the hallucination minefield §5 rules out, and here
the learner has a human they can simply ask.

**Still owed before this is buildable:** whether note-derived signals enter §3's
taxonomy as findings or stay companion-mode-only material; which beats are
analysis mode versus companion mode; and whether a kanji met in authentic
context deserves a scheduling nudge — that last one touches FSRS and is a much
larger decision than it looks.

### If it is built

Snapshot gains a `tutor` field, assembled by joining extracted characters to
`kanji` and `user_kanji_progress`. **Do not add the field speculatively in slice
2** — slice 1's discipline was to build only what is used, and an unread field
is an invitation to fill it wrongly later.

Fits either as its own small slice or folded into slice 4, where companion mode
is the surface that would use it most. Note the two halves deploy independently:
the tutor-facing prompt is an Eta template edit shippable on its own, and it is
worth landing **early** regardless, because it is what makes the corpus of
Japanese notes exist for anything downstream to read.

---

## 11. Known follow-ups, recorded at merge — 2026-08-03

Found by the final whole-branch review. None blocks slice 2; all should be
settled before or during slice 3.

### 🔴 `commitment_gap` goes silent for a fortnightly learner

**Two definitions of "the period" now coexist, and they disagree.**

- `getLastCompletedPeriod` scales by cadence: `periodDays = 7 * intervalWeeks`
  (`commitment.service.ts:241`), so `commitment()` sums `daily_stats` across
  **14 days** for a fortnightly learner.
- `promisedMinutes` is `minutesPerDay × daysCommitted` — but that is the same
  quantity the in-session reckoning evaluates against a **fixed 7-day** window:
  `getActivity` hardcodes `PERIOD_DAYS = 7`.

A fortnightly learner promising 4 × 15 = 60 who studies 50 minutes in each of
two weeks has `actualMinutes = 100`, `missed = −40`, and `detectCommitmentGap`
returns null. Buddy says nothing, where the in-session reckoning would have said
"partial" — the going-quiet failure §4 exists to prevent.

**It errs toward silence rather than false accusation, and it is unreachable
today**: all five live learners have `buddy_interval_weeks = 1`. Fixing it means
deciding whether the promise scales with the period or the coaching window
matches `getActivity` — and whichever is chosen, `getActivity`'s own
half-fortnight behaviour probably wants the same decision.

Per-task review could not have caught this: one task wrote
`getLastCompletedPeriod` against the spec, another consumed it, and neither
brief pointed at `getActivity`.

### ✅ CLOSED before merge — the B146 basis swap now has a regression guard

`levelInterval` correctly builds bands from the whole difficulty corpus and
passes `bands.levels` to `inferredLevel`. Swapping in `JLPT_LEVELS` would
desynchronise `boundaries` (length n−1) from `levels` (length 5) and reproduce
B146 — but it is **invisible on any corpus containing all five JLPT levels**,
which both the test DB and production have. No integration test can catch it.

**Closed** by a pure shared-lane test over a sparse 2-of-5-level corpus, which
states the failure mode explicitly: the same boundaries paired with
`bands.levels` return `N1`, and paired with the full `JLPT_LEVELS` return `N4`.
`levelBands` and `inferredLevel` were already pure, so no database was needed —
which is exactly why the integration lane could never have covered it.

### ✅ CLOSED before merge — `updateEntryInPlace`'s concurrent-delete race

A delete landing between `readLatestKeyed` and the update used to leave
`refresh` reporting `'updated'` while no live coaching entry existed, and
overwrote the archived row's body. `updateEntryInPlace` now carries
`isNull(superseded_at)` and returns a rowcount; `refresh` falls through to the
insert path on zero rows, so the analysis lands rather than being reported as
written when it was not. Both guards proven by reversion.

### 🟡 Smaller items
- **`POST /v1/buddy/notebook/entries` accepts an arbitrary `source`.** A client
  posting `{"kind":"coaching_analysis"}` hits the unique index as an unhandled
  23505, or wins and resets finding memory. Unreachable from the shipped client,
  and 0032's `first_open` index carries the identical exposure on `main` today —
  0034 widens a pre-existing hole rather than opening one. Reject reserved
  source kinds in the route schema.
- **`RefreshResult.written: 'skipped'` is overloaded** across staleness-gated,
  empty-selection and lost-race, and the gated path returns `findings: []` while
  a live entry full of findings sits in the database. Harmless while all three
  call sites discard the result; **must be tightened before slice 3 renders from
  it.**
- **`assembleSnapshot` serialises four independent sections**, and `reviews()`
  and `hooks()` each independently issue the same two queries. One `Promise.all`
  and one shared read would fix both.
- **`levelInterval` scans the whole 2,294-row difficulty corpus per refresh** to
  compute an answer identical for every learner — and now sits inline before the
  `POST /v1/placement/complete` response, the most latency-sensitive moment in
  the product. Small at current scale; cache it when it stops being small.
- **`readLatestKeyed`'s `ORDER BY created_at DESC` has no tiebreaker**, and
  `sourcePayload` is spread after `kind` so a payload could retarget the index
  key. Both one-liners.
- **Migration 0034 is not represented in `packages/db/src/schema.ts`**, so
  `drizzle-kit generate` does not know it exists. Pre-existing pattern — 0032's
  `first_open` index has the same gap.
