-- Migration 0033: met_buddy_at — has this learner met Buddy? (Phase 7)
-- Run order: 33
--
-- NULL means the meeting-Buddy conversation runs on next launch — the correct
-- state for every existing row, exactly as buddy_day was (spec §8). Stamped
-- ONLY by POST /v1/buddy/meet/complete; deliberately absent from the
-- user-profile PATCH schema so no client can forge or unset it.

BEGIN;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS met_buddy_at timestamptz;

COMMENT ON COLUMN user_profiles.met_buddy_at IS
  'When the learner completed (or skipped) the first meeting with Buddy. NULL = conversation runs on next launch. Server-stamped only.';

COMMIT;
