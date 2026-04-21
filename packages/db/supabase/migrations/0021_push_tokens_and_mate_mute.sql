-- Migration 0021: Multi-device push tokens + per-friendship notification mute
-- Run order: 21
--
-- Replaces the single user_profiles.push_token column with a user_push_tokens
-- table so a user signed in on multiple devices can receive pushes on each.
-- Stale tokens are pruned synchronously when Expo returns DeviceNotRegistered.
--
-- Adds requester_notify_of_activity and addressee_notify_of_activity to
-- friendships so each side of a friendship controls whether they get push
-- notifications for the other's activity (directional mute, per the spec).
--
-- RLS pattern mirrors migration 0018: authenticated users scoped to their
-- own rows via auth.uid(); service_role gets explicit full access so API
-- fan-out / pruning works under strict-role configurations.

BEGIN;

-- ─── user_push_tokens ───────────────────────────────────────────────────────
CREATE TABLE public.user_push_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  token       text NOT NULL,
  platform    text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_push_tokens_user_token_idx UNIQUE (user_id, token)
);

CREATE INDEX user_push_tokens_user_id_idx ON public.user_push_tokens(user_id);

-- Enable + FORCE RLS so even a table owner is subject to policies (matches
-- the project-wide default-deny posture verified by rls-coverage.test.ts).
ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_push_tokens FORCE ROW LEVEL SECURITY;

-- Users manage their own tokens (SELECT/INSERT/DELETE only — tokens are
-- immutable; rotation creates a new row, so no UPDATE policy).
CREATE POLICY "Users read own user_push_tokens"
  ON public.user_push_tokens
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own user_push_tokens"
  ON public.user_push_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete own user_push_tokens"
  ON public.user_push_tokens
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage user_push_tokens"
  ON public.user_push_tokens
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── user_profiles: drop the now-unused single-token column ─────────────────
ALTER TABLE public.user_profiles DROP COLUMN push_token;

-- ─── friendships: per-side directional mute ─────────────────────────────────
-- Each side controls their own *_notify_of_activity flag. Default true so
-- existing rows continue to send notifications as before.
ALTER TABLE public.friendships
  ADD COLUMN requester_notify_of_activity boolean NOT NULL DEFAULT true,
  ADD COLUMN addressee_notify_of_activity boolean NOT NULL DEFAULT true;

COMMIT;
