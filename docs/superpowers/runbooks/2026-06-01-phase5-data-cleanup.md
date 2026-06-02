# Phase 5 Data Cleanup Runbook (2026-06-01)

Applies: migration `0026_kanji_components.sql`, the IDS component backfill,
and the destructive old-mnemonics cleanup. Follows the FSRS clone-rehearsal
pattern (docs/superpowers/runbooks/2026-05-22-fsrs-rollout.md).

## Order of operations (LIVE — only at the coordinated Phase 5 cut)

1. **Safety dump (reversible for 24h):**
   `pg_dump "$DATABASE_URL" -t mnemonics -t kanji > /tmp/phase5-safety/live-<ts>.sql`
2. **Apply the column migration:**
   `psql "$DATABASE_URL" -f packages/db/supabase/migrations/0026_kanji_components.sql`
3. **Backfill components (IDS):**
   `DATABASE_URL=<live> pnpm --filter @kanji-learn/db seed:backfill-components`
   Spot-check: `psql "$DATABASE_URL" -c "SELECT components FROM kanji WHERE character='持'"` → contains 扌 and 寺.
4. **Dry-run the cleanup:** `node scripts/cleanup-old-mnemonics.mjs --dry-run` → sanity-check the count.
5. **Destructive cleanup:** `node scripts/cleanup-old-mnemonics.mjs --yes` → deletes all mnemonic rows (a bare run with no flag refuses, as a safety guard).
6. **Smoke:** API `/health` 200; create one co-created hook on the RAD account; confirm it persists with `generation_method='cocreated'`.

## Clone-rehearsal (BEFORE merge — mandatory)

Restore a fresh `pg_dump` of live into a local Docker Postgres, run steps 2–5 against it,
confirm: components populated, all old rows gone, a fresh co-created insert round-trips.

## ⚠️ Deploy-ordering constraint (cross-package)

Plan 2 **removes** two server routes the *currently-shipped* mobile app still calls:
`GET /v1/mnemonics/refresh` and `POST /v1/mnemonics/:id/refresh/dismiss`.
The mobile `dismissRefresh` call (`apps/mobile/src/hooks/useMnemonics.ts`, used by
`MnemonicCard` in the Journal tab) has **no try/catch**, so it would throw an
unhandled rejection on a 404 if this API deploys ahead of the mobile change.

**Therefore: do NOT deploy this API to production before Plan 4 ships the mobile
build that removes `useRefreshDue` + the `MnemonicNudgeSheet`/refresh UI.** Phase 5
is a single coordinated cut (API + EAS build together) — deploy the API and submit
the mobile build in the same release window, never the API alone.

## Rollback

Restore the safety dump within 24h: `psql "$DATABASE_URL" < /tmp/phase5-safety/live-<ts>.sql`.
