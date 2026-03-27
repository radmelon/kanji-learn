-- Migration 0008: Create interventions, writing_attempts, voice_attempts
-- Run order: 8

-- ─── interventions ────────────────────────────────────────────────────────────

CREATE TABLE interventions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  type         intervention_type NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  payload      JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX intervention_user_idx       ON interventions (user_id, triggered_at DESC);
CREATE INDEX intervention_unresolved_idx ON interventions (user_id, resolved_at)
  WHERE resolved_at IS NULL;

ALTER TABLE interventions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own interventions"
  ON interventions FOR SELECT
  USING (auth.uid() = user_id);

-- ─── writing_attempts ─────────────────────────────────────────────────────────

CREATE TABLE writing_attempts (
  id           SERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  kanji_id     INTEGER NOT NULL REFERENCES kanji (id) ON DELETE CASCADE,
  score        REAL NOT NULL CHECK (score BETWEEN 0.0 AND 1.0),
  stroke_count SMALLINT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX writing_attempt_user_idx ON writing_attempts (user_id, attempted_at DESC);

ALTER TABLE writing_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own writing attempts"
  ON writing_attempts FOR ALL
  USING (auth.uid() = user_id);

-- ─── voice_attempts ───────────────────────────────────────────────────────────

CREATE TABLE voice_attempts (
  id           SERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES user_profiles (id) ON DELETE CASCADE,
  kanji_id     INTEGER NOT NULL REFERENCES kanji (id) ON DELETE CASCADE,
  transcript   TEXT NOT NULL,
  expected     TEXT NOT NULL,
  distance     SMALLINT NOT NULL,  -- Levenshtein distance after wanakana normalization
  passed       BOOLEAN NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX voice_attempt_user_idx ON voice_attempts (user_id, attempted_at DESC);

ALTER TABLE voice_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own voice attempts"
  ON voice_attempts FOR ALL
  USING (auth.uid() = user_id);

COMMENT ON COLUMN voice_attempts.distance IS
  'Levenshtein distance after wanakana normalization — ≤2 = near-match pass';
