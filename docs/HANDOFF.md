# Session Handoff — 2026-04-17 (evening)

## Current State

**Branch:** `main` — all session work merged.
**Latest TestFlight build:** **B120** (iOS) — auto-submitted by EAS, Apple processing as of session end. Apple email confirmation expected ~15 min after submission.
**API:** Deployed to App Runner `us-east-1` with the new `DELETE /v1/user/me` route + the `GET /v1/user/profile` self-heal.
**DB:** Migrations 0015 (restored `handle_new_user` trigger) and 0016 (added `learner_identity → user_profiles` FK with cascade) applied manually in Supabase. Backfill of `onboarding_completed_at` for any remaining null rows applied.

## What shipped this session

### Bug fixes
- **OAuth post-login navigation regression** (B116). Root cause: `useProfile` race + dropped `on_auth_user_created` Postgres trigger. Three fixes: hook now subscribes to session changes; API self-heals missing `user_profiles` rows; migration 0015 restores the trigger. UX: clarified social-button language ("Continue with…", subtext indicating new-or-returning).
- **Onboarding wizard wiped existing learner interests** on completion. Removed unconditional `interests: []` from the PATCH payload.
- **Dashboard greeting drifted from edited display name.** Now reads from `useProfile().displayName` (same source as Profile tab) instead of stale `auth.users.raw_user_meta_data`.
- **`learner_identity` + 6 UKG tables would have orphaned on account delete.** Caught in pre-ship code review. Migration 0016 adds the missing FK so the cascade chain extends through every PII-bearing table.

### New feature: Delete Account (Phase 2 #12, App Store 5.1.1)
- Spec: [docs/superpowers/specs/2026-04-17-delete-account-design.md](docs/superpowers/specs/2026-04-17-delete-account-design.md)
- Plan: [docs/superpowers/plans/2026-04-17-delete-account.md](docs/superpowers/plans/2026-04-17-delete-account.md)
- API: `DELETE /v1/user/me` calls `supabaseAdmin.auth.admin.deleteUser(userId)`; cascades through `auth.users → user_profiles → learner_identity → everything else`.
- Mobile: Profile tab → "Danger zone" → `DeleteAccountModal` (typed-`DELETE` confirmation) → `/deleted` farewell screen → sign-in.
- Hard delete only (no grace period). No SES email (still sandboxed). Watch app's stale token recovery is out of scope (relies on existing 401 handling).
- Integration test at `apps/api/test/integration/user-delete.test.ts` covers the cascade through `learner_profiles`, `user_kanji_progress`, `learner_identity`, `learner_profile_universal`. Requires `TEST_DATABASE_URL`.

### Docs cleanup
- ROADMAP.md: Phase 2 status flips for OAuth (✅ done) and Delete Account (✅ code complete, verify pending). Reordered to put Rebrand (#11) at the top of "Pending." Dropped duplicate header row + stale Known Bugs section (now points to BUGS.md). Summary item counts corrected (Phase 2: 8, Phase 4: 5, Total: 31).
- BUGS.md: closed 5 fixed bugs with detailed root cause + fix notes (OAuth regression, interests wipe, Dashboard greeting drift, learner_identity orphan, missing trigger). Added one open entry: "Delete Account TestFlight verification pending".
- ENHANCEMENTS.md: marked OAuth + Onboarding shipped; added Delete Account entry.

---

## 🚦 Pickup task — Verify B120 in TestFlight, then start Rebrand

Once B120 lands in TestFlight (~15 min after build completes), run a quick verification pass:

### Verification checklist

1. **Dashboard greeting** — should now show your `user_profiles.displayName`. Edit your name in Profile tab → return to Dashboard → greeting updates on next render.
2. **Sign in / sign out** — both Google + Apple + email/password should land on `/(tabs)`. No flash of sign-in screen on cold start.
3. **Delete Account end-to-end:**
   - Sign up a throwaway account (Google or email/password).
   - Complete onboarding, decline placement, do a few SRS reviews, optionally set up a fake tutor share.
   - Profile tab → "Danger zone" → "Delete account" → type `DELETE` → confirm.
   - Spinner → farewell screen → tap OK → sign-in.
   - Sign up again with the same email → should be a fresh account with zero leftover state.
4. **Supabase orphan check** — run in SQL editor against the throwaway email:
   ```sql
   SELECT id FROM auth.users WHERE email = 'throwaway@example.com';
   SELECT * FROM learner_identity WHERE email = 'throwaway@example.com';
   SELECT COUNT(*) FROM user_profiles up
     LEFT JOIN auth.users au ON au.id = up.id
     WHERE au.id IS NULL;
   -- All three: expect 0 rows / 0 count.
   ```

If anything misfires, see BUGS.md "Delete Account flow — TestFlight verification pending" entry — once the test passes, move it to Fixed.

---

## Phase 2 — what's next

Per ROADMAP.md Phase 2 (refreshed this session):

| Order | # | Item | Effort | Notes |
|-------|---|---|---|---|
| 1 | 11 | **Rebrand: Kanji Learn → Kanji Buddy** | M | Coordinate with #9 + #10 as the v1.0 "Kanji Buddy" launch. Bundle ID stays `com.rdennis.kanjilearn2` (cannot change without re-submitting as a new app). |
| 2 | 9 | Splash Screen Polish | S | Solid background color (not gradient), longer display duration, branding imagery. |
| 3 | 10 | About / Credits Page | S | New screen from Profile. App logo, tagline, version + build, credits (Tatoeba CC-BY 2.0, KanjiVG, wanakana). Privacy + terms links. |
| 4 | 7 | Dark / Light Theme Toggle | M | System default + manual toggle. Touches every screen — easier before adding more. Existing `theme/index.ts` is dark-only; needs a provider with two palettes. |
| 5 | 8 | Heatmap Calendar View | M | Pure frontend; data source is existing `daily_stats` table. |

**Suggested first move:** brainstorm/spec the Rebrand bundle (#11 + #9 + #10) as a single design — they share branding assets and copy.

---

## Working environment notes

- **API URL (production):** `https://73x3fcaaze.us-east-1.awsapprunner.com`
- **Supabase project:** `pyltysrcqvskxgumzrlg.supabase.co` (still in `ap-southeast-2` — migration to us-east-1 is queued in ENHANCEMENTS.md as Pre-Launch).
- **Build numbers:** EAS auto-increments. Last shipped: B120. Don't manually bump.
- **Docker deploys:** API → App Runner via `./scripts/deploy-api.sh`. Run as `DOCKER_CONTEXT=default ./scripts/deploy-api.sh` from the repo root — OrbStack's default context produces ARM images that crash App Runner.
- **EAS builds:** must run from `apps/mobile/` (not the repo root) or you'll get "EAS project not configured". The repo has an `eas.json` at root that confuses non-interactive CLI calls.
- **EAS credits:** at 100% of the included monthly tier. Additional builds bill at pay-as-you-go rates. Bundle small fixes when possible.
- **SES:** `kanjibuddy.org` verified in `us-east-1`, still in sandbox mode. Tutor email + future delete-confirmation email both blocked on production access.
- **Database connection:** `DATABASE_URL` in `apps/api/.env`.

## Tomorrow's first command

```
cd /Users/rdennis/Documents/projects/kanji-learn
git pull origin main
# 1. Verify B120 in TestFlight per the checklist above
# 2. Then brainstorm the Rebrand bundle (Phase 2 #11 + #9 + #10)
```

---

## Recent commits (this session)

```
1f7b227 docs(roadmap): correct Summary item counts (Phase 2: 8, Phase 4: 5)
6ec85ff docs(roadmap): drop duplicate header row + stale Known Bugs section
fe23ee3 docs: update trackers after OAuth fix + Delete Account ship
9ea7b8b fix(mobile): use profile.displayName for Dashboard greeting
817f596 fix(db): cascade-delete learner_identity + UKG tables on account delete
510804e test(api): verify user_profiles delete cascade
60770d8 feat(mobile): add Danger zone with Delete account to Profile tab
f5cfbe6 feat(mobile): add post-deletion farewell screen + route guard
3ca94c2 feat(mobile): add DeleteAccountModal with typed-DELETE confirmation
31697b5 feat(mobile): add deleteAccount() to auth store
0a65266 feat(api): add DELETE /v1/user/me for account deletion
167dcf3 feat(api): add isolated Supabase admin client for privileged ops
87a584b chore(api): add @supabase/supabase-js dependency
9abc3ae style(api): use .js extension on env import for consistency
282b8f9 chore(api): promote SUPABASE_URL into validated env schema
3bff2be docs: add delete account implementation plan
cf3a05f docs: add delete account design spec
bc4a226 fix(onboarding): stop wiping existing learner interests on completion
1937da7 fix(auth): unblock post-OAuth navigation + heal missing profiles
```
