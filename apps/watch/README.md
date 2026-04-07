# Kanji Learn — Apple Watch App

Native SwiftUI watchOS 10.0+ companion for the Kanji-Learn iOS app.

## Xcode Project Setup

The Swift source files live in `apps/watch/KanjiLearnWatch/`. You need to create
the Xcode project manually (the `.xcodeproj` bundle cannot be generated from plain text):

### Steps

1. Open Xcode → **File → New → Project**
2. Select **watchOS → App** (not "Watch App for iOS App" — this is a standalone Watch app)
3. Configure:
   - **Product Name:** `KanjiLearnWatch`
   - **Bundle Identifier:** `com.rdennis.kanjilearn2.watchkitapp`
   - **Minimum Deployment:** watchOS 10.0
   - **Language:** Swift
   - **Interface:** SwiftUI
4. Save the project into `apps/watch/` (replace the generated source files with the ones in this repo)
5. Add all `.swift` files from `KanjiLearnWatch/` to the Xcode target
6. In **Build Settings**, add a User-Defined setting:
   - `KL_API_BASE_URL` = `http://<your-LAN-IP>:3000` (development)
7. In the scheme **Environment Variables**, set `KL_API_BASE_URL` if needed for simulator

### Frameworks required (add in "Frameworks, Libraries" in target settings)

- `WatchConnectivity.framework` — token sync with iPhone
- `UserNotifications.framework` — study delay local notifications
- `WidgetKit.framework` — complications (Phase 5)

### Signing

Use your Apple Developer team. Bundle ID: `com.rdennis.kanjilearn2.watchkitapp`

## Development

```bash
# Run the API locally
pnpm --filter @kanji-learn/api dev

# Open the Xcode project and run on Watch Simulator or physical Watch
open apps/watch/KanjiLearnWatch.xcodeproj
```

## Architecture

See `../../WATCHOS_SPEC.md` for the full specification.

### Phase 1 (complete): Foundation
- `Models/` — Swift Codable structs matching API JSON shapes
- `Services/APIClient.swift` — URLSession REST client with JWT Bearer auth
- `Services/AuthService.swift` — Keychain token storage + autonomous Supabase refresh
- `Services/WatchSessionManager.swift` — WCSessionDelegate stub
- `Services/NotificationService.swift` — delay/snooze scheduling primitives

### Phase 2 (next): WatchConnectivity
- Expo config plugin to push tokens from iPhone to Watch
- Full bidirectional token + settings sync

### Phase 3: Study Flow
- `ViewModels/StudyViewModel.swift` — session state machine
- `Views/CardFaceView.swift`, `CardRevealView.swift`, `SwipeableCardView.swift`

### Phase 4: Summary + Notifications
- `Views/SessionCompleteView.swift`, `DelayPickerView.swift`, `OnboardingOverlay.swift`

### Phase 5: Prompting Strategy
- `Complications/ComplicationProvider.swift`
- API: study mate alerts, rest-day weekly summary endpoint

### Phase 6: iOS Settings Toggle
- `apps/mobile/app/(tabs)/profile.tsx` — Apple Watch section

### Phase 7: Polish
- Accessibility, multi-size testing, battery optimization
