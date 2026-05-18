-- 0023_daily_goal_minutes.sql
-- The daily study goal is changing from a card count to a minutes budget.
-- The column name `daily_goal` is unit-agnostic, so it is reused as-is.
-- New default: 15 minutes. Existing rows (pre-launch testers) held card
-- counts (e.g. 20, 50) that would be absurd as minutes, so they are reset
-- to the new default; testers re-pick in Profile.

BEGIN;

ALTER TABLE user_profiles ALTER COLUMN daily_goal SET DEFAULT 15;

UPDATE user_profiles SET daily_goal = 15;

COMMENT ON COLUMN user_profiles.daily_goal IS 'Daily study goal, in minutes (was a card count before migration 0023).';

COMMIT;
