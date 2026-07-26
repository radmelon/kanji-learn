-- Minimal Supabase `auth` shim for LOCAL DEV AND TEST ONLY.
--
-- Why this exists: 21 of the 26 migrations in packages/db/supabase/migrations
-- reference Supabase-managed objects that a plain postgres:16-alpine container
-- does not have — `auth.users` (FK target + trigger source), `auth.uid()` (used
-- by 27 RLS policies), and the `service_role` / `authenticated` roles that
-- policies are GRANTed to. Without them the migrations cannot be applied
-- locally, so `apps/api` integration tests cannot run at all.
--
-- This recreates the smallest surface those migrations actually touch. It is
-- NOT a Supabase emulator and must never run against a real Supabase project —
-- there, these objects already exist and are managed by the platform.
--
-- Runs after 01-create-test-db.sql, and applies the shim to BOTH databases:
-- container init scripts execute against POSTGRES_DB (kanji_buddy_dev) only,
-- so the test database needs an explicit \connect.

-- ── Roles (cluster-wide, so only created once) ───────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

-- ── The shim itself, applied per-database ────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;

-- Only the three columns the migrations actually use:
--   id                  → FK target for user_profiles (0003, 0017)
--   email               → read by handle_new_user() (0003, 0015)
--   raw_user_meta_data  → read by handle_new_user() for display_name
CREATE TABLE IF NOT EXISTS auth.users (
  id                 uuid PRIMARY KEY,
  email              text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Supabase resolves the current user from a request-local GUC. Tests drive the
-- API as service_role (RLS bypassed), so this only needs to be present and
-- correctly typed — it returns NULL unless a caller sets request.jwt.claim.sub.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO authenticated, service_role;

-- ── Repeat for the test database ─────────────────────────────────────────────
\connect kanji_buddy_test

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id                 uuid PRIMARY KEY,
  email              text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO authenticated, service_role;
