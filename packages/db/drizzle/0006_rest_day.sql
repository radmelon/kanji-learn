-- Add rest_day column to user_profiles
-- 0 = Sunday, 1 = Monday, ..., 6 = Saturday, NULL = no rest day
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "rest_day" smallint;
