-- Repair kanji.components: stored as a jsonb STRING, should be a jsonb ARRAY.
--
-- The 2026-07-05 live IDS backfill wrote every one of the 2,294 rows
-- double-encoded. `backfill-components.ts` called JSON.stringify() itself and
-- cast the result with `as unknown as string[]`, but packages/db/src/client.ts
-- already overrides PgJsonb.mapToDriverValue to a pass-through (the Phase 1'
-- fix, f1d111b) — so postgres-js received an already-stringified value and
-- stored it as a jsonb scalar string:
--
--   persisted : "[\"扌\",\"寺\"]"      (jsonb_typeof = 'string')
--   wanted    : ["扌", "寺"]           (jsonb_typeof = 'array')
--
-- Impact: GET /v1/kanji/:id returns components: null, because the route's
-- toArr() helper correctly refuses a non-array. That null propagates to
-- buildSlots/lookupComponents, so the co-creation teaching beat cannot render
-- and "Build a hook" fails. The entire Phase 5 feature was blocked in
-- production from 2026-07-05 until this ran.
--
-- Why the original verification missed it: the runbook spot-check was
-- `SELECT components FROM kanji WHERE character='持'` → "contains 扌 and 寺".
-- A double-encoded string contains both characters, so it passed on
-- appearance. Checking jsonb_typeof would have caught it immediately.
--
-- `#>> '{}'` extracts the scalar as unquoted text; casting that back to jsonb
-- parses it as the array it was always meant to be. Guarded on jsonb_typeof so
-- the statement is idempotent and cannot corrupt already-correct rows.

UPDATE kanji
SET components = (components #>> '{}')::jsonb
WHERE components IS NOT NULL
  AND jsonb_typeof(components) = 'string';

-- Verification (expect: array | 2294, and zero rows of any other type):
--   SELECT jsonb_typeof(components), count(*) FROM kanji
--   WHERE components IS NOT NULL GROUP BY 1;
