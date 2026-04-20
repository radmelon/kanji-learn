-- Migration 0020: add user_profiles.show_pitch_accent preference
-- Run order: 20
--
-- Single boolean preference controlling whether pitch-accent overlays render
-- on kanji/vocab readings in the mobile app. Surfaced via the Profile tab's
-- Study Preferences section and via an inline toggle on the kanji details
-- page (mirroring the existing Rōmaji toggle pattern).
--
-- Default = true at the SQL level (existing users opt in by default and can
-- toggle off). The onboarding flow for NEW users overrides this based on
-- self-reported JLPT level: N5/N4 → false, N3/N2/N1/unsure → true.

BEGIN;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS show_pitch_accent boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.user_profiles.show_pitch_accent IS
  'Whether pitch accent overlays render on readings. Default set per JLPT level at onboarding (N5/N4 → false, N3+/unsure → true). User-toggleable via the Profile tab.';

COMMIT;
