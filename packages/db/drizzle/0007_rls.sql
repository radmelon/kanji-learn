-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0007: Row-Level Security
--
-- Goal: Ensure the Supabase REST API (anon / authenticated roles) cannot read
-- or write any user-owned data. Only the `kanji` reference table is public.
--
-- NOTE: The API's DATABASE_URL connects as the `postgres` superuser which has
-- the BYPASSRLS attribute — so Drizzle queries in the API are completely
-- unaffected by these policies.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── kanji (public read-only) ─────────────────────────────────────────────────
ALTER TABLE kanji ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanji FORCE ROW LEVEL SECURITY;

-- Allow anyone (anon or authenticated Supabase role) to SELECT kanji.
-- All other operations (INSERT/UPDATE/DELETE) are implicitly denied.
CREATE POLICY "kanji_public_select"
  ON kanji
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ─── user_profiles (deny all) ────────────────────────────────────────────────
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles FORCE ROW LEVEL SECURITY;
-- No policies → default deny for all roles except postgres (BYPASSRLS).

-- ─── user_kanji_progress (deny all) ──────────────────────────────────────────
ALTER TABLE user_kanji_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_kanji_progress FORCE ROW LEVEL SECURITY;

-- ─── review_sessions (deny all) ──────────────────────────────────────────────
ALTER TABLE review_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_sessions FORCE ROW LEVEL SECURITY;

-- ─── review_logs (deny all) ──────────────────────────────────────────────────
ALTER TABLE review_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_logs FORCE ROW LEVEL SECURITY;

-- ─── mnemonics (deny all) ────────────────────────────────────────────────────
ALTER TABLE mnemonics ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemonics FORCE ROW LEVEL SECURITY;

-- ─── daily_stats (deny all) ──────────────────────────────────────────────────
ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_stats FORCE ROW LEVEL SECURITY;

-- ─── interventions (deny all) ────────────────────────────────────────────────
ALTER TABLE interventions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interventions FORCE ROW LEVEL SECURITY;

-- ─── writing_attempts (deny all) ─────────────────────────────────────────────
ALTER TABLE writing_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE writing_attempts FORCE ROW LEVEL SECURITY;

-- ─── voice_attempts (deny all) ───────────────────────────────────────────────
ALTER TABLE voice_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_attempts FORCE ROW LEVEL SECURITY;

-- ─── kl_test_sessions (deny all) ─────────────────────────────────────────────
ALTER TABLE kl_test_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kl_test_sessions FORCE ROW LEVEL SECURITY;

-- ─── kl_test_results (deny all) ──────────────────────────────────────────────
ALTER TABLE kl_test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE kl_test_results FORCE ROW LEVEL SECURITY;

-- ─── friendships (deny all) ──────────────────────────────────────────────────
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships FORCE ROW LEVEL SECURITY;
