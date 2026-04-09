# 漢字 Buddy — Bug Tracker

A living log of confirmed bugs in the 漢字 Buddy app. Each entry includes a symptom, reproduction steps, affected files, suspected root cause, and status tags. Add new bugs as they're discovered; move fixed items to the **Fixed** section with a note on what changed.

---

## 🐛 Active Bugs

- [ ] **"Drill X missed card(s)" button does nothing on Session Complete screen** — Tapping the button shows the "Loading reviews…" spinner briefly, then returns to the same Session Complete page. No drill session starts.

  **Steps to reproduce:**
  1. Complete a study session with at least one card graded Again (quality 1) or Hard (quality 2).
  2. The Session Complete screen appears with a "Drill N missed card(s)" button visible.
  3. Tap the button.
  4. The "Loading reviews…" spinner appears briefly.
  5. The Session Complete screen reappears — no cards are shown.

  **Affected files:**
  - `apps/mobile/app/(tabs)/study.tsx` — `onReview` callback (lines 262–270); `useEffect([isComplete])` (lines 124–128); `handleFinish` useCallback (lines 167–199)
  - `apps/mobile/src/stores/review.store.ts` — `loadMissedQueue()` (lines 221–231); `submitResult()` (lines 143–156)

  **Suspected root cause:** `loadMissedQueue()` synchronously updates the Zustand store (`isComplete → false`, `queue → missedCards`, `results → []`). This triggers subscriber notifications and a React re-render before `setSessionSummary(null)` is batched in. During that intermediate render, `sessionSummary` is still non-null, so `SessionComplete` renders again.

  A secondary concern: `handleFinish` is a `useCallback` with `[finishSession, queue]` dependencies, but the `useEffect` that calls it only lists `[isComplete]`. If the effect fires with a stale `handleFinish` that captured the already-cleared `results: []`, `finishSession()` returns `null` (guard on line 160) and immediately sets `sessionSummary` back to a zeroed-out summary.

  The "Loading reviews…" text the user sees is produced only by the `isLoading` path (line 207), which is only set by `loadQueue()`. This suggests the component may be briefly unmounting/remounting (re-triggering the mount effect `loadQueue(20)`) as a side effect of the state transition, or that a stale `handleFinish` invocation kicks off a new queue load.

  `[Effort: S]` `[Impact: High]` `[Status: 🐛 Reported]`

- [x] **Speak icons not working on Study Cards and Browse Kanji Cards** — ✅ Resolved. Device media volume was muted (physical ringer switch). TTS was functioning correctly all along. Build 87 adds a helpful alert if a Japanese TTS voice is not installed on the device, as a bonus improvement for future users.

  `[Effort: S]` `[Impact: High]` `[Status: ✅ Not a bug — device was muted]`

- [ ] **Daily push notifications never delivered** — Users with notifications enabled and a reminder time set never receive daily reminder push notifications.

  **Steps to reproduce:**
  1. Enable notifications in Profile tab and set a reminder time.
  2. Wait until the configured hour on a day you haven't studied.
  3. No push notification arrives.

  **Root cause:** The AWS Lambda (`kanji-learn-daily-reminders`) was deployed but had **no EventBridge rule attached**. The Lambda was never triggered, so `sendDailyReminders()` was never called. The in-process `node-cron` inside App Runner is unreliable because App Runner scales to zero instances between requests, killing the cron process.

  **Fix applied 2026-04-09:** Created EventBridge rule `kanji-learn-hourly-reminders` (rate: 1 hour), attached Lambda as target, granted invoke permission. Verified with a manual `aws lambda invoke` — returned `{"ok":true}`.

  **Affected infrastructure:**
  - AWS EventBridge rule: `kanji-learn-hourly-reminders` (us-east-1)
  - Lambda: `kanji-learn-daily-reminders`
  - API route: `POST /internal/daily-reminders`

  `[Effort: XS]` `[Impact: High]` `[Status: ✅ Fixed — Verify at next reminder hour]`

---

## ✅ Fixed Bugs

### App crashes on swipe/grade during Weak Spots drill (Build 84+)
- **Symptom:** App crashed on first swipe or grade button tap when reviewing weak spots.
- **Root cause:** `key={currentIndex}` on `KanjiCard` forced full unmount on every grade press. Cleanup called `Speech.stop()` on idle synthesizer → RCTFatal native bridge crash.
- **Fix:** Removed `key={currentIndex}`; added `useEffect(() => setSpeakingGroup(null), [item.kanjiId])` to reset TTS state on card change without remounting.

### "Full details" drawer crash — TypeError: undefined is not a function (Build 85+)
- **Symptom:** Opening the "Full details" (ℹ) drawer on a revealed study card crashed with `TypeError: undefined is not a function at RevealAllDrawer`.
- **Root cause:** `?? []` only catches `null`/`undefined`. If a jsonb DB column contains a non-array truthy value (e.g. a string), it passes through and calling `.map()` or `.join()` on a string gives "undefined is not a function" (strings don't have `.map`). The guard `exampleVocab.length > 0` also passes for strings, making it undetectable without `Array.isArray()`.
- **Fix:** Replaced all `?? []` array guards with `Array.isArray(x) ? x : []` in `KanjiCard.tsx` (KanjiCard, RevealAllDrawer, ReferencesPanel) and `srs.service.ts` (server-side mapping).

### Watch app showing 2076 kanji due (Build 77+)
- **Symptom:** Watch home screen showed the total number of due kanji (2076) instead of capping at the Daily Review Goal.
- **Fix:** Added `dailyGoal` (from `UserDefaults` key `kl_daily_goal`, default 20) and `cappedDueCount = min(dueCount, dailyGoal)` to `HomeView.swift` in both watch directories.
