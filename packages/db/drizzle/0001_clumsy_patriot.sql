CREATE TABLE IF NOT EXISTS "kl_test_results" (
	"result_id" serial PRIMARY KEY NOT NULL,
	"test_session_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"kanji_id" integer NOT NULL,
	"question_type" text NOT NULL,
	"correct" boolean NOT NULL,
	"response_ms" integer,
	"voice_transcript" text,
	"normalized_input" text,
	"quality" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kl_test_sessions" (
	"test_session_id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"test_type" text NOT NULL,
	"scope_level" smallint,
	"scope_kanji_ids" integer[],
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"total_items" integer,
	"correct" integer DEFAULT 0 NOT NULL,
	"score_pct" numeric(5, 2),
	"passed" boolean,
	"voice_enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kanji" ADD COLUMN "jis_code" varchar(8);--> statement-breakpoint
ALTER TABLE "kanji" ADD COLUMN "nelson_classic" integer;--> statement-breakpoint
ALTER TABLE "kanji" ADD COLUMN "nelson_new" integer;--> statement-breakpoint
ALTER TABLE "kanji" ADD COLUMN "morohashi_index" integer;--> statement-breakpoint
ALTER TABLE "kanji" ADD COLUMN "morohashi_volume" smallint;--> statement-breakpoint
ALTER TABLE "kanji" ADD COLUMN "morohashi_page" smallint;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kl_test_results" ADD CONSTRAINT "kl_test_results_test_session_id_kl_test_sessions_test_session_id_fk" FOREIGN KEY ("test_session_id") REFERENCES "public"."kl_test_sessions"("test_session_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kl_test_results" ADD CONSTRAINT "kl_test_results_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kl_test_results" ADD CONSTRAINT "kl_test_results_kanji_id_kanji_id_fk" FOREIGN KEY ("kanji_id") REFERENCES "public"."kanji"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kl_test_sessions" ADD CONSTRAINT "kl_test_sessions_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_result_session_idx" ON "kl_test_results" USING btree ("test_session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_result_user_idx" ON "kl_test_results" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_result_kanji_idx" ON "kl_test_results" USING btree ("kanji_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_session_user_idx" ON "kl_test_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "test_session_type_idx" ON "kl_test_sessions" USING btree ("user_id","test_type");