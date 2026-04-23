-- Migration 0022: add voice_attempts.attempts_count
-- Run order: 22
--
-- Adds a collection-only smallint column tracking which attempt within
-- the card produced this row. Default 1 keeps legacy single-attempt rows
-- semantically correct without a backfill.
--
-- Collection-only as of the Speaking refactor (2026-04-22) — not consumed
-- by SRS or confidence math. Future Learning Engine brainstorm will decide
-- how to incorporate this signal.

BEGIN;

ALTER TABLE public.voice_attempts
  ADD COLUMN attempts_count smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.voice_attempts.attempts_count IS
  'Which try within the card this row represents. 1 = first attempt. Collection-only as of the Speaking refactor (2026-04-22) — not consumed by SRS or confidence math. Future Learning Engine brainstorm will decide how to incorporate.';

COMMIT;
