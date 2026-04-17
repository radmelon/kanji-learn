# Session Handoff — 2026-04-14

## Current State

**Branch:** `feat/onboarding-tutorial` (Phase 2, Item 6). All 12 tasks complete. Not yet merged to main — pending final user sign-off on TestFlight.

**Latest TestFlight build:** 112 (build 113 mentioned during testing — may be the same build, confirm in App Store Connect)

## Phase 2 Progress

| Item | Feature | Status |
|------|---------|--------|
| 5 | OAuth Social Login (Apple + Google) | ✅ Done |
| 6 | Onboarding Tutorial + Questionnaire | ✅ Done — all 12 tasks shipped |
| 7 | Dark/Light Theme Toggle | Pending |
| 8 | Heatmap Calendar View | Pending |
| 9 | Splash Screen Polish | Pending |
| 10 | About/Credits Page | Pending |
| 11 | Rebrand: Kanji Learn → Kanji Buddy | Pending |
| 12 | Delete Account (App Store compliance) | Pending — required before public release |

## What Was Fixed This Session

### "Failed to save. Please try again." — Learning Profile save in Profile tab
Root cause was threefold:
1. **`@fastify/formbody` version mismatch** — package.json had `^8.0.2` (requires Fastify 5), but the project uses Fastify 4. Downgraded to `^7.0.0`.
2. **Docker image built for ARM** (Apple Silicon M-series Mac) — App Runner runs `linux/amd64`. All previous build attempts failed with `exec format error`. Fixed by always building with `--platform linux/amd64`.
3. **Production migration not applied** — `ALTER TABLE learner_profiles ADD COLUMN IF NOT EXISTS country TEXT;` was applied manually by user in Supabase Dashboard.

**Fix applied:** New `linux/amd64` image pushed to ECR (`087656010655.dkr.ecr.us-east-1.amazonaws.com/kanji-learn-api:latest`), deployed to App Runner. Endpoint `PATCH /v1/user/learner-profile` confirmed live (returns 401 without auth). Migration applied. ✅

### Important: Future Docker builds
**Always build with `--platform linux/amd64`** when targeting App Runner:
```bash
docker build --platform linux/amd64 -f apps/api/Dockerfile -t 087656010655.dkr.ecr.us-east-1.amazonaws.com/kanji-learn-api:latest .
docker push 087656010655.dkr.ecr.us-east-1.amazonaws.com/kanji-learn-api:latest
aws apprunner start-deployment \
  --service-arn "arn:aws:apprunner:us-east-1:087656010655:service/kanji-learn-api/470f4fc9f81c407e871228fb9dd93654" \
  --region us-east-1
```

## Pending Verification

- [ ] User to confirm Learning Profile **Save** now works on TestFlight (was failing with "Failed to save. Please try again.")
- [ ] Kill/relaunch app to confirm saved values load back correctly
- [ ] Once confirmed — **merge `feat/onboarding-tutorial` → main**

## Next Steps (after merge)

1. **Phase 2, Item 7** — Dark/Light Theme Toggle
2. Or address remaining known bugs from ROADMAP.md (B1–B7)

## Known Bugs (unresolved)

| # | Severity | Issue | Notes |
|---|----------|-------|-------|
| B1 | Critical | Push notifications never arrive | APNs key not configured in expo.dev credentials |
| B3 | High | `watchEnabled` flag never sent from iPhone to Watch | `auth.store.ts` `pushToWatch()` — watchEnabled is passed now (fixed TypeScript error) but needs Watch-side verification |
| B4 | High | Accuracy metric on Dashboard may be inaccurate | Not investigated |
| B5 | High | Kanji card reveal: hint text missing "Easy" and right arrow | Not investigated |
| B6 | Medium | Text/background contrast too low | `apps/mobile/src/theme/index.ts` |
| B7 | Medium | Romaji toggle on kanji cards does nothing | Not investigated |
| B8 | High | New user onboarding skipped — missing profile on first sign-up | Logged in memory |
| B9 | High | Local API URL in TestFlight build | Logged in memory |
| B2 | Critical | Watch UserDefaults key mismatch — **FIXED** in prior session | `BackgroundRefreshHandler.swift:50` `kl_rest_day_raw` → `kl_rest_day` |

## Infrastructure

- **API:** AWS App Runner — `https://73x3fcaaze.us-east-1.awsapprunner.com`
- **Service ARN:** `arn:aws:apprunner:us-east-1:087656010655:service/kanji-learn-api/470f4fc9f81c407e871228fb9dd93654`
- **ECR repo:** `087656010655.dkr.ecr.us-east-1.amazonaws.com/kanji-learn-api:latest`
- **DB:** Supabase project `pyltysrcqvskxgumzrlg` (ap-southeast-2)
- **Auto-deploy:** DISABLED — must manually build/push/trigger as above

## Key Files

- **Roadmap:** `ROADMAP.md`
- **Auth store:** `apps/mobile/src/stores/auth.store.ts`
- **Theme:** `apps/mobile/src/theme/index.ts`
- **Onboarding screen:** `apps/mobile/app/onboarding.tsx`
- **Nav gate:** `apps/mobile/app/_layout.tsx`
- **Profile tab:** `apps/mobile/app/(tabs)/profile.tsx`
- **Learner profile hook:** `apps/mobile/src/hooks/useLearnerProfile.ts`
- **Profile hook:** `apps/mobile/src/hooks/useProfile.ts`
- **Onboarding content:** `apps/mobile/src/config/onboarding-content.ts`
- **Learner profile API route:** `apps/api/src/routes/learner-profile.ts`
- **API server:** `apps/api/src/server.ts`
- **DB schema:** `packages/db/src/schema.ts`
- **Migration (applied):** `packages/db/supabase/migrations/0013_onboarding_setup.sql`
