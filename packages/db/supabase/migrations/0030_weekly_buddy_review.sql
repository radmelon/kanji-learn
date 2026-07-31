-- Migration 0030: Weekly Buddy Review — the appointment and the commitment
-- Run order: 30
--
-- Part of docs/superpowers/plans/2026-07-31-weekly-buddy-review-slice-1.md,
-- implementing docs/superpowers/specs/2026-07-30-weekly-buddy-review-design.md
-- §5 (Slice 1 only).
--
-- buddy_day is deliberately SEPARATE from rest_day (spec decision #8):
-- conflating them means the one day the learner protects is the day Buddy
-- shows up. NULL means "no appointment" — which is both a real cadence
-- ("when I ask") and the correct state for every pre-existing row.
--
-- Constraints are added inside DO blocks because Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS; re-running this file on a partially-migrated
-- database is a normal thing to need during local provisioning.

BEGIN;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS buddy_day smallint,
  ADD COLUMN IF NOT EXISTS buddy_interval_weeks smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN user_profiles.buddy_day IS
  '0=Sun..6=Sat, in the user''s timezone. NULL = no appointment scheduled. Independent of rest_day by design.';
COMMENT ON COLUMN user_profiles.buddy_interval_weeks IS
  '1 = weekly, 2 = fortnightly. Commitment periods are ALWAYS 7 days; this only controls how often Buddy meets. Unattended weeks roll forward.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_buddy_day_range'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_buddy_day_range
        CHECK (buddy_day IS NULL OR (buddy_day >= 0 AND buddy_day <= 6));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_buddy_interval_range'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_buddy_interval_range
        CHECK (buddy_interval_weeks >= 1 AND buddy_interval_weeks <= 2);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS buddy_commitments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  week_start       date NOT NULL,
  days_committed   smallint NOT NULL,
  day_targets      jsonb,
  minutes_per_day  smallint NOT NULL,
  method           jsonb,
  experiment_until date,
  focus            text,
  source           text NOT NULL,
  agreed_at        timestamptz NOT NULL DEFAULT now(),
  superseded_at    timestamptz,
  CONSTRAINT buddy_commitments_user_week_unique UNIQUE (user_id, week_start),
  CONSTRAINT buddy_commitments_source_check
    CHECK (source IN ('session', 'rolled_forward', 'default')),
  CONSTRAINT buddy_commitments_days_range
    CHECK (days_committed >= 1 AND days_committed <= 7)
);

COMMENT ON TABLE buddy_commitments IS
  'One row per learner per 7-day period. Deliberately has NO completed_count/skipped_count: those measure compliance with a prescription, and this measures the result of an agreement (spec §5.4).';
COMMENT ON COLUMN buddy_commitments.source IS
  'session = the learner agreed it. rolled_forward = carried over because they did not attend. default = seeded with no prior. The reckoning changes register on this: a missed rolled_forward commitment is NOT a broken promise.';

CREATE INDEX IF NOT EXISTS buddy_commitments_user_week_idx
  ON buddy_commitments (user_id, week_start DESC);

-- RLS, mirroring migrations 0009 and 0018.
--
-- FORCE as well as ENABLE: apps/api/test/integration/rls-coverage.test.ts
-- asserts that EVERY public table has both, because ENABLE alone leaves the
-- table owner exempt from its own policies. Adding a table without FORCE is
-- caught by that test, which is the point of it.
ALTER TABLE public.buddy_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buddy_commitments FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'buddy_commitments' AND policyname = 'Users manage own buddy_commitments'
  ) THEN
    CREATE POLICY "Users manage own buddy_commitments"
      ON public.buddy_commitments
      FOR ALL
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'buddy_commitments' AND policyname = 'Service role can manage buddy_commitments'
  ) THEN
    CREATE POLICY "Service role can manage buddy_commitments"
      ON public.buddy_commitments
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

COMMIT;
