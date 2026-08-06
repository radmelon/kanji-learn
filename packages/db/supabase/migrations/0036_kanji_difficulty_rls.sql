-- Migration 0036: close the last table without RLS
-- Run order: 36
--
-- Flagged by the Supabase database linter 2026-08-06:
--   "Table public.kanji_difficulty is public, but RLS has not been enabled."
--
-- kanji_difficulty was the ONLY public table without RLS — 38 of 39 had it.
-- Not a category gap; one table missed when 0009 and 0018 swept the rest.
--
-- ⚠️ WHY THIS IS MORE THAN A LINTER TICK. `anon` and `authenticated` hold
-- INSERT, UPDATE, DELETE and TRUNCATE on this table. So do they on every other
-- table — it is the Supabase default grant on the public schema — but
-- everywhere else RLS makes them inert, because a policy only permits what it
-- permits. `kanji` carries the identical grants and exactly one policy
-- (kanji_public_select, SELECT only), so its write grants cannot be used.
--
-- Here there was no RLS, so nothing neutralised them. The anon key ships inside
-- the mobile app — that is what an anon key is for — and this table is reachable
-- through PostgREST. Its 2,294 rows are the IRT parameters the placement test
-- scores against (placement.service.ts reads b and reading_offset). Rewriting or
-- truncating them would not leak anything; it would silently corrupt every
-- learner's placement result. Integrity and availability, not disclosure.
--
-- NO anon/authenticated POLICY IS ADDED, deliberately — unlike kanji, which
-- needs a public SELECT. Verified 2026-08-06 before writing this:
--   * the API connects as `postgres`, which has rolbypassrls = t, and
--     service_role bypasses too — so RLS does not apply to any server path;
--   * apps/mobile contains ZERO `.from(` calls; the client reads no table
--     directly, everything goes through the API;
--   * nothing outside placement.service.ts and the test suite touches it.
-- Reference data the client never reads directly should be closed entirely.
--
-- The service_role policy below is belt-and-braces, matching 0018's reasoning:
-- service_role already bypasses RLS, but the explicit grant keeps API writes
-- working "even under strict-role configurations."

BEGIN;

-- ─── kanji_difficulty ───────────────────────────────────────────────────────
-- Server-only reference data. No client role gets any access.
ALTER TABLE public.kanji_difficulty ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage kanji_difficulty"
  ON public.kanji_difficulty
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
