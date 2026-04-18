# 漢字 Buddy — Bug Tracker

A living log of confirmed bugs in the 漢字 Buddy app. Each entry includes a symptom, reproduction steps, affected files, suspected root cause, and status tags. Add new bugs as they're discovered; move fixed items to the **Fixed** section with a note on what changed.

---

## 🐛 Active Bugs

- [ ] **Save session latency ~45s (observed B121, 2026-04-18)** — User reports that completing a study session (tapping the last grade → seeing Session Complete → landing on Dashboard) takes ~45s in B121. Feels slower than before. Needs instrumentation before we can pin the root cause.

  **Suspected contributors (ranked by likelihood):**
  1. **Cross-region DB latency.** API runs in `us-east-1` (App Runner), Supabase runs in `ap-southeast-2` (Sydney). Baseline RTT is ~250ms one-way, ~500ms with TLS. `POST /v1/reviews/submit` does multiple sequential writes (`review_logs` insert per card, `user_kanji_progress` upserts, `daily_stats` rollup, `review_sessions` upsert). A waterfall of ~15 queries at 500ms each would already produce a 7–8s save. 45s suggests either more queries than expected or a contention stall. Migration to us-east-1 is tracked as a Pre-Launch item in ENHANCEMENTS.md.
  2. **Dashboard auto-refresh (new in B121).** The Dashboard `useFocusEffect` added in the B121 commit `d03cfad` fires 5 refresh callbacks on tab focus (`useAnalytics`, `useProfile`, `useQuizAnalytics`, `useInterventions`, `useSocial`). If the user is timing from "tap last grade" to "Dashboard metrics visible," this adds 5 parallel (but cross-region) API calls AFTER the submit finishes. Could account for a sizable chunk of the 45s if the analytics summary endpoint is slow.
  3. **New weighted-confidence SQL (B121 commit `aaa874a`).** `WEIGHTED_CONFIDENCE_SQL` aggregates `SUM(CASE … END)::numeric / NULLIF(COUNT(*) * 3, 0) * 100` over `review_logs` filtered by `userId` + `reviewedAt >= since`. Runs in `getConfidenceRate` (30-day window) and `getConfidenceByType` (default 7-day window). This runs on Dashboard load, not on submit — but contributes to #2 above. Needs index check: confirm `review_logs` has a composite index on `(user_id, reviewed_at)` or the scan could be slow on a hot user with thousands of reviews.
  4. **App Runner cold start after the B121 deploy.** The API was redeployed at 2026-04-18 ~14:40. First request after a deploy typically takes 5–15s while the container warms up. If the 45s observation was on the very first post-deploy session, this accounts for part of the delay — but subsequent sessions should be faster.
  5. **Client-side offline queue or retry.** `review.store.ts::finishSession` wraps the submit in try/catch with offline queue handling. A timeout/retry loop could magnify a single slow call into a 45s stall. Check whether a retry path is firing.

  **Investigation steps:**
  1. Run a second test session to rule out cold start (#4). If the 45s repeats, it's not cold start.
  2. Enable App Runner request timing logs. Break down `POST /v1/reviews/submit` by DB query to find the waterfall bottleneck (#1).
  3. Measure `GET /v1/analytics/summary` latency in isolation via the mobile network tab or a direct `curl`. If it's > 10s by itself, the confidence query is the culprit (#3).
  4. Confirm the composite index on `review_logs(user_id, reviewed_at)` exists — likely at `packages/db/src/schema.ts` or a migration file. If missing, add one.
  5. Compare Dashboard focus-refresh latency before/after the B121 commit. `git stash` the `useFocusEffect` block in `apps/mobile/app/(tabs)/index.tsx` lines 187–195 and retime to isolate that contribution.

  **Affected files (entry points to investigate):**
  - `apps/api/src/routes/review.ts` — submit handler
  - `apps/api/src/services/srs.service.ts` — the `submitReview` logic (upserts)
  - `apps/api/src/services/analytics.service.ts` — new weighted-confidence SQL
  - `apps/mobile/src/stores/review.store.ts::finishSession`
  - `apps/mobile/app/(tabs)/index.tsx` — useFocusEffect

  Found B121 TestFlight verification, 2026-04-18.

  `[Effort: M (investigation first)]` `[Impact: High]` `[Status: 🔎 Needs investigation]`

- [ ] **Delete Account flow — Core flow verified B120; relational cascade still open** — The user-facing delete flow works end-to-end (confirmed B120, 2026-04-18): Profile → Danger zone → typed-DELETE → API admin delete → farewell → sign-up with the same email yields a fresh account. Verification also surfaced that rows pointing to the deleted user from OTHER users' perspectives (friendships, study-mates, leaderboard, tutor shares) don't cascade — tracked separately below as "Post-delete relational cascade". Close this entry once the relational cleanup ships.

  `[Effort: 0 (verify only)]` `[Impact: High]` `[Status: 🚧 Core verified; relational follow-up open]`

- [ ] **Study Time Timer Doesn't Pause When App Backgrounds** — The mobile review store records session study time as `Date.now() - studyStartMs`. If the user backgrounds the app mid-session and returns later to finish, the wall-clock difference includes all idle time. Observed a 29-review session that reported 16.8 hours of study time on one user. A server-side cap (30s/item, 60min hard max) was added in `srs.service.ts::submitReview` to protect the daily_stats rollup, but the mobile client should also pause the timer on `AppState` change to 'background' and resume on 'active'. Fix location: `apps/mobile/src/stores/review.store.ts` — wrap the timer in a pause/resume pattern keyed off `AppState`. Also wipe the elapsed time on session restore from offline queue.

  `[Effort: S]` `[Impact: Med]` `[Status: 🐛 Active]`

- [x] **Tutor Report: AI analysis fails with "Both tier 2 providers failed"** — ~~FIXED~~. Root cause: `TutorAnalysisService.computeForUser()` called `this.llm.route()` without `userOptedInPremium: true`, so the LLM router's tier 3 gate (`if (request.userOptedInPremium === true)`) skipped Claude and fell through to tier 2 providers (Groq/Gemini) which had no API keys on App Runner. Fix: added `userOptedInPremium: true` to the route call in `tutor-analysis.service.ts`.

  `[Effort: XS]` `[Impact: High]` `[Status: ✅ Fixed]`

- [ ] **Scrolling down on reveal card triggers swipe-down "Hard" grade** — After a card is revealed, the answer area is a `ScrollView` containing readings and vocab. Attempting to scroll down to read the content fires the swipe-down gesture, grading the card as "Hard" instead of scrolling.

  **Steps to reproduce:**
  1. Start a study session and reveal a card with enough content to scroll.
  2. Slowly drag downward on the answer area to read the content.
  3. Card flies off and grades "Hard" instead of scrolling.

  **Root cause:** `PanResponder` in `study.tsx` claims vertical gestures at a very low threshold. A velocity-based fix (`vy > 0.4`) was shipped in Build 104 — awaiting TestFlight verification.

  **Affected files:**
  - `apps/mobile/app/(tabs)/study.tsx` (PanResponder `onMoveShouldSetPanResponder`)

  `[Effort: S]` `[Impact: High]` `[Status: 🐛 Active — fix in Build 104, unverified]`

- [ ] **Scrolling in "Reveal All" details drawer triggers card grade evaluation** — After opening the full details drawer (via the magnifying glass icon), scrolling down inside the drawer fires the swipe-down gesture on the underlying card, grading it as "Hard".

  **Steps to reproduce:**
  1. Reveal a study card and tap the magnifying glass icon to open the details drawer.
  2. Scroll down inside the drawer (readings, vocab, sentences, etc.).
  3. The drawer scrolls but the card behind it grades as "Hard" and the session advances.

  **Suspected root cause:** The `RevealAllDrawer` uses `presentationStyle="pageSheet"`. On iOS, downward drags on a page sheet trigger the system dismiss gesture — this appears to leak through to the `PanResponder` on the underlying card view in `study.tsx`, which then fires `handleGrade(3)`. The fix likely requires a `isDetailsOpenRef` guard in `onMoveShouldSetPanResponder` (similar to the existing `isRevealedRef` pattern) so the PanResponder yields entirely when the drawer is open.

  **Affected files:**
  - `apps/mobile/app/(tabs)/study.tsx` (PanResponder `onMoveShouldSetPanResponder`)
  - `apps/mobile/src/components/study/KanjiCard.tsx` (`detailsOpen` state needs to be surfaced to parent)

  `[Effort: S]` `[Impact: High]` `[Status: 🔧 Fix in Build 105, awaiting verification]`


- [x] **Rōmaji toggle button non-functional on study card** — ~~FIXED~~ in Build 113/114. Verified by user on 2026-04-17: tapping the "Rōmaji" button on a revealed card now properly displays romanized transliterations below each kana reading.

  `[Effort: S]` `[Impact: Low]` `[Status: ✅ Fixed]`

- [ ] **Daily push notifications not firing** — Users with notifications enabled and a reminder time set never receive daily reminder push notifications.

  **Steps to reproduce:**
  1. Enable notifications in Profile tab and set a reminder time.
  2. Wait until the configured hour on a day you haven't studied.
  3. No push notification arrives.

  **Root cause:** The AWS Lambda (`kanji-learn-daily-reminders`) was deployed but had **no EventBridge rule attached**. The Lambda was never triggered, so `sendDailyReminders()` was never called. The in-process `node-cron` inside App Runner is unreliable because App Runner scales to zero instances between requests, killing the cron process.

  **Fix attempted 2026-04-09:** Created EventBridge rule `kanji-learn-hourly-reminders` (rate: 1 hour), attached Lambda as target, granted invoke permission. Verified with a manual `aws lambda invoke` — returned `{"ok":true}`. However notifications are still not being received as of Build 103 — root cause not fully resolved.

  **Affected infrastructure:**
  - AWS EventBridge rule: `kanji-learn-hourly-reminders` (us-east-1)
  - Lambda: `kanji-learn-daily-reminders`
  - API route: `POST /internal/daily-reminders`

  `[Effort: M]` `[Impact: High]` `[Status: 🐛 Active — regression confirmed Build 103]`

- [ ] **`TOTAL_JOUYOU_KANJI` constant is wrong — set to 2,294 instead of 2,136** — `packages/shared/src/constants.ts` exports `TOTAL_JOUYOU_KANJI = 2294`, but the official Jōyō kanji list contains 2,136 characters (2010 revision). The inflated value understates completion percentages on the Dashboard and anywhere else the constant is used.

  **Root cause:** Constant was set to 2,294 (Jōyō 2,136 + Jinmeiyō 158) instead of Jōyō-only. The README, sign-in screen subtitle, and DB migration comment all correctly say 2,136.

  **Affected files:**
  - `packages/shared/src/constants.ts` — change `2294` → `2136`
  - Downstream consumers (`analytics.service.ts`, `SrsStatusBar.tsx`) import the constant and need no change once it's fixed.

  `[Effort: XS]` `[Impact: Medium]` `[Status: 🐛 Active]`

- [ ] **Dashboard doesn't refresh after a study session** — After completing a study session and returning to the Dashboard tab, metrics (remembered count, JLPT bars, streak, daily goal) don't update until the user performs a pull-to-refresh. Most users won't know to pull down.

  **Root cause:** `useAnalytics` ([apps/mobile/src/hooks/useAnalytics.ts:89](apps/mobile/src/hooks/useAnalytics.ts:89)) fetches once on mount. The Dashboard component stays mounted when navigating between tabs, so the effect never re-fires. `RefreshControl` is the only refresh trigger today.

  **Fix plan:** Add `useFocusEffect` on the Dashboard tab that calls `refresh()` across all data hooks (`useAnalytics`, `useQuizAnalytics`, `useInterventions`, `useSocial`, `useProfile`) whenever the tab regains focus. Cached data keeps rendering during the refetch — no loading flash.

  Found B120.

  `[Effort: S]` `[Impact: High]` `[Status: 🐛 Active]`

- [ ] **Take Quiz empty state shows misleading "connection error" copy** — A brand-new user who has declined placement and has zero reviews taps "Take a Quiz" on the Dashboard and sees: `"No quiz questions available yet — Study more kanji first"` with subtext `"Couldn't load quiz questions. Check your connection and try again."` plus Retry / Go Back buttons. The subtext blames the network when the real issue is no review history; Retry loops on the same alert.

  **Fix plan:** Rewrite the empty-state subtext to match reality (e.g. `"Complete a study session to unlock quizzes."`). Replace Retry with a "Start studying" CTA that navigates to the Study tab. No starter quiz — the quiz's value depends on the user's SRS history.

  Found B120.

  `[Effort: S]` `[Impact: Med]` `[Status: 🐛 Active]`

- [ ] **Session Complete screen labels confidence as "accuracy"** — The percentage ring on the Session Complete screen displays `"accuracy"` below the number, but the value is a confidence score derived from Easy/Good/Hard/Again self-grading, not raw accuracy. File: [apps/mobile/src/components/study/SessionComplete.tsx:59](apps/mobile/src/components/study/SessionComplete.tsx:59). Bundle with the broader accuracy→confidence audit enhancement.

  Found B120.

  `[Effort: XS]` `[Impact: Low]` `[Status: 🐛 Active]`

- [ ] **Drill Weak Spots dialog (>65% path) says "accuracy" — should say "confidence"** — Tapping "Drill Weak Spots" on the Dashboard when the user is above the 65% confidence threshold shows: `"Great news — your accuracy is above 65% on all recently reviewed kanji. Keep it up!"` Flip `accuracy` → `confidence`. File: [apps/mobile/app/(tabs)/index.tsx:214](apps/mobile/app/(tabs)/index.tsx:214). Bundle with the broader audit.

  Found B120.

  `[Effort: XS]` `[Impact: Low]` `[Status: 🐛 Active]`

- [ ] **Post-delete relational cascade — deleted user persists in mates + leaderboard** — After a test user deletes their account, other users who had invited or been invited by the deleted user still see them in the Leaderboard and Study Mates lists. Same issue likely exists for tutor shares.

  **Steps to reproduce (B120):**
  1. Create test user A. Add study data.
  2. From A, invite user B as a study mate. Invite a tutor.
  3. Delete account A.
  4. Sign in as user B → A still appears in Leaderboard and Study Mates list.

  **Suspected root cause:** Migration 0016 added `learner_identity → user_profiles` cascade, so A's own data is gone. But the relational tables that reference A *from other users* (`friendships` / study-mate rows / tutor_shares) don't have `ON DELETE CASCADE` FKs back to `auth.users` or `user_profiles`. Leaderboard may additionally cache stale user rows.

  **Fix plan:** Audit every user-keyed relational table for missing `ON DELETE CASCADE` FKs. Add migration 0017 to fill the gaps. Cascade immediately on delete (no decay period — hard delete is already our model). Optionally send a one-time farewell push to affected friends at deletion time so the disappearance isn't silent.

  Found B120 Delete Account verification pass.

  `[Effort: M]` `[Impact: High]` `[Status: 🐛 Active]`

---

## ✅ Fixed Bugs

### OAuth post-login navigation regression (B116)
- **Symptom:** After Google or Apple Sign-In completed successfully, the user was returned to the sign-in screen with no visible change. Initially diagnosed as "OAuth broken"; actually a routing-gate race introduced when the onboarding feature merged.
- **Root cause:** `useProfile` mounted at the root with `useEffect(…, [])` (empty deps) fired its fetch exactly once at app launch — before `initialize()` had hydrated the session from SecureStore. The fetch went out without a token, got 401, swallowed the error, and left `_cache = null`. After OAuth set the session, the routing effect in `_layout.tsx` checked `profile === null` and returned early without navigating. Compounding factor: the `on_auth_user_created` Postgres trigger had been dropped from prod, so any new OAuth user also lacked a `user_profiles` row.
- **Fix (shipped B117/B118):** (1) `useProfile` subscribes to `useAuthStore`'s access token and re-runs its fetch on every session change. (2) `GET /v1/user/profile` self-heals by inserting a row on demand when missing (defense against future trigger gaps). (3) Migration 0015 restored the `handle_new_user` trigger + function idempotently. (4) Sign-in screen reworded to clarify social buttons handle both new and returning users.

### Onboarding wizard wiped existing learner interests
- **Symptom:** Returning user re-entering onboarding (forced when their `onboarding_completed_at` was NULL because migration 0013 backfill missed them) had their `learner_profiles.interests` blanked on completion.
- **Root cause:** `handleComplete` in `onboarding.tsx:114` unconditionally sent `interests: []` in the PATCH payload, even though the wizard never asks for interests. The API's PATCH is an upsert — `interests: []` overwrote any prior selection.
- **Fix (shipped B118):** dropped the `interests: []` field from the payload. The wizard now only writes fields it actually collects. Interests stay editable in the Profile tab.

### Dashboard greeting drifted from edited display name
- **Symptom:** Editing display name on the Profile tab updated the Profile screen but the Dashboard greeting still showed the old name. OAuth users often saw their email prefix even when a name was set.
- **Root cause:** The Dashboard read `user.user_metadata.display_name` (the Supabase `auth.users.raw_user_meta_data` blob, set once at sign-up and never refreshed when the user edits their name), while the Profile tab + onboarding write to `user_profiles.display_name`. Two independent copies that drift.
- **Fix (shipped B120):** Dashboard now reads from `useProfile().displayName` — the same source the Profile tab edits. Email-prefix kept as a load-time fallback.

### `learner_identity` + 6 UKG tables orphaned on account delete
- **Symptom:** Caught by final code review before any user encountered it. Deleting an `auth.users` row cascaded through `user_profiles` but stopped there — `learner_identity` (containing PII: email, display_name) and its 6 cascade-children (`learner_profile_universal`, `learner_knowledge_state`, `learner_memory_artifacts`, `learner_timeline_events`, `learner_app_grants`, `learner_connections`) survived as orphans, breaking the farewell screen's "permanently removed" promise and weakening App Store 5.1.1 compliance.
- **Root cause:** `learner_identity.learner_id` was declared as a plain `uuid PRIMARY KEY NOT NULL` with no FK to `user_profiles.id`. The application set `learner_id = user_profiles.id` by convention, but Postgres didn't know about the relationship.
- **Fix:** Migration 0016 adds `FOREIGN KEY (learner_id) REFERENCES user_profiles(id) ON DELETE CASCADE`. Applied manually in prod 2026-04-17. Integration test extended to cover `learner_identity` + `learner_profile_universal` cascade.

### `on_auth_user_created` Postgres trigger missing in prod
- **Symptom:** Some users (new OAuth signups, sometimes random) had no `user_profiles` row, breaking the routing gate added by the onboarding feature.
- **Root cause:** Migration 0003 defined the trigger + `handle_new_user` function. Both were absent from prod (`pg_trigger` and `pg_proc` queries returned 0 rows). Likely dropped during a Supabase regional migration or project reset; cause unknown.
- **Fix:** Migration 0015 recreates both idempotently. Applied in prod 2026-04-17. API also has a self-heal fallback in `GET /v1/user/profile` so the system tolerates future trigger drops.

### Example sentence seed produces sparse coverage
- **Root cause:** Per-query Tatoeba API approach was too slow (195 kanji/hr), filter too strict (≤40 chars), and Claude fallback silently swallowed rate limit errors. After 10+ hours the seed had only covered ~15% of kanji.
- **Fix:** Rewrote seed to use Tatoeba bulk corpus download (jpn/eng TSV + links). Downloads once, indexes all 248k Japanese sentences in memory, matches all 2,294 kanji in a single local pass. Result: **2,116 / 2,294 kanji seeded in ~2 minutes with zero Claude API calls**. Confirmed visible in the app details drawer. (Build 106+)

### "Drill X missed card(s)" button does nothing on Session Complete screen
- **Fix:** Resolved. (Effort: S, Impact: High)

### Speak icons not working on Study Cards and Browse Kanji Cards
- **Root cause:** Not a bug — device media volume was muted (physical ringer switch). TTS was functioning correctly. Build 87 added a helpful alert if a Japanese TTS voice is not installed on the device.

### App crashes on swipe/grade during Weak Spots drill (Build 84+)
- **Symptom:** App crashed on first swipe or grade button tap when reviewing weak spots.
- **Root cause:** `key={currentIndex}` on `KanjiCard` forced full unmount on every grade press. Cleanup called `Speech.stop()` on idle synthesizer → RCTFatal native bridge crash.
- **Fix:** Removed `key={currentIndex}`; added `useEffect(() => setSpeakingGroup(null), [item.kanjiId])` to reset TTS state on card change without remounting.

### "Full details" drawer crash — TypeError: undefined is not a function (Build 85+)
- **Symptom:** Opening the "Full details" drawer on a revealed study card crashed with `TypeError: undefined is not a function at RevealAllDrawer`.
- **Root cause:** `?? []` only catches `null`/`undefined`. If a jsonb DB column contains a non-array truthy value (e.g. a string), it passes through and calling `.map()` or `.join()` on a string gives "undefined is not a function".
- **Fix:** Replaced all `?? []` array guards with `Array.isArray(x) ? x : []` in `KanjiCard.tsx` and `srs.service.ts`.

### Watch app showing 2076 kanji due (Build 77+)
- **Symptom:** Watch home screen showed the total number of due kanji (2076) instead of capping at the Daily Review Goal.
- **Fix:** Added `dailyGoal` (from `UserDefaults` key `kl_daily_goal`, default 20) and `cappedDueCount = min(dueCount, dailyGoal)` to `HomeView.swift` in both watch directories.
