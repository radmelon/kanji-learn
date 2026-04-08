-- Migration: 0012_add_example_sentences
-- Adds example_sentences JSONB column to the kanji table.
-- Each row holds 1–2 sentence objects: { ja, en, vocab }
-- Populated by the seed:sentences script (Tatoeba CC-BY 2.0).

ALTER TABLE kanji
  ADD COLUMN IF NOT EXISTS example_sentences jsonb NOT NULL DEFAULT '[]'::jsonb;
