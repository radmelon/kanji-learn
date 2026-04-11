-- 0009_kanji_buddy_phase0_custom.sql
-- Constraints, views, and indexes that drizzle-kit cannot express from schema.ts.
--
-- Notes on scope vs. the original Phase 0 plan:
--
-- * The plan also called for a partial index on `user_kanji_progress` keyed by a
--   `lapse_count` column. That column does not exist in schema.ts — leeches are
--   derived at query time from `review_logs.quality`. Leech support is a Phase 1
--   concern and the partial index is deferred along with it.
--
-- * The plan also called for a second `learner_timeline_events` index on
--   `(learner_id, created_at DESC)`. That table stores `occurred_at`, not
--   `created_at`, and an index on `(learner_id, occurred_at)` is already
--   created by 0008_phase0_foundation.sql
--   (`learner_timeline_learner_time_idx`). No additional index is needed.
--
-- * The `kanji_mastery_view` materialized view is rewritten here to reference
--   the real columns on `user_kanji_progress` (`kanji_id`, `interval`,
--   `next_review_at`) and JOIN `kanji` to surface the character.

-- ── CHECK constraints ─────────────────────────────────────────────────────

-- UKG subjects are namespaced strings ("kanji:持", "word:学校"). Cap at 200.
DO $$ BEGIN
 ALTER TABLE "learner_knowledge_state"
   ADD CONSTRAINT "learner_knowledge_state_subject_length"
   CHECK (length(subject) <= 200);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- mastery_level is a probability-like value in [0, 1].
DO $$ BEGIN
 ALTER TABLE "learner_knowledge_state"
   ADD CONSTRAINT "learner_knowledge_state_mastery_range"
   CHECK (mastery_level >= 0 AND mastery_level <= 1);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Daily LLM call counts are non-negative.
DO $$ BEGIN
 ALTER TABLE "buddy_llm_usage"
   ADD CONSTRAINT "buddy_llm_usage_count_nonneg"
   CHECK (call_count >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- ── Materialized view: kanji_mastery_view ─────────────────────────────────
-- One row per (user, kanji) with derived mastery and latest review info.
-- Refreshed nightly by a scheduled job (added in Phase 1).

CREATE MATERIALIZED VIEW IF NOT EXISTS "kanji_mastery_view" AS
SELECT
  ukp.user_id,
  k.character AS kanji,
  ukp.status,
  CASE ukp.status
    WHEN 'unseen'     THEN 0.0
    WHEN 'learning'   THEN 0.25
    WHEN 'reviewing'  THEN 0.6
    WHEN 'remembered' THEN 0.85
    WHEN 'burned'     THEN 1.0
    ELSE 0.0
  END AS mastery_level,
  ukp."interval"       AS interval_days,
  ukp.next_review_at   AS due_date,
  ukp.updated_at       AS last_progress_update
FROM user_kanji_progress ukp
JOIN kanji k ON k.id = ukp.kanji_id;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "kanji_mastery_view_user_kanji_idx"
  ON "kanji_mastery_view" (user_id, kanji);
