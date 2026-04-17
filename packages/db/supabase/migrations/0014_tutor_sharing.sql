-- Tutor sharing enum
DO $$ BEGIN
  CREATE TYPE tutor_share_status AS ENUM ('pending', 'accepted', 'declined', 'revoked', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tutor shares
CREATE TABLE IF NOT EXISTS "tutor_shares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "user_profiles"("id") ON DELETE CASCADE,
  "teacher_email" text NOT NULL,
  "token" text NOT NULL,
  "status" tutor_share_status NOT NULL DEFAULT 'pending',
  "terms_accepted_at" timestamptz,
  "declined_at" timestamptz,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "tutor_share_token_idx" ON "tutor_shares"("token");
CREATE INDEX IF NOT EXISTS "tutor_share_user_idx" ON "tutor_shares"("user_id");
CREATE INDEX IF NOT EXISTS "tutor_share_user_status_idx" ON "tutor_shares"("user_id", "status");

-- Tutor notes
CREATE TABLE IF NOT EXISTS "tutor_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "share_id" uuid NOT NULL REFERENCES "tutor_shares"("id") ON DELETE CASCADE,
  "note_text" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "tutor_notes_share_idx" ON "tutor_notes"("share_id");

-- Tutor analysis cache
CREATE TABLE IF NOT EXISTS "tutor_analysis_cache" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "user_profiles"("id") ON DELETE CASCADE,
  "analysis_json" jsonb NOT NULL,
  "generated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "tutor_analysis_user_idx" ON "tutor_analysis_cache"("user_id");

-- Placement sessions
CREATE TABLE IF NOT EXISTS "placement_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "user_profiles"("id") ON DELETE CASCADE,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "inferred_level" text,
  "summary_json" jsonb
);

CREATE INDEX IF NOT EXISTS "placement_session_user_idx" ON "placement_sessions"("user_id", "started_at");

-- Placement results
CREATE TABLE IF NOT EXISTS "placement_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "placement_sessions"("id") ON DELETE CASCADE,
  "kanji_id" integer NOT NULL REFERENCES "kanji"("id") ON DELETE CASCADE,
  "jlpt_level" text NOT NULL,
  "passed" boolean NOT NULL
);

CREATE INDEX IF NOT EXISTS "placement_result_session_idx" ON "placement_results"("session_id");
