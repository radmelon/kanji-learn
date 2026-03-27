-- Migration 0005: Create review_sessions and review_logs
-- Run order: 5

CREATE TABLE review_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  total_items  INTEGER NOT NULL DEFAULT 0,
  correct_items INTEGER NOT NULL DEFAULT 0,
  study_time_ms INTEGER NOT NULL DEFAULT 0,
  session_type TEXT NOT NULL DEFAULT 'daily'
    CHECK (session_type IN ('daily','weekly','checkpoint','surprise','audit'))
);

CREATE INDEX review_session_user_idx ON review_sessions (user_id, started_at DESC);

ALTER TABLE review_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own sessions"
  ON review_sessions FOR ALL
  USING (auth.uid() = user_id);

-- ─── review_logs ──────────────────────────────────────────────────────────────

CREATE TABLE review_logs (
  id              SERIAL PRIMARY KEY,
  session_id      UUID NOT NULL REFERENCES review_sessions (id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  kanji_id        INTEGER NOT NULL REFERENCES kanji (id) ON DELETE CASCADE,
  review_type     review_type NOT NULL,
  quality         SMALLINT NOT NULL CHECK (quality BETWEEN 0 AND 5),
  response_time_ms INTEGER NOT NULL,
  prev_status     srs_status NOT NULL,
  next_status     srs_status NOT NULL,
  prev_interval   INTEGER NOT NULL,
  next_interval   INTEGER NOT NULL,
  reviewed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX review_log_user_idx    ON review_logs (user_id, reviewed_at DESC);
CREATE INDEX review_log_kanji_idx   ON review_logs (kanji_id, reviewed_at DESC);
CREATE INDEX review_log_session_idx ON review_logs (session_id);

ALTER TABLE review_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own logs"
  ON review_logs FOR ALL
  USING (auth.uid() = user_id);

COMMENT ON COLUMN review_logs.quality IS 'SM-2 quality score 0–5 (0–2=fail, 3–5=pass)';
