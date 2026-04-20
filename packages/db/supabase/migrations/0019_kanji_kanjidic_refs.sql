-- Migration 0019: add Kanjidic2 reference columns to kanji
-- Run order: 19
--
-- Three new nullable columns populated from Kanjidic2 during a later seed
-- pass. Pre-positions data for future features — no consumer in Build 3-C.
--
-- Columns:
--   grade           smallint  — Kyōiku grade: 1–6 = elementary grades,
--                               8 = remaining Jōyō, 9–10 = Jinmeiyō. NULL for
--                               kanji absent from Kanjidic2.
--   frequency_rank  smallint  — Mainichi Shimbun newspaper corpus rank from
--                               Kanjidic2 <freq> element. 1 = most common,
--                               ~2500 = least; NULL if unranked.
--   hadamitzky_spahn integer  — Reference index in Hadamitzky & Spahn
--                               "Kanji & Kana" (2011 ed), sourced from
--                               <dic_ref dr_type="sh_kk2"> with fallback to
--                               sh_kk. NULL if not indexed.
--
-- All columns are nullable because some kanji in our DB may be absent from
-- Kanjidic2 (rare/non-Jouyou). No backfill in this migration; seed script
-- populates via a separate pass.

BEGIN;

ALTER TABLE public.kanji
  ADD COLUMN IF NOT EXISTS grade            smallint,
  ADD COLUMN IF NOT EXISTS frequency_rank   smallint,
  ADD COLUMN IF NOT EXISTS hadamitzky_spahn integer;

COMMENT ON COLUMN public.kanji.grade IS
  'Kyōiku grade from Kanjidic2: 1-6 = elementary grades, 8 = remaining Jōyō, 9-10 = Jinmeiyō. NULL for kanji absent from Kanjidic2.';

COMMENT ON COLUMN public.kanji.frequency_rank IS
  'Mainichi Shimbun newspaper corpus rank from Kanjidic2 <freq> element. 1 = most common, ~2500 = least; NULL if unranked.';

COMMENT ON COLUMN public.kanji.hadamitzky_spahn IS
  'Reference index in Hadamitzky & Spahn "Kanji & Kana" (2011 ed), sourced from Kanjidic2 <dic_ref dr_type="sh_kk2"> with fallback to sh_kk. NULL if not indexed in that reference.';

COMMIT;
