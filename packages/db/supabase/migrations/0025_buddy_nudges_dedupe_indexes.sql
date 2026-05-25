-- Migration 0025: Partial unique indexes on buddy_nudges for dedupe.
--
-- Phase 1' adds two rule-engine entry points that insert buddy_nudges rows.
-- Without these indexes, concurrent requests can race and produce duplicate
-- rows for the same logical event. With them, INSERT ... ON CONFLICT DO
-- NOTHING is sufficient — the DB enforces single-row-per-event semantics.
--
-- Streak nudges dedupe on (user, screen, milestone) — mirror rows on
-- Dashboard and Study Ready are independent, each dismissable separately.
--
-- Meet Buddy is one row per user, forever — once dismissed, never returns.

BEGIN;

CREATE UNIQUE INDEX buddy_nudges_streak_dedupe
  ON buddy_nudges (user_id, screen, (action_payload->>'milestone'))
  WHERE nudge_type = 'streak';

CREATE UNIQUE INDEX buddy_nudges_meet_buddy_dedupe
  ON buddy_nudges (user_id)
  WHERE nudge_type = 'encouragement' AND action_payload->>'kind' = 'meet_buddy';

COMMIT;
