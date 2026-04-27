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
- [Pedagogy](#pedagogy)

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

---

## Pedagogy

> **Status:** scaffold. This section captures the *learning and instruction principles* that drive Kanji Buddy's design, and how each principle is implemented in the codebase. It will be filled in across sessions as principles are made explicit. Cross-references point at the concrete file:line where a principle is encoded so the doc and the code stay synchronised.

### Why pedagogy is its own section

Kanji Buddy is not a flashcard app with social features bolted on; it's an opinionated learning tool whose product decisions are downstream of a pedagogical thesis. Capturing that thesis explicitly:

- prevents future feature work from drifting into "what other apps do" instead of "what helps the learner";
- gives reviewers a yardstick to push back when an implementation contradicts a principle;
- documents the *reasons* behind opinionated UX choices (e.g. why the queue isn't pure SRS, why writing prompts were dropped from Study) so future engineers don't accidentally undo them.

### Principles (to be detailed)

Subsections to expand over time. Each will end with a "How it shows up" pointer at the relevant file:line.

- **Multi-modal encoding** — the Study / Speaking / Writing split, and the explicit thesis that recognition + production + vocalisation each strengthen retention through different cognitive pathways. Implemented partially today (separate Study and Speaking tabs); fully realised by the planned **Three-Modality Learning Loop** (ROADMAP Phase 6 #23).
- **Confidence over correctness** — graded recall (Again / Hard / Good / Easy) feeds a confidence metric distinct from raw accuracy. Already encoded in B121's weighted 3/2/1/0 scoring (see `apps/api/src/services/srs.service.ts`, plus the analytics confidence panels). The principle: a kanji you got "right with effort" is not the same as one you got "right easily," and the schedule should reflect that.
- **Stage-aware prompt selection** — within a single `(user, kanji)` pair, the prompt type advances with mastery: meaning → reading → reading → compound. Encoded in `srs.service.ts` `pickReviewType(readingStage, status)`. Principle: don't drill the same surface forever; once a kanji is recognised, push the learner to produce its readings, then to integrate it with vocab.
- **Spaced repetition with surprise checks** — the queue is overdue-first by `nextReviewAt`, with a small `~12%` "surprise burned" tier so retention is verified beyond 6-month intervals (rather than treating "burned" as a graveyard). Encoded in `getReviewQueue` (`srs.service.ts`).
- **Motivation as first-class signal** — streaks, milestones, and the leaderboard exist to convert effort into observable rewards. The Milestones Panel Refactor (ROADMAP Phase 3 #13) is the clearest current articulation of how reward design serves pedagogy: replacement-rule badges focus attention on *progress*, not accumulation.
- **Pedagogical lookup, not just drilling** — informed by reference works the owner used to learn (e.g. Hadamitzky-Spahn *Kanji & Kana*). The Kanji Browser, JIS / Nelson / Morohashi codes, and stroke-order data are deliberately surfaced so the app supports lookup-driven study, not only flashcard-driven study.
- **Tutor channel as scaffolded support** — tutor sharing is not analytics-for-parents; it's a designed channel for an instructor to leave notes that the learner sees in their normal flow. The pedagogical bet is that occasional human input per week beats more app-time per day. Today's surface: `tutor-sharing.service.ts` + the report HTML the tutor sees + the notes the learner reads in-app.
- **Three-Modality Learning Loop** — the open pedagogy proposal: after each daily-goal flashcard batch, gate further flashcard sessions until the same kanji have been practiced in *writing* and *speaking*. This is the single largest pending pedagogical decision; ENHANCEMENTS.md and `project_learning_loop_pedagogy.md` (memory) hold the brainstorm queue. Until that brainstorm happens, do not pre-empt with architectural changes that bake in the current Study-only loop.

### Open questions to resolve in future sessions

- **What confidence threshold means "remembered"?** The current SRS encodes thresholds, but they should be stated here as principles, not just constants.
- **What is the canonical learning ladder?** N5 → N4 → … is the current proxy; Kyouiku grades 1–9 (ROADMAP Phase 3 #11 + #13's grade-level milestones) imply a second ladder. Are they parallel, sequential, or merged?
- **How aggressively should we surface a kanji once it's "learning" but not yet "reviewing"?** Today's queue starves new-card variety when due-pile is large. Pedagogically, that's a tension between consolidation and breadth — worth stating a position.
- **What's the pedagogical role of the leaderboard?** Motivation, comparison, or community? The answer constrains future social features.
- **Is the Watch a study surface or a glance surface?** Today it serves due-card review on a small screen. Should it ever host writing or speaking? Probably not, but the principle should be stated.

### Planned: Pedagogy MCP server

> **Status:** planned, not started. Recorded here for now; will be promoted to its own top-level section once the design is concrete.

The intent (to be detailed when the design firms up): expose the app's pedagogical state and primitives — learner profile, modality coverage, current queue composition, milestone progress, tutor notes — through an **MCP (Model Context Protocol) server** so AI tools can reason about and interact with a learner's state. Use cases that should drive the design:

- A planning agent can read the learner's current SRS posture (which kanji are stuck in `learning` vs `reviewing`, which modalities are under-exercised) and propose a custom session.
- The tutor-side AI can summarise a week of learner activity into a coaching note without manual analytics work.
- The Three-Modality Loop's "what should they do next?" question can be answered by an MCP-powered assistant that integrates daily activity, modality coverage, and the milestone ladder.

Open questions specific to the MCP server (to settle when the section is promoted):

- **Surface boundary** — read-only telemetry, or read+write (e.g. let an agent enqueue cards)?
- **Auth model** — per-learner JWT (parallel to the mobile/Watch path), or a service token scoped to the tutor share?
- **Hosting** — co-located with the Fastify API, separate Lambda, or a developer-laptop-only tool initially?
- **Schema vs prose** — does the MCP server expose typed primitives (kanji IDs, modality counters) or curated narrative descriptions of the learner's state?
- **Privacy posture** — what learner data is appropriate to expose to a model context, and is this an opt-in tutor feature or always-on?

Until those settle, this subsection is the placeholder. When implementation begins, lift this to a top-level **MCP Server** section and link from here.

### Files of interest (current pedagogy-encoding code)

- `apps/api/src/services/srs.service.ts` — queue construction, `pickReviewType`, stage advancement; the densest pedagogy-bearing file in the codebase.
- `apps/mobile/src/components/study/KanjiCard.tsx` — prompt-label mapping, cue colours, reveal flow.
- `apps/mobile/app/(tabs)/voice.tsx` + `apps/mobile/src/components/voice/VoiceEvaluator.tsx` — Speaking modality.
- `apps/api/src/services/tutor-sharing.service.ts` + `apps/api/src/templates/email-invite.ts` — tutor-channel scaffold.
- `apps/api/src/services/notification.service.ts` `buildMessage` — streak / due-count copy that frames the daily prompt pedagogically.
- `apps/api/src/services/tutor-analysis.service.ts` — automated learner summary that feeds the tutor report.
- `docs/superpowers/specs/`, `docs/superpowers/plans/` — historical brainstorms and decisions; cross-reference here when a principle gets pinned down.

### Related memory entries

- `project_learning_loop_pedagogy.md` — the parked Three-Modality Learning Loop brainstorm.
- `user_japanese_learning.md` — the owner's own learning history, which informs reference-code surfacing and lookup-driven design.
- `project_tutor_report_writing_drop.md` — pending follow-up after Writing was removed from Study; couples to the pedagogy brainstorm.
