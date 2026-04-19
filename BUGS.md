# 漢字 Buddy — Bug Tracker

A living log of confirmed bugs in the 漢字 Buddy app. Each entry includes a symptom, reproduction steps, affected files, suspected root cause, and status tags. Add new bugs as they're discovered; move fixed items to the **Fixed** section with a note on what changed.

---

## 🐛 Active Bugs

- [x] **Browse-kanji crashes the app on any kanji whose `radicals` column is a JSON string instead of an array (1185 of 2294 rows — 52% of kanji)** — ~~FIXED~~ 2026-04-18. Data repair SQL applied to prod (1185 rows, UPDATE returns 1185), `toArr` defense added to all three affected kanji routes (commit `5f1b043`), API deployed (op `03b663dd41a642e996736e1353883795`). User confirmed on device: 息 no longer crashes the browse flow. The server-side fix is live independent of TestFlight — any previously-crashing kanji in a currently-installed build should now render correctly. Tapping a kanji from the Browse page (or the Progress-tab kanji grid) used to crash the app when the target kanji had a malformed `radicals` value.

  **Root cause:** Seed data corruption in the `kanji.radicals` column. For ~52% of rows, the stored value is a jsonb STRING that contains a JSON-encoded string of an array, e.g. on 息 the value is `"\"[\\\"心\\\"]\""` — a double-JSON-encoded string `"[\"心\"]"`. When the mobile client calls `.map()` on that string (expecting an array of radical characters), React Native's native bridge throws `RCTFatal: undefined is not a function`. This is the same class of failure called out in the existing defensive comment at `srs.service.ts:145-147`: "If a jsonb column contains a non-array value (e.g. a string) `??` passes it through, and the client then calls `.map()/.join()` on a string → RCTFatal."

  **Scope of corruption (queried 2026-04-18):**
  ```sql
  SELECT jsonb_typeof(radicals) AS type, COUNT(*) FROM kanji GROUP BY jsonb_typeof(radicals);
  -- string: 1185, array: 1109
  ```
  Only `radicals` is affected — `example_vocab` and `example_sentences` are `array`-typed for all 2294 rows.

  **Fix plan (two parts, both needed):**
  1. **Data repair** — one-time SQL: `UPDATE kanji SET radicals = (radicals #>> '{}')::jsonb WHERE jsonb_typeof(radicals) = 'string';`. The `#>> '{}'` extracts the inner string; the cast re-parses it as a real jsonb array. Test carefully on one row first, then commit to the full set.
  2. **Server-side defense** — the `/v1/kanji/:id` handler (and any related endpoint) should run the `toArr` guard already defined inline in `srs.service.ts` before returning array-shaped fields, mirroring what `getReviewQueue` already does. This prevents a regression if the seed pipeline reintroduces the bug.

  **Affected files:**
  - `packages/db/src/seeds/` — check whichever seed populated `radicals` for the double-encoding bug
  - `apps/api/src/routes/kanji.ts` (or wherever `/v1/kanji/:id` lives) — add `toArr` guard
  - Reproducer SQL above

  Found B121 on-device verification 2026-04-18 while browsing 息.

  `[Effort: S]` `[Impact: High — crashes app on ~52% of kanji when opened via Browse]` `[Status: 🐛 Active]`

- [ ] **Kanji `example_vocab` can contain words that don't use the kanji itself** — On 息 ("breath"), example_vocab is `[{"word": "息子", "reading": "むすこ", "meaning": "son"}, {"word": "呼吸", "reading": "こきゅう", "meaning": "breathing"}]`. The second entry (呼吸) means "breathing" but uses the characters 呼 + 吸 — neither is 息. This is semantically related but misleading: the example vocab for a kanji should always contain that kanji so learners can see it in context. Data-quality issue in the seed pipeline. Spot-checked in 2026-04-18 session; unknown how widespread.

  **Fix plan:** Add a seed-time validator that rejects any `example_vocab` entry where `word` does not contain the kanji character. Audit existing rows for violations and either remove the offending entries or replace with compliant alternatives. No user-facing change required until the data is cleaned.

  **Affected files:**
  - `packages/db/src/seeds/` — whichever seed writes `example_vocab`

  Found B121 on-device verification 2026-04-18 on 息.

  `[Effort: S]` `[Impact: Med — confusing but not crashing]` `[Status: 🐛 Active]`

- [x] **SessionComplete shows "20 correct / 0 missed" (and similar) — client counts `quality >= 3` as correct, server counts `quality >= 4`** — Client/server disagreement on the "correct" threshold produces incorrect counts on the Session Complete screen. Reproduced in the 2026-04-18 comprehensive weighted-math test: a 5 Again + 5 Hard + 5 Good + 5 Easy session was counted as 15 correct / 5 wrong on the screen, but the server's `daily_stats.correct` was 10 (only Good + Easy). For an all-Hard-and-Easy session the screen shows 20/0, which is the "always 20 correct / 0 missed" observation.

  **Root cause:** [apps/mobile/app/(tabs)/study.tsx:269](apps/mobile/app/(tabs)/study.tsx:269) computes `const correct = results.filter((r) => r.quality >= 3).length`. The server at [apps/api/src/services/srs.service.ts:289](apps/api/src/services/srs.service.ts:289) uses `if (result.quality >= 4) correctItems++` with an explicit comment: "quality 4 (Good) and 5 (Easy) = confident recall; quality 3 (Hard) = remembered but with difficulty (not counted as 'correct' for accuracy display)." The client drifted from this convention.

  **Fix:** two sensible paths — (a) **align client with server** as a two-character change: `r.quality >= 4`. Makes Hard count as wrong, matching daily_stats. Lowest risk, ships in the next EAS build. (b) **ship the already-logged "High / Medium / Low / Missed breakdown" enhancement** which replaces the binary correct/wrong render entirely with a 4-tier count (Easy=High, Good=Medium, Hard=Low, Again=Missed). Cleaner long-term; subsumes this bug. Recommend (a) now + schedule (b) for Build 3.

  **Affected files:**
  - `apps/mobile/app/(tabs)/study.tsx:269`

  Found B121 on-device verification 2026-04-18. ~~FIXED~~ in B123 (commit `a7590cc` changed `>=3` to `>=4` in `study.tsx:269`). Verified by user 2026-04-19: counts now match server. Label refinement landed in B124 (commit `5d81768` renamed correct→remembered, wrong→missed).

  `[Effort: XS]` `[Impact: Med — users see wrong counts]` `[Status: ✅ Fixed]`

- [x] **Mnemonic section missing from the study-card reveal drawer (`RevealAllDrawer` / `KanjiCard.tsx`)** — In B121 the Mnemonic section was added to `apps/mobile/app/kanji/[id].tsx` (the main Kanji details page, reachable from Browse / Journal). The study card's reveal flow — opened via the magnifying glass icon mid-session to see the full kanji record — does NOT include a mnemonic section, so users can't access mnemonics without leaving the study session. Expected: the mnemonic section should be in both places, or at minimum the drawer should offer a button to jump to the main details page where the mnemonic lives. Confirmed 2026-04-18 by grepping `Mnemonic` in `KanjiCard.tsx` — zero matches.

  **Updated 2026-04-19 — broader scope confirmed by owner:** "The kanji details pages off of the reveal side of study cards is different from the detail cards connected to the Browse feature. The Browse kanji details are superior and should be the normal." The issue isn't just the mnemonic panel — the two details views have drifted apart entirely, and the Browse-originated `/kanji/[id]` is the preferred canonical version. Fix should unify them, not just patch the mnemonic gap.

  **Fix plan (revised):** Consolidate to a single canonical kanji details view. Two options:
  - **(a) Navigate out to `/kanji/[id]` from the reveal panel.** Replace the custom drawer content in `KanjiCard.tsx` with a button (or gesture) that pushes the main details route. Pros: one page to maintain, automatically picks up every future enhancement (mnemonic, speak icons, etc.). Cons: leaves the study flow; user must tap Back to return to the card.
  - **(b) Extract `/kanji/[id]` section components (Meanings, Readings, Mnemonic, Example Vocab, Example Sentences, Related Kanji, SRS Progress) into shared components and render them inside the drawer.** Pros: stays in study flow. Cons: more code to extract + keep in sync.
  - **Recommended:** (a) — simpler, guarantees consistency, and the Back navigation back to the study card is a single tap.

  **Affected files:**
  - `apps/mobile/src/components/study/KanjiCard.tsx` — remove drawer's custom details render; replace magnifying-glass icon action with `router.push('/kanji/${item.kanjiId}')`
  - Alternatively (b): extract sections from `apps/mobile/app/kanji/[id].tsx` into `apps/mobile/src/components/kanji/*.tsx`

  Found B121 on-device verification 2026-04-18; scope broadened 2026-04-19. ~~SHIPPED~~ in B124 (commit `dd6c5f7`) via option (a): the magnifying-glass icon on the study card now navigates to `/kanji/[id]` (the canonical details page). The `RevealAllDrawer` function remains in `KanjiCard.tsx` unreachable — flagged for cleanup in a follow-up pass. Awaiting on-device verification once B124 lands in TestFlight.

  `[Effort: S]` `[Impact: Med]` `[Status: 🔄 Shipped, awaiting B124 verification]`

- [x] **Session Complete screen persists after returning to Study tab** — ~~FIXED~~ in B123 (commit `a7590cc`). Verified on device 2026-04-19: after completing a 5-card session (with daily goal=5), tapping Back to Dashboard → Start Today's Reviews now shows the daily-goal-complete message; tapping the Study tab loads a fresh 5-card deck. No stale Session Complete screen anywhere. onDone now clears `sessionSummary` + calls `reset()` before navigating.

  `[Effort: XS]` `[Impact: High]` `[Status: ✅ Fixed]`

- [x] **Study queue ignores `profile.dailyGoal` — hardcoded to 20** — ~~FIXED~~ in B123 (commit `a7590cc`). Verified on device 2026-04-19: user set dailyGoal=5 on their profile; Study tab now loads exactly 5 cards. Fix destructured `dailyGoal` from `useProfile()` (with 20 fallback before the profile loads) and passed it to both `loadQueue` call sites in study.tsx.

  `[Effort: XS]` `[Impact: High]` `[Status: ✅ Fixed]`

- [x] **Save session latency ~45s (observed B121, 2026-04-18) — narrowed to submit path** — User reports that tapping the last grade kicks off a ~45s "Saving session…" spinner before Session Complete appears. Once Dashboard loads after, its auto-refresh takes only ~2–3 seconds. This narrows the bottleneck to the **submit path** (`POST /v1/reviews/submit` and the mobile `finishSession` wrapper), NOT the Dashboard useFocusEffect fan-out (which was suspected earlier but is now ruled out).

  **Suspected contributors (ranked by likelihood, updated 2026-04-18 with new telemetry):**
  1. **Cross-region sequential-write waterfall in submit loop.** API runs in `us-east-1` (App Runner), Supabase in `ap-southeast-2` (Sydney). Baseline DB RTT ~500ms with TLS. `srs.service.ts::submitReview` likely processes each review sequentially: `review_logs` insert + `user_kanji_progress` SRS upsert + session-summary update. For a 20-card session at 3–5 queries each = 60–100 queries × 500ms = **30–50s**, matching the observed 45s exactly. This is very likely the dominant cause. Migration to us-east-1 is queued as a Pre-Launch item in ENHANCEMENTS.md; even without migration, batching the submit into a single transaction with bulk inserts would collapse the waterfall.
  2. **Client-side offline-queue retry.** `review.store.ts::finishSession` wraps the submit in try/catch with offline queue handling. A silent timeout/retry loop could multiply a single slow call. Worth ruling out by checking network logs for one submit call vs. many.
  3. **App Runner cold start.** First request after the 2026-04-18 ~14:40 redeploy could add 5–15s. If a second consecutive session is also ~45s, cold start is ruled out — cold start only affects the first post-deploy call.
  4. **Missing index on `review_logs(user_id, reviewed_at)`.** Unlikely to matter for inserts but worth verifying while we're in the schema — the new weighted-confidence SQL reads with this filter pattern.

  **Explicitly ruled OUT (2026-04-18 telemetry):**
  - ~~Dashboard auto-refresh fan-out~~ — user confirmed Dashboard loaded in ~2–3s after Session Complete, so the `useFocusEffect` added in B121 is NOT the bottleneck.
  - ~~Weighted-confidence SQL on analytics path~~ — not in the submit critical path; runs on Dashboard load, which is already confirmed fast.

  **Investigation steps:**
  1. Run two consecutive sessions. If the second is also ~45s, rule out cold start.
  2. Enable App Runner request timing logs; break down `POST /v1/reviews/submit` by DB query to confirm the waterfall shape and count.
  3. Check mobile network logs during save — is it ONE `POST /v1/reviews/submit` call or multiple retries?
  4. If the submit service processes reviews in a loop with per-review queries, rewrite to a single `insert ... values (...), (...), ...` transaction + a bulk user_kanji_progress upsert. Target query count independent of session size.

  **Affected files (entry points to investigate):**
  - `apps/api/src/routes/review.ts` — submit handler
  - `apps/api/src/services/srs.service.ts::submitReview` — the per-review upsert logic
  - `apps/mobile/src/stores/review.store.ts::finishSession` — client-side submit + retry

  **Fix shipped 2026-04-18 (commit `d137b9c`, API deploy pending):** Batched the submit path. `DualWriteService.recordReviewSubmissions` (new plural method) opens a single transaction with four bulk statements. `SrsService.submitReview` pre-fetches existing UKG rows with one `findMany` (instead of N `findFirst` calls) and computes SRS math in-memory before a single dual-write call. Round-trips per 20-card session drop from ~145 to ~13 (~12x speedup, ~45s → ~4s on cross-region DB). Session-level atomicity replaces per-review atomicity; the mobile offline queue already handles session-level retry so the trade-off is transparent. 8 new unit tests cover the pure `buildBatchedRowSets` transformation.

  `[Effort: M]` `[Impact: High]` `[Status: ✅ Fixed — confirmed on device 2026-04-18 ("save session delay is shorter")]`

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

- [x] **Dashboard doesn't refresh after a study session** — ~~FIXED~~ in B121 (commit `d03cfad`). Verified by user on 2026-04-18: returning to the Dashboard tab after a study session now auto-refreshes all metrics (remembered count, JLPT bars, streak, daily goal) without needing pull-to-refresh. Fix: `useFocusEffect` on the Dashboard calls `refresh()` across all 5 data hooks (`useAnalytics`, `useProfile`, `useQuizAnalytics`, `useInterventions`, and `loadAll` on `useSocial`) whenever the tab regains focus. Cached data keeps rendering during the refetch — no loading flash. Pull-to-refresh still works as before.

  `[Effort: S]` `[Impact: High]` `[Status: ✅ Fixed]`

- [x] **Take Quiz empty state shows misleading "connection error" copy** — ~~FIXED~~ in B121 (commit `63c464e`). Verified by user on 2026-04-18: a brand-new user tapping "Take a Quiz" with zero reviews now sees a dedicated empty state (`school-outline` icon, "Quizzes unlock once you've studied some kanji.", "Complete a study session to build a pool of questions based on what you've seen.") with a "Start studying" CTA that takes them straight to the Study tab via `router.replace('/(tabs)/study')`. The old "Check your connection" copy is no longer shown for the no-data case; the generic connection-error state still handles real network failures.

  `[Effort: S]` `[Impact: Med]` `[Status: ✅ Fixed]`

- [x] **Session Complete screen labels confidence as "accuracy"** — ~~FIXED~~ in B121 (commit `744dede`). Verified by user on 2026-04-18: the big percentage ring on Session Complete now reads "confidence" below the number. File: `apps/mobile/src/components/study/SessionComplete.tsx:59`.

  `[Effort: XS]` `[Impact: Low]` `[Status: ✅ Fixed]`

- [x] **Drill Weak Spots dialog (>65% path) says "accuracy" — should say "confidence"** — ~~FIXED~~ in B121 (commit `744dede`). Verified by user on 2026-04-18: the alert now reads "your confidence is above 65% on all recently reviewed kanji. Keep it up!" File: `apps/mobile/app/(tabs)/index.tsx:214`.

  `[Effort: XS]` `[Impact: Low]` `[Status: ✅ Fixed]`

- [ ] **Post-delete relational cascade — deleted user persists in mates + leaderboard** — After a test user deletes their account, other users who had invited or been invited by the deleted user still see them in the Leaderboard and Study Mates lists. Same issue likely exists for tutor shares.

  **Steps to reproduce (B120):**
  1. Create test user A. Add study data.
  2. From A, invite user B as a study mate. Invite a tutor.
  3. Delete account A.
  4. Sign in as user B → A still appears in Leaderboard and Study Mates list.

  **Suspected root cause:** Migration 0016 added `learner_identity → user_profiles` cascade, so A's own data is gone. But the relational tables that reference A *from other users* (`friendships` / study-mate rows / tutor_shares) don't have `ON DELETE CASCADE` FKs back to `auth.users` or `user_profiles`. Leaderboard may additionally cache stale user rows.

  **Fix plan:** Audit every user-keyed relational table for missing `ON DELETE CASCADE` FKs. Add migration 0017 to fill the gaps. Cascade immediately on delete (no decay period — hard delete is already our model). Optionally send a one-time farewell push to affected friends at deletion time so the disappearance isn't silent.

  **Reproducibility:** Confirmed still present in B121 TestFlight verification on 2026-04-18 — the deleted test user from the B120 session remained visible on the inviter's leaderboard. No data migration or ad-hoc cleanup has been run between B120 and B121.

  Found B120 Delete Account verification pass.

  `[Effort: M]` `[Impact: High]` `[Status: 🐛 Active — confirmed B121]`

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
