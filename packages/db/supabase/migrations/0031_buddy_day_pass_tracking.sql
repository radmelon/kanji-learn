-- Migration 0031: Buddy day pass tracking — cadence-change and last-invited stamps
-- Run order: 31
--
-- Fixes the shared root cause of the weekly-Buddy pre-merge review findings on
-- `weekly-buddy-review-spec`: `runBuddyDayPass()` (apps/api/src/services/notification.service.ts)
-- never recorded that it had already acted, so the fortnightly tier was
-- unreachable (a cadence step-down was re-evaluated and stepped down again the
-- very next hour) and the weekly invitation re-sent on every day of its
-- multi-day due window.
--
-- Constraints are added inside DO blocks because Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS; re-running this file on a partially-migrated
-- database is a normal thing to need during local provisioning (see
-- migration 0030's header, whose conventions this mirrors).

BEGIN;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS buddy_cadence_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS buddy_last_invited_at timestamptz;

COMMENT ON COLUMN user_profiles.buddy_cadence_changed_at IS
  'When runBuddyDayPass last stepped buddy_interval_weeks/buddy_day down. CommitmentService.getMissCount only counts rolled_forward periods that began AFTER this timestamp, so a cadence change resets the miss count — without it, the pass re-evaluates the SAME miss streak on the very next hourly invocation and steps the learner down a second time before the new cadence''s wider window has produced a single new miss.';
COMMENT ON COLUMN user_profiles.buddy_last_invited_at IS
  'When runBuddyDayPass last pushed a weekly-catch-up invitation. evaluateAppointment returns "due" for floor(periodDays/2) consecutive days (four weekly, eight fortnightly); without this stamp the pass re-sends the identical invitation every one of those days.';

-- The redundant index: the unique constraint on (user_id, week_start) already
-- provides an index on that column pair, and Postgres can scan a unique index
-- backwards, so the separate DESC index duplicated it for no benefit.
DROP INDEX IF EXISTS buddy_commitments_user_week_idx;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'buddy_commitments_minutes_range'
  ) THEN
    ALTER TABLE buddy_commitments
      ADD CONSTRAINT buddy_commitments_minutes_range
        CHECK (minutes_per_day >= 1 AND minutes_per_day <= 600);
  END IF;
END $$;

COMMIT;
