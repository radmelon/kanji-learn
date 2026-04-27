# Session Handoff — 2026-04-26

## TL;DR

**B132 shipped, submitted, and on-device verified.** Five client items (#1 invite surfacing, #2 tutor Resend URL, #3 Watch os_log, #4 About dynamic version, #4.1 Progress displayName) plus three follow-ups (shared social cache, Profile pull-to-refresh, Watch `.notice` log level) all landed. API deployed twice during the session — once for the deferred Item 0 fixes from B131, once for the new server-side Items 1 + 2. Tonight's session also added a Phase 3 #13 ROADMAP entry (Milestones panel refactor) and started a new living `docs/tech-arch-overview.md` with Apple Watch and Pedagogy sections. Next session is the **A-B-C plan**: A) B133 reliability bundle (notification dedup + speaker stuck + empty-transcript banner), B) Three-Modality Learning Loop pedagogy brainstorm, then C) the Phase 2 #11/#9/#10 rebrand bundle.

## Current state

- **Branch:** `main` at `12cb2bd`. Working tree has untracked items but no modifications.
- **API:** deployed and healthy at `https://73x3fcaaze.us-east-1.awsapprunner.com`. Two operations this session:
  - `2cb9c7fe480f4139b14137a09e3f7fe6` (~01:11 UTC) — Item 0 B131 fixes (push token reclaim, self-friending guard, Speaking scope).
  - `1fb34c9e4be0469287fe73d907d93c16` (~01:54 UTC) — Items 1 + 2 server side (`notifyIncomingFriendRequest`, `shareUrl` projection).
- **TestFlight:** B132 submitted 2026-04-26 02:36 UTC. Build `8e1feb3c-4a3b-4f23-b63d-16ca8e58fe36`, submission `4cce97d9-17ae-4886-b8bc-8a5841105ceb`. EAS auto-bumped `ios.buildNumber` 131→132, committed in `09cd725`.
- **Watch:** os_log migration (`02bda24`) + `.notice` upgrade (`5858282`) on `main`; **EAS does not build the watchOS bundle**, so the Watch on device only gets these via a manual Xcode rebuild (already done this session, verified via Xcode debug console).

---

## Commits landed this session (ten on `main`)

| Commit | Item | Side |
|---|---|---|
| `b80f8d9` | Progress header `displayName` regression fix (#4.1) | mobile |
| `87d5cbd` | About page dynamic `1.0.{buildNumber}` (#4) | mobile |
| `02bda24` | Watch `print()` → `os_log` migration (#3) | watch |
| `326dd71` | Tutor-share Resend URL button (#2) | API + mobile |
| `4069035` | Friend-request push + Profile-tab badge (#1) | API + mobile |
| `86da5a3` | Shared friends/leaderboard cache | mobile |
| `d7c82f6` | Profile pull-to-refresh wires social state | mobile |
| `3028b82` | ROADMAP Phase 3 #13 — Milestones panel refactor spec | docs |
| `09cd725` | EAS-bumped `ios.buildNumber` → 132 | mobile config |
| `5858282` | Watch `klWatchLog` uses `.notice` | watch |
| `9a54b32` | New `docs/tech-arch-overview.md` — Apple Watch section | docs |
| `12cb2bd` | `tech-arch-overview` Pedagogy section + planned MCP server placeholder | docs |

(Twelve total counting the doc work; ten count "shipped product" if you prefer.)

---

## On-device B132 verification — 7 of 8 items confirmed

| | Item | Status | Notes |
|---|---|---|---|
| 4 | About `Version 1.0.132` | ✅ |
| 4.1 | Progress header displayName | ✅ |
| 3 | Watch `[KL-Watch]` lines | ✅ | After manual Xcode rebuild + via Xcode debug console; Console.app filter on Watch device works but is fiddly |
| 2 | Tutor Resend URL button | ✅ |
| 1a | Friend-request push lands on iPad | ✅ | Server log: `02:20:28 [Push] userId=7c707446-... sent=1 pruned=0` + user confirmed visible push with chime |
| 1b | Profile-tab badge render | ⏳ | Untested; surfaces naturally next time there's a pending invite |
| 1c | Cross-screen friends/leaderboard consistency | ✅ |
| — | Profile pull-to-refresh refreshes social | ✅ |

**Key lessons captured to memory:**
- *App Runner rolling deploy gap* — `RUNNING` status ≠ all old instances drained. The first user-driven re-invite at 01:57:16 hit the OLD instance; only after ~01:57:29 did traffic flip to the new image.
- *`useSocial` per-instance state was a class of bug* — generalised the `useProfile`-style shared cache to friends/pending/leaderboard.
- *`Logger.info()` is memory-only by default* — `.notice` is the right level for testing-phase visibility without "Action → Include Info Messages".
- *EAS does not build the watchOS bundle* — Watch fixes need Xcode rebuilds, not EAS B-builds. Filed as `feedback_eas_does_not_build_watch.md`.

---

## Working tree — housekeeping queue

Untracked items at session end. None modified. **Untouched on purpose** — they need eyeball decisions, not blind action:

| Item | Recommendation |
|---|---|
| `.claude/worktrees/` | gitignore (Claude scratch) |
| `apps/lambda/daily-reminders/daily-reminders.zip` | gitignore (build artifact) |
| `apps/mobile/credentials.json` | **gitignore IMMEDIATELY if it contains secrets** — verify content first |
| `apps/watch/KanjiLearnWatch.xcodeproj/xcshareddata/` | gitignore (Xcode personal prefs) |
| `KanjiBuddyEnamel.jpg`, `KanjiBuddyMonkey.jpeg`, `KanjiBuddyMonkey.html`, `KanjiBuddyMonkey_files/` | Move to `apps/mobile/assets/branding/` (or `docs/branding/`) before the rebrand session — currently messy at repo root |
| `tooclose.jpg` | If reference screenshot, move to `docs/branding/references/`; if accidental, delete |
| `app.json` (root, not `apps/mobile/app.json`) | Likely orphaned from earlier prebuild — inspect → delete |
| `eas.json` (root, not `apps/mobile/eas.json`) | Same |
| `docs/superpowers/mockups/` | Inspect → likely commit if useful spec assets |
| `docs/superpowers/plans/2026-04-*.md` (7 files) | **Commit all** — these are session plans we executed against; they belong on `main` as history |

**Safe-to-do-blindly subset:**
- gitignore: `.claude/worktrees/`, `apps/lambda/daily-reminders/daily-reminders.zip`
- commit: the seven `docs/superpowers/plans/2026-04-*.md` files

---

## Next-session plan: A → B → C

Decided this session.

### A — B133 reliability bundle (next session)

Three small bug items, all fully scoped during this session's investigations.

1. **Item 5 — Notification flood dedup.** Dual trigger: in-app cron (`apps/api/src/cron.ts:15` `0 * * * *`) AND AWS Lambda (`apps/lambda/daily-reminders/index.mjs` → `apps/api/src/routes/internal.ts:29`) both call `sendDailyReminders()`. **Decision still owed:** delete the in-app cron (cheap, single source of truth) vs add a `lastDailyReminderSentAt` date column for true idempotency. Re-observe behaviour on B132 first — the Item 0 push-token-reclaim fix may have already reduced the visible count by removing the cross-account amplifier.
2. **Item 6 — Study card speaker icon stuck/no-sound.** Root cause is iOS audio session left in a non-playback category by the Speaking-tab microphone path. Two-part fix: (i) `Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false, ... })` reset on Study screen focus, plus (ii) a watchdog timeout in `KanjiCard.tsx` `speakSequence` so the visual "lit" state resets even if `expo-speech` callbacks never fire. See `apps/mobile/src/components/study/KanjiCard.tsx:160-195`.
3. **Item 7 — VoiceEvaluator empty-transcript banner.** When the `'end'` event fires with `transcript === ''`, `apps/mobile/src/components/voice/VoiceEvaluator.tsx:190-197` returns silently → user sees "Listening..." → idle with no feedback. Add a brief inline "Didn't catch that — tap mic to retry" banner. Surfaced by the BT/HFP investigation but real regardless of cause.

Bundle into B133, deploy API only if Item 5 chooses the column-add path. Cost: ~$2 EAS.

### B — Three-Modality Learning Loop brainstorm (after A)

Pedagogy session, no code. Design discussion captured as a spec in `docs/superpowers/specs/`. Unblocks both Phase 6 #23 (the differentiator feature itself) and the deferred tutor-report writing scope-down. See `project_learning_loop_pedagogy.md` for queued context. The new `docs/tech-arch-overview.md` Pedagogy section already lists the open questions to settle.

### C — Phase 2 #11 + #9 + #10 rebrand bundle (after B)

The "Kanji Buddy 1.0" launch moment. Touches:
- **#11** rename Kanji Learn → Kanji Buddy across copy, app name, store metadata
- **#9** splash screen polish — solid bg, longer display, branding imagery
- **#10** About / Credits page — branding imagery (assets already staged at repo root: `KanjiBuddyMonkey.jpeg`, `KanjiBuddyEnamel.jpg`)

Pre-work for C: settle which mark is canonical, whether dark/light variants exist, brand-voice copy direction. That's a 2–3 hour brand-decision block before code, so probably needs its own dedicated session.

---

## Pre-launch infra checklist (carry-forward, unchanged)

| | Item | Status |
|---|---|---|
| 🚀 | Secrets rotation + SSM Parameter Store migration | 7 keys still owed; full plan in ROADMAP Phase 5 |
| 🚀 | Migrate Supabase DB to us-east-1 | Cross-region tax; needs dedicated session |
| 🚀 | SES out of sandbox | Needed for tutor-share email at scale |
| 🚀 | Revert testing-phase flags | `EXPO_PUBLIC_DEV_TOOLS=1` + 2h mate cap |

---

## Other open follow-ups (not in A-B-C)

- **Tutor report writing scope-down** — couples to (B) Three-Modality Loop brainstorm; do that first.
- **iOS recognizer config** — "we heard X — try again?" UX for 円→年-style misrecognitions. Small UX item.
- **Amber reading-prompt cue** from B121 — investigation only, no spec yet.
- **Phase 3 #13 — Milestones refactor.** Spec is captured in ROADMAP; planning + implementation comes after the A-B-C bundle.
- **Friendship `CHECK (requester_id != addressee_id)`** — application-level guard suffices unless another self-loop slips through.

---

## Working environment notes

- **Prod API:** `https://73x3fcaaze.us-east-1.awsapprunner.com` — healthy.
- **Supabase:** still in `ap-southeast-2`. Pre-launch us-east-1 migration owed.
- **Docker deploys:** `./scripts/deploy-api.sh` from repo root. App Runner service ARN already wired in. Two deploys ran cleanly tonight.
- **EAS builds:** from `apps/mobile/`. Pay-as-you-go ~$2/build. EAS auto-bumps `ios.buildNumber`; **never hand-edit `app.json`**.
- **Watch builds:** **manual Xcode rebuild only** — EAS does not build the watchOS target. Open `apps/watch/KanjiLearnWatch.xcodeproj`, select `KanjiLearnWatch` scheme + Watch destination, ⌘R. Use Xcode's debug console for log capture; Console.app's Watch device pairing is flaky.
- **Bundle versions:** iPhone B132 = `ios.buildNumber: "132"`. Watch should match (commit `60297c9`); verify when next opening Xcode.
- **EAS CLI:** `18.7.0` working. `18.8.1` available but not installed — fine.

---

## Tomorrow's first command (A: B133 bundle)

```
cd /Users/rdennis/Documents/projects/kanji-learn
git pull origin main

# Housekeeping (~5 min)
# 1. Add to .gitignore: .claude/worktrees/, apps/lambda/daily-reminders/daily-reminders.zip
# 2. Decide on apps/mobile/credentials.json (gitignore if secrets) and the
#    other untracked items per the table in HANDOFF.md.
# 3. Commit the seven docs/superpowers/plans/2026-04-*.md files.

# A — B133 reliability bundle
# 4. Item 5: re-observe daily-reminder behaviour on B132 (push-token reclaim
#    is now live — count may have already dropped). Decide: delete in-app cron
#    OR add lastDailyReminderSentAt column.
# 5. Item 6: KanjiCard.tsx speakSequence watchdog + Audio.setAudioModeAsync
#    reset on Study focus.
# 6. Item 7: VoiceEvaluator.tsx empty-transcript banner.
# 7. Typecheck both api + mobile, commit each item, deploy API if Item 5
#    needs it, cut B133 via EAS.
```

---

## Memory entries created/updated this session

- `project_b132_shipped.md` (new) — full session outcome
- `feedback_eas_does_not_build_watch.md` (new)
- `feedback_bluetooth_mic_hfp_lag.md` (new — earlier in session, BT/HFP investigation)
- `project_next_session_b132_plan.md` (updated to mark Items 0–4 + 4.1 done)
- `MEMORY.md` (index updated with the three new entries)

The two memory entries from earlier sessions still relevant for next session: `project_learning_loop_pedagogy.md` (for plan B) and the standing pre-launch flag list in `project_testing_phase_flags.md`.
