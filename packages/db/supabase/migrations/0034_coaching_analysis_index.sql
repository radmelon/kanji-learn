-- Migration 0034: one live coaching analysis per learner
-- Run order: 34
--
-- Implements docs/superpowers/specs/2026-08-02-coaching-slice2-design.md §6.
--
-- NotebookService.writeKeyedEntry is check-then-act: it finds the live keyed
-- row, inserts a replacement, then supersedes the original. Two concurrent
-- runs both find the same `existing`, both insert, and the second supersede
-- matches zero rows -- leaving TWO live coaching entries, both rendered.
--
-- Onboarding is exactly where that race is most likely: the first Buddy
-- session suggests taking the placement test, so session-completion and
-- placement-completion can fire minutes (or milliseconds) apart.
--
-- This mirrors notebook_entries_first_open_unique in migration 0032, whose
-- header explains the same reasoning. It permits one LIVE coaching row per
-- user, not one ever -- superseding must keep working.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS notebook_entries_coaching_unique
  ON notebook_entries (user_id)
  WHERE source->>'kind' = 'coaching_analysis' AND superseded_at IS NULL;

COMMIT;
