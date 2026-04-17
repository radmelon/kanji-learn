# Session Handoff — 2026-04-17

## Current State

**Branch:** `main` — all feature work merged.
**Latest merge:** PR #6 `feat: tutor analytics sharing — full implementation` (merged 2026-04-17). This merge also carried the onboarding wizard (superseded PR #4) because tutor-analytics was branched on top of onboarding.
**Latest TestFlight build:** **B116** (iOS) — auto-submitted by EAS, Apple processing complete.
**API:** Deployed to App Runner `us-east-1` — all recent changes live (tutor report polish, color consistency, info tooltips, study-time cap, AI analysis fixes).

## What shipped this session

- Tutor analytics sharing feature (full lifecycle: invite → email → terms → report → notes → AI analysis)
- Report polish: confidence vs accuracy terminology, writing widget, stacked correct/incorrect bars (quiz volume + daily reviews), confidence-by-SRS-stage chart with min-threshold treatment, donut colors aligned to mobile theme, hover info tooltips, glossary intro card, AI analysis markdown fence stripping, UTC→local timezone conversion, server-side study-time cap, "Durably Retained" rename (was "Solidly Remembered")
- Onboarding wizard + learner profile (merged transitively)
- Bug fixes: rōmaji toggle verified fixed; tutor status response shape; AI analysis tier-3 premium gate
- Docs: ROADMAP reprioritized; BUGS.md and ENHANCEMENTS.md updated; Japanese report language option queued; streak-broadening enhancement queued

---

## 🚨 Priority 1 — OAuth Regression (BLOCKER)

**Symptom:** Apple and Google Sign-In no longer work in B116. Blocks new user onboarding and broader TestFlight testing.

**Context:**
- OAuth was verified working in B111 on 2026-04-13 (ROADMAP Phase 2 #5, commit `a3ace78`).
- Recent relevant commit: `a63ffd0 fix: fix JWT signature corruption in Apple client secret generator` — worth reviewing as a potential suspect.
- Tracked as high-priority bug at the top of `BUGS.md`.

**Investigation plan:**
1. Reproduce in TestFlight B116; capture console/device logs.
2. Check Supabase auth logs (Authentication → Logs in the Supabase dashboard) for failed OAuth exchanges. Look for 400/401 responses and note the error message.
3. Verify redirect URIs match between Supabase provider settings and the Apple/Google developer consoles.
4. Confirm bundle ID `com.rdennis.kanjilearn2` is still the one registered for Sign in with Apple at https://developer.apple.com.
5. Check `GoogleService-Info.plist` is in the iOS build and the OAuth consent screen in Google Cloud is still configured.
6. If the Apple client secret uses a generated JWT with an expiring key, verify the key isn't expired.

**Affected files (likely):**
- `apps/mobile/src/lib/auth.ts` / `apps/mobile/src/hooks/useAuth.ts`
- `apps/mobile/app/(auth)/` screens
- `apps/mobile/app.json` (URL schemes, entitlements, `expo-apple-authentication` config)
- Supabase dashboard: Authentication → Providers
- Apple client secret generation script (if one exists in the repo)

**Effort:** M · **Impact:** High · **Status:** Blocking broader testing

---

## Priority 2 — Delete Account (Phase 2 #12)

**Why now:** Required by App Store Review Guideline 5.1.1 — apps that allow account creation must offer in-app account deletion. Cannot ship publicly without this.

**Scope:**
- UI: add a "Delete Account" destructive button in the Profile tab, behind a confirmation modal that requires typing "DELETE" or similar friction.
- Backend: new API route (e.g. `DELETE /v1/user/me`) that calls `supabase.auth.admin.deleteUser(userId)`. The existing FK cascades on `user_profiles.id` should clean up `user_kanji_progress`, `review_logs`, `review_sessions`, `daily_stats`, `writing_attempts`, `voice_attempts`, `kl_test_sessions`, `kl_test_results`, `learner_profiles`, `learner_identity`, `learner_connections`, `tutor_shares`, `tutor_notes`, `tutor_analysis_cache`, `placement_sessions`, `placement_results`, `friendships`, `mnemonics`, `buddy_*`, and the rest of user-owned tables.
- Post-delete: sign the user out locally and return to the login screen.
- Verify: run the flow end-to-end, confirm the auth.users row is gone in Supabase, and that no orphaned rows remain in any user-keyed table.

**Effort:** M · **Impact:** High (launch blocker)

---

## Priority 3 — Rebrand: Kanji Learn → Kanji Buddy (Phase 2 #11)

**Why now:** v1 of the app is nearly feature-complete; this is the natural "v2 launch" moment. Should land together with splash polish (#9) and about/credits (#10) as a coordinated release.

**Touches:**
- `apps/mobile/app.json`: `name`, `slug` (careful — changing slug affects Expo project URL)
- `apps/mobile/app.config.ts` if one exists
- iOS bundle display name (`CFBundleDisplayName`)
- Watch app target name and display name
- App Store listing (separate step via App Store Connect)
- Hardcoded strings throughout the app — sign-in/sign-up headers, splash screen, email templates in `apps/api/src/templates/*.eta`, notification copy, tutor report title, etc.
- `README.md` and any other docs that reference the old name

**Effort:** M · **Impact:** Med · **Caveat:** Bundle ID cannot change without re-submitting to App Store as a new app, so keep `com.rdennis.kanjilearn2`.

---

## Priority 4 — Splash Screen Polish (Phase 2 #9) + About/Credits (Phase 2 #10)

Natural companions to the rebrand — share branding imagery and messaging.

**#9 Splash:** solid background color (not gradient), longer display duration, add branding imagery (logo/wordmark). Current splash in `apps/mobile/assets/images/splash.png`.

**#10 About/Credits:** new screen accessible from Profile. Include app logo, tagline, version + build, credits for Tatoeba (CC-BY 2.0 sentences), KanjiVG (stroke order), wanakana, and any other open-source data sources. Link to privacy policy and terms.

**Effort:** S each · **Impact:** Med / Low

---

## Priority 5 — Dark / Light Theme Toggle (Phase 2 #7)

**Scope:** Manual toggle + system-default option. Touches every screen — easier to do before adding more. The existing `apps/mobile/src/theme/index.ts` uses a single dark color palette; needs to become a theme provider with two palettes.

**Effort:** M · **Impact:** High (most-requested UX feature)

---

## Priority 6 — Heatmap Calendar View (Phase 2 #8)

GitHub-style contribution heatmap showing daily review count over the past year. Pure frontend; data source is existing `daily_stats` table.

**Effort:** M · **Impact:** High (retention/motivation)

---

## Other outstanding items (not Phase 2)

See `BUGS.md` and `ENHANCEMENTS.md` for the complete list. Selected highlights:

**Active bugs:**
- Study-time timer doesn't pause on app background (server-side cap already deployed as a guard — client fix still needed)
- Scroll-triggers-swipe on revealed card + reveal-all drawer (fixes shipped in B104/B105, awaiting verification)
- `TOTAL_JOUYOU_KANJI` constant wrong (2,294 → 2,136) — XS effort, affects completion %
- Daily push notifications not firing — root cause TBD despite EventBridge rule

**Pre-launch:**
- Configure Groq & Gemini API keys on App Runner (unblocks tier 2 LLM fallback)
- Migrate Supabase DB from ap-southeast-2 to us-east-1 (removes ~200ms cross-region DB latency)
- Enable RLS on last 5 tables: `placement_sessions`, `placement_results`, `tutor_shares`, `tutor_notes`, `tutor_analysis_cache`

**Report enhancements (queued):**
- Japanese language option for tutor report (`?lang=ja`)
- Broaden streak to count placement tests, quizzes, writing attempts (currently only SRS reviews)

---

## Working environment notes

- **Worktree:** `/Users/rdennis/Documents/projects/kanji-learn-phase-1` exists on stale `feat/phase-1-quick-wins` branch. Harmless; contains only a duplicate of an already-merged commit. Can be removed with `git worktree remove` but not required.
- **Build numbers:** EAS auto-increments on each build. Last was B116. Don't manually bump; let EAS do it.
- **Docker deploys:** API is deployed to App Runner `us-east-1` via `kanji-learn-api` ECR repo. Always use `docker --context=default buildx build --platform linux/amd64 ...` — OrbStack produces ARM images that crash App Runner with exec format error.
- **SES:** Domain `kanjibuddy.org` is verified in `us-east-1`. Still in sandbox mode — can only send to pre-verified recipients until SES production access is requested (noted in BUGS.md context).
- **Database:** Supabase in `ap-southeast-2` (to be migrated). Connection via `DATABASE_URL` in `apps/api/.env`.

## Tomorrow's first command

```
cd /Users/rdennis/Documents/projects/kanji-learn
git pull origin main
# Then start with the OAuth regression investigation
```
