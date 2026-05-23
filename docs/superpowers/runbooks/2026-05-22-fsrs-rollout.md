# FSRS Migration Rollout

Spec: docs/superpowers/specs/2026-05-22-fsrs-migration-design.md
Plan: docs/superpowers/plans/2026-05-22-fsrs-migration.md
Branch: spec-1.5-fsrs-migration

## Pre-rollout (on the feature branch, before merge)

- [ ] All tasks 1–9 committed; workspace typecheck clean (modulo the known social-mute.test.ts:25 pre-existing failure)
- [ ] `pnpm test` in `packages/shared` — 28/28 FSRS unit tests green
- [ ] `pnpm test` in `apps/api` — 235/235 (modulo the known social-mute pre-existing failure)
- [ ] Branch rebased onto latest `main`
- [ ] Code review pass

## Clone-rehearsal (production-shape dry run)

- [ ] Take a fresh dump of the live Supabase DB (`pg_dump` from the AWS region in use)
- [ ] Restore to a local Postgres clone
- [ ] Apply `0024_fsrs_migration.sql` to the clone:
      `psql -d kanji_learn_clone -f packages/db/supabase/migrations/0024_fsrs_migration.sql`
- [ ] Run replay against the clone (dry-run first):
      `DATABASE_URL=<clone-conn-string> ./packages/db/node_modules/.bin/tsx scripts/replay-srs-fsrs.mjs --dry-run`
- [ ] Inspect dry-run output — sanity-check S/D/lapses per spot-checked user
- [ ] Run full replay (writes):
      `DATABASE_URL=<clone-conn-string> ./packages/db/node_modules/.bin/tsx scripts/replay-srs-fsrs.mjs`
- [ ] Spot-check 5 kanji per user: query `review_logs` for that user/kanji, hand-replay in a Node REPL using `calculateNextReview` from `packages/shared/src/srs.ts`, confirm S/D/lapses match the row in `user_kanji_progress`
- [ ] Spin up the API locally against the clone DB; hit `GET /v1/review/queue` for a known user; confirm the response shape includes `maybeSlipping`, no errors
- [ ] Verify the recreated materialized view `kanji_mastery_view` exists, returns rows, AND has non-zero `interval_days` values (the replay script auto-refreshes the view at the end; if `interval_days` is all 0 the refresh didn't run):
      `psql -d kanji_learn_clone -c "SELECT MIN(interval_days), AVG(interval_days), MAX(interval_days) FROM kanji_mastery_view"`
- [ ] Optional: idempotency check — re-run the replay against the same clone, verify state doesn't change (`SELECT MD5(string_agg(stability::text || difficulty::text, '|' ORDER BY user_id, kanji_id)) FROM user_kanji_progress` should match before and after the second run)

## Merge to `main`

Only after rehearsal passes — keeping the branch isolated until rehearsal validates the migration + replay protects against fix-forward on `main` if anything explodes.

- [ ] Open PR from `spec-1.5-fsrs-migration` → `main`
- [ ] Squash or fast-forward merge per project convention
- [ ] Confirm `main` is at the post-merge SHA before proceeding to live rollout (`./scripts/deploy-api.sh` deploys from current `main`)

## Production rollout — MAINTENANCE WINDOW OPENS

Estimated time: 5–10 minutes for the current dataset size.

- [ ] Apply migration 0024 to live DB:
      `psql "$LIVE_DATABASE_URL" -f packages/db/supabase/migrations/0024_fsrs_migration.sql`
- [ ] Confirm `BEGIN/COMMIT` block returned `COMMIT` cleanly
- [ ] Run replay against live DB:
      `DATABASE_URL=$LIVE_DATABASE_URL ./packages/db/node_modules/.bin/tsx scripts/replay-srs-fsrs.mjs`
- [ ] Confirm replay completed without errors
- [ ] Deploy the API: `./scripts/deploy-api.sh`
- [ ] Wait for App Runner rollout to complete (poll the AWS console, ~5–10 min from trigger). Console URL:
      https://us-east-1.console.aws.amazon.com/apprunner/home?region=us-east-1
- [ ] Hit `GET https://73x3fcaaze.us-east-1.awsapprunner.com/v1/review/status` for a known user — confirm a response

## MAINTENANCE WINDOW CLOSES

## Mobile

- [ ] Cut TestFlight build B135:
      `cd apps/mobile && eas build --platform ios --profile production --non-interactive`
- [ ] Submit:
      `eas submit --platform ios --latest --non-interactive`
- [ ] Wait for Apple processing (email + appearance in TestFlight UI)

## On-device verification (once B135 lands)

- [ ] A Study session completes without error
- [ ] On a known-overdue Good/Easy review (where R(now) should be ~0.80), the quiz leg fires
- [ ] On a same-day Easy review (R(now) = 1.0), the quiz leg does NOT fire
- [ ] The burned-sample surprise check still triggers the quiz
- [ ] Session Complete's modality-breakdown row renders correctly
- [ ] The kanji-detail page renders `srsInterval` as an integer day count (no "3.175..." regressions — fixed in commit 65e6278)
- [ ] App Runner logs show no FSRS-related errors

## Rollback (if needed within the maintenance window)

Migration 0024 is reversible by hand SQL but data-lossy:

```sql
BEGIN;
ALTER TABLE user_kanji_progress
  ADD COLUMN ease_factor real NOT NULL DEFAULT 2.5,
  ADD COLUMN interval integer NOT NULL DEFAULT 0,
  ADD COLUMN repetitions integer NOT NULL DEFAULT 0;
ALTER TABLE user_kanji_progress
  DROP COLUMN stability,
  DROP COLUMN difficulty,
  DROP COLUMN lapses,
  DROP COLUMN total_reviews;
ALTER TABLE review_logs
  DROP COLUMN prev_stability,
  DROP COLUMN next_stability,
  DROP COLUMN prev_difficulty,
  DROP COLUMN next_difficulty;
DROP MATERIALIZED VIEW IF EXISTS kanji_mastery_view CASCADE;
-- Materialized view would need to be recreated from its original 0009
-- definition manually if rollback persists.
COMMIT;
```

After rollback you must also re-deploy the pre-FSRS API image. The
`ease_factor`/`interval`/`repetitions` defaults will leave every existing
card looking like an unseen new card — you'd need to restore from the
clone-rehearsal dump to recover real state.

**Do not trust the rollback path to preserve user state — it preserves
availability, not data.** This is acceptable pre-launch with a tiny dataset.

## Known follow-ups for Spec 2 (or a polish branch)

Discovered during the migration, deliberately deferred:

1. **Orphan `UserKanjiProgress` interface** at `packages/shared/src/types.ts:36-48` still
   carries SM-2 fields (`easeFactor`, `interval`, `repetitions`). No consumers found in
   the workspace (pre-existing dead code surfaced by Task 8). Delete in a cleanup pass.

2. **`srsEaseFactor` field name footgun.** `apps/api/src/routes/kanji.ts:230` and
   `apps/mobile/app/kanji/[id].tsx:75` both type a field called `srsEaseFactor` but
   the value is now sourced from FSRS `difficulty` (1–10 absolute) rather than the
   prior SM-2 ease factor (1.3–2.5 multiplier). The field is typed but never
   rendered. Either:
   - Rename to `srsDifficulty` in both files in a coordinated change, OR
   - Drop the field from the API response entirely (mobile won't break — it's
     read but not displayed).

3. **FSRS-5 fidelity sweep.** `packages/shared/src/srs.ts` has four deliberate
   simplifications from canonical FSRS-5 (documented inline in the algorithm
   doc-block). First-review cross-validates against ts-fsrs to 8 decimals;
   subsequent-review behavior diverges by up to ~28% in S and ~20% in D.
   Revisit if community benchmarks or per-user parameter fitting (Spec 2's
   own follow-up territory) ever matter.

4. **Pre-existing `social-mute.test.ts:25` typecheck error.** Not migration-caused
   but it's the only remaining `pnpm typecheck` failure across the workspace.
   Roll into a Spec 2 housekeeping pass.

## Operational notes

- The replay script imports TypeScript from `packages/shared/src/srs.ts` directly
  via the tsx ESM loader. Two invocation forms both work:
  - `./packages/db/node_modules/.bin/tsx scripts/replay-srs-fsrs.mjs` (workspace binary)
  - `node --import tsx/esm scripts/replay-srs-fsrs.mjs` (loader form)
- `DATABASE_URL` must be the direct Postgres connection string (NOT the Supabase REST URL).
- The replay is idempotent — safe to re-run if needed.
- `--dry-run` prints the first 10 users' computed state without writing.
- `--user <uuid>` scopes to a single user for spot-checks.
- The replay auto-refreshes `kanji_mastery_view` at the end (the migration
  populates the view inside its transaction before any replay runs, so without
  the refresh the view's `interval_days` would be 0 for every row).
- SSL: the script defaults to `ssl: 'require'` (matching prod Supabase) but
  honors `?sslmode=disable` in the URL for local rehearsal DBs without TLS.

## Rehearsal findings (already addressed)

Clone-rehearsal against a fresh `pg_dump` of the live DB (4 users, 742 progress
rows, 2857 review_logs) caught three correctness bugs that the unit/integration
tests didn't:

- **`ON CONFLICT ON CONSTRAINT user_kanji_unique_idx`** — fails because that's
  a unique INDEX, not a constraint. Fixed in commit `9af2b83` (replay script
  now uses `ON CONFLICT (user_id, kanji_id)`).
- **`ssl: 'require'` hardcoded** — broke local DB rehearsal. Fixed in commit
  `08a85bf` (now honors `sslmode=disable` in the URL).
- **`kanji_mastery_view` stale after migration** — populated during the
  migration transaction when stability is still 0; needs a post-replay
  REFRESH. Fixed in commit `08a85bf`.

Rehearsal re-run end-to-end after fixes: replay completes in ~1s, spot-check
matches dry-run exactly, idempotency confirmed (second replay produces
identical state). Status distribution after replay:
learning=78, reviewing=107, remembered=383, burned=174 (total 742).

The rehearsal is the contract: do not skip it for the live rollout. Each of
the three bugs above would have shown up in the live maintenance window
otherwise.
