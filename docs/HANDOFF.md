# Session Handoff — 2026-04-19 (evening)

## Current State

**Branch:** `main` — all session work merged and pushed. Local and origin are in sync.
**Latest TestFlight build:** **B124** (iOS) — auto-submitted to App Store Connect 2026-04-19 08:12 PT. Code consolidates the kanji details page + adds speak icons to vocab/sentences; Remembered/Missed labels; "Drill N missed cards" threshold fix.
**API:** App Runner `us-east-1` — two successful deploys this session.
- op `03b663dd…` — toArr defense on kanji routes (paired with 1185-row radicals repair).
- op `fed113f85b…` — Groq + Gemini env vars now injected; health check HTTP 200 in 470ms.
**DB:** two migrations applied to prod 2026-04-19.
- `0017_user_profiles_auth_users_cascade.sql` — adds missing FK so account deletes fully cascade through friendships / tutor_shares / placement / daily_stats / review_logs / learner_identity. Deleted 2 pre-existing orphan `user_profiles` rows as part of the apply.
- `0018_rls_placement_tutor_tables.sql` — enables RLS + authenticated-user + service_role policies on `placement_sessions`, `placement_results`, `tutor_shares`, `tutor_notes`, `tutor_analysis_cache`. RLS coverage now **35 / 35** public tables.

## What shipped this session

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

The Groq + Gemini API keys added to App Runner today came through this chat transcript. Recommended: **rotate both once, post-session**, via the respective provider consoles:

- Groq: https://console.groq.com/keys → Regenerate
- Gemini (AI Studio): https://aistudio.google.com/app/apikey → Regenerate

Takes ~30 seconds per key. When rotated, I can update App Runner via `aws apprunner update-service` in a single pass.

## 🚦 Next-session first tasks

1. **Verify B124 on device** — the four items in the "pending verification" block above. Should all just work; no expected regressions.
2. **Rotate Groq + Gemini keys** (security hygiene from today) — one-shot action, not a whole session.
3. **Pick Build 3 direction** — the planning board had four options (A = shipped today, B = core UX, C = data enrichment, D = social push). Controller's recommendation is **Option C** (see below).
4. **Close the amber-cue enhancement** once a reading-stage prompt surfaces.

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
# 1. Verify B124 items on device (4 checks above)
# 2. Rotate Groq + Gemini keys in their consoles; ping controller to update App Runner
# 3. Begin Build 3 Option C — start with E8 Drill Weak Spots scope refinement
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
