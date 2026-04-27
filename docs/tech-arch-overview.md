# 漢字 Buddy — Tech Architecture Overview

A living document that distils how the Kanji Buddy stack works in practice — process boundaries, dependencies, data flows, deployment surfaces, and the few pieces of subtle state worth knowing about. Written incrementally across sessions; later sessions extend or correct earlier ones.

This is **not** an exhaustive code-tour. The goal is the level of detail a senior engineer needs in their head before diving into a specific subsystem — enough to know which file to open, which process to suspect, and which assumptions are load-bearing.

## Conventions

- File references use repo-relative paths so they remain stable across machines.
- "Watch" = the standalone watchOS Swift app. "iPhone" = the Expo/React Native iOS app. "API" = the Fastify server on AWS App Runner.
- Sequence diagrams use Mermaid, which renders on GitHub.
- Each section ends with a **Files of interest** list so the section doubles as a navigation index.

## Sections

- [Apple Watch](#apple-watch)

---

## Apple Watch

### Summary

Two separate apps on two separate devices, bridged by a one-shot auth handoff. The Watch is **mostly autonomous** after that handoff: it has its own keychain, network stack, API client, and Supabase token-refresh logic, and it talks to the API at AWS App Runner over its own HTTPS connection. The iPhone app **does not need to be running** during normal Watch use; it only needs to run occasionally to deliver fresh auth credentials and user-preference updates to the Watch via `WCSession.updateApplicationContext`.

### The two processes

| | iPhone app | Watch app |
|---|---|---|
| Path | `apps/mobile/` | `apps/watch/KanjiLearnWatch.xcodeproj` |
| Stack | Expo + React Native (TypeScript) | Native SwiftUI (watchOS) |
| Bundle | `com.rdennis.kanjilearn2` | `com.rdennis.kanjilearn2.watchkitapp` |
| Build pipeline | EAS Cloud (`eas build`) | Manual Xcode build → run on device or TestFlight Watch slot |
| Owns | Supabase auth flow, full feature surface | Local SwiftUI shell, due-card hero, study session |
| Talks to API | Yes, directly over HTTPS | Yes, directly over HTTPS |

The two apps share **no memory** and **no code**. Their only connection at runtime is the WCSession bridge described below.

> **Build-cycle gotcha:** EAS does not build the watchOS bundle. After any Swift change in `apps/watch/`, the change ships to the wrist only when the user rebuilds via Xcode → run on Watch (or archives + submits the Watch through App Store Connect's Watch app slot). Do not assume an EAS B-build delivers Watch fixes.

### What the iPhone gives the Watch (one-shot, then cached)

The iPhone is the **source of truth for auth and a few user preferences**. It pushes them to the Watch via `WCSession.updateApplicationContext`, a store-and-forward queue where each new payload replaces the previous undelivered one. Looking at `WatchSessionManager.didReceiveApplicationContext`, the Watch expects this payload shape:

| Field | Purpose |
|---|---|
| `accessToken` | Supabase JWT used as `Authorization: Bearer …` on API calls |
| `refreshToken` | Exchanged at Supabase `/auth/v1/token?grant_type=refresh_token` when the access token expires |
| `expiresAt` | Epoch seconds for the access token |
| `supabaseURL` | Needed to construct the refresh endpoint |
| `apiBaseURL` | The App Runner host for API calls |
| `watchEnabled`, `dailyGoal`, `reminderHour`, `restDay` | User prefs that affect the Watch UI |
| `pushReason`, `pushTsMs` | Latency-instrumentation metadata only |

On receipt, `AuthService.store(...)` writes the auth fields and `apiBaseURL` to the **Watch's own keychain**, and the rest into the Watch's `UserDefaults`. The Watch never asks the iPhone for these again unless the iPhone pushes a new context payload.

### After the handoff, the Watch is independent

A Watch with a populated keychain can cold-launch and do useful work without the iPhone process being alive at all:

1. `WatchSessionManager.activate()` — opens WCSession but does not require the iPhone to be reachable.
2. `AuthService.restoreBaseURL()` — reads `apiBaseURL` from keychain into `APIClient.shared.baseURL`.
3. `HomeView.refreshStatus()` — calls `api.fetchStatus()`, which in turn calls `AuthService.getAccessToken()`.
4. `getAccessToken()` returns the cached token if it has at least 60 s of life left. If expired, it calls `AuthService.refresh()` directly — an HTTPS POST to Supabase, **not routed through the iPhone**. The new access + refresh token are written back to the Watch keychain.
5. The status fetch then hits the API at App Runner over the Watch's own connection (Wi-Fi if available; cellular on cellular Watches; otherwise via the paired iPhone's Bluetooth-bridged IP path).

So the iPhone app being killed, backgrounded, on airplane mode, or simply elsewhere does not break the Watch — provided the Watch has a valid refresh token in its keychain and some internet path. The "internet path" caveat is the only real hardware dependency on the iPhone for non-cellular Watches: they need either Wi-Fi or a Bluetooth-connected iPhone for IP traffic. The iPhone *app* is irrelevant to that.

### When the iPhone *does* need to run

Three scenarios force the iPhone app to come up:

1. **First-time auth handoff.** The Watch keychain starts empty. Until the iPhone app launches at least once after a sign-in and pushes an initial `applicationContext`, the Watch shows the `NotAuthenticatedBanner` and `refreshStatus` short-circuits with `[KL-Watch] refreshStatus skip=not-authenticated`.
2. **Token rotation that exceeds the Watch's autonomous reach.** The Watch's refresh path works as long as the refresh token is still valid and the device clock is correct. If the refresh token has been revoked (sign-out elsewhere, password change, account deletion), the Watch's refresh attempt returns 401 and there is no recovery path on the wrist — the user must re-sign-in on the iPhone, which then pushes a fresh context.
3. **User-preference changes.** Daily goal, reminder hour, rest day, and the watchEnabled master switch all live in iPhone state. The Watch only learns about a change when the iPhone calls `updateApplicationContext` again. Today the iPhone does this opportunistically when settings are saved, which depends on the iPhone process being alive enough to make the call.

### `WCSession.isReachable` semantics

The "iPhone out of range" indicator on the Watch is driven by `session.isReachable`, which tells you whether a **live message can round-trip in real time** — both sides app-foreground, link up. It does not tell you whether the Watch can do useful work, because the Watch's API path doesn't require live RPC at all.

`updateApplicationContext`, by contrast, is the **store-and-forward** API. The iPhone can call it whether or not the Watch is reachable, and watchOS delivers it whenever the Watch next wakes. That asymmetry is why auth payloads land on the Watch even if you didn't have the iPhone open at the moment of sign-in.

In the current codebase, `WatchSessionManager.sendMessage` (which does require reachability) is wired but unused at the call sites that matter — the load-bearing path is `updateApplicationContext`.

### Reference sequence — sign-in to autonomous Watch use

```mermaid
sequenceDiagram
    participant U as User
    participant iPhone as iPhone app
    participant SB as Supabase
    participant WCS as watchOS<br/>WCSession
    participant Watch as Watch app
    participant API as API (App Runner)

    U->>iPhone: Sign in
    iPhone->>SB: OAuth / password flow
    SB-->>iPhone: access + refresh tokens
    iPhone->>WCS: updateApplicationContext({tokens, settings})
    Note over WCS: Queued; delivered<br/>when Watch wakes
    WCS-->>Watch: didReceiveApplicationContext
    Watch->>Watch: AuthService.store → keychain<br/>APIClient.baseURL set

    Note over Watch,API: Hours later — iPhone offline / killed
    U->>Watch: Open app
    Watch->>Watch: AuthService.getAccessToken<br/>(token expired)
    Watch->>SB: POST /auth/v1/token<br/>(direct, not via iPhone)
    SB-->>Watch: new tokens
    Watch->>API: GET /v1/review/status<br/>Bearer …
    API-->>Watch: { dueCount, … }
    Watch->>U: HomeView updates
```

### Mental model

- **Dependence is asymmetric.** The Watch consumes a periodic auth+settings payload from the iPhone. The iPhone doesn't depend on the Watch at all.
- **Most of the time the Watch is independent.** It has its own keychain, its own API client, and its own refresh logic.
- **The iPhone app must run occasionally** — at least once per sign-in, and any time user prefs change — to push a fresh context payload. It does **not** need to run for the Watch's day-to-day use.
- **Logs are per-process.** Watch logs do not surface in Console.app sessions attached to the iPhone. Use Xcode's debug console when running the Watch scheme, or select the Watch device explicitly in Console.app's Devices sidebar.

### Files of interest

- `apps/watch/KanjiLearnWatch/Services/WatchSessionManager.swift` — `WCSessionDelegate`, owns the iPhone↔Watch handoff and the activation log lines.
- `apps/watch/KanjiLearnWatch/Services/AuthService.swift` — keychain storage of tokens, autonomous refresh path against Supabase.
- `apps/watch/KanjiLearnWatch/Services/APIClient.swift` — single HTTPS client; reads `Authorization: Bearer` from `AuthService.getAccessToken`.
- `apps/watch/KanjiLearnWatch/Views/HomeView.swift` — the screen most users see; calls `api.fetchStatus` on appear and on `applicationDidBecomeActiveNotification`.
- `apps/watch/KanjiLearnWatch/Services/BackgroundRefreshHandler.swift` — schedules off-foreground refreshes for the complication.
- `apps/watch/KanjiLearnWatch/Services/NotificationService.swift` — Watch-side delay state for snoozed sessions.
- `apps/watch/project.yml`, `apps/watch/KanjiLearnWatch.xcodeproj/project.pbxproj` — bundle id and build settings.
- iPhone counterpart: `apps/mobile/src/services/WatchConnectivityModule.*` (the `updateApplicationContext` caller; native module bridged into JS).
