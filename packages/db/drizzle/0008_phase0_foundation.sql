DO $$ BEGIN
 CREATE TYPE "public"."buddy_mood" AS ENUM('celebratory', 'supportive', 'challenging', 'concerned');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."buddy_personality" AS ENUM('encouraging', 'direct', 'playful');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."device_type" AS ENUM('iphone', 'ipad', 'watch');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."llm_tier" AS ENUM('tier1', 'tier2', 'tier3');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."mnemonic_generation_method" AS ENUM('system', 'user', 'cocreated');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."study_log_mood" AS ENUM('aha', 'struggle', 'breakthrough', 'fun', 'confused');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."velocity_trend" AS ENUM('accelerating', 'steady', 'decelerating', 'inactive');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."weakest_modality" AS ENUM('meaning', 'reading', 'writing', 'voice', 'compound');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "buddy_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"context" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "buddy_llm_telemetry" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"tier" "llm_tier" NOT NULL,
	"provider_name" text NOT NULL,
	"request_context" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer NOT NULL,
	"success" boolean NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "buddy_llm_usage" (
	"user_id" uuid NOT NULL,
	"usage_date" text NOT NULL,
	"tier" "llm_tier" NOT NULL,
	"call_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buddy_llm_usage_user_id_usage_date_tier_pk" PRIMARY KEY("user_id","usage_date","tier")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "buddy_nudges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"screen" text NOT NULL,
	"nudge_type" text NOT NULL,
	"content" text NOT NULL,
	"watch_summary" text,
	"action_type" text,
	"action_payload" jsonb,
	"priority" smallint DEFAULT 3 NOT NULL,
	"delivery_target" text DEFAULT 'app' NOT NULL,
	"watch_delivered_at" timestamp with time zone,
	"push_delivered_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"dismissed_at" timestamp with time zone,
	"generated_by" text NOT NULL,
	"device_type" "device_type",
	"social_framing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learner_app_grants" (
	"learner_id" uuid NOT NULL,
	"app_id" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	CONSTRAINT "learner_app_grants_learner_id_app_id_pk" PRIMARY KEY("learner_id","app_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learner_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id_a" uuid NOT NULL,
	"learner_id_b" uuid NOT NULL,
	"relationship" text DEFAULT 'friend' NOT NULL,
	"shared_apps" jsonb DEFAULT '["kanji_buddy"]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learner_identity" (
	"learner_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"email" text,
	"native_language" text,
	"target_languages" jsonb DEFAULT '["ja"]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learner_knowledge_state" (
	"learner_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"mastery_level" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'unseen' NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone,
	"app_source" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learner_knowledge_state_learner_id_subject_pk" PRIMARY KEY("learner_id","subject")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learner_memory_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"artifact_type" text NOT NULL,
	"content" jsonb NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effectiveness_score" real DEFAULT 0.5 NOT NULL,
	"app_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learner_profile_universal" (
	"learner_id" uuid PRIMARY KEY NOT NULL,
	"interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reasons_for_learning" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_learning_styles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"study_habits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"buddy_personality_pref" "buddy_personality" DEFAULT 'encouraging' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learner_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"native_language" text,
	"reasons_for_learning" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_mnemonic_style" text,
	"preferred_learning_styles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"buddy_personality_pref" "buddy_personality" DEFAULT 'encouraging' NOT NULL,
	"study_environments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learner_state_cache" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"current_streak_days" integer DEFAULT 0 NOT NULL,
	"longest_streak_days" integer DEFAULT 0 NOT NULL,
	"velocity_trend" "velocity_trend" DEFAULT 'inactive' NOT NULL,
	"total_kanji_seen" integer DEFAULT 0 NOT NULL,
	"total_kanji_burned" integer DEFAULT 0 NOT NULL,
	"active_leech_count" integer DEFAULT 0 NOT NULL,
	"leech_kanji_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weakest_modality" "weakest_modality" DEFAULT 'meaning' NOT NULL,
	"strongest_jlpt_level" "jlpt_level",
	"current_focus_level" "jlpt_level",
	"recent_accuracy" real DEFAULT 0 NOT NULL,
	"last_session_at" timestamp with time zone,
	"avg_daily_reviews" real DEFAULT 0 NOT NULL,
	"avg_session_duration_ms" integer DEFAULT 0 NOT NULL,
	"days_since_last_session" integer DEFAULT 0 NOT NULL,
	"days_since_first_session" integer DEFAULT 0 NOT NULL,
	"quiz_vs_srs_gap_high" boolean DEFAULT false NOT NULL,
	"primary_device" "device_type",
	"device_distribution" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"watch_session_avg_cards" integer,
	"recent_milestones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"study_patterns" jsonb DEFAULT '{"avgSessionsPerDay":0,"weekendVsWeekdayRatio":1}'::jsonb NOT NULL,
	"next_recommended_activity" text,
	"buddy_mood" "buddy_mood" DEFAULT 'supportive' NOT NULL,
	"scaffold_level" text DEFAULT 'medium' NOT NULL,
	"friends_count" integer DEFAULT 0 NOT NULL,
	"active_friends_today" integer DEFAULT 0 NOT NULL,
	"friends_ahead_on_burn" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"friends_behind_on_burn" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"friends_ahead_on_streak" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"friends_behind_on_streak" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_strengths_vs_friends" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"group_momentum" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learner_timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"learner_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"subject" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"app_source" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shared_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id_a" uuid NOT NULL,
	"user_id_b" uuid NOT NULL,
	"goal_type" text NOT NULL,
	"target" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"achieved_at" timestamp with time zone,
	"achieved_by" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "study_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kanji_id" integer NOT NULL,
	"mnemonic_id" uuid,
	"user_note" text,
	"example_sentence" text,
	"sentence_reading" text,
	"sentence_translation" text,
	"photo_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audio_note_url" text,
	"location_lat" real,
	"location_lng" real,
	"location_name" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mood" "study_log_mood",
	"shared_with_friends" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_viewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "study_plan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"activity_index" smallint NOT NULL,
	"event" text NOT NULL,
	"event_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_type" "device_type"
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "study_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"activities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text NOT NULL,
	"scaffold_level" smallint NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_type" "device_type",
	"completed_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mnemonics" ADD COLUMN "generation_method" "mnemonic_generation_method" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "mnemonics" ADD COLUMN "location_type" text;--> statement-breakpoint
ALTER TABLE "mnemonics" ADD COLUMN "cocreation_context" jsonb;--> statement-breakpoint
ALTER TABLE "mnemonics" ADD COLUMN "effectiveness_score" real DEFAULT 0.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "mnemonics" ADD COLUMN "last_reinforced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mnemonics" ADD COLUMN "reinforcement_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_logs" ADD COLUMN "device_type" "device_type";--> statement-breakpoint
ALTER TABLE "review_sessions" ADD COLUMN "device_type" "device_type";--> statement-breakpoint
ALTER TABLE "kl_test_sessions" ADD COLUMN "device_type" "device_type";--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "buddy_conversations" ADD CONSTRAINT "buddy_conversations_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "buddy_llm_telemetry" ADD CONSTRAINT "buddy_llm_telemetry_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "buddy_llm_usage" ADD CONSTRAINT "buddy_llm_usage_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "buddy_nudges" ADD CONSTRAINT "buddy_nudges_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learner_app_grants" ADD CONSTRAINT "learner_app_grants_learner_id_learner_identity_learner_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learner_identity"("learner_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learner_connections" ADD CONSTRAINT "learner_connections_learner_id_a_learner_identity_learner_id_fk" FOREIGN KEY ("learner_id_a") REFERENCES "public"."learner_identity"("learner_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learner_connections" ADD CONSTRAINT "learner_connections_learner_id_b_learner_identity_learner_id_fk" FOREIGN KEY ("learner_id_b") REFERENCES "public"."learner_identity"("learner_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learner_knowledge_state" ADD CONSTRAINT "learner_knowledge_state_learner_id_learner_identity_learner_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learner_identity"("learner_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learner_memory_artifacts" ADD CONSTRAINT "learner_memory_artifacts_learner_id_learner_identity_learner_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learner_identity"("learner_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learner_profile_universal" ADD CONSTRAINT "learner_profile_universal_learner_id_learner_identity_learner_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learner_identity"("learner_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learner_profiles" ADD CONSTRAINT "learner_profiles_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learner_state_cache" ADD CONSTRAINT "learner_state_cache_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learner_timeline_events" ADD CONSTRAINT "learner_timeline_events_learner_id_learner_identity_learner_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learner_identity"("learner_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shared_goals" ADD CONSTRAINT "shared_goals_user_id_a_user_profiles_id_fk" FOREIGN KEY ("user_id_a") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shared_goals" ADD CONSTRAINT "shared_goals_user_id_b_user_profiles_id_fk" FOREIGN KEY ("user_id_b") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "study_log_entries" ADD CONSTRAINT "study_log_entries_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "study_log_entries" ADD CONSTRAINT "study_log_entries_kanji_id_kanji_id_fk" FOREIGN KEY ("kanji_id") REFERENCES "public"."kanji"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "study_log_entries" ADD CONSTRAINT "study_log_entries_mnemonic_id_mnemonics_id_fk" FOREIGN KEY ("mnemonic_id") REFERENCES "public"."mnemonics"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "study_plan_events" ADD CONSTRAINT "study_plan_events_plan_id_study_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."study_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buddy_conv_user_active_idx" ON "buddy_conversations" USING btree ("user_id","last_active_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buddy_llm_telemetry_provider_time_idx" ON "buddy_llm_telemetry" USING btree ("provider_name","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buddy_llm_telemetry_user_time_idx" ON "buddy_llm_telemetry" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buddy_nudges_user_screen_idx" ON "buddy_nudges" USING btree ("user_id","screen","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buddy_nudges_watch_delivery_idx" ON "buddy_nudges" USING btree ("user_id","delivery_target","watch_delivered_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "learner_connections_pair_idx" ON "learner_connections" USING btree ("learner_id_a","learner_id_b");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "learner_knowledge_subject_only_idx" ON "learner_knowledge_state" USING btree ("subject");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "learner_artifacts_subject_idx" ON "learner_memory_artifacts" USING btree ("learner_id","subject");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "learner_timeline_learner_time_idx" ON "learner_timeline_events" USING btree ("learner_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shared_goals_pair_type_idx" ON "shared_goals" USING btree ("user_id_a","user_id_b","goal_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "study_log_user_created_idx" ON "study_log_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "study_log_user_kanji_idx" ON "study_log_entries" USING btree ("user_id","kanji_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "study_plan_events_plan_idx" ON "study_plan_events" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "study_plans_user_active_idx" ON "study_plans" USING btree ("user_id","expires_at");