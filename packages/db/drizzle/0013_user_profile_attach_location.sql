-- 0013_user_profile_attach_location.sql
-- Adds opt-in boolean for stamping location onto newly-earned milestones.
-- Default false (opt-in for privacy).

ALTER TABLE "user_profiles" ADD COLUMN "attach_location_to_milestones" boolean DEFAULT false NOT NULL;
