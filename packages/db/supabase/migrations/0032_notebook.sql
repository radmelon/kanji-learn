-- Migration 0032: Buddy's home — the shared notebook
-- Run order: 32
--
-- Implements docs/superpowers/specs/2026-07-31-buddy-home-notebook-design.md.
-- Constraints live in DO blocks because Postgres has no ADD CONSTRAINT IF NOT
-- EXISTS; re-running on a partially-migrated database is normal during local
-- provisioning (mirrors migration 0030's header).

BEGIN;

CREATE TABLE IF NOT EXISTS notebook_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  kind           text NOT NULL,
  body           text NOT NULL,
  author         text NOT NULL,
  week_start     date,
  source         jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  superseded_at  timestamptz,
  superseded_by  uuid REFERENCES notebook_entries(id) ON DELETE SET NULL,
  CONSTRAINT notebook_entries_kind_check CHECK (kind IN ('observation', 'decision')),
  CONSTRAINT notebook_entries_author_check CHECK (author IN ('buddy', 'learner'))
);

COMMENT ON TABLE notebook_entries IS
  'Prose sections of the notebook. The agreement, experiments and hooks are PROJECTIONS over buddy_commitments and mnemonics — deliberately not copied here, so one fact has one home (spec §5.1).';
COMMENT ON COLUMN notebook_entries.superseded_by IS
  'Editing is superseding. A learner-authored row superseding a buddy-authored row IS the correction signal slice 2 reads (spec decision #4).';

CREATE INDEX IF NOT EXISTS notebook_entries_user_live_idx
  ON notebook_entries (user_id, kind) WHERE superseded_at IS NULL;

-- This is what makes NotebookService.ensureFirstOpen idempotent under
-- concurrency, not just under sequential calls. Its findFirst-then-insert is
-- check-then-act with no transaction or lock between the two steps, so two
-- concurrent GET /v1/buddy/notebook requests (same learner, two devices, or
-- two effect-driven calls racing on one) can both read "no introduction" and
-- both attempt the insert. This partial unique index permits exactly one LIVE
-- first-open row per user (superseded_at IS NULL) — not one ever, or editing
-- the seeded intro (NotebookService.supersedeEntry inserts a replacement that
-- copies the original's source) would collide with its own predecessor and
-- roll back with a 23505. The losing insert of a genuine race still relies on
-- this to fail with a constraint violation, which the service catches via
-- onConflictDoNothing().
CREATE UNIQUE INDEX IF NOT EXISTS notebook_entries_first_open_unique
  ON notebook_entries (user_id)
  WHERE source->>'kind' = 'first_open' AND superseded_at IS NULL;

ALTER TABLE public.notebook_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notebook_entries FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notebook_entries'
                 AND policyname='Users manage own notebook_entries') THEN
    CREATE POLICY "Users manage own notebook_entries" ON public.notebook_entries
      FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notebook_entries'
                 AND policyname='Service role can manage notebook_entries') THEN
    CREATE POLICY "Service role can manage notebook_entries" ON public.notebook_entries
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Tutor language. Drives the OUTBOUND report only; notes are never translated
-- by default (spec decision #8).
ALTER TABLE tutor_shares ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
ALTER TABLE tutor_notes  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
ALTER TABLE tutor_notes  ADD COLUMN IF NOT EXISTS body_translations jsonb;

COMMENT ON COLUMN tutor_notes.body_translations IS
  'Cache, populated ONLY when a learner explicitly asks. Never on write, never on read — a tutor may write in Japanese deliberately, to be read.';

-- The old Phase 6 (photo/audio/mood scrapbook) is replaced, not revised.
-- Zero rows and zero consumers on 2026-07-31.
DROP TABLE IF EXISTS study_log_entries;
DROP TYPE IF EXISTS study_log_mood;

COMMIT;
