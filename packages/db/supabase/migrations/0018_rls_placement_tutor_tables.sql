-- Migration 0018: Enable RLS + policies on the last 5 public tables
-- Run order: 18
--
-- Tables covered (all previously had `rowsecurity = false`):
--   placement_sessions, placement_results, tutor_shares, tutor_notes,
--   tutor_analysis_cache
--
-- Policy pattern mirrors migration 0009: authenticated users scoped to their
-- own rows via auth.uid(); service_role given explicit full access so API
-- writes work even under strict-role configurations.
--
-- Tutor notes are SELECT-only for the owning student — tutors aren't Supabase
-- auth users (they access via opaque share token), so all tutor writes go
-- through the API's service role and don't need a separate policy. The
-- student gets read access via the subquery into tutor_shares.

BEGIN;

-- ─── placement_sessions ─────────────────────────────────────────────────────
ALTER TABLE public.placement_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own placement_sessions"
  ON public.placement_sessions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage placement_sessions"
  ON public.placement_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── placement_results ──────────────────────────────────────────────────────
-- Scoped via session_id → placement_sessions.user_id
ALTER TABLE public.placement_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own placement_results"
  ON public.placement_results
  FOR SELECT
  TO authenticated
  USING (
    session_id IN (
      SELECT id FROM public.placement_sessions WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage placement_results"
  ON public.placement_results
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── tutor_shares ───────────────────────────────────────────────────────────
ALTER TABLE public.tutor_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own tutor_shares"
  ON public.tutor_shares
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage tutor_shares"
  ON public.tutor_shares
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── tutor_notes ────────────────────────────────────────────────────────────
-- Student (share owner) gets read access only. Tutor writes flow through
-- service_role via the API; tutors authenticate by opaque share token, not
-- by Supabase auth, so no separate tutor policy is possible at the DB layer.
ALTER TABLE public.tutor_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students read own tutor_notes"
  ON public.tutor_notes
  FOR SELECT
  TO authenticated
  USING (
    share_id IN (
      SELECT id FROM public.tutor_shares WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage tutor_notes"
  ON public.tutor_notes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── tutor_analysis_cache ───────────────────────────────────────────────────
-- Server-populated. Student reads only; API writes via service_role.
ALTER TABLE public.tutor_analysis_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own tutor_analysis_cache"
  ON public.tutor_analysis_cache
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage tutor_analysis_cache"
  ON public.tutor_analysis_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
