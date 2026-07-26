-- Phase 5 Plan 4 — co-creation flags, per-kanji Buddy-moment cooldown, hint tracking.
--
-- Purely additive: every statement is ADD COLUMN IF NOT EXISTS with a default,
-- so the currently-running API neither sees nor cares about these columns.
-- That is what makes it safe — and required — to apply this BEFORE deploying
-- the API build that references them. Deploying first would ship a drizzle
-- schema whose relational queries SELECT columns the database does not have,
-- 500ing every profile fetch until the migration lands.

-- Privacy switch for hook coordinates. Default OFF: co-created hooks must not
-- inherit consent from the milestones location toggle (parent spec §11).
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS attach_location_to_hooks boolean NOT NULL DEFAULT false;

-- Global anti-nag switch. Default ON — parent spec §11 specifies an OPT-OUT.
-- Off suppresses automatic Buddy moments only; manual "Build a hook" still works.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS mnemonic_coaching_enabled boolean NOT NULL DEFAULT true;

-- Server-side so the one-time in-flow location ask survives a reinstall.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS hook_location_ask_seen_at timestamptz;

-- "Not now" is a 7-day cooldown FOR THAT KANJI (parent spec §11), so it is
-- per (user, kanji) — not a profile-level column.
ALTER TABLE user_kanji_progress
  ADD COLUMN IF NOT EXISTS buddy_moment_snoozed_until timestamptz;

-- Whether the learner pulled the mnemonic hint on this review (design spec §8.2).
-- Recorded as an effectiveness signal; not yet fed into effectivenessScore.
ALTER TABLE review_logs
  ADD COLUMN IF NOT EXISTS hint_used boolean NOT NULL DEFAULT false;
