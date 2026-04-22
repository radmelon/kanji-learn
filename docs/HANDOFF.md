# Session Handoff — 2026-04-21

## TL;DR

Three bugs landed this session: **Bug 1** (Watch ignoring the user's Daily Review Goal, plus a hardcoded 10-card session), **Bug 2** (missing Hadamitzky-Spahn citation on kanji details), and **Bug 3** (multi-device push fan-out with per-friendship mute). All three shipped together in **B127**, TestFlight-submitted end of session. User foreshadowed the on-device experience: *"looks very good. No bugs discovered, yet."* Next session opens with formal B127 verification.

## Current state

- **Branch:** `main` at `af5d552`. `origin/main` in sync. Feature branch `feature/bug3-multi-device-push` deleted locally.
- **TestFlight build this session:**
  - **B127** — triple-bug bundle (Watch daily-goal pipeline, H-S citation, multi-device push + per-mate mute).
    - Build ID: `4641b5ed-85a6-4235-b31f-0b764b361fb7`
    - Submission ID: `929a3681-014e-443f-9d66-2cd5f45910df`
    - Apple processing finished mid-session; ready for installation. Bucky is standing by in Japan to update.
- **Prod DB:** migration `0021_push_tokens_and_mate_mute.sql` applied. Adds `user_push_tokens` (id, user_id, token, platform, created_at) with self-scoped RLS + service_role bypass. Drops `user_profiles.push_token`. Adds `requester_notify_of_activity` + `addressee_notify_of_activity` booleans to `friendships` (default true).
- **API deploys this session:** `33cbc159afdf4543b634c5f0d9042701` — Build 3 full rollout. Image digest `sha256:f8441277…`. Post-deploy health 200; all three new endpoints return 401 (not 404): `POST/DELETE /v1/push-tokens`, `PATCH /v1/social/friends/:friendId`.
- **Prod API URL:** `https://73x3fcaaze.us-east-1.awsapprunner.com` — healthy.

---

## What shipped today

### Bug 2 — Hadamitzky-Spahn citation

One-line add to the kanji details References card footer. The cross-reference card already displayed the H-S index (from commit `d0247f1`), but the citation footer still only credited Nelson and Morohashi. Now reads: *"Hadamitzky-Spahn: Wolfgang Hadamitzky & Mark Spahn, Kanji & Kana (1981; rev. eds.)"*. Commit `5d900a0`.

### Bug 1 — Watch honors the user's Daily Review Goal

Three coupled issues, fixed as one commit (`23ec881`):
- **Cache schema mismatch** — `profile.tsx` wrote `kl:profile_cache` as `{ data: UserProfile }` but `auth.store.ts`'s Watch-sync reader expected `{ dailyGoal, reminderHour, restDay }` at the top level. Every Watch sync therefore fell back to `dailyGoal=20` regardless of the user's actual setting. Fix: unwrap `.data` in the reader.
- **No re-sync on profile save** — `save()` PATCHed the server and updated React state but neither refreshed the cache nor pinged the Watch. Fix: after a successful PATCH, write the cache and call a new `syncToWatch()` action.
- **Hardcoded 10-card Watch session** — `StudyViewModel.swift` called `fetchQueue(limit: 10)` regardless of user preference. Fix: read `dailyGoal` from UserDefaults (populated by the Watch-connectivity bridge). Home hero now shows "`N` of `M` today" and "All caught up" at zero.

Follow-up filed (separate task): `todayReviewed` needs to be populated on `/v1/review/status` so the Watch home hero actually decrements across sessions when the backlog exceeds the goal. Not in B127.

### Bug 3 — Multi-device push + per-friendship mute

14 commits on `feature/bug3-multi-device-push`, merged fast-forward into main. Full design at [docs/superpowers/specs/2026-04-21-multi-device-push-design.md](superpowers/specs/2026-04-21-multi-device-push-design.md). Implementation plan at [docs/superpowers/plans/2026-04-21-multi-device-push.md](superpowers/plans/2026-04-21-multi-device-push.md). Executed via subagent-driven-development with spec + code review gates between each task.

**Schema:** new `user_push_tokens` table replaces the single `user_profiles.push_token` column. Per-friendship mute stored as two booleans on the existing directed `friendships` row — `requester_notify_of_activity` and `addressee_notify_of_activity` — so each side controls their own preference independently.

**API:**
- `POST /v1/push-tokens` (idempotent on `(user_id, token)`) and `DELETE /v1/push-tokens/:token` (URL-encoded) replace the prior `PATCH /v1/user/profile { pushToken }`. Validates Expo token format + platform enum.
- `PATCH /v1/social/friends/:friendId` with `{ notifyOfActivity: boolean }` — handler auto-detects whether caller is requester or addressee of the friendship row and writes the matching column. `GET /v1/social/friends` now projects `notifyOfActivity` from the caller's perspective.
- `sendToUserTokens(userId, message)` helper in `NotificationService` — reads all tokens, sends ONE batched Expo call, synchronously prunes tokens that ticket with `DeviceNotRegistered` / `InvalidCredentials` / `MessageTooBig`. All three production push paths (`notifyStudyMates`, `sendDailyReminders`, `sendRestDaySummaries`) swapped to use it.
- Dead `sendToUser` + `sendMessages` helpers removed after the swap was complete.
- `PATCH /v1/user/profile` no longer accepts `pushToken` — silently stripped by Zod's default.

**Mobile:**
- `usePushNotifications` POSTs to the new endpoint on launch and persists the token to `kl:last_push_token`.
- `signOut` best-effort DELETEs the stored token before clearing the Supabase session. Swallows network errors; receipt pruning is the safety net. `deleteAccount` unchanged — cascade handles cleanup.
- Study Mates panel: each accepted-friend row gains a bell icon (right edge). Tap flips `notifyOfActivity` via the new PATCH with optimistic UI + revert on error. Dimmed with a caption when master `notificationsEnabled` is off. Pending requests don't get a bell.

**Test coverage:** ~17 new tests across Tasks 2-6 (push-tokens routes, sendToUserTokens fan-out + pruning, notifyStudyMates per-mate mute, daily + rest-day fan-out, PATCH + GET social projection). API suite: 199/200 passing — the one failing test (`user-delete.test.ts` `learner_identity_pkey` duplicate) is pre-existing and verified unchanged through all 14 branch commits.

---

## Minor follow-ups from Bug 3 review (non-blocking)

Flagged during the final code review. All fine at 2-user scale; worth filing separately when the window opens.

- `apps/api/test/helpers/test-app.ts` — `FastifyRegisterOptions<Record<string, never>>` rejects `{ prefix: '/v1/social' }` at the type level. Tests pass at runtime; the typecheck error is in `social-mute.test.ts:25`. Fix: loosen to `FastifyRegisterOptions<any>` or parameterize with `{ prefix: string }`.
- No test yet covers the defensive `LIMIT 100` cap in `sendToUserTokens`. Fix: insert 101 rows, assert `tickets.length === 100`.
- No mobile test covers the bell toggle's optimistic-revert path. Fix: RTL test with a mocked `api.patch` that throws.
- `sendDailyReminders` / `sendRestDaySummaries` fan out per-user (one Expo call per recipient) rather than batching across recipients. Fine at tens of users; revisit at scale.
- `mateNotifyCache` is bounded by a write-time 24h sweep but has no hard size cap.
- Vestigial `apps/lambda/daily-reminders/` — the zip exists but no EventBridge rule deploys it. The actual cron runs in-API at `cron.ts:15`. Should be removed for clarity.

Also carry-forward from earlier in the session: **the daily-reminder "miss me when I've studied" filter** at [notification.service.ts:126](../apps/api/src/services/notification.service.ts) is working as designed but effectively suppresses reminders for users who study every day. Product question Buddy planned to pressure-test with Bucky before deciding whether to change the behavior.

---

## ⚠️ Security actions owed (unchanged — carry forward)

Seven keys still pending rotation from the prior sprint. Bug 3 work added no new secrets.

| Key | Regenerate |
|---|---|
| `GROQ_API_KEY` | https://console.groq.com/keys |
| `GEMINI_API_KEY` | https://aistudio.google.com/app/apikey |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys |
| `DATABASE_URL` password | Supabase → Database → Reset password |
| `INTERNAL_SECRET` | `openssl rand -hex 32` locally |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API → service_role → Regenerate |
| `SUPABASE_JWT_SECRET` | Supabase → API → JWT Secret ⚠️ **kicks all testers off — defer until ready** |

Rotation flow: Buddy regenerates → updates `apprunner-env.json` in his own terminal → runs `aws apprunner update-service` himself → pings Claude for health check + provider-exercising smoke calls.

Long-term fix tracked under ROADMAP + ENHANCEMENTS "Secrets Management — SSM Parameter Store".

---

## 🧪 On-device verification checklist for B127

**Bug 2 — H-S citation** (smallest, confirm first):
- [ ] Any kanji details page → References card footer shows Nelson, Hadamitzky-Spahn, and Morohashi citations.

**Bug 1 — Watch daily goal:**
- [ ] Profile set to dailyGoal = 5 (or whatever the user's goal is).
- [ ] Watch home hero shows "`5` of `5` today" (replace 5 with actual goal), not the old "20".
- [ ] Start Study → session presents exactly `dailyGoal` cards, not 10.
- [ ] Complete the session → hero transitions to "All caught up" (when server backlog ≤ goal) or continues to show the remaining count (when backlog > goal — known limitation, `todayReviewed` follow-up).

**Bug 3 — multi-device push + per-mate mute** (the headliner):
- [ ] iPhone launch: console log `[Push] Token registered: ExponentPushToken[…]`.
- [ ] iPad launch: same log; verify two rows in prod:
  ```
  psql "$DATABASE_URL" -c "SELECT platform, created_at FROM user_push_tokens WHERE user_id = '<your id>' ORDER BY created_at DESC;"
  ```
- [ ] Bucky submits a review → **both** iPhone and iPad banner within ~5s. Watch also banners via iOS auto-forward from iPhone.
- [ ] Profile → Study Mates → Bucky's row shows a filled bell icon on the right edge.
- [ ] Tap the bell → icon flips to outline (muted), optimistic. Check prod: `addressee_notify_of_activity` (or `requester_notify_of_activity`, whichever side Buddy is) flipped to `false` on the friendship row.
- [ ] Bucky submits another review (wait for the 24h cap to lapse OR accept the cap suppresses it anyway) → no banner.
- [ ] Tap bell back on → next mate alert arrives as expected.
- [ ] Sign out on iPad → iPad row deleted from `user_push_tokens`. Bucky submits → only iPhone banners.
- [ ] Turn master `notificationsEnabled` off → bells in Study Mates dim + caption "Turn on notifications above to control mate alerts per friend" appears.

**Pre-existing items that B127 does not change** — still verify if the user wants:
- [ ] Amber reading-prompt cue on a reading-stage card (colors.accent path). Outstanding from B121.

---

## 🚦 Next-session first tasks

1. **Walk the B127 verification checklist above** on both iPhone and iPad. Coordinate with Bucky so the mate-alert flow can be exercised.
2. **If all pass:** close these tracker entries: Bug 1/Watch daily goal, Bug 2/H-S citation, Bug 3/multi-device push, and the separate "per-mate mute control" ENHANCEMENTS idea surfaced during Bug 3 brainstorm.
3. **If anything regresses:** queue fixes, evaluate whether to cut B128 (~$2) or bundle with other pending work.
4. **File the minor follow-ups** listed above as their own tracker entries or spawned tasks.
5. **Rotate the 7 exposed secrets** when the ~10 min window opens.
6. **(Optional)** Delete vestigial `apps/lambda/daily-reminders/` — no EventBridge rule deploys it; actual cron runs in-API.

---

## Known deferred items and technical debt

- **Local iOS dev tooling is flakey.** `ios/Pods` wiped; last successful Xcode build Apr 10. Not on the critical path.
- **Three-Modality Learning Loop** — proposed 2026-04-20; ROADMAP Phase 6 row 23 + ENHANCEMENTS Future entry. Prerequisites: writing eval audit, voice eval bake, cross-tab session state. 1–2 week scope in its own brainstorm → spec → plan cycle.
- **Integration test gap at `/v1/kanji/:id`.** Pre-existing — B126 was the first task to add fields the mobile UI depends on. Not blocking.
- **`user-delete` integration test fails on `learner_identity_pkey` duplicate.** Pre-existing test-cleanup issue. Cleared only by a TEST_DATABASE reset.
- **TEST_DATABASE drift from supabase migrations.** The local test DB was bootstrapped from drizzle migrations and lacks an `auth.uid()` stub + later supabase migrations (0016, 0018). Implementer stubbed during Task 1. Worth a dev-env hygiene follow-up.
- **`todayReviewed` on `/v1/review/status`** — separate follow-up already filed; unblocks Watch home hero decrementing when backlog exceeds goal.

---

## Working environment notes

- **Prod API:** `https://73x3fcaaze.us-east-1.awsapprunner.com`.
- **Supabase:** still in `ap-southeast-2`. Pre-launch us-east-1 migration remains pending (ENHANCEMENTS E22).
- **Docker deploys:** `DOCKER_CONTEXT=default ./scripts/deploy-api.sh` from repo root.
- **EAS builds:** from `apps/mobile/`. Pay-as-you-go ~$2/build (monthly credits exhausted). `eas-cli 18.7.0` verified working this session. EAS auto-bumps `ios.buildNumber`; don't hand-edit. Current build number: **127**.
- **EAS env vars** with `EXPO_PUBLIC_` prefix are baked into each build. Changing Supabase URL (pre-launch E22) requires a fresh EAS build.
- **Monorepo test commands:** `pnpm exec jest` (mobile, not `pnpm test` — turborepo ate that). `pnpm test` works from repo root via Turbo and from `apps/api/` (vitest).

---

## Tomorrow's first command

```
cd /Users/rdennis/Documents/projects/kanji-learn
git pull origin main
# 1. Open TestFlight on device → install B127 if not auto-delivered.
# 2. Walk the on-device verification checklist above.
# 3. If all pass: close Bug 1/2/3 tracker entries.
# 4. If anything regresses: cut B128 or bundle with other pending work.
# 5. File the 6 minor follow-ups as tracker entries.
# 6. Rotate the 7 exposed secrets when the window opens.
```
