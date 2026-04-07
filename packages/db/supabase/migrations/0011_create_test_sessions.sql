-- Migration 0011: Create kl_test_sessions and kl_test_results tables
-- Run order: 11

-- ─── kl_test_sessions ─────────────────────────────────────────────────────────

CREATE TABLE kl_test_sessions (
  test_session_id  SERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  test_type        TEXT NOT NULL,
  -- 'exit_quiz' | 'weekly_set' | 'level_checkpoint' | 'surprise_check' | 'monthly_audit'
  scope_level      SMALLINT,
  scope_kanji_ids  INTEGER[],
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ,
  total_items      INTEGER,
  correct          INTEGER NOT NULL DEFAULT 0,
  score_pct        NUMERIC(5, 2),
  passed           BOOLEAN,
  voice_enabled    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX test_session_user_idx ON kl_test_sessions (user_id, started_at DESC);
CREATE INDEX test_session_type_idx ON kl_test_sessions (user_id, test_type);

ALTER TABLE kl_test_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own test sessions"
  ON kl_test_sessions FOR ALL
  USING (auth.uid() = user_id);

-- ─── kl_test_results ──────────────────────────────────────────────────────────

CREATE TABLE kl_test_results (
  result_id        SERIAL PRIMARY KEY,
  test_session_id  INTEGER NOT NULL REFERENCES kl_test_sessions (test_session_id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  kanji_id         INTEGER NOT NULL REFERENCES kanji (id) ON DELETE CASCADE,
  question_type    TEXT NOT NULL,
  -- 'meaning_recall' | 'kanji_from_meaning' | 'reading_recall' | 'vocab_reading' | 'vocab_from_definition'
  correct          BOOLEAN NOT NULL,
  response_ms      INTEGER,
  voice_transcript TEXT,
  normalized_input TEXT,
  quality          SMALLINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX test_result_session_idx ON kl_test_results (test_session_id);
CREATE INDEX test_result_user_idx    ON kl_test_results (user_id, created_at DESC);
CREATE INDEX test_result_kanji_idx   ON kl_test_results (kanji_id);

ALTER TABLE kl_test_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own test results"
  ON kl_test_results FOR ALL
  USING (auth.uid() = user_id);
