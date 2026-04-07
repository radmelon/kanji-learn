# WatchOS Companion App — Project Specification

## Overview

A native SwiftUI Apple Watch companion for the Kanji-Learn iOS app. Brings the core SRS study loop to the wrist: present kanji cards, reveal meanings and readings, swipe in four directions to grade, and receive encouragement and progress summaries.

---

## Architecture

### Technology: Native SwiftUI (watchOS 10.0+, Swift 5.9+)

WatchOS has no React Native/Expo support. SwiftUI provides `DragGesture`, `WidgetKit` complications, and `WatchConnectivity` natively.

### Connectivity: Hybrid

- **Primary:** Watch calls the Fastify API directly via WiFi/cellular (`URLSession`)
- **Auth sync:** iPhone pushes Supabase JWT tokens to Watch via `WatchConnectivity.updateApplicationContext()`
- **Offline fallback:** Cached queue in `UserDefaults`, buffered results retried on next launch
- **Token fallback:** Watch can independently refresh tokens via Supabase REST endpoint

### No API Changes Required for Core Study

The existing endpoints serve the Watch identically to the mobile app:

| Method | Endpoint | Watch Usage |
|--------|----------|-------------|
| `GET` | `/v1/review/queue?limit=10` | Fetch study cards (smaller batch for Watch) |
| `POST` | `/v1/review/submit` | Submit graded results: `{ results: [{ kanjiId, quality, responseTimeMs, reviewType }], studyTimeMs }` |
| `GET` | `/v1/review/status` | Due count for complications and home screen |

### New API Work Required

| Endpoint/Change | Purpose |
|-----------------|---------|
| `GET /v1/analytics/weekly-summary` | Weekly stats for rest-day summary (reviewed, newLearned, burned, accuracy, streakDays) |
| Post-submit hook in `SrsService.submitReview()` | Call `NotificationService.notifyStudyMates(userId, summary)` after session recorded |
| `NotificationService.notifyStudyMates()` | Push notification to user's study mates when they complete a session (1/friend/day cap) |
| `NotificationService.sendRestDaySummary()` | Weekly summary push on user's rest day at their `reminderHour` |
| `PATCH /v1/user/profile` — add `watchEnabled` field | Persist Apple Watch toggle setting |

---

## Project Structure

```
apps/
  watch/                              <- NEW: Xcode project
    KanjiLearnWatch/
      KanjiLearnWatchApp.swift        -- App entry point
      Models/
        KanjiCard.swift               -- Swift port of ReviewQueueItem
        ReviewResult.swift            -- Swift port of ReviewResult
        SessionSummary.swift          -- API response from /v1/review/submit
        SrsStatus.swift               -- Enum: unseen/learning/reviewing/remembered/burned
      Services/
        APIClient.swift               -- URLSession REST client, JWT Bearer auth, { ok, data } envelope decoding
        AuthService.swift             -- Keychain storage, token expiry check, autonomous Supabase token refresh
        WatchSessionManager.swift     -- WCSessionDelegate, receives tokens + settings from iPhone
        NotificationService.swift     -- UNUserNotificationCenter for delay/snooze local notifications
      ViewModels/
        StudyViewModel.swift          -- Session state machine, queue management, offline cache
      Views/
        HomeView.swift                -- Due count display, "Start Study" button, "Delay" button
        CardFaceView.swift            -- Kanji character (question side), status badge, card counter
        CardRevealView.swift          -- Meanings + kun/on readings (answer side)
        SwipeableCardView.swift       -- DragGesture wrapper with 4-directional detection + visual feedback
        SessionCompleteView.swift     -- Accuracy %, correct/total, time, burned, motivational message
        DelayPickerView.swift         -- Encouragement message + snooze time options
        OnboardingOverlay.swift       -- First-launch swipe direction tutorial
      Complications/
        ComplicationProvider.swift    -- WidgetKit due-count complication
      Assets.xcassets
      Info.plist
    KanjiLearnWatch.xcodeproj

  mobile/                             <- EXISTING: modifications needed
    app/(tabs)/profile.tsx            -- ADD: "Apple Watch" settings section with enable toggle
    src/stores/auth.store.ts          -- ADD: WatchConnectivity token push on auth state change
    ios/                              -- ADD: WatchConnectivity native module (Expo config plugin)
    plugins/withWatchConnectivity/    -- NEW: Expo config plugin for native WCSession code

  api/                                <- EXISTING: modifications needed
    src/services/notification.service.ts  -- ADD: notifyStudyMates(), sendRestDaySummary()
    src/services/srs.service.ts           -- ADD: post-submit hook to notify study mates
    src/services/analytics.service.ts     -- ADD: weekly summary computation
    src/routes/analytics.ts               -- ADD: GET /v1/analytics/weekly-summary endpoint
```

---

## Feature Specifications

### 1. Study Flow

#### State Machine (StudyViewModel)

```
.idle -> .loading -> .studying(index, revealed) -> .complete(summary)
                  -> .empty (no cards due)
                  -> .error(message)
```

#### Card Presentation

**Question side (CardFaceView):**
- Kanji character centered, ~48pt San Francisco Rounded
- SRS status badge: color-coded pill (learning=blue, reviewing=purple, remembered=green, burned=gold)
- Card counter: "3/10" at top

**Answer side (CardRevealView) — tap to reveal:**
- Primary meanings (1-2, truncated for Watch screen)
- Kun readings (up to 2) with "kun" label
- On readings (up to 2) with "on" label

#### Data Flow

1. `StudyViewModel` calls `APIClient.fetchQueue(limit: 10)` on session start
2. Queue cached in `UserDefaults` for offline use
3. Each card starts with `revealed = false`
4. User taps to reveal -> sets `revealed = true`, starts response timer
5. User swipes to grade -> records `ReviewResult`, advances to next card
6. After final card: `APIClient.submitResults(results, studyTimeMs)` -> transition to `.complete`
7. If submission fails: buffer results in `UserDefaults`, retry on next launch

### 2. Four-Directional Swipe Grading

| Direction | Grade | SM-2 Quality | Color  | Badge    |
|-----------|-------|-------------|--------|----------|
| Left      | Again | 1           | Red    | X AGAIN  |
| Down      | Hard  | 3           | Orange | ! HARD   |
| Up        | Good  | 4           | Blue   | check GOOD |
| Right     | Easy  | 5           | Green  | check EASY |

**Gesture implementation:**

```swift
DragGesture()
  .onChanged { value in
    let tx = value.translation.width
    let ty = value.translation.height
    // Determine dominant axis, lock to it
    if abs(tx) > abs(ty) {
      horizontalOffset = tx
    } else {
      verticalOffset = ty
    }
    // Show colored badge when past threshold
  }
  .onEnded { value in
    let tx = value.translation.width
    let ty = value.translation.height
    let threshold: CGFloat = 50

    if abs(tx) > abs(ty) {  // Horizontal dominant
      if tx > threshold { grade(.easy) }
      else if tx < -threshold { grade(.again) }
      else { snapBack() }
    } else {  // Vertical dominant
      if ty < -threshold { grade(.good) }
      else if ty > threshold { grade(.hard) }
      else { snapBack() }
    }
  }
```

**Key behaviors:**
- Threshold: 50pt (reduced from mobile's 80px for smaller screen)
- Axis lock: Once dominant axis determined, lock to prevent diagonal confusion
- Haptics: `.click` at threshold crossing; `.success`/`.failure`/`.notification` on grade commit
- Visual: Card shifts in swipe direction, colored grade badge fades in, card flies off-screen on commit
- First-launch onboarding overlay shows all 4 directions with labels

### 3. Session Complete Summary

Port motivational message logic from `apps/mobile/src/components/study/SessionComplete.tsx`:

```swift
func motivationalMessage(accuracy: Int, burned: Int) -> String {
    if burned > 0 { return "burned-fire \(burned) kanji burned!" }
    if accuracy == 100 { return "Perfect session!" }
    if accuracy >= 90 { return "Outstanding recall!" }
    if accuracy >= 80 { return "Great work -- solid retention." }
    if accuracy >= 70 { return "Good session -- keep it up." }
    if accuracy >= 60 { return "Decent effort -- review the misses." }
    return "Tough session -- you'll improve tomorrow."
}
```

**Display:**
- Motivational message (top)
- Accuracy % with color coding (green >= 80, yellow >= 60, red < 60)
- Correct / Total count
- Study time (formatted as Xm Ys)
- Burned count (if > 0)
- "Done" button returns to HomeView

### 4. Delay/Snooze with Encouragement

When user taps "Delay" on HomeView, show **DelayPickerView** with context-aware encouragement before delay options.

**Encouragement messages (priority order, show first matching):**

1. **Daily goal context:** "You have {dueCount} cards waiting -- that's your full daily goal! A quick session now keeps your streak alive."
2. **Study mate competition:** "{N} study mate(s) already studied today. Don't let them pull ahead!" OR "You're leading your study mates today -- keep the edge!"
3. **Streak preservation:** "You're on a {N}-day streak! Don't break the chain."
4. **SRS urgency (fallback):** "Regular practice is the key to retention. Delayed cards pile up and become harder tomorrow."

**Data sources:** `GET /v1/review/status` (due count, today's reviewed) + cached profile (dailyGoal, streak) + `GET /v1/social/friends` (study mate activity). Cache to avoid redundant network calls.

**Delay options:**
- 1 hour
- 2 hours
- 4 hours
- Tonight (8 PM)
- Tomorrow morning (8 AM)

**Prominent "Study Now" primary button** above delay options.

**On delay selection:**
1. Schedule `UNUserNotificationCenter` local notification at chosen time
2. Notification body: "Time to study! {N} kanji waiting."
3. Store delay timestamp in `UserDefaults`
4. Dismiss study prompt on HomeView until that time

### 5. Study Prompting Strategy

**Six signal sources, layered to avoid notification fatigue:**

| Source | Type | Status | Default |
|--------|------|--------|---------|
| iPhone daily reminder (push) | Mirrors to Watch automatically | Existing | On (per user settings) |
| Watch complication (due count) | Passive glance on watch face | New | On |
| Watch background refresh (local) | Smart local notification | New | Off |
| Intervention nudges (push) | Mirrors to Watch automatically | Existing | On |
| Study mate activity alerts (push) | Competitive motivation | New | On |
| Rest day weekly summary (push) | Praise + progress recap | New | On |

**Watch background refresh logic (when enabled):**

```swift
// WKApplicationRefreshBackgroundTask, ~every 2 hours
func handleBackgroundRefresh() {
    let status = await apiClient.fetchStatus()
    let profile = cachedProfile

    // Only prompt if ALL conditions met:
    // 1. Cards are due (status.dueCount > 0)
    // 2. User hasn't studied today (status.todayReviewed == 0)
    // 3. Current hour >= user's reminderHour
    // 4. Today is not their restDay
    // 5. No prompt sent in last 4 hours (anti-spam)

    if shouldPrompt {
        scheduleLocalNotification(...)
        updateComplication(dueCount: status.dueCount)
    }
}
```

**Relationship to iOS app settings:**

| iOS Setting | Watch Behavior |
|-------------|----------------|
| `reminderHour` | Watch won't prompt before this hour |
| `restDay` | Watch suppresses study prompts (shows weekly summary instead) |
| `notificationsEnabled` | Master kill switch for Watch local prompts |
| `dailyGoal` | Referenced in encouragement messages |

Settings sync to Watch via `WatchConnectivity.updateApplicationContext()`.

### 6. Study Mate Activity Alerts

When a study mate completes a session, push notification to the user:

- **Title:** "{friendName} just studied!"
- **Body:** "They reviewed {count} kanji. Ready to match them?"
- **Action:** "Start Study" deep-links into Watch study flow
- **Frequency cap:** Max 1 alert per friend per day
- **Implementation:** Post-submit hook in `SrsService.submitReview()` calls `NotificationService.notifyStudyMates(userId, summary)`

### 7. Rest Day Weekly Summary

On user's configured rest day, at their `reminderHour`, deliver a praise-focused weekly recap:

- **Title:** "Rest day -- you earned it!"
- **Content:** Week's reviewed count, new learned, burned, accuracy %, streak days
- **Tone:** Always positive. Never guilt.
- **Action:** "Study Anyway" button -- rest day is a suggestion, not a lock-out
- **Reminder:** "You can study on your Watch anytime, even today!"
- **Data:** New `GET /v1/analytics/weekly-summary` endpoint returning trailing 7 days of `daily_stats`

### 8. iOS App Settings Toggle

Add "Apple Watch" section to existing `ProfileScreen` (`apps/mobile/app/(tabs)/profile.tsx`):

```
Section: Apple Watch
  [switch] Enable Apple Watch
  Subtitle: "Sync study sessions to your Watch"
  Status line: "Connected" | "Watch not paired" | "Watch app not installed"
```

**When enabled:** Activates `WCSession`, pushes auth tokens + settings to Watch
**When disabled:** Stops token sync; Watch uses cached token until expiry
**Persistence:** `PATCH /v1/user/profile` (new `watchEnabled` field) + AsyncStorage locally

---

## Critical Source Files Reference

These existing files inform the Watch implementation. Read them before writing code.

| File | What to Learn |
|------|---------------|
| `packages/shared/src/types.ts` | All TypeScript types to port to Swift (ReviewQueueItem, ReviewResult, SrsStatus, ApiResponse) |
| `packages/shared/src/srs.ts` | SRS algorithm reference (Watch does NOT run this -- API handles it) |
| `packages/shared/src/constants.ts` | Shared constants (SRS ease factors, JLPT counts) |
| `apps/api/src/routes/review.ts` | API endpoints the Watch calls -- request/response shapes |
| `apps/api/src/plugins/auth.ts` | JWT verification: ES256 algorithm, Supabase JWKS public keys |
| `apps/api/src/services/srs.service.ts` | Queue building algorithm, submission logic, session summary format |
| `apps/api/src/services/notification.service.ts` | Existing notification system -- add study mate + rest day methods here |
| `apps/api/src/services/analytics.service.ts` | Analytics queries -- add weekly summary here |
| `apps/mobile/src/stores/auth.store.ts` | Auth state management -- modify to push tokens via WatchConnectivity |
| `apps/mobile/src/stores/review.store.ts` | Zustand review store -- reference for session state machine |
| `apps/mobile/app/(tabs)/study.tsx` | Complete study flow with PanResponder swipe gestures (lines 49-99) |
| `apps/mobile/src/components/study/SessionComplete.tsx` | Motivational message logic (lines 24-33), session summary UI |
| `apps/mobile/src/components/study/GradeButtons.tsx` | Grade quality mapping (Again=1, Hard=3, Good=4, Easy=5) |
| `apps/mobile/app/(tabs)/profile.tsx` | Settings screen pattern -- add Apple Watch toggle section here |
| `apps/mobile/src/lib/api.ts` | API client pattern (Bearer auth, retry logic, error handling) |
| `packages/db/src/schema.ts` | Database schema -- user_profiles (add watchEnabled), review_sessions, review_logs |

---

## API Response Formats (for Swift Codable structs)

### Review Queue Item (from `GET /v1/review/queue`)

```json
{
  "ok": true,
  "data": [
    {
      "kanjiId": 42,
      "character": "食",
      "jlptLevel": "N5",
      "meanings": ["eat", "food"],
      "kunReadings": ["た.べる", "く.う"],
      "onReadings": ["ショク", "ジキ"],
      "exampleVocab": [{ "word": "食べ物", "reading": "たべもの", "meaning": "food" }],
      "status": "reviewing",
      "readingStage": 2,
      "reviewType": "meaning",
      "strokeCount": 9,
      "radicals": ["食"]
    }
  ]
}
```

### Submit Results (to `POST /v1/review/submit`)

```json
{
  "results": [
    { "kanjiId": 42, "quality": 4, "responseTimeMs": 3200, "reviewType": "meaning" }
  ],
  "studyTimeMs": 45000
}
```

### Submit Response

```json
{
  "ok": true,
  "data": {
    "sessionId": "uuid-here",
    "totalItems": 10,
    "correctItems": 8,
    "studyTimeMs": 45000,
    "newLearned": 2,
    "burned": 1
  }
}
```

### Review Status (from `GET /v1/review/status`)

```json
{
  "ok": true,
  "data": {
    "unseen": 1800,
    "learning": 45,
    "reviewing": 120,
    "remembered": 150,
    "burned": 21,
    "dueCount": 35
  }
}
```

---

## Implementation Order

1. **Phase 1 — Foundation:** Xcode project, Swift models, APIClient, AuthService
2. **Phase 2 — Connectivity:** Expo config plugin, WatchConnectivity on both sides, token flow
3. **Phase 3 — Study Flow:** StudyViewModel state machine, card views, 4-directional DragGesture, haptics, offline cache, swipe onboarding
4. **Phase 4 — Summary + Notifications:** SessionCompleteView, DelayPickerView with encouragement, local notification scheduling
5. **Phase 5 — Prompting Strategy:** Background refresh logic, complication provider, study mate activity alerts (API + push), rest day weekly summary (API endpoint + push)
6. **Phase 6 — iOS Settings:** Apple Watch enable toggle in ProfileScreen, WatchConnectivity activation control
7. **Phase 7 — Polish:** Complication refinement, accessibility (VoiceOver), multi-size Watch testing (41/45/49mm), battery optimization, monorepo integration

---

## Verification Checklist

- [ ] Swift models decode all API response formats correctly (unit test with sample JSON)
- [ ] APIClient authenticates and fetches queue from local API server
- [ ] WatchConnectivity delivers token from iPhone simulator to Watch simulator
- [ ] Study flow: load queue -> present card -> tap to reveal -> swipe to grade -> advance -> complete
- [ ] All 4 swipe directions register correct quality (1/3/4/5)
- [ ] Axis lock prevents diagonal mis-grades
- [ ] Haptic feedback fires at threshold and on grade commit
- [ ] Session summary shows correct accuracy, counts, and motivational message
- [ ] Delay picker shows context-aware encouragement (daily goal, study mates, streak)
- [ ] Local notification fires at selected delay time
- [ ] Offline: cached queue works without network; buffered results submit on reconnect
- [ ] Study mate alert fires when a friend completes a session (1/day cap)
- [ ] Rest day summary shows weekly stats with "Study Anyway" option
- [ ] iOS settings toggle enables/disables WatchConnectivity
- [ ] Complication displays due count on watch face
- [ ] Card text doesn't clip on 41mm Watch
- [ ] VoiceOver reads kanji character, meanings, and readings correctly

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| WatchConnectivity token delivery delayed/fails | Watch refreshes tokens autonomously via Supabase REST endpoint |
| Expo config plugin complexity (native code in managed workflow) | Use `expo prebuild` + EAS Build; test incrementally; fallback to manual QR-code token entry |
| Small screen truncates Japanese text | Cap displayed readings at 2 each; compact layout; test on 41mm Watch |
| 4-directional swipe confusion | Axis-locking prevents diagonal misgrading; first-launch onboarding overlay; haptic feedback confirms grade |
| Study mate notification spam | 1 alert per friend per day cap; controlled by notificationsEnabled toggle |
| Battery drain from background refresh | Default off; when enabled, limit to every 2 hours; no persistent connections |
