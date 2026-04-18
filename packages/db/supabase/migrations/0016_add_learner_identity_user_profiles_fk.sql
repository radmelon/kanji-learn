-- 0016_add_learner_identity_user_profiles_fk.sql
--
-- Add the missing FK that ties learner_identity into the cascade chain
-- from auth.users -> user_profiles. Without it, deleting a user via
-- supabaseAdmin.auth.admin.deleteUser() leaves orphaned PII rows in
-- learner_identity (and the 6 tables that cascade from it:
-- learner_profile_universal, learner_knowledge_state,
-- learner_memory_artifacts, learner_timeline_events, learner_app_grants,
-- learner_connections). The existing learner_id was a plain PK with no
-- FK; the application set it to user_profiles.id by convention.
--
-- Applied manually in prod on 2026-04-17. This file is committed for
-- repo/schema parity.

ALTER TABLE learner_identity
  ADD CONSTRAINT learner_identity_learner_id_user_profiles_id_fk
  FOREIGN KEY (learner_id) REFERENCES user_profiles(id) ON DELETE CASCADE;
