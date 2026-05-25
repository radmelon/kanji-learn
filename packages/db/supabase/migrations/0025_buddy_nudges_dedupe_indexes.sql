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
--
-- NB on NULL semantics: Postgres treats NULLs as distinct for unique-index
-- enforcement. The streak index keys on (action_payload->>'milestone'); if a
-- streak row is ever inserted without a non-null `milestone` value in
-- action_payload, the dedupe guarantee does NOT apply to that row. Callers
-- that insert streak nudges MUST set action_payload->>'milestone' to a
-- non-null value. Same applies to the meet_buddy WHERE clause's
-- action_payload->>'kind' filter. The NudgeService in apps/api/src/services/
-- buddy/nudge.service.ts is the only writer today and is built to this rule.

BEGIN;

CREATE UNIQUE INDEX buddy_nudges_streak_dedupe
  ON buddy_nudges (user_id, screen, (action_payload->>'milestone'))
  WHERE nudge_type = 'streak';

CREATE UNIQUE INDEX buddy_nudges_meet_buddy_dedupe
  ON buddy_nudges (user_id)
  WHERE nudge_type = 'encouragement' AND action_payload->>'kind' = 'meet_buddy';

COMMIT;
