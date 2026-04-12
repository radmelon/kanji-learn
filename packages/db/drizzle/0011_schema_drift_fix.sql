-- 0011_schema_drift_fix.sql
-- Schema drift fix. Two columns were added to schema.ts without accompanying
-- drizzle migrations. The Phase 0 rehearsal against a freshly-migrated
-- kanji_buddy_prod_mirror exposed both via a drift-audit diagnostic that
-- compared drizzle introspection of schema.ts to information_schema.columns.
--
-- Columns added:
--   - user_profiles.reminder_hour  smallint NOT NULL DEFAULT 20
--       (0-23 in user's local timezone; drives the daily reminder cron)
--   - kanji.example_sentences      jsonb NOT NULL DEFAULT '[]'::jsonb
--       (array of {ja, en, vocab}; delivered alongside SRS reviews)
--
-- IF NOT EXISTS is used for idempotency against databases that already have
-- the manually-added columns (e.g. kanji_buddy_test had reminder_hour).

ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "reminder_hour" smallint NOT NULL DEFAULT 20;

ALTER TABLE "kanji"
  ADD COLUMN IF NOT EXISTS "example_sentences" jsonb NOT NULL DEFAULT '[]'::jsonb;
