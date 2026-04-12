-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0010: Row-Level Security for Phase 0 tables
--
-- 0008_phase0_foundation.sql introduced 17 new user-owned tables but did not
-- enable RLS on any of them, leaving them exposed via the Supabase REST API
-- (PostgREST) to anon and authenticated roles. Drizzle does not model RLS in
-- schema.ts, so drizzle-kit's generated 0008 had no way to know.
--
-- This migration closes that gap using the same pattern as 0007:
--
--   ENABLE ROW LEVEL SECURITY + FORCE ROW LEVEL SECURITY, no policies
--                  → default deny for every role except postgres
--
-- The API connects as the `postgres` superuser which has the BYPASSRLS
-- attribute, so Drizzle queries in the API are completely unaffected. The
-- mobile client only ever uses supabase.auth.* (sign in / session) and never
-- queries data tables via PostgREST, so no client behavior changes either.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── buddy_conversations (deny all) ──────────────────────────────────────────
ALTER TABLE buddy_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE buddy_conversations FORCE ROW LEVEL SECURITY;

-- ─── buddy_llm_telemetry (deny all) ──────────────────────────────────────────
ALTER TABLE buddy_llm_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE buddy_llm_telemetry FORCE ROW LEVEL SECURITY;

-- ─── buddy_llm_usage (deny all) ──────────────────────────────────────────────
ALTER TABLE buddy_llm_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE buddy_llm_usage FORCE ROW LEVEL SECURITY;

-- ─── buddy_nudges (deny all) ─────────────────────────────────────────────────
ALTER TABLE buddy_nudges ENABLE ROW LEVEL SECURITY;
ALTER TABLE buddy_nudges FORCE ROW LEVEL SECURITY;

-- ─── learner_app_grants (deny all) ───────────────────────────────────────────
ALTER TABLE learner_app_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_app_grants FORCE ROW LEVEL SECURITY;

-- ─── learner_connections (deny all) ──────────────────────────────────────────
ALTER TABLE learner_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_connections FORCE ROW LEVEL SECURITY;

-- ─── learner_identity (deny all) ─────────────────────────────────────────────
ALTER TABLE learner_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_identity FORCE ROW LEVEL SECURITY;

-- ─── learner_knowledge_state (deny all) ──────────────────────────────────────
ALTER TABLE learner_knowledge_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_knowledge_state FORCE ROW LEVEL SECURITY;

-- ─── learner_memory_artifacts (deny all) ─────────────────────────────────────
ALTER TABLE learner_memory_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_memory_artifacts FORCE ROW LEVEL SECURITY;

-- ─── learner_profile_universal (deny all) ────────────────────────────────────
ALTER TABLE learner_profile_universal ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_profile_universal FORCE ROW LEVEL SECURITY;

-- ─── learner_profiles (deny all) ─────────────────────────────────────────────
ALTER TABLE learner_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_profiles FORCE ROW LEVEL SECURITY;

-- ─── learner_state_cache (deny all) ──────────────────────────────────────────
ALTER TABLE learner_state_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_state_cache FORCE ROW LEVEL SECURITY;

-- ─── learner_timeline_events (deny all) ──────────────────────────────────────
ALTER TABLE learner_timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_timeline_events FORCE ROW LEVEL SECURITY;

-- ─── shared_goals (deny all) ─────────────────────────────────────────────────
ALTER TABLE shared_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_goals FORCE ROW LEVEL SECURITY;

-- ─── study_log_entries (deny all) ────────────────────────────────────────────
ALTER TABLE study_log_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_log_entries FORCE ROW LEVEL SECURITY;

-- ─── study_plan_events (deny all) ────────────────────────────────────────────
ALTER TABLE study_plan_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_plan_events FORCE ROW LEVEL SECURITY;

-- ─── study_plans (deny all) ──────────────────────────────────────────────────
ALTER TABLE study_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_plans FORCE ROW LEVEL SECURITY;
