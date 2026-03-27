-- Migration 0006: Create mnemonics table
-- Run order: 6

CREATE TABLE mnemonics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kanji_id         INTEGER NOT NULL REFERENCES kanji (id) ON DELETE CASCADE,
  user_id          UUID REFERENCES user_profiles (id) ON DELETE CASCADE,
  type             mnemonic_type NOT NULL,
  story_text       TEXT NOT NULL,
  image_prompt     TEXT,
  refresh_prompt_at TIMESTAMPTZ,   -- 30-day "still working?" nudge
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX mnemonic_kanji_idx   ON mnemonics (kanji_id, type);
CREATE INDEX mnemonic_user_idx    ON mnemonics (user_id, kanji_id) WHERE user_id IS NOT NULL;
CREATE INDEX mnemonic_refresh_idx ON mnemonics (refresh_prompt_at)
  WHERE refresh_prompt_at IS NOT NULL;

CREATE TRIGGER mnemonics_updated_at
  BEFORE UPDATE ON mnemonics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE mnemonics ENABLE ROW LEVEL SECURITY;

-- System mnemonics are readable by all authenticated users
CREATE POLICY "All users can read system mnemonics"
  ON mnemonics FOR SELECT
  USING (type = 'system' OR auth.uid() = user_id);

-- Users can only insert/update/delete their own mnemonics
CREATE POLICY "Users can manage own mnemonics"
  ON mnemonics FOR INSERT
  WITH CHECK (auth.uid() = user_id AND type = 'user');

CREATE POLICY "Users can update own mnemonics"
  ON mnemonics FOR UPDATE
  USING (auth.uid() = user_id AND type = 'user');

CREATE POLICY "Users can delete own mnemonics"
  ON mnemonics FOR DELETE
  USING (auth.uid() = user_id AND type = 'user');

COMMENT ON COLUMN mnemonics.refresh_prompt_at IS
  'When set, app shows "still working?" prompt — reset on positive review';
