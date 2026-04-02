ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "email" text;

CREATE TABLE IF NOT EXISTS "friendships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "requester_id" uuid NOT NULL REFERENCES "user_profiles"("id") ON DELETE CASCADE,
  "addressee_id" uuid NOT NULL REFERENCES "user_profiles"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "friendship_pair_idx" ON "friendships"("requester_id","addressee_id");
CREATE INDEX IF NOT EXISTS "friendship_addressee_idx" ON "friendships"("addressee_id");
CREATE INDEX IF NOT EXISTS "friendship_status_idx" ON "friendships"("requester_id","status");
