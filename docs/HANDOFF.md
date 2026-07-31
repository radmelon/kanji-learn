# Session Handoff — 2026-07-31 (**Weekly Buddy Review: spec, plan, and slice 1 complete — on a branch, not `main`**)

> **Canonical URL — hand this to a new session:**
> https://github.com/radmelon/kanji-learn/blob/main/docs/HANDOFF.md
>
> *(This line is deliberately part of the artifact. A handoff that cannot state
> its own address makes every reader reassemble it from a bare path. Carry it
> forward into each new handoff section.)*

## START HERE — 2026-07-31

> ## 🟡 Everything below is on branch `weekly-buddy-review-spec`. Nothing is on `main`.
>
> ```bash
> git checkout main && git merge weekly-buddy-review-spec
> ```
>
> 26 commits, 34 files, +6,408 lines. Review before merging — see *Open
> decisions* at the bottom, which are yours and not the implementers'.
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
