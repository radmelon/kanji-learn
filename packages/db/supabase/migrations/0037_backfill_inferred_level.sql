-- Migration 0037: backfill placement_sessions.inferred_level
-- Run order: 37
--
-- SYMPTOM (reported repeatedly since 2026-08-04): the tutor and the Journal
-- state different JLPT levels for the same learner. The tutor says N4, the
-- Journal says N3, and both are reading the same placement session.
--
-- They disagree because they read different things:
--   * tutor-report.service.ts:141 and tutor-analysis.service.ts:168 read the
--     STORED placement_sessions.inferred_level;
--   * coaching.service.ts:374 RECOMPUTES from ability_theta against today's
--     corpus, and deliberately does not trust the stored value
--     (see its own comment at :344, which names this exact row).
--
-- ⚠️ THIS IS NOT DRIFT, AND THAT MATTERS FOR THE FIX. Verified 2026-08-07:
--
--   * kanji_difficulty has min(updated_at) = max(updated_at) = 2026-07-31.
--     The corpus has not moved, so the bands have not moved.
--   * The stored values were WRONG WHEN WRITTEN, by the B146 bug that commit
--     504b1ea fixed on 2026-08-01 22:45 UTC ("the level bands were built from
--     the learner's own answers"). Before it, levelBands was fed the items the
--     adaptive test happened to ask instead of the corpus. Item selection
--     maximises Fisher information, so a strong learner is never asked an N5
--     item, N5 drops out of the ladder, and the label is read one slot too low.
--
-- The live rows show that boundary exactly:
--
--   completed_at   theta      stored  correct
--   2026-08-01     0.227545   N4      N3   <- pre-fix code path
--   2026-08-01     1.06744    N4      N3   <- pre-fix code path
--   2026-08-01     1.14527    N4      N3   <- pre-fix code path
--   2026-08-04     0.48712    N3      N3   <- post-fix, already correct
--
-- So this is a one-time correction of rows a known bug wrote, not a recurring
-- staleness problem. A migration is the right instrument. New sessions are
-- already correct and need nothing.
--
-- WHAT IT DOES NOT FIX. Two sessions have ability_theta IS NULL (one from
-- 2026-04-17, one from 2026-07-07) and are left untouched -- there is no theta
-- to recompute from, and inventing one would be worse than a stale label.
-- Note that coaching.service.ts:272 already returns null for those learners, so
-- the Journal says nothing about their level either way. Backfilling this
-- column does NOT give them a level; that needs a re-test.
--
-- ⚠️ IF kanji_difficulty IS EVER RECOMPUTED, these stored values go stale again
-- and this migration would have to be re-run. The durable fix is for the tutor
-- to derive the level the way coaching.service.ts already does, rather than
-- reading a value frozen at test time. That is a code change, not a migration,
-- and is deliberately out of scope here. Filed alongside this in BUGS.md.
--
-- The SQL below reimplements packages/shared/src/placement.ts exactly:
--   levelBands()     -- mean b per level, IN JLPT_LEVELS ORDER (not sorted by
--                       mean), boundaries = midpoints of adjacent means;
--   inferredLevel()  -- idx = count of boundaries where theta >= boundary,
--                       then take the idx-th (0-based) band label.
-- Levels with no corpus entries drop out of the ladder, which is the property
-- B146 turned on its head; deriving idx and label from the same aligned CTE is
-- what stops them being sourced separately again.
--
-- Idempotent: re-running recomputes the same values against the same corpus.

BEGIN;

WITH ord(level, pos) AS (
  -- JLPT_LEVELS order from packages/shared/src/milestones/constants.ts.
  -- levelBands iterates THIS order; it does not sort by mean.
  VALUES ('N5', 1), ('N4', 2), ('N3', 3), ('N2', 4), ('N1', 5)
),
means AS (
  SELECT o.level, o.pos, avg(kd.b)::numeric AS mean_b
    FROM kanji_difficulty kd
    JOIN kanji k ON k.id = kd.kanji_id
    JOIN ord  o ON o.level = k.jlpt_level::text
   GROUP BY o.level, o.pos
),
-- A level absent from the corpus never reaches `means`, so idx is dense over
-- the levels that survive -- the aligned (label, index) pair levelBands returns.
band AS (
  SELECT level, mean_b, row_number() OVER (ORDER BY pos) - 1 AS idx
    FROM means
),
bounds AS (
  SELECT b.idx, (b.mean_b + n.mean_b) / 2 AS boundary
    FROM band b
    JOIN band n ON n.idx = b.idx + 1
)
UPDATE placement_sessions ps
   SET inferred_level = (
         SELECT level FROM band
          WHERE idx = (SELECT count(*) FROM bounds WHERE ps.ability_theta >= boundary)
       )
 WHERE ps.ability_theta IS NOT NULL
   AND ps.inferred_level IS DISTINCT FROM (
         SELECT level FROM band
          WHERE idx = (SELECT count(*) FROM bounds WHERE ps.ability_theta >= boundary)
       );

COMMIT;
