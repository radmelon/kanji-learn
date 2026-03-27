DO $$ BEGIN
 CREATE TYPE "public"."intervention_type" AS ENUM('absence', 'velocity_drop', 'plateau');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."jlpt_level" AS ENUM('N5', 'N4', 'N3', 'N2', 'N1');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."mnemonic_type" AS ENUM('system', 'user');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."review_type" AS ENUM('meaning', 'reading', 'writing', 'compound');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."srs_status" AS ENUM('unseen', 'learning', 'reviewing', 'remembered', 'burned');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"date" text NOT NULL,
	"reviewed" integer DEFAULT 0 NOT NULL,
	"correct" integer DEFAULT 0 NOT NULL,
	"new_learned" integer DEFAULT 0 NOT NULL,
	"burned" integer DEFAULT 0 NOT NULL,
	"study_time_ms" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interventions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "intervention_type" NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"payload" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kanji" (
	"id" serial PRIMARY KEY NOT NULL,
	"character" text NOT NULL,
	"jlpt_level" "jlpt_level" NOT NULL,
	"jlpt_order" integer NOT NULL,
	"stroke_count" smallint NOT NULL,
	"meanings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"kun_readings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"on_readings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"example_vocab" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"radicals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"svg_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kanji_character_unique" UNIQUE("character")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mnemonics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kanji_id" integer NOT NULL,
	"user_id" uuid,
	"type" "mnemonic_type" NOT NULL,
	"story_text" text NOT NULL,
	"image_prompt" text,
	"refresh_prompt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kanji_id" integer NOT NULL,
	"review_type" "review_type" NOT NULL,
	"quality" smallint NOT NULL,
	"response_time_ms" integer NOT NULL,
	"prev_status" "srs_status" NOT NULL,
	"next_status" "srs_status" NOT NULL,
	"prev_interval" integer NOT NULL,
	"next_interval" integer NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"total_items" integer DEFAULT 0 NOT NULL,
	"correct_items" integer DEFAULT 0 NOT NULL,
	"study_time_ms" integer DEFAULT 0 NOT NULL,
	"session_type" text DEFAULT 'daily' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_kanji_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kanji_id" integer NOT NULL,
	"status" "srs_status" DEFAULT 'unseen' NOT NULL,
	"reading_stage" smallint DEFAULT 0 NOT NULL,
	"ease_factor" real DEFAULT 2.5 NOT NULL,
	"interval" integer DEFAULT 0 NOT NULL,
	"repetitions" integer DEFAULT 0 NOT NULL,
	"next_review_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"daily_goal" smallint DEFAULT 20 NOT NULL,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "voice_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kanji_id" integer NOT NULL,
	"transcript" text NOT NULL,
	"expected" text NOT NULL,
	"distance" smallint NOT NULL,
	"passed" boolean NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "writing_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kanji_id" integer NOT NULL,
	"score" real NOT NULL,
	"stroke_count" smallint NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "daily_stats" ADD CONSTRAINT "daily_stats_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "interventions" ADD CONSTRAINT "interventions_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mnemonics" ADD CONSTRAINT "mnemonics_kanji_id_kanji_id_fk" FOREIGN KEY ("kanji_id") REFERENCES "public"."kanji"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mnemonics" ADD CONSTRAINT "mnemonics_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_session_id_review_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."review_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_kanji_id_kanji_id_fk" FOREIGN KEY ("kanji_id") REFERENCES "public"."kanji"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_sessions" ADD CONSTRAINT "review_sessions_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_kanji_progress" ADD CONSTRAINT "user_kanji_progress_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_kanji_progress" ADD CONSTRAINT "user_kanji_progress_kanji_id_kanji_id_fk" FOREIGN KEY ("kanji_id") REFERENCES "public"."kanji"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voice_attempts" ADD CONSTRAINT "voice_attempts_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voice_attempts" ADD CONSTRAINT "voice_attempts_kanji_id_kanji_id_fk" FOREIGN KEY ("kanji_id") REFERENCES "public"."kanji"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "writing_attempts" ADD CONSTRAINT "writing_attempts_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "writing_attempts" ADD CONSTRAINT "writing_attempts_kanji_id_kanji_id_fk" FOREIGN KEY ("kanji_id") REFERENCES "public"."kanji"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "daily_stats_user_date_idx" ON "daily_stats" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_stats_user_idx" ON "daily_stats" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intervention_user_idx" ON "interventions" USING btree ("user_id","triggered_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intervention_unresolved_idx" ON "interventions" USING btree ("user_id","resolved_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kanji_jlpt_level_order_idx" ON "kanji" USING btree ("jlpt_level","jlpt_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mnemonic_kanji_idx" ON "mnemonics" USING btree ("kanji_id","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mnemonic_user_idx" ON "mnemonics" USING btree ("user_id","kanji_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mnemonic_refresh_idx" ON "mnemonics" USING btree ("refresh_prompt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_log_user_idx" ON "review_logs" USING btree ("user_id","reviewed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_log_kanji_idx" ON "review_logs" USING btree ("kanji_id","reviewed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_log_session_idx" ON "review_logs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_session_user_idx" ON "review_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_kanji_unique_idx" ON "user_kanji_progress" USING btree ("user_id","kanji_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_kanji_next_review_idx" ON "user_kanji_progress" USING btree ("user_id","next_review_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_kanji_status_idx" ON "user_kanji_progress" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_attempt_user_idx" ON "voice_attempts" USING btree ("user_id","attempted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "writing_attempt_user_idx" ON "writing_attempts" USING btree ("user_id","attempted_at");