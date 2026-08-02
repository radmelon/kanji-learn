# Provisioning the local test database

Written 2026-07-26, after finding that `apps/api` integration tests could not
run at all on a fresh machine and nothing in the repo explained how to fix it.

## The short version

```bash
docker compose up -d postgres
psql "postgresql://kanji:kanji@localhost:5433/kanji_buddy_dev" -f docker/postgres-init/02-auth-shim.sql
npx drizzle-kit push --config=<a config pointing at kanji_buddy_test>
psql "postgresql://kanji:kanji@localhost:5433/kanji_buddy_test" \
  -f packages/db/supabase/migrations/0009_rls_service_role_policies.sql \
  -f packages/db/supabase/migrations/0016_add_learner_identity_user_profiles_fk.sql \
  -f packages/db/supabase/migrations/0018_rls_placement_tutor_tables.sql \
  -f packages/db/supabase/migrations/0021_push_tokens_and_mate_mute.sql \
  -f packages/db/supabase/migrations/0025_buddy_nudges_dedupe_indexes.sql \
  -f packages/db/supabase/migrations/0030_weekly_buddy_review.sql \
  -f packages/db/supabase/migrations/0031_buddy_day_pass_tracking.sql \
  -f packages/db/supabase/migrations/0032_notebook.sql \
  -f packages/db/supabase/migrations/0033_met_buddy_at.sql \
  -f packages/db/drizzle/0007_rls.sql \
  -f packages/db/drizzle/0010_rls_phase0_tables.sql
pnpm --filter @kanji-learn/api test
```

**`0016` was missing from this list until 2026-07-31, and that alone accounted
for one of the "permanent" failures.** `drizzle-kit push` builds the test
database from `schema.ts`, where `learnerIdentity.learnerId` is declared as a
bare primary key with no `.references()`. Production gets the FK from migration
`0016`; the test database never did. So `user-delete.test.ts` — which asserts
that deleting a `user_profiles` row cascades into `learner_identity` — failed,
left the row behind, and every subsequent run died on
`duplicate key value violates unique constraint "learner_identity_pkey"`.
It read as a fixture bug and was in fact a missing constraint.

**If `0016` errors with a foreign-key violation**, the database already holds
orphaned `learner_identity` rows from runs that failed this way. Clear them
first — this is a local test database, so deleting fixture debris is safe:

```bash
psql "postgresql://kanji:kanji@localhost:5433/kanji_buddy_test?sslmode=disable" \
  -c "delete from learner_identity li where not exists (select 1 from user_profiles up where up.id = li.learner_id);"
```

Result as of 2026-07-26: **287 of 293 tests pass.** The 6 residual failures are
documented at the bottom — they are environment gaps, not product bugs.

Result as of 2026-08-02: **446 of 448 pass, 2 skipped, zero failures**, after
the repair below.

### 🛑 Re-running that migration list on an existing DB makes things WORSE

**Learned the hard way 2026-08-02, mid-session.** Those files open with `BEGIN`
and are not idempotent. On a database that already has them, the first
`CREATE POLICY` hits *"policy … already exists"*, the transaction aborts, and
**every `ALTER TABLE … FORCE ROW LEVEL SECURITY` that succeeded before the
error is rolled back with it.** `psql` without `-v ON_ERROR_STOP=1` prints the
error in the middle of a wall of output and exits **0**, so a loop over the
list reports every file "ok" while quietly stripping protection.

Observed: `rls-coverage.test.ts` went from **4 unprotected tables to 7** as a
direct result of re-applying the list to "fix" it.

**If the RLS coverage test is failing, do not re-run the migrations. Repair the
state directly** — this is a local test database, and the invariant the test
asserts is simply enable + force on every public table:

```bash
psql "postgresql://kanji:kanji@localhost:5433/kanji_buddy_test?sslmode=disable" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND (c.relrowsecurity = false OR c.relforcerowsecurity = false)
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t);
    RAISE NOTICE 'protected %', t;
  END LOOP;
END $$;
SQL
```

Safe because the test role (`kanji`) has `rolbypassrls` — confirm with
`SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'kanji'` before
forcing RLS anywhere, or every test that writes will start failing instead.

**Why this matters beyond the annoyance:** on 2026-08-01 a session recorded the
`placement-service` B-210 failure as *"confirmed pre-existing"* — true, but it
read as a standing product defect. It was **this**: a stale test database. Once
the migration list and RLS were restored it passed on a clean tree and with
changes applied. A red lane that is really an environment gap does not stay
inert; it gets reasoned about as product state.

## Why it is not just "run the migrations"

Three things bite, in order.

**1. The migrations need Supabase.** 21 of the 26 files in
`packages/db/supabase/migrations/` reference `auth.users` (FK target and
trigger source), `auth.uid()` (27 RLS policies), or the `service_role` /
`authenticated` roles. A plain `postgres:16-alpine` container has none of
them, so those migrations abort immediately.

`docker/postgres-init/02-auth-shim.sql` creates the smallest surface that
actually gets touched: the `auth` schema, an `auth.users` table with the three
columns the migrations use (`id`, `email`, `raw_user_meta_data`), an
`auth.uid()` function, and the three roles. With the shim in place, 23 of 26
migrations apply.

Container init scripts only run against an **empty** data directory, so an
existing volume needs the shim applied by hand — that's the `psql -f` line
above. Fresh volumes pick it up automatically.

**2. There are two parallel migration histories.** This is the part that
surprises people:

| Directory | Files | Contains |
|---|---|---|
| `packages/db/supabase/migrations/` | 26 (`0001`–`0027`) | Hand-written SQL, RLS policies, expression indexes |
| `packages/db/drizzle/` | 14 (`0000`–`0013`) | drizzle-kit generated |

Four tables — `friendships`, `learner_profiles`, `learner_identity`,
`buddy_nudges` — are created **only** in the drizzle set, so the supabase set
alone leaves dangling references. Reconstructing the true historical
interleaving of the two is guesswork.

For a *test* database you don't need the history, only the end state, so the
reliable move is `drizzle-kit push` straight from `schema.ts`.

> ⚠️ **Never `push` with the repo's `packages/db/drizzle.config.ts`.** It reads
> `process.env.DATABASE_URL`, which points at **live Supabase**. Use a config
> with the test URL hardcoded, and run it with `env -u DATABASE_URL`.

> ⚠️ **`push` only works against a FRESH database** (found 2026-08-01). Once
> migration `0025`'s expression indexes exist, drizzle-kit 0.22.8 introspection
> crashes with a ZodError on `buddy_nudges_streak_dedupe` — it cannot parse an
> index column that is an expression (`expression: null`). On a database that
> has already been provisioned, skip the push and verify schema currency
> directly instead: check the newest tables/columns in `information_schema`,
> then re-apply any new migration files, which are written to be idempotent.

**3. Push cannot express everything.** `schema.ts` carries tables, columns and
plain indexes — but not RLS policies, and not migration 0025's partial unique
indexes, whose targets are SQL expressions (`action_payload->>'milestone'`)
rather than columns. Those must be layered on afterwards from the SQL files,
which is the last `psql` command above.

## Running a one-off node script against a database

Two things bite every time, and both were rediscovered by hand on 2026-07-29
and again on 2026-07-30. They are not specific to the test DB, but this is the
doc people actually open when they need to connect to one.

**1. The local container has no TLS — append `?sslmode=disable`.**

```bash
TEST_DATABASE_URL='postgresql://kanji:kanji@localhost:5433/kanji_buddy_test?sslmode=disable'
```

The `postgres` npm client defaults to `ssl: 'require'`, so without this the
connection fails against Docker Postgres while working fine against Supabase.
Every script in the repo that connects — `replay-srs-fsrs.mjs`,
`cleanup-old-mnemonics.mjs`, `detect-placement-damage.mjs`,
`repair-placement-damage.mjs` — already branches on it:

```js
const sslDisabled = /[?&]sslmode=disable\b/.test(dbUrl)
const sql = postgres(dbUrl, { ssl: sslDisabled ? false : 'require', max: 5 })
```

Copy that line into any new script rather than hardcoding either value. It was
previously documented only in
[`superpowers/runbooks/2026-05-22-fsrs-rollout.md`](superpowers/runbooks/2026-05-22-fsrs-rollout.md),
which is not a file anyone finds while trying to connect to a database.

**2. `--import tsx/esm` does not resolve in this workspace.** pnpm does not
hoist `tsx` to the root `node_modules`, so the documented-everywhere-else form
fails here. Use the workspace copy:

```bash
node --import ./packages/db/node_modules/tsx/dist/esm/index.cjs scripts/<script>.mjs
```

This matters most inside a **git worktree**, where root `node_modules` may be
absent entirely.

**For live data, never pass the URL yourself** — use the wrapper, which loads
`DATABASE_URL` from `packages/db/.env` without printing it:

```bash
./scripts/with-live-db.sh node --import ./packages/db/node_modules/tsx/dist/esm/index.cjs scripts/<script>.mjs
```

Note that `with-live-db.sh` resolves `packages/db/.env` **relative to its own
location**. Run it from a worktree and it looks for the worktree's copy, which
is gitignored and therefore absent by design — copy the file in for the
duration of the task, then delete it.

## The test DB holds 7 kanji, not the full corpus

`drizzle-kit push` creates the schema; it does not seed reference data. So
`kanji` has **7 rows** locally against **2294** in production, and any test whose
behaviour depends on corpus size is either meaningless or impossible here.

Found on 2026-07-30 by the placement work: `selectNextItems` orders candidates by
`ABS(b - theta)`, takes the nearest `CANDIDATE_POOL_SIZE = 20`, then shuffles that
pool. With 7 kanji the pool swallows the entire corpus, so every `theta` returns
the same candidate set and the shuffle decides the outcome — a test asserting
"picks items near theta" passes or fails at random. That test now checks the
precondition and skips with an explanatory message rather than flaking; it starts
running for real as soon as the corpus is seeded.

If you add tests that depend on realistic reference data — difficulty spread,
distractor pools, level distributions — seed `kanji` first or assert the
precondition explicitly. A silently-passing test on a 7-row corpus is worse than
a skipped one.

## Known residual failures (6)

None are caused by application code; all are provisioning gaps.

**RLS coverage (1 test).** `rls-coverage.test.ts` requires every user-data
table to have RLS both **ENABLED and FORCED**. Six tables end up enabled but
not forced: `placement_results`, `placement_sessions`, `tutor_analysis_cache`,
`tutor_notes`, `tutor_shares`, `user_push_tokens`.

The cause is worth a look on its own: **migration 0018 contains zero
occurrences of `FORCE`** — it only enables. So either the live database had
FORCE applied out-of-band (schema drift the migrations don't capture), or this
test has never passed against a database built purely from migrations. Not
resolved here, because "just add FORCE" would change production security
semantics and deserves a deliberate decision.

**Nudge dedupe (4 tests)** in `nudge-rule-engine.test.ts` and
`buddy-push-trigger.test.ts`, plus **user-delete cascade (1 test)**. Consistent
with the same provisioning differences; not root-caused.

## Improving this

The honest end state is a single `pnpm db:setup:test` script that does all of
the above. It was not written here because the dual-history question above
should be settled first — ideally by collapsing to one migration system.
