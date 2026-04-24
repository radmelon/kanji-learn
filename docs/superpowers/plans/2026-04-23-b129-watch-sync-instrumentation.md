# B129 Watch Sync Instrumentation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument the iPhone↔Watch WCSession flow with correlated, timestamped logs on both sides and surface currently-swallowed errors on the Watch so the next "0 cards / slow sync" report has evidence to diagnose root cause.

**Architecture:** Pure-logging changes on the iPhone push path (`NSLog`) and the Watch receive / auth / queue paths (`print`). One behaviour change: the Watch's HomeView currently catches *all* `fetchStatus` errors silently and renders 0 cards with no feedback; this plan adds a dismissable error banner that shows the real failure (auth, network, decode) so the user (and we) can see what actually happened. No functional change to the sync protocol.

**Tech Stack:** Expo config plugin (JS string → Swift), React Native native module, WatchConnectivity, SwiftUI, NSLog / OSLog.

**Out of scope:**
- Fixing the underlying race / delivery issue — that's B130, informed by the logs this build produces.
- OSLog / os_log migration (NSLog is enough for Console.app filtering at this stage).
- Watch → iPhone reverse-channel ("request fresh tokens") — deferred to B130.

**Log conventions (both platforms):**
- iPhone prefix: `[KL-Push]`
- Watch prefix: `[KL-Watch]`
- Every line starts with a millisecond epoch timestamp so iPhone and Watch lines can be aligned in Console.app.
- **Never log token values.** Log `"SET"` / `"UNSET"`, `expiresIn=42s`, or the last 4 chars of a token if absolutely needed for correlation.

---

## File Structure

**iPhone push path:**
- Modify: `apps/mobile/plugins/withWatchConnectivity/index.js` — expand NSLog in the generated Swift template; accept a `reason` string through the bridge
- Modify: `apps/mobile/src/stores/auth.store.ts` — thread a `reason` arg through `pushToWatch`, log trigger + `watchEnabled` gate result
- Modify: `apps/mobile/app/(tabs)/profile.tsx` — pass `reason: "profile-save"` when invoking `syncToWatch()`

**Watch receive / auth / queue:**
- Modify: `apps/watch/KanjiLearnWatch/Services/WatchSessionManager.swift` — log `activationDidCompleteWith`, `sessionReachabilityDidChange`, `didReceiveApplicationContext`
- Modify: `apps/watch/KanjiLearnWatch/Services/AuthService.swift` — log `getAccessToken` path (cached vs refresh), every `refresh()` attempt + outcome, every `clear()` call
- Modify: `apps/watch/KanjiLearnWatch/Views/HomeView.swift` — replace silent catch with a visible dismissable error banner

**Build & release:**
- Modify: `apps/mobile/app.json` — bump `ios.buildNumber` from `128` to `129` (reminder only; EAS auto-bumps)

**No new files.** No new dependencies.

---

## Task 1: Thread a `reason` string through the iPhone push bridge

**Files:**
- Modify: `apps/mobile/src/stores/auth.store.ts:13-31` (bridge type), `:37-77` (`pushToWatch`), `:118` / `:132` / `:205` / `:212` / `:221` (call sites)
- Modify: `apps/mobile/plugins/withWatchConnectivity/index.js:56-98` (Swift push method), `:138-150` (ObjC bridge signature)
- Modify: `apps/mobile/app/(tabs)/profile.tsx:206`

**Why:** Every push currently looks identical in any log. Knowing *which* trigger fired (sign-in, token-refresh, profile-save, force-sync, enable-toggle) is the single most useful axis for correlating iPhone logs with Watch symptoms.

- [ ] **Step 1: Add `reason` param to the TypeScript bridge type and `pushToWatch` signature**

In `apps/mobile/src/stores/auth.store.ts`, update the `WatchConnectivity` const's type:

```ts
const WatchConnectivity: {
  pushTokensToWatch: (
    accessToken: string,
    refreshToken: string,
    expiresAt: number,
    supabaseURL: string,
    apiBaseURL: string,
    watchEnabled: boolean,
    dailyGoal: number,
    reminderHour: number,
    restDay: number,
    reason: string,
  ) => Promise<{ sent: boolean; reason?: string }>
  getConnectionStatus: () => Promise<{
    supported: boolean
    paired?: boolean
    watchAppInstalled?: boolean
    reachable?: boolean
  }>
} | null = Platform.OS === 'ios' ? NativeModules.WatchConnectivity ?? null : null
```

Then update `pushToWatch` to accept and pass `reason`:

```ts
async function pushToWatch(
  session: Session,
  reason: string,
  force = false,
): Promise<PushResult | null> {
  if (!WatchConnectivity) return null

  try {
    const watchEnabled = (await storage.getItem<boolean>(WATCH_ENABLED_KEY)) ?? false
    if (!force && !watchEnabled) {
      console.log(`[KL-Push] ${Date.now()} skip reason=${reason} gate=watchEnabled-false force=${force}`)
      return null
    }

    const cached = await storage.getItem<{
      data?: { dailyGoal?: number; reminderHour?: number; restDay?: number | null }
    }>('kl:profile_cache')
    const profile = cached?.data

    const supabaseURL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
    const apiBaseURL  = process.env.EXPO_PUBLIC_API_URL ?? ''

    const expiresAt = session.expires_at ?? Math.floor(Date.now() / 1000) + 3600
    const expiresInSec = expiresAt - Math.floor(Date.now() / 1000)

    console.log(
      `[KL-Push] ${Date.now()} push reason=${reason} watchEnabled=${watchEnabled} ` +
      `force=${force} dailyGoal=${profile?.dailyGoal ?? 20} ` +
      `reminderHour=${profile?.reminderHour ?? 20} restDay=${profile?.restDay ?? -1} ` +
      `expiresInSec=${expiresInSec} apiBaseURL=${apiBaseURL ? 'SET' : 'EMPTY'}`,
    )

    const result = await WatchConnectivity.pushTokensToWatch(
      session.access_token,
      session.refresh_token ?? '',
      expiresAt,
      supabaseURL,
      apiBaseURL,
      watchEnabled,
      profile?.dailyGoal ?? 20,
      profile?.reminderHour ?? 20,
      profile?.restDay ?? -1,
      reason,
    )

    console.log(`[KL-Push] ${Date.now()} pushResult reason=${reason} result=${JSON.stringify(result)}`)
    return result
  } catch (err) {
    console.warn(`[KL-Push] ${Date.now()} pushThrew reason=${reason} err=${String(err)}`)
    return { sent: false, reason: String(err) }
  }
}
```

- [ ] **Step 2: Update all call sites to pass a descriptive `reason`**

Still in `apps/mobile/src/stores/auth.store.ts`:

- Line 118 (`onAuthStateChange`): `if (session) void pushToWatch(session, \`auth-${_event}\`)`
  - Capture the event name — `_event` is already the Supabase `AuthChangeEvent` enum string (e.g. `INITIAL_SESSION`, `TOKEN_REFRESHED`, `SIGNED_IN`). Drop the leading underscore in the parameter since we're now using it:

```ts
supabase.auth.onAuthStateChange((event, session) => {
  set({ session, user: session?.user ?? null })
  if (session) void pushToWatch(session, `auth-${event}`)
})
```

- Line 132 (`signIn`): `if (data.session) void pushToWatch(data.session, 'signIn')`
- Line 205 (`setWatchEnabled`): `if (enabled && session) return pushToWatch(session, 'setWatchEnabled')`
- Line 212 (`forceSyncToWatch`): `return pushToWatch(session, 'forceSync', true)`
- Line 221 (`syncToWatch`): `return pushToWatch(session, 'syncToWatch', false)`

- [ ] **Step 3: Update `syncToWatch` external signature if callers pass a reason**

`syncToWatch()` is called with no args from `profile.tsx:206`. We want the caller to name the reason. Change the signature to accept a reason:

In `auth.store.ts` `AuthState` interface (line 96):

```ts
syncToWatch: (reason: string) => Promise<PushResult | null>
```

And the implementation:

```ts
syncToWatch: async (reason: string) => {
  const { session } = get()
  if (!session) return null
  return pushToWatch(session, `syncToWatch-${reason}`, false)
},
```

In `apps/mobile/app/(tabs)/profile.tsx:206`:

```ts
void syncToWatch('profile-save')
```

- [ ] **Step 4: Update the ObjC bridge method signature in the Expo plugin template**

In `apps/mobile/plugins/withWatchConnectivity/index.js`, the `WATCH_MODULE_M` constant (lines 130-158) declares the bridge. Add `reason:(NSString *)reason` before `resolve:`:

```objc
const WATCH_MODULE_M = `// WatchConnectivityModule.m
// Auto-generated by plugins/withWatchConnectivity — do not edit manually.
// Exposes WatchConnectivityModule to the React Native bridge.

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(WatchConnectivity, NSObject)

RCT_EXTERN_METHOD(
  pushTokensToWatch:(NSString *)accessToken
  refreshToken:(NSString *)refreshToken
  expiresAt:(double)expiresAt
  supabaseURL:(NSString *)supabaseURL
  apiBaseURL:(NSString *)apiBaseURL
  watchEnabled:(BOOL)watchEnabled
  dailyGoal:(NSInteger)dailyGoal
  reminderHour:(NSInteger)reminderHour
  restDay:(NSInteger)restDay
  reason:(NSString *)reason
  resolve:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
  getConnectionStatus:(RCTPromiseResolveBlock)resolve
  reject:(RCTPromiseRejectBlock)reject
)

@end
`
```

- [ ] **Step 5: Update the Swift `@objc pushTokensToWatch` signature + body to accept and log `reason`**

In `apps/mobile/plugins/withWatchConnectivity/index.js`, the `WATCH_MODULE_SWIFT` constant (lines 25-128). Replace the `pushTokensToWatch` method with:

```swift
@objc func pushTokensToWatch(
  _ accessToken: String,
  refreshToken: String,
  expiresAt: Double,
  supabaseURL: String,
  apiBaseURL: String,
  watchEnabled: Bool,
  dailyGoal: Int,
  reminderHour: Int,
  restDay: Int,
  reason: String,
  resolve: @escaping RCTPromiseResolveBlock,
  reject: @escaping RCTPromiseRejectBlock
) {
  let ts = Int(Date().timeIntervalSince1970 * 1000)

  guard let session, session.isPaired else {
    NSLog("[KL-Push] %ld push reason=%@ skip=not-paired isPaired=0", ts, reason)
    resolve(["sent": false, "reason": "watch_not_available"])
    return
  }

  var context: [String: Any] = [
    "accessToken":  accessToken,
    "refreshToken": refreshToken,
    "expiresAt":    expiresAt,
    "supabaseURL":  supabaseURL,
    "apiBaseURL":   apiBaseURL,
    "watchEnabled": watchEnabled,
    "dailyGoal":    dailyGoal,
    "reminderHour": reminderHour,
    // Include reason so the Watch can log the same trigger key when it arrives.
    "pushReason":   reason,
    // Include the push timestamp so Watch can log arrival latency.
    "pushTsMs":     ts,
  ]
  if restDay >= 0 { context["restDay"] = restDay }

  let expiresInSec = Int(expiresAt - Date().timeIntervalSince1970)
  NSLog("[KL-Push] %ld push reason=%@ isPaired=%ld isReachable=%ld dailyGoal=%ld expiresInSec=%ld",
        ts, reason, session.isPaired ? 1 : 0, session.isReachable ? 1 : 0, dailyGoal, expiresInSec)

  do {
    try session.updateApplicationContext(context)
    NSLog("[KL-Push] %ld push reason=%@ result=ok", ts, reason)
    resolve(["sent": true])
  } catch {
    NSLog("[KL-Push] %ld push reason=%@ result=error err=%@", ts, reason, error.localizedDescription)
    resolve(["sent": false, "reason": error.localizedDescription])
  }
}
```

- [ ] **Step 6: Run type check and typecheck-fix any strays**

```bash
cd apps/mobile && pnpm exec tsc --noEmit
```

Expected: No type errors. If there are errors about `syncToWatch` callers, update them to pass a reason string.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/stores/auth.store.ts \
        apps/mobile/plugins/withWatchConnectivity/index.js \
        apps/mobile/app/\(tabs\)/profile.tsx
git commit -m "feat(mobile)[instrument]: thread push reason through Watch bridge

Every updateApplicationContext now logs a named trigger (auth-*, signIn,
syncToWatch-profile-save, forceSync, setWatchEnabled) + timestamp so
iPhone and Watch logs can be correlated in Console.app.

Context now carries pushReason + pushTsMs so the Watch can log arrival
latency against the same trigger.

B129 instrumentation — no behavioral change.

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Watch-side receipt, activation, reachability logs

**Files:**
- Modify: `apps/watch/KanjiLearnWatch/Services/WatchSessionManager.swift:72-131`

**Why:** Currently we only print on missing-fields or success. We need timestamped logs on activation, every reachability flip, and every received context (with the matching `pushReason` from iPhone) to measure round-trip latency and spot "received but ignored" cases.

- [ ] **Step 1: Add timestamped logs to `activationDidCompleteWith`**

In `apps/watch/KanjiLearnWatch/Services/WatchSessionManager.swift`, replace lines 72-80 with:

```swift
func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    let ts = Int(Date().timeIntervalSince1970 * 1000)
    let stateStr: String
    switch activationState {
    case .notActivated: stateStr = "notActivated"
    case .inactive:     stateStr = "inactive"
    case .activated:    stateStr = "activated"
    @unknown default:   stateStr = "unknown(\(activationState.rawValue))"
    }
    let keychainHasToken = AuthService.shared.isAuthenticated ? 1 : 0
    let errStr = error.map { $0.localizedDescription } ?? "nil"
    print("[KL-Watch] \(ts) activation state=\(stateStr) reachable=\(session.isReachable) keychainHasToken=\(keychainHasToken) err=\(errStr)")

    DispatchQueue.main.async {
        self.isReachable = session.isReachable
        self.updateConnectionStatus(session)
    }
    if let error {
        print("[KL-Watch] \(ts) activation-error \(error)")
    }
}
```

- [ ] **Step 2: Log every reachability flip**

Replace `sessionReachabilityDidChange` (lines 82-87) with:

```swift
func sessionReachabilityDidChange(_ session: WCSession) {
    let ts = Int(Date().timeIntervalSince1970 * 1000)
    print("[KL-Watch] \(ts) reachabilityDidChange reachable=\(session.isReachable)")
    DispatchQueue.main.async {
        self.isReachable = session.isReachable
        self.updateConnectionStatus(session)
    }
}
```

- [ ] **Step 3: Log every received applicationContext with matching pushReason**

Replace `session(_:didReceiveApplicationContext:)` (lines 90-131) with:

```swift
func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    let ts = Int(Date().timeIntervalSince1970 * 1000)
    let pushReason = applicationContext["pushReason"] as? String ?? "unknown"
    let pushTsMs   = applicationContext["pushTsMs"]   as? Int ?? 0
    let latencyMs  = pushTsMs > 0 ? ts - pushTsMs : -1
    let keys = applicationContext.keys.sorted().joined(separator: ",")

    guard
        let accessToken  = applicationContext["accessToken"]  as? String,
        let refreshToken = applicationContext["refreshToken"] as? String,
        let expiresAt    = applicationContext["expiresAt"]    as? Double,
        let supabaseURL  = applicationContext["supabaseURL"]  as? String,
        let apiBaseURL   = applicationContext["apiBaseURL"]   as? String
    else {
        print("[KL-Watch] \(ts) contextReceived reason=\(pushReason) latencyMs=\(latencyMs) result=missing-fields keys=[\(keys)]")
        return
    }

    let expiry = Date(timeIntervalSince1970: expiresAt)
    let expiresInSec = Int(expiry.timeIntervalSinceNow)
    AuthService.shared.store(
        accessToken:  accessToken,
        refreshToken: refreshToken,
        expiresAt:    expiry,
        supabaseURL:  supabaseURL,
        apiBaseURL:   apiBaseURL
    )

    var settingsApplied: [String] = []
    if let watchEnabled = applicationContext["watchEnabled"] as? Bool {
        UserDefaults.standard.set(watchEnabled, forKey: "kl_watch_enabled")
        settingsApplied.append("watchEnabled=\(watchEnabled)")
    }
    if let dailyGoal = applicationContext["dailyGoal"] as? Int {
        UserDefaults.standard.set(dailyGoal, forKey: "kl_daily_goal")
        settingsApplied.append("dailyGoal=\(dailyGoal)")
    }
    if let reminderHour = applicationContext["reminderHour"] as? Int {
        UserDefaults.standard.set(reminderHour, forKey: "kl_reminder_hour")
        settingsApplied.append("reminderHour=\(reminderHour)")
    }
    if let restDay = applicationContext["restDay"] as? Int {
        UserDefaults.standard.set(restDay, forKey: "kl_rest_day")
        settingsApplied.append("restDay=\(restDay)")
    } else {
        UserDefaults.standard.removeObject(forKey: "kl_rest_day")
        settingsApplied.append("restDay=nil")
    }

    DispatchQueue.main.async {
        self.isAuthenticated = true
    }

    print("[KL-Watch] \(ts) contextReceived reason=\(pushReason) latencyMs=\(latencyMs) result=applied expiresInSec=\(expiresInSec) settings=[\(settingsApplied.joined(separator: ","))]")
}
```

- [ ] **Step 4: Build the Watch target to confirm compile**

Open the project in Xcode, select the `KanjiLearnWatch` scheme, and Product → Build (⌘B). (If local builds are broken per handoff, defer the compile check to the EAS build.)

Expected: No compile errors.

- [ ] **Step 5: Commit**

```bash
git add apps/watch/KanjiLearnWatch/Services/WatchSessionManager.swift
git commit -m "feat(watch)[instrument]: log activation, reachability, and context receipt

Every WCSession lifecycle event now emits a [KL-Watch] line with epoch-ms
timestamp. Received applicationContext logs the matching pushReason from
the iPhone along with latencyMs so we can measure opportunistic-delivery
delay and pair iPhone/Watch lines in Console.app.

B129 instrumentation — no behavioral change.

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Watch auth lifecycle logs (`getAccessToken`, `refresh`, `clear`)

**Files:**
- Modify: `apps/watch/KanjiLearnWatch/Services/AuthService.swift:78-145`

**Why:** The primary suspect for "0 cards" is a refresh-token race that causes `clear()` to wipe auth. We currently have zero visibility into when `refresh()` runs or why `clear()` was called. These logs pinpoint the exact moment auth goes bad.

- [ ] **Step 1: Log `getAccessToken` path (cached-hit vs refresh-needed vs missing)**

In `apps/watch/KanjiLearnWatch/Services/AuthService.swift`, replace `getAccessToken` (lines 78-93) with:

```swift
func getAccessToken() async throws -> String {
    let ts = Int(Date().timeIntervalSince1970 * 1000)

    guard let accessToken = load(key: KeychainKey.accessToken) else {
        print("[KL-Watch] \(ts) auth.getAccessToken result=missing")
        throw APIError.notAuthenticated
    }

    if let expiresAtStr = load(key: KeychainKey.expiresAt),
       let expiresAtTs = Double(expiresAtStr) {
        let expiresAt = Date(timeIntervalSince1970: expiresAtTs)
        let expiresInSec = Int(expiresAt.timeIntervalSinceNow)
        if Date().addingTimeInterval(60) >= expiresAt {
            print("[KL-Watch] \(ts) auth.getAccessToken result=refreshing expiresInSec=\(expiresInSec)")
            return try await refresh()
        }
        print("[KL-Watch] \(ts) auth.getAccessToken result=cached expiresInSec=\(expiresInSec)")
    } else {
        print("[KL-Watch] \(ts) auth.getAccessToken result=cached-no-expiry")
    }

    return accessToken
}
```

- [ ] **Step 2: Log every `refresh()` attempt and outcome**

Replace `refresh()` (lines 97-135) with:

```swift
@discardableResult
func refresh() async throws -> String {
    let ts = Int(Date().timeIntervalSince1970 * 1000)
    guard let refreshToken = load(key: KeychainKey.refreshToken),
          let supabaseURL  = load(key: KeychainKey.supabaseURL) else {
        print("[KL-Watch] \(ts) auth.refresh result=no-refresh-token-or-url")
        throw APIError.notAuthenticated
    }

    // Log last 4 chars of the refresh token so we can spot rotation races in
    // the log stream without leaking the full token.
    let rtSuffix = refreshToken.count >= 4 ? String(refreshToken.suffix(4)) : "?"
    print("[KL-Watch] \(ts) auth.refresh attempt rtSuffix=…\(rtSuffix)")

    guard let url = URL(string: "\(supabaseURL)/auth/v1/token?grant_type=refresh_token") else {
        throw APIError.parseError("Invalid Supabase URL")
    }

    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try JSONEncoder().encode(["refresh_token": refreshToken])

    let (data, response) = try await URLSession.shared.data(for: req)

    guard let http = response as? HTTPURLResponse else {
        print("[KL-Watch] \(ts) auth.refresh result=non-http")
        clear()
        throw APIError.notAuthenticated
    }

    if http.statusCode != 200 {
        let bodyPreview = String(data: data, encoding: .utf8).map { String($0.prefix(160)) } ?? "<binary>"
        print("[KL-Watch] \(ts) auth.refresh result=http-\(http.statusCode) body=\(bodyPreview)")
        clear()
        throw APIError.notAuthenticated
    }

    struct RefreshResponse: Decodable {
        let access_token: String
        let refresh_token: String
        let expires_in: Int
    }

    let body = try JSONDecoder().decode(RefreshResponse.self, from: data)
    let newExpiry = Date().addingTimeInterval(TimeInterval(body.expires_in))
    let newRtSuffix = body.refresh_token.count >= 4 ? String(body.refresh_token.suffix(4)) : "?"

    save(key: KeychainKey.accessToken,  value: body.access_token)
    save(key: KeychainKey.refreshToken, value: body.refresh_token)
    save(key: KeychainKey.expiresAt,    value: String(newExpiry.timeIntervalSince1970))

    print("[KL-Watch] \(ts) auth.refresh result=ok expiresInSec=\(body.expires_in) newRtSuffix=…\(newRtSuffix)")
    return body.access_token
}
```

- [ ] **Step 3: Log every `clear()` call**

Replace `clear()` (lines 139-146) with:

```swift
func clear() {
    let ts = Int(Date().timeIntervalSince1970 * 1000)
    print("[KL-Watch] \(ts) auth.clear called")
    delete(key: KeychainKey.accessToken)
    delete(key: KeychainKey.refreshToken)
    delete(key: KeychainKey.expiresAt)
    delete(key: KeychainKey.supabaseURL)
    delete(key: KeychainKey.apiBaseURL)
    APIClient.shared.baseURL = ""
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/watch/KanjiLearnWatch/Services/AuthService.swift
git commit -m "feat(watch)[instrument]: log auth lifecycle (getAccessToken, refresh, clear)

Every token retrieval, refresh attempt, and keychain clear now emits a
timestamped [KL-Watch] line with the refresh-token suffix (last 4 chars)
so rotation races show up as adjacent attempt/result lines in the log
stream.

B129 instrumentation — no behavioral change.

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Surface the swallowed `fetchStatus` error on HomeView

**Files:**
- Modify: `apps/watch/KanjiLearnWatch/Views/HomeView.swift:14-145`

**Why:** Today every `/v1/review/status` failure (401, network, decode) renders as `status=nil` → dueCount=0 → user sees "0 cards, all caught up." No feedback. This is the only behaviour change in the plan: the catch now stores the error, logs it, and the view renders a dismissable banner below the hero so the user (and we) can see what went wrong. The banner does NOT replace the hero — it's additive so study flow isn't blocked.

WCAG 2.1 AA: banner uses `colors.accent`-style warning with 4.5:1 contrast. `Text` and `Image` colors are explicit (not relying on defaults).

- [ ] **Step 1: Add `lastStatusError` state and populate it in the catch**

In `apps/watch/KanjiLearnWatch/Views/HomeView.swift`, add a new `@State` near the existing ones (around line 19):

```swift
@State private var lastStatusError: String? = nil
```

Replace `refreshStatus()` (lines 131-144) with:

```swift
private func refreshStatus() async {
    guard watchSession.isAuthenticated else {
        let ts = Int(Date().timeIntervalSince1970 * 1000)
        print("[KL-Watch] \(ts) refreshStatus skip=not-authenticated")
        isLoadingStatus = false
        return
    }
    isLoadingStatus = true
    defer { isLoadingStatus = false }

    let ts = Int(Date().timeIntervalSince1970 * 1000)
    do {
        status = try await api.fetchStatus()
        lastStatusError = nil
        print("[KL-Watch] \(ts) refreshStatus result=ok dueCount=\(status?.dueCount ?? -1)")
    } catch {
        let detail = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        lastStatusError = detail
        print("[KL-Watch] \(ts) refreshStatus result=error detail=\(detail)")
    }
}
```

- [ ] **Step 2: Render a dismissable error banner in the VStack**

Still in `HomeView.swift`, inside the `VStack(spacing: 12)` in the body (around line 40, after the `NotAuthenticatedBanner` and before `DueCountHero`), add:

```swift
if let err = lastStatusError {
    StatusErrorBanner(message: err) {
        lastStatusError = nil
    }
}
```

- [ ] **Step 3: Add the `StatusErrorBanner` sub-view**

Add at the end of the file, alongside `NotAuthenticatedBanner`:

```swift
private struct StatusErrorBanner: View {
    let message: String
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13))
                .foregroundColor(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("Sync error")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.primary)
                Text(message)
                    .font(.system(size: 10))
                    .foregroundColor(.primary)
                    .lineLimit(4)
            }
            Spacer(minLength: 4)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss error")
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.15))
        .cornerRadius(8)
    }
}
```

- [ ] **Step 4: Manual verification checklist (documented only — executed during B129 TestFlight test)**

These aren't executable now; they go in the B129 verification section of HANDOFF.md (Task 6):

- [ ] Airplane-mode the Watch, open app → banner shows "Network error: ..."
- [ ] Tap the X → banner disappears.
- [ ] Force-quit the iPhone app and clear auth via Xcode keychain reset (simulator only) → banner shows "Not authenticated. Please open the iPhone app to sync your credentials."
- [ ] Normal case (connected, auth valid) → no banner, hero renders normally.

- [ ] **Step 5: Commit**

```bash
git add apps/watch/KanjiLearnWatch/Views/HomeView.swift
git commit -m "feat(watch): surface fetchStatus errors as dismissable banner

Previously all /v1/review/status failures were silently swallowed,
rendering as 'dueCount=0 / all caught up' with no feedback. Now a
dismissable error banner renders the real error (auth, network, decode)
below the hero so the user — and the log stream — can see why sync
failed.

Refactored refreshStatus to log every outcome (ok, skip, error) with
timestamp + detail.

B129 — behavior change: new UI surface; no change to sync protocol.

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Cut B129 build + document log-capture procedure

**Files:**
- Modify: `apps/mobile/app.json:33`
- Modify: `docs/HANDOFF.md` — add a "B129 log-capture procedure" section

**Why:** The logs are useless if we don't know how to retrieve them. Document the exact Console.app filter so whoever reproduces the bug (Buddy, Bucky) can capture the stream and hand it back.

- [ ] **Step 1: Bump buildNumber reminder**

`apps/mobile/app.json`: EAS auto-bumps on build, so this is a reference marker only. Leave at 128 — EAS will set it to 129.

(No commit for this step — EAS rewrites during build.)

- [ ] **Step 2: Append "B129 log-capture procedure" to docs/HANDOFF.md**

At the end of HANDOFF.md, add:

```markdown

---

## B129 log-capture procedure

B129 adds correlated logs on both the iPhone and Watch. When reproducing
the Watch "0 cards / slow sync" bug, capture the full stream so the log
lines can be paired by epoch-ms timestamp.

**Steps:**

1. Connect the iPhone to a Mac via USB. (Watch logs are forwarded through
   the paired iPhone.)
2. Open `Console.app` on the Mac.
3. In the device sidebar, select the iPhone.
4. In the search bar at the top, filter: `[KL-Push] OR [KL-Watch]`.
5. Click **Start** to begin streaming.
6. Reproduce the bug on device.
7. Click **Pause**, ⌘A to select all, ⌘C, paste into the bug report
   (or save to a file and attach).

**What the logs prove:**

- Every iPhone push line: `[KL-Push] <epoch-ms> push reason=<trigger> ...`
- Every Watch context receipt: `[KL-Watch] <epoch-ms> contextReceived reason=<trigger> latencyMs=N ...`
- If `latencyMs` is seconds-to-minutes, that's opportunistic-delivery lag.
- If a push line has no matching receipt line, delivery never happened.
- If `auth.refresh result=http-400` appears, that's the refresh-token
  rotation race — compare the `rtSuffix` to the last pushed `refreshToken`.
- If `auth.clear called` appears without a corresponding sign-out, auth
  was nuked by a failed refresh — the banner on HomeView should now show
  the error.
```

- [ ] **Step 3: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "docs: document B129 Console.app log-capture procedure

So whoever reproduces the Watch sync bug can hand back the correlated
[KL-Push]/[KL-Watch] log stream.

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Cut EAS build + submit**

From repo root, follow the standard TestFlight flow (same as B127/B128). EAS auto-bumps buildNumber → 129.

```bash
cd apps/mobile
eas build --profile production --platform ios --non-interactive
# After build succeeds:
eas submit --profile production --platform ios --latest --non-interactive
```

Note: pay-as-you-go ~$2 per build (per handoff).

---

## Bug-reproduction protocol (for B129 TestFlight session)

Before tapping anything, start Console.app capture (Task 5 Step 2 procedure).

Then replay the original symptom:

1. Ensure `watchEnabled=true` on iPhone.
2. Put iPhone into background for >1 hour (access token expires at ~1h on Supabase).
3. Lift Watch → open Kanji Learn → observe.
4. If "0 cards" or sync error banner appears, the log stream now has the cause.

Expected from the log stream given each hypothesis:

| Hypothesis | Log signature |
|---|---|
| A (refresh race) | `[KL-Watch] auth.refresh result=http-400` followed by `auth.clear called`, all *before* any `[KL-Push] ... TOKEN_REFRESHED` from iPhone |
| B (context delivery lag) | `[KL-Push] push reason=...` on iPhone with no matching `[KL-Watch] contextReceived` for seconds-to-minutes |
| C (cold-launch, empty keychain) | `[KL-Watch] activation ... keychainHasToken=0` at launch; no `auth.refresh` attempt |
| D (server returned 0) | `[KL-Watch] refreshStatus result=ok dueCount=0` — cleanly, no errors |
| E (swallowed errors) — *already fixed by Task 4* | Banner now shows the real error |
| F (warm foreground, no push) | Foregrounding iPhone produces no `[KL-Push] push reason=auth-INITIAL_SESSION` line |

---

## Self-review notes

- Every task has concrete code. No placeholders.
- TDD is skipped for pure logging (no behavior to assert) — pragmatic application of YAGNI. Task 4 is a UI change but SwiftUI view testing requires XCUITest scaffolding we don't have; deferred to manual on-device checklist.
- `syncToWatch` signature changed to require `reason: string` — all callers updated in Task 1 Step 2/3.
- `pushTokensToWatch` Swift signature, ObjC bridge, and TS type are all updated together in Task 1.
- Context keys `pushReason` and `pushTsMs` are added in Task 1 Step 5 and consumed in Task 2 Step 3 — paired.
- `[KL-Push]` / `[KL-Watch]` prefixes are used consistently throughout; timestamps are epoch-ms on both sides so `sort` aligns them.
- No token values are ever logged; only `SET`/`UNSET`, last-4 refresh-token suffix, and `expiresInSec`.
