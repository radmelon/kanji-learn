-- 0026_kanji_components.sql
-- Phase 5: add full component decomposition to kanji (KRADFILE-sourced).
-- Distinct from `radicals` (single classifying Kangxi radical). Additive,
-- non-destructive: no existing feature reads this column.

ALTER TABLE kanji
  ADD COLUMN IF NOT EXISTS components jsonb NOT NULL DEFAULT '[]'::jsonb;
