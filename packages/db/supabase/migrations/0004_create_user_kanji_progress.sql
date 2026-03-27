-- Migration 0004: Create user_kanji_progress (SM-2 SRS state)
-- Run order: 4

CREATE TABLE user_kanji_progress (
  id               SERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  kanji_id         INTEGER NOT NULL REFERENCES kanji (id) ON DELETE CASCADE,
  status           srs_status NOT NULL DEFAULT 'unseen',
  reading_stage    SMALLINT NOT NULL DEFAULT 0 CHECK (reading_stage BETWEEN 0 AND 4),
  ease_factor      REAL NOT NULL DEFAULT 2.5,
  interval         INTEGER NOT NULL DEFAULT 0,
  repetitions      INTEGER NOT NULL DEFAULT 0,
  next_review_at   TIMESTAMPTZ,
  last_reviewed_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX user_kanji_unique_idx ON user_kanji_progress (user_id, kanji_id);
CREATE INDEX user_kanji_next_review_idx ON user_kanji_progress (user_id, next_review_at)
  WHERE next_review_at IS NOT NULL;
CREATE INDEX user_kanji_status_idx ON user_kanji_progress (user_id, status);

CREATE TRIGGER user_kanji_progress_updated_at
  BEFORE UPDATE ON user_kanji_progress
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE user_kanji_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own progress"
  ON user_kanji_progress FOR ALL
  USING (auth.uid() = user_id);

COMMENT ON COLUMN user_kanji_progress.reading_stage IS
  '0=meaning only, 1=kun''yomi, 2=on''yomi via vocab, 3=all readings, 4=compound tests';
COMMENT ON COLUMN user_kanji_progress.ease_factor IS 'SM-2 ease factor (1.3–3.5, default 2.5)';
COMMENT ON COLUMN user_kanji_progress.interval IS 'Days until next review';
