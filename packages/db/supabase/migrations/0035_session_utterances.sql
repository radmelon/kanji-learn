-- Migration 0035: what Buddy said in the weekly session
-- Run order: 35
--
-- Implements docs/superpowers/specs/2026-08-03-coaching-slice3-design.md §6.
--
-- GET /v1/buddy/session is called every time the learner opens the app on
-- their Buddy day. Without a cache Buddy says something DIFFERENT every time
-- they look, and every look costs an LLM call. The codebase already holds this
-- position: pickHookCandidate breaks ties deterministically because "a coach
-- that suggests a different kanji each time you reload is not a coach."
--
-- Its own table rather than buddy_commitments.method (an unused jsonb column
-- whose (user_id, week_start) key is exactly right): `method` means how the
-- commitment was arrived at, so a future reader would find Buddy's spoken
-- analysis under a name meaning something else, and setForWeek's upsert could
-- clobber it. A dedicated table also gives "what Buddy said each week" as a
-- queryable history for free.
--
-- No TTL and no invalidation, deliberately: the key IS the session period, and
-- a third time constant on top of slice 2's staleness and coalescing windows
-- would be three windows to reason about for no behavioural gain.
--
-- provider_name, not model: CompletionResult carries providerName and no model
-- id (packages/shared/src/llm-types.ts). A column called `model` holding
-- "groq" would be wrong in the schema itself.

BEGIN;

CREATE TABLE IF NOT EXISTS buddy_session_utterances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  week_start    date NOT NULL,
  text          text NOT NULL,
  provider_name text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS buddy_session_utterances_user_week_unique
  ON buddy_session_utterances (user_id, week_start);

COMMENT ON TABLE buddy_session_utterances IS
  'One composed utterance per learner per weekly session period. Cache, not record — the durable record is the notebook entry, which stays template prose (slice 3 §2).';

-- RLS: the API connects as postgres (BYPASSRLS); anon/authenticated PostgREST
-- callers are default-deny. rls-coverage.test.ts fails CI for any public table
-- missing either flag.
ALTER TABLE public.buddy_session_utterances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buddy_session_utterances FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='buddy_session_utterances'
                 AND policyname='Users read own buddy_session_utterances') THEN
    CREATE POLICY "Users read own buddy_session_utterances" ON public.buddy_session_utterances
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='buddy_session_utterances'
                 AND policyname='Service role can manage buddy_session_utterances') THEN
    CREATE POLICY "Service role can manage buddy_session_utterances" ON public.buddy_session_utterances
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;
