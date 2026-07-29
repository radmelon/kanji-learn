# Session handoff — the placement model and B-210

**Canonical URL — hand this to a new session:**
https://github.com/radmelon/kanji-learn/blob/main/docs/HANDOFF-placement-and-b210.md

Written 2026-07-29. **Not the next session** — the next one is the build-and-test
protocol (see [`HANDOFF.md`](HANDOFF.md)). This one waits.

Blocks: [`2026-07-28-new-learner-arc-design.md`](superpowers/specs/2026-07-28-new-learner-arc-design.md)
§10(b). That spec cannot be planned until this is settled.

---

## Start here

**Do not fix B-210 as written.** The bug says *"retaking the placement test
destroys FSRS state on in-progress kanji"* and implies a guard — an "already
placed" check, a confirmation dialog. **A guard would preserve the cause.**

The owner's framing, 2026-07-29:

> *"Periodic retests should improve our estimation of a student's state of
> learning."*

That sentence dissolves the bug. Today a retake **replaces** state, which is
exactly why it destroys progress. Under an estimation model a retest is
**additional evidence refining a posterior** — nothing is replaced, so nothing
is destroyed, and B-210 cannot occur. The bug is a symptom of the wrong model.

So the question for this session is not "how do we stop retakes" but **"what
should a placement test be?"**

## What is true today — verified, not assumed

`packages/shared/src/placement.ts` is **56 lines**.

| Question (owner, 2026-07-29) | Answer |
|---|---|
| How many questions? | **60**, fixed length. `MAX_QUESTIONS = 60`. Starts at N3. |
| Testing methodology? | An **up-down staircase**. Sliding window of 5; `passRate >= 0.7` steps up a level, `<= 0.3` steps down. |
| IRT? | **No.** No item difficulty parameters, no ability estimate, no information function, no adaptive item selection. |
| Confidence in the estimate? | **None is computed.** No standard error, no interval. The output is `currentLevel` — wherever the walk happened to stop — plus per-level pass counts. |

```ts
const MAX_QUESTIONS = 60
const WINDOW_SIZE = 5
const PASS_THRESHOLD = 0.7
const FAIL_THRESHOLD = 0.3
```

### Four weaknesses that follow

1. **Within-level difficulty is treated as uniform.** Indefensible when N1 alone
   holds **1,308 kanji** of enormously varying difficulty. Passing five easy N1
   items is not evidence of N1.
2. **The final level is where a random walk stopped.** With a window of 5 and no
   step-size decay, the estimate oscillates and the last value is noisy. A proper
   staircase narrows its step as it converges; this one does not.
3. **No termination on convergence.** It always runs 60 items, even when the
   answer became clear at item 20 — and keeps going when it is still ambiguous
   at 60.
4. **60 items is a large ask** of someone who has not yet seen the app do
   anything. It is the first thing a new user is encouraged to do.

## The opportunity nobody has taken

**Item difficulties do not need to be invented — they can be estimated from data
already recorded.**

- `user_kanji_progress.difficulty` holds a **per-kanji FSRS difficulty** for
  every card any learner has studied.
- `review_logs` holds thousands of graded responses — each one an item response
  in the psychometric sense.

That is the raw material for calibration. Whether it is *sufficient* (five
accounts, a few thousand responses) is a real question for this session, and the
honest answer may be "not yet, but the pipeline should exist."

## Questions to work through

1. **What is the placement test *for*?** Three plausible answers, and they imply
   different designs: seed the SRS queue; tell the learner where they stand; feed
   the plan (§5B of the arc spec). It currently does the first, poorly reports
   the second, and does not do the third.
2. **How confident must we be?** A starting position that is one level off
   self-corrects within days of study — FSRS re-estimates from real reviews. That
   argues for a *shorter, rougher* placement than 60 items, not a longer one.
   Worth stating explicitly, because it may invert the instinct to add rigour.
3. **IRT, or a simpler estimator?** IRT is the textbook answer and gives a
   standard error, adaptive selection, and principled retest accumulation. It
   also needs calibrated items and is a real body of work. A Bayesian
   level-posterior with far fewer parameters may get most of the value. **Do not
   default to IRT because it sounds rigorous** — decide what precision is
   actually needed (see 2).
4. **What does a retest look like?** If it accumulates evidence, it can be much
   shorter than the first — perhaps 10–15 items targeted at the current
   uncertainty. That is a genuinely nice feature: *"a quick check-in"* rather
   than *"take the 60-question test again"*.
5. **Should Buddy propose retests, or wait to be asked?** Ties to the arc spec's
   invitation rules.
6. **What happens to the estimate as normal study accrues?** Study is itself
   evidence. A learner who has burned 200 kanji since placement has told you more
   than the test did.

## Related, and worth folding in

**SRS → FSRS terminology and attribution.** Owner, 2026-07-29:

> *"all of our explanations reference SRS while some time ago we refactored to
> use FSRS… We need to be transparent and accurate regarding our methods and
> models, particularly when we are using open source ones."*

**Verified: 11 user-facing strings in `apps/mobile/app/(tabs)/progress.tsx` say
"SRS"**, including *"Your kanji are sorted into five SRS stages"*, *"The SRS
interval has reached ~6 months"*, and a panel titled *"Quiz vs SRS"*. The engine
has been **FSRS-5** since Spec 1.5 (migration `0024` + one-time replay).

Not pedantry: SRS is the family, FSRS is a specific published open-source
algorithm this project depends on. Several of those strings also describe
*fixed-interval* behaviour that FSRS does not have — it derives scheduling from
stability and difficulty. So the copy is inaccurate as well as misattributed.

Belongs here because it is the same subject: being accurate about the models we
use. Sweep `progress.tsx`, README, onboarding copy and the sign-in subtitle.

### And FSRS is credited nowhere — checked 2026-07-29

**The data is attributed properly and the algorithm is not.**
`apps/mobile/app/about.tsx` carries a full KANJIDIC2 `AttributionCard` — CC BY-SA
4.0 badge, licence link, EDRDG acknowledgement, project link, and a comment
saying *"required by CC BY-SA 4.0"*. Someone did this carefully.

**FSRS appears in neither the About screen nor the README.** The app runs a
hand-rolled implementation of a published open-source algorithm and credits its
authors nowhere.

Not a licence violation the way an uncredited CC BY-SA dataset would be — but it
is precisely what the owner asked to fix, and the About screen already contains
the pattern to copy. Add an FSRS card beside the KANJIDIC2 one.

**Minor, related:** `packages/db/src/schema.ts:123` says *"See ACKNOWLEDGEMENTS"*
and **no such file exists** — the only matches in the tree are CocoaPods
build artefacts. The attribution it points at lives in `about.tsx`. Either
correct the comment or create the file.

## Files

| | |
|---|---|
| Engine | `packages/shared/src/placement.ts` (56 lines) |
| Item selection | `apps/api/src/services/placement.service.ts` |
| Route | `apps/api/src/routes/placement.ts` |
| Client | `apps/mobile/app/placement.tsx`, `apps/mobile/src/stores/placement.store.ts` |
| Unguarded entry point | `apps/mobile/app/(tabs)/profile.tsx` — `router.push('/placement')` |
| No "already placed" check | `POST /v1/placement/complete` |
| Terminology sweep | `apps/mobile/app/(tabs)/progress.tsx` (11 strings) |

## Warnings

- **Do not tap Placement Test while testing on a live account.** It currently
  destroys FSRS state, and the owner's account has **104 kanji in learning**.
- Calibration work touches live learner data. Take a dump first — see
  `scripts/with-live-db.sh`, and the safety-dump precedent in `HANDOFF.md`.
- Any migration here follows the corrected order learned the hard way:
  **migrate → deploy → clean**, never deploy-before-migrate.
