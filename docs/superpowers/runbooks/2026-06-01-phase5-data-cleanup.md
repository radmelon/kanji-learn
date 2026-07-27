# Phase 5 Data Cleanup Runbook (2026-06-01)

Applies: migration `0026_kanji_components.sql`, the IDS component backfill,
and the destructive old-mnemonics cleanup. Follows the FSRS clone-rehearsal
pattern (docs/superpowers/runbooks/2026-05-22-fsrs-rollout.md).

> ⚠️ **SUPERSEDED 2026-07-26.** Follow **Task 3 of
> [`2026-07-26-phase-5-plan-4.md`](../plans/2026-07-26-phase-5-plan-4.md)**, not
> this order. Two things changed:
>
> 1. **Steps 2–3 below are already done.** Migration 0026 and the IDS backfill
>    were applied to live on 2026-07-05 (2264/2294 kanji). Do not re-run them.
> 2. **Migration 0027 must be applied BEFORE the API deploy** — see the
>    ordering warning in Task 3. This runbook predates 0027 entirely.
>
> The dump/dry-run/cleanup/rollback mechanics below remain correct and are
> still the reference for those steps.

## Order of operations (historical — see the note above)

1. **Safety dump (reversible for 24h):**
   `pg_dump "$DATABASE_URL" -t mnemonics -t kanji > /tmp/phase5-safety/live-<ts>.sql`
2. ~~**Apply the column migration:**~~ ✅ **Done on live 2026-07-05.**
   `psql "$DATABASE_URL" -f packages/db/supabase/migrations/0026_kanji_components.sql`
3. ~~**Backfill components (IDS):**~~ ✅ **Done on live 2026-07-05** (2264/2294).
   `DATABASE_URL=<live> pnpm --filter @kanji-learn/db seed:backfill-components`
   Spot-check: `psql "$DATABASE_URL" -c "SELECT components FROM kanji WHERE character='持'"` → contains 扌 and 寺.
4. **Dry-run the cleanup:** `node scripts/cleanup-old-mnemonics.mjs --dry-run` → sanity-check the count.
5. **Destructive cleanup:** `node scripts/cleanup-old-mnemonics.mjs --yes` → deletes all mnemonic rows (a bare run with no flag refuses, as a safety guard).
6. **Smoke:** API `/health` 200; create one co-created hook on the RAD account; confirm it persists with `generation_method='cocreated'`.

## Clone-rehearsal (BEFORE merge — mandatory)

Restore a fresh `pg_dump` of live into a local Docker Postgres, run steps 2–5 against it,
confirm: components populated, all old rows gone, a fresh co-created insert round-trips.

## ✅ Deploy-ordering constraint — RESOLVED 2026-07-26

**This section is obsolete. The API may now be deployed on its own.**

The original constraint: Plan 2 removed two server routes the shipped mobile app
still calls (`GET /v1/mnemonics/refresh`, `POST /v1/mnemonics/:id/refresh/dismiss`),
so deploying the API alone risked a 404 against a build already in the wild. That
forced Phase 5 into a single coordinated cut and kept `main` unshippable from June.

Plan 4 Task 1 (`9fe649a`) restored both routes as **deprecated no-ops** — the GET
returns an empty list, the POST returns 200 and writes nothing. An old client can
no longer 404 against a new API, so the API deploy and the EAS build are now
independent and can happen in either order.

Two corrections to the original analysis, for the record:

- The GET caller was **already** guarded — `useRefreshDue.load` wraps it in
  try/catch (`apps/mobile/src/hooks/useMnemonics.ts:130`), so a 404 there yielded
  an empty list, not a crash.
- The unguarded `dismissRefresh` was only reachable by tapping dismiss on a
  `MnemonicCard` whose `refreshPromptAt <= now`, which no longer exists after the
  cleanup. The real exposure was one narrow window, not a general hazard.

The stubs carry a comment naming **B143** as the last build that calls them. Do
not delete them until no build in the wild predates their removal.

## Rollback

Restore the safety dump within 24h: `psql "$DATABASE_URL" < /tmp/phase5-safety/live-<ts>.sql`.
