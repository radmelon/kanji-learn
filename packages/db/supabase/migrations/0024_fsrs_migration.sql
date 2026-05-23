-- Migration 0024: FSRS-5 schema swap.
-- Adds FSRS state columns; drops SM-2 state columns from user_kanji_progress.
-- review_logs gains nullable FSRS columns (history rows stay null).
-- Must be paired with packages/shared/src/srs.ts FSRS-5 implementation and
-- the scripts/replay-srs-fsrs.mjs backfill — see the rollout runbook.

BEGIN;

-- ── user_kanji_progress ────────────────────────────────────────────────────
ALTER TABLE user_kanji_progress
  ADD COLUMN stability      real    NOT NULL DEFAULT 0,
  ADD COLUMN difficulty     real    NOT NULL DEFAULT 5,
  ADD COLUMN lapses         integer NOT NULL DEFAULT 0,
  ADD COLUMN total_reviews  integer NOT NULL DEFAULT 0;

ALTER TABLE user_kanji_progress
  DROP COLUMN ease_factor,
  DROP COLUMN interval,
  DROP COLUMN repetitions;

-- ── review_logs ────────────────────────────────────────────────────────────
ALTER TABLE review_logs
  ADD COLUMN prev_stability   real,
  ADD COLUMN next_stability   real,
  ADD COLUMN prev_difficulty  real,
  ADD COLUMN next_difficulty  real;

COMMIT;
