# Spec 1.5 — FSRS Migration

Date: 2026-05-22
Status: Design, pending implementation plan
Predecessors: Spec 1 (Practice Loop — Plans A/B/C, shipped in B134)
Successors: Spec 2 (Buddy, the AI tutor) — reads the data layer this spec exposes

## TL;DR

Replace the SM-2 scheduler with a hand-rolled FSRS-5 implementation in
`packages/shared/src/srs.ts`. Use the per-card retrievability `R(t)` it gives
us to replace the `isRecentlyShaky` heuristic that gates the Practice Loop's
quiz leg. Migrate existing card state by **replaying** every user's
`review_logs` through the new algorithm — a one-time backfill that produces
exactly the state we'd have if FSRS had been the scheduler from day one. No
UI changes; the data layer exposes `retrievability(card, atTime)` and the
`(stability, difficulty, lapses)` shape so the Spec 2 tutor report can read
them without further plumbing.

Done pre-launch while the dataset is tiny, per the spec deck's framing.

## §1 — Scope and non-goals

### In scope

- Hand-rolled FSRS-5 scheduler in `packages/shared/src/srs.ts`. No runtime
  library dep (mirrors the existing hand-rolled SM-2 pattern).
- Clean-swap schema migration (`0024`): add `stability`, `difficulty`,
  `lapses`, `total_reviews`; drop `ease_factor`, `interval`, `repetitions`
  from `user_kanji_progress`. Augment `review_logs` with new FSRS-state
  columns; keep the existing `prev_interval`/`next_interval` for back-compat.
- One-time replay script that walks every user's `review_logs` and writes
  fresh FSRS state into `user_kanji_progress`.
- Replace the `isRecentlyShaky` Plan C heuristic with the R-based predicate:
  `R(now) < 0.85 + 0.01·(D − 5)`. The D-modulator turns quiz history into a
  compounding signal (a quiz fail raises D, which raises the per-card
  threshold, which makes the next quiz fire sooner).
- API integration (`getReviewQueue`, `submitReview`, `getReadingQueue`) and a
  type sweep across the touch-point files.
- Test coverage matching the existing SM-2 service test suite, plus FSRS-5
  reference-vector unit tests against the published paper.

### Out of scope (Spec 2 territory)

- **Surfacing `R(t)` in the UI.** No "fading" indicators on Browse, no
  retrievability percentage on the kanji-detail page. The data layer can
  produce R on demand; nothing consumes it visually in 1.5.
- **Tutor-report integration.** The shape is available (S, D, lapses, R
  computable per-row); the tutor report's own scope-down — which is already
  on the housekeeping queue — happens in its own task.
- **Per-user FSRS parameter fitting.** Everyone uses the published default
  19-element weight vector. Per-user fitting needs hundreds of reviews per
  user before it stops being noise; revisit post-launch with real data.
- **Multi-dimensional memory per card.** Writing and speaking outcomes are
  *production* tests, not meaning-recall tests; feeding them into the same
  FSRS state is a category error. They remain in their own tables. Spec 2
  decides whether to model them as separate memory dimensions.
- **Logging the quiz as a separate `review_log` event.** The existing
  client-side rating-fusion (quiz fail → `quality=1` before submit) does the
  job in one event with one FSRS update.

## §2 — Architectural decisions and rationale

Each subsection records the alternatives considered and why we picked what we
picked. Same depth as the §-headers used in the Practice Loop spec.

### 2.1 — Hand-rolled vs vendored (decision: hand-rolled)

`ts-fsrs` is the de-facto TypeScript port and would work fine. We pick
hand-rolling because (a) the existing SM-2 in `packages/shared/src/srs.ts` is
hand-rolled and we match the codebase pattern, (b) the math is bounded
(~100 LoC including types and the rating mapper), and (c) hand-rolling gives
us a clean place to expose `retrievability(card, atTime)` as a first-class
function without adapting someone else's `Card` abstraction. The downside —
no free FSRS-6 upgrade — is small pre-launch; FSRS-5 is stable.

### 2.2 — Migration: replay vs cold-start vs state-mapping (decision: replay)

We have the full review history in `review_logs` with grades, timestamps, and
response times. Replay walks each user's logs chronologically and feeds them
into FSRS, producing exactly the state we'd have if FSRS had been the
scheduler from day one. Cold-start would discard signal we already have.
State-mapping (e.g. `stability ≈ interval`) is an unverified approximation
nobody benefits from. The dataset is small enough that a one-time script is
trivial; the spec deck's "best done pre-launch while the dataset is tiny" line
is precisely the argument for this approach.

### 2.3 — Schema: clean-swap vs additive vs phased (decision: clean-swap)

Migration `0024` adds `stability`/`difficulty`/`lapses`/`total_reviews` to
`user_kanji_progress` and drops `ease_factor`/`interval`/`repetitions` in the
same migration. Pre-launch is the only window where a destructive schema
change is essentially free; post-launch the calculus flips and "additive now,
drop later" becomes the responsible answer. We take the window while it's
open. `review_logs` keeps `prev_interval`/`next_interval` for back-compat —
new code populates them from the derived value `round(-S · ln(0.9))` days so
any analytics still expecting "interval" keeps working without a sweep.

### 2.4 — Threshold modulation (decision: R(now) < 0.85 + 0.01·(D − 5))

Three options were considered for the "maybe-slipping" trigger that replaces
`isRecentlyShaky`:

- Pure `R(now) < 0.85` — clean, but throws away FSRS's per-card difficulty
  signal.
- `R(now) < 0.85 + 0.01·(D − 5)` — uses FSRS's `difficulty` as a modulator.
  Harder cards (high D) trip the quiz at slightly higher R; easier cards at
  slightly lower R. Free signal, stays inside FSRS, no category error.
- (b) plus a separate modality lift from the writing/voice tables. Adds knobs
  and a parallel signal channel that arguably belongs in Spec 2.

We pick (b). It honestly uses the data we have without bolting on a parallel
system, and — crucially — it closes a feedback loop with quiz outcomes: a
failed quiz fuses into an Again event (client-side, today), which lowers S
and raises D, which both lowers the next R(now) AND raises the per-card
threshold. The card becomes "more suspicious" until D recovers. Plain
`R < 0.85` would waste this signal.

The constants `0.85` and `0.01` live in `packages/shared/src/constants.ts`
so we can re-tune after a week of real use.

### 2.5 — Quiz-fail handling (decision: rating fusion stays client-side)

Today's client-side mechanism (`apps/mobile/src/stores/review.store.ts:253`
`failQuizLeg` rewrites the last result's `quality` to 1 before submission)
maps naturally to FSRS: quality 1 → FSRS rating 1 (Again). The API doesn't
need to know about quiz outcomes at all; it just receives a downgraded
rating. We do **not** log the quiz as a separate `review_logs` event — that
would mean two same-second FSRS updates for the same card with negligible
benefit. Quiz history continues to live in `testSessions`/`testResults`.

### 2.6 — Status label derivation (decision: port thresholds onto stability)

The existing user-visible labels (`learning` / `reviewing` / `remembered` /
`burned`) are derived today from `interval` thresholds in
`packages/shared/src/srs.ts:62-68`. We port the same thresholds onto
`stability`: `S < 7d → learning`, `S < 21d → reviewing`, `S < 180d →
remembered`, `S ≥ 180d → burned`. After running replay we'll inspect the
distribution and re-tune if the pace differs noticeably — cheap pre-launch.

## §3 — The FSRS module (`packages/shared/src/srs.ts`)

Full file replacement. The current SM-2 surface (`SrsCard`, `SrsResult`,
`calculateNextReview`, `createNewCard`) is replaced; downstream callers move
to the new types in the same commit.

### 3.1 — Types

```ts
type FsrsRating = 1 | 2 | 3 | 4  // Again | Hard | Good | Easy

interface FsrsCard {
  stability: number          // days
  difficulty: number         // 1..10, default 5
  lapses: number             // Again-count
  status: SrsStatus          // unchanged enum
  lastReviewedAt: Date | null
}

interface FsrsResult extends FsrsCard {
  nextReviewAt: Date
}
```

### 3.2 — Public functions

```ts
calculateNextReview(card: FsrsCard, rating: FsrsRating, now: Date): FsrsResult
retrievability(card: FsrsCard, atTime: Date): number       // 0..1
createNewCard(): FsrsCard
statusFromStability(stability: number): SrsStatus
ratingFromQuality(quality: 0|1|2|3|4|5): FsrsRating        // boundary mapper
```

`calculateNextReview` is the only state-mutating entry point. It:
- updates `stability` and `difficulty` per the FSRS-5 update rules,
- increments `lapses` when `rating === 1`,
- sets `lastReviewedAt = now`,
- computes `nextReviewAt` for `TARGET_RETENTION = 0.90`,
- derives the new `status` via `statusFromStability`.

Callers do not increment `lapses` themselves; that's the algorithm's job.

`retrievability(card, atTime)` returns
`exp(ln(0.9) · elapsedDays / card.stability)` for `card.stability > 0`,
or `0` when stability is 0 (unseen). Pure function, no DB, no service — the
Spec 2 bridge.

### 3.3 — Constants

```ts
DEFAULT_FSRS_WEIGHTS: readonly number[]   // 19 published values for FSRS-5
TARGET_RETENTION = 0.90                   // FSRS scheduling target (R at nextReviewAt)
MAYBE_SLIPPING_BASE = 0.85                // §2.4 — quiz-trigger threshold
MAYBE_SLIPPING_D_COEFFICIENT = 0.01       // §2.4
```

`TARGET_RETENTION` (0.90) and `MAYBE_SLIPPING_BASE` (0.85) are intentionally
different: the former is FSRS's scheduling goal at the next review's planned
date; the latter is the *lower* bar at which we treat a Good/Easy self-grade
as suspicious. Roughly, an on-time review sits at R ≈ 0.90 (above threshold,
no quiz); a meaningfully-overdue review has decayed below 0.85 (quiz fires).

### 3.4 — Rating mapping

`ratingFromQuality` collapses the SM-2 0–5 scale into FSRS's 4-bucket scheme:
`{0,1,2} → 1` (Again), `3 → 2` (Hard), `4 → 3` (Good), `5 → 4` (Easy). The
quiz-fail downgrade to `quality=1` falls through this mapping naturally.

`review_logs.quality` keeps its raw 0–5 history; we map at the API boundary
only.

## §4 — Schema migration `0024`

### 4.1 — `user_kanji_progress`

ADD:
- `stability real not null default 0` — `0` is the unseen sentinel; FSRS
  sets it on first grade.
- `difficulty real not null default 5` — the FSRS-5 midpoint.
- `lapses integer not null default 0` — incremented on every Again.
- `total_reviews integer not null default 0` — total review count;
  replaces `repetitions` as the rotation index for `getReadingQueue`.

DROP:
- `ease_factor`
- `interval`
- `repetitions`

Indexes on `user_id, next_review_at` and `user_id, status` are untouched.

### 4.2 — `review_logs`

ADD (all nullable so old rows stay valid):
- `prev_stability real`, `next_stability real`
- `prev_difficulty real`, `next_difficulty real`

KEEP `prev_interval` / `next_interval`. New FSRS-driven logs populate them
from `round(-stability · ln(0.9))` (days) so any downstream reader that
expects an interval column keeps working without a coordinated update.

### 4.3 — Application order

The migration is applied **after** the replay script's destination columns
exist (i.e. the migration runs first), then the replay populates them.

## §5 — Replay script (`scripts/replay-srs-fsrs.mjs`)

Runs locally against Supabase from the dev machine. One-shot — not part of
the API runtime, not part of CI.

### 5.1 — Algorithm

```
for each user in user_profiles:
  fetch all review_logs WHERE user_id = user.id ORDER BY reviewed_at ASC
  group by kanji_id

  for each (kanji_id, logs) in grouped:
    card = createNewCard()
    for each log in logs (chronological):
      card = calculateNextReview(
               card,
               ratingFromQuality(log.quality),
               log.reviewed_at,
             )
    upsert user_kanji_progress for (user.id, kanji_id) with:
      - stability, difficulty, lapses, status, next_review_at,
        last_reviewed_at  ← from `card`
      - total_reviews = logs.length
```

`lapses` is incremented inside `calculateNextReview` (per §3.2); the replay
loop does not touch it. `total_reviews` is not an FSRS state variable — it's
a database counter for the `getReadingQueue` rotation, populated separately
as `logs.length`.

Cards with no `review_logs` (status = unseen) are left at default initial
state — i.e. no row in `user_kanji_progress` until first review, same as
today.

### 5.2 — Flags and idempotency

- `--dry-run` prints final state for the first 10 users without writing.
- `--user <id>` scopes to one user.
- Re-running is idempotent: deterministic input (logs) → deterministic
  output (state).

### 5.3 — Verification gate

Before deploying, run replay against a **clone** of the live DB and
hand-replay 5 kanji per user. Confirm the script's output matches. Only then
apply migration 0024 to the live DB and run replay against it.

## §6 — API/service integration

### 6.1 — `srs.service.ts: submitReview`

- Map incoming `quality` (0–5) → FSRS rating (1–4) at the boundary; preserve
  raw `quality` in `review_logs`.
- Pull existing FSRS-shaped card; run `calculateNextReview`; write
  `stability`, `difficulty`, `lapses`, `total_reviews`, `next_review_at`,
  `last_reviewed_at`, `status`.
- `advanceReadingStage` is unchanged — still gates on `srsResult.status` and
  `quality ≥ 4`; the only thing that changed is how `status` is derived
  internally.

### 6.2 — `srs.service.ts: getReviewQueue`

Replace the `isRecentlyShaky` block (today's `recentLogs` fetch +
`isRecentlyShaky` filter at lines 187–207) with a per-card predicate
evaluated in-memory against already-loaded card state:

```ts
isMaybeSlipping(card, now) =
  retrievability(card, now) < MAYBE_SLIPPING_BASE +
                              MAYBE_SLIPPING_D_COEFFICIENT * (card.difficulty - 5)
```

This eliminates the unbounded `reviewLogs` fetch that's on the housekeeping
queue as a perf follow-up; it becomes moot under FSRS.

Burned-sample surprise check (`mapBurned`) stays unchanged — orthogonal to
the R signal.

### 6.3 — `srs.service.ts: getReadingQueue`

The two `selectVoicePrompt` callsites pass `r.repetitions` as the rotation
index. Repoint to `r.totalReviews`. Same behavior.

### 6.4 — `srs.service.ts: getWeakKanjiQueue`

Unchanged — it operates on `review_logs.quality` accuracy, which is still
intact.

### 6.5 — Type sweep

Replace SM-2 type imports across the API:

- `apps/api/src/cron.ts`
- `apps/api/src/services/placement.service.ts`
- `apps/api/src/services/buddy/dual-write.service.ts`
- `apps/api/src/routes/kanji.ts`

Behaviors do not change beyond type renames.

### 6.6 — Mobile

- `apps/mobile/src/components/study/GradeButtons.tsx` — verify the qualities
  it emits map cleanly. Expect no change.
- `apps/mobile/src/stores/review.store.ts` — `failQuizLeg`'s `quality=1`
  override stays as-is. No client change needed.

## §7 — Testing

### 7.1 — Unit tests (`packages/shared`)

- `calculateNextReview` against the FSRS-5 paper's published reference
  vectors. Lift 4–6 vector sequences as fixtures.
- `retrievability` table-driven across (S, elapsedDays) pairs including
  S=0 (unseen → 0), elapsed=0 (= 1), elapsed=S (= 0.9).
- `statusFromStability` boundary cases at 7, 21, 180 days.
- `ratingFromQuality` covers all six inputs.
- A small fixture per FSRS-5 published sequence (rating sequence + elapsed
  times → expected S, D after each step).

### 7.2 — Unit tests (`apps/api`)

Rewrite the existing `srs.service.ts` unit tests for FSRS. The shape of the
tests is preserved (input/expected output); the math expectations move.

### 7.3 — Integration tests

- `submitReview` end-to-end with FSRS state — exercises the boundary mapping
  and the new column writes.
- `getReviewQueue` returning correct `maybeSlipping` flags under FSRS for a
  card constructed at a known (S, D, lastReviewedAt).
- Replay script — per-kanji on a seeded fixture; whole-user against a
  seeded DB.

### 7.4 — Manual spot-check after replay

Pick 5 kanji per user against the live-DB clone. Hand-replay using the same
algorithm. Confirm the script's output matches.

## §8 — Rollout

The clean-swap migration drops columns the deployed API still reads, so
steps 5–7 form a brief maintenance window. The dataset is tiny (one
production user and any alpha testers) so the window is acceptable; no
user-facing maintenance message is required pre-launch.

1. Feature branch off `main`. All code + tests land green.
2. Prepare migration `0024` — do not apply to live DB yet.
3. Apply `0024` to a **clone** of the live DB.
4. Run replay against the clone; spot-check (§7.4).
5. **Maintenance window begins.** Apply `0024` to live DB. The deployed API
   will now fail any request that reads `ease_factor`/`interval`/
   `repetitions` — keep it short.
6. Run replay against live DB.
7. Deploy the new API. **Maintenance window ends.**
8. Cut TestFlight build B135. No UI change but confirm a Study session
   completes cleanly and a known-overdue Good/Easy review triggers the quiz
   leg on the new R-based predicate.

If steps 5–7 take longer than expected and the existing user is mid-session,
the mobile offline queue retries on the next foregrounding — no data loss.

## §9 — Risks and known unknowns

- **Default weight vector.** We lift the 19 published FSRS-5 constants
  verbatim. As a sanity check, cross-validate ours against the constants in
  `ts-fsrs` even though we don't import it.
- **Status threshold tuning.** Replay may show that S ≥ 180d is reached at
  a different pace than SM-2's interval ≥ 180d. If so, retune the four
  `statusFromStability` thresholds before merge. Cheap pre-launch.
- **`total_reviews` rotation is still a kludge.** The right vocab-rotation
  logic is "least-recently-shown vocab entry," not "count modulo entries."
  Out of scope here; carry it on the housekeeping queue.
- **No mobile rebuild is strictly required** (API-only swap), but B135 is
  cut anyway so the walkthrough lands on a coherent state.
- **Replay write volume.** For the current tiny dataset this is a few
  thousand UPDATEs at worst. If the dataset ever grows mid-Spec-1.5,
  re-evaluate batching.

## §10 — Open questions / decisions deferred to writing-plans

- Exact ordering of the implementation tasks (most likely: math + types →
  schema migration → replay script → service integration → type sweep →
  tests, but `writing-plans` formalizes this).
- Whether the replay script is checked in under `scripts/` or
  `apps/api/scripts/`. (Lean: `scripts/` at repo root, alongside
  `scripts/deploy-api.sh` and `scripts/run-migration-0023.mjs`.)
- Whether to gate the new `isMaybeSlipping` behind a feature flag for a
  side-by-side comparison window. (Lean: no — clean-swap pre-launch.)
- **`learner_knowledge_state` mirror.** `DualWriteService.recordReviewSubmissions`
  mirrors SRS state into `learner_knowledge_state` (the Buddy-side table).
  `writing-plans` must check whether that table also carries
  `ease_factor`/`interval`/`repetitions` columns and, if so, fold the
  schema change into migration `0024` rather than spawning a `0025`.
