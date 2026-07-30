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
  -f packages/db/supabase/migrations/0018_rls_placement_tutor_tables.sql \
  -f packages/db/supabase/migrations/0021_push_tokens_and_mate_mute.sql \
  -f packages/db/supabase/migrations/0025_buddy_nudges_dedupe_indexes.sql \
  -f packages/db/drizzle/0007_rls.sql \
  -f packages/db/drizzle/0010_rls_phase0_tables.sql
pnpm --filter @kanji-learn/api test
```

Result as of 2026-07-26: **287 of 293 tests pass.** The 6 residual failures are
documented at the bottom — they are environment gaps, not product bugs.

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
