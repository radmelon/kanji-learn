-- Migration 0017: post-delete cascade — add missing user_profiles → auth.users FK
-- Run order: 17
--
-- Root cause of the B121 "deleted user persists in friendships + leaderboard" bug:
-- `public.user_profiles` had no foreign key to `auth.users`. When the Delete
-- Account flow called `supabaseAdmin.auth.admin.deleteUser(userId)`, the
-- `auth.users` row went away but the `user_profiles` row stayed behind, and
-- downstream tables (friendships, tutor_shares, placement_sessions,
-- user_kanji_progress, daily_stats, review_sessions, review_logs, …) — all of
-- which CASCADE from user_profiles, not from auth.users — kept their data.
-- Result: the deleted user still appeared on other users' leaderboards +
-- study-mate lists.
--
-- This migration completes the cascade chain:
--   auth.users → user_profiles → friendships / tutor_shares / placement_sessions /
--                              user_kanji_progress / daily_stats / review_sessions /
--                              review_logs / learner_identity (via migration 0016)

BEGIN;

-- Step 1: clean up existing orphan user_profiles rows. These are rows whose
-- auth.users parent has already been deleted (pre-B121 Delete Account flow
-- left these behind). Without removing them, the FK ADD below would fail
-- with a constraint violation.
--
-- Everything under these orphans (friendships, tutor_shares, placement_sessions,
-- user_kanji_progress, daily_stats, review_sessions, review_logs,
-- learner_identity) cascades automatically via their existing ON DELETE CASCADE
-- FKs to user_profiles.
DELETE FROM public.user_profiles
WHERE id NOT IN (SELECT id FROM auth.users);

-- Step 2: add the missing FK. From now on, auth.admin.deleteUser() triggers
-- the full cascade chain without any application-layer cleanup.
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_auth_users_fk
  FOREIGN KEY (id)
  REFERENCES auth.users(id)
  ON DELETE CASCADE;

COMMIT;
