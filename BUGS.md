# 漢字 Buddy — Bug Tracker

A living log of confirmed bugs in the 漢字 Buddy app. Each entry includes a symptom, reproduction steps, affected files, suspected root cause, and status tags. Add new bugs as they're discovered; move fixed items to the **Fixed** section with a note on what changed.

---

## 🐛 Active Bugs

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

- [ ] **Rōmaji toggle button non-functional on study card** — Tapping the "Rōmaji" button on the revealed side of a KanjiCard has no visible effect. Readings do not display romanized transliterations despite the toggle state and `wanakana` conversion logic being present in the code.

  **Steps to reproduce:**
  1. Start a study session and reveal a card.
  2. Tap the "Rōmaji" button (top-left of card, revealed side only).
  3. Kun/on readings remain in kana — no rōmaji appears below them.

  **Suspected root cause:** Unknown — `showRomaji` state and `toRomaji()` calls exist in `KanjiCard.tsx` but the conditional render may be gated incorrectly or the state is not reaching the component as expected.

  **Affected files:**
  - `apps/mobile/src/components/study/KanjiCard.tsx`
  - `apps/mobile/app/(tabs)/study.tsx`

  `[Effort: S]` `[Impact: Low]` `[Status: 🐛 Active]`

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

---

## ✅ Fixed Bugs

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
