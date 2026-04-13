# Session Handoff — 2026-04-13

## Current State

**Branch:** `feat/phase-1-quick-wins` merged to `main` via PR #3. Latest TestFlight build: **111**.

**Phase 2 Progress:**
- OAuth Social Login (Apple + Google) — ✅ Done, verified on TestFlight
- Remaining: Onboarding Tutorial, Dark/Light Theme, Heatmap Calendar, Splash Screen, About/Credits, Rebrand

## Next Task: Bug Fixes (B1–B7)

All bugs tracked in `ROADMAP.md` under "Known Bugs":

| # | Severity | Issue | Notes |
|---|----------|-------|-------|
| B1 | Critical | Push notifications never arrive | APNs key needs to be uploaded to expo.dev → Credentials → iOS → Push Notifications. Use the existing .p8 key (or create a new one for APNs). Backend cron + Expo push code looks correct — the blocker is missing APNs credential config. |
| B2 | Critical | Watch UserDefaults key mismatch | `WatchSessionManager.swift` writes `kl_rest_day`, `BackgroundRefreshHandler.swift:50` reads `kl_rest_day_raw`. Fix: change `kl_rest_day_raw` → `kl_rest_day` |
| B3 | High | `watchEnabled` flag never sent from iPhone to Watch | `auth.store.ts` `pushToWatch()` sends tokens/settings but not the watchEnabled flag |
| B4 | High | Accuracy metric on Dashboard may be inaccurate | Not yet investigated |
| B5 | High | Kanji card reveal: hint text missing "Easy" and right arrow | Not yet investigated |
| B6 | Medium | Text/background contrast too low | Theme colors in `apps/mobile/src/theme/index.ts` |
| B7 | Medium | Romaji toggle on kanji cards does nothing | Not yet investigated |

## Working Directory

The worktree at `/Users/rdennis/Documents/projects/kanji-learn-phase-1` is on branch `feat/phase-1-quick-wins`. Main repo is at `/Users/rdennis/Documents/projects/kanji-learn`. You may want to create a new branch for bug fixes (e.g. `fix/known-bugs`).

## Key Files

- **Roadmap:** `ROADMAP.md` (bugs, phases, enhancements)
- **OAuth spec:** `docs/superpowers/specs/2026-04-11-oauth-social-login-design.md`
- **OAuth plan:** `docs/superpowers/plans/2026-04-11-oauth-social-login.md`
- **OAuth helper:** `apps/mobile/src/lib/oauth.ts`
- **Auth store:** `apps/mobile/src/stores/auth.store.ts`
- **Theme:** `apps/mobile/src/theme/index.ts`
- **Watch background handler:** `apps/watch/KanjiLearnWatch/Services/BackgroundRefreshHandler.swift`
- **Apple JWT script:** `scripts/generate-apple-client-secret.js`

## Supabase Config (Manual, Already Done)

- Apple provider: configured with Service ID, Key ID, Team ID, client secret JWT (expires 2026-10-12)
- Google provider: configured with OAuth Client ID + secret
- Redirect URL: `kanjilearn://auth/callback`
- Auto-link accounts by email: enabled

## Build Notes

- EAS builds require `EXPO_NO_CAPABILITY_SYNC=1` to avoid Apple capability sync conflicts
- Current Expo SDK: 54. OAuth packages: `expo-web-browser@15.0.10`, `expo-auth-session@7.0.10` (SDK 54 compatible — do NOT use 55.x versions)
- `jest@30` + `ts-jest@29` version mismatch exists but works (minor item)
