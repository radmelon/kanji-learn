-- 0012_kanji_grade_idx.sql
-- Adds a btree index on kanji.grade to support per-grade aggregation
-- in MilestoneDetector queries.

CREATE INDEX IF NOT EXISTS "kanji_grade_idx" ON "kanji" USING btree ("grade");
