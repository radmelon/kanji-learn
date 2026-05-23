-- Migration 0024: FSRS-5 schema swap.
-- Adds FSRS state columns; drops SM-2 state columns from user_kanji_progress.
-- review_logs gains nullable FSRS columns (history rows stay null).
-- Must be paired with packages/shared/src/srs.ts FSRS-5 implementation and
-- the scripts/replay-srs-fsrs.mjs backfill — see the rollout runbook.

BEGIN;

-- ── kanji_mastery_view (drop before altering columns it references) ─────────
-- The view uses ukp.interval (SM-2). It is not referenced by any application
-- code, so we drop it with CASCADE and recreate using stability (FSRS).
DROP MATERIALIZED VIEW IF EXISTS kanji_mastery_view CASCADE;

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

-- ── Recreate kanji_mastery_view with FSRS columns ──────────────────────────
-- interval_days is now sourced from stability (FSRS: days to 90% retention).
CREATE MATERIALIZED VIEW kanji_mastery_view AS
  SELECT
    ukp.user_id,
    k.character AS kanji,
    ukp.status,
    CASE ukp.status
      WHEN 'unseen'::srs_status    THEN 0.0
      WHEN 'learning'::srs_status  THEN 0.25
      WHEN 'reviewing'::srs_status THEN 0.6
      WHEN 'remembered'::srs_status THEN 0.85
      WHEN 'burned'::srs_status   THEN 1.0
      ELSE 0.0
    END AS mastery_level,
    ukp.stability::numeric AS interval_days,
    ukp.next_review_at AS due_date,
    ukp.updated_at AS last_progress_update
  FROM user_kanji_progress ukp
  JOIN kanji k ON k.id = ukp.kanji_id;

CREATE UNIQUE INDEX kanji_mastery_view_user_kanji_idx
  ON kanji_mastery_view (user_id, kanji);

-- ── review_logs ────────────────────────────────────────────────────────────
ALTER TABLE review_logs
  ADD COLUMN prev_stability   real,
  ADD COLUMN next_stability   real,
  ADD COLUMN prev_difficulty  real,
  ADD COLUMN next_difficulty  real;

COMMIT;
