-- Migration 0029: Placement model — item-level results, ability posterior, kanji difficulty
-- Run order: 29
--
-- Part of docs/superpowers/plans/2026-07-29-placement-model.md, resolving
-- docs/superpowers/specs/2026-07-29-placement-model-design.md §11.
--
-- Run scripts/detect-placement-damage.mjs and repair-placement-damage.mjs
-- (docs/superpowers/plans/2026-07-29-placement-repair.md) BEFORE this
-- migration ships to production — this migration does not touch damaged
-- rows, but the difficulty model's weight-fitting job (Task 6) reads
-- user_kanji_progress.difficulty, and repair should land first so that data
-- isn't polluted by the bug's fabricated difficulty=5 values.

BEGIN;

-- New review_type value for the audit trail every placement seed writes
-- (spec §8.1). Safe inside this transaction — nothing here uses the new
-- value yet, only later application code does.
ALTER TYPE review_type ADD VALUE IF NOT EXISTS 'placement';

ALTER TABLE placement_results
  ADD COLUMN IF NOT EXISTS meaning_correct boolean,
  ADD COLUMN IF NOT EXISTS reading_correct boolean,
  ADD COLUMN IF NOT EXISTS difficulty_at_ask real;

COMMENT ON COLUMN placement_results.meaning_correct IS
  'Item-level result for the meaning question on this kanji. Nullable only because pre-migration rows have neither this nor reading_correct — every row written after this ships fills both.';
COMMENT ON COLUMN placement_results.reading_correct IS
  'Item-level result for the reading question on this kanji.';
COMMENT ON COLUMN placement_results.difficulty_at_ask IS
  'The b (item difficulty) used when this item was scored, so a session is replayable after kanji_difficulty is recalibrated.';

ALTER TABLE placement_sessions
  ADD COLUMN IF NOT EXISTS ability_theta real,
  ADD COLUMN IF NOT EXISTS ability_se real;

COMMENT ON COLUMN placement_sessions.ability_theta IS
  'Posterior mean ability estimate. inferred_level is now DERIVED from this (spec §7.5) rather than computed independently.';
COMMENT ON COLUMN placement_sessions.ability_se IS
  'Posterior standard error, widened for staleness before being reused as a retest prior (spec §10).';

CREATE TABLE IF NOT EXISTS kanji_difficulty (
  kanji_id       INTEGER PRIMARY KEY REFERENCES kanji (id) ON DELETE CASCADE,
  b_prior        REAL NOT NULL,
  b_observed     REAL,
  observed_n     INTEGER NOT NULL DEFAULT 0,
  b              REAL NOT NULL,
  reading_offset REAL NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE kanji_difficulty IS
  'Materialized item difficulty (spec §6.4) — b_prior from kanji features, b_observed from review_logs, b = blend(b_prior, b_observed, n, k). Global reference data like kanji itself; no RLS, matching that table''s precedent (packages/db/supabase/migrations/0002_create_kanji.sql).';

COMMIT;
