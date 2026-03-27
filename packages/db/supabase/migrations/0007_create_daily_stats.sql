-- Migration 0007: Create daily_stats table
-- Run order: 7

CREATE TABLE daily_stats (
  id           SERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  date         TEXT NOT NULL,  -- YYYY-MM-DD in user's local timezone
  reviewed     INTEGER NOT NULL DEFAULT 0,
  correct      INTEGER NOT NULL DEFAULT 0,
  new_learned  INTEGER NOT NULL DEFAULT 0,
  burned       INTEGER NOT NULL DEFAULT 0,
  study_time_ms INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX daily_stats_user_date_idx ON daily_stats (user_id, date);
CREATE INDEX daily_stats_user_idx ON daily_stats (user_id, date DESC);

ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own daily stats"
  ON daily_stats FOR ALL
  USING (auth.uid() = user_id);

-- Upsert helper: called by API after each review session
CREATE OR REPLACE FUNCTION upsert_daily_stats(
  p_user_id      UUID,
  p_date         TEXT,
  p_reviewed     INTEGER DEFAULT 0,
  p_correct      INTEGER DEFAULT 0,
  p_new_learned  INTEGER DEFAULT 0,
  p_burned       INTEGER DEFAULT 0,
  p_study_time_ms INTEGER DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO daily_stats (user_id, date, reviewed, correct, new_learned, burned, study_time_ms)
  VALUES (p_user_id, p_date, p_reviewed, p_correct, p_new_learned, p_burned, p_study_time_ms)
  ON CONFLICT (user_id, date) DO UPDATE SET
    reviewed      = daily_stats.reviewed + EXCLUDED.reviewed,
    correct       = daily_stats.correct + EXCLUDED.correct,
    new_learned   = daily_stats.new_learned + EXCLUDED.new_learned,
    burned        = daily_stats.burned + EXCLUDED.burned,
    study_time_ms = daily_stats.study_time_ms + EXCLUDED.study_time_ms;
END;
$$;
