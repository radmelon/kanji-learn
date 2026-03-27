-- Migration 0002: Create kanji table
-- Run order: 2

CREATE TABLE kanji (
  id           SERIAL PRIMARY KEY,
  character    TEXT NOT NULL UNIQUE,
  jlpt_level   jlpt_level NOT NULL,
  jlpt_order   INTEGER NOT NULL,
  stroke_count SMALLINT NOT NULL,
  meanings     JSONB NOT NULL DEFAULT '[]',
  kun_readings JSONB NOT NULL DEFAULT '[]',
  on_readings  JSONB NOT NULL DEFAULT '[]',
  example_vocab JSONB NOT NULL DEFAULT '[]',
  radicals     JSONB NOT NULL DEFAULT '[]',
  svg_path     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX kanji_jlpt_level_order_idx ON kanji (jlpt_level, jlpt_order);

COMMENT ON TABLE kanji IS 'Master list of 2,136 Jōyō kanji ordered N5→N1';
COMMENT ON COLUMN kanji.jlpt_order IS 'Ordering within JLPT level (1-based)';
COMMENT ON COLUMN kanji.example_vocab IS 'Array of {word, reading, meaning} objects';
COMMENT ON COLUMN kanji.svg_path IS 'KanjiVG stroke-order SVG path reference';
