# Session Handoff — 2026-08-03 latest (**Slice 3 is MERGED and DEPLOYED, B149 is building. Content verification cannot happen until Monday 2026-08-10. The copy floor is still not done.**)

> **Canonical URL — hand this to a new session:**
> https://github.com/radmelon/kanji-learn/blob/main/docs/HANDOFF.md
>
> *(This line is deliberately part of the artifact. A handoff that cannot state
> its own address makes every reader reassemble it from a bare path. Carry it
> forward into each new handoff section.)*

## START HERE — 2026-08-03 (latest)

> ## ▶️ What the next session does
>
> **The coaching copy floor.** It is now the only outstanding build work, its
> design is fully settled below, and slice 3 did not fix it. Transcribe the
> design; do not re-derive it.
>
> Two things are deployed but *unproven*, and neither blocks that work:
> slice 3's content check (see the next section — it cannot fire before
> **Monday 2026-08-10**) and the mobile EAS build.

### 🚀 Deploy status — 2026-08-03

PR #12 merged as `a90abb4`. Deployed in the required order, migration first.

| Step | Evidence |
|---|---|
| Migration 0035 → live | `BEGIN … COMMIT` clean. Verified after: `rls_enabled=t`, `rls_forced=t`, 2 policies, unique index present. |
| ECR image | digest `2a56d61e…` → **`79bbbdae…`**, pushed `2026-08-03T17:19:55-07:00` |
| App Runner | op `ea50e22c09d44bf6be6dd431cd3edfdf`, started `17:19:57` — **2 seconds after the push**, so the running image is this build and not a redeploy of the old one. SUCCEEDED `17:24:14`. Service RUNNING. |
| Health | `GET /health` → 200 `{"ok":true,"status":"healthy"}` |

### 🔴 Content verification is OPEN, and it cannot be done before 2026-08-10

`docs/SOP.md` requires response content on top of a dated operation, and a
status code does not count. **That check has not been done, and cannot be yet.**

The canary is `data.voice` on `GET /v1/buddy/session`, which needs an
authenticated learner whose session is **due** *and* who has findings. Traced
against `evaluateAppointment` for the owner
(`b8503589-1695-4659-b69d-b9e77d1cf655`) on live data:

- `buddy_day = 1` (Monday), `America/Los_Angeles`, weekly.
- Today **is** Monday 2026-08-03, so the anchor is today — but
  `getMostRecentAgreed` filters `source = 'session'` and returns week_start
  **2026-08-01**, only 2 days back. `anchorIsNewPeriod` needs ≥ 7.
- So the route returns **`waiting`, not `due`**, with `nextDue = 2026-08-10`.

Opening the app today will therefore show the waiting state and prove nothing
about slice 3. **Check on Monday 2026-08-10**, or after any learner reaches a
genuinely due session:

```bash
./scripts/with-live-db.sh psql -c "SELECT user_id, provider_name, left(text, 80), created_at FROM buddy_session_utterances ORDER BY created_at DESC LIMIT 5"
```

An empty table on 2026-08-10 after the owner opens a due session means the
utterance path did not run — start at the API logs for `[CoachingVoice]`.

⚠️ **A row with `provider_name` set proves the cache works; it does not prove
the LLM ran.** The `source` field distinguishes them and is only visible in the
HTTP response, not in the table — a template fallback is deliberately never
cached, so *any* row means the LLM path succeeded. An empty table with a working
session means the fallback ran every time.

### 📱 B149 is building and auto-submits to TestFlight

Cut 2026-08-03 23:09 from `main`, with the owner accepting the **~$2 overage**
(the allowance renewed 2026-08-04, one day later — see Housekeeping below).

- Build `53d65198-ae72-4104-b6e0-ecca0c547f22` —
  https://expo.dev/accounts/radmelon/projects/kanji-learn/builds/53d65198-ae72-4104-b6e0-ecca0c547f22
- Submission `9c11b49e-c485-4bcc-a614-bec2fcac64e4` (scheduled, fires on build
  completion) —
  https://expo.dev/accounts/radmelon/projects/kanji-learn/submissions/9c11b49e-c485-4bcc-a614-bec2fcac64e4
- B147 and B148 each took **~3h45m** start to finish, so expect the same.
- `buildNumber` bumped to 149 in `app.json` by `autoIncrement` and committed as
  `130fa72`, matching the precedent set by `d80625e` for 148.

⚠️ **Do not expect B149 to show anything new on its own.** Its entire
user-visible delta over B148 is:

| Change | Visible when |
|---|---|
| `voice` composed card (`buddy-session-state.ts`) | Only on a **due** session — **2026-08-10** |
| `buddy-session.tsx` `onClose` | Never — lint-only refactor, identical behaviour |

Everything else built since B148 — slices 1, 2 and 3's analyzer, copy and API —
is **server-side**, and B148 already exercises all of it against the deployed
API. Someone opening B149 on 2026-08-04 and seeing no change has not found a
bug; the session is not due until the 10th.

### 📦 What slice 3 added

Analysis mode, spec §§1–11:
https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-03-coaching-slice3-design.md

Plan, with the deploy runbook and the cost-measurement query:
https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/plans/2026-08-03-coaching-slice3-analysis-mode.md

On a due weekly session **with findings**, `GET /v1/buddy/session` now returns
an additive `voice: { text, source }` — one composed utterance instead of a
separate `opener` and `reckon`. `opener` and `reckon` stay in the payload, so a
shipped client is unaffected. The notebook entry is untouched by design: the
record stays template prose so it never varies with LLM availability, while the
conversation does.

New: `buddy_session_utterances` (migration 0035), `coaching-prompt.ts`,
`coaching-voice.service.ts`, a `coaching_utterance` LLM context, and a `voice`
card in the mobile session reducer.

**Verification, run at the end:** API 74 files / 565 tests · shared 41 / 469 ·
mobile pure 29 / 212 · mobile components 6 / 63 · `tsc --noEmit` clean for both
apps.

### 🚦 The deploy ordering — done here, but keep it for the next one

**Migration 0035 had to reach live BEFORE the API rolled out**, and did.
`scripts/deploy-api.sh` does not apply migrations and nothing enforces the
ordering, so this remains a manual step on every schema-touching slice.

⚠️ **Worth keeping because the failure mode is counter-intuitive.** If a
required table is missing, this feature does *not* fall back forever — a failed
cache read degrades to a *miss*, so it works **uncached, indefinitely**: Buddy
says something different on every app open and every open costs an LLM call.
The tell is paired `[CoachingVoice] cache read failed` / `cache write failed`
logs alongside an empty `buddy_session_utterances`. An earlier draft of the
plan's runbook described the opposite symptom and would have sent a verifier
looking for the wrong thing; it was corrected in `f95750b`.

### 🧾 Things a future reader will otherwise get wrong

- **`coaching_utterance` is registered tier 3 but runs on tier 2 today.**
  `BuddyLLMRouter` only reaches Claude when `userOptedInPremium === true`, and
  §5 deliberately never sets it. No premium flag exists in the schema, so every
  utterance uses the tier-2 providers and the tier-2 daily cap. The
  fortnight-later telemetry read is a **tier-2 measurement**. The registration
  is correct and forward-looking, not a bug.
- **The due GET is now non-idempotent** — it calls `refresh(force: true)`, which
  writes. Spec §7 justifies it: `RefreshResult.written: 'skipped'` is overloaded
  across three outcomes, and the staleness-gated path returns `findings: []`
  while a live entry full of findings sits in the database.
- **The LLM wait is bounded at 10s**, returning the template on timeout. That
  bound exists because `apps/mobile/src/lib/api.ts` aborts a GET at 30s and then
  **retries once** — an unbounded stall meant two forced refreshes, two LLM
  calls, two rate-limit slots, and an error screen at ~61s on the one surface
  the spec says must never regress.
- **`mechanics_explainer` never reaches the model.** It is filtered inside
  `buildCoachingPrompt` as well as at the call site, then appended verbatim
  afterwards, so a paraphrase is structurally impossible rather than
  instruction-dependent.

### 🔁 The ordering, restated honestly

The section below says the copy floor comes before slice 3. Slice 3 was built
first anyway, and that choice cost nothing in code — this slice consumes
`Evidence` generically and its fallback calls `analysisBody`, so the two never
collided. **But the reason for the ordering still stands and is now overdue:**

- The template floor under every slice-3 failure path *is* the copy the owner
  called "less than zero value". Slice 3 makes the good case better; it does not
  make the bad case less bad.
- The LLM path is better than that floor from day one, for exactly the reason
  slice 2 disappointed: the prompt actually reads `finding.evidence`, which
  `templateCopy` never does.
- The dead *"fuller explanation in your Profile"* pointer is still live in
  production. Slice 3 appends `templateCopy(mechanics, now)` verbatim, so the
  copy floor's fix will flow through here with no change.

Design for the copy floor is fully settled in the section below — transcribe it,
do not re-derive it.

### 🧪 What the review process caught, and what it says about plans

Every task was implemented by a subagent and gated by an independent reviewer.
The reviewers found real defects **in the plan's own test code**, three times:

- An assertion that passed under the very mutation its comment claimed to catch,
  because the fixture text happened to contain the same digit.
- A test whose comment named a mutation that was structurally uncatchable.
- A route test that was a strict duplicate of its neighbour and claimed to prove
  a guard it never exercised.

The whole-branch review then found what no per-task review could see: **the
route's happy path had no coverage at all.** Deleting the entire `voice` spread
from the reply left the suite green, and the same gap meant nothing anywhere
pinned `force: true` — the one line the spec calls "not optional".

Reviewers also caught an inaccurate factual claim in nearly every implementer
report — wrong line numbers, wrong line counts, an edit that was never made, and
one **fabricated test transcript** printing Jest's vocabulary for a Vitest lane.
The code was fine in each case; the reports were not.

**The lesson for the next plan: test code written into a plan is not
independently checked unless someone checks it.** Slice 2's retrospective said
tests must name the mutation they catch. That was right and insufficient — the
naming itself has to be verified, because a confident comment on a test that
cannot fail is worse than no test.

---

# Previous — 2026-08-03 later (**Slice 2 is LIVE and verified. It works, and the note it writes is useless. Fix the copy floor BEFORE slice 3.**)

## Previously START HERE — 2026-08-03 (later)

> ## ▶️ What the next session does
>
> **Write the spec and plan for the coaching copy floor, then execute it.**
> The design is fully settled below — transcribe it, do not re-derive it.
>
> Target: `docs/superpowers/specs/2026-08-03-coaching-copy-floor-design.md`
>
> **This comes BEFORE slice 3**, whose spec is already written and committed
> (§ "Slice 3 is specced and waiting" below). The reason is in the next section.
>
> Shared lane only — `packages/shared/src/coaching/`, pure functions, **no
> migration and no EAS build.** It deploys to the notebook the owner is already
> reading.

### ✅ Slice 2 is verified end to end — and that is how we learned the copy is useless

The owner opened the Journal on their own account and got exactly this:

> *"You have cleared the hardest kanji the test put in front of you. Your
> placement puts you around this level, with some room either side. A handful of
> kanji keep slipping back no matter how often they come around."*

Their verdict: *"Overall Buddy has provided me less than zero value with this
note."* They asked which test and when, what "this level" refers to, which
kanji are slipping, and what they are supposed to do about it.

**The pipeline is correct. The copy is the defect.** `templateCopy` reads
`finding.kind` and nothing else — it looks up a static string per kind and
returns it. **`finding.evidence` is never touched.**

That inverts §1's stated purpose. The spec says `Evidence.label` is display-safe
text computed in the analyzer *"so the voice layer has nothing left to
calculate — that is the load-bearing invariant of §1."* The whole point of
precomputing it was for the copy layer to use it. It never does.

Every one of the owner's questions had an answer sitting unused in the finding:
`level_estimate` carries `most likely level: N4` while its copy says *"this
level"*; `leech` carries the worst kanji **named, with lapse counts**, while its
copy says *"a handful"*.

**What the review process missed.** Fifteen fix cycles went into whether the
plumbing was correct — write ordering, coalescing keys, finding memory — and not
one asked whether the output was *useful*. The reviewers checked everything
except the thing a learner would actually read.

### 🔬 The audit — all ten kinds

The question asked of each: *what would a learner ask next, and can the evidence
answer it?*

| Kind | Class | Learner's next question | Answerable today? |
|---|---|---|---|
| `reading_lag` | Direct | By how much? Kun or on? What do I do? | Gap ✅ · **kun/on ❌** · action ❌ |
| `leech` | Direct | Which kanji? How often? What do I do? | Named kanji ✅ · action ❌ |
| `commitment_gap` | Direct | By how much? Which period? Now what? | Minutes ✅ · **dates ❌** · action ❌ |
| `hook_coverage` | Direct | Which kanji? | ✅ **in evidence, unused by copy** |
| `level_estimate` | Orient | What level? What range? When? | Level+range ✅ · **date ❌** |
| `mechanics_explainer` | Orient | Where is the fuller explanation? | 🔴 **points at a page that does not exist** |
| `fluency_gain` | Motivate | How much faster? Over what period? | Speed ✅ · **window ❌** |
| `theta_delta` | Motivate | By how much? Between when? | ✅ **fully equipped, all unused** |
| `hardest_cleared` | Motivate | Which one? Hard how? When? | Kanji ✅ · **basis ❌** · **date ❌** |
| `retest_due` | Motivate | How long? What is "uncertainty"? Where? | Days ✅ · jargon ❌ · location ❌ |

### 🔴 `mechanics_explainer` promises a page that does not exist

Its template says *"There is a fuller explanation in your Profile."* **There is
no IRT section in Profile** — §7 schedules it as slice 5. Verified by grep.
That string is live in production sending learners to a dead end, on the one
finding whose entire purpose is building trust.

**Decision: remove the pointer sentence now; slice 5 restores it when the page
exists.** Keep the two-sentence IRT explanation, which stands alone.

### 📐 The design — settled, transcribe it

**Three changes:**

1. **`templateCopy` becomes per-kind formatters** — `Record<FindingKind, (f:
   Finding, now?: string) => string>` replacing the static `BASE` record. Each
   formatter reads its own finding's `Evidence`.
2. **Evidence labels become exported constants**, shared between the detector
   that writes them and the formatter that reads them. Otherwise formatters
   match label strings and a rename silently yields "undefined" — the exact
   failure mode that produced the note above.
3. **Detectors emit what the audit found missing:** `completedAt` on
   `hardest_cleared` and `level_estimate`; `periodStart`/`periodEnd` on
   `commitment_gap`; the window length on `fluency_gain`; `strokeCount` and
   `readingCount` on `hardest_cleared` so it can say what "hard" means.

**Degradation rule:** a formatter that cannot find its evidence returns the base
sentence. Never "undefined", never a half-built one. `reading_lag` matters most
— its evidence differs depending on whether it fired from placement or quiz.

**Actions are VERBAL, not interactive.** The notebook renders plain text and
`NotebookBody` has no action affordance. Naming the specific kanji and the
specific move is most of the value; a tappable button would need a client
contract change, mobile work and a build. Verified reachable: co-creation opens
from `apps/mobile/app/kanji/[id].tsx` and `study.tsx`, so "look it up and build
a hook" is a real instruction.

**The four Direct findings, with their actions** (the spec should carry all ten):

> **leech** — Four kanji keep slipping back: 敗 has lapsed 4 times, 語 3, 使 and
> 去 twice each. **敗 is the one to work on first** — look it up and build a hook
> for it, which is what usually stops this.

> **hook_coverage** — **敗** keeps catching you out. Building a hook for a kanji
> tends to make it stick — want to make one together?

> **commitment_gap** — You promised 60 minutes between 20 and 26 July and
> studied 20. Worth naming rather than ignoring — **bring it to your next
> session** and we will set something you will actually hit.

> **reading_lag** — Your readings are trailing your meanings, 62% against 88%
> across 24 answers — wider than the usual gap. **Next time you study, say the
> reading aloud before you flip.**

**Testing:** every formatter tested twice — once with full evidence, once with
evidence stripped, to prove the degradation path. **Each test names the mutation
it catches.** That discipline is what was missing when this shipped.

### ⚠️ "Hardest" needed explaining, and the answer changes the copy

The owner asked what `hardest_cleared` means by hard — strokes? JLPT? rarity?

`b` (item difficulty) is a weighted sum of five z-scored features
(`placement-difficulty.ts:112`): JLPT rank, log frequency rank, school grade,
stroke count, and reading count. That prior is then blended with observed
learner performance from `review_logs`.

**Two things worth knowing.** First, the blend is currently **inert** —
`observed_n = 0` for these kanji, so `b = b_prior` exactly. "Hardest" today
means hardest *by feature model*, not by how learners actually perform. Second,
their hardest-cleared was **願 (N3, 19 strokes, 3 readings, b=1.01)**, which
outranked **刊 (N2, 5 strokes, b=0.95)** and **筆 (N2, 12 strokes, b=0.94)**.

**So a bare superlative invites a JLPT lookup that makes it look wrong.** The
copy should carry its own justification — *"the hardest item it gave you, at 19
strokes and three readings; the test weighs those alongside JLPT level"* — which
is why `hardest_cleared` needs `strokeCount`/`readingCount` in evidence.

### ⏸️ Deferred, deliberately

- **`reading_lag`'s kun-vs-on split.** Does not exist anywhere in
  `LearnerSnapshot` — `CardSnapshot` has `readingStage` but no per-reading-type
  accuracy. That is a detector *and* assembly change, not a passthrough. Say
  "readings" without the split.
- **Finding ORDER.** The owner got praise, then orientation, then the actual
  problem. That is §4 working as designed — the primary sort is
  `magnitude × confidence × novelty`, and §3's Direct/Orient/Motivate priority
  only breaks ties, so a strong Motivate finding outranks a weak Direct one.
  Their reaction suggests that may be wrong, but changing it is a §4 decision
  with wider blast radius than copy.

### 📄 Slice 3 is specced and waiting

https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-03-coaching-slice3-design.md

Analysis mode: the LLM voices the weekly session; the notebook keeps template
prose. Fully designed, not started. **It does not fix the note above** — that is
precisely why the copy floor goes first. Slice 3 also needs an EAS build; the
copy floor does not.

---

# Previous — 2026-08-03 earlier (**deploy verification — now CLOSED, see the section above**)

> ## ▶️ What that session asked for (DONE)
>
> **Finish the content half of the deploy verification.** ✅ **Closed** — the
> owner opened the Journal, the coaching entry appeared, and reading it is what
> surfaced the copy defect the current section is about.
>
> Everything else was already done: PR #11 merged (`6fdf02c`), migration 0034
> applied to live, and the API deployed 2026-08-03 08:33–08:36 PDT.
>
> The artifact chain is proven — ECR digest went `9fce6c9e…` → `2a56d61e…`,
> pushed 08:33:04, deployment triggered 08:33:06 two seconds later, SUCCEEDED
> 08:36:54, service RUNNING, `/health` 200. So the new code *is* what is
> serving, not a redeploy of the old image.
>
> **What is NOT yet proven is response content**, which `docs/SOP.md` insists on
> separately and for good reason. The coaching entry is only written when a
> learner actually hits a trigger, and that needs authentication no automated
> check here can supply.
>
> **To close it:** have learner `b8503589-1695-4659-b69d-b9e77d1cf655` open the
> notebook in the app, then confirm a row appears:
>
> ```
> ./scripts/with-live-db.sh psql -c "SELECT body, source->>'analyzedAt' FROM notebook_entries WHERE source->>'kind'='coaching_analysis'"
> ```
>
> That learner was chosen deliberately: 4 completed placements (θ 1.145, N4),
> 596 cards, 31 lapses — enough to fire `level_estimate`,
> `mechanics_explainer`, `theta_delta` and probably `leech`. A learner with no
> data would make "no row" indistinguishable from "feature broken".
>
> ⚠️ **`commitment_gap` will NOT fire for them, and that is correct.** Their only
> session commitment starts 2026-08-01, so its period ends 08-08 and has not
> completed. Do not read its absence as a fault — it is the rule that exists to
> stop Buddy greeting a learner with "you studied less than you promised
> yourself" the moment they commit.
>
> Spec:
> https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-02-coaching-slice2-design.md
> Plan:
> https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/plans/2026-08-02-coaching-analyzer-slice2.md
>
> **Read the spec's §11 first.** It records what the final review found,
> including one behaviour worth an owner decision before slice 3.
>
> **No EAS build is needed and none should be cut for this.** The slice is
> API-only by design — zero `apps/mobile` files changed.

### ▶️ Next effort: brainstorm slice 3 — but it inherits four open decisions

Slice 3 is §12's *"conversational surface — the prompt module, analysis mode in
the weekly session, and the LLM voice over slice 1's findings."* It cannot be
planned until four things are settled, and a brainstorm is the right vehicle
for all four. Full analysis in the parent spec's §14 → §11.3.

**1. 🛑 Tier 1 is a stub on the server, so the "free" cost floor does not exist
on the API path.** `server.ts:94` wires the router's on-device slot to
`AppleFoundationStubProvider`, which always reports unavailable and throws if
asked to generate — structural, since a server cannot run an on-device model.
Every tier-1 request through the API falls through to tier 2.

**iOS native AI is nonetheless real**, in the client and bypassing the router:
`apps/mobile/src/mnemonics/assembleOnDevice.ts` drives the actual
`AppleFoundationModels` TurboModule with its own on-device → cloud → template
cascade. So there is a proven client-side pattern; it just is not wired to
anything the coaching feature uses.

**2. Where companion mode's cheap turns run** — server (tier 2, metered, throws
on exhaustion) or client (on-device, free, already proven). This decides whether
slice 4 is API-first or client-first, so it wants settling before slice 3 fixes
the shape of the prompt module.

**3. What happens when the cap is reached.** Tier 2 is the universal floor —
tier 1 and tier 3 both fall through to it — and hitting *its* cap throws
`'Tier 2 daily cap reached; no lower tier available'`. Analysis mode has §1's
template floor for that; **companion mode is free conversation and has none.**
The number itself should be set last, from a cost-per-turn measurement slice 3
will produce. Verified 2026-08-03: neither cap env var is set in plaintext or
secrets, so production runs the `env.ts` defaults of 50/day tier 2 and 5/day
tier 3. `GROQ_API_KEY` and `GEMINI_API_KEY` **are** set — tier 2 is correctly
configured, so do not go hunting for a broken provider.

**4. §11.4's `CoCreationSheet` interaction.** Whether the sheet opens over a
Buddy session or the session hands off to it. §14.4 says to size this before
slicing it, and B-224's history says the co-creation commit path is subtle.

**One code prerequisite, small:** `RefreshResult.written: 'skipped'` is
overloaded across staleness-gated / empty-selection / lost-race, and the gated
path returns `findings: []` while a live entry full of findings sits in the
database. Harmless today because all three call sites discard the result —
slice 3 is the first thing that *renders* from it.

### ✅ What landed — 30 commits, 21 files, API-only

The coaching analyzer now runs end to end: a `LearnerSnapshot` assembled from
seven Postgres tables, slice 1's pure `analyze()` run over it, and the top
findings written as a superseding `notebook_entries` row.

| Lane | Result |
|---|---|
| `pnpm typecheck` | **4/4** |
| shared | **469** (453 pre-existing + 16 new), 41 files |
| API | **530 passed, 0 failed**, 70 files (baseline was 448/65) |
| mobile pure | **207** — unchanged, nothing touched it |
| mobile components | not run — no client change to test |

Every number was produced this session, not carried forward.

⚠️ **Do not run two `vitest` processes against the test DB at once.** Doing so
produced two phantom failures during verification. `fileParallelism: false`
guards within a run, not across two processes.

### 🔵 The finding memory needed no new table — both §13 "blockers" dissolved

The 2026-08-02 handoff predicted slice 2 "needs a migration first": a JSONB
column or findings table for `priorFindings`, and a `buddy_sessions` table for
`HookSnapshot.sessionDates`. **Both already had sources.**

- `notebook_entries.source` was already `jsonb`, already unconstrained, and
  already the supersede key via `source->>'kind'`.
- `buddy_commitments.week_start WHERE source='session'` is already how
  `getMostRecentAgreed` and `evaluateAppointment` define "a session happened".
  Inventing a second definition would let two parts of the system disagree
  about the same learner.

The slice carries **one** migration: `0034_coaching_analysis_index.sql`, a
partial unique index permitting one live coaching row per learner.

### ✅ Migration 0034 IS applied to live — 2026-08-03

Verified from the catalog, not from an exit code: the index exists with the
exact predicate (`source->>'kind' = 'coaching_analysis' AND superseded_at IS
NULL`), `indisvalid` and `indisunique` are both true, and RLS on
`notebook_entries` is **still enabled and forced with both policies intact** —
checked because this repo's docs warn that re-running migrations strips RLS.
The single additive file was applied, not the migration list.

It was safe to apply ahead of the deploy because the predicate only matches
`coaching_analysis` rows, and the build running in production today writes only
`commitment`, `first_open` and `onboarding_*` — so the index is **inert until
the new code ships**.

**The remaining ordering fact, for the record:** `writeKeyedEntry` was reordered
to supersede → insert → link because the old insert-first order fails with 23505
against this index, on the ordinary second write rather than a race. The
reordered code is correct with or without the index; the index without the
reorder would have broken onboarding. Both are now in place.

### 🟠 The one behaviour worth an owner decision — `commitment_gap` goes silent fortnightly

Two definitions of "the period" now coexist. `getLastCompletedPeriod` scales by
cadence (`7 × intervalWeeks`), but `promisedMinutes` is the same quantity the
in-session reckoning evaluates against a **fixed 7-day** window in
`getActivity`.

A fortnightly learner promising 4 × 15 = 60 who studies 50 minutes in each of
two weeks reads as `actual 100`, `missed −40` — no finding. Buddy says nothing
where the in-session reckoning would have said "partial".

**It errs toward silence rather than false accusation, and it is unreachable
today: all five live learners are weekly.** Fixing it means deciding whether the
promise scales with the period or the coaching window matches `getActivity` —
and whichever is chosen, `getActivity`'s own half-fortnight behaviour probably
wants the same decision. Full detail in the spec's §11.

### 🧠 What this build actually cost, and what it caught

Ten tasks, each with a fresh implementer and an independent review, then a
whole-branch review. **Roughly fifteen fix cycles.** Every cycle found something
real. The five worth remembering:

1. **`commitment_gap` scored the maximum any finding can reach at the instant a
   learner agreed a commitment** — greeting them with "you studied less than you
   promised yourself", every period. The detector was correct; *which* period it
   received was assembly's decision.
2. **`writeKeyedEntry` inserted before superseding**, so migration 0034 would
   have made every learner's second analysis a 500. The spec asserted the
   opposite; that sentence was wrong.
3. **An in-place update destroyed learner-authored text** — a learner edits
   Buddy's observation, a session completes, and their words are overwritten
   while the row still reads `author: 'learner'`.
4. **Coalescing keyed off `analyzedAt`**, which moves on every in-place update,
   so a finding true since March would read `since: today` — permanently. The
   exact inversion of the parent spec's §4.
5. **A reported RED proof was misattributed.** Three tests were cited as proving
   a fix; all three actually failed on a *different* line, leaving the real fix
   unguarded.

**The transferable lesson: a plan that specifies test code should specify the
mutation each test is meant to catch.** Once dispatches started asking "name the
mutation this test catches, then find a guarantee with no such test",
implementers began finding their own gaps before review did — and two did.

### Housekeeping

- Branch `coaching-analyzer-slice2` is pushed; `main` is untouched at `6ebe0d5`.
- Slice 1's branches (`coaching-analyzer-slice1`, `fix/red-ci`) are merged and
  can still be deleted.
- **§12's remaining slices are unchanged:** 3 (conversational surface), 4
  (companion mode), 5 (IRT explainer), 6 (goal beat). 5 and 6 reorder freely.
- **New and not in §12:** the spec's §10 records tutor notes as kanji evidence —
  extracting kanji from a tutor's Japanese note is a set intersection against a
  closed table, not prose comprehension, and `TutorNote.tsx` plus
  `kanji-readings-index.ts` already do the extraction at both ends. Its
  tutor-facing half is an Eta template edit worth landing early, because nothing
  downstream can read a corpus of Japanese notes until that corpus exists.
- **§11.3's tier-2 daily cap is still unsized** and still owed before launch. It
  binds slices 3–4, not this one.

---

# Previous — 2026-08-02 later (**Coaching analyzer slice 1 is MERGED. CI is green again after 28 red runs. Slice 2 waits on a spec refresh — §13's "nothing blocking" is now false.**)

> **Canonical URL — hand this to a new session:**
> https://github.com/radmelon/kanji-learn/blob/main/docs/HANDOFF.md
>
> *(This line is deliberately part of the artifact. A handoff that cannot state
> its own address makes every reader reassemble it from a bare path. Carry it
> forward into each new handoff section.)*

## START HERE — 2026-08-02 (later)

> ## ▶️ What the next session does
>
> **The owner is refreshing the slice 2 spec** against what slice 1 actually
> produced (decided 2026-08-02). **Do not write the slice 2 plan until that
> refresh lands** — the current spec makes one claim that execution disproved.
>
> **Read "📋 Input for the slice 2 spec refresh" below first.** It lists what
> the refresh has to reconcile, which of §11's open decisions actually bind
> slice 2 (one of the two does not), and the single design decision that is
> owed before any of it can be planned.
>
> Slice 1 is **merged** (PR #9, merge commit `7cc9f09`). `main` has it. Nothing
> in it is user-visible; it is the spine every later slice imports, and
> **nothing imports it yet** — that is expected, not an omission.
>
> **Do not cut a build to "ship" slice 1.** It is pure, unreferenced shared
> code; a build would carry a zero-byte user-visible delta. Verified
> 2026-08-02: the only `apps/mobile` change since B148's content commit
> (`297d301`) is a behaviour-identical lint fix and a devDependency.

### 🟢 CI is green on `main` again — and it had been red for 28 straight runs

Merged as PR #10 (`7d5c062`). **None of the three failures was a product
defect, and `main` has no branch protection**, so nothing was ever gated on CI
— which is exactly how they accumulated unnoticed across two days.

| Check | Had been red since | Real cause |
|---|---|---|
| Lint | `2cab737`, 2026-08-01 | `buddy-session.tsx:22` used a ternary as a statement |
| Typecheck | `d07fff6`, 2026-08-02 | B-228's `fsrs-copy-claims.test.ts` uses `fs`/`__dirname`; `apps/mobile` never declared `@types/node` |
| EAS Preview | **never passed — 24/24 since 2026-04-13** | `EXPO_TOKEN` has never been set |

⚠️ **The typecheck one is the trap worth remembering: it passed locally and
failed only in CI.** TypeScript was resolving `@types/node@20.19.37` out of the
pnpm virtual store — an accident of one machine's install layout that a clean
`pnpm install --frozen-lockfile` does not reproduce. **`pnpm typecheck` passing
locally is not evidence that CI typecheck passes for `apps/mobile`.** The
dependency is now declared, so it is deterministic rather than incidental.

**EAS Preview now SKIPS when `EXPO_TOKEN` is absent** rather than failing —
deliberately a skip, not a green no-op, because a check reporting success
without building anything is the false-signal trap `docs/SOP.md` warns about.
To enable it you must set `EXPO_TOKEN` plus the three `EXPO_PUBLIC_*` secrets,
which all currently resolve empty. **Note its paths filter includes
`packages/shared/**`** — once enabled it fires an iOS *and* Android build on
shared-only PRs, which is most coaching work. Check the EAS allowance first.

**Still open, and it is the root cause:** `main` has **no required status
checks**. Repairing the lanes without gating on them means this recurs. Left
undone deliberately — it is an owner decision.

### ✅ What landed — the pure analyzer, entirely in `packages/shared/src/coaching/`

`Finding` / `LearnerSnapshot` contracts, per-kind magnitude helpers, nine
detectors across four Direct + two Orient + four Motivate, the selection
policy, template copy for every kind, and `analyze()` composing them.
Re-exported from `@kanji-learn/shared`.

Built TDD from
https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/plans/2026-08-02-coaching-analyzer-slice1.md
— every task red→green, one commit each.

| Lane | Result |
|---|---|
| `pnpm typecheck` | **4/4** — the new barrel export is visible to `apps/api` and `apps/mobile` with no name collision |
| shared | **453** (343 pre-existing + 110 new), 39 files |
| mobile pure | **207** — unchanged |
| mobile components | **63** — unchanged |
| API | **448 passed, 0 failed** across 65 files — identical to the last session, so no stale-DB drift |

Every lane was actually run this session; none of these numbers is carried
forward from the previous handoff.

### ⚠️ THE ONE THING THAT BLOCKS THE FEATURE — `priorFindings` has nowhere to live

This was known before execution (it is in the plan's calibration section) and
execution did not change it. Stating it here because it is the difference
between "slice 2 is a week of plumbing" and "slice 2 needs a migration first".

`notebook_entries.body` is plain `text`. There is **nowhere to read a finding's
`kind` + `since` back from**, and **§4's entire decay mechanism depends on
it**. Without that memory:

- every finding is permanently novel — `novelty()` returns 1 forever;
- the escalation in §4 can never fire, so Buddy can never say *"readings
  again — let's try something different"*;
- a persistent problem and a brand-new one are indistinguishable at selection
  time, which is precisely the coaching failure the policy exists to prevent.

`select()` handles an empty `priorFindings` array correctly, so this did **not**
block building slice 1. **Slice 2 must add a JSONB column or a findings table
before the decay behaviour can be tested against anything real.**

Second, smaller gap of the same shape: **`HookSnapshot.sessionDates` has no
source** — no `buddy_sessions` table exists. `hook_coverage`'s staleness half
(the learner who built three hooks in week one and none since) silently
degrades to the zero-hooks branch without it. Candidates are
`buddy_conversations.created_at` (2 rows) or `buddy_commitments.week_start`.

### 📋 Input for the slice 2 spec refresh

Spec:
https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-01-buddy-coaching-analysis-design.md

Slice 2 is **"snapshot assembly + the notebook surface"** — per §12 the **first
user-visible slice**, and therefore the first one that could justify a build.
Four things the refresh has to reconcile.

**1. 🔴 §13 "Dependencies — None blocking" is now FALSE for slice 2, and it is
the highest-value correction in this list.** That line was written 2026-08-01,
*before* slice 1's calibration pass and execution. Two `LearnerSnapshot` fields
have no source in Postgres — `priorFindings` and `HookSnapshot.sessionDates`,
both detailed in the ⚠️ section above. §13 currently tells a planner the road
is clear when it is not. §14 repeats the claim ("§13's 'no blocking
dependencies' holds") in the `hook_coverage` discussion; that instance is about
`review_logs`/`test_results`, which *is* true, so **correct §13 without
invalidating §14's narrower point.**

**2. 🟢 §11.3 (Tier-2 daily cap) is still unsized — and does NOT block slice
2.** It is the one open decision left, and it is easy to read as a gate on
everything. It is not. Slice 2 is **template copy only and works with the LLM
off** (§12), so the cap binds **slices 3–4**, where companion mode makes LLM
calls the common path. Do not let it hold up slice 2; do not let slice 2's
progress make it look resolved either — the number is still owed before launch.

**3. 🟢 §11.4's residual `CoCreationSheet` interaction is a slice 3 concern.**
§14's ⚠️ is explicit that the undesigned part is offering co-creation *inside a
Buddy session* — whether the sheet opens over the session or the session hands
off. The **notebook** surface only has to render `hook_coverage`'s offer as
text, with the named kanji slice 1 already picks. Worth stating in the refresh
so a slice 2 planner does not inherit a slice 3 design problem.

**4. ❓ The one decision genuinely owed before slice 2 can be planned: where
`priorFindings` lives.** JSONB column on `notebook_entries` versus a dedicated
findings table. This is a real design call, not a coin flip — it decides how
superseding entries work, whether a finding's history survives an entry being
replaced, and whether `since` is queryable or has to be reassembled. It wants a
brainstorm, and it is a migration either way.

**What slice 1 settled, so the refresh can now assume it:** the contracts are
real and tested, not proposed. `LearnerSnapshot` and its sub-shapes are the
literal input signature; the nine detectors, `select()`, and the template floor
all exist with 110 tests. The refresh can write against those shapes rather
than describing them.

⚠️ **And one trap for whoever assembles the snapshot:** every detector sets
`since: null`, and **`select()` is the only place that stamps it** from
`priorFindings`. A caller that skips `select()` and uses raw detector output
loses the persistence signal that makes §4's escalating framing work — silently,
with no test failing.

### 🔎 The plan's own code was wrong in three places, and only running it found them

Full table in the plan doc under **"✅ EXECUTED 2026-08-02"**. Short version:

1. **`normaliseSaturating` returned exactly `1`.** `1 - Math.exp(-value/scale)`
   is `1` in IEEE 754 once the exponent passes ~37. Caught by *the plan's own
   "never reaches 1" test*, so the step's stated "Expected: PASS, 9 tests" was
   unreachable as written. Now clamped to `1 - Number.EPSILON` — the property
   matters because `commitment_gap` sets `confidence: 1` deliberately and a
   count-derived confidence must stay distinguishable from a measurement.
2. **A test file used `QuizOutcome` without importing it** — fails
   `pnpm typecheck`, which covers `src` including tests.
3. **The purity test used `fs` + `__dirname`.** `packages/shared` has no
   `@types/node` *by design*; it passed under vitest and failed `pnpm
   typecheck` with four errors. Rewritten over Vite's `?raw` glob — no Node
   types, same file set — because adding `@types/node` would have broken the
   plan's own "no new dependencies" constraint.

**The transferable lesson, and it is not "plans have typos":** #1 and #3 are
both a plan *verifying itself against the wrong thing*. #3 passed the one
command its step named and failed a command that step never mentioned. **A plan
step that names a test command but not the typecheck command cannot catch that
class of defect** — future plans should name both in every verification step.

#1 is the better case and worth keeping in mind: the test encoded a property
the plan's own implementation could not satisfy. It surfaced only because the
step was actually run rather than eyeballed as obviously-fine arithmetic.

### Housekeeping

- `main` is at `7cc9f09` with both PRs merged (#9 slice 1, #10 the CI repair).
  Branches `coaching-analyzer-slice1` and `fix/red-ci` are merged and can be
  deleted.
- The plan doc carries an **"✅ EXECUTED"** section at the top with the defect
  table — it landed with the code.
- **EAS allowance resets 2026-08-04 (Tuesday).** As of 2026-08-02 roughly one
  build remains inside the allowance; the owner has authorised overage builds
  (~$2 each) through Tuesday **if there is a reason to cut one**. There was
  not, at the time of writing — see the "do not cut a build" note above.
  **Slice 2 will not change that before the reset**: it is the first
  user-visible slice, but it opens with a spec refresh and a migration
  decision, so it is not a one-day piece of work. If a build is wanted before
  Tuesday it should carry mobile bug fixes (B-230 is filed and unfixed —
  `[Effort: XS — copy, or S if derived from the constants]`) batched with
  anything else worth testing — not slice 2.
- Local test DB was **not** rebuilt this session; it was left green earlier
  today and the API lane was run against it as-is. `docs/local-test-db.md` is
  emphatic that re-running the migration list on an existing DB *strips RLS* —
  do not "refresh" it reflexively.

---

# Previous — 2026-08-02 (**B148 is cut and submitted. Next session starts the coaching analyzer.**)

## START HERE — 2026-08-02 (superseded by the section above)

> ## ▶️ What the next session does
>
> **Execute slice 1 of the coaching plan.** Everything it needs is written:
>
> **https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/plans/2026-08-02-coaching-analyzer-slice1.md**
>
> Ten TDD tasks, complete code in every step, `packages/shared/src/coaching/`
> only. **No database, no LLM, no API, no surfaces** — it runs entirely in the
> shared lane, which is sub-second and green today. Use
> `superpowers:subagent-driven-development` (a fresh subagent per task, review
> between) or `superpowers:executing-plans`.
>
> **Do not widen it.** The spec's §12 says outright it *"should not become one
> undifferentiated plan"* and names six slices; this is the first. Slices 2–6
> get their own plans, written against the real shapes slice 1 produces.
>
> Nothing in slice 1 is user-visible, and that is the point: every number the
> coaching feature will ever say to a learner is computed there.
>
> ⚠️ **The plan was amended after it was first written** (`ca1303b`). Tasks 1
> and 2 changed: `reading_lag` now takes **two** evidence sources, and the quiz
> question-type vocabulary is pinned to what actually exists on live. If you
> read the plan before that commit, re-read those two tasks.
>
> **Slice 1 needs no database.** The corpus import below matters for the API
> lane, not for this work — `pnpm --filter @kanji-learn/shared test` is the
> only lane it touches.
>
> **Read the plan's "Calibration against live data" section before Task 3.**
> Every threshold was checked against production on 2026-08-02 and **two
> detectors could never have fired**. Both are rewritten, but the section also
> records which constants are still guesses and which four `LearnerSnapshot`
> fields are not fillable as written.

### ✅ B148 is cut, submitted, and carries every bug fixed today

| | |
|---|---|
| Build | `da575c43-f647-4351-ad8a-ee9a63825452`, buildNumber **148** (EAS `autoIncrement`, never hand-bumped) |
| Content | `297d301`; bump recorded as `d80625e` |
| Submission | `42077dae-bca9-433b-b033-b66ea4171cd2` — `finished`, `distribution: store` |
| Pre-build gate | All green. **The API-behind check returned empty** — the B-214 trap the SOP exists for |
| API on live | `sha256:9fce6c9e…`, operation `e6cb4717` **SUCCEEDED** 10:19:33 → 10:23:25, `/health` 200 in 0.49s |
| `main` | `ca1303b`, pushed, tree clean |

Lanes at end of session: typecheck **4/4** · shared **343** · mobile pure
**207** · components **63** · **API 448 passed, 0 failed, 0 skipped** — run
twice back to back to prove idempotence.

**That last number is new twice over.** The API lane had standing red for
weeks; both failures turned out to be environmental. Then the corpus import
below un-skipped two tests that had never run at all.

### 🔴 B-229 — the placement test measured the wrong thing, corpus-wide

`e3e762e`, **deployed and in the build.** `kanji.meanings` is stored
alphabetically, and ASCII sort puts digits and capitalised proper nouns first,
so `meanings[0]` — what both instruments keyed on — was a clock hour or a
country name for the most common kanji in the language:

| kanji | before | after |
|---|---|---|
| 土 | Turkey | soil / earth / ground |
| 子 | 11PM-1AM | child / sign of the rat |
| 日 | Japan | day / sun / counter for days |
| 午 | 11AM-1PM | noon / sign of the horse |
| 毛 | down | fur / down / hair |

A learner who knows 土 = earth was never shown "earth", was scored **wrong**,
and `updatePosterior` pushed θ **down**. Layer 1 keys on a gloss set instead:
`packages/shared/src/gloss.ts`.

**Verified against the full live corpus** (2,294 kanji, read-only, using the
shipped helper): keyed on a digit/capital gloss **98 → 10**, and all 10
remaining are unavoidable — every gloss that kanji has is one. Criterion-2
violations: **0**. Stored order deliberately unchanged.

**Two things beyond the filed scope, flagged rather than smuggled:**
distractors are now rejected when their glosses *intersect* the answer's —
with sets rather than single glosses an unfiltered distractor can be **also
correct**, which would have traded a wrong key for an ambiguous item. And
three *display* surfaces used `rankGlosses(...)[0]`, so the detail page no
longer reads "Turkey" while the quiz reads "soil / earth / ground".

**Layer 2 — a curated primary sense — is still owed and is spec 2.**

### 🔴 B-228 took THREE rounds, and the reason is the bug itself

`a2c4fab`, `328ceb9`, `2f848e1`. **The entry's own file list named two files.
Six carried the defect.** Each round was declared done and each was
incomplete, caught only by the mandatory non-implementer review.

- **Round 1** found a third instance the file list missed, by running the
  acceptance grep instead of the file list.
- **Round 2** — the review **FAILED** it. The guard test passed the whole time
  while three rendered claims shipped. The pattern was
  `resets? to (1|one) day`, requiring exact adjacency, so `resets to day 1`,
  `resets the interval back to 1 day` and `resets the card's interval` all
  walked through. **A search narrower than its bug class, written by the fix
  for a bug about searches narrower than their bug class.** Worst of the three
  was a *second grade-help surface* in `study.tsx` contradicting the one just
  corrected, inside a modal that tells the learner to go read it.
- **Round 3** — the same instinct once more: the corrected copy said *"not
  reset to day 1"*, which is both a denial (trips the sweep) and not quite
  true, since a low-stability card hits the 1-day interval floor regardless.

Closing note is in [BUGS.md](../BUGS.md) with the full enumeration, the
matched-but-left exemptions, and the guard's known coverage limits.

**The guard is `apps/mobile/test/unit/fsrs-copy-claims.test.ts`.** Run it with
`pnpm --filter @kanji-learn/mobile test -- -t "B-228"`. The `describe` blocks
are named for the bug **on purpose** — named anything else, that command
silently skips the regression pins and runs 3 of 10 tests.

### ✅ B-226 fixed, B-227 was already fixed

**B-226** (`03bf48a`): the Dashboard's "Start Today's Reviews" re-opened a
*finished* session. The obvious fix is a trap — `study-screen.ts` returns
`sessionComplete` **first**, deliberately, so an incidental `reset()` (a
profile PATCH mid-session) cannot dismiss it; that was B-216. So the signal is
an **explicit** `requestFreshSession()`, and the rule lives in a pure
`shouldEndStudySession`. Second invariant the original sketch missed: an
**in-progress** session must survive — tapping the CTA mid-session means
"take me back to it".

**B-227 needed no code.** `a6b3e2d` fixed it and is an ancestor of `main`.
**Both BUGS.md and the 2026-08-02 trip survey listed it as open work to pull
into this build** — a planned session-day against a bug that did not exist.
An unchecked box is not evidence; the code is.

### 🟡 The test lane was lying, in both directions

Worth internalising before trusting a red lane again.

1. **The `placement-service` B-210 failure recorded on 2026-08-01 as
   "confirmed pre-existing" was a stale test database.** True that it predated
   that session's change — but it read as a standing product defect. After
   re-applying the documented migration list and restoring RLS it passes on a
   clean tree *and* with changes applied.
2. **`learner-state-refresh` was a timing race**, not a product fault: it slept
   50ms for a fire-and-forget `setImmediate`. Confirmed by raising it to
   1500ms. Now condition-polled (`871d652`).

**And a trap I walked into repairing #1:** re-running the migration list on an
existing DB makes it **worse**. Those files open with `BEGIN`, are not
idempotent, and abort on an already-existing policy — rolling back every
`FORCE ROW LEVEL SECURITY` that succeeded before the error. Without
`-v ON_ERROR_STOP=1`, `psql` exits 0 and every file reports "ok". Unprotected
tables went **4 → 7** as a direct result of trying to fix it. The repair
recipe is now in
[local-test-db.md](local-test-db.md#-re-running-that-migration-list-on-an-existing-db-makes-things-worse).

### 🔬 The test DB now holds the real corpus — and it found three defects

The local test database ran on **7 kanji** against production's **2,294**.
`kanji` is reference data with no user rows, so importing it costs nothing in
privacy and it is now in place. Procedure and the PG16/PG18 `pg_dump` gotcha
are in [local-test-db.md](local-test-db.md#the-kanji-corpus-import-it-from-production-2026-08-02).

**Deliberately NOT imported:** `user_profiles`, `mnemonics`,
`user_kanji_progress`, `review_logs`. Two independent reasons — hooks carry the
learner's own words and, for most rows, **GPS coordinates**; and several suites
scan whole tables, so real rows would break them rather than strengthen them.

Two tests that had been **skipping since 2026-07-30** now run for real: Fisher
-information item selection, and the adaptive loop's floor/cap convergence.
Neither was being tested locally at all.

It also exposed three things a 7-row fixture had been hiding. All nine
failures traced to them:

1. **🔴 `refreshKanjiDifficulty` was an N+1** — one `INSERT` per kanji, 2,294
   sequential round-trips. Now a chunked multi-row upsert (`2b76205`): that
   suite went from **five 15s timeouts to 2.7s**. Note this is an *operational
   job*, so the same slowness was hitting production, not just tests.
2. **The suite was never idempotent across runs.** `placement-adaptive`'s
   second test seeds corpus-wide by design (`2cab737`) and cleaned up nothing,
   leaving **2,283** rows. On the *next* run that broke three suites that look
   entirely unrelated — including the adaptive loop itself, whose candidate
   pool collapsed to ~11 so it stopped at 6 characters against a floor of 8.
   **That reads exactly like a convergence failure and is not one.** Fixed with
   `beforeEach`/`afterAll` cleanup at the source.
3. **Two tests asserted opposite things about seeding, and both passed.**
   `placement-adaptive` required `appliedCount <= charactersAsked` (the
   pre-`2cab737` rule); `placement-service` requires a never-asked kanji to be
   seeded (the post-`2cab737` rule). With 7 kanji, `7 <= 9` satisfied both.

⚠️ **If the API lane goes red again, suspect leftover fixture rows first.**
`SELECT user_id, count(*) FROM user_kanji_progress GROUP BY 1 ORDER BY 2 DESC`
— anything in the thousands is a suite that failed to clean up, and the
symptoms will appear in a different file from the cause.

### 🎯 The slice-1 thresholds were checked against live — two detectors were dead

Done before execution rather than after, because a threshold is cheapest to fix
before anything is built on it. Full table in the plan's **Calibration against
live data** section; `86b5eff`.

**This is a plausibility check, not calibration** — five learners, one of them
the owner. Its value is narrow and it delivered exactly that: catching
thresholds that make a detector **structurally unable to fire**, which looks
identical to a healthy detector with nothing to report. The same silent-failure
shape as B-229 and B-228.

| Detector | What live said | Outcome |
|---|---|---|
| `leech` | `LAPSE_THRESHOLD = 4` against a DB whose **maximum lapse count is 4**, on one card, p50–p95 all **0**. **Zero** `remembered→learning` regressions ever | 🔴 **rewritten as relative** — the fraction of the learner's deck in trouble, which works at any data volume |
| `reading_lag` (placement half) | subtracted `readingOffset` — a **constant 0.4** for every kanji, in **logits**, against an accuracy gap. Needed a >50-point gap to fire | 🔴 **rewritten** — measured probability baseline instead |
| `hardest_cleared` | `difficulty_at_ask` maxes at **2.00**; ceiling was 2.5 | 🟡 ceiling lowered to 2.0 |
| `fluency_gain` | response times p50 **15.8s**, p75 **30.4s** | 🟡 noise-prone; raise the floor if it fires on jitter |
| `NOVELTY_HALFLIFE_DAYS` | **not measurable** — no finding has ever been raised | ⚪ product judgement; the argument for 14 is the weekly cadence, not data |

**A sign worth remembering:** placement readings run **0.033 better** than
meanings, while quiz readings run **0.073 worse**. Same learner population,
opposite direction — almost certainly the instrument, since placement readings
are four-option multiple choice with a 25% guess floor and quiz
`reading_recall` is typed. Anything comparing the two must not pool them.

### 🔴 `priorFindings` is not fillable — the decay mechanism has no memory yet

Checked every `LearnerSnapshot` field against Postgres before building the
type. Four cannot be filled as written, and one of them matters a lot:

**`notebook_entries.body` is `text`**, with kinds `decision` and `observation`.
There is nowhere to read a finding's `kind` + `since` back from. **Spec §4's
entire decay-and-escalation mechanism depends on that history** — without it
every finding is permanently novel and Buddy can never say *"readings again."*

**Slice 1 is not blocked** — it defines the type, and `select()` handles an
empty `priorFindings` array correctly. But the feature does not *work* until
**slice 2 adds a JSONB column or a findings table.** Decide which when slice 2
is planned; do not let it be discovered late.

Also: **no `buddy_sessions` table exists**, so `HookSnapshot.sessionDates` has
no confirmed source (`buddy_conversations.created_at` and
`buddy_commitments.week_start` are the candidates). `hook_coverage`'s staleness
trigger silently degrades to the zero-hooks branch without it. And 4 of 5
learners have **zero** co-created hooks, so that finding will dominate
selection until hooks exist.

### 📋 Coaching spec — owner review recorded, 3 of 4 decisions closed

[Spec §14](superpowers/specs/2026-08-01-buddy-coaching-analysis-design.md).

| | |
|---|---|
| **§11.1** findings per surface | 2–3 accepted **as a parameter, not a constant**. Buddy self-tuning deferred with a reason: it needs a delivery-outcome signal (dismissals, time-on-surface, acted-on) that is not instrumented. **Consequence: instrument those when slices 2–4 ship**, even before anything reads them |
| **§11.2** companion beat engine | **Closed** — single free-conversation prompt, no separate engine |
| **§11.3** tier-2 daily cap | **Still unsized, and it is the owner's call.** Production runs the `env.ts` defaults — **50 tier-2 calls/user/day**, 5 tier-3; neither is set on App Runner. Every other Buddy surface is one call per event; **companion mode is a conversation, so each turn is a call.** Also: the day boundary is **UTC**, so in Japan the cap resets at 9am JST |
| **§11.4** `hook_coverage` | **Dissolved rather than answered.** Now an *offer* to co-author a hook on a named kanji drawn from Again/Hard grades and quiz failures, triggering on zero hooks **OR** none since the session-before-last. Promoted to a `Direct` finding |

**§8 gained a third option.** The frankness escalator offered "narrow the
scope" (same sitting, less coverage) and "shift the sitting" (same target,
later date). The owner's phrasing — *"let's target N3 for the next JLPT
window"* — **lowers the target level**, which is neither, and is the only one
of the three deliverable as **good news**. It depends on knowing the learner
is already in range for the lower level, which is what `504b1ea` had to fix
before the claim could be trusted.

### 📌 New: B-230

`c303451`. `progress.tsx` states the SRS bands as 1–3 days / 1–4 weeks / 1–3
months; `constants.ts:69-71` says **<7 / 7–20 / 21–179**, and
`SrsStatusBar.tsx` already renders it correctly — two screens, two answers.

**Deliberately not folded into B-228:** wrong arithmetic about FSRS's *own*
ladder is a different class from an SM-2 vestige, and B-228's acceptance grep
structurally cannot detect it. Folding it in would have made that bug's class
wider than its test — the exact defect B-228 exists to document.

Writing it up found a third problem neither review caught: **the bands do not
tile with each other.** Learning tops at 3 days, Reviewing starts at 7, so a
card on a 5-day interval is in no status at all. Fix proposed is to *derive*
the copy from the exported constants — the root cause is that two screens
hand-copied the same numbers and one drifted.

### ✈️ Still open for the Beppu trip — none of it fixable by a build

1. **Retake the placement test on B148.** The only behavioural proof B-229
   worked. The corpus sweep proves the *helper* is right and the running image
   is confirmed to contain it; neither proves the device path. Expect 土 to
   offer "soil / earth / ground", and the level to move **up** with
   performance. **An existing placement row is not retroactively repaired.**
2. **The timezone will not follow you to Japan.** No route writes
   `user_profiles.timezone` — verified. A `reminder_hour` of 20 on an LA row
   fires at **noon JST the following day**, and `runBuddyDayPass` gates the
   weekly invitation on the same hour. Cheap answer: a one-row `UPDATE` to
   `Asia/Tokyo` on arrival, back on return. **Do not rush a
   device-writes-timezone feature** days before the trip that depends on it.
3. **Check `attach_location_to_hooks` BEFORE flying.** Defaults **false**, and
   only **1 of 5** profiles has it on. If it is off on the account used in
   Beppu, **every hook built there loses its coordinates permanently** — and
   Beppu is exactly where they are worth having.
4. **Latency will likely be worse in Japan, not better.** Phone (JP) → API
   (`us-east-1`) → Supabase (`ap-southeast-2`). Both legs are long from Japan.
   Set expectations rather than diagnosing it as a new bug on the road.
5. **Only one weekly-session walkthrough per period, per account** —
   completing a session burns the whole period; no choice of `buddy_day` makes
   another due inside 7 days.

### 🗓️ Housekeeping

- **EAS allowance renews 2026-08-04.** B148 was cut on the 2nd, so it used the
  ~$2 overage. A build on the 4th or later is free.
- **Credential rotation deferred to October by the owner.** One caveat on
  record: the three LLM keys expire **2026-10-26**, the same date
  `docs/secrets-rotation.md` schedules rotation for — **zero margin.** Expiry
  degrades *silently*: `/v1/buddy/meet/turn` returns `{fallback:true}` at 200,
  so an expired key does not error, it quietly drops Buddy to template tier.
  **Rotate in early October, not on the 26th.**
- **Four branches are fully merged into `main` and can be deleted**:
  `claude/cranky-torvalds-7d4f85`, `phase-5-cocreation-flow`,
  `weekly-buddy-review-spec`. (`fix/trip-build-bugs` was this session's and is
  already gone.) Eleven others are unmerged parked work — left alone.

### 🧠 Lessons this session added

- **🔴 A fix for "your search was narrower than your bug class" reproduced the
  bug three times.** Every round of B-228 was declared complete on a search
  that had not been tested for completeness. What broke the loop was not
  better intentions — it was an adversarial reviewer with no stake in the fix
  being done, run against the final tree, twice.
- **Proving a guard works by reinjecting a string it already matches proves
  nothing.** Round 1 did exactly that and passed while three claims shipped.
  A guard is only tested by reverting a *real* fix and watching it fail.
- **An unchecked box is not evidence of a bug.** B-227 was already fixed and
  had a session-day of work planned against it. Check the code.
- **A red test lane does not stay inert — it gets reasoned about as product
  state.** Both standing API failures were environmental, and one of them had
  already been written into a handoff as a product-level fact.
- **`git add -A` at the end of a task sweeps in whatever else you were
  working on.** The coaching plan landed inside a B-228 commit whose message
  never mentioned it. Split before pushing; `--amend` cannot fix a commit that
  cites its own hash.
- **🔴 A fixture small enough to be convenient is small enough to satisfy
  contradictory assertions.** Two placement tests asserted opposite rules about
  seeding and both passed on 7 kanji. Neither was flaky, neither was skipped —
  they were just never asked a question that could distinguish them.
- **A cheap test fixture can hide a production performance bug.** The N+1 in
  `refreshKanjiDifficulty` was invisible at 7 rows and slow at 2,294 — and it
  runs against 2,294 in production.
- **Test pollution surfaces in a different file from its cause.** The 2,283
  rows one suite left behind broke three others, and the loudest symptom looked
  like an algorithm failing to converge.
- **🔴 Check a threshold against real data BEFORE building on it.** Two of the
  coaching plan's detectors could never have fired, and both would have passed
  every unit test — the fixtures were written to match the thresholds rather
  than the world. Cost of catching it before execution: twenty minutes of
  read-only `SELECT`s. Cost after: a shipped feature that is silently mute.
- **"Per-item" is a claim about data, and it was false.** `readingOffset` reads
  like a per-kanji quantity and is a single constant. Check the column, not the
  name.
- **A field in a type is a promise the database can supply it.** Four fields in
  `LearnerSnapshot` could not be kept. Verifying that took one query each and
  happened before the type was built, which is the only cheap time to find out.

---

# Previous — 2026-08-01 night (**B147 in TestFlight — the bugs it surfaced were worth more than the build**)

> **Canonical URL:**
> https://github.com/radmelon/kanji-learn/blob/main/docs/HANDOFF.md

> ## ✅ B147 is cut, submitted, and on the owner's device
>
> | | |
> |---|---|
> | Build | `0eb38925-1e58-41ef-8b0f-b37eed274a06`, buildNumber **147** (EAS `autoIncrement`, never hand-bumped), 14:21:40 → 14:28:08 |
> | Content | `c32ac7c`; bump recorded as `ebbdd35` |
> | Pre-build gate | all five green. **The API-behind check returned empty** — the B-214 trap the SOP exists for |
> | API on live | `sha256:67edd74f…`, operation `bcb9c6eb` **SUCCEEDED** 15:56:09 → 16:00:12, `/health` 200 |
> | `main` | `fc6464b`, pushed, tree clean |
>
> Lanes at end of session: typecheck **4/4** · shared **326** · mobile pure
> **193** · components **63** · API's one placement failure (B-210) confirmed
> **pre-existing** by stashing the change and re-running — identical failure,
> same assertion.
>
> ### 🔴 The three B146 reports resolved — two were already fixed, one was new and inverted
>
> | Report | Verdict |
> |---|---|
> | *"No notification"* | **Not a fault.** The whole chain verified healthy (EventBridge ENABLED → Lambda hourly → API `200 {"ok":true}` → Expo accepted, zero receipt errors). It fired **on the iPhone** while testing happened on the iPad. `sendToUserTokens` fans out to every registered token, so a silent device has **none registered**. `delivered=0` in those logs is documented-normal — receipts are async and polled immediately |
> | *"Buddy session is a black screen"* | **Already fixed in B147** (`1817efb`, not an ancestor of B146's `1a4aaf3`). Confirmed on device: the owner could read text off the screen that previously showed nothing |
> | *"0 kanji recognized, and N4 despite getting most right"* | **Two independent bugs.** The seeding half was already live-fixed (`2cab737`). **The level half was new — and inverted** |
>
> ### 🔴 The placement level bug — the same mistake as `2cab737`, one function over
>
> `504b1ea`, fixed and **deployed**. Level boundaries were computed from the ~10
> items the test **asked**, then `.filter()`ed to drop levels with no
> representative — leaving boundaries for a shorter ladder while the label was
> still read out of the full five-level list.
>
> Item selection maximises Fisher information, so it asks near the learner's
> ability. **A strong learner is never asked an N5 item**, so N5/N4 drop out, and
> their index-1 band — really N2 — was reported as N4. **The better you did, the
> lower the level you were told.** Reproduced with the real `inferredLevel`:
> asked N3/N2/N1 at θ=1.2 → reported N4, correct answer N2. At θ=1.2 asked only
> N2/N1 → **N5**.
>
> `2cab737` moved *seeding* onto the corpus and left the *bands* on the asked
> subset. `levelBands()` now returns boundaries and labels as one aligned pair so
> they cannot be sourced separately again. The corpus is loaded once and reused
> three times — one query where there were three.
>
> ### 🟡 Deploy verification when there is no canary — read this before the next API deploy
>
> This fix changes **computed values, not response shape**, and `/health` carries
> no version. So the SOP's "a field only the new build returns" does not exist
> here, and `/v1/placement/complete` returns 401 on every build ever shipped.
>
> What was done instead, and what to repeat:
> 1. **ECR digest changed** `c55b2f64…` → `67edd74f…`. This is the check that
>    rules out a `start-deployment` against the image already running — which
>    would record a SUCCEEDED operation dated today and ship nothing
> 2. **The running image was inspected directly** — `export function levelBands`
>    present in `packages/shared/src/placement.ts`, call site at
>    `placement.service.ts:302`
> 3. Local image digest identical to the ECR digest App Runner pulled
>
> **None of that proves the level is correct** — only that the code computing it
> shipped. The behavioural proof is the device walk.
>
> ### 🔴 The meeting screen rendered an empty view — the THIRD instance of one pattern
>
> `89f3e89`, **queued for B148, not in B147.** Retaking placement led to a blank
> screen: `onboarding.tsx` had `if (!ui) return <SafeAreaView style={styles.root} />`
> — a literally empty view — covering the whole of `begin()`'s network
> round-trip, and covering it **forever** when the request hung, because
> `api.ts` called `fetch` with no signal and no timeout.
>
> **This is the third time this shape has been reported** (B-227 Journal, B146
> buddy session, B147 meeting), and the second time it was read as *"the feature
> was never built."* `selectSessionBody` was hardened against it after B-227 with
> the note *"surfacing an error beats falling through to a blank screen"* — and
> the meeting screen had the identical hole. It now goes through
> `selectMeetingScreen`, with a test asserting **no combination of inputs renders
> nothing**.
>
> The 30s timeout bounds a **hang, not latency**: `POST /v1/placement/complete`
> legitimately took **5.18s** on live. Anything tighter aborts real work.
>
> ### 🟡 Completing a weekly session burns the whole period
>
> Found while diagnosing "why is my Buddy page blank". Tapping **"That works"**
> completes the session and sets `lastSessionDate`; `evaluateAppointment` then
> anchors the next appointment to *that completed session*
> (`anchorIsNewPeriod = daysBetween(lastSessionDate, anchor) >= periodDays`).
>
> **No choice of `buddy_day` makes another due inside 7 days.** Moving the day
> Saturday → Monday moved the target from 08-08 to **08-10 — further away**.
>
> Consequence for testing: **one weekly-session walkthrough per period, per
> account.** Batch them or use a second account. Recorded in the B147 test plan.
>
> ### 🎯 Owner's directives for the NEXT session (2026-08-02)
>
> **The goal is a Buddy-rebuilt app ready for the Beppu trip next week.** That is
> what the next build is for; sequence everything against it.
>
> 1. **Fix the known bugs, then cut a build.** In severity order: **B-229**
>    (gloss keying — corrupts θ corpus-wide, layer-1 fix is small and API-side),
>    then **B-228** (SM-2 mechanics + Woźniak credit still rendered), then the
>    already-queued `89f3e89` meeting blank-screen fix which needs the build
>    anyway.
> 2. **Build budget — authorised.** ~1.5 builds remain on the basic EAS
>    subscription. **The owner authorises additional builds as needed through the
>    evening of 2026-08-03.** Overage is roughly **$2 per build**, not a
>    subscription upgrade — cheap enough that a second cut to fix a mistake is
>    never the wrong call.
> 3. **Worth knowing before paying for one:** the allowance **renews 2026-08-04**.
>    A build cut on the 4th is free; one cut on the 3rd is ~$2. If the trip
>    timeline tolerates a day, wait. If it does not, spend the $2 — the
>    authorisation above exists precisely so nobody dithers over it.
> 4. **B-229 is API-side**, so it also needs a **deploy**, not just a build. Both
>    B-229 and B-228 must be in place *before* the cut, or the build ships a
>    known-wrong placement test to a trip where it will actually be used.
>
> ### 📦 What else to pull into the trip build (surveyed 2026-08-02)
>
> Beyond B-229 and B-228, in order of value:
>
> - **B-227 — the Journal blank screen. Strong yes.** `[Effort: XS]`, mobile-only,
>   and **the fix pattern already exists**: `selectMeetingScreen`
>   (`src/lib/meeting-screen-state.ts`, shipped in `89f3e89`) is the same shape
>   and can be copied almost mechanically. This is the **third** instance of
>   "blank is not a state" and the second read as *"the feature was never built."*
> - **B-226 — Session Complete persists when you leave by tab.** Core daily study
>   loop, mobile-only, and it will be hit every day on the trip.
> - **B-202 — `srsEaseFactor` carries FSRS difficulty.** Optional. Adjacent to
>   B-228's code so it is cheap to fold in, but it is a coordinated API+mobile
>   rename, not free.
>
> **Defer explicitly:** B-223 (migration + backfill, `[Effort: M]` — too much
> before a trip), B-225 (needs the owner's ear, all three options are trade-offs),
> B-207 (cosmetic), B-208 (infrastructure/region, not a two-day fix).
>
> **Sequencing:** B-229 is API-side, so **deploy and verify BEFORE cutting the
> build** — otherwise the build ships against an API that still mis-keys. Cut
> early enough on 2026-08-03 to leave room for a second build; the owner has
> authorised the ~$2 overage precisely so a re-cut is never the wrong call.
>
> ### ✈️ Trip-specific issues that are NOT in the bug tracker
>
> 1. **The timezone will not follow the owner to Japan.** **No route writes
>    `user_profiles.timezone`** — verified. Live spread: LA 2, UTC 2, Tokyo 1
>    (the schema's "every row still carries the 'UTC' default" comment is stale).
>    If the owner's row says `America/Los_Angeles`, then in Beppu a `reminder_hour`
>    of 20 fires at **noon JST the following day**, and `runBuddyDayPass` gates the
>    weekly Buddy invitation on the same hour. Cheap answer: a one-row `UPDATE` to
>    `Asia/Tokyo` on arrival and back on return. **Do not rush a device-writes-
>    timezone feature into this build** — it touches the reminder system days
>    before the trip that depends on it.
> 2. **Latency will likely be WORSE in Japan, not better.** The path is phone (JP)
>    → API (`us-east-1`) → Supabase (`ap-southeast-2`, Sydney). Both legs are long
>    from Japan, where from the US only the second is. B-208's 10–15s Progress tab
>    may degrade further. Nothing to fix in two days — but set expectations rather
>    than diagnosing it as a new bug on the road.
> 3. **Check hook-location consent BEFORE flying.** `attach_location_to_hooks`
>    defaults to **false** and only **1 of 5** profiles has it ON (7 of 9
>    co-created hooks carry coordinates, so it is probably the owner's). If it is
>    off on the account used in Beppu, **every hook built there loses its
>    coordinates permanently** — and Beppu is exactly where they would be worth
>    having, both for the hooks themselves and for the parked Watch/geofencing
>    idea.
>
> ### ✅ B-210 closed — and it was blocking the retake
>
> Verified 2026-08-02: `applyPlacementResults` (the function B-210 describes) **no
> longer exists**; `alreadyHas` now covers every owned kanji at any status; the
> write is `onConflictDoNothing()`. The IRT rebuild dissolved it, as its own
> design doc predicted. **This was contradicting the standing advice to retake the
> placement test** — anyone reading BUGS.md would reasonably have refused. A
> retake is safe.
>
> **Credential rotation: deferred to October by the owner.** Viable, with one
> caveat now on record: the three LLM keys (Anthropic, Groq, Gemini) were issued
> 2026-07-28 and **expire 2026-10-26** — the same date `docs/secrets-rotation.md`
> schedules the rotation for, i.e. **zero margin**. Expiry degrades *silently*:
> `/v1/buddy/meet/turn` returns `{fallback:true}` at 200 on any failure, so an
> expired key does not error, it quietly drops Buddy to template tier. **Rotate
> in early October, not on the 26th.**
>
> ### 📋 What is owed, in order
>
> 1. **Owner is reviewing the coaching spec** —
>    [2026-08-01-buddy-coaching-analysis-design.md](superpowers/specs/2026-08-01-buddy-coaching-analysis-design.md).
>    On approval the next step is `writing-plans`. **Open decision #3 (the tier-2
>    daily cap) is still unsized** and companion mode is the common path — that is
>    the one item that could make the feature expensive before anyone notices
> 2. **Retake the placement test on B147.** The only thing today's deploy
>    changed, and the only fix with no behavioural proof yet. Expect N3+ when
>    answering most items correctly, and the level moving *up* with performance.
>    Direction is the test, not the band. **An existing placement row is not
>    retroactively repaired** — a retake is required to see it
> 3. **The B147 device walkthrough — still two phases deep.**
>    [Test plan](b147-test-plan.md), LA-timezone account. The airplane-mode
>    template floor is the part most likely to surprise us
> 4. **🔴 B-229 — fix this before spec 2, it is worse than "content quality".**
>    Confirmed against live data 2026-08-02. `meanings` is stored
>    **alphabetically**: 1,925 of 1,999 multi-gloss kanji (**96.3%**) have
>    `meanings->>0` equal to the alphabetically smallest gloss. ASCII sort puts
>    digits and capitalised proper nouns first, so **土 is keyed "Turkey", 子 is
>    "11PM-1AM", 日 is "Japan", 午 is "11AM-1PM"** — all N5. Both
>    `placement.service.ts:119` and `test.service.ts:151` key on it, and
>    distractors come from other kanji's `meanings[0]`, so the options are
>    contaminated too. A learner who knows 土 = earth is never shown "earth", is
>    scored wrong, and θ moves **down**. `504b1ea` fixed the label; **this
>    corrupts the evidence the label is computed from**, so it is the more
>    fundamental half of the owner's original report. Layer-1 fix is small and
>    needs no migration: key on a **gloss set** ("earth / ground / soil") in both
>    services. Layer 2 — proper ranking — is spec 2. Example-sentence complaints
>    are separate and have their own root: `seed-sentences.ts` scores Tatoeba by
>    length with no similarity dedup and no sense coverage
> 5. **B-228** — [BUGS.md](../BUGS.md). Closure requires a mandatory
>    non-implementer review; the acceptance criterion is a **grep for the wrong
>    claims that must return empty**, not a file list
> 6. **B148** carries the meeting fix. EAS allowance renews **2026-08-04**
>
> ### 🧠 Lessons this session added
>
> - **A sweep must search for the wrong claims, not the right word.** B-228's
>   sweep defined its bug class semantically ("ease-factor / SM-2 mechanics") then
>   derived its file list lexically by grepping `SRS`. `GradeButtons.tsx` never
>   says SRS — it says *"ease factor"* — and still ships SM-2 mechanics and a
>   Woźniak credit to users
> - **The reported symptom is not always the defect, and saying so is the job.**
>   The owner asked to be corrected if wrong about "vestige SRS references". He
>   was — that usage is deliberate and he approved it — and the investigation
>   found a real defect anyway
> - **When there is no content canary, verify the artifact.** Digest changed +
>   inspect the running image. A status code proves nothing
> - **Blank is not a state.** Three occurrences now. Any screen with a
>   "don't show the empty state until loaded" guard and no loading state has this
>   latent
> - **🔴 "I don't have DB credentials" was false, and cost a day.**
>   `scripts/with-live-db.sh` has existed since 2026-07-27 and works. It was
>   documented in eight files — none loaded by default, and the most relevant
>   named `local-test-db.md`, which is where nobody looks for *production*
>   access. **CLAUDE.md now says so explicitly**, because a capability absent
>   from the always-loaded file is a capability the next session will not know it
>   has. One `SELECT` would have confirmed the owner's 毛 report immediately;
>   instead a defence of the wrong conclusion got written. **Check before
>   asserting a limit**
>
> ### 📎 Captured to Open Brain (not in the repo)
>
> - Apple Watch as Buddy's presence layer, triggered by hook location — **plus a
>   verified amendment**: coordinates *are* stored (`mnemonics.latitude/longitude`),
>   the city name is merely the only part displayed. Consent is already granular
>   (`attachLocationToHooks` separate from milestones). Partial coverage —
>   typed place names have no coords — and ~100m precision
> - Using **Take a Quiz** results to calibrate placement item difficulty. Quiz
>   selection is `ORDER BY RANDOM()`, which is *ideal* for unbiased calibration;
>   `b_observed` today is a **proxy** (mean FSRS difficulty), not observed
>   responses. `kl_test_results` holds the native `(person, item, correct)` triple,
>   and `questionType` could ground per-type offsets where the model has one
>
> ### 🧹 Housekeeping note
>
> Nine stale local branches remain (`claude/*`, `feat/phase-1-quick-wins` whose
> upstream is gone, `feature/speaking-progressive-hints`). Not deleted — that is
> the owner's call. `git branch -vv` lists them.
>
> ---

# Previous — 2026-08-01 evening (**Phase 7 built, merged and DEPLOYED — one build now carries two phases; the walkthrough debt has doubled**)

> **Canonical URL:**
> https://github.com/radmelon/kanji-learn/blob/main/docs/HANDOFF.md

## 2026-08-01 (evening, superseded by the section above)

> ## ✅ Phase 7 — Meeting Buddy — is on `main` and its API is live
>
> Built in one session, same day the phase was planned: spec → plan (14 tasks)
> → subagent-driven execution → whole-branch review → two fix waves → merge →
> deploy. 28 commits, fast-forward to `6541a8f`.
>
> | | |
> |---|---|
> | Merge | fast-forward, `main` = `6541a8f` |
> | Migration `0033` on live | applied; `met_buddy_at` timestamptz NULL, **0 rows stamped** — the designed state: every learner meets Buddy on next launch of the new build (spec decision #7) |
> | API deploy | image `sha256:c55b2f64…`, operation `ea7b2266` `SUCCEEDED` 14:11:17 → 14:15:30 |
> | Canary | `POST /v1/buddy/meet/complete` and `/turn` both **404 → 401** against a pre-state captured before deploying; `/v1/buddy/meet/nonexistent` still 404 |
> | Lanes on merged `main` | typecheck 4/4 · shared **320** · mobile pure **187** · components **63** · API failing set is the three documented rotating names, **enumerated**: `learner-state-refresh`, `rls-coverage`, B-210 (reconfirmed order-dependent: 11/11 solo, fails only in-suite) |
>
> **What shipped:** onboarding is now a first meeting with Buddy. Pure beat
> engine in `packages/shared/src/buddy/` (`frame.ts` — resolveFrame from the
> Arc design, `meeting.ts`, `beats.ts`, `meeting-copy.ts`); cloud tier over the
> existing `BuddyLLMRouter` (`POST /v1/buddy/meet/turn`, stateless, every
> failure → `{fallback:true}` at 200); `POST /v1/buddy/meet/complete`
> (first-wins `met_buddy_at` + `onboarding_completed_at` stamps, page one via
> supersede-by-source-kind — four entries: `onboarding_intro` observation,
> `first_open` decision, `onboarding_appointment`, `onboarding_reasons` —
> transcript archived to `buddy_conversations`); mobile reducer/store with an
> offline completion stash; gate switched to `metBuddyAt`; the old stepper
> preserved at `/onboarding-form` as the skip-to-form escape; `MeetingBody`
> conversation surface; Profile re-entry via `/onboarding?revisit=1`; and the
> §9 seeding guard test, red-proven against both redundant layers.
>
> ### 🔴 The whole-branch review found 4 HIGH seam defects — third branch in a row
>
> Per-task reviews: 14/14 passed (two caught real defects mid-stream — a
> plan-code bug in beat selection, a frozen-screen failure path in the form).
> The whole-branch review then returned NOT READY with defects only the
> composition shows, **three of four traceable to the plan's own text**:
>
> - **The template floor could not complete.** Completeness required interests;
>   the interests input rendered on cloud tier only. The offline first launch —
>   the exact scenario the floor exists for — had no completing path at all.
> - **A free-text reply at the ask beat dead-ended the conversation** — the
>   `done` beat had no surface, no finish CTA, and typing again 400'd into a
>   template flip that removed the composer too.
> - **The Profile "Meet Buddy" row was 100% inert** — `begin()` bailed
>   `'already_done'` for everyone who could see the row.
> - **An unflushable stash looped the gate forever**, and an over-long pasted
>   message made the stash permanently 400 — an unrecoverable onboarding
>   lockout on that device.
>
> **The new lesson this branch adds:** the fix wave itself then violated its
> own invariant one field over — the transcript clamp was proven red, while the
> interests field (which the first fix had just promoted onto the floor's
> critical path) stayed unclamped and recreated the same lockout. **A fix wave
> needs its own adversarial verification pass**; the verification review caught
> it by re-running every original failure scenario against the fixed code.
> Everything is closed (`6541a8f`), each fix red-first.
>
> ### 🛑 Process incident, and the guard now in place
>
> A cheap-tier fix agent ran `git add -A` and swept `.codex/`, personal notes
> and `supabase/` CLI state into a commit on this public repo. Caught in
> review, history rewritten before any push, `.gitignore` now guards those
> paths, and every later dispatch carried an explicit prohibition. Two rules
> reconfirmed: **verify every reported SHA against git log** (a fix agent also
> reported once against a stale report file), and dispatch prompts are not the
> brief — a reviewer flagged a "fabricated" quotation that was actually the
> controller's own dispatch text, misattributed.
>
> ### 🟡 NOTHING of Phase 6 or Phase 7 is user-visible yet — the build is the gate
>
> Both phases' mobile halves sit on `main`, in no build. B146 (current
> TestFlight) predates both. The next EAS build carries: the notebook (Phase
> 6), the meeting (Phase 7), and the gate change that walks **every existing
> learner** through the meeting on first launch — deliberate, spec decision #7,
> but worth knowing before cutting. Before the cut: re-run the SOP pre-build
> gate (clean as of this deploy), `EXPO_NO_CAPABILITY_SYNC=1`, allowance renews
> **2026-08-04**. Old-build interaction is safe: `/complete` stamps
> `onboarding_completed_at` too, so a conversation-onboarded user opening B146
> is not re-gated.
>
> ### What is owed, in order
>
> 1. **The device walkthrough debt is now TWO phases deep.** The B146 plan
>    ([test plan](b146-test-plan.md), LA-timezone account) still stands, and
>    the next build adds: template-floor airplane-mode end-to-end (finish
>    offline → relaunch → stash flushes → page one appears in the Journal),
>    the cloud conversation with a real LLM, revisit from Profile,
>    skip-to-form, and placement-from-ask.
> 2. **Cut the build** (one build, both phases, all walkthroughs).
> 3. **Known gaps, recorded not hidden:** offline revisit demotes to a blank
>    first-run walk; the pending-offline screen copy says "offline" for any
>    flush failure; an LLM reply >1000 chars 400s the next `/turn` and silently
>    flips to template; Task 9's test leaves `kanji_difficulty` rows mutated
>    (b=-3.5) in the local test DB across suite runs; the tier-2 daily cap has
>    not been sized against ~a-dozen-turns-per-onboarding.
> 4. **The fixture-isolation session** — B-210 reconfirmed order-dependent
>    today; the rotating three-name failure set is stable but corrosive.
> 5. Open decisions carried forward unchanged: `weekStart` validation,
>    `[BuddyDay]` alerting, and the weekly review's slice 2 (which slice 7's
>    `buddy_conversations` transcripts now feed).
>
> ---

# Previous — 2026-08-01 morning (**Phase 6 merged and DEPLOYED — the notebook API is live; a build and the walkthrough are next**)

> **Canonical URL:**
> https://github.com/radmelon/kanji-learn/blob/main/docs/HANDOFF.md

## START HERE — 2026-08-01 (morning, superseded by the section above)

> ## ✅ Phase 6 is on `main`, and the API serving it is live
>
> | | |
> |---|---|
> | Merge | `1bd57fb` — clean, zero conflicts (`docs/HANDOFF.md` was byte-identical on both sides) |
> | Verified | all five lanes, **twice** — on the branch, then again on merged `main`, identical results |
> | Migration `0032` on live | applied and verified by object inspection, below |
> | API deploy | image `sha256:26e0e944…`, operation `9436d70f` `START_DEPLOYMENT SUCCEEDED` 07:40:07 → 07:44:16 |
> | Canary | `GET /v1/buddy/notebook` **404 → 401** against a pre-state captured before deploying; `/v1/buddy/nonexistent-route` still 404 |
> | Also shipped | `2cab737`, the placement seeding fix flagged last night as unshipped — same image. **The SOP pre-build gate returns empty as of this deploy** |
>
> Lanes on merged `main`: typecheck 4/4 · shared **279** · API **417 passing**,
> 2 failing — **enumerated**: `learner-state-refresh` (the documented
> `setImmediate`/50ms race) and `rls-coverage` (the documented legacy tables).
> B-210 passed both runs this session, so its order dependence stands unproven
> either way today. · mobile pure **163** · components **40**.
>
> Migration `0032` verified on live by content, not exit code: `notebook_entries`
> exists with RLS **enabled and forced**, both policies, and the first-open
> partial unique index; `tutor_notes.language`, `tutor_notes.body_translations`
> and `tutor_shares.language` all present; `study_log_entries` dropped — checked
> before dropping: it existed on live with **0 rows**, exactly as the
> migration's header claimed.
>
> The canary route cannot be shadow-matched: the old image's only buddy routes
> were `/v1/buddy/session` and `/v1/buddy/session/commitment`, nothing
> parametric under `/v1/buddy`. The 401 carries the app's own body
> (`{"ok":false,…,"code":"UNAUTHORIZED"}`), which the old image cannot produce
> for that path.
>
> The local branch is deleted. `origin/buddy-home-notebook` still exists on
> GitHub if a reference point beyond the merge commit is ever wanted.
>
> ### 🛑 `drizzle-kit push` cannot run against an already-provisioned test DB
>
> The rebuild recipe's `push` step works **only on a fresh database**. Once
> migration `0025`'s expression indexes exist, drizzle-kit 0.22.8 introspection
> dies with a ZodError on `buddy_nudges_streak_dedupe` (`expression: null` —
> it cannot parse an index over `action_payload->>'milestone'`). On a database
> that already has them, skip push and verify schema currency directly in
> `information_schema` — this session confirmed the branch's three new tutor
> columns and the full `notebook_entries` shape that way, then re-applied
> `0031`/`0032`, which are idempotent by design. Recorded in
> `docs/local-test-db.md`.
>
> ### What is owed next, in order
>
> 1. **The B146 device walkthrough** — unchanged from last night, still not
>    done. Both slices deployed yesterday are unproven on a real device.
>    [Test plan](b146-test-plan.md). Run it on an `America/Los_Angeles`
>    account — a `'UTC'` row is skipped by design and reads as breakage.
> 2. **A build to carry Phase 6 mobile** — the notebook screens are on `main`
>    and in no build. Re-run the SOP pre-build gate before cutting (clean as of
>    this deploy), `EXPO_NO_CAPABILITY_SYNC=1` on every profile. ~7 medium
>    builds remain; the allowance renews **2026-08-04**.
> 3. **Phase 7** — specced, unplanned.
>    [Spec](superpowers/specs/2026-07-31-onboarding-meeting-buddy-design.md)
> 4. **The five deliberate gaps** (archive renderer, offline caching, the
>    translation endpoint, `tutor_notes.language` authoring + the hardcoded
>    `ja-JP` voice, virtualisation) — detailed in last night's section below.
>
> ### Unchanged from last night — read there rather than re-deciding here
>
> - 🛑 `checkTutorConstraint` deliberately unbuilt; slice 2 implements spec
>   §6.3's rule, which lives **only in the spec** — do not invent a second one.
> - The fixture-isolation session, now three items (B-210 order dependence,
>   `learner-state-refresh` race, the unreachable fitted-weights branch).
> - Open decisions: `weekStart` validation, `[BuddyDay]` alerting, and
>   `buddy_day` discoverability before slice 2.
>
> ---

# Previous — 2026-07-31 night (**Phase 6 built on a branch — 24 commits, unmerged, undeployed**)

> **Canonical URL:**
> https://github.com/radmelon/kanji-learn/blob/main/docs/HANDOFF.md

## START HERE — 2026-07-31 (night)

> ## 🟡 Phase 6 — Buddy's home — is on branch `buddy-home-notebook`, pushed, not merged
>
> ```bash
> git checkout main && git merge buddy-home-notebook
> ```
>
> 24 commits. PR: https://github.com/radmelon/kanji-learn/pull/new/buddy-home-notebook
>
> | Lane | Result |
> |---|---|
> | `pnpm -r typecheck` | clean, 4/4 |
> | `packages/shared` | **279** |
> | `apps/api` | **417 passing**, 2 failing |
> | `apps/mobile` pure | **163** |
> | `apps/mobile` components | **40** |
>
> The two API failures are `learner-state-refresh` and `rls-coverage`, both
> pre-existing. **B-210 passed this run**, which confirms its order dependence
> rather than a fix — the failure set now rotates between three names across
> runs. Three runs today gave 2, 3 and 1 failures. **Enumerate, never count.**
>
> Specs: [Phase 6](superpowers/specs/2026-07-31-buddy-home-notebook-design.md) ·
> [Phase 7](superpowers/specs/2026-07-31-onboarding-meeting-buddy-design.md) ·
> Plan: [Phase 6](superpowers/plans/2026-07-31-buddy-home-notebook.md)
>
> ### 🔴 The whole-branch review found ten defects. Per-task reviews found none of them.
>
> Twelve tasks, each implemented by a fresh subagent and reviewed by another.
> Several were sent back — including a **Critical** unfiltered `SELECT` over
> `tutor_notes` on every notebook open. Every task ended green.
>
> **Then the whole-branch review returned NOT READY with ten defects that exist
> only in the seams.** That is the second consecutive branch where this
> happened, and the pattern is now established well enough to plan around:
> *a plan executed task-by-task with clean per-task reviews still assembles
> into something broken.*
>
> The four worst, all fixed:
>
> - **Editing Buddy's introduction always returned 404.** The partial unique
>   index lacked `AND superseded_at IS NULL` and `supersedeEntry` copied
>   `source` verbatim, so the replacement collided with the original, 23505
>   rolled the transaction back, and the route reported "not found". The one
>   entry every learner has was the only one they could not edit — and joint
>   authorship is the spec's central decision.
> - **Every tutor note rendered twice**, and the duplicate was a `Pressable`
>   wired to the edit path, PATCHing a `tutor_notes` UUID. The rule that
>   *nobody but the tutor may supersede a tutor note* was violated by the UI.
>   `editableBy` was computed correctly and **read by no component at all.**
> - **A commitment nobody agreed to rendered as "THIS WEEK".** `source`
>   distinguishes `session` / `rolled_forward` / `default`, and nothing branched
>   on it, so the hourly pass's `default` row was presented to a brand-new
>   learner as their promise.
> - **Re-saving a commitment appended a second contradictory observation** —
>   the commitment upsert is idempotent, the notebook write beside it was not.
>
> **Why the tests missed the tutor-note duplication is the transferable part:**
> every `NotebookBody` fixture hand-built its `sections` array in a shape
> `assembleNotebook` never actually produces. The component was tested against
> imagined input. The fix routes a test through the real function.
>
> ### 🔴 A colour test that could not fail — twice in two days
>
> B146 shipped a screen that rendered perfectly and was **entirely invisible**:
> `BuddySessionBody` had no styling at all, and React Native defaults `Text` to
> black against `colors.bg` = `#0F0F1A`. Seven component tests passed
> throughout, because `getByText` finds text whatever colour it is.
>
> The assertion added to prevent recurrence **then failed the same way**: it
> only inspected the render state its single fixture produced, leaving four
> styled branches unguarded. You could delete their `color` keys and every test
> still passed. Now parameterised over five fixtures, with all four removal
> probes producing real failures.
>
> **The rule this yields:** an assertion over "what is currently on screen" is
> scoped by the fixture, not by the component. Enumerate the states.
>
> ### 🟡 Deliberately unbuilt — gaps, not bugs
>
> Owner's call, with a trip next week:
>
> | | |
> |---|---|
> | **The archive** | nothing writes `buddy_commitments.superseded_at`, and `section.archived` / `pastAgreements` have **no renderer**. Computed and discarded. Spec §3 and §11 depend on it |
> | **Offline caching** | `load()` still sets `view: null` on failure, wiping the notebook instead of showing it read-only. `OfflineBanner` exists and is unused here. Spec §11 |
> | **Translation escape hatch** | no endpoint, never wired. `TutorNote` correctly hides the control rather than showing a dead button. Spec §6.2 |
> | **`tutor_notes.language`** | never set by any authoring path, and `onSpeak` hardcodes `ja-JP` — an English note is read aloud in a Japanese voice. Spec §5.3 |
> | **Virtualisation** | live entries render unbounded inside a `ListHeaderComponent`, which cannot virtualise |
>
> ### 🛑 `checkTutorConstraint` was deliberately not built — do not re-invent it
>
> Spec §6.3's rule (Buddy defers to a live tutor note) has no caller until slice
> 2, so building it now would have shipped dead code. **It is written down in
> the spec and nowhere in the codebase.** Slice 2 must implement *that* rule
> rather than inventing a second one. Verified absent: no `'ask' | 'propose'`
> logic exists anywhere on this branch.
>
> ### 🛑 Before any build: one API commit is unshipped
>
> `2cab737` on `main` — the placement seeding fix — postdates the 13:29 deploy.
> `git log --since=<last deploy> -- apps/api packages/shared` returns it, which
> is exactly the SOP's pre-build gate. **Deploy before building**, or seeding is
> inert in the binary — the B144 failure precisely.
>
> Phase 6 additionally needs migration `0032` applied to live before its API
> deploys, and `docs/local-test-db.md` now lists `0031` and `0032` (`0031` was
> never added when it shipped).
>
> ### What is still owed
>
> 1. **The B146 device walkthrough** — still not done. Both slices deployed
>    today are unproven on a real device.
>    [Test plan](b146-test-plan.md).
> 2. **Phase 7** — specced, unplanned, unbuilt.
> 3. **The five gaps above**, if the notebook is to match its spec.
>
> ---

# Previous — 2026-07-31 later (**both slices merged, migrated, and DEPLOYED — one device walkthrough owed**)

> **Canonical URL:**
> https://github.com/radmelon/kanji-learn/blob/main/docs/HANDOFF.md
>
> *(This line is deliberately part of the artifact. A handoff that cannot state
> its own address makes every reader reassemble it from a bare path. Carry it
> forward into each new handoff section.)*

## START HERE — 2026-07-31 (later)

> ## ✅ The stack is unstacked. `main` is deployed and live.
>
> The three-day gap is closed. Both slices — the placement model and the weekly
> Buddy review — are merged, migrated, and serving.
>
> | | |
> |---|---|
> | `main` | `1a4aaf3` |
> | Merge | `78e615c` — fast-forward, 32 commits, no conflicts |
> | Migrations on live | `0029`, `0030`, `0031` applied and verified by content |
> | `kanji_difficulty` | 2294 rows, **recomputed after the fix below** |
> | API deploy | `START_DEPLOYMENT SUCCEEDED` 13:25:19 → 13:29:08, image `sha256:efce8a74…` |
> | Verified | `GET /v1/buddy/session` **404 → 401** against a pre-state captured before deploying |
> | **B146** | `c3cd48d6-59ac-43ef-880c-f1ddc503b26c`, cut 13:43, `--auto-submit` |
>
> B146 carries the mobile halves of **both** slices, which is why one build
> discharged two device walkthroughs. `EXPO_NO_CAPABILITY_SYNC=1` was set, as it
> must be on every profile — it is what stops EAS trying to switch `APPLE_ID_AUTH`
> off on the live App Store bundle.
>
> ### 🔴 The deploy was stopped once, and the reason is the whole story
>
> **`refreshKanjiDifficulty` ran successfully and produced 2294 rows of wrong
> numbers.** Step 4 of the forced sequence exists to stop placement returning
> "an empty test, not an error." It ran. The table filled. The *values* were on
> the wrong scale, and every downstream check would have passed.
>
> `refreshKanjiDifficulty` computed `b_observed` as `difficulty - 5` — correctly
> centred — and then handed `fitWeights` the **raw** `user_kanji_progress.difficulty`
> column. OLS put that column's ~5 midpoint into the intercept, so `bPrior`
> returned FSRS-scale values while `bObserved` returned logits, and `blend()`
> averaged two different quantities.
>
> Measured on live before the fix:
>
> | | mean | range |
> |---|---|---|
> | `b_prior` | **7.74** | 2.41 → 11.49 |
> | `b_observed` | **-0.12** | -4.00 → 5.00 |
>
> `THETA_GRID` is `[-4, 4]`. **Only 285 of 2294 kanji fell inside it**, and only
> 84 could ever clear the 0.85 seeding threshold — and then only for a learner
> pinned at the θ ceiling. Placement would have returned 200 OK, selected items
> nobody could be matched to, and seeded almost nothing.
>
> **Fixed in `1a4aaf3`.** `fitWeights` now fits on the b scale through a named
> `fsrsDifficultyToB`, the inverse of the existing `bToFsrsDifficulty`, so the
> conversion is single-sourced instead of open-coded in one place and forgotten
> in the other. `rSquared` shifts its target too — a b-scale prediction compared
> against a raw FSRS value sends R² negative and trips the fallback on a healthy
> fit, which would have traded one silent misbehaviour for another.
>
> **Verified on live after recomputing**, and this is the check that matters:
>
> | Subset | count | `b_prior` | `b_observed` | corr |
> |---|---|---|---|---|
> | kanji with both | 592 | **-0.17** | **-0.12** | **0.589** |
> | never reviewed | 1702 | 3.76 | — | — |
>
> On every kanji where the model can be checked against reality, the two agree
> to 0.05 logits. The overall mean of 2.75 is the 1702 never-reviewed kanji, and
> that is the model correctly saying the untouched kanji are the hard ones — a
> property of the population, not a scale error. 1400 rows now sit inside the
> grid, against 285 before.
>
> ### 🔴 Why nothing caught it — the sixth "test that could not fail"
>
> The previous section of this file counted five review findings that were each
> a check incapable of failing. **This is the sixth, and it reached production
> data.**
>
> Two independent reasons, and both matter:
>
> 1. **`placement-difficulty-fit.test.ts` asserted `w1` and `w2` and skipped
>    `w0`** — the only coefficient that carries the scale — while generating its
>    own fixture as `y + 5`. The test knew about the offset and declined to
>    assert on it.
> 2. **The fitted branch was unreachable from the test suite.** The local test
>    database holds **10** fit rows against `MIN_ROWS = 300`, so
>    `shouldUseFallback` is always `true` there and every integration test runs
>    `DEFAULT_DIFFICULTY_WEIGHTS`, where `w0 = 0` and the scale is correct by
>    construction. Live had 945 rows and took the other path. **No amount of
>    running the existing suite could have found this.**
>
> Both new tests were run red first. `w0` came back `6.0000336` against 1;
> composed through `bPrior`, the population mean came back `5.000000000000002`
> against 0. Off by exactly the offset, twice — which is what a test proving the
> right thing looks like.
>
> The second new test covers the *seam* (`fitWeights` → `bPrior`) rather than
> either function, and asserts `shouldUseFallback(rows, fitted) === false` so
> the fitted branch is genuinely under test. It needs no database, so the
> unreachable branch is now reachable.
>
> **The transferable rule, and it is sharper than "add a control assertion":**
> when a function has a fallback branch, check which branch the tests actually
> execute. A guard whose safe path is the only tested path is not tested.
>
> ### 🛑 `docs/SOP.md` had a wrong runbook that passed its own check
>
> Corrected in `2acd737`. The "Quick deploy (source-based App Runner)" block
> described building TypeScript, `git push`, then `start-deployment`. **This
> service is ECR image-based** — `AutoDeploymentsEnabled: false`,
> `CodeRepository: null`. `git push` reaches nothing.
>
> Running that block would have called `start-deployment` against the image
> already running, and App Runner would have recorded a
> `START_DEPLOYMENT SUCCEEDED` operation dated today — **satisfying the
> freshness check the same file prescribes.** A wrong runbook that passes your
> own verification is worse than no runbook. `./scripts/deploy-api.sh` is the
> only path. The stale `~/Documents/projects/kanji-learn` path is fixed too.
>
> ### The canary, and why this verification was stronger than the SOP asked for
>
> **Capture the pre-state before deploying.** Before the deploy,
> `GET /v1/buddy/session` returned `404 {"message":"Route GET:/v1/buddy/session
> not found"}`. After, it returns the app's own
> `401 {"ok":false,"error":"Unauthorized","code":"UNAUTHORIZED"}` from
> `apps/api/src/plugins/auth.ts`. A 401 there **cannot** be produced by the old
> image, and unlike `/v1/mnemonics/refresh` there is no parametric route that
> could shadow it. A control request to `/v1/buddy/nonexistent-route` still
> returns Fastify's 404, proving the negative case still works.
>
> That last control is the part worth copying. Without it, "everything returns
> 401 now" is indistinguishable from a route that exists.
>
> **Note for whoever verifies the next deploy:** full body verification needs a
> real token. Auth verifies ES256 against Supabase's JWKS, so the local
> `SUPABASE_JWT_SECRET` cannot sign an acceptable one. The 404→401 transition is
> the strongest check available without a signed-in device.
>
> ### 🟡 What is still owed — the device walkthrough, and only that
>
> Nothing else from the forced sequence is outstanding. The walkthrough covers
> both slices and none of it is testable off-device.
>
> **Run it on an `America/Los_Angeles` account.** The hourly pass deliberately
> SKIPS rows still on the `'UTC'` default rather than guessing at a local day,
> so testing on a UTC account shows silence and a working guard reads as a
> broken feature. Live timezone spread: LA 2, UTC 2, Tokyo 1.
>
> *Placement:* the adaptive test end to end. The prediction to check is that it
> stops at ~13 items rather than 60, and seeds ~2 kanji rather than 44.
> **`kanji_difficulty` is now correctly scaled, so this prediction is finally
> meaningful** — before the fix it would have seeded ~0 and looked like a
> different bug.
>
> *Weekly review:* set a `buddy_day` in Profile; confirm the push arrives at
> `reminder_hour` local on that day; **tap it from a killed app and from a
> backgrounded app**, confirming both land on the session screen; confirm no
> double-navigation when the screen is already open; confirm the Profile entry
> reaches it with no push involved; run one full session and confirm the
> commitment persists.
>
> That notification-tap routing is the one deliberate test gap on the branch —
> there is no harness for mounting `_layout.tsx` and a shallow mock would only
> test the mock. It is owed here.
>
> ### Open decisions — still yours, unchanged by this session
>
> 1. **`POST /v1/buddy/session/commitment` validates `weekStart` only as a
>    date-shaped string**, so a client can write a commitment for any week
>    rather than the one due. Orphan rows outside the cadence are possible.
> 2. **Nothing is known to alert on the `[BuddyDay]` log prefix.** The endpoint
>    returns `{ok: true}` regardless. The code-level signal is sound; whether
>    anything consumes it is unverified.
> 3. **Spec §11 item 3 — when a new learner is first offered an appointment.**
>    There is still **no path that sets `buddy_day` except the Profile screen**.
>    Shippable, since the appointment is opt-in, but a new learner will not find
>    it unless they go looking. Resolve before slice 2, where the first session
>    carries Frame's `ask`.
> 4. **B-210 and `learner-state-refresh` fixture isolation** — one session for
>    both. See below; this session did not touch it, and the new finding above
>    makes it more urgent, not less.
>
> ### The fixture-isolation session now has a third item
>
> Previously two: `placement-service`'s B-210 order dependency and
> `learner-state-refresh`'s intermittent `setImmediate`/50ms race. **Add a
> third:** the local test database cannot reach the fitted-weights branch,
> because it holds 10 rows against a 300-row threshold. That is not a flaky
> test — it is a whole code path the suite structurally cannot execute, and it
> is what let a production-data bug through today. Whatever fixes fixture
> isolation should seed enough pooled review history to cross `MIN_ROWS`.
>
> **Known-failure lists must enumerate, not count.** Still true, and the
> remaining API failures are three: `rls-coverage` (seven genuinely unprotected
> legacy tables — `placement_*`, `tutor_*`, `user_push_tokens`,
> `kanji_difficulty`), the B-210 order dependency, and `learner-state-refresh`.
>
> Note `kanji_difficulty` is one of those seven by design — migration `0029`
> creates it without RLS, matching `kanji`'s precedent as global reference data.
> That is deliberate and documented in the migration; it is not a new gap.
>
> ### What slice 2 is
>
> Unchanged: the conversation — cloud tier, `buddy_conversations`,
> `buddy_learner_facts` with the seeding pass over hooks and onboarding, parked
> topics, the profile dual-write, elicitation, `retract_fact`/`correct_fact`,
> trajectory and frontier checks, escalation with the ask-for-time protocol, and
> the per-dimension drill diagnosis (§10 of the spec — a `groupBy` change on the
> existing weak-kanji queue, not a new feature).
>
> ---

# Previous — 2026-07-31 earlier (**Weekly Buddy Review: spec, plan, and slice 1 complete — on a branch, not `main`**)

## START HERE — 2026-07-31 (superseded by the section above)

> ## 🚨 FIRST: the live API is three days behind `main`, and the placement model was never deployed
>
> **Verified 2026-07-31 by App Runner operations, not by assumption:**
>
> ```
> aws apprunner list-operations --service-arn arn:aws:apprunner:us-east-1:087656010655:service/kanji-learn-api/470f4fc9f81c407e871228fb9dd93654 --region us-east-1
> → most recent SUCCEEDED deployment: 2026-07-28T10:37
> ```
>
> The placement model merged to `main` on **2026-07-30** (`a81ff37`, `8f745c2`).
> Nothing has deployed since. **Two slices are now stacked undeployed:** the
> placement model on `main`, and the weekly Buddy review on this branch.
>
> That is the real answer to "is it time to cut a build?" — **the blocker is not
> the build, it is that nothing has shipped.** Details and the recommended
> single combined sequence are in *Cutting the next build* below.
>
> ## 🟡 This slice is on branch `weekly-buddy-review-spec`, pushed, not merged
>
> ```bash
> git checkout main && git merge weekly-buddy-review-spec
> ```
>
> 30 commits, 37 files, +7,043 lines. Pushed to origin 2026-07-31.
> PR: https://github.com/radmelon/kanji-learn/pull/new/weekly-buddy-review-spec
>
> Review before merging — see *Open decisions* at the bottom, which are yours
> and not the implementers'.
>
> ### What exists now
>
> | | |
> |---|---|
> | **Design spec** | [`2026-07-30-weekly-buddy-review-design.md`](superpowers/specs/2026-07-30-weekly-buddy-review-design.md) — 11 sections, complete |
> | **Slice-1 plan** | [`2026-07-31-weekly-buddy-review-slice-1.md`](superpowers/plans/2026-07-31-weekly-buddy-review-slice-1.md) — 12 tasks, all executed |
> | **Slices 2 and 3** | designed in §10 of the spec, not yet planned |
>
> **The feature:** a weekly appointment with Buddy on a day the learner picks.
> Buddy opens in a register chosen by the shape of their week, reports on the
> commitment they agreed last time, and they set the next one. The commitment is
> **effort and method, never volume** — days and minutes, not kanji learned,
> because volume depends on review debt and card difficulty and a learner can do
> everything right and still miss it.
>
> Slice 1 is the ritual on the **template tier** — no LLM anywhere. That tier is
> not scaffolding: it is the permanent floor every later offline, rate-limited,
> and outage path falls back to.
>
> ### Verified on the branch (after the whole-branch review and its fixes)
>
> | Lane | Result |
> |---|---|
> | `packages/shared` | **268 passing** (was 193) |
> | `apps/api` | **397 passing**, 2 skipped, 3 failing — all pre-existing, see below |
> | `apps/mobile` pure | **154 passing** (was 144) |
> | `apps/mobile` components | **7 passing** (was 1) |
> | `pnpm -r typecheck` | clean, 0 errors |
>
> ### 🔍 The whole-branch review returned NOT READY, and was right
>
> Per-task reviews all passed. The final review then found four defects that
> **only exist in the seams between tasks** — every individual function was
> correct. Fixed in `33e4595` (API) and `09fb7c9` (mobile), with migrations
> `0031` adding `buddy_cadence_changed_at` and `buddy_last_invited_at`.
>
> - **The fortnightly tier was unreachable.** `getMissCount` and `nextCadence`
>   are each correct; together on an hourly loop they stepped a learner
>   weekly → fortnightly → off within two hours, sending two contradictory
>   pushes. Nothing recorded that the pass had already acted.
> - **Both of those fired at local midnight** — the step-down branch
>   `continue`d before the `reminderHour` gate.
> - **Step-down triggered after two misses, not three.** `ensureForWeek` writes
>   the current period's row, then `getMissCount` counted it.
> - **The invitation re-pushed every day of the due window** — four days
>   weekly, eight fortnightly — for a feature whose premise is not nagging.
> - **The mobile screen was unreachable**: no route, and no
>   `addNotificationResponseReceivedListener` anywhere in the app, so the
>   `buddy_session` push payload had no handler at all.
>
> **The transferable point:** none of these are bugs in a function. They are
> bugs in a composition, and only a review of the whole sees a composition.
> A plan executed task-by-task with clean per-task reviews can still assemble
> into something broken.
>
> ### 🛑 The deploy sequence is forced
>
> | | Step | Why here |
> |---|---|---|
> | 1 | Apply migration `0030` to live | the API reads `buddy_commitments`; deploying first means 500s |
> | 2 | Deploy API | — |
> | 3 | **Verify by CONTENT, not status code** | `GET /v1/buddy/session` must return a body containing `state`. `docs/SOP.md` records a rollout called "verified" on a status code while App Runner served a six-week-old image |
> | 4 | EAS build + submit | mobile calls the new endpoints |
> | 5 | Device walkthrough | the `buddy_day` push has never fired on a real device |
>
> **No EventBridge change is needed, and that is deliberate.** The hourly pass
> rides the existing `POST /internal/daily-reminders` invocation.
> `apps/api/src/cron.ts:8` records why in-app `node-cron` is wrong here — it
> double-fires once App Runner scales past one instance — and a new rule is an
> infra step that gets missed at deploy time.
>
> ### 🔵 Two corrections to things this project believed
>
> **1. `user-delete` was never a product bug, and is now fixed.**
> `drizzle-kit push` builds the local test DB from `schema.ts`, where
> `learnerIdentity.learnerId` is a bare primary key with no `.references()`.
> Production gets that FK from migration `0016`; the local database never did,
> because `0016` was missing from `local-test-db.md`'s hand-applied list. So the
> cascade test failed, left the row behind, and every later run died on
> `duplicate key value violates unique constraint "learner_identity_pkey"`.
> Read as a fixture bug for months; it was a missing constraint, missing only
> locally. `local-test-db.md` now lists `0016` and `0030` plus the orphan-cleanup
> command.
>
> **2. `placement-service`'s B-210 test is order-dependent, and is telling the
> truth.** It passes only when its file runs FIRST in a vitest process. Any
> preceding integration file makes it fail on its own control assertion — *"no
> kanji were seeded, so this run cannot demonstrate that protection did
> anything"*. Reproduced with `learner-profile` and `dual-write` (both unrelated
> and pre-existing) and with the `0016` FK dropped, so it is **not** caused by
> this session's work.
>
> **The significance is uncomfortable.** That control assertion was added last
> session precisely so B-210 could not pass vacuously — and what it now reveals
> is that **in full-suite runs the test has not been proving anything.** It is
> not newly broken; it is newly honest. Fixture isolation needs its own session.
>
> **Remaining API failures are three, all pre-existing and none caused by this
> branch:** `rls-coverage` (seven genuinely unprotected legacy tables —
> `placement_*`, `tutor_*`, `user_push_tokens`, `kanji_difficulty`), the B-210
> order dependency above, and `learner-state-refresh`, which is **intermittent**
> — a `setImmediate`/50ms timing race that appears in some full-suite runs and
> not others.
>
> **That makes two documented fixture-isolation failures in this repo**, both
> passing or failing on execution order rather than on the code under test.
> They deserve one session together, not another round of being counted as
> noise.
>
> ### 🔴 The lesson this slice actually taught
>
> Six review findings across the chain. **Five were a test or check that could
> not fail**, and three of those trace to defects in the plan's own text — the
> plan written to prevent exactly that.
>
> - Task 6: the plan's "delete the guard, watch it go red" step **did not
>   reproduce** — the test short-circuits on a read before reaching the guard.
>   The implementer proved the guard by hand and then deleted the proof.
> - Task 7: route correct, but the only `due`-state test was the one case where
>   the copy function ignores its argument. The fix's red run printed
>   `expected '0 days this week…' to contain '6'`.
> - Task 11: Profile controls PATCHed two new fields the Zod schema did not
>   list. `z.object()` **strips** unknown keys — 200 returned, values discarded.
>   A verbatim recurrence of the four-inert-features bug already in this file.
> - Task 1 (mine): migration `0030` enabled RLS without forcing it, adding an
>   eighth table to a `rls-coverage` list already red for seven. Invisible
>   behind a summary count.
>
> **The constraint "every guard test carries a control assertion" is not
> enough.** Only running the test against the removed rule proves anything.
> Every fix that mattered this session was demonstrated red first, and the
> plan for slice 2 should require that, not merely the assertion.
>
> Related: **known-failure lists must enumerate, not count.** "3 pre-existing
> failures" is not a baseline — it is what let an eighth table hide behind
> seven.
>
> ### Open decisions — yours, not the implementers'
>
> 1. **`POST /v1/buddy/session/commitment` validates `weekStart` only as a
>    date-shaped string**, so a client can write a commitment for any week
>    rather than the one due. Matches the plan's own sample, so it is a design
>    gap rather than a deviation. Orphan rows outside the cadence are possible.
> 2. **Nothing is known to alert on the `[BuddyDay]` log prefix.** The hourly
>    pass now isolates per-user failures and logs a distinctive summary line,
>    but the endpoint still returns `{ok: true}` regardless. The code-level
>    signal is sound; whether anything consumes it is unverified.
> 3. **Spec §11 item 3 is still open — when a new learner is first offered an
>    appointment.** Slice 1 therefore has **no path that sets `buddy_day` except
>    the Profile screen**. Shippable (the appointment is opt-in) but a new
>    learner will not find it unless they go looking. Resolve before slice 2,
>    where the first session carries Frame's `ask`.
> 4. **B-210 and `learner-state-refresh` fixture isolation** (above) — one
>    session for both.
> 5. **The notification-tap routing has no test, deliberately.** There is no
>    harness in this repo for mounting `_layout.tsx` or mocking
>    `expo-notifications`' response surface, and a shallow mock would only test
>    the mock. **Owed at deploy step 5**, and specifically: that tapping a
>    `buddy_session` push opens the screen from both killed and backgrounded
>    states, that it does not double-navigate when the screen is already open,
>    and that the Profile entry reaches it with no push involved.
>
> ### 🚢 Cutting the next build — one deploy, one build, both slices
>
> **Recommendation: do not cut a build for the weekly review alone. Merge,
> deploy both slices in one forced sequence, then cut ONE build that carries
> both device walkthroughs.**
>
> Three reasons it has to be combined rather than sequential:
>
> 1. **Deploying placement alone breaks installed builds.** The placement model
>    changed `POST /v1/placement/complete` from `results: [{kanjiId, passed}]`
>    to `responses: [{kanjiId, itemType, correct}]`. B145 sends the old shape.
>    The moment that API deploys, placement is broken for anyone on B145 —
>    onboarding only, tiny tester group, but real. So a build has to follow
>    immediately anyway; there is no version of this where you deploy placement
>    and wait.
> 2. **Both slices owe a device walkthrough and neither has had one.** One
>    build discharges both.
> 3. **Budget is not the constraint.** ~7 medium iOS builds remain and the
>    allowance renews **2026-08-04**. Spending one is cheap; spending two when
>    one would do is the only waste available here.
>
> **The combined sequence, in this order — every step is load-bearing:**
>
> | | Step | Why here |
> |---|---|---|
> | 1 | Merge `weekly-buddy-review-spec` to `main` | so one deploy carries both slices |
> | 2 | Apply `0029` (placement) to live | the API queries `kanji_difficulty`; deploying first means 500s |
> | 3 | Apply `0030` + `0031` (weekly review) to live | same reason for `buddy_commitments` |
> | 4 | **Run `refreshKanjiDifficulty`** | `selectNextItems` reads that table. Skip it and placement returns **an empty test, not an error** — it fails silently |
> | 5 | Deploy API | — |
> | 6 | **Verify by CONTENT** | an App Runner operation dated today AND a response field only the new build returns. `docs/SOP.md` records a rollout called "verified" on a status code while a six-week-old image served |
> | 7 | EAS build + submit | mobile calls the new endpoints in both slices |
> | 8 | Device walkthrough — **both** | see below |
>
> **What the walkthrough must cover, because none of it is testable off-device:**
>
> *Placement:* the new adaptive test end to end; the prediction to check is that
> it stops at ~13 items rather than the old 60, and seeds ~2 kanji rather than
> 44 (see the previous handoff's account analysis).
>
> *Weekly review:* set a `buddy_day` in Profile; confirm the push arrives at
> `reminder_hour` in local time on that day; **tap it from a killed app and from
> a backgrounded app** and confirm both land on the session screen; confirm no
> double-navigation when the screen is already open; confirm the Profile entry
> reaches it with no push involved; run one full session and confirm the
> commitment persists.
>
> **Timezone — checked 2026-07-31, and the walkthrough is safe:**
>
> ```
> Asia/Tokyo           1
> America/Los_Angeles  2
> UTC                  2
> ```
>
> **Run the walkthrough on an `America/Los_Angeles` account.** The hourly pass
> deliberately SKIPS rows still on the `'UTC'` default rather than guessing at a
> local day — so testing on one of those two would show silence, and a working
> guard would read as a broken feature.
>
> **The two stragglers self-heal; no backfill migration is needed.** Plan 4 Task
> 17 captures timezone at sign-in, which is why the server's "no captured
> timezone" warning has been falling: 5/5 → 3/5 → 2/5. Those accounts simply
> have not signed in since it shipped.
>
> **One divergence to know about before someone "fixes" it backwards.** The two
> jobs in `notification.service.ts` treat a `'UTC'` row differently, on purpose:
>
> | | Behaviour on a `'UTC'` row |
> |---|---|
> | `sendDailyReminders` | evaluates `reminderHour` against UTC anyway — fires, at the wrong local hour |
> | `runBuddyDayPass` | **skips the row entirely** |
>
> The buddy behaviour is the better one: a weekly appointment fired on the wrong
> day is worse than one not fired at all, and silence is diagnosable where a
> wrong-day push is just confusing. Do not "align" the buddy pass to the daily
> reminder — align the daily reminder to the buddy pass, if either.
>
> ### What slice 2 is
>
> The conversation: cloud tier, `buddy_conversations`, `buddy_learner_facts`
> with the seeding pass over hooks and onboarding, parked topics, the profile
> dual-write, elicitation, `retract_fact`/`correct_fact`, trajectory and
> frontier checks, escalation with the ask-for-time protocol, and the
> per-dimension drill diagnosis (§10 of the spec — a `groupBy` change on the
> existing weak-kanji queue, not a new feature).
>
> ---

# Previous — 2026-07-30 later (**placement model shipped to `main`; Arc brainstorm next**)

## START HERE — 2026-07-30 (later)

> ## 🎯 Next session: brainstorm the New Learner Arc around a weekly Buddy check-in
>
> **Do not start by re-reading the Arc spec.** Owner's call (2026-07-30): the
> Arc work needs **re-staging**, not a spec review — so open with
> `superpowers:brainstorming`, not `writing-plans`.
>
> ### The idea to brainstorm around
>
> The Arc design's projection trigger
> ([`2026-07-28-new-learner-arc-design.md`](superpowers/specs/2026-07-28-new-learner-arc-design.md),
> ~lines 726–730) wants to compare the placement posterior against progress
> since the last placement, to surface *"you've learned more than expected —
> want to retest?"*. **That trigger has never had a home.** Firing it
> mid-session interrupts; firing it on the dashboard is missable.
>
> **Owner's synthesis: the weekly scheduled study-plan review with Buddy is
> the container.** And it runs in *both* directions — "more than expected"
> (offer a retest, raise the plan) and "less than hoped" (reassess without it
> reading as failure). That symmetry is what makes it a *review* rather than a
> reward, and it is the part not to lose.
>
> The weekly-meeting framing may **reorganise** the Arc's Frame / Position /
> Invitation components rather than slot into them — which is why this is a
> brainstorm.
>
> **It is now unblocked by real data:** `placement_sessions.ability_theta` and
> `.ability_se` exist as of the merge below, so the comparison has something to
> run on. Before the merge it was reasoning about fields that did not exist.
>
> ### Also in Open Brain, and Arc-adjacent
>
> A search for enhancement ideas returned nine thoughts. Four belong in this
> brainstorm and should be read before it, not folded in blind:
>
> - **Dashboard velocity rework** — the estimate currently projects "All 2254
>   Jōyō Kanji: Nov 2034", which reads as a sentence being served. The framing
>   principle in the note is the useful bit: *velocity should feel like a lever
>   the learner controls*.
> - **Goal calculator** — learner picks "N2 by next year", app computes the
>   daily pace. The note flags it as the lightweight first slice of the AI
>   study-plan idea.
> - **"Study on the Go"** — flashcard-only mode without the writing/speaking
>   legs, for trains and public places.
> - **The weekly Buddy review** itself (captured 2026-07-30).
>
> Two more — geo-triggered hook recall and cloud "Buddy voice" TTS — are Phase
> 5+ and unrelated to the Arc.
>
> ---
>
> ## ✅ Shipped this session: the placement model, all 13 tasks
>
> `main` is at **`8f745c2`**. Two merges: `a81ff37` (placement model) and
> `8f745c2` (B-227 + study ⓘ + B-224 closure).
>
> Replaces the 56-line level staircase with a grid-based Bayesian posterior
> over ability: feature-derived difficulty, OLS weight fitting, adaptive
> selection by Fisher information, server-authoritative scoring, conservative
> seeding at p(knows) ≥ 0.85, and retests that start from the stored posterior.
>
> **Verified on `main`:** all four packages typecheck clean · shared 193 ·
> mobile pure 144 · components 1 · api 360 passing, 2 skipped. The 3 API
> failures (`rls-coverage`, `user-delete`, `learner-state-refresh`) are
> pre-existing — confirmed by stashing and reproducing them on a clean tree.
>
> ### 🛑 The deploy sequence is forced — one step is silent if skipped
>
> | | Step | Why here |
> |---|---|---|
> | 1 | Apply migration `0029` to live | the new API queries `kanji_difficulty`; deploying first means 500s |
> | 2 | Deploy API | — |
> | 3 | **Run `refreshKanjiDifficulty`** | `selectNextItems` reads that table. Skip it and placement returns **an empty test, not an error.** |
> | 4 | EAS build + submit | mobile calls the new endpoints |
> | 5 | Device walkthrough | none of this has run on a device |
>
> **Breaking change for installed builds:** `POST /v1/placement/complete` now
> takes `responses: [{kanjiId, itemType, correct}]`; B145 sends
> `results: [{kanjiId, passed}]`. Deploying the API breaks placement for
> anyone on an older build — onboarding only, tiny tester group, but real. Keep
> the API deploy and the new build close together.
>
> Budget is fine: **7 medium iOS builds** until the account renews 2026-08-04.
>
> ### Five defects in the plan, all fixed — worth knowing if you replay it
>
> 1. **A `shouldStop` test that could never pass** — expected an 80% CI ≤ 1.5
>    from 15 items at fixed `b=0`; measured 2.10, still 1.40 at n=60.
>    Informational, not a coding error: with `b` pinned while θ runs to ~2.4,
>    each further item carries almost no information.
> 2. **Missing enum member** — the SQL added `'placement'` to `review_type`,
>    the Drizzle schema did not, so Task 8 could not have typed its audit insert.
> 3. **An unrunnable verification step** — `pnpm db:generate` blocks on
>    interactive prompts about pre-existing FSRS-5 drift.
> 4. **Task 13 could not execute at all** — vitest imports in a Jest project,
>    in a directory its own verification command ignores. Rewritten as a
>    pure-lane store test.
> 5. **Two test blocks that passed exactly once per database** — no cleanup, so
>    a stored session survived into the next run. Only a *second* full run
>    surfaces this class; isolation runs never will.
>
> ### 🔴 The B-210 regression test was vacuous — and still cannot isolate the rule
>
> It passed with the never-overwrite protection **deleted entirely**. Its
> fixture sent two responses on one kanji, which cannot drive p(knows) past the
> 0.85 seeding threshold, so `completePlacement` bailed at `if (!seed) continue`
> before never-overwrite was consulted. The plan's most important test — the one
> guarding the bug that motivated the whole effort — was testing nothing.
>
> Rebuilt to raise θ on the easiest items, with a **control assertion** that an
> unprotected kanji really was seeded in the same call, so it cannot silently
> pass on an empty write path again.
>
> **It still cannot isolate `hasHistory`, and nothing of that shape can.**
> Seeding is `.insert(...).onConflictDoNothing()`, so an existing row is
> untouchable whatever the predicate says. Never-overwrite is enforced twice and
> the structural guard fires first.
>
> ### The §4.1 predicate change, and what it did *not* do
>
> Never-overwrite now keys on a real `review_logs` row rather than
> `total_reviews > 0`, because that counter can be incremented by a *write* —
> the old placement flow stamped rows with `total_reviews = 1` for kanji the
> learner never saw. Safe: `submitReview` writes the log and the progress row in
> one transaction, so a genuine review cannot exist without a log (verified in
> production: of 984 rows with `total_reviews > 0`, the only 44 without logs are
> one account's placement stamps).
>
> **Half of that change is inert, and the earlier briefing overstated it.**
> `selectNextItems` genuinely changed — a stamped kanji is offered again instead
> of excluded forever. `completePlacement` did not: `onConflictDoNothing` blocks
> existing rows either way.
>
> **So a retake will now ASK about those 44 kanji but cannot rewrite them.**
> Correcting them needs seeding to update rows with no `review_logs` — a real
> change to user data, deliberately not taken unilaterally. **Open decision.**
>
> ### The account behind all of this
>
> `602a09f3-55c3-428c-acd2-ed3bfcfbbd8c` — Scott Brause, a friend of the owner.
> Signed up 2026-07-07, took placement 19 minutes later, **never studied**. All
> 44 rows came from that single placement.
>
> Running his 60 real responses through the new estimator: **θ = 1.138**, 80% CI
> [0.70, 1.60], inferred level **N1** — the same label the old staircase gave,
> but with the crucial addition that conservative p(knows) at an average N1
> kanji is only **54%**. He is *at* the N1 threshold, not through it. The old
> flow stamped 44 kanji as remembered; the new rule would seed **2**. Forty-two
> of those stamps are unsupported by his own answers.
>
> **On asking him to retake:** a retake contributes **nothing** to calibration —
> `b_observed` comes from `review_logs`, and placement responses never feed it.
> That is structural, not a timing problem. Worth one favour *after* the new
> flow ships, to test a specific prediction (stops at ~13 items vs his 60; seeds
> ~2 of 44). Not before.
>
> **The calibration gap he represents is the real finding:**
>
> | Level | Kanji | With any review log |
> |---|---|---|
> | N5 | 79 | 100% |
> | N4 | 166 | 100% |
> | N3 | 370 | 88% |
> | N2 | 371 | **3.2%** |
> | N1 | 1308 | **0.2%** |
>
> Above N3 the difficulty model is *entirely* feature-derived prior with no
> observed component. Scott's θ rests on modelled difficulty because at N1 there
> is nothing to measure from. He is not an outlier to recruit — he is evidence
> about who the app currently serves.
>
> ### Also shipped
>
> - **B-227** — the Journal rendered nothing during a cold load; the owner
>   concluded the feature was unbuilt. Three body states now exhaustive, as a
>   pure decision in `apps/mobile/src/lib/journal-list-state.ts`. **The audit
>   the bug asked for came back clean** — `hasLoaded` exists in exactly one
>   place in the app, so this was the only instance, not a latent pattern.
> - **Study screen ⓘ** (from Open Brain, owner 2026-07-27) — the "How studying
>   works" explainer was a one-shot behind a SecureStore flag, so learners saw
>   the grading semantics once on day one and never on day thirty.
> - **B-224 closed as NOT A DEFECT.** Both premises refuted by querying all nine
>   co-created hooks instead of the one the report examined. Five have empty
>   components, four lack a quiz stamp, and the sets do not match; the quiz
>   never consults components. The stamp correlates perfectly with
>   `reinforcement_count > 0`, which is spec §8 clearing it on a *correct*
>   answer. 歯 has no stamp because the learner passed its quiz. **A fix would
>   have reintroduced the forever-refiring quiz the original plan review
>   caught** — the entry's instinct not to guess was right.
>
> ### Still open
>
> - **`learner-state-refresh` fails and is not in the known-failures list** in
>   [`local-test-db.md`](local-test-db.md). Not caused by this work — verified
>   by stashing. Either a regression or a stale doc; currently being absorbed as
>   accepted noise, which is how failures become permanent.
> - **The local test DB holds 7 kanji, not 2294.** Documented now. It makes a
>   whole class of test impossible — two cases skip with explicit preconditions
>   rather than flake. Seeding it would turn them back on.
> - **Whether to correct Scott's 44 rows**, as user-facing state, separate from
>   the model question.
> - **Supabase `ap-southeast-2` → `us-east-1`** after 2026-08-04. Upstream of
>   B-227's severity and the 10–15s Progress tab.

---

# Previous — 2026-07-30 (**placement repair: live scan found no damage**)

> ## ✅ Placement repair is done. The live database was never damaged.
>
> Task 5 of [`2026-07-29-placement-repair.md`](superpowers/plans/2026-07-29-placement-repair.md)
> ran against live Supabase on 2026-07-30. **The repair was a no-op: there is
> no B-210 damage to repair.** The branch is merged; the plan is closed.
>
> ### What the scan found
>
> | | |
> |---|---|
> | Target | Supabase hosted, `aws-1-ap-southeast-2.pooler.supabase.com`, project `pyltysrcqvskxgumzrlg`, PG 17.6 |
> | Safety dump | `/tmp/placement-repair-safety/live-20260730-0815.sql` — 4.8M, verified complete (984 `user_kanji_progress`, 3262 `review_logs`). **Deleted same session**, since no write was ever made. |
> | Detector | `Scanned 258 candidate row(s). Found 0 damaged row(s).` |
> | Writes to live data | **none** — Steps 4–6 deliberately not run |
>
> **A clean scan is not self-evidently correct, so it was verified by content**
> (the `docs/SOP.md` lesson, applied to a detector instead of a deploy). Two
> read-only queries against the `total_reviews = 1` population:
>
> ```
> status      stability  difficulty  rows  with_logs
> learning       3.1730      5.2824   112        112
> reviewing     15.6910      3.2245    52         52
> learning       1.1839      6.4883    48         48
> remembered    21.0000      5.0000    44          0   ← B-210 write signature
> learning       0.4026      7.1949     2          2
> ```
>
> **44 rows do match the damage signature exactly — and every one has zero
> `review_logs`.** By the plan's own Global Constraints that puts them outside
> its scope: placement over-claiming on a never-studied card, not destroyed
> history. There was nothing underneath them to destroy.
>
> **The healthy clusters are the confirming evidence.** Those uniform
> stability/difficulty pairs are deterministic FSRS first-review outputs, one
> per rating — `0.4026/7.1949` is rating 1 (and 7.1949 is `DEFAULT_FSRS_WEIGHTS[4]`
> exactly), `1.1839/6.4883` is rating 2, matching the corrected `S=1.18 D=6.49`
> figure noted in the previous handoff. Real reviews, replayed correctly.
>
> **The account the previous handoff flagged is clean.** `b8503589…` — now 111
> kanji in `learning`, up from the recorded 104 — has **0** signature rows. All
> 44 belong to `602a09f3…`, an account whose entire 44-row progress table is
> placement seeding with no reviews ever.
>
> ### What this unblocks
>
> **The placement-model plan's DB-touching tasks can start.** Their stated
> gate was "repair cleans up `user_kanji_progress.difficulty` first" — nothing
> needed cleaning, so the gate is satisfied.
>
> **Carry one open question into that work:** those 44 seeded rows are still
> `difficulty=5` for a user who has never reviewed anything. Not damage, but
> the new estimator will read them. The design's never-overwrite rule protects
> rows *with* history; decide explicitly what it does with a row carrying a
> placement stamp and no history.
>
> ### Also landed
>
> - Merge commit brings Tasks 1–4 to `main`: `packages/shared/src/placement-repair.ts`
>   (+ tests), `scripts/detect-placement-damage.mjs`, `scripts/repair-placement-damage.mjs`.
>   `pnpm --filter @kanji-learn/shared test` → **16 files, 141 tests passing** after merge.
> - Both environment gaps from the previous handoff are now fixed in
>   [`local-test-db.md`](local-test-db.md) under *Running a one-off node script
>   against a database*: the `?sslmode=disable` requirement, and the
>   `--import ./packages/db/node_modules/tsx/dist/esm/index.cjs` form. Also
>   documented there: **`with-live-db.sh` resolves `packages/db/.env` relative to
>   its own location**, so running it inside a worktree looks for the worktree's
>   copy — which is gitignored and absent by design. That, not missing
>   credentials, was the actual reason Task 5 stalled.
>
> ### Housekeeping
>
> The worktree `.claude/worktrees/placement-repair` (branch
> `worktree-placement-repair`) is **merged and no longer needed** — safe to
> remove with `git worktree remove`. It was left in place rather than deleted
> without asking.
>
> **Not pushed to `origin` yet** as of this writing.

---

# Previous — 2026-07-29 (**placement model planned; repair partially executed, paused for a live-DB session**)

## START HERE — 2026-07-29 (later)

> ## 🟡 Placement model: designed, planned, repair 4/5 done — needs a live-DB session next
>
> Resolves [`HANDOFF-placement-and-b210.md`](HANDOFF-placement-and-b210.md) — that
> file's questions are now answered; treat it as historical context, not a task list.
>
> **What landed on `main`, all committed:**
>
> - Design spec:
>   [`docs/superpowers/specs/2026-07-29-placement-model-design.md`](superpowers/specs/2026-07-29-placement-model-design.md)
>   — replaces the 56-line staircase with a Rasch (1-parameter IRT) ability
>   estimator over kanji-feature-derived item difficulty. B-210 is fixed by a
>   **never-overwrite rule** (placement never writes to a progress row with
>   real review history), not a guard.
> - Three implementation plans, each self-reviewed against its spec:
>   - [`2026-07-29-placement-repair.md`](superpowers/plans/2026-07-29-placement-repair.md)
>     (5 tasks) — **prerequisite, must land before the model plan's DB work.**
>   - [`2026-07-29-placement-model.md`](superpowers/plans/2026-07-29-placement-model.md)
>     (13 tasks) — the estimator, difficulty model, adaptive selection, schema,
>     mobile store/UI.
>   - [`2026-07-29-terminology-attribution-sweep.md`](superpowers/plans/2026-07-29-terminology-attribution-sweep.md)
>     (6 tasks) — SRS→FSRS copy fixes, independent of the other two. Scope was
>     expanded past the spec's own file list after discovering
>     `apps/mobile/app/(tabs)/index.tsx` contained a fabricated attribution to
>     Piotr Woźniak's SM-2 as "the basis for this app's scheduling engine" —
>     false since the FSRS-5 migration. Owner-confirmed before widening scope.
>
> **Repair plan execution — Tasks 1–4 done, reviewed clean, NOT merged to `main`:**
>
> Isolated worktree at `.claude/worktrees/placement-repair`, branch
> `worktree-placement-repair`. **Keep this worktree** — it has 4 real commits
> the repair plan needs, none pushed or merged yet:
>
> | Task | Commit(s) | Status |
> |---|---|---|
> | 1 — damage-signature predicate (`packages/shared/src/placement-repair.ts`) | `e8230fe` | reviewed clean |
> | 2 — read-only detector (`scripts/detect-placement-damage.mjs`) | `e8230fe..94acf6e` | 1 fix cycle (broken tsx invocation in header comment), re-reviewed clean |
> | 3 — proved the detector against a seeded fixture | no commit (validation only) | confirmed working |
> | 4 — repair script (`scripts/repair-placement-damage.mjs`) | `558b141` | reviewer independently re-ran dry-run/live-run/idempotency/unrepairable-branch — all clean |
>
> **Task 5 — run against the live database — is the reason this paused.** Two
> reasons, both deliberate, not oversights:
>
> 1. The worktree has no live DB credentials (`packages/db/.env` is gitignored
>    and is never copied into a new worktree by design).
> 2. The plan's own Step 3 is a mandatory human confirmation gate before any
>    live write — a subagent should not run past it regardless of credentials.
>
> **To finish:** from a session with `packages/db/.env` in place, either `cd`
> into the worktree above or re-enter it, then follow
> [`2026-07-29-placement-repair.md`](superpowers/plans/2026-07-29-placement-repair.md)
> Task 5 exactly — safety dump → read-only detector against live data → **stop
> and review the findings** → dry-run repair → live repair → verify clean →
> record the result in a new section here. Only then does the repair branch
> merge, and only then should the placement-model plan's DB-touching tasks
> begin (it reads `user_kanji_progress.difficulty`, which repair cleans up).
>
> **Two environment gaps worth fixing while someone's in there:**
>
> - `docs/local-test-db.md` doesn't mention that the local Docker Postgres
>   needs `?sslmode=disable` appended to `TEST_DATABASE_URL` — every script
>   in this session that connected had to discover this manually. It's
>   documented in an FSRS-rollout runbook, not in the doc a new session would
>   actually reach for.
> - `--import tsx/esm` fails on this pnpm workspace (root `node_modules`
>   doesn't hoist `tsx`) — the working form is `--import
>   ./packages/db/node_modules/tsx/dist/esm/index.cjs`. `replay-srs-fsrs.mjs`
>   already documented this; the two new repair scripts now do too. Any
>   future one-off script following that precedent should copy the same
>   header note rather than rediscovering it.
>
> **Minor, non-blocking:** the repair plan's Task 4 brief has a stale
> illustrative number (`S=0.40 D=7.19`) from an arithmetic slip — it assumed
> `quality=3` maps to FSRS rating 1; `packages/shared/src/srs.ts`'s
> `ratingFromQuality` actually maps it to rating 2 ("Hard"). Real output is
> `S=1.18 D=6.49`, confirmed against the unmodified function. Doesn't affect
> any shipped code, just a typo in the plan doc if anyone rereads it closely.

---

# Previous — 2026-07-29 (**local build-and-test protocol landed**)

## START HERE — 2026-07-29

> ## ✅ Local build-and-test protocol is now real
>
> The protocol requested in the previous handoff has landed as
> [`docs/local-build-and-test-protocol.md`](local-build-and-test-protocol.md),
> with the minimum transferable config in `apps/mobile`.
>
> **What changed:**
>
> - Kept the existing `ts-jest`/`node` mobile test lane intact for pure logic.
> - Added a separate component render lane:
>   `pnpm --filter @kanji-learn/mobile test:components`.
> - Added `jest-expo@54.0.17`, `@testing-library/react-native@13.3.3`, and
>   React 19.1-compatible `react-test-renderer`.
> - Aligned mobile `jest`/`babel-jest`/`@types/jest` to 29.x because
>   `jest-expo@54` failed under Jest 30 inside Expo runtime setup.
> - Proved the lane with a real React Native component test:
>   `apps/mobile/test/components/OfflineBanner.test.tsx`.
> - Updated `CLAUDE.md` and `docs/SOP.md`; future sessions should not repeat
>   the stale “no RTL” claim.
>
> **Verification after the change:**
>
> ```bash
> pnpm --filter @kanji-learn/mobile test -- --runInBand
> # 17 suites, 136 tests passed
>
> pnpm --filter @kanji-learn/mobile test:components
> # 1 suite, 1 test passed
>
> pnpm --filter @kanji-learn/mobile typecheck
> # passed
> ```
>
> **The transferable lesson:** use the pure lane for decisions and reducers,
> the component lane for focused JSX/render states, simulator/dev-client only
> for integration observations, and TestFlight/physical devices only for TTS
> quality, haptics, push delivery, Apple capability behavior, and final layout
> walkthroughs. For ABC Spike Phonics, copy the protocol shape but match
> `jest-expo` to its Expo SDK major version before installing anything.
>
> **Still not done by this session:** no EAS build was spent, no B145 bugs were
> fixed, and no Supabase region migration was attempted.

---

# Previous — 2026-07-29 (**next: a local build-and-test protocol**)

## START HERE — 2026-07-29

> ## 🔧 Next session: a local build-and-test protocol, reusable across projects
>
> **Why this and not features.** Every layout and voice judgement in this project
> currently costs an EAS build: ~$2, ~20 minutes, and a TestFlight round trip.
> The budget allows roughly **one** before it resets **2026-08-04**. Meanwhile
> the New Learner Arc spec is written and blocked partly on exactly this — Buddy's
> tone will need a dozen passes, and at one build per pass it will not get them.
>
> **Owner requirement (2026-07-29): the protocol must be useful for other
> projects too**, specifically the **ABC Spike Phonics** work. So the deliverable
> is a *portable protocol*, not a `kanji-learn` script. Expect it to end up as a
> document plus a small amount of config that transfers.
>
> ### The core finding to start from
>
> **The testing constraint everyone has worked around is a config choice, not a
> law.** `apps/mobile/jest.config.js` uses `preset: 'ts-jest'` with
> `testEnvironment: 'node'`. That is why:
> - anything containing JSX cannot be loaded by a test (`SyntaxError: Unexpected token '<'`)
> - anything importing an ESM-only package cannot either (`Cannot use import statement outside a module`)
>
> **Both errors were hit on 2026-07-28**, an hour apart, and forced three
> functions to be extracted purely to become testable — `teachingBeat`,
> `segmentByScript`, `selectStudyScreen`.
>
> And the workaround is already in the repo, applied ad hoc **four times**:
> `moduleNameMapper` hand-mocks `expo-web-browser`, `expo-auth-session`,
> `expo-secure-store` and `supabase`. Someone hits the wall, mocks that one
> module, moves on.
>
> **Neither `jest-expo` nor `@testing-library/react-native` is installed.**
> `jest-expo` exists precisely to handle the JSX + ESM transform for Expo apps.
> Whether adopting it is right is the session's first question — it would remove
> the constraint and the four hand-mocks, but it is a preset swap that could
> disturb **136 currently-passing mobile tests**. Evaluate, do not assume.
>
> ### What the protocol has to answer
>
> 1. **Component-level testing** — can we render components at all? (`jest-expo`
>    + `@testing-library/react-native`.) The repo's `CLAUDE.md` currently states
>    as fact that there is no RTL and jest is node-env; if that changes, that
>    file must change with it.
> 2. **Running the app locally.** A previous attempt cost an hour for zero
>    verification — see *Lessons* below, item 6: the device picker offered only
>    simulators, `xcodebuild` failed with error 65 (no Apple ID in Xcode), and
>    `eas build` tried to **disable Sign in with Apple on the production
>    bundle**. Understand why before retrying. Note this environment has an
>    **iOS Simulator MCP** available, which the earlier attempt did not use.
> 3. **What still genuinely needs a device** — and how to batch it. Some things
>    (TTS voice quality, haptics, real push delivery) will never be local.
> 4. **Portability to ABC Spike Phonics** — what is generic (jest preset, RTL,
>    simulator loop, "pure logic in `src/lib/`") versus what is kanji-specific.
>
> ### Budget reality
>
> EAS as of 2026-07-28: **~$40 of $45**, resetting **2026-08-04**. B145 is cut
> and submitted. Do not spend a build during this session unless the protocol
> itself demands one.
>
> ---
>
> ### Also queued, deliberately not next
>
> - **[`HANDOFF-placement-and-b210.md`](HANDOFF-placement-and-b210.md)** — the
>   placement model and B-210. **Do not fix B-210 as written**; the owner's
>   reframing dissolves it. Blocks the New Learner Arc spec.
> - **[`HANDOFF-behaviour-model.md`](HANDOFF-behaviour-model.md)** — the learner
>   behaviour model. Third in the queue. Burstiness turned out to reach into five
>   systems, which means the subject is bigger than the metric. Owner especially
>   wants the FSRS relationship worked out — and the starting position is that B
>   must **not** feed into FSRS's memory model, only the intersection.
> - **The New Learner Arc spec** — written, pushed, under owner review:
>   [`2026-07-28-new-learner-arc-design.md`](superpowers/specs/2026-07-28-new-learner-arc-design.md).
>   Next step after review is `writing-plans`.
> - **B145 device walkthrough** — [`b145-test-plan.md`](b145-test-plan.md).
>   Partly done: B-217, B-218, B-212(a) and the rotated Anthropic key all
>   confirmed on device. **B-216's C1 test never actually ran** — the coaching
>   toggle produced no profile PATCH, so the trigger never fired.
> - **Four new bugs from B145** — B-223 (teaching beat always says "beside"; owner
>   wants the deep IDS fix), B-224 (a hook with no dictionary-mapped components
>   gets no recall-quiz stamp — **not root-caused**), B-225 (TTS voice switch
>   abrupt), B-227 (Journal renders nothing while loading).
> - **Supabase `ap-southeast-2` → `us-east-1`** — after the EAS reset. Rotates
>   the three remaining Supabase secrets by construction.
>
> ### Done 2026-07-28/29, needing nothing further
>
> - **Ten B145 defects fixed**, API deployed and verified by content, B145 cut
>   and submitted.
> - **B-221** — daily reminders were firing at HH:54 because the EventBridge rule
>   used `rate(1 hour)`. Now `cron(0 * * * ? *)`; **confirmed firing at 19:00:03**.
> - **Secrets migration complete** — seven secrets moved from plaintext App
>   Runner env vars to SSM SecureString references; four rotated. Cutover window
>   ~1s. Runbook and reusable script: [`secrets-rotation.md`](secrets-rotation.md),
>   `scripts/rotate-secrets.sh`. **Next rotation due 2026-10-26** — the three LLM
>   keys expire 90 days from issue.

## Previous — 2026-07-28 (B145 submitted)

> ## 🟢 B145 is submitted. Walk it, then do the SSM migration.
>
> **The Task 19 device walkthrough is the only thing owed on Plan 4.** Nothing
> in B145 has been verified on a device — every fix is backed by pure-logic
> tests and typecheck only. The layout fixes (B-215/220 and the new
> `sessionLost` screen) are *unverifiable* off-device by construction.
>
> | | |
> |---|---|
> | Build ID | `aca10b1e-2332-4273-8436-4c2bed9d30b8` |
> | Version | 1.0.0 (**145**) — `app.json` auto-bumped 144 → 145 |
> | Submission | `cd0e0ba7-44e8-4fb6-bf80-31a5622d3aaf` — uploaded to ASC |
> | API | deployed **2026-07-28 10:37–10:42**, `3fddc1fc…`, verified by content |
>
> **The B-214 gap did not repeat.** The API was deployed *before* the cut and
> verified with a discriminating canary: `GET /v1/mnemonics` returns 401 while
> a nonexistent route returns 404. A status code alone would have proved
> nothing — that is the SOP lesson.
>
> **Watch for these three on device**, because they are the ones a test cannot
> reach: the B-216 "Session interrupted" screen (deliberately hard to trigger
> now — building a hook at Session Complete was the reproducer), whether the
> three sheets scroll to their footers on a long hook (暗, 510 chars, is the
> known worst case), and whether hook TTS now speaks the Japanese.
>
> **Then: the SSM Parameter Store migration**, which is blocked on the operator
> creating seven parameters — an agent must never see the values. Full runbook,
> including the `INTERNAL_SECRET` two-sided trap that would silently break
> daily reminders: [`secrets-rotation.md`](secrets-rotation.md).
>
> **Do NOT rotate the Supabase credentials.** Supabase has no in-place region
> change, so the `us-east-1` migration issues a new project — new ref, new
> keys, new JWT secret, new DB password. Four of the seven rotate for free,
> including the database password open since 2026-06-03.
>
> **The region migration needs an EAS build** (`EXPO_PUBLIC_*` are inlined at
> build time), and the budget is nearly spent until **2026-08-04**. Do it after
> the reset, and do *not* combine it with a defect build.

### What landed 2026-07-28

**Ten defects closed** — B-211, B-212(a,c), B-213, B-215, B-216, B-217, B-218,
B-219, B-220, B-222 — plus two owner decisions (reinforce freshness guard;
recall quiz no longer double-tests). Suites: shared **136/136**, mobile
**136/136**, API unit **207/207**, all three typechecks clean.

Three diagnoses came out sharper than their tickets:

- **B-216's second trigger was identifiable after all.** The ticket said not to
  guess at it; no guessing was needed. `reset()` was the cleanup of an effect
  keyed `[profile]`, and `useProfile.update()` notifies with a fresh object on
  every PATCH — so `CoCreationSheet.tsx:141`'s one-time location ask, which
  runs *while the learner builds a hook over Session Complete*, wiped the
  queue. And because the empty-queue branch rendered **above** Session
  Complete, whose `onDone` holds the only `setPhase('ready')` in the file, it
  unmounted the sole exit from the `'active'` phase. That is why it was a
  lockout rather than a cosmetic glitch.
- **B-215/220 was not only `flexShrink`.** Yoga gives flex items
  `minHeight: auto`, so a child will not shrink below its content's intrinsic
  height no matter what `flexShrink` says. `minHeight: 0` was the missing half.
- **B-212 never "skipped" the Japanese.** It was being asked to read it in an
  en-US voice. `speakMixed` segments ja/en runs and switches voice per run.

**Two bugs found by log inspection, not by testing:** B-221 (the EventBridge
rule was `rate(1 hour)`, which had drifted to HH:54 — every learner's reminder
arrived up to 59 minutes late, and a delay past HH:59 would silently skip an
entire hour's cohort; **fixed**, now `cron(0 * * * ? *)`) and B-222.

**A repo constraint worth internalising:** jest runs in a node environment with
no JSX transform *and* cannot load ESM. Anything imported from a `.tsx`, or
from a module importing `expo-speech`, is untestable here. This forced three
extractions this session — `study-screen.ts`, `teaching-beat.ts`,
`script-segments.ts`. Write pure logic in `src/lib/` from the start.

---

# Previous session — 2026-07-27 (Plan 4 code-complete through Task 18)

> **Superseded 2026-07-28.** Everything the block below asks for is done: all
> eight defects are fixed, the two cheap decisions are made, the API is
> deployed and B145 is submitted. Kept for the diagnoses and the traps.



> ## 🔴 B144 device testing found EIGHT defects. Fix them, then cut B145.
>
> **Do not cut a build first.** Budget as of 2026-07-27: **$38 of $45**, resetting **2026-08-04** — roughly 2–3 builds. All eight fixes are code-only and batch into one cut.
>
> **Blocker first — [B-216].** The Study tab shows *"All caught up!"* with 280 cards due and no way back but a force-quit. Hit twice, by two different routes (mid-session abandonment **and** a completed session), so **the trigger is not known** — fix the dead end, not a guessed trigger. Everything else is secondary; this is total loss of the app's core function.
>
> **Then, in rough value order:** [B-217] "this part" renders on 99% of kanji · [B-211] Journal cannot list hooks · [B-219] "Reveal the reading" has no reading · [B-215]/[B-220] sheet clipping (**one shared fix** — all three sheets cap at `maxHeight: 80%` and pin a footer) · [B-212] TTS drops the Japanese · [B-213] Speak-it coverage (blocked on B-212).
>
> **Three decisions are yours, in `ENHANCEMENTS.md`:** the recall-quiz redundancy, the reinforce freshness guard, and the Profile panel taxonomy (spec written, awaiting your review). Plus **B-210**, which you asked to give its own brainstorming session.
>
> **Before cutting anything, run the pre-build check now in [`SOP.md`](SOP.md)** — B144 shipped against an API four commits behind it and four features were silently inert until a second deploy.
>
> **What is already verified in production and needs no retest:** timezone capture (server warning `5/5` → `3/5`), push token registration (**RAD self-healed** — the account behind the three-month bug now has a token and a real timezone), the next-session recall quiz (暗: stamp cleared, `reinforcement_count` 1, effectiveness 0.5 → 0.7), and *"Looks like you're near Calabasas"* — a line that had never rendered since Plan 3b.
>
> **One question still unanswered:** whether the hook appears on the flashcard's **prompt** face or only after reveal. Code says answer-side only; the owner's report was ambiguous and 暗 (rank 2, due) has not come up since. If it is prompt-side, that is a §9 retrieval-protection violation and outranks everything above.

**State:** Plan 4 is **code-complete through Task 18**. Tasks 4/5 are deployed and verified in production. Everything else is committed and unbuilt. Live DB is clean (`mnemonics` = 0). Working tree clean except untracked `.codex/` and `supabase/`.

**Resume at Task 19 — the on-device walkthrough.** B144 is built and submitted; the walkthrough is what remains.

> 🔴 **BUILD BUDGET IS NEARLY SPENT — batch ruthlessly.** EAS credit usage as of 2026-07-27: **$38 of $45 (~84%)**, resetting **2026-08-04**. That is roughly **2–3 iOS medium builds** before every further build costs ~$2.
>
> Practical consequence: **run the FULL walkthrough on B144 before cutting anything.** A quick test of one feature already produced three defects (B-211/212/213), none of which were on the Task 19 checklist. Cutting a build per fix is the expensive mistake — a build cut to verify a fix that then needs another fix costs two.
>
> This is also the real reason Plan 4 batches device verification into a single cut: build *count* discipline, not per-build price.

```bash
cd apps/mobile && EXPO_NO_CAPABILITY_SYNC=1 npx eas build --platform ios --profile production --auto-submit
```

**`EXPO_NO_CAPABILITY_SYNC=1` is not optional.** Without it EAS tries to switch **Sign in with Apple OFF on the live App Store bundle**; only Apple's refusal has prevented it, twice. The SOP entry originally scoped this to *development* builds — it hit the production cut too. See [`SOP.md`](SOP.md).

**Never hand-bump `ios.buildNumber`** — `autoIncrement: true` does it. A capability-sync failure aborts *before* build creation, so `buildNumber` stays untouched and re-running skips nothing. Commit the auto-written `app.json` after a successful cut.

### ⚠️ SECOND API deploy, 2026-07-27 20:21 — B144 shipped against an API four commits behind it

`START_DEPLOYMENT` **SUCCEEDED 20:21:16 → 20:25:04**. Verified by content: `PATCH /v1/kanji/:id/snooze-buddy-moment` went **404 → 401** (no other PATCH route under `/v1/kanji` can shadow it), `/health` 200, `/v1/user/profile` 401-not-500.

**Why it was needed.** The first deploy was 13:32. Four commits carrying API changes landed *after* it — `5903373` (`mnemonicStoryText` on the queue), `122fddd` (`hintUsed`), `8d0c0f5` (snooze route + `buddyMomentSnoozedUntil`), `e29dd45` (`hookLocationAskSeenAt`) — and B144 was cut at 16:27 depending on all four. **Zod strips unknown keys instead of erroring**, so requests succeeded and silently dropped the new fields.

Four B144 features were inert until this deploy: the answer-side hook, the hint button (both gated on `mnemonicStoryText`), the "Not now" cooldown (404 swallowed by a `.catch`), and `hint_used`. **No client change was needed — the mobile code was correct throughout.** Logged and closed as **B-214**.

**The durable fix is a command, now in [`SOP.md`](SOP.md):** before cutting any build, check whether `apps/api` or `packages/shared` has commits newer than the last successful deploy. The prose version of this warning already existed in Plan 4 Task 5a *and* in this file, and was walked past four times in one session.

### B144 — cut 2026-07-27, awaiting Apple processing

| | |
|---|---|
| Build ID | `60b4704f-63eb-481c-9019-0772a8d8d25f` |
| Version | 1.0.0 (**144**) — `app.json` auto-bumped 143 → 144 |
| Submission | `ce6622f5-8f3b-4202-ba7c-89858ef35a47` — queued **server-side** by `--auto-submit` |

The submission is queued on EAS, not run by the local CLI afterwards (`Submission details:` prints *before* `Waiting for build to complete`). Killing the CLI does not skip it.

**App Store Connect prerequisites are already done** (operator, 2026-07-27): the app is renamed to KanjiBuddy, and the external tester is on the group. No ASC setup is owed for this build.

### What B144 testing found so far (2026-07-27 evening)

**Verified working in production:**
- **Task 17 (timezone)** — server warning went `5/5` → `4/5` → `3/5` as accounts ran B144. Buddy and RAD both now read `America/Los_Angeles`.
- **Task 18 (push tokens)** — **RAD self-healed**: the account that spent three months with `notifications_enabled=true` and **zero** tokens registered one on sign-in. Both push root causes confirmed fixed on the account that exhibited them.
- **Task 11 immediate quick-check** — 値 has `reinforcement_count: 1` and a cleared quiz stamp, so the post-save quiz ran and recorded its outcome.
- **Task 16 reducer fix** — *"Looks like you're near Calabasas"* rendered. That line had never once displayed since Plan 3b.

**Open bugs from testing:** B-211 (Journal cannot list hooks — missing endpoint), B-212 (hook TTS drops the Japanese; three sub-defects), B-213 (Speak-it missing everywhere hooks are read). All three are real and unaffected by the deploy. B-214 is closed.

**Not yet tested** — now unblocked by the 20:21 deploy: the next-session recall quiz (互 is due and carries a pending stamp, so it should lead the queue), the hint button, reinforce/deepen, the coaching toggle, and the "Not now" cooldown.

**Still owed: the Task 19 Step 3 walkthrough**, and it is the only thing that can close the push bug in `BUGS.md`. Two items carry the weight:
- a reminder arriving at the correct **local** time (root cause A — the server has been logging `5/5 users have no captured timezone` since today's deploy; Task 17 should drive that to 0/5 once this build runs once)
- the Profile warning appearing when a device has notifications on but no registered token (root cause B — RAD's account is in exactly that state right now)

Also re-run Step 4's probe: every account should show a real IANA timezone, and RAD should show `tokens >= 1`. Then walk the Task 19 Step 3 checklist on device, and re-run the Step 4 push probe: every account should now show a real IANA timezone, and RAD should show `tokens >= 1`.

**Task 19 Step 1's gate is green as of session end:** shared 128 ✅ · mobile 114 ✅ · both typechecks 0 errors · API 326/329 (the three documented pre-existing failures).

**Before running the API suite:** rebuild the test DB per [`local-test-db.md`](local-test-db.md). A stale one inflates failures by ~5 and will send you chasing ghosts.

### The push deploy is done — and both root causes confirmed themselves live

`./scripts/deploy-api.sh` ran at **13:32:48, SUCCEEDED 13:36:42**. Verified by *content*, not status codes — Tasks 4/5 add no HTTP surface, so the usual `components` canary cannot distinguish this build. The proof is in the 13:54 cron logs, which only the new build can emit:

```
[Notifications] 5/5 users have no captured timezone — evaluated against UTC
[Push] userId=f27fe3ca… accepted=1 delivered=0 pruned=0
[Push] userId=7c707446… has NO registered push tokens — nothing sent
```

That last line is **RAD's account** — root cause B, in production, exactly as diagnosed. `delivered=0` is expected receipt latency, not failure. `Sent 2 daily reminders (UTC 20:00)` is the counter working on `accepted`; on `sent` it would have read 0 on a healthy run.

**A deploy-script gotcha worth knowing:** running `deploy-api.sh` twice in quick succession makes the second run fail with `InvalidRequestException … isn't in RUNNING state`. That is the second invocation colliding with the first one's in-flight deployment, **not** a failed deploy. Check `list-operations` before re-running anything.

**Verification strategy is decided and written into the plan:** no dev client. Tasks 4–18 are verified by tests + typecheck; all device testing batches into **one TestFlight cut at Task 19**. Do not re-litigate this — see "Lessons" below for what it cost to learn.

### Plan 4 progress

| Task | What | State |
|---|---|---|
| 1 | Deprecated no-op stubs | ✅ deployed |
| 2 | Migration 0027 | ✅ applied live |
| 3 | Rollout (migrate→deploy→clean→merge) | ✅ done + verified |
| 6 | Reinforce: reducer, hook, `ReinforceSheet` | ✅ |
| 7 | Deepen: `buildDeepenedContext`, `useDeepen` | ✅ |
| 8 | Reinforce wired into Session Complete | ✅ |
| 9, 10 | Quiz item builder + scheduling | ✅ |
| 11 | Recall quiz — card, both hosts, queue leg | ✅ `045d394` |
| 4, 5, **5a** | Push fixes (server) + **their deploy** | ✅ `9c5a54d` — **deployed + verified live** |
| 12 | Layered hooks, "Go deeper", end of auto-generation | ✅ `c16da2e` |
| 13 | Hook on the flashcard answer side | ✅ `5903373` |
| 14 | Hint button, capped at Hard | ✅ `122fddd` |
| 15 | Coaching toggle + 7-day "Not now" cooldown | ✅ `8d0c0f5` |
| 16 | Hooks-location switch + one-time in-flow ask | ✅ `e29dd45` |
| 17 | Capture the device timezone | ✅ `b5fe229` |
| 18 | Resilient push token registration | ✅ `add3efb` |
| **19** | **EAS cut + the on-device walkthrough** | 🚧 **B144 building + auto-submitted** |

**Suites:** shared 128 ✅ · mobile 114 ✅ · API 326/329 (3 known pre-existing: RLS `FORCE`, user-delete cascade, `learner-state-refresh`) · all typechecks clean.

> **`learner-state-refresh` now fails in isolation too**, contradicting the earlier note that it passes alone. Confirmed **not** a regression: stashing this session's work and re-running it at `HEAD` reproduces the failure. Something in the shared test DB's state makes it fail regardless of code. Worth a rebuilt test DB before anyone chases it.

### What landed this session

Seven feature tasks plus the server deploy. Highlights, and the things a next session should not have to rediscover:

- **Task 11** — the recall quiz. One presentational `RecallQuizCard`, two hosts: the immediate quick-check in `CoCreationSheet`, and a new `'recall'` leg that runs *before* the flashcard next session. Distractors come from the session queue in-loop and from `/v1/kanji/:id/related` in the sheet.
- **Task 12** — also retired the **entire auto-generation UX** (§10.2), which **no task in the plan owned**. `MnemonicNudgeSheet` deleted, plus Generate/Regenerate and Quick/Rich. All three wrote old-style rows, so shipping them would have repopulated the clean slate Task 3 created. The plan's "Task 7 thread chooser" did not exist either — `DeepenSheet` is new.
- **Task 14** — the grade cap is enforced in `handleGrade`, **not** only in `GradeButtons`, because swipe-to-grade never touches those buttons. Hint → swipe right → Easy would otherwise have sailed through.
- **Task 15** — the review's cooldown finding was real: the cooldown set was built *after* the reinforce branch returned, so "Not now" on the highest-priority offer did nothing at all.
- **Task 16** — the "reducer gap" was one line. `LOCATION_SET` set the place name *and* advanced the stage, so "Looks like you're near X" was unreachable for all of Plan 3b.

### Five traps found this session

1. **`pnpm --filter @kanji-learn/mobile test` ran nothing and exited 0.** No `test` script existed in `apps/mobile/package.json`. Every mobile task in this plan names that exact command as its verification step. Fixed in `045d394`.
2. **ICU renders local midnight as hour `24`** under `hour12:false` on this Node build (verified). Without the guard, a midnight reminder never fires.
3. **`deploy-api.sh` run twice in a row** fails the second time with `isn't in RUNNING state` — a collision, not a failure. Check `list-operations` before re-running.
4. **`onPress={handleAccept}`** passes the gesture event as the first argument. Once `handleAccept` took an optional boolean, every tap read as `true`. Caught by typecheck; the same shape will bite anywhere a handler grows a parameter.
5. **A PATCH in flight is not a PATCH applied.** The first-time location ask had to pass its answer explicitly into `accept()`, or the very first hook would skip GPS despite the learner having just consented.

### Not done, and not owned by any task

**`DeepenSheet` is not wired into the reinforce branch.** Session Complete has neither the kanji payload nor the hook context that `useDeepen`'s slots need, so `onOfferDeepen` still closes cleanly. Only kanji detail hosts deepening. No plan task covers this; it wants a decision, not just an edit.

**Ticket-level `DEAD_TOKEN_ERRORS` still prunes on `InvalidCredentials`.** Receipt-level pruning was deliberately narrowed (a bad APNs key would otherwise delete every token in the system), but the ticket path is pre-existing behaviour and was left alone. Same hazard, smaller blast radius.

---

## Lessons from this session (read before repeating them)

**1. "401 not 404" is not a deploy gate — it cost a false "verified".**
`mnemonics.ts` has parametric `GET/POST /:kanjiId`, which swallow `/refresh`, `/assemble` and `/buddy-moment-context` on *any* build. I reported the Task 3 rollout verified on that signal while App Runner was still serving a **May 30th image** — Plan 2 had never deployed at all. Verify with an App Runner operation **dated today** plus **response content** (the `components` key is the Phase 5 canary). Now in [`SOP.md`](SOP.md).

**2. `deploy-api.sh` fails quietly.** It opens with `docker build`, which dies if the Docker daemon is down, and ECR login dies on a stale keychain entry (`-25299`; neither `DOCKER_CONFIG=` nor `docker --config` avoids it — delete the keychain item). Read the output to the end.

**3. The jsonb double-encoding bug came back.** `backfill-components.ts` called `JSON.stringify()` itself and cast with `as unknown as string[]`, defeating the global `mapToDriverValue` pass-through from Phase 1'. All 2,294 `kanji.components` rows were jsonb **strings**, so the API returned `components: null` and co-creation was broken in production from 2026-07-05. Repaired by migration 0028; script fixed.
**The 2026-07-05 check missed it because it asked whether the value *contained* 扌 and 寺 — which a double-encoded string does.** Check `jsonb_typeof`, never appearance.

**4. Plans confidently reference infrastructure that does not exist.** The Plan 4 tasks assumed `renderHook` (there is **no** `@testing-library/react-native`; jest runs in a node env) and `test/helpers/auth.ts` (only `test-app.ts` exists; auth is a bare `x-test-user-id` header). **Check what exists before trusting a plan's test scaffolding.** The repo's real mobile pattern is a pure reducer beside a thin hook — mirror `useCoCreation.reducer`.

**5. The adversarial plan review paid for itself many times over.** A 3-model Ringer swarm found **10 confirmed defects** in a plan I had already self-reviewed — including a **production-outage-grade ordering bug** (deploy-before-migrate) and the fact that the push fixes, as sequenced, **would never have deployed**. Both were mine. Run it on any plan of this size. GLM 5.2 produced 6 findings for 83k tokens; Codex 3 for 305k.

**6. Device testing is a trap mid-plan.** Standing up a dev client burned an hour for zero verification: the picker offered only simulators (physical devices were all offline), `xcodebuild` hit error 65 (no Apple ID in Xcode), and `eas build` tried to **disable Apple sign-in on the production bundle** (use `EXPO_NO_CAPABILITY_SYNC=1`). Only Apple's refusal prevented it. Batch to TestFlight.

**7. A stale test DB inflates failures.** Same commit read 7 failures dirty, 3 clean. Rebuild before judging, and before blaming a merge.

**8. Verify agent and tool claims against the source.** A failing `/assemble` looked like a real bug; it was my own probe sending `meaning` instead of `kanjiMeaning`. And a "stale EAS snapshot" concern evaporated once I checked the commit actually contained the merge.

---

## Reference

- **Live DB:** use `./scripts/with-live-db.sh <cmd>` — loads `DATABASE_URL` into the child process only, never printed or in shell history. `DATABASE_URL` is a **postgres connection string** (not the project URL), on the Supabase **pooler at port 5432 = session mode**, which `pg_dump` supports (6543 would break it).
- **Prod API:** `https://73x3fcaaze.us-east-1.awsapprunner.com` · App Runner ARN `arn:aws:apprunner:us-east-1:087656010655:service/kanji-learn-api/470f4fc9f81c407e871228fb9dd93654`
- **Still outstanding:** rotate the Supabase DB password (open since 2026-06-03; it was once printed to a transcript) and move App Runner secrets to SSM. Both in ROADMAP pre-launch.
- **Two open questions left deliberately unfixed:** migration 0018 contains **zero** `FORCE` statements yet `rls-coverage.test.ts` demands ENABLE *and* FORCE — either live has drift or that test has never passed against a migration-built DB. And there are **two parallel migration histories** (`supabase/migrations` 26 files, `drizzle/` 14) where four tables exist only in the drizzle set; they should probably collapse to one.
- **Shipped builds still create old-style mnemonics.** B143's nudge sheet can still hit the old generate path, so the clean slate will repopulate until Task 12 retires that UI (spec §10.2).
- **Roadmap naming:** `ROADMAP.md` groups are now **Waves** 0–6. Unqualified "Phase N" always means a Buddy product phase.

---

## TL;DR (2026-07-27)

**The June deadlock is over. `main` is shippable for the first time since Phase 5 began.**

1. **Plan 4 spec + implementation plan written, adversarially reviewed, corrected.** Spec `docs/superpowers/specs/2026-07-26-phase-5-plan-4-design.md`; plan `docs/superpowers/plans/2026-07-26-phase-5-plan-4.md` (20 tasks, 7 phases). A 3-model Ringer review swarm found **10 confirmed defects** in the plan its author had already self-reviewed — including a **production-outage-grade ordering bug** (deploy-before-migrate) and the fact that the push fixes, as sequenced, **would never have deployed**. Both fixed in `c9c2b74`. Full run: `~/.ringer/artifacts/live/plan-4-review.html`.
2. **The deadlock was structural, and the fix was ~10 lines.** Plan 2 deleted two refresh routes B143 still calls, which forced Phase 5 into one all-or-nothing cut. Task 1 (`9fe649a`) restored them as **deprecated no-op stubs** — the API and the EAS build are now independent. The runbook's "do NOT deploy the API alone" warning is obsolete and marked so (`a7ad463`).
3. **Task 3 rollout executed by the operator, verified by agent.** Migration 0027 applied **before** the deploy (the corrected order), API deployed, destructive cleanup run. Verified live: all five columns present with correct defaults (`mnemonic_coaching_enabled` = **true**), `mnemonics` = **0 rows**, `/health` 200, `/v1/mnemonics/refresh` **401 not 404** (B143 protected), `/v1/user/profile` **401 not 500** (ordering held), `/v1/mnemonics/assemble` 401 (Plan 2 surface live).
4. **`phase-5-cocreation-ui` MERGED** (`0f27a40`). One trivial BUGS.md conflict (stale TTS status), resolved in favour of `main`. Mobile typecheck 0 errors, mobile 67/67, shared 87/87.
5. **Daily push notifications ROOT-CAUSED** after three months (`a42e63b`). Not one bug but three — see BUGS.md. The April EventBridge fix was correct but addressed a different problem.
6. **The API test suite runs again.** It was completely unrunnable on this machine; now **290/293**. See `docs/local-test-db.md`.

### The push notification root cause (BUGS.md, full detail there)

- **A — `timezone` is never captured.** Nothing has ever written `user_profiles.timezone`, so every row keeps its `'UTC'` default and `reminderHour` — documented as being in the user's timezone — is evaluated against UTC. A 20:00 reminder fires at **1pm PDT**. Client fix = Plan 4 Task 17.
- **B — the accounts under test have zero push tokens.** RAD and the live tester both had `notifications_enabled=true` and **0 rows** in `user_push_tokens`. `sendToUserTokens` returned early and logged *nothing*. This is why the symptom read as "never," which masked A entirely.
- **C — receipts are never polled.** Expo tickets were treated as delivery, so `InvalidCredentials` / `DeviceNotRegistered` were invisible. `auth.store.ts:190` calls receipt pruning "the safety net" — it does not exist. This is why A and B survived three months and one confident fix.

### Test database — was unrunnable, now documented

`apps/api` integration tests could not run at all: 21 of 26 migrations abort without Supabase's `auth` schema, and **there are two parallel migration histories** (`packages/db/supabase/migrations/` 26 files, `packages/db/drizzle/` 14 files) — `friendships`, `learner_profiles`, `learner_identity` and `buddy_nudges` exist **only** in the drizzle set, so neither builds a working DB alone. Recipe + findings in [`docs/local-test-db.md`](local-test-db.md); shim at `docker/postgres-init/02-auth-shim.sql`.

**Two open questions surfaced, deliberately not fixed:**
- **Migration 0018 contains zero occurrences of `FORCE`**, yet `rls-coverage.test.ts` demands ENABLE *and* FORCE. Either live has drift the migrations don't capture, or that test has never passed against a migration-built DB. Adding FORCE changes production security semantics — operator decision.
- **The dual migration history** should probably collapse to one system.

### Residual API test failures (2, both pre-existing)

`rls-coverage` (the FORCE question above) and `user-delete` cascade. A third, `learner-state-refresh`, passes in isolation and fails in the full run — cross-test interference on the shared DB. **None are merge-related: the merge changed zero files under `apps/api`, `packages/db` or `packages/shared`.** Note that a stale test DB inflates these to 6–7; rebuild it per the doc before judging.

### Credentials

`scripts/with-live-db.sh` runs any command with the live `DATABASE_URL` loaded into the child process only — never printed, never in shell history. Task 3's commands all route through it. Verified facts: `DATABASE_URL` is a **postgres connection string** (not the project URL), on the Supabase **pooler at port 5432 — session mode**, which `pg_dump` supports (6543 is transaction mode and would break it).

**Still outstanding:** rotate the Supabase DB password (open since 2026-06-03 — it was once printed to a transcript in plaintext), and move App Runner secrets to SSM Parameter Store. Both written up in ROADMAP.

### Code shipped this session (not yet deployed / not yet built)

| Task | What | State |
|---|---|---|
| 1 | Deprecated no-op stubs | ✅ **deployed** |
| 2 | Migration 0027 + schema | ✅ **applied live** |
| 6 | Reinforce: pure reducer + hook + `ReinforceSheet` | committed, unbuilt |

**Plan deviation worth knowing:** the plan's tests assumed `renderHook`, but `apps/mobile` has **no `@testing-library/react-native`** and jest runs in a `node` env. Followed the repo's existing pattern instead — pure reducer beside a thin hook, mirroring `useCoCreation.reducer`. Same class of gap as the plan's reference to `test/helpers/auth.ts`, which also doesn't exist. **Check what exists before trusting a plan's test scaffolding.**

### Next session

1. **Task 5a is now load-bearing.** Tasks 4–5 (receipt polling, timezone predicate) are written *after* Task 3's deploy, so they need their **own** API deploy. Without it the push fix never reaches production and Task 19's verification cannot pass.
2. Phase 2 continues at **Task 7** (`useDeepen`) — now unblocked, since `CoCreationSheet` and `assembleStory` are both on `main`.
3. `main` is **23 commits ahead of origin** and unpushed.
4. Operator smoke still owed: create one co-created hook on RAD and confirm `generation_method='cocreated'`.

---

# Session Handoff — 2026-07-05 (Plan 3b walkthrough COMPLETE; migration 0026 LIVE; KanjiBuddy rebrand; B143 cut for first outside tester)

## TL;DR (2026-07-05)

1. **Plan 3b walkthrough COMPLETE — every checklist item verified**, most on the operator's device, the stubborn ones re-verified by driving the iOS Simulator directly (computer-use + throwaway Supabase test account via admin API, created and deleted same-session). Verified: manual path (円), grant path w/ GPS coords (聞 → "Calabasas" reverse-geocoded), typed-location path, all three assembly tiers (cloud 聞 / on_device 月 / template 行), save→button-hides, close-mid-flow→consent restart, stickier rebuild weaving the personal detail into the story + into `cocreation_context.layers`, and the **end-of-session trigger path** (敗, lapses artificially set to 3 on the gmail account — it's hooked now, so no re-fire risk; its hook lacks the "Yellow shirt" detail; delete its mnemonics row if the operator wants a rebuild).
2. **Nine walkthrough-driven fixes on `phase-5-cocreation-ui`** (pushed, `3a2a22e`+`80b521c`, still NOT merged — Plan-4 constraint holds): CoCreationSheet KeyboardAvoidingView; Save pinned in a safe-area footer; ScrollView `flexShrink:1` (RN defaults 0 → tall content shoved the footer off-screen); Speak-it button (expo-speech); **stickier UX redesign after 3 straight silent data losses** — return key rebuilds, dirty inputs flip the footer primary to "Rebuild it" with Save demoted to "Save without it"; `getPlaceName` now REQUESTS location permission (check-only meant the grant path could never fire); detail page surfaces the co-created hook over stale system rows + hides Regenerate; GO_BACK guard for deep-link entry; MnemonicNudgeSheet given the same KAV/inset/flexShrink treatment.
3. **Migration 0026 + IDS backfill applied to the LIVE DB** (operator-approved; safety dump `/tmp/phase5-safety/live-20260705-102639.sql`, 24h restore window now lapsed). `kanji.components` filled 2264/2294; spot-check 持→[扌,寺] ✅; ~30 empties are atomic kanji (円) with no IDS decomposition — correct. Browse in the dev client broke on the missing column, which is how this surfaced. **Destructive mnemonics cleanup + API deploy remain deferred to the coordinated cut.**
4. **KanjiBuddy rebrand + B143 cut from main for the first outside tester.** `expo.name` + permission strings + About/sign-in/share copy → KanjiBuddy (slug/scheme/bundleId untouched); enamel-pin splash (`docs/branding/KanjiBuddyEnamel.jpg`, bg `#26221f`) with **1.8s minimum hold** via expo-splash-screen (NEW native module — dev clients predating B143 degrade gracefully); pin-crop app icon; nudge-sheet + DeleteAccountModal keyboard fixes ported to main; `getBestVoice` Enhanced-TTS upgrade (hook Speak-it en-US, detail+study readings ja-JP). **B143 built + auto-submitted** (`c5b22fa`); Apple processing; operator emails are the landing signal.

### Debugging lesson that cost half the day
Three rounds of remote layout fixes "failed" because the **iPhone ran a stale Metro bundle** — airplane-mode testing severed the connection and shake-reload silently didn't fetch. Freshness markers now: Speak-it on the draft card; two side-by-side footer buttons in stickier. When on-device reports contradict the code, **drive the Simulator with computer-use before patching again**: `npx expo run:ios --port 8082` from the worktree, throwaway auth user via Supabase admin API (`POST /auth/v1/admin/users`, set `onboarding_completed_at`, delete after), deep-link via `xcrun simctl openurl booted "kanjilearn://kanji/<id>"`, paste text via `pbcopy`+cmd-V (typing triggers the macOS accent popover), toggle software keyboard with cmd-K.

### Operator actions owed (B143 / first tester)
- **App Store Connect** (app 6761603490): (1) App Information → rename to **KanjiBuddy** (TestFlight shows the ASC name); (2) TestFlight → External group → add `Brausenhauser@gmail.com`; (3) attach **build 143** when processed → first external build = short Beta App Review → invite email sends when it clears.
- **B141/B143 iPad volume verification still owed** (speak icons through a speaking leg) + B140 visual items (Progress ⚡, badge chevron/fade, radical relabels).
- **Rotate the Supabase DB password** (since 2026-06-03).

### Loose ends / next session
- **Daily push notifications broken since April** (BUGS.md "Daily push notifications not firing", EventBridge rule exists, Lambda invokes ok, nothing arrives since B103) — the one real blemish an outside tester will hit in week one. Deserves its own debugging session BEFORE the friend enables reminders.
- **EAS lesson (now in SOP): `autoIncrement: true` bumps buildNumber itself — hand-bumping 141→142 produced B143.** Never hand-bump; commit the auto-written app.json after each cut.
- Plan 4 scope grew from walkthrough feedback (all in ENHANCEMENTS.md + Open Brain): stickier-after-save ("Go deeper" must reopen stickier inputs), `attach_location_to_hooks` privacy switch + first-time Buddy in-flow ask, "Buddy voice" cloud TTS cached per hook, `speakMixed` ja/en segmentation, Velocity rework + goal calculator ("Nov 2034 is discouraging"), Study on the Go flashcard-only mode, geo-triggered hook recall. Kanji-count discrepancy (constant 2294 vs UI "2254 Jōyō" vs official 2136) folded into the Velocity entry.
- Merge decision for `phase-5-cocreation-ui` stays parked until Plan 4 (unshippable-API constraint). Simulator rig (test-account recipe above) makes future branch verification cheap.

---

# Session Handoff — 2026-07-04 (TTS volume bug ROOT-CAUSED + fixed for real; B140+B141 cut; Plan 3b UI code-complete; 7GB worktree cleanup)

## TL;DR (2026-07-04)

Four big things happened this session:

1. **The latched-low-TTS-volume bug is actually dead** (plagued every study session since April). The April fix (`f6eb823`) was a **native no-op**: expo-av's `Audio.setAudioModeAsync` only touches AVAudioSession when expo-av has active audio objects (`EXAV.m:286`) — and all TTS goes through expo-speech. Real fix: expo-speech-recognition's own `setCategoryIOS({category:'playback', mode:'default', categoryOptions:[]})` (mode MUST be explicit; native default is `.measurement`). Device-verified with session-state instrumentation: BEFORE `{playAndRecord, measurement}` → AFTER `{playback, default}`. Commits: `a6f5f85` (branch) / `4923bb3` (main). Full writeup in BUGS.md.
2. **B140 and B141 cut to TestFlight.** B140 (first New-Arch EAS build) took 5 attempts — see "B140/EAS lessons" below + docs/SOP.md. B140 bundles the flame→⚡ fix, badge scroll cue, radical relabel (and the *broken* volume fix). **B141 (volume fix, real one) was building at session end** — check `eas build:list`; verify on iPad when it lands: study through a speaking leg → speak icons stay full volume.
3. **Phase 5 Plan 3b UI (Tasks 6–8) is code-complete** on branch `phase-5-cocreation-ui` (pushed; 7 commits `14c6ff2..a6f5f85`). Subagent-driven, per-task + final whole-branch review, verdict "ready to merge". **Operator device walkthrough still owed** (checklist below). ⚠️ **Do NOT merge to main until you accept that main becomes unshippable-to-TestFlight** — the 3b UI calls Plan-2 API endpoints the production API doesn't have (deploy blocked until Plan 4 removes the mobile refresh callers; Phase 5 = one coordinated cut, see the 2026-06-03 section).
4. **~7GB of stale worktrees purged; unlanded gold rescued.** `kanji-learn-phase-0`/`-phase-1` dirs archived+removed (phase-1 was a linked WORKTREE, not a copy). Rescued to pushed branches: `stash/a11y-contrast-pass` (textSubtle WCAG-AA token across 30 screens) and `stash/kanjidic2-full-readings` (importer fix — earlier seeds truncated reading arrays to 5). Kept: `.worktrees/phase-5-on-device` (the Plan 3b launch pad, now on branch `phase-5-cocreation-ui`).

### B140/EAS lessons (also in docs/SOP.md — read before any build debugging)
- **`apps/mobile/ios/` is GITIGNORED** → EAS never sees local ios/ edits; it prebuilds on the builder. Only app.json / eas.json / env vars reach EAS.
- **RN 0.81.5 precompiled release XCFrameworks break New-Arch Release links** (`Undefined symbols: facebook::react::Sealable` — debug-guarded symbols referenced by ExpoModulesCore/RNSVG/RNGestureHandler). Fix (in eas.json production env, committed `c7e9ad9`): `RCT_USE_PREBUILT_RNCORE=0`, `RCT_USE_RN_DEP=0` (~+10 min/build). Local builds unaffected (debug prebuilt has the symbols).
- EAS log blobs are **brotli** — `eas build:view --json <id>` → logFiles URLs → `node zlib.brotliDecompressSync`.
- **Dev build & TestFlight share the bundle ID** — installing one replaces the other. TestFlight B139 had silently replaced the June dev client on the iPhone; rebuilt via `npx expo run:ios --device "iPhoneRAD" --port 8082` (device was still Xcode-paired, cable optional).

### Plan 3b UI — what landed (branch `phase-5-cocreation-ui`)
| Commit | What |
|---|---|
| `14c6ff2` | Task 6: `CoCreationSheet` — multi-step Modal (consent w/ teaching beat → location → anchor → assembly → commitment), mirrors MnemonicNudgeSheet pattern |
| `385d315` + `b2786e3` + `fc71ffc` | Task 7: post-session Buddy moment trigger in study.tsx — non-blocking, generation-guarded against stale sheets, gated to main-loop sessions (drills excluded) |
| `a85594f` | Task 8: manual "Build a hook" on kanji detail (no-hook check = `generationMethod === 'cocreated'`, same discriminator as the API's hasHook) |
| `699706d` | Final-review fixes: fresh sheet per open, "Checking where you are…" inferring state, tier label map, double-tap guards |
| `a6f5f85` | The real TTS volume fix (also cherry-picked to main as `4923bb3`) |

### Plan 3b device walkthrough (OWED — next session's first job)
Setup: local API from the worktree (`env -u ANTHROPIC_API_KEY pnpm --filter @kanji-learn/api dev`; device hits `http://192.168.4.59:3000` per `apps/mobile/.env.local`) + Metro `npx expo start --dev-client --port 8082` (8081 is often taken by abc-phonics). Dev client is on the iPhone 15 Pro (reinstalled 2026-07-04, replaces B139).
- **Manual path:** hookless kanji → detail → Build a hook → consent (teaching beat) → location grant AND deny paths → anchor → draft (cloud tier tag) → Make it stickier → Save → detail hides the button. Repeat one in airplane mode → "Template"/"On-device" tag. Close mid-flow + reopen → must restart at consent. DB check (RAD `7c707446…`): `mnemonics` row with `generation_method='cocreated'`.
- **Trigger path crib sheet (from the final review):** fires only for hookless + graded Again/Hard this session + `lapses ≥ 3`; suppressed entirely if any *hooked* kanji struggled the same session (reinforce outranks create and is a Plan-4 no-op — correct, not a bug). Drills never trigger. Expect NO "Looks like you're near X" line on the grant path (known plan-level reducer gap, deferred to Plan 4). At most one sheet per session.

### After the walkthrough
1. Merge `phase-5-cocreation-ui` (superpowers:finishing-a-development-branch) — accepting the main-unshippable constraint above, OR keep the branch until Plan 4 if an interim TestFlight cut might be needed.
2. **Plan 4** (not drafted): `mnemonic_recall` quiz + reinforce/deepen + surfacing + REMOVE the mobile refresh callers (unblocks the API deploy) + the location_inference reducer cleanup + "Not now" 7-day cooldown. Then the **coordinated cut**: API deploy + migration 0026 + IDS backfill + mnemonics cleanup (runbook `docs/superpowers/runbooks/2026-06-01-phase5-data-cleanup.md`) + EAS build, together.

### Loose ends
- **Rotate the Supabase DB password** (outstanding since 2026-06-03 — user-side action).
- B141 verification on iPad (volume through speaking legs) once Apple processes it.
- B140 walkthrough items still unverified: Progress ⚡ (not 🔥), badge scroll chevron/fade, radical relabels in Browse/KanjiCard.
- `stash/a11y-contrast-pass` + `stash/kanjidic2-full-readings` — review/land when convenient.
- Unmerged single-fix branches from May triage (kept, zero cost): `claude/heuristic-cohen` (writing-queue endpoint removal — endpoint still exists on main; decide), `practice-loop-plan-c` (unused useEffect import in progress.tsx — still unused), `claude/magical-snyder` (romaji-leak seed guard), `claude/cranky-chebyshev` (FK back-port), `claude/lucid-nightingale` (Watch-era, likely obsolete — Watch is being rethought as a MOTIVATOR, not tiny flashcards, per operator 2026-07-04).
- BUGS.md B-207 scroll affordance shipped B139/B140 but its entry may also be stale — check during the B140 walkthrough.

---

# Session Handoff — 2026-06-03 (Phase 5: Plan 2 + Plan 3a + Plan 3b-logic all MERGED to `main`; on-device Apple Foundation Models VERIFIED; 3b UI + Plan 4 remain)

## TL;DR (2026-06-03 — three Phase-5 plans landed; on-device tier proven on-device)

**Phase 5 status: Plans 1, 2, 3a, and 3b-logic-core are all merged to `main` (local, NOT pushed — `main` is ahead of origin by ~28). Nothing deployed; live DB rollout deferred.** Remaining: **Plan 3b UI (Tasks 6–8)** + **Plan 4** (quiz/reinforce/deepen/surfacing).

| Plan | What | State |
|---|---|---|
| 1 Foundation | shared pure logic + dictionary | ✅ merged (`d78ad1f`, prior session) |
| 2 Data & API | `cocreation_context $type`, `kanji.components` + **IDS** backfill, `/assemble` (injectable cloud tier), `/cocreated`, `/outcome`, `/deepen`, retire refresh+seed, clone-rehearsed cleanup | ✅ merged (`0498953`) |
| 3a On-device | New Arch ON, `@react-native-ai/apple`, `assembleOnDevice` seam | ✅ merged (`97321b8`) — **verified on-device (15 Pro / iOS 26.5)** |
| 3b logic core | expose `kanji.components`, `buddy-moment-context` endpoint, `assembleStory` cascade, `buildSlots`/`buildContext`, `useCoCreation` state machine | ✅ merged (`<this session>`) — api 288 + mobile 58 green |
| 3b UI (Tasks 6–8) | `CoCreationSheet`, post-session trigger wiring in `study.tsx`, manual "Build a hook" in `kanji/[id].tsx` | 🚧 **NEXT** — RN screens, device-verified (no unit tests) |
| 4 | quiz `mnemonic_recall` + reinforce/deepen + surfacing + remove old refresh mobile callers | ⬜ not drafted |

**Plans + findings:** `docs/superpowers/plans/2026-06-01-phase-5-data-api.md` (Plan 2), `…/2026-06-03-phase-5-on-device-foundation-models.md` (3a), `…/2026-06-03-phase-5-mobile-cocreation-flow.md` (3b — Tasks 6–8 are the next-session blueprint), `docs/superpowers/findings/2026-06-03-on-device-foundation-models.md`.

### Key decisions/corrections this session
- **Data source = IDS (cjkvi-ids), NOT KRADFILE.** KRADFILE gave wrong granularity (持→寸土扎); IDS first-level gives 持→[扌,寺] matching the Plan 1 radical dictionary. Backfill: `packages/db/src/seeds/backfill-components.ts` (`parseIds`).
- **On-device library API:** `@react-native-ai/apple@0.12.0` uses the **direct `AppleFoundationModels` TurboModule** (`isAvailable()` + `generateText(messages,options)→Array<{type:'text',text}>`), NOT the blog's `foundationModels.generateText`. Did NOT adopt the Vercel AI SDK (`expo install ai`→ai@6 vs lib's documented v5). On-device 持 assembly verified offline (airplane mode).
- **New Architecture is ON** (`apps/mobile/app.json`) — **affects ALL builds incl. production**. **Watch config plugins REMOVED** (the watchOS app is being deprecated/reconceptualized — operator 2026-06-03; manual Watch signing conflicted with local auto-signing). `apps/mobile/ios/` is tracked (not gitignored) — prebuild churn / leftover Watch-source deletions are a separate cleanup.

### 🛑 Carry-forward constraints
- **DEPLOY ORDERING:** Plan 2 removed `GET /v1/mnemonics/refresh` + `POST /:id/refresh/dismiss`, which the SHIPPED mobile app still calls (`useMnemonics.dismissRefresh` has no try/catch → unhandled 404). **Do NOT deploy this API before Plan 4 removes the mobile refresh callers.** Phase 5 = one coordinated cut (API + EAS together). See `docs/superpowers/runbooks/2026-06-01-phase5-data-cleanup.md`.
- **Live DB rollout deferred** to the coordinated cut: migration `0026_kanji_components.sql` + IDS backfill + destructive `mnemonics` cleanup — clone-rehearsed only. Runbook has the order + the `--yes` guard on `scripts/cleanup-old-mnemonics.mjs`.

### How to resume (next session = Plan 3b UI)
- **Worktree KEPT** at `.worktrees/phase-5-on-device` (New Arch build, `@react-native-ai/apple` installed, env files copied, on-device-verified). In it: `git checkout -b phase-5-cocreation-ui main` to start the UI branch off updated main.
- **Local API:** start from the worktree with `env -u ANTHROPIC_API_KEY pnpm --filter @kanji-learn/api dev` (the dev shell exports an empty `ANTHROPIC_API_KEY` that overrides `.env`). Device build hits `http://192.168.4.59:3000` (`apps/mobile/.env.local`). Worktree needs the gitignored `apps/api/.env`, `.env.test`, `apps/mobile/.env.local` copied in.
- **Plan 3b Tasks 6–8** are fully specified in the 3b plan doc: `CoCreationSheet` (mirror `MnemonicNudgeSheet` Modal pattern; renders by `useCoCreation` stage; teaching beat via `lookupComponents(kanji.components)`), wire the trigger in `study.tsx handleFinish` (`fetchBuddyMomentContext` → `pickBuddyMomentAction` → render sheet on `create`; reinforce no-op'd until Plan 4), manual "Build a hook" in `kanji/[id].tsx`. Then a device rebuild + on-device walkthrough (consent → location grant/deny → anchor → draft cloud + airplane-mode template → save → confirm `generation_method='cocreated'` on RAD).
- **Device deep-link** to a route: `kanjilearn://<route>` tapped from iOS Notes. **Native module change ⇒ full rebuild** (`expo prebuild --clean && expo run:ios --device`); JS-only change ⇒ Metro reload.

### Loose ends
- **Rotate the Supabase DB password** — it was inadvertently printed in plaintext to a transcript this session (regex missed the `postgresql://` scheme). User-side action.
- **Push to origin** when ready (local `main` ahead ~28; operator's usual rhythm is local).
- B140 build still held (queued `a6434ff` Progress flame→⚡ + badge scroll cue + radical-name relabel) — when cut, ideally bundle the first walkable Phase-5 UI.

---

# Session Handoff — 2026-05-31 (Phase 5 Contextual Mnemonic Co-Creation: brainstormed → spec'd → Plan 1/4 foundation MERGED to main; B140 held)

## TL;DR (2026-05-31 — Phase 5 designed end-to-end; foundation shipped to `main`)

**Phase 5 (Contextual Mnemonic Co-Creation — the signature feature) brainstormed, spec'd, and Plan 1 of 4 implemented + merged.**
- **Spec:** [`docs/superpowers/specs/2026-05-31-phase-5-mnemonic-cocreation-design.md`](superpowers/specs/2026-05-31-phase-5-mnemonic-cocreation-design.md) (16 sections, committed).
- **Plan 1 (Foundation):** [`docs/superpowers/plans/2026-05-31-phase-5-foundation.md`](superpowers/plans/2026-05-31-phase-5-foundation.md) — 7 TDD tasks executed **subagent-driven** (per-task spec + code-quality review), **merged to `main` as merge commit `d78ad1f`**. Adds pure logic in `packages/shared/src/mnemonics/`: types, cadence (EMA effectiveness + deepen gate), trigger (hybrid single-worst), distractors, radical-dictionary (20-entry seed + coverage gate), template assembler. **82 shared tests green; shared + mobile typecheck 0 errors** (verified on the merged result).

**Key locked decisions** (full rationale in the spec):
- Entry: end-of-session **"Buddy moment"**, ONE action/session (reinforce > create); manual "Build a hook"/"Go deeper" from kanji detail.
- Trigger: hybrid — single worst kanji that slipped today **AND** has ≥3 lifetime lapses.
- Assembly cascade: **cloud (Anthropic) → on-device (Apple Foundation Models) → template**. **CLOUD-FIRST during the testing phase** (operator absorbs cost); **BYOK-gated before launch** (see pre-launch checklist below). BYOK UI = pre-launch slice, not v1.
- Reinforce: full loop, end-of-session, recall mnemonic→kanji, 👍/👎; **deepen (additive layers), never discard**.
- New **story→kanji `mnemonic_recall` quiz** first-tests a fresh hook (immediate quick-check + early item next session).
- Old mnemonic system superseded; all pre-Phase-5 `mnemonics` rows discarded behind a safety dump (in Plan 2).

**Only device-visible change from this session = the radical-name relabel.** Mobile `RADICAL_NAMES` now derives from the shared dictionary (shared wins → precise 部首名: **人 'hito' / 水 'mizu' standalone vs 亻 'ninben' / 氵 'sanzui' variants**) — an operator-approved correctness change visible in Browse / KanjiCard / kanji-detail. The co-creation feature itself has **NO UI yet** (foundation is not wired up; that's Plans 3–4).

**🛑 B140: HELD on purpose — do NOT cut a build for this session's work alone.** Nothing co-creation-related is on-device-testable yet (foundation is dead code until Plans 3–4), B139 still owes its on-device walkthrough, and EAS just cleared a 5h outage. When B140 *is* eventually cut it should bundle: the queued `a6434ff` fixes (Progress flame→⚡, badge scroll cue) **+** the radical-name relabel (re-verify radical labels in Browse/KanjiCard) **+** ideally **Plan 3's first co-creation UI** so the cut delivers something walkable. Per the bundling rule, flag the ~$2 cost before cutting.

**Plans 2–4 outstanding** (each needs its own file-level exploration before its plan is written): **2** Data & API (`cocreation_context` jsonb extension; adapt `generateHaiku`/`generateSonnet` into the cloud-assembly endpoint; retire the 30-day refresh nudge; clone-rehearsed cleanup of old mnemonics) · **3** Mobile co-creation flow (`CoCreationSession` state machine + Apple Foundation Models native module — verify a community Expo wrapper exists first) · **4** Quiz + reinforce/deepen + surfacing. Status mirrored in memory `project-phase5-status`.

---

# Session Handoff — 2026-05-31 (B139 shipped to TestFlight; B139 feedback fixes queued for B140)

## B139 on-device feedback (2026-05-31) → fixes queued for B140

Operator walked B139 on the Buddy/gmail account. Results:
- ✅ **#3 milestones cache-paint (B-206)** — confirmed: "much faster, badges appeared instantly."
- ⚠️ **#4 streak flame still on Progress page** — the flame→⚡ swap (`18086b6`) only fixed the *Dashboard* streak badge; a SECOND "Day streak" HeroStat on the Progress page still used `icon="flame"` (and Progress is where the operator looked). **Fixed** `a6434ff`: Progress HeroStat → `flash`. Grep confirms zero streak-flames remain anywhere; fire is now exclusive to "burned"/mastery.
- ⚠️ **#6 badge scroll-fade too subtle** — the first-pass fade dissolved toward the card surface (`colors.bgCard`), so it barely registered ("I was looking for it and barely noticed"). **Reworked** `a6434ff`: `ScrollFadeRow` now fades toward the darker app bg (`colors.bg`) at higher opacity + wider 44px edge, PLUS a high-contrast tappable chevron pill on each overflow edge (pages ~80% viewport). Pure `computeFadeEdges` logic unchanged (7 jest tests still pass); only visual rendering changed.

**🚀 Queued for B140 (committed `a6434ff`, NOT yet built):** Progress streak flame→⚡, and the stronger badge scroll cue (chevron + fade). Mobile-only. Per operator: commit-now, bundle into the next EAS cut (alongside whatever Phase 5 / other work lands) — no immediate build to avoid a near-back-to-back cut after B139. When cut, re-verify #4 and #6 on-device.

---

## TL;DR (2026-05-31 — B138 on-device walkthrough + B139 cut)

**B138 walkthrough complete on the Buddy/gmail account (`b8503589…`), zero open defects.** All items passed: milestones first-launch/date-sheet/grandfathered (A1–A3), session-minutes now full multi-leg time (B5, the API cap fix verified on-device), Meet Buddy dismiss-persist (6), no Buddy card on Progress (8), integer interval (10), burned count (11). Items 7/9 (streak card + push) verified **as-designed**: the operator is on a 10-day streak, and 10 is on the *milestones badge* ladder `[3,7,10,14,21,…]` but NOT the *Buddy streak-card/push* ladder `[3,7,14,30,60,90,100,180,365]` — so no card/push at 10 is correct. `notifications_enabled=true` confirmed in DB, so the 14-day milestone will fire.

**A4 (grandfather-location) verified clean in DB.** Buddy/gmail has 18 milestones; 3 carry a `location` field but all 3 are *genuinely-earned recent* crossings (streak 05-28, kanji_seen 05-30, streak 05-31) and the account has `attach_location_to_milestones=true` (opted in). Grandfathered entries with location = **0 of 14** — Bug B's fix ([learner-state.service.ts:181](../apps/api/src/services/buddy/learner-state.service.ts), `!isGrandfather && opts?.location`) holds exactly as designed.

**New finding fixed during the walkthrough — flame/streak icon collision.** The Dashboard day-streak badge used `Ionicons "flame"` + "Streak 🔥", colliding with "burned" (the app's mastery term, which owns fire everywhere). Switched streak to lightning `flash` + "Streak ⚡" (commit `18086b6`), matching notification.service.ts which already used ⚡ for streaks.

**B139 shipped to TestFlight.** Build `f32b3545-2dc0-4766-a657-cdfbbd94a695` (commit `f65d3e4`, buildNumber 139) finished after a ~5h Expo EAS outage (incident yw940lp7lm1z, macOS data-center networking — blocked the queue ~13:38→~18:37 PDT, recovered, build cleared the backlog). Submitted to TestFlight: submission `798cab66-cff3-4385-ac24-395faba3f5fa`, uploaded to App Store Connect, **Apple processing** (~5–10 min). `app.json ios.buildNumber` recorded 138 → 139 (commit `d584114`). Bundles SIX mobile fixes:
| Fix | Commit |
|---|---|
| Vocab kana TTS (然り → しかり, not "zenri") | `b170653` |
| Softened silver tier rule (shared-pkg sync to match live API) | `7fe82c2` |
| Milestones cache-paint — no blank-on-entry (B-206) | `6487f38` |
| Streak icon flame → lightning | `18086b6` |
| Focus-aware badge ordering (B-207) | `621af1c` + re-export fix `f65d3e4` |
| Badge-row scroll-fade affordance (spawned task) | `844d6a0` |

(The API session-minutes cap fix `bf0f300` is already live server-side, not part of this cut.)

**B139 verification owed (next session).** Once Apple finishes processing and B139 lands in TestFlight, walk the six bundled fixes on-device (Buddy/gmail): vocab speaker now says しかり not "zenri"; milestones panel paints instantly (no 10–15s blank); streak badge shows ⚡ not 🔥; JLPT badge leads the row for a JLPT-focused account (and scroll-fade hints more badges); silver rule matches the API. Then the next slice is the **Phase 5 brainstorm — Contextual Mnemonic Co-Creation** (the operator is starting that in a parallel session; see [`2026-05-23-buddy-v2-phase-1-refresh.md`](superpowers/specs/2026-05-23-buddy-v2-phase-1-refresh.md) §4/§9).

**Process lesson (cost a wasted build).** A `constants/milestones.ts` Edit silently failed ("File has not been read yet"), so the B-207 re-export barrel never gained `milestoneFocusFromReasons` — a TS2305 regression that would crash the Progress tab at runtime. It was committed (`621af1c`) and an EAS build (`1ef1fe08`) was kicked off **without running `pnpm --filter @kanji-learn/mobile typecheck` first**. Caught via `eas build:list` (build was on the broken commit), **canceled on EAS** (`eas build:cancel` — note: stopping the local CLI poller does NOT cancel the server-side build), barrel fixed, typecheck confirmed 0 errors as a gate, re-cut on `f65d3e4`. **Rules now: (1) always run the mobile typecheck to 0 errors BEFORE any EAS build; (2) verify each Edit actually applied — watch for "File has not been read yet".** Separately, the Bash tool dropped stdout intermittently all session (commands executed fine; output capture was the problem) — when flaky, run git/eas strictly sequentially, never batched in parallel.

---

# Session Handoff — 2026-05-30 (Two B138 testing bugs fixed: vocab TTS reading + session-minutes cap; API deployed, mobile fix pending next cut)

## TL;DR (this session, 2026-05-30 — two B138 walkthrough bugs)

Two bugs reported from B138 testing, both root-caused (subagent fan-out + verified against code) and fixed:

**Bug 1 — vocab voice reading wrong (mobile).** Tapping the speaker icon on a vocab word (e.g. 然り) fed the **kanji surface form** `v.word` to iOS TTS, which guessed the on-reading and said "zenri" instead of しかり. The correct kana reading `v.reading` sits on the same object (used for display) but wasn't used for audio — the kun/on speaker buttons already correctly speak kana. Fixed both call sites to speak `v.reading`: [`KanjiCard.tsx:358`](../apps/mobile/src/components/study/KanjiCard.tsx) (study flashcard) + [`kanji/[id].tsx:430`](../apps/mobile/app/kanji/[id].tsx) (Browse detail). Commit `b170653`. **Mobile-only — NOT yet in TestFlight; bundle into the next EAS cut** alongside the pending softened-silver-rule shared change.

**Bug 2 — session minutes undercounted (API).** The Session Complete "Time" stat only reflected ~flashcard time, excluding writing/speaking/quiz legs. Root cause was NOT the client clock (which correctly spans all legs via a single `studyStartMs` → session-end wall-clock). It was a server-side anti-cheat cap in [`srs.service.ts:341`](../apps/api/src/services/srs.service.ts) that clamped `studyTimeMs` to `30s × results.length`, where `results` counts flashcard grades only. In the Practice Loop one flashcard grade fans out to writing/speaking/quiz legs that add real minutes but no extra `results` entries, so legitimate multi-leg sessions were crushed down to roughly flashcard-only time. The capped server value overrides the (correct) client value on Session Complete. Fix: dropped the per-item cap; kept the 60-minute hard ceiling as the runaway-clock guard (daily minutes budget already bounds normal sessions). Commit `bf0f300` + regression tests `9014aed` (2 cases in phase0-smoke: 3-min single-flashcard loop not clamped; 60-min ceiling still fires).

**Rollout this slice:**
- ✅ Both fixes committed to `main` and pushed (`b170653`, `bf0f300`, `9014aed`).
- ✅ API deployed: op `f62eb461828c40129d34611e2a2e6fdc` SUCCEEDED 2026-05-31T00:33:51Z; image `sha256:71fb7e496ba0b4000ff5f12171b39ad964345f30c5a31e7f1afcca369428bf23`. Smoke: `/health` 200, `/v1/buddy/nudges` 401. Full suite 281/281 green.
- 🚀 **Mobile (Bug 1) NOT yet in TestFlight** — bundle into the next EAS cut with the softened-silver-rule shared change. Until then, vocab TTS still says "zenri" on-device.

## More B138 milestone findings (same session run, 2026-05-30/31)

After the two fixes above, the operator continued the B138 milestone walkthrough. Findings (all logged in BUGS.md):

- **JLPT badge "missing" → not a bug.** The N5 silver badge renders fine; it was just off-screen to the right in the horizontally-scrolling badges row. Surfaced a real **discoverability** issue (B-207): no scroll affordance, so users miss earned JLPT/grade badges. Filed as a spawn task; queue for next EAS cut.
- **B-206 — milestones panel blank ~10–15s on entering Progress, then fills.** Root cause: `MilestonesSection` gates render on `if (isLoading || !summary)`, defeating the `useAnalytics` cache-paint (which is designed to show cached badges immediately). Fix identified (`if (!summary) return null`), **not yet applied** — mobile-only, queue for next EAS cut. The underlying slowness (B-208) is the cross-region Supabase (`ap-southeast-2`) analytics query (~12 parallel aggregates); real fix is the us-east-1 migration.

**Queued for next mobile EAS cut (consolidated):**
1. Vocab kana TTS — `b170653` (committed).
2. Softened silver tier rule — shared-package sync so mobile matches the API.
3. B-206 milestones cache-paint — `if (!summary) return null` (not yet applied).
4. B-207 badge-row scroll affordance (not yet applied; spawn task filed).

## Docs + housekeeping (same session run)

- ✅ **Doc refresh** — commit `5988e26`. `docs/tech-arch-overview.md` gained a **Scheduling engine (FSRS-5)** section and a **Milestones** section (the doc still described SM-2; it's FSRS since Spec 1.5). `ROADMAP.md` got a "Recently shipped (2026-05)" block + marked #13/#16/#16b done. `BUGS.md` got B-202/B-205/B-206/B-207/B-208/B-209 entries.
- ✅ **House-cleaning** — commit `c66f0ae`. Cleared the long-standing working-tree queue: branding art → `docs/branding/`; gitignored `apps/mobile/credentials.json` (EAS secrets), Lambda `*.zip`, Xcode `xcshareddata/`, `.claude/scheduled_tasks.lock`, and the stray `KanjiBuddyMonkey.html`/`_files` saved webpage; deleted orphan root `app.json`/`eas.json` + stray `tooclose.jpg`; committed the 7 historical `2026-04-*` plan docs, the pitch-contrast mockup, b134 checklist, and Open Brain notes. **Working tree is now clean.**

**Session commit chain (oldest→newest):** `b170653` (vocab TTS) → `bf0f300` (study-time cap) → `9014aed` (cap tests) → `3f231a0` (handoff: B138 fixes) → `5988e26` (docs refresh) → `c66f0ae` (house-cleaning). All pushed; `main` in sync with `origin/main`.

**Process note (env):** the Bash tool dropped output intermittently across this session — caused repeated probe commands and a couple of cancelled parallel batches (recovered each time). When it's flaky, run git/deploy steps strictly sequentially.

**Process notes (for next time):** (1) A research subagent hallucinated a non-existent `srs.service.test.ts` with a `makeDb()` mock; the first "tests pass" was the pre-existing suite — the regression test never ran. Caught by checking the vitest `include` (`test/**/*.test.ts`) and `git status`; re-added the 2 cases to the real integration file `phase0-smoke.test.ts`. (2) `submitReview` requires `responseTimeMs` on each result (NOT NULL in `review_logs`) — the first test draft omitted it and tripped a 23502. (3) A force-push to amend an already-pushed commit was (correctly) auto-denied — landed the test fix as a forward commit instead. (4) Batching sequential git/deploy commands in one parallel block caused a cascade of cancellations when the first failed — run git/deploy strictly sequentially.

---

# Session Handoff — 2026-05-26 (Softened silver rule shipped (API); B138 hot-fix in TestFlight; T15 + B138 walkthroughs + mobile rule sync pending)

## TL;DR (this session, 2026-05-26 — fourth slice: softened silver tier rule)

**Silver tier rule softened to allow long-tail reviewing stragglers.** Walkthrough finding: Buddy's 78/79 N5 mastery (98.7%) earned ZERO JLPT recognition because one card (語, next-review 11 days out) was still in `reviewing` status. The strict `learning === 0 && reviewing === 0` silver rule treats a single straggler as a hard block. Softened to `learning === 0 && reviewing <= max(1, floor(total * 0.02)) && (remembered + burned) > 0` in [`packages/shared/src/milestones/tier-rules.ts`](../packages/shared/src/milestones/tier-rules.ts) (commit `7fe82c2`). Learning gate stays strict (cards being introduced don't count toward "done"). Bronze/gold unaffected.

**Impact under live data (probed before patching):** exactly ONE new silver fires — **Buddy N5**. No existing silvers regress, no other account gains anything spurious. Probed via SQL over all 4 users + N1-N5 + G1-G9.

**Rollout this slice:**
- ✅ API deployed: op `c677b8b5ec6b4e3a98b89080c8a9775c` SUCCEEDED at ~2026-05-25 19:44 PT; image `sha256:c89367c6bed524e0c49e066672e748640bcb0d4e1984d2cf29dc00068c353ab6`. Smoke 200.
- ✅ Buddy's N5 silver written directly via `tsx LearnerStateService.refreshState` (using the local patched code against `packages/db/.env` DATABASE_URL) — milestone count 14 → 15. Entry: `{type: jlpt_level, payload: {tier: silver, level: N5}, achievedAt: "2026-05-26T02:40:12.769Z"}`. Real timestamp (not grandfathered, since existing.length > 0). NO location field (Bug B fix held — opts.location wasn't supplied to this manual refresh).
- 🚀 **Mobile (shared package) NOT yet rebuilt and shipped.** Per the bundling choice, deferred to the next mobile cut. Caveat: mobile's `computeUpNext` uses the old rule semantics from the cached shared bundle in B138 — Buddy may briefly see N5 silver in BOTH the badges row AND the "Up Next" list until B139 (or whenever the next EAS cut bundles the shared change). Cosmetic mismatch only; no data integrity issue.

**Diagnostic pattern reinforced:** before changing a rule, run a SQL impact probe across ALL users to see who gains/loses — this caught that softening would only affect Buddy N5 (zero other deltas), validating the change as low-risk and well-targeted before patching.

---

## Earlier session — 2026-05-26 (B138 hot-fix in TestFlight — grandfather-location + stale-cache bugs)

### TL;DR (2026-05-26 — third session, hot-fix B138 after walkthrough findings)

**B138 hot-fix shipped to TestFlight.** During the B137 walkthrough on the RAD account (me.com, `7c707446…`), badges didn't appear despite the DB having 3 grandfathered milestones. Diagnosis caught two real bugs in the milestones rollout, both patched and shipped as B138:

- **Bug A — stale analytics cache (mobile).** `useAnalytics` cache key `'kl:analytics_cache'` wasn't versioned. B137 added `recentMilestones` + `perGradeBuckets` to the response shape; existing users upgrading from B135/B136 get the OLD shape from local cache on first paint. The hook fetches fresh in background and overwrites — but if the fresh fetch transiently fails (network blip, expired token), the catch block leaves stale cache in place and MilestonesSection renders the "first milestone awaits" placeholder. RAD hit this; pull-to-refresh didn't unstick (silent fetch failure); force-quit + reopen did. Fix: bump key to `'kl:analytics_cache_v2'` in [`apps/mobile/src/hooks/useAnalytics.ts`](../apps/mobile/src/hooks/useAnalytics.ts). Auto-invalidates every stale cached blob on first run of B138.
- **Bug B — grandfather location attachment (API).** [`LearnerStateService.refreshState`](../apps/api/src/services/buddy/learner-state.service.ts) was attaching the current device location to ALL newly-detected milestones, including those from the grandfather pass. Grandfather entries are historical; today's coordinates are geographically meaningless on them and may leak the user's location without the intent the opt-in toggle implies ("where I earned this *now*"). Fix: gate the location attachment by `!isGrandfather` at line 175-180.

**Rollout this session (clean, no surprises):** API redeploy op `6d5fb02183884733894b60508557f22d` SUCCEEDED at ~2026-05-25 18:01 PT (image `sha256:7c6a7b495e6d041a457b2c68273e7675440987daa83a63d1f310b327c327a7aa`, no env-var change so single-deploy worked this time). B138 EAS build `5fc58b14-6fed-4f74-bc27-54dd94617c56` (buildNumber 137 → 138), submitted to TestFlight as submission `af845507-d016-44b2-8e80-eb9e001c915c`. Apple processing.

**Data cleanup applied to RAD:** the 3 grandfather entries already in RAD's `learner_state_cache.recent_milestones` were polluted with location data from the bug. One-row UPDATE stripped the `location` field from any entry where `achievedAt = 'grandfathered'`. Verified post-update: entries now contain only `type`/`threshold`/`achievedAt`.

**Buddy/gmail account still has zero milestones** in DB (its last refresh was 2026-05-25 16:20Z, PRE the milestones deploy at 23:40Z). To populate: submit one review on that account; the post-review `setImmediate` triggers `LearnerStateService.refreshState` which runs the new MilestoneDetector code and writes the grandfather entries — now without spurious location data thanks to Bug B's fix.

**Diagnostic pattern worth remembering:** when mobile renders the empty state but DB has data, the bug is almost always either (a) the API response is missing the field, or (b) the local cache is masking it. To distinguish without a JWT: use `apps/api/node_modules/.bin/tsx` to run the service code directly against `packages/db/.env`'s DATABASE_URL — proves whether the API would return the expected shape. Used here to definitively rule out the API as the cause, pointing to mobile cache.

---

## Earlier session — 2026-05-25 (Milestones panel rework shipped end-to-end + B137 in TestFlight; T15 + B137 walkthroughs pending)

### TL;DR (2026-05-25 — second session of the day)

**Milestones panel rework is fully landed on `main`, on the live DB, and in the deployed API.** The 24-task `milestones-rework` branch (28 commits, +1807/-139 across 40 files) merged into `main` via `--no-ff` merge commit `52ff639`, drizzle migrations `0012_kanji_grade_idx.sql` and `0013_user_profile_attach_location.sql` applied via `psql -f` against live Supabase, API redeployed twice (op `4f7b21c40b1541898d9960ffb434b755` SUCCEEDED with the new image; op `2f536eedd4ce4f459e7fc8eb77236dd0` SUCCEEDED with `MILESTONES_DEPLOY_CUTOFF_ISO=2026-05-25T23:50:00Z` added to the runtime env vars). Smoke: `/health` 200, `/v1/buddy/nudges` 401. Pre-migration safety dump at `/tmp/buddy-milestones-safety/live-20260525-2329.sql` (5.8M; delete after 24h stability).

**Mobile B137 cut and submitted to TestFlight** — build `aa732953-22e3-49d5-bceb-7e681f04dbe8`, submission `44850bda-5e24-42d2-a7c8-6e1557f35415`, Apple processing 5–10 min from submit. Bundled four items: (a) MilestonesSection UI (badges + UpNext + date sheet, wired into Progress tab), (b) Profile "Attach location to milestones" toggle (opt-in, default OFF), (c) BuddyCard placement refinement (moved up under Drill Weak Spots, now mounts outside the `summary?` conditional so it renders independently of the dashboard summary fetch), (d) Velocity-card copy patch ("Start burning kanji to see a projection" → "Projection coming soon"). EAS auto-bumped `app.json ios.buildNumber` 136 → 137. Real Velocity-projection rework is parked as a real priority — see [[velocity-projections-priority]] in memory; operator framed projections as a major motivator, not nice-to-have.

**Two-deploy rollout footgun, document for next time:** [`scripts/deploy-api.sh:24`](../scripts/deploy-api.sh:24) uses `APPRUNNER_SERVICE_ARN="${APPRUNNER_SERVICE_ARN:-…}"` (colon-dash). An empty-string override does NOT skip `start-deployment` — bash treats empty as "use the default". Result this session: the build/push step also triggered a deploy of the new image with OLD env vars (no `MILESTONES_DEPLOY_CUTOFF_ISO`), requiring a corrective second deploy via `update-service`. Future fix options: (i) edit the script to `${VAR-…}` (no colon), OR (ii) when bundling env-var changes with a deploy, run `aws apprunner update-service` BEFORE `deploy-api.sh` so the old image accepts the new env var first.

**Practical impact of the gap:** effectively zero. The default `MILESTONES_DEPLOY_CUTOFF_ISO` fallback (`2026-05-25T00:00:00Z`, hardcoded in [`apps/api/src/services/milestones/detector.ts:103-104`](../apps/api/src/services/milestones/detector.ts:103)) still grandfathers all 4 existing users because their `user_kanji_progress.createdAt` rows predate today. Only a user whose first-ever SRS activity landed strictly after UTC midnight today would have been mis-grandfathered, and the corrected cutoff (`23:50:00Z`) was set ~9 min after the second deploy completed (`23:40:59Z`), so any real activity is covered.

**Side observation — Supabase PG log noise:** a `relation "supabase_migrations.schema_migrations" does not exist` notice fired at ~23:31 UTC. Confirmed harmless. That schema isn't created in this project — you apply migrations via raw `psql -f`, not via Supabase CLI — so any client that queries it (pg_dump introspection, Supabase Studio Migrations panel) logs this. No action taken; leaving as log noise. To silence: `CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);` — but creating an empty table risks confusing the Supabase CLI if you ever adopt it later.

**Closeout doc for milestones still owed.** No `docs/superpowers/findings/2026-05-25-milestones-panel-rework.md` was written; the 24-task plan's checkboxes were also never ticked. Worth backfilling for HANDOFF continuity (one short findings doc summarizing what shipped + the deploy footgun above).

---

## Earlier session — 2026-05-25 (Phase 1' shipped — B136 in TestFlight; T15 on-device walkthrough still pending)

**Phase 1' is shipped, end-to-end.** Migration 0025 applied to live; API deployed twice (first rollback on a runtime import bug, second SUCCEEDED at op `c955bd8cb5f64cbab032e24df83c4c00`); B136 EAS build cut and submitted to TestFlight (build `f5b04f00-1799-41f7-aafe-6b99f39bf104`; submission `f58e6982-156d-4635-9d04-52679a6b1114`). What's left is T15 — the on-device walkthrough on B136 and the closeout findings doc. Once that's done the next slice per the refresh doc §9 ordering is Phase 5 (Contextual Mnemonic Co-Creation — the signature feature).

**Phase 1' executed via `superpowers:subagent-driven-development`** — fresh subagent per task, two-stage spec + quality review after each, then a final integration review across the whole diff. The pattern caught two production bugs that per-task reviews would have shipped silently:

1. **jsonb double-encoding (storage-layer)** — drizzle's `PgJsonb.mapToDriverValue` calls `JSON.stringify(value)`, then postgres-js's jsonb serializer calls `JSON.stringify` on what it received. Result: `actionPayload: { kind: 'meet_buddy' }` was stored as `"{\"kind\":\"meet_buddy\"}"` (a JSON-encoded string). SQL-side `->>` returns NULL on a string, so the partial unique indexes from migration 0025 never enforced. Round-trips via JS appeared to work (mapFromDriverValue JSON.parses), masking the bug. Fixed globally with a one-line `PgJsonb.prototype.mapToDriverValue = v => v` override in [`packages/db/src/client.ts`](packages/db/src/client.ts) (commit `f1d111b`). Side-benefit: closes the long-standing `interventions.payload` double-encoded note from prior HANDOFFs for new writes.

2. **GET envelope mismatch (caught by final review only)** — `/v1/buddy/nudges` initially returned `{ data: nudges }`; the mobile ApiClient throws on `!json.ok`. Every BuddyCard would have been invisible in production. Fixed to `{ ok: true, data: nudges }` with a regression-catching test assertion (commit `b0a37d4`).

**Other notable in-flight discoveries:**
- Drizzle's `.onConflictDoNothing({ target })` only accepts PgColumn refs — can't target migration 0025's partial unique indexes whose targets are SQL expressions (`action_payload->>'milestone'`). Fix: typed `isUniqueViolation(err)` helper using `instanceof PostgresError && code === '23505'`. Re-routed `PostgresError` through `@kanji-learn/db` because `apps/api/node_modules` doesn't contain `postgres` at runtime even though it's a declared dep (this was the cause of the first deploy's rollback).
- `BuddyNotifier` port interface extracted to drop 7 `as any` casts from the test files.
- T8 introduced a stealth typecheck regression — `useFocusEffect` was imported from `@react-navigation/native` (not a project dep). The project uses `expo-router`. Caught in T9's typecheck run, fixed in commit `9134db9`.

**Final pre-ship review** (Opus, full Phase 1' diff): "Ship with one Critical fix" — addressed before deploy.

**B137 refinement queued and Velocity-card bug filed.** Operator feedback during the B136 walkthrough flagged a placement adjustment (BuddyCard up under Drill Weak Spots) — captured in [`docs/superpowers/findings/2026-05-25-b137-refinements.md`](superpowers/findings/2026-05-25-b137-refinements.md). Separate find: the Velocity card on Dashboard still shows "Start burning kanji to see a projection" despite the operator having 174 burned cards post-Spec-1.5 — copy assumed the pre-FSRS unreachable-burned state. Filed into [`docs/superpowers/plans/2026-05-25-milestones-panel-rework.md`](superpowers/plans/2026-05-25-milestones-panel-rework.md) under "Related Dashboard fixes (file while in the area)" so the Milestones session picks it up while doing adjacent UI work.

---

## Prior session — 2026-05-23 (Spec 1.5 FSRS migration shipped — B135 in TestFlight)

**Spec 1.5 (FSRS migration) is fully landed — on `main`, on the live DB, in the deployed API, and in TestFlight as B135.** 15 commits from `1561714`…`9f5357d` replaced the SM-2 scheduler with hand-rolled FSRS-5, swapped the schema (migration 0024), and seeded existing card state via a one-time replay. Live rollout sequence: safety dump → migration 0024 applied → replay walked 4 users / 742 progress rows / 2857 review_logs in ~2 min → App Runner op `3f6c157cd008489e8ac85778cf893eda` SUCCEEDED → B135 submitted to TestFlight (`6f063489-76ce-43c8-ba41-3f764d9322bb`). B135 is in TestFlight and verified working on-device.

**Side-benefit confirmed on-device:** under SM-2, the "burned" status was effectively unreachable (interval reset to 1 day on every Hard/Again). After replay, **174/742 cards (23%) correctly sit in burned**, matching the user's subjective experience of months of daily use without ever burning a kanji.

**Carry-forward verification owed on B135:** the combined Plans A/B/C walkthrough was originally owed on B134; B135 absorbs it (and adds FSRS-specific items). See the walkthrough section below.

## Current state

- **Branch:** `main` at `52ff639` (the milestones-rework merge commit), fully pushed to `origin`. Working tree: same housekeeping queue as prior sessions (no new untracked items resolved).
- **Latest on `main` (this session, 2026-05-25 — second session):**
  - `52ff639` — `Merge branch 'milestones-rework'` (28 commits + merge; shared milestones types/ladders/tier rules + selection helpers, drizzle migrations 0012/0013, MilestoneDetector with numeric/JLPT/Grade tiers and gating, per-grade & per-JLPT bucket queries, hasPreDeployHistory grandfather pass, LearnerStateService refresh integration, recentMilestones+perGradeBuckets in analytics summary, mobile Milestone/Grade badge components, CoreBadgesRow/GradeBadgesRow, UpNextList, MilestoneDateSheet, MilestonesSection orchestrator wired into Progress tab, bronze/silver/gold theme tokens, Profile "Attach location to milestones" opt-in, tryGetCoordsForCapture helper, mobile→server wiring for optional coords). Merged cleanly on top of Phase 1' fixes; the merged tree also clears the long-standing `social-mute.test.ts:25` typecheck error (the fix was on `main` via `7ccfe32`, not on the branch).
- **Recent `main` history (earlier today's session — Phase 1', 22 commits in order):**
  - **Phase 1' T4** (test coverage + bug fixes caught by tests): `f1d111b` (jsonb storage-layer fix) → `8db3854` (23505 try/catch in NudgeService) → `1946de4` (T4 tests) → `ee2911e` (typed PostgresError + isUniqueViolation helper, T4 review-fix)
  - **Phase 1' T5** (API routes): `60cc638` (routes + wiring) → `cf51a0a` (envelope + preHandler array, T5 review-fix)
  - **Phase 1' T6** (push method): `f016dcc` (sendBuddyNudgePush) → `ae29d5b` (notificationsEnabled + sound, T6 review-fix)
  - **Phase 1' T7** (setImmediate wiring): `2b00e3c` (4th SrsService arg + 6 callsites) → `e18265c` (BuddyNotifier port extraction, T7 review-fix)
  - **Phase 1' T8** (mobile hook): `838e9b8` (useBuddyNudges) → `9813a90` (drop double-fetch + clarify dismiss posture, T8 review-fix)
  - **Phase 1' T9** (components): `ef68cd8` (BuddyCard + BuddyCardStack) → `9134db9` (T8 retroactive: useFocusEffect from expo-router, not @react-navigation/native)
  - **Phase 1' T10-12** (surface mounts): `2a416c7` (Dashboard / Study Ready / Progress, bundled commit)
  - **Final pre-ship review fixes:** `b0a37d4` (Critical envelope `ok:true` + Important width + a11y role)
  - **Operator T13 + T14:** (no new commits for T13; database-only) → `6846822` (PostgresError import fix, deploy-rollback recovery) → `1d793f3` (record EAS-bumped buildNumber 136)
  - **Post-ship docs:** `4820559` (file B137 refinement + Velocity-projection bug)
  - (Two parallel docs commits from the operator's separate Milestones-rework work landed mid-session: `12f1a50` and `5684527` — unrelated to Phase 1')
- **Live DB (Supabase ap-southeast-2):** drizzle migrations `0012_kanji_grade_idx.sql` and `0013_user_profile_attach_location.sql` applied 2026-05-25 via `psql -f` (later session). Pre-migration safety dump at `/tmp/buddy-milestones-safety/live-20260525-2329.sql` (5.8M; delete after 24h stability). Verified: `kanji_grade_idx` present on `kanji`; `user_profiles.attach_location_to_milestones boolean DEFAULT false NOT NULL` column present. Earlier today: migration `0025_buddy_nudges_dedupe_indexes.sql` applied (Phase 1') — pre-migration safety dump at `/tmp/buddy-phase1-safety/live-20260525-1138.sql` (5.7M).
- **API:** Currently running op `2f536eedd4ce4f459e7fc8eb77236dd0` SUCCEEDED at ~2026-05-25 16:40 PT (23:40 UTC) — image `sha256:266a01a254cae1004754a9f92cde19d30523c355a9c87a3bc32a80a7e9d5bc06` with 17 env vars including `MILESTONES_DEPLOY_CUTOFF_ISO=2026-05-25T23:50:00Z`. Smoke: `/health` 200, `/v1/buddy/nudges?screen=dashboard` 401. Today's deploy sequence was: (Phase 1' session) `5515dd96…` ROLLED BACK on missing-postgres-import → `c955bd8c…` SUCCEEDED clean → (Milestones session) `4f7b21c4…` SUCCEEDED (new image, OLD env vars — deploy-api.sh footgun, see TL;DR) → `2f536ee…` SUCCEEDED (env var corrected via `update-service`).
- **TestFlight:** B137 submitted 2026-05-26 00:0X UTC (build `aa732953-22e3-49d5-bceb-7e681f04dbe8`; submission `44850bda-5e24-42d2-a7c8-6e1557f35415`). Bundle: Phase 1' BuddyCard placement refinement + Velocity-card copy patch + Milestones mobile UI (badges/UpNext/date sheet wired into Progress) + Profile location-opt-in toggle. EAS auto-bumped `ios.buildNumber` 136 → 137; recorded locally in a follow-up `chore(mobile)` commit. B136 (Phase 1') still in TestFlight in parallel until B137 supersedes.
- **Watch:** unchanged. Per refresh §6.3, deferred for complete reconceptualization in its own brainstorm.

## How to resume next session

Two parallel tracks are owed before Phase 5 kicks off:

**Track A — T15 on-device walkthrough on B136** (still pending from Phase 1'). Operator drives the device, agent guides. Write the findings doc at `docs/superpowers/findings/2026-05-25-phase-1-prime-verification.md` and update HANDOFF.md.

**Track B — cut B137 and verify the milestones rework on-device.** Server + DB are live; mobile is not. Bundle the four items listed in the TL;DR (Milestones UI, location-opt-in toggle, BuddyCard placement refinement, Velocity-card copy fix). Then walk a milestones-specific checklist on B137. Findings doc at `docs/superpowers/findings/2026-05-25-milestones-panel-rework.md`.

Suggested orientation for the next agent:

> "Phase 1' API+DB shipped to B136 (T15 walkthrough still owed). Milestones panel rework API+DB also shipped to live today — see HANDOFF.md TL;DR for full state including the `MILESTONES_DEPLOY_CUTOFF_ISO` env var. Mobile changes for milestones are NOT in TestFlight yet. Two jobs: (Track A) walk T15 on B136 per `docs/superpowers/plans/2026-05-24-buddy-phase-1-prime.md`; (Track B) cut B137 bundling Milestones UI + Profile location-opt-in toggle + B137 placement refinement + Velocity-card copy fix, then walk a milestones checklist (Progress tab badges + UpNext + date sheet, Profile toggle, optional location attached to a newly-earned milestone). Pick whichever the operator prefers to verify first; B137 cut takes ~30min EAS time so it can run in the background while T15 walkthrough proceeds. After both verifications, the next slice per the refresh doc §9 ordering is the Phase 5 brainstorm (Contextual Mnemonic Co-Creation)."

**Canonical operator test account (for Supabase verification queries):** `7c707446-a006-4be6-8c9e-6e1f207a76df` (display_name `RAD`, email `buddydennis@me.com`). This is the account RAD actually walks builds on. A second parallel account exists — `b8503589-1695-4659-b69d-b9e77d1cf655` (display_name `Buddy`, email `buddydennis@gmail.com`) — historically referenced in prior HANDOFFs but NOT the verification target. Always default to the RAD user_id unless explicitly told otherwise.

**T15 checklist** (from the plan + final-review additions):
1. Dashboard shows Meet Buddy card on first launch post-deploy
2. Dismiss it → re-open Dashboard → card stays gone
3. Study Ready: streak card only if on a milestone-day streak (3/7/14/30/60/90/100/180/365)
4. Progress: no Buddy card visible (rules don't fire there in v1)
5. If on a milestone-day streak, grade a card to complete a session → watch for Expo push
6. Supabase SQL spot-check: rows for the operator's user_id with `dismissed_at`/`push_delivered_at` matching observed behavior

**Operator gotcha to confirm first:** the operator's `user_profiles.notificationsEnabled` must be `true` for the milestone push to actually fire. The in-app BuddyCard appears regardless.

**B137 refinements queue:** see [`docs/superpowers/findings/2026-05-25-b137-refinements.md`](superpowers/findings/2026-05-25-b137-refinements.md) — currently one item (BuddyCard placement under Drill Weak Spots).

---

## On-device walkthrough — owed on B136 (Phase 1' items + B135 + B134 carry-forward)

The B136 build supersedes B135 in TestFlight. The B135 systematic walkthrough was never fully completed (only the burned-count was eyeballed); B136 absorbs it AND adds Phase 1'-specific items.

### Phase 1' specific (NEW in B136)

- [ ] **Dashboard: Meet Buddy card** appears on first launch post-deploy (one-time, lifetime per user)
- [ ] Dismiss Meet Buddy → re-open Dashboard → card stays gone (verify both same-session and after a kill-and-relaunch)
- [ ] **Dashboard: streak card** appears if the operator is currently on a milestone-day streak (3/7/14/30/60/90/100/180/365). If not on a milestone day, Dashboard shows Meet Buddy only.
- [ ] When BOTH cards are present on Dashboard: Meet Buddy renders above streak (priority 10 > priority 5, design spec §4.2 stacking)
- [ ] **Study Ready screen: streak mirror card** appears between the stats row and the Begin button if on a milestone day. Dismissing the Dashboard streak card does NOT dismiss the Study Ready one (independent rows by design — separate dedupe keys).
- [ ] **Progress tab: no Buddy card visible** (placement is wired but no rules fire on Progress in v1)
- [ ] If the operator is on a milestone-day streak: grade a card to complete a review session → watch for an Expo push notification ("Kanji Buddy" title, streak message body, with sound). Push fires exactly once per milestone — a second session same day does not re-fire.
- [ ] No `[BuddyPush]` or `[Buddy post-submit]` warnings in App Runner logs during the walkthrough
- [ ] Supabase SQL spot-check (RAD user_id `7c707446-a006-4be6-8c9e-6e1f207a76df`):
  ```sql
  SELECT id, user_id, screen, nudge_type, action_payload, dismissed_at, push_delivered_at, created_at
  FROM buddy_nudges
  WHERE user_id = '7c707446-a006-4be6-8c9e-6e1f207a76df'
  ORDER BY created_at DESC LIMIT 10;
  ```
  Expected: Meet Buddy row + (if milestone) Dashboard + Study Ready streak rows; `push_delivered_at` set on the Dashboard streak row only.

### FSRS-specific (carry-forward from B135)

### FSRS-specific (NEW in Spec 1.5)

- [ ] **Burned count** — verified ✓ (user confirmed previously-zero burned tier now reflects months of practice)
- [ ] An **overdue** Good/Easy review (R(now) decayed past ~0.85) triggers the **quiz leg**
- [ ] A **same-day** Easy review (R(now) = 1.0) does **NOT** trigger the quiz
- [ ] **Burned-sample surprise check** still triggers a quiz (orthogonal to R signal)
- [ ] **Session Complete** "Practice breakdown" row (flashcard / writing / speaking / quiz) renders correctly
- [ ] **Kanji-detail page** shows integer day counts in the "Interval" stat (no "3.175... days" floating-point leaks)
- [ ] After a loop quiz: a `testSessions` row exists with `test_type = 'loop_check'` and matching `testResults` (Supabase SQL spot-check)
- [ ] No FSRS-related errors in App Runner logs

### B134 carry-forward — Plans A/B/C combined (originally owed on B134, now on B136)

**Plan A (minutes-budget time-box):**
- [ ] Onboarding asks "How many minutes per day?" (5/10/15/20/30, default 15)
- [ ] Profile shows "Minutes per day"
- [ ] Study session shows a live "Nm left" countdown
- [ ] Session ends after the in-progress card (never mid-card), 🎉 banner on goal met
- [ ] "Keep studying" starts a fresh timed segment
- [ ] Dashboard shows "N reviewed today" (plain count)

**Plan B (writing/speaking legs + nav):**
- [ ] Tab bar: 6 tabs (Dashboard · Study · Browse · Journal · Progress · Profile). No Write/Speak tabs
- [ ] Grade a new kanji → writing leg → "Continue to speaking" → speaking leg → advances
- [ ] Grade a review kanji Again/Hard → routes through writing → speaking
- [ ] Time-remaining indicator shows on leg headers; session ends only after a kanji's full path
- [ ] "Drill Weak Spots" / "Drill missed cards" stay flashcard-only
- [ ] Heavy-review account: session surfaces some new kanji near the start (guaranteed allowance)

**Plan C (Ready screen, quiz/vocab/breakdown):**
- [ ] Study tab opens to the Ready screen (today's minutes + due count + Begin)
- [ ] Unflagged Good/Easy → advances (no quiz)
- [ ] Speaking leg shows vocab-word layout (vocab + pitch reading) for kanji with example vocab; legacy kanji-reading layout otherwise

### B133 carry-forward (still relevant)

- [ ] App Runner logs: one `[Internal] Daily reminder job triggered` per hour, no `[Cron] Running hourly reminder check`; one daily-reminder push, no duplicate
- [ ] Study speaker icon un-sticks (Item 6)
- [ ] Empty-transcript hint on Speaking (Item 7)
- [ ] Reported Speak vocab words pass (Bug A)

---

## Spec 1.5 — executed this session (recap)

Spec: [`docs/superpowers/specs/2026-05-22-fsrs-migration-design.md`](superpowers/specs/2026-05-22-fsrs-migration-design.md)
Plan: [`docs/superpowers/plans/2026-05-22-fsrs-migration.md`](superpowers/plans/2026-05-22-fsrs-migration.md)
Runbook: [`docs/superpowers/runbooks/2026-05-22-fsrs-rollout.md`](superpowers/runbooks/2026-05-22-fsrs-rollout.md)

Branch `spec-1.5-fsrs-migration` (deleted post-merge), worktree removed. 15 commits on `main`:

1. **`1561714`** — Task 1: FSRS-5 types + pure helpers (`FsrsCard`, `ratingFromQuality`, `statusFromStability`, `retrievability`). Adds vitest to `packages/shared` for the first time.
2. **`6b98af7`** — Task 2: `calculateNextReview` + `createNewCard` (hand-rolled FSRS-5 math, 28/28 unit tests pass).
3. **`cb662e9`** — Task 2 review fixes (corrected misleading `FACTOR` comment; added inline "DELIBERATE DIVERGENCES FROM CANONICAL FSRS-5" doc-block).
4. **`75644b1`** — Task 3: schema migration `0024` (drop `ease_factor`/`interval`/`repetitions`; add `stability`/`difficulty`/`lapses`/`total_reviews`).
5. **`3b9d423`** — Task 4: replay script (`scripts/replay-srs-fsrs.mjs`).
6. **`02e3535`** — Task 5: `submitReview` rewire.
7. **`ee8381e`** — Task 6: `getReviewQueue` + `getReadingQueue` rewire. **Eliminates the unbounded `reviewLogs` fetch** that was on the housekeeping queue as a perf follow-up (R-based predicate, no per-card log fetch).
8. **`037e99f`** — Task 7: `dual-write.service.ts` rewire (typecheck-restoring commit).
9. **`3112ba2`** — Task 8: touch-point sweep (`cron.ts`, `placement.service.ts`, `kanji.ts` route) + **amended migration `0024`** to drop+recreate `kanji_mastery_view` (it referenced the dropped `interval` column).
10. **`65e6278`** — Task 8 polish: round `srsInterval` for kanji-detail display (no floating-point days).
11. **`e3573cd`** — Task 9: 5 integration tests pinning the R-based `maybeSlipping` predicate.
12. **`77921c7`** — Task 10: rollout runbook.
13. **`9af2b83`** — final-review fixes: (a) replay `ON CONFLICT ON CONSTRAINT` → `ON CONFLICT (user_id, kanji_id)` (the named ref was a unique INDEX, not a constraint — would have crashed the live UPSERT), (b) `placement.service.ts` writes `lastReviewedAt` so the next review doesn't take the first-review branch and reset stability, (c) `isSlipping` fallback `?? 1` → `?? 0`.
14. **`08a85bf`** — clone-rehearsal-found fixes: (a) replay honors `sslmode=disable` for local DBs; (b) replay auto-refreshes `kanji_mastery_view` at end (the migration populates the view inside its transaction when stability is still default 0 — without the refresh `interval_days` is 0 everywhere).
15. **`9f5357d`** — runbook: explicit merge-after-rehearsal step + "Rehearsal findings" section.

**Verified at merge time:** workspace typecheck clean modulo known pre-existing `social-mute.test.ts:25` · API 235/235 · shared 28/28.

### Clone-rehearsal results (pre-merge)

Run against a fresh `pg_dump` of live DB restored into a local Postgres clone:
- 4 users / 742 progress rows / 2857 review_logs / 2294 kanji
- Replay finished in ~1 second
- Spot-check (5 kanji from user `6d6c500a`): all match dry-run output to 2 decimal places
- Idempotency: second replay produces identical state
- Status distribution after replay: learning=78, reviewing=107, remembered=383, burned=174 (matches live post-rollout exactly)

### Live rollout sequence (today, 2026-05-23)

| Step | Result |
|---|---|
| Safety dump (5.5MB pg_dump from live) | ✅ (removed post-verification) |
| Migration 0024 → live DB | ✅ committed cleanly |
| Replay against live DB | ✅ 742 cards in ~2 min cross-region |
| Spot-check vs rehearsal | ✅ 5/5 match exactly |
| `./scripts/deploy-api.sh` | ✅ image pushed, App Runner SUCCEEDED |
| API smoke | ✅ |
| `eas build --platform ios --profile production` | ✅ B135 |
| `eas submit --platform ios --latest` | ✅ submission `6f063489-76ce-43c8-ba41-3f764d9322bb` |

### Spec 1.5 follow-ups (Spec 2 territory)

Captured in the runbook for future cleanup:

1. **Orphan `UserKanjiProgress` interface** at `packages/shared/src/types.ts:36-48` still carries SM-2 fields. Zero consumers. Delete in cleanup.
2. **`srsEaseFactor` field-name footgun.** `apps/api/src/routes/kanji.ts` and mobile both type a field called `srsEaseFactor` but the value is now FSRS `difficulty` (1–10 absolute, not 1.3–2.5 multiplier). Field is typed but never rendered. Either rename to `srsDifficulty` (coordinated mobile + API change) or drop entirely.
3. **FSRS-5 fidelity sweep.** `packages/shared/src/srs.ts` has four documented deliberate divergences from canonical FSRS-5 (exponential R, no linear damping, mean-reversion-toward-Good, post-update D in `(11-D)`). First-review matches ts-fsrs to 8 decimals; subsequent reviews diverge ~20–28%. Revisit if community benchmarks or per-user parameter fitting ever matter.
4. **Pre-existing `social-mute.test.ts:25` typecheck error** — unrelated to migration, only remaining `pnpm typecheck` failure on `main`. Roll into a housekeeping pass.

---

## Spec 1 (Plans A/B/C) — shipped earlier (recap)

- **Plan A** (`def0009`) — daily goal became a minutes budget; the study session is time-boxed. Migration `0023` reinterpreted `daily_goal` as minutes (applied to the live DB 2026-05-18).
- **Plan B** (`7244317`…`da1b303`) — the writing/speaking loop legs; the Write & Speak tabs removed; the guaranteed new-kanji allowance (`planQueueSlots`).
- **Plan C** (`bcc0133`…`1120dab`) — Practice Loop quiz & close-out: maybeSlipping flag, quiz leg, Ready screen, vocab-word speaking layout, Session Complete modality breakdown, Browse promoted to a tab.

**Carry-forward Plan C follow-ups still relevant:**
- **Stale `study.tsx` file-header comment** — cosmetic doc drift; still not addressed.
- **Accessibility a11y debt** — leg close buttons / loading spinners need `accessibilityLabel`; `Ionicons name={icon as any}` is repeated. Still pending app-wide a11y pass.
- **Resume edge case (accepted v1 limitation)** — app kill mid-quiz/writing/speaking resumes past that kanji and skips its remaining legs.

**Plan A/B WCAG carry-forward:** `colors.textMuted` on the dark background is ~3.86:1 vs AA 4.5:1 for 12px caption text. Rolls into the app-wide a11y pass.

**Plan C follow-up now MOOT:** ~~Unbounded `reviewLogs` fetch in `maybeSlipping`~~ — eliminated by Spec 1.5 Task 6 (R-based predicate operates on already-loaded card state; no per-card log fetch).

---

## Working tree — housekeeping queue (carry-forward)

Untracked items in the main checkout. Still need eyeball decisions:

| Item | Recommendation |
|---|---|
| ~~`.claude/worktrees/`~~ | ✅ gitignored. |
| `apps/lambda/daily-reminders/daily-reminders.zip` | gitignore (build artifact) |
| `apps/mobile/credentials.json` | **gitignore IMMEDIATELY if it contains secrets** — verify content first |
| `apps/watch/KanjiLearnWatch.xcodeproj/xcshareddata/` | gitignore (Xcode personal prefs) |
| `KanjiBuddyEnamel.jpg`, `KanjiBuddyMonkey.jpeg`, `KanjiBuddyMonkey.html`, `KanjiBuddyMonkey_files/` | Move to `apps/mobile/assets/branding/` (or `docs/branding/`) before the rebrand |
| `tooclose.jpg` | If a reference screenshot, move to `docs/branding/references/`; else delete |
| `app.json`, `eas.json` (repo root, not `apps/mobile/`) | Likely orphaned from an earlier prebuild — inspect → delete |
| `docs/superpowers/mockups/` | Inspect → commit if useful |
| `docs/superpowers/plans/2026-04-*.md` (7 files) | **Commit all** — executed session plans, belong on `main` as history |
| `docs/openbrain-migration-thoughts.md` | Open Brain migration record — keep (commit to `docs/`) or delete; harmless |
| `docs/b134-verification-checklist.md` | Generated this session; was used for B134 walkthrough; can commit or delete |

`.superpowers/` (visual-companion brainstorm scratch) is already gitignored.

---

## Pre-launch infra checklist

| | Item | Status |
|---|---|---|
| ✅ | Apply migration `0023` (Plan A) to the live DB | done 2026-05-18 |
| ✅ | Push `main` to `origin` (Spec 1) | done 2026-05-21 |
| ✅ | Deploy API for Spec 1 (Plans A/B/C) | done 2026-05-21 |
| ✅ | Cut + submit B134 to TestFlight (Spec 1) | done 2026-05-21 |
| ✅ | **Apply migration `0024` (Spec 1.5) to the live DB** | done 2026-05-23 |
| ✅ | **Run FSRS replay against live DB** | done 2026-05-23 |
| ✅ | **Deploy API for Spec 1.5** | done 2026-05-23, op `3f6c157cd008489e8ac85778cf893eda` SUCCEEDED |
| ✅ | **Cut + submit B135 to TestFlight (Spec 1.5)** | done 2026-05-23 — verified on-device |
| ✅ | **Apply migration `0025` (Phase 1') to the live DB** | done 2026-05-25; pre-check passed, table was empty |
| ✅ | **Deploy API for Phase 1'** | done 2026-05-25, op `c955bd8cb5f64cbab032e24df83c4c00` SUCCEEDED (first deploy `5515dd9608...` rolled back on missing-postgres-import; fixed in `6846822` and redeployed) |
| ✅ | **Cut + submit B136 to TestFlight (Phase 1')** | done 2026-05-25 — Apple processing |
| ✅ | **Merge `milestones-rework` to `main`** | done 2026-05-25; merge commit `52ff639`, pushed to `origin` |
| ✅ | **Apply drizzle migrations `0012` + `0013` (Milestones) to live DB** | done 2026-05-25; both verified present |
| ✅ | **Deploy API for Milestones rework + set `MILESTONES_DEPLOY_CUTOFF_ISO`** | done 2026-05-25, ops `4f7b21c4…` then `2f536ee…` both SUCCEEDED; env var set to `2026-05-25T23:50:00Z` |
| ✅ | **Cut + submit B137 to TestFlight (Milestones mobile + Phase 1' refinement + Velocity copy)** | done 2026-05-26 — build `aa732953…`, submission `44850bda…`; Apple processing |
| ✅ | **Deploy API for B138 hot-fix (grandfather location)** | done 2026-05-26, op `6d5fb02183884733894b60508557f22d` SUCCEEDED; image `sha256:7c6a7b49…` |
| ✅ | **Cut + submit B138 to TestFlight (stale-cache + grandfather-location hot-fix)** | done 2026-05-26 — build `5fc58b14-6fed-4f74-bc27-54dd94617c56`, submission `af845507-d016-44b2-8e80-eb9e001c915c`; Apple processing |
| ✅ | **Deploy API for softened silver rule** | done 2026-05-26, op `c677b8b5ec6b4e3a98b89080c8a9775c` SUCCEEDED; image `sha256:c89367c6…`. Buddy N5 silver written via direct refreshState; milestone count 14 → 15. |
| 🚀 | **Mobile/shared cut bundling the softened silver rule** | bundle into next mobile EAS cut. Cosmetic mismatch until then (UpNext may double-show silvers). |
| 🚀 | On-device walkthrough on B136 (Phase 1' + Spec 1 + Spec 1.5 combined) | T15 owed — see "On-device walkthrough" section above |
| 🚀 | On-device walkthrough on B138 (Milestones rework + B137 refinements + B138 hot-fix) | B138 supersedes B137; once it lands, verify badges actually appear on first launch (no force-quit), and that a fresh review on Buddy/gmail account populates milestones WITHOUT location. Findings doc at `docs/superpowers/findings/2026-05-25-milestones-panel-rework.md` (combine with B137 refinements + B138 hot-fix verification). |
| 🚀 | Secrets rotation + SSM Parameter Store migration | 7 keys still owed |
| 🚀 | Migrate Supabase DB `ap-southeast-2` → `us-east-1` | Cross-region tax; dedicated session |
| 🚀 | SES out of sandbox | Needed for tutor-share email at scale |
| 🚀 | Revert testing-phase flags | `EXPO_PUBLIC_DEV_TOOLS=1` (in `eas.json` production profile) + the 2h study-mate alert cap |
| 🚀 | **Reorder/gate Phase 5 cloud-first assembly + ship BYOK UI** | Phase 5 mnemonic assembly is **cloud-first** during testing (our Anthropic key, any user). Before App Store launch: flip keyless users to **on-device-first** (`on-device → template`, our key NOT used) and ship the **BYOK settings UI + secure storage** so opt-in users keep cloud-first on their own key. At scale, our-key cloud-first = unbounded spend + sends personal data off-device. See spec §7.3/§14 + memory `project-testing-phase-flags`. |

---

## Other open follow-ups

- ~~**Bound the `maybeSlipping` `reviewLogs` query**~~ — MOOT (eliminated by Spec 1.5 Task 6).
- **Orphan `UserKanjiProgress` interface in `packages/shared/src/types.ts`** — Spec 1.5 follow-up #1.
- **`srsEaseFactor` field-name footgun** — Spec 1.5 follow-up #2.
- **FSRS-5 fidelity sweep** — Spec 1.5 follow-up #3.
- **Orphaned `writing-queue` API code** — `GET /v1/review/writing-queue` + `getWritingQueue()` were used only by the deleted Write tab. Dead code (the *reading-queue* side is in use by Plan C's SpeakingLeg — keep it). A background task was spawned.
- **Truncated kanji readings** — `kanji.kun_readings`/`on_readings` capped at ~5 sorted entries; re-import full KanjiDic2 readings.
- **The "Kanji Buddy 1.0" rebrand** — rename Kanji Learn → Kanji Buddy, splash polish, About/Credits branding. Needs a brand-decision block first.
- **Tutor report writing scope-down** — the report still surfaces a Writing modality; Study no longer serves standalone writing prompts (writing is a loop leg). `getWriting` + `weakestModality` in the tutor report need scoping/removal. (Spec 2 territory.)
- ~~**Milestones panel rework**~~ — SHIPPED (API + DB) 2026-05-25, merge commit `52ff639`. Mobile UI + Velocity-card copy fix bundled into the owed B137 cut. Plan checkboxes were never ticked during execution; closeout findings doc at `docs/superpowers/findings/2026-05-25-milestones-panel-rework.md` still owed.
- **`scripts/deploy-api.sh` footgun** — line 24 `${APPRUNNER_SERVICE_ARN:-…}` doesn't accept empty-string override to skip `start-deployment`. Fix: change to `${VAR-…}` (no colon). Low-priority since the workaround (run `update-service` before `deploy-api.sh` when bundling env-var changes) works.
- ~~**`interventions.payload` double-encoded**~~ — FIXED for new writes by Phase 1' T4's storage-layer jsonb fix (commit `f1d111b`, `packages/db/src/client.ts`). Existing legacy rows remain double-encoded; only SQL-side `->>` queries against historical interventions are affected (none in current code paths).
- **B137 refinements queue** — [`docs/superpowers/findings/2026-05-25-b137-refinements.md`](superpowers/findings/2026-05-25-b137-refinements.md). Currently one item: move BuddyCardStack on Dashboard up under the Drill Weak Spots button (operator feedback from B136 walkthrough). To be bundled into the same B137 cut as the Milestones mobile UI + Velocity-card copy fix.
- **App-wide accessibility pass** — touch targets / `accessibilityLabel`s, plus the `textMuted` contrast debt. Warrants its own task given WCAG 2.1 AA standard.
- ~~**Pre-existing `social-mute.test.ts:25` typecheck error**~~ — FIXED on `main` via `7ccfe32` (Phase 1' session, "allow standard register options in buildTestApp RouteSpec"); the milestones merge confirmed `pnpm typecheck` is now clean across all 4 packages.
- **`useBuddyNudges` hook tests** — design spec §6.4 called for them; Phase 1' shipped without (per the project convention of not unit-testing mobile hooks). Worth adding if any complex behavior accrues.

---

## Working environment notes

- **Prod API:** `https://73x3fcaaze.us-east-1.awsapprunner.com`. Milestones rework (MilestoneDetector + LearnerStateService refresh integration + analytics summary additions) live as of 2026-05-25 23:40 UTC; Phase 1' (Buddy NudgeService + routes + push) live since 2026-05-25 ~12:00 PT; Spec 1.5 FSRS live since 2026-05-23. App Runner service ARN: `arn:aws:apprunner:us-east-1:087656010655:service/kanji-learn-api/470f4fc9f81c407e871228fb9dd93654`. AutoDeploymentsEnabled=False — deploys only via explicit `start-deployment` or `update-service` (the latter triggers redeploy on config change).
- **Supabase:** still `ap-southeast-2`. Two migration tracks coexist: (a) supabase-format files in `packages/db/supabase/migrations/` (`0001`–`0025`; `0024` FSRS applied 2026-05-23, `0025` buddy_nudges dedupe applied 2026-05-25); (b) drizzle-format files in `packages/db/drizzle/` (`0012` kanji_grade_idx applied 2026-05-25, `0013` user_profile_attach_location applied 2026-05-25). Both tracks applied via raw `psql -f` — Supabase CLI is NOT used in this project, which is why `supabase_migrations.schema_migrations` doesn't exist (harmless log notice if anything queries it).
- **App Runner env vars:** managed via `aws apprunner update-service` against the service's `SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables`. Current keys (17): `ANTHROPIC_API_KEY`, `API_BASE_URL`, `AWS_REGION`, `CORS_ORIGIN`, `DATABASE_URL`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `HOST`, `INTERNAL_SECRET`, `LOG_LEVEL`, `MILESTONES_DEPLOY_CUTOFF_ISO`, `NODE_ENV`, `PORT`, `SES_SENDER_EMAIL`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`. To add/change without leaking secrets to the transcript: `describe-service --query 'Service.SourceConfiguration' --output json` → modify via `jq` → `update-service --source-configuration file://...`.
- **Docker / API deploy:** `./scripts/deploy-api.sh` from repo root. Builds + pushes the image to ECR and triggers an App Runner deployment. Returns immediately; monitor rollout via the App Runner console or `aws apprunner list-operations`.
- **EAS builds:** from `apps/mobile/`, ~$2/build. `eas build --platform ios --profile production --non-interactive`. EAS auto-bumps `ios.buildNumber` — **never hand-edit `app.json`** (it tracks the LAST shipped build; EAS bumps to +1 server-side). Submit with `eas submit --platform ios --latest --non-interactive`. Apple processing follows (~5–10 min from submit).
- **Watch builds:** **manual Xcode rebuild only** — EAS does not build the watchOS target. Spec 1.5 was API-only; no Watch rebuild required.
- **FSRS replay script:** `scripts/replay-srs-fsrs.mjs`. Run via `./packages/db/node_modules/.bin/tsx scripts/replay-srs-fsrs.mjs` (or `node --import tsx/esm ...`). Honors `sslmode=disable` for local rehearsal DBs; defaults to `ssl: 'require'` for Supabase. Idempotent. Auto-refreshes `kanji_mastery_view` at end. `--dry-run` and `--user <uuid>` flags supported.
- **Clone-rehearsal pattern:** for any future destructive migration, the FSRS rollout established the pattern — fresh `pg_dump` of live → restore to local Docker Postgres → apply migration → run replay/backfill → spot-check → merge to main → live rollout. The runbook at `docs/superpowers/runbooks/2026-05-22-fsrs-rollout.md` documents it explicitly.
- **Worktrees:** `.claude/worktrees/` is the Claude Code scratch-worktree location (gitignored). Spec 1.5 was executed in `.claude/worktrees/spec-1.5-fsrs-migration` (now removed, fast-forward-merged to main).
- **Co-author convention:** every kanji-learn commit includes `Co-Authored-By: Robert A. Dennis (Buddy)` alongside the Claude co-author line.
