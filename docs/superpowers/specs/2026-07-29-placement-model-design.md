# The placement model — design

**Canonical URL — hand this to a new session:**
https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-07-29-placement-model-design.md

Owner brainstorm, 2026-07-29. Resolves
[`HANDOFF-placement-and-b210.md`](../../HANDOFF-placement-and-b210.md) and
unblocks
[`2026-07-28-new-learner-arc-design.md`](2026-07-28-new-learner-arc-design.md)
§10(b).

---

## 1. Why this, why now

B-210 says *"retaking the placement test destroys FSRS state on in-progress
kanji"* and implies a guard. The owner's reframing dissolves it:

> *"Periodic retests should improve our estimation of a student's state of
> learning."*

Today a retake **replaces** state. Under an estimation model a retest is
**additional evidence refining a posterior** — nothing is replaced, so nothing
can be destroyed. B-210 stops being a bug to guard against and becomes a symptom
of the wrong model.

This spec replaces the model.

## 2. Scope

**In:** the ability estimator, the item difficulty model, adaptive item
selection and stopping, what placement writes to `user_kanji_progress`, retests,
repair of accounts already damaged, and the SRS → FSRS terminology and
attribution sweep.

**Out:** continuous re-estimation from review logs (§9, deliberately deferred);
Buddy's invitation behaviour beyond a default (§10, owned by the arc spec);
writing/voice item types in placement.

Two parts are **independently shippable and should not wait on the estimator**:
§12 (repair — which must in fact go first) and §13 (terminology and attribution).
They are in scope because they belong to the same subject, not because they share
a dependency.

## 3. What is true today — verified 2026-07-29

`packages/shared/src/placement.ts` is 56 lines: an up-down staircase, window of
5, ≥0.7 steps up, ≤0.3 steps down, fixed 60 items, starts at N3. No item
difficulties, no ability estimate, no confidence.

Four findings from reading the code that the handoff does not record.

**(a) A "pass" is meaning AND reading, both 4-option multiple choice.**
`placement.store.ts:90–127` — miss the meaning and the item is recorded failed
without the reading ever being shown. So a learner who knows 見 means "see" but
blanks on the reading is recorded **identically to someone who has never seen
the character**. One bit is stored for two abilities. It is also up to 120 taps,
not 60.

**(b) Three different level estimates are computed from one run, and they can
disagree.**

| Estimate | Where | Used for | Persisted |
|---|---|---|---|
| `currentLevel` | client staircase | item selection | no |
| `inferredLevel` | `placement.service.ts:160–171` — walk N5→N1, ≥60%, break on first failure | `placement_sessions.inferred_level` | yes |
| `passedByLevel` | `PlacementEngine.getPassedByLevel` | pitch-accent default | yes, in `summary_json` |

Nobody reconciles them.

**(c) B-210 is a false promotion, not merely a reset.** `sampleKanjiIds` excludes
only `remembered` and `burned`, so cards in `learning` are eligible for sampling.
Passing one runs `applyPlacementResults:242–247`:

```ts
.set({ status: 'remembered', stability: 21, difficulty: 5, totalReviews: 1,
       nextReviewAt, lastReviewedAt: new Date(), updatedAt: new Date() })
```

A kanji the learner is mid-struggle with is declared remembered and hidden for
three weeks. **No `review_logs` row is written**, so the FSRS history has a
silent discontinuity — the damage is not reconstructible and not detectable by
replay.

**(d) The evidence layer already exists.** `placement_sessions` and
`placement_results` already persist every item response with its JLPT level.
Accumulating evidence across retests needs no new storage. Nothing ever reads
those rows back.

## 4. The model

Four decisions, taken in order, each a consequence of the last.

**The test estimates a scalar that predicts a vector.** A posterior over learner
ability θ. Per-kanji probabilities are *derived* through an item-difficulty
model, never asserted. This is the only framing under which "a retest refines the
estimate" is a coherent sentence.

**A derived probability seeds an FSRS prior — it does not set a status.** A
high-p card enters with initial stability and difficulty derived from p, instead
of today's flat `stability=21, difficulty=5`.

**Item difficulties come from kanji features, shrunk toward learner data as it
accrues.** Not from calibration alone — five accounts cannot estimate 2,294 item
parameters.

**The test stops when the posterior converges**, not at a fixed count.

### 4.1 The never-overwrite rule

**Placement never writes to a `user_kanji_progress` row that already has review
history.** Concretely: insert only where no row exists, or where the row is
`status='unseen'` with `totalReviews = 0`.

This is *not* the guard the handoff warns against. A guard says "you have already
been placed, you may not test again" — defensive, and it preserves the broken
model. This rule says **a card with real review history already holds better
evidence than a placement item can provide**, which is simply true: an item that
a pure guesser passes 6% of the time cannot outrank thirty logged reviews
carrying stability and difficulty. The rule falls out of the model rather than
being bolted onto it. Same effect on B-210, opposite provenance.

Item selection changes to match: exclude any kanji with `totalReviews > 0`, not
just `remembered`/`burned`. There is nothing to learn from testing a card the
learner has already studied.

## 5. Item design — splitting the conjunctive item

Meaning and reading become **two separately scored items** on the same character.

- Doubles the information per character shown.
- Stops recording "knows the meaning, missed the reading" as "never seen it".
- Both are always shown. Missing the meaning no longer skips the reading — that
  behaviour is what discards half the signal.

A character therefore contributes 2 responses, scored against two difficulties:

```
b_meaning,i = b_i
b_reading,i = b_i + δ_read
```

`δ_read > 0` because reading is the harder skill. It is a single global constant,
not per-kanji — a per-kanji reading offset is exactly the kind of parameter five
accounts cannot support (§6.3).

`placement_results.passed` (one boolean) cannot express this. See §11.

## 6. The difficulty model

### 6.1 Features already on the `kanji` table

| Column | Signal |
|---|---|
| `grade` | MEXT school grade — an empirical difficulty ordering validated on generations of schoolchildren |
| `frequencyRank` | KANJIDIC2 corpus frequency; the strongest single predictor |
| `jlptLevel` + `jlptOrder` | ordering across *and within* level |
| `strokeCount` | visual complexity |
| `components` length | compositional load |
| `onReadings` + `kunReadings` length | reading load — a kanji-level difficulty signal, distinct from `δ_read` (§5), which is a fixed offset between the meaning-item and reading-item for the *same* kanji |

This dissolves the handoff's weakness #1. "Within-level difficulty is treated as
uniform" was never a data problem — N1's 1,308 kanji vary enormously in `grade`
and `frequencyRank`, and that variation is already on the table, unused.

### 6.2 Two stages, one code path

```
b_i = (n_i · b_observed,i + k · b_prior,i) / (n_i + k)
```

- `b_prior,i` — the feature formula. Covers every kanji, including ones nobody
  has studied. No cold start, ever.
- `b_observed,i` — estimated from `review_logs` for that kanji across all
  learners.
- `n_i` — review count for that kanji. `k` — shrinkage constant, start at 20.

At `n_i = 0` this is exactly the feature prior. **Stage 2 ships as stage 1 with
the shrinkage weight at zero**, so the calibration pipeline the handoff wants
gets built now and improves on its own without a second project.

### 6.3 Where the prior's weights come from

```
b_prior = w₀ + w₁·z(jlptRank) + w₂·z(log frequencyRank) + w₃·z(grade)
             + w₄·z(strokeCount) + w₅·z(readingCount)
```

`jlptRank` is a single global ordinal built from `jlptLevel` and `jlptOrder`.
Null `grade` / `frequencyRank` fall back to the level mean.

The weights are the honest middle the handoff missed. **Five accounts cannot
estimate 2,294 item difficulties, but they can comfortably estimate six
regression weights.** Fit `w` by regressing `user_kanji_progress.difficulty`
(FSRS difficulty, already held per studied card) on the features, pooled across
all learners.

**Fall back to hand-set weights if the fit fails any of:** fewer than 300 studied
cards pooled; adjusted R² < 0.15; or any weight whose sign contradicts domain
expectation (rarer, later, more strokes and more readings must all make a kanji
*harder*, never easier). A wrong-signed weight is the failure mode that would
quietly corrupt every seeded card, so it is checked explicitly rather than
trusted. Record in the migration which path was taken.

`δ_read` is fit the same way, from the `meaning` vs `reading` split in
`review_logs.review_type`, and falls back with the same rule.

### 6.4 Storage

A `kanji_difficulty` table materialises `b_prior`, `b_observed`, `n`, the blended
`b`, and `δ_read` per kanji, refreshed by a job. Item selection then costs one
indexed query rather than a formula evaluation across 2,294 rows.

## 7. The ability estimator

A **Rasch model** — one-parameter IRT.

```
P(correct | θ, b) = c + (1 − c) · σ(θ − b)
```

`σ` logistic, `c = 0.25` (4-option MC) **fixed, not estimated**. θ and b share a
logit scale, roughly −4…+4.

The handoff poses "IRT, or a simpler Bayesian level-posterior?" as a choice.
It is not one: a Bayesian posterior over a scalar ability with items scored by a
known difficulty *is* IRT, the one-parameter kind. What makes IRT expensive is
**calibrating** discrimination and guessing parameters from response data, and
§6 removed that. The cheap option and the rigorous one are the same option here.

**θ's posterior** is maintained on a fixed grid over [−4, 4] (≈81 points),
updated multiplicatively per response. A grid avoids every numerical failure mode
of an analytic approximation at this size, and 81 floats is nothing.

**Prior:** flat-ish, centred on the N3 boundary — preserving today's "starts at
N3" behaviour as a stated prior rather than an accident of the ladder.

### 7.1 Guessing applies to responses, not to knowledge

`c` models the *response* — a learner can tick the right box without knowing the
character. It must not appear when predicting knowledge:

```
p(knows i)  =  σ(θ − b_i)        ← no c
```

Getting this backwards inflates every seeded card by the guess rate. It is the
single easiest mistake to make in this design.

### 7.2 The estimator leans conservative

The error is asymmetric. Over-estimating seeds a card with high stability and it
vanishes for weeks — a silent hole the learner finds much later, having been told
they knew something they did not. Under-estimating costs a few seconds of "yes, I
know this one."

So `p(knows i)` is evaluated at the **25th percentile of θ's posterior**, not its
mean. Uncertainty pushes p down, never up. This also counteracts the direction
multiple-choice evidence is already biased in.

### 7.3 Adaptive selection

Fisher information for Rasch is maximised at `b = θ`. Select the next character
from those with `b` nearest `θ̂`, sampling from the nearest ~20 candidates so
that two learners of the same ability do not see an identical test.

### 7.4 Stopping

| | First placement | Retest (§10) |
|---|---|---|
| Stop when | 80% credible interval on θ fits inside ±1 JLPT band | same |
| Floor | 8 characters (16 responses) | 4 characters (8 responses) |
| Cap | 24 characters (48 responses) | 12 characters (24 responses) |
| Typical | 12–15 characters | 4–6 characters |

Deliberately loose, on the handoff's own logic: a start one level off
self-corrects within days because FSRS re-estimates from real reviews. Rigour
here buys almost nothing and costs a new user their first five minutes.

Against today's fixed 60 items (60–120 taps), a typical first placement is 24–30
responses and the cap is 48 — well under half, for a better estimate.

The floor exists so the test does not feel dismissive. The cap bounds the
genuinely ambiguous case. The retest floor is lower because a retest starts from
an informed prior; asking 8 characters to confirm something already known would
be the padding this design exists to remove.

### 7.5 One level estimate, derived

The three estimates in §3(b) collapse to one. Each JLPT level's kanji have a mean
`b`; band boundaries are the midpoints between adjacent level means.
**`inferredLevel` is the band containing θ̂** — a label derived from the
posterior, never computed separately. Item selection uses θ directly. The
pitch-accent default derives from the same θ.

## 8. What placement writes

Given the posterior, for every kanji satisfying the never-overwrite rule
(§4.1 — no progress row, or an `unseen` row with zero reviews):

| Condition | Action |
|---|---|
| `p(knows) < 0.85` | **nothing written.** A normal new card. |
| `p(knows) ≥ 0.85` | seed an FSRS prior |

A seed writes:

| Field | Value |
|---|---|
| `status` | `'reviewing'` |
| `stability` | `3 + 18 · (p − 0.85)/0.15` days → 3…21 |
| `difficulty` | `b_i` mapped onto FSRS's 1–10 scale |
| `totalReviews` | `0` |
| `nextReviewAt` | now + stability |

Three things changed from today. `status` is `reviewing`, not `remembered` — the
evidence does not support "remembered", and claiming it is what makes the current
bug feel like betrayal. `stability` is a **ceiling** at 21 days rather than a
flat default; most seeded cards land at 3–10. `totalReviews` stays 0 because no
review happened, which also makes §12's detector sound.

Failed items write nothing under any condition. A fail means low p, and low p is
what a new card already is.

### 8.1 The audit trail

Every seed writes a `review_logs` row so the FSRS history has no silent gaps and
replay tooling can see what placement did.

- `review_sessions.sessionType = 'placement'` — free text with a default, so no
  migration is needed there.
- `review_type = 'placement'` — **one new enum value** (§11).
- `prevStatus='unseen'`, `nextStatus='reviewing'`, `prevStability=0`,
  `nextStability=S`, `prevDifficulty=5`, `nextDifficulty=d`.

`scripts/replay-srs-fsrs.mjs` is the existing precedent for reading this history
back.

## 9. Study as evidence — deferred, deliberately

The handoff's Q6 needs sharpening before it can be scoped. For a kanji already
studied, θ tells you nothing useful — FSRS holds a per-card stability and
difficulty built from real graded reviews, which strictly dominates anything a
placement model infers. The value is narrower and worth stating precisely:
**review outcomes sharpen θ, and a sharper θ improves p for the ~1,800 kanji not
yet touched.** The frontier, not the studied set.

Deferred for two reasons. The thing blocked on this work is the New Learner Arc,
and a new learner has no study history for it to read. And **θ is derived from
stored evidence, never the source of truth** — `placement_results` holds raw
per-item responses, so adding `review_logs` as a second evidence source later is
a query change, not a migration.

The trap this avoids is storing θ as the record. Store evidence, derive θ.

## 10. Retests

A retest is **the same code with the stored posterior as its prior** instead of a
flat one. Not a second feature.

It converges in 8–12 responses — 4–6 characters — because it starts informed. The
"quick check-in" the handoff asks for falls out for free.

The stored posterior is **widened for staleness** before being used as a prior,
since under §9 θ does not move with study:

```
SE' = √(SE² + (drift · days_elapsed)²)
```

`drift = 0.004 logits/day` — an order-of-magnitude placeholder, chosen so that
roughly a year of silence adds uncertainty comparable to the estimate's own SE,
weak enough that a retest can genuinely overturn it, while a retest a week later
still starts sharp. It is a tuning constant, not a measurement; revisit once §9
ships and real drift is observable.

**Default: retests are learner-initiated.** Buddy offers one at most once per 30
days, and only after ≥200 new kanji have been studied since the last placement.
Invitation behaviour proper is owned by the arc spec's §5 rules; this is the
floor, not the design.

## 11. Schema changes

| Change | Why |
|---|---|
| `review_type` enum += `'placement'` | audit trail (§8.1) |
| `placement_results` += `meaning_correct`, `reading_correct` (booleans, nullable) | §5. Nullable only because pre-migration rows have neither — every row written after this ships fills both, since both items are always asked. `passed` stays on the table unwritten, for historical rows. |
| `placement_results` += `difficulty_at_ask` (real) | the `b` used, so a session is replayable after difficulties are recalibrated |
| `placement_sessions` += `ability_theta`, `ability_se` (real) | the posterior summary; `inferred_level` becomes derived (§7.5) |
| new `kanji_difficulty` table | §6.4 |

Migration order is the one learned the hard way: **migrate → deploy → clean**,
never deploy-before-migrate.

## 12. Repairing accounts already damaged

**This runs before anything else ships.** The owner's account has 104 kanji in
learning and may already be affected.

**Detector.** `totalReviews` can only increase through normal review, and
placement stamps it to 1. So:

```sql
-- a card with real review history whose progress row claims one review
SELECT p.user_id, p.kanji_id, count(l.id) AS logged_reviews
FROM user_kanji_progress p
JOIN review_logs l ON l.user_id = p.user_id AND l.kanji_id = p.kanji_id
WHERE p.total_reviews = 1
GROUP BY p.user_id, p.kanji_id
HAVING count(l.id) > 1;
```

The exact signature of a placement overwrite is
`status='remembered' AND stability=21 AND difficulty=5 AND totalReviews=1`.

**Repair.** Replay `review_logs` for each affected `(user_id, kanji_id)` through
FSRS to reconstruct true state, following `scripts/replay-srs-fsrs.mjs`.

**Unrepairable cases must be reported, not guessed.** A card whose *only* history
was the placement write has nothing to replay. Those revert to `unseen` — the
honest state — rather than keeping a fabricated 21-day stability.

Take a dump first (`scripts/with-live-db.sh`, and the safety-dump precedent in
`HANDOFF.md`). This touches live learner data.

## 13. Terminology and attribution

Same subject — being accurate about the models the project uses. Owner,
2026-07-29:

> *"all of our explanations reference SRS while some time ago we refactored to
> use FSRS… We need to be transparent and accurate regarding our methods and
> models, particularly when we are using open source ones."*

1. **11 user-facing strings in `apps/mobile/app/(tabs)/progress.tsx`** say "SRS",
   including *"Your kanji are sorted into five SRS stages"*, *"The SRS interval
   has reached ~6 months"*, and a panel titled *"Quiz vs SRS"*. Several describe
   **fixed-interval** behaviour FSRS does not have — it derives scheduling from
   stability and difficulty. So the copy is inaccurate as well as misattributed.
2. **FSRS is credited nowhere.** `apps/mobile/app/about.tsx` carries a full
   KANJIDIC2 `AttributionCard` — CC BY-SA 4.0 badge, licence link, EDRDG
   acknowledgement. The data is attributed carefully and the algorithm is not.
   Add an FSRS card beside it, and to the README.
3. **`packages/db/src/schema.ts:123` says "See ACKNOWLEDGEMENTS" and no such file
   exists.** Either create it or correct the comment to point at `about.tsx`.
4. New copy from this spec and the arc spec must not inherit the wrong
   vocabulary.

## 14. Testing

Per `CLAUDE.md`: there is no `@testing-library/react-native`; jest runs in
`node`. The established pattern is a **pure function or reducer beside a thin
hook**. API integration tests authenticate with a bare `x-test-user-id` header
via `test-app.ts` — there is no `test/helpers/auth.ts`.

Everything decision-bearing here is a pure function in `packages/shared`, which
is the point:

| Unit | Test |
|---|---|
| `b_prior(features)` | known kanji → expected ordering; nulls fall back to level mean |
| `blend(b_prior, b_observed, n, k)` | `n=0` → exactly prior; `n→∞` → exactly observed |
| `updatePosterior(grid, b, correct)` | correct response shifts mass up; incorrect, down; mass sums to 1 |
| `pKnows(posterior, b)` | **excludes `c`** (§7.1) — a direct regression test on the easiest mistake |
| conservative quantile | wider posterior → strictly lower p at equal mean |
| `shouldStop(posterior, n)` | respects floor and cap; stops on CI width |
| `seedFrom(p, b)` | `p<0.85` → no write; `p=1.0` → stability exactly 21 (ceiling holds) |
| `inferredLevel(θ)` | band boundaries; agrees with item selection |
| never-overwrite | a row with `totalReviews>0` is untouched — **the B-210 regression test** |
| retest prior | widens with elapsed days; converges in fewer items than a flat prior |

Rebuild the local test database before judging API results — see
[`local-test-db.md`](../../local-test-db.md). A stale one reads ~5 extra
failures.

## 15. Needs verification before planning

Three things this design assumes and the brainstorm could not check — no local
database was running.

1. **Coverage of `grade` and `frequencyRank`.** Both nullable. KANJIDIC2 ranks
   roughly the top 2,500 against a 2,294-kanji deck, so coverage *should* be
   high — but §6.3's weights lean on it and the fallback path is only acceptable
   for a small minority.
2. **How much `review_logs` data exists.** Determines whether §6.3's regression
   is fittable at all, or whether `w` ships hand-set.
3. **How many accounts §12 finds.** Changes whether repair is a script or a
   migration.

## 16. Files

| | |
|---|---|
| Engine | `packages/shared/src/placement.ts` (56 lines, replaced) |
| Difficulty model | new, `packages/shared/src/placement-difficulty.ts` |
| Item selection | `apps/api/src/services/placement.service.ts` |
| Route | `apps/api/src/routes/placement.ts` |
| Client | `apps/mobile/app/placement.tsx`, `apps/mobile/src/stores/placement.store.ts` |
| Entry point | `apps/mobile/app/(tabs)/profile.tsx` |
| Repair precedent | `scripts/replay-srs-fsrs.mjs` |
| Terminology sweep | `apps/mobile/app/(tabs)/progress.tsx` (11 strings) |
| Attribution | `apps/mobile/app/about.tsx`, README, `packages/db/src/schema.ts:123` |

## 17. Open questions

None blocking. §15 lists three measurements to take before writing the plan; all
three change parameters, not architecture.
