-- 0013_onboarding_setup.sql
--
-- 1. Add country column to learner_profiles
-- 2. Backfill onboarding_completed_at for existing users so they
--    are never shown the onboarding wizard.

ALTER TABLE learner_profiles
  ADD COLUMN IF NOT EXISTS country TEXT;

-- Backfill: any user_profile row without onboarding_completed_at
-- already exists → mark them as having completed onboarding.
UPDATE user_profiles
SET onboarding_completed_at = NOW()
WHERE onboarding_completed_at IS NULL;
