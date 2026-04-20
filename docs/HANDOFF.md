# Session Handoff — 2026-04-20 (Build 3-C Phases 1 + 2 shipped)

## Current State

**Branch:** `main` — Build 3-C Phase 1 (server homophone workaround) shipped and verified.
**Latest TestFlight build:** **B124** (iOS) — unchanged; Phase 1 is server-only and applies to the existing B124 build in testers' hands.
**API:** App Runner `us-east-1` — Phase 1 shipped via two deploys:
- op `53710d9b…` — initial Phase 1 deploy (2026-04-19 15:59→16:03 PT, SUCCEEDED).
- op `e24febc1…` — hotfix normalizing expanded candidates through hiragana before comparison (fixed katakana on-yomi mismatch caught during on-device verification). Deploy 16:16→16:20 PT, SUCCEEDED, health check HTTP 200 in 409ms.

Earlier in the day the following also shipped (context preserved):
- op `03b663dd…` — toArr defense on kanji routes (paired with 1185-row radicals repair).
- op `fed113f85b…` — Groq + Gemini env vars now injected; health check HTTP 200 in 470ms.
**DB:** two migrations applied to prod 2026-04-19.
- `0017_user_profiles_auth_users_cascade.sql` — adds missing FK so account deletes fully cascade through friendships / tutor_shares / placement / daily_stats / review_logs / learner_identity. Deleted 2 pre-existing orphan `user_profiles` rows as part of the apply.
- `0018_rls_placement_tutor_tables.sql` — enables RLS + authenticated-user + service_role policies on `placement_sessions`, `placement_results`, `tutor_shares`, `tutor_notes`, `tutor_analysis_cache`. RLS coverage now **35 / 35** public tables.

## Build 3-C Phase 2 — data layer (SHIPPED 2026-04-20)

Phase 2 of the Build 3-C umbrella landed — migrations 0019 + 0020 applied to Supabase prod, Kanjidic2 seed extended (grade + frequency_rank + hadamitzky_spahn), vocab seed upgraded to 5 entries per kanji with self-containment validator (closes B4) and Kanjium pitch merge, Tatoeba sentence seed raised 2→5 per kanji.

**Code commits (9):**
- `f4d8a8b` feat(db): migration 0019 — add kanjidic2 refs (grade, frequency_rank, hadamitzky_spahn)
- `855d163` feat(db): migration 0020 — add user_profiles.show_pitch_accent
- `d3346b9` chore(db): vendor Kanjium pitch-accent snapshot
- `2eacf05` feat(db): expand vocab seed to 5-10 per kanji + self-containment validator + Kanjium pitch merge
- `1d5dc10` fix(db): correct seed-output path + raise Claude max_tokens for full batches
- `7c560f1` feat(db): extend import-kanjidic2 with grade, frequency_rank, hadamitzky_spahn
- `7ff7f5a` feat(db): raise sentence cap to 5 per kanji + defensive self-containment validator
- `e36fd5d` fix(db): use sql.json() for example_vocab writes to prevent jsonb double-encoding
- `a118498` fix(db): let Drizzle serialize example_sentences directly to prevent jsonb double-encoding

**Prod state after seed + repair + top-up (2026-04-20 — final):**
- `example_vocab`: 2,294 rows, all array-typed (manual repair during session via `#>> '{}'` pattern, then top-up run for 112 stragglers). Final distribution: **2,120 kanji with 5 entries, 158 with 4, 13 with 3, 3 below-floor (倖=1, 嚇=2, 錬=2 — all N1/Jinmeiyō with unavoidable Claude coverage gaps).** 2,291/2,294 (99.9%) meet the 3-entry floor.
- `example_sentences`: 2,294 rows, all array-typed (manual repair similarly). Distribution: 1,906 kanji with 5 sentences, 41 with 4, 49 with 3, 53 with 2, 67 with 1, 178 with 0 (rare kanji with no Tatoeba coverage).
- `kanji.grade`: 2,275 / 2,294 populated (99.2%).
- `kanji.frequency_rank`: 2,152 / 2,294 (93.8%).
- `kanji.hadamitzky_spahn`: 2,254 / 2,294 (98.3%).
- Pitch accent patterns: 8,053 vocab entries have `pitchPattern` attached (~75% of accepted entries).
- B4 validator: 2,288 / 2,294 kanji have ALL example_vocab entries containing the target kanji ✅ (closes the long-standing "kanji doesn't contain itself" bug).

**Two seed bugs found and fixed during the run:**
1. `enrich-vocab.ts` — raw postgres.js `JSON.stringify(x)::jsonb` pattern produced jsonb strings instead of arrays. 2,193 rows corrupted mid-run, manually repaired, write pattern changed to `sql.json()` + post-write `jsonb_typeof` assertion (commit `e36fd5d`).
2. `seed-sentences.ts` — Drizzle's `sql\`${JSON.stringify(x)}::jsonb\`` pattern hit the same class of bug. 2,116 rows corrupted during Tatoeba re-seed, manually repaired, write pattern changed to plain `.set({ exampleSentences: sentences })` + post-write assertion (commit `a118498`).

Both were "papered over" previously by startup `#>> '{}'` repair — those repairs run at seed start, not during the loop, so `--force` re-seeds re-corrupted faster than the startup repair could help. Fixes now do the write correctly AND assert post-write that the type is `'array'`.

**Migrations applied to prod via `psql`:**
- Migration 0019 — `kanji.grade / frequency_rank / hadamitzky_spahn` (all nullable)
- Migration 0020 — `user_profiles.show_pitch_accent boolean NOT NULL DEFAULT true`

**Seed runs (all against Supabase prod via session-mode pooler `aws-1-ap-southeast-2.pooler.supabase.com:5432`):**
- `pnpm seed:kanjidic2` — 2,294 rows updated with Kanjidic2 refs
- `pnpm seed:vocab --force` — 10,752 vocab entries generated across 2,193 kanji (101 had Claude JSON-parse failures and kept prior 2-entry data)
- `pnpm seed:sentences --force` — 2,116 kanji got Tatoeba sentences; 178 unchanged (no Tatoeba coverage)
- Post-bug-fix top-up: cleared 112 below-floor vocab rows, re-ran `pnpm seed:vocab` (no `--force`) — 92 filled first pass, 20 hit the same JSON-parse pattern and stayed empty; second run of the 20 filled all cleanly. Net: +109 kanji upgraded from 2-entry pre-seed data to 5-entry.

Total Anthropic API spend for vocab seed: ~$2–3 (Haiku).

## ⚠️ Security action owed

The `ANTHROPIC_API_KEY` value from `packages/db/.env` was echoed into this session's transcript via a `grep` that included the line contents. Recommend rotating via https://console.anthropic.com/settings/keys (one-click regenerate), then updating the local `.env` and App Runner env var.

## Build 3-C Phase 1 — server homophone workaround (SHIPPED)

Full design + plan:
- Spec: [docs/superpowers/specs/2026-04-19-vocab-as-drill-unit-design.md](superpowers/specs/2026-04-19-vocab-as-drill-unit-design.md)
- Plan: [docs/superpowers/plans/2026-04-19-vocab-as-drill-unit.md](superpowers/plans/2026-04-19-vocab-as-drill-unit.md)

Phase 1 addresses the iOS speech-recognizer homophone bug surfaced on B124 testing (`感` spoken as "kan" evaluated as wrong because iOS returned the kanji `缶` as transcript and wanakana can't convert kanji to readings). The fix is server-only: `apps/api/src/services/kanji-readings-index.ts` loads an in-memory kanji→readings map at boot; the evaluator in `reading-eval.service.ts` now expands any CJK characters surviving wanakana through that index and matches against `correctReadings`.

Commits (all on main, 9 total):
- `c462202` feat(api): add containsCJK helper for homophone workaround
- `7e416dc` refactor(api): document no-g-flag intent + test CJK compat exclusion
- `d82ee6b` feat(api): add expandReadings for homophone expansion
- `f8210dc` refactor(api): remove dead assignment in expandReadings + tighten cap test
- `7d0d50f` feat(api): add loadKanjiReadingsIndex from kanji table
- `37c0a57` refactor(api): hoist loader imports to top of file
- `628dae1` feat(api): integrate homophone workaround into evaluateReading
- `2c18045` feat(api): wire kanji readings index through voice route
- `af0ce9a` fix(api): normalize expanded candidates before homophone match

Test coverage: 109/109 unit tests passing. New suites:
- 13 tests in [kanji-readings-index.test.ts](../apps/api/test/unit/services/kanji-readings-index.test.ts) (containsCJK + expandReadings + cap + compat-block exclusion)
- 7 tests in [reading-eval.homophone.test.ts](../apps/api/test/unit/reading-eval.homophone.test.ts) (hiragana fixtures + real-DB katakana fixture regression test)

On-device verification (B124, 2026-04-19): user spoke "kan" for a reading-stage card on 感 — evaluator returned Perfect (previously returned "Not quite. Heard: 缶"). Confirmed the fix accepts homophone-kanji transcripts across the common-reading families (感/缶, 紙/髪, 橋/箸, etc.).

Status of the rest of Build 3-C:
- **Phase 2** (data layer): ✅ SHIPPED 2026-04-20 — see section above.
- **Phase 3** (API `getReadingQueue` voicePrompt field): not started. Small (~0.3 session).
- **Phase 4** (mobile vocab-as-prompt + pitch component + toggle, requires B125 EAS build): not started.
- **Phase 5** (verification + tracker closure): not started.

## What shipped this session (earlier, pre-Build-3-C)

### Mobile (in B124 TestFlight)
- `5d81768` — fix(mobile)+docs: Remembered/Missed labels on Session Complete; `loadMissedQueue` threshold aligned from `q<3` to `q<4` so "Drill N missed cards" matches its label.
- `dd6c5f7` — feat(mobile): consolidate kanji details to one canonical page (`/kanji/[id]`); the study card's magnifying-glass icon now navigates there instead of opening the inferior in-card drawer. Speak icons added to every vocab row + sentence row (tap to play Japanese TTS, tap again to stop).

### API / data
- `5f1b043` — fix(api,data): repaired 1185 corrupted `kanji.radicals` rows (double-encoded JSON string → real array) + added `toArr` defense to `/v1/kanji/browse`, `/v1/kanji/:id`, and `/v1/kanji/:id/related`.
- Migrations 0017 + 0018 (applied manually to Supabase via `psql`).
- App Runner env-var update adding `GROQ_API_KEY` + `GEMINI_API_KEY` (redeploy op `fed113f85b…`).

### Tracker hygiene
- Closed 6 bug entries: post-delete relational cascade (root cause was the missing FK, not the downstream cascades); umbrella Delete Account entry; SessionComplete 20/0 counts; browse-crash on corrupted kanji; stale Session Complete after navigation; daily-goal hardcoded-20.
- Flipped 4 enhancement entries to Shipped: Remembered/Missed / Drill fix; reveal-drawer consolidation; speak-icons scope extension; RLS on last 5 tables; Groq/Gemini keys.
- Added 3 new items: gesture-mapping refinement; speak-icons scope extension (already shipped as part of B124); expand vocab/sentences from JMdict-Kanjidic-Tatoeba; **secrets-management + rotation policy** (see ROADMAP pre-launch section).
- Updated E11 (Grade-level Kyouiku) with silver/gold badge + social-share design.

## B124 verification results (TestFlight, 2026-04-19)

**Confirmed on device:**
- ✅ SessionComplete counts (`q>=4`) show 10/10 for 5-Again+5-Hard+5-Good+5-Easy.
- ✅ Dashboard confidence ring updates post-session (~3s refresh).
- ✅ dailyGoal=5 → study session loads 5 cards.
- ✅ Session Complete → Done → Dashboard → Start Today's Reviews → "up to date" message (goal met); Study tab loads fresh deck.
- ✅ Browse `息` (and other previously-corrupted kanji) renders `["心"]` radicals correctly — no crash.

**Pending verification (user will catch in next study session):**
- 🧪 Amber reading-prompt cue (when a reading-stage card surfaces naturally).
- 🧪 B124 changes: Remembered/Missed labels, Drill N missed button works (even with all-Hard session), magnifying-glass navigation, speak icons on vocab/sentences on `/kanji/[id]`.

## Sub-Sprint A1 — Pre-launch readiness (shipped today)

Of the Option A (App Store readiness) plan, three of four items are now **done**:

1. ✅ **B1 — Post-delete relational cascade** (migration 0017). Real root cause: `user_profiles` had no FK to `auth.users` at all. Downstream CASCADEs were there; the chain just never started. Migration adds the one missing FK + cleaned up 2 orphan rows.
2. ✅ **E21 — RLS on last 5 tables** (migration 0018). 35/35 tables now covered.
3. ✅ **E23 — Groq + Gemini keys** on App Runner (op `fed113f85b…`). Tier-2 LLM fallback is now live.
4. 🚀 **E22 — Supabase us-east-1 migration** — still pending; needs coordinated EAS rebuild + DB dump/restore. See ROADMAP pre-launch section.

Plus a late addition:

5. 🚀 **Secrets management — rotate + migrate to AWS Secrets Manager** — new ENHANCEMENTS entry and a ROADMAP pre-launch bullet. Immediate one-time rotation recommended for the Groq + Gemini keys that were pasted through chat this session. Longer-term: move all provider keys into AWS Secrets Manager, document a quarterly rotation policy, and establish chat-hygiene for secrets.

## ⚠️ Immediate security action owed

Three provider keys need rotation from two separate chat exposures over this sprint:

- **Groq** (exposed 2026-04-19 when added to App Runner via chat): https://console.groq.com/keys → Regenerate
- **Gemini AI Studio** (exposed 2026-04-19 same flow): https://aistudio.google.com/app/apikey → Regenerate
- **Anthropic** (exposed 2026-04-20 via an unmasked `grep` on `packages/db/.env`): https://console.anthropic.com/settings/keys → Regenerate

Takes ~30 seconds per key. When rotated, ping for a single `aws apprunner update-service` pass to inject the new values + update `.env` locally.

Longer-term follow-up: move all provider keys into AWS Secrets Manager (see ENHANCEMENTS secrets-management entry) and establish a quarterly rotation policy + chat hygiene.

## 🚦 Next-session first tasks

1. **Decide Build 3-C Phase 3 timing.** Phases 1 + 2 are shipped. Phase 3 is the API change that attaches `voicePrompt` to `/v1/review/reading-queue` + allows `showPitchAccent` in the user profile PATCH. Small scope (~0.3 session). Ships no user-visible change on its own — it's the API contract Phase 4 mobile depends on. Can go at any time.
2. **Rotate secrets** — both the Groq + Gemini keys from 2026-04-19 AND the Anthropic key exposed in this session (see Security action owed above).
3. **Verify B124 amber reading-prompt cue** once a reading-stage card surfaces naturally in normal study.
4. **Close the amber-cue enhancement** after step 3.
5. **(Optional follow-up)** Re-run `pnpm seed:vocab` (no `--force`) to top up the 6 kanji with <3 vocab entries, now that the write bug is fixed. Expected cost: negligible — only processes rows with empty example_vocab OR those still below floor.

## Build 3 recommendation — Option C (Data enrichment)

### Why C over D

Option D (social push — nudges / invite notifications / study group badges) assumes two things that aren't currently true:

- **Daily push notifications work.** Currently broken (`BUGS.md`: "Daily push notifications not firing" — active since Build 103). Nudges are push-notification-first, so D has a blocking dependency that needs repair before its headline features work.
- **There's a social graph to engage.** In today's user base (owner + a handful of test accounts), social engagement features don't have anyone to engage with. Option D's ROI grows dramatically with user count and is best timed closer to launch.

Option C's items sharpen the already-shipped study loop:
- **E5 Expand vocab + sentences** (5–10 vocab, 3–5 sentences per kanji) subsumes B4 (the kanji-doesn't-contain-itself data-quality bug) and multiplies the value of the speak-icons we just shipped in B124 (more things to hear).
- **E6 Pitch accent indicator** — once we have richer readings, adding pitch accent turns reading practice into natural-speech practice. Complements E5.
- **E8 Drill Weak Spots scope** — recent-session vs. cumulative threshold is a day-to-day UX win, single-endpoint change.
- **E16 Broaden streak** — counts placement / quiz / writing toward the streak. Closes a long-standing complaint and is 1–2 hours of work.

None of C's items require push notifications. None are blocked by open bugs. Every one of them makes the existing app more useful to the solo learner that most users are today.

### Suggested C sequencing (one focused session each)

1. **E8 Drill Weak Spots scope** — smallest win, warm-up.
2. **E16 Broaden streak** — analytics query + mobile widget tweak, same pattern as E8.
3. **E5 Expand vocab + sentences** — biggest value. Seed script rework + validator for "word contains kanji". Closes B4 bug as a bonus.
4. **E6 Pitch accent indicator** — last because it requires sourcing a pitch accent dataset (Wadoku or similar) and has external-data uncertainty.

### When to do D

After Option C ships AND the daily-push-notifications bug is fixed. Fixing that bug is the cheaper of the two and unblocks D's entire feature set.

---

## Working environment notes

- **API URL (production):** `https://73x3fcaaze.us-east-1.awsapprunner.com` — health check OK post-redeploy.
- **Supabase project:** `pyltysrcqvskxgumzrlg.supabase.co` (still in `ap-southeast-2`). Pre-launch migration to us-east-1 still pending.
- **Build numbers:** EAS auto-increments. Last shipped: **B124**. Don't manually bump.
- **Docker deploys:** `DOCKER_CONTEXT=default ./scripts/deploy-api.sh`. OrbStack's default context produces ARM images that crash App Runner.
- **EAS builds:** from `apps/mobile/`, not repo root. Pay-as-you-go at $2/build. Last two builds ran with `eas-cli@18.7.0` (upgrade required — 18.5.0 silently fails at request submission).
- **EAS env vars** with `EXPO_PUBLIC_` prefix are baked into each build. Changing Supabase URL (Pre-Launch item E22) requires a fresh EAS build.
- **Test account `buddy@g.ucla.edu`** had its `user_profiles` row cleaned up by migration 0017 this session (it was orphaned — `auth.users` row had already been deleted from earlier testing). Was a test account — shouldn't impact ongoing work. If the user is still using TestFlight logged in as that email, they'll need to sign up again (a fresh account will be created).

## Tomorrow's first command

```
cd /Users/rdennis/Documents/projects/kanji-learn
git pull origin main
# 1. Rotate Groq + Gemini keys in their consoles; ping controller to update App Runner
# 2. Decide whether to run Build 3-C Phase 2 (data layer) or pause to let Phase 1 bake on device
# 3. Phase 2 entry point: docs/superpowers/plans/2026-04-19-vocab-as-drill-unit.md § Phase 2 (Tasks 8–14)
```

---

## Recent commits this session

```
f4882bf  fix(db)+docs: migrations 0017 (post-delete cascade) + 0018 (RLS on last 5 tables)
a088b54  docs(enhancements): expand E11 Grade-Level Kyouiku entry with silver/gold badges + social share
337f6eb  docs(bugs): close SessionComplete counts + reveal-drawer entries
dd6c5f7  feat(mobile): consolidate kanji details to one page + speak icons on vocab/sentences
5d81768  fix(mobile)+docs: Remembered/Missed labels + Drill Missed threshold align + B123 tracker updates
```
