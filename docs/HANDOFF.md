# Session Handoff — 2026-05-18 (Plan A shipped to main · Plan B planned)

## TL;DR

**(1) Plan A — Minutes-Based Study Goal — was executed and merged to `main`.** All 9 tasks of `docs/superpowers/plans/2026-05-17-minutes-based-study-goal.md` were implemented via subagent-driven development (a fresh subagent per task, each passing a spec-compliance review and a code-quality review). The daily goal is now a minutes budget and the study session is time-boxed on a timer instead of a fixed card count. Two review-driven fixes were folded in. Merged to `main` as `def0009`. **(2) Plan B — Loop Legs & Nav — was written.** `docs/superpowers/plans/2026-05-18-practice-loop-legs-and-nav.md` (committed `cb11bd7`), 6 tasks. **Next session: execute Plan B** via `superpowers:subagent-driven-development`.

✅ **Migration `0023` was applied to the live Supabase DB this session** (2026-05-18) — `daily_goal` is now a minutes value; all 4 tester rows were reset to 15.

## Current state

- **Branch:** `main` at `cb11bd7`. Working tree: untracked items only (housekeeping queue, unchanged — see that section).
- **`main` history this session:** `def0009` (merge commit — Plan A) → `cb11bd7` (Plan B plan doc). Below `def0009`: `8b0ba20` ("B133 submitted to TestFlight") and the rest of the pre-existing history.
- **Not pushed.** `origin/main` is far behind (at `b091590`, April). All of this session's work — Plan A and the Plan B doc — is **local only**. Push when ready; no force-push is or will be needed.
- **API:** unchanged this session — Plan A touched only `packages/db` and `apps/mobile`, no API code. Last known healthy at `https://73x3fcaaze.us-east-1.awsapprunner.com`.
- **No EAS build cut** this session. Plan A is on `main` but not yet in any TestFlight build.
- **Watch:** unchanged.

---

## ✅ Migration 0023 — applied to the live DB (2026-05-18)

Plan A Task 1 created `packages/db/supabase/migrations/0023_daily_goal_minutes.sql` and updated the Drizzle schema default. The migration was **applied to the live Supabase DB this session** via `scripts/run-migration-0023.mjs` (sourcing `DATABASE_URL` from `apps/api/.env`).

**Verified:** `user_profiles.daily_goal` column default is now `15`; all 4 existing `user_profiles` rows are `daily_goal = 15`; the column comment reads "Daily study goal, in minutes (was a card count before migration 0023)."

The runner `scripts/run-migration-0023.mjs` is committed and safe to re-run if ever needed (the SQL is wrapped in `BEGIN/COMMIT` and is idempotent). Nothing further is owed here — the database now matches the Plan A code.

---

## Plan A — executed & merged this session

All 9 tasks of `docs/superpowers/plans/2026-05-17-minutes-based-study-goal.md`, each spec- and code-reviewed:

1. **DB migration `0023`** — `daily_goal` reinterpreted as minutes; Drizzle default 20→15. (Applied to the live DB 2026-05-18 — see migration section above.)
2. **Onboarding** — "How many minutes per day?" · options 5/10/15/20/30 · default 15.
3. **Profile** — daily-goal editor reuses the onboarding options · "Minutes per day" label.
4. **Review store** — the study session is time-boxed; `submitResult` ends the session when the minutes budget elapses (checked after each grade, never mid-card). Weak/missed drills stay count-bounded.
5. **`didMeetTimeGoal`** (TDD) — replaces the old card-count `didCrossGoal`.
6. **SessionComplete** — the 🎉 banner celebrates the minutes goal; the dead `reviewedBefore`/analytics plumbing was removed.
7. **study.tsx** — `dailyGoal` fallback →15; a live "Nm left" countdown in the session header.
8. **Dashboard** — shows "N reviewed today" instead of a cards-vs-goal fraction.
9. **"Keep studying"** — a Session Complete action to continue past the daily goal.

Two **review-driven fixes** were folded in: migration `0023` wrapped in `BEGIN/COMMIT` to match sibling migrations, and the offline-fallback path resets to a fresh `studyStartMs` (a stale cached timestamp would have ended a time-boxed session on the first card).

**Verified:** mobile typecheck clean · mobile jest 37/37 · API typecheck shows only the one pre-existing unrelated `social-mute.test.ts:25` error.

**Plan A verification still owed:** an **on-device walkthrough** — countdown visible, session ends after the in-progress card (not mid-card), 🎉 banner on goal met, "Keep studying" starts a fresh timed segment, Dashboard shows the plain review count. Best done in the next EAS build.

**Minor follow-ups flagged by reviewers (out of Plan A scope):**
- WCAG: `colors.textMuted` on the dark background is ~3.86:1 — under AA 4.5:1 for 12px caption text. Affects the new `timeLeft` label *and* the pre-existing `counter` / `swipeHint`. Project-wide debt, not a Plan A regression.
- The `minutesLeft` countdown is `Math.ceil`-rounded (plan-specified) — shows "0m left" briefly at expiry.

### ⚠️ Process note — subagent commits leaked onto `main`

During Plan A's subagent-driven execution, subagent `git commit` calls intermittently landed on the `main` branch instead of the execution worktree's branch — four Plan-A commits ended up on `main` directly, and three task commits were briefly orphaned. This was caught by the final review, recovered cleanly (cherry-pick onto the worktree branch; then `main` was reset to `8b0ba20` and the complete branch merged in as `def0009`), and verified. **For the next subagent-driven run: after each task, confirm the feature branch ref actually advanced and `main` was not touched.**

---

## Plan B — written this session, ready to execute

`docs/superpowers/plans/2026-05-18-practice-loop-legs-and-nav.md` (committed `cb11bd7`). **6 tasks:**

1. **API — guaranteed new-kanji allowance** — `getReviewQueue` reserves a small front-loaded new-kanji batch (`NEW_KANJI_FLOOR = 4`) via a pure, unit-tested `planQueueSlots` helper. (This is the §3 allowance Plan A deferred.)
2. **`WritingLeg`** component — wraps `WritingPractice` for one kanji.
3. **`SpeakingLeg`** component — wraps `VoiceEvaluator` for one kanji.
4. **Review store** — per-kanji `leg` state machine (`flashcard → writing → speaking`); the time-box check moves to the end of a kanji's full path.
5. **study.tsx** — renders the writing/speaking legs based on `leg`.
6. **Remove the Write & Speak tabs** — delete `writing.tsx` / `voice.tsx`; tab bar goes 7 → 5.

**The mechanic:** after the flashcard grade, new kanji and weak (Again/Hard) review kanji route through `writing → speaking`; Good/Easy review kanji end immediately.

**Design decisions baked into the plan (review before executing):**
- Speaking leg uses `VoiceEvaluator`'s legacy kanji-reading layout (no vocab `voicePrompt`) — the vocab-word layout is deferred to Plan C.
- No changes to `WritingPractice` / `VoiceEvaluator` internals — they already self-record attempts (`/v1/review/writing`, `/v1/review/voice`), so §6 telemetry comes for free.
- Leg routing gated on `goalMinutes > 0` — weak/missed drills stay flashcard-only.
- The new-kanji allowance is front-loaded so the time-box reaches it on heavy review days.

**Execute Plan B** via `superpowers:subagent-driven-development`, ideally from a fresh session and a dedicated worktree. Run tasks in order — Tasks 4→5 are a pair (the store change is transiently incomplete until study.tsx renders the legs); Task 6 (tab removal) last so the loop's legs exist before the standalone tabs disappear.

## Plan C — still to be written

**Quiz leg + Browse tab + telemetry.** Wire the existing quiz engine in for "maybe-slipping" review kanji (spec §2/§4 — a failed quiz counts as a lapse and resurfaces the card sooner); promote Browse to a tab (spec §1); add the Session Complete modality breakdown (spec §5). Write it via `superpowers:writing-plans` after Plan B ships.

After the Practice Loop: Spec 1.5 (FSRS migration) and Spec 2 (Buddy, the AI tutor) each get their own brainstorm.

---

## B133 — verification carry-forward

B133 shipped and was submitted to TestFlight last session. Still owed:
- **Item 5** — App Runner logs should show one `[Internal] Daily reminder job triggered` per hour and no `[Cron] Running hourly reminder check`; one daily-reminder push, no duplicate.
- **Items 6, 7, Bug A** — on-device on TestFlight: Study speaker icon un-sticks; empty-transcript hint on Speaking; reported Speak vocab words pass.
- **Bug B** — resolved (stale `velocity_drop` rows cleared 2026-05-18).

**Known pre-existing issue (not Plan A, not B133):** `apps/api/test/integration/social-mute.test.ts:25` has a `FastifyRegisterOptions` typecheck error that exists on `main` independently — flagged for a future sweep.

---

## Working tree — housekeeping queue (carry-forward, unchanged)

Untracked items in the main checkout. Still need eyeball decisions:

| Item | Recommendation |
|---|---|
| `.claude/worktrees/` | gitignore (Claude scratch). |
| `apps/lambda/daily-reminders/daily-reminders.zip` | gitignore (build artifact) |
| `apps/mobile/credentials.json` | **gitignore IMMEDIATELY if it contains secrets** — verify content first |
| `apps/watch/KanjiLearnWatch.xcodeproj/xcshareddata/` | gitignore (Xcode personal prefs) |
| `KanjiBuddyEnamel.jpg`, `KanjiBuddyMonkey.jpeg`, `KanjiBuddyMonkey.html`, `KanjiBuddyMonkey_files/` | Move to `apps/mobile/assets/branding/` (or `docs/branding/`) before the rebrand |
| `tooclose.jpg` | If a reference screenshot, move to `docs/branding/references/`; else delete |
| `app.json`, `eas.json` (repo root, not `apps/mobile/`) | Likely orphaned from an earlier prebuild — inspect → delete |
| `docs/superpowers/mockups/` | Inspect → commit if useful |
| `docs/superpowers/plans/2026-04-*.md` (7 files) | **Commit all** — executed session plans, belong on `main` as history |
| `docs/openbrain-migration-thoughts.md` | Open Brain migration record — keep (commit to `docs/`) or delete; harmless |

`.superpowers/` (visual-companion brainstorm scratch) is already gitignored.

---

## Pre-launch infra checklist (carry-forward)

| | Item | Status |
|---|---|---|
| ✅ | Apply migration `0023` to the live DB | done 2026-05-18 |
| 🚀 | Secrets rotation + SSM Parameter Store migration | 7 keys still owed |
| 🚀 | Migrate Supabase DB `ap-southeast-2` → `us-east-1` | Cross-region tax; dedicated session |
| 🚀 | SES out of sandbox | Needed for tutor-share email at scale |
| 🚀 | Revert testing-phase flags | `EXPO_PUBLIC_DEV_TOOLS=1` (in `eas.json` production profile) + the 2h study-mate alert cap |

---

## Other open follow-ups

- **Truncated kanji readings** — `kanji.kun_readings`/`on_readings` capped at ~5 sorted entries; re-import full KanjiDic2 readings.
- **The "Kanji Buddy 1.0" rebrand** — rename Kanji Learn → Kanji Buddy, splash polish, About/Credits branding. Independent of the Practice Loop. Needs a brand-decision block first.
- **Tutor report writing scope-down** — the report still surfaces a Writing modality that Study no longer serves; revisit alongside the loop work.
- **Phase 3 #13 — Milestones panel refactor** — spec captured earlier; after the Practice Loop.
- **`interventions.payload` double-encoded** — stored double-encoded jsonb (a Drizzle/postgres-js quirk); harmless to the JS round-trip but breaks SQL-side payload queries.

---

## Working environment notes

- **Prod API:** `https://73x3fcaaze.us-east-1.awsapprunner.com`.
- **Supabase:** still `ap-southeast-2`. Migration files live in `packages/db/supabase/migrations/` (`0001`–`0023`). `0023` was applied to the live DB 2026-05-18 via `scripts/run-migration-0023.mjs`.
- **Docker / API deploy:** `./scripts/deploy-api.sh` from repo root. (No API deploy needed for Plan A; Plan B Task 1 *does* change the API and will need one.)
- **EAS builds:** from `apps/mobile/`, ~$2/build. `eas build --platform ios --profile production`. EAS auto-bumps `ios.buildNumber` — **never hand-edit `app.json`**. Submit with `eas submit`.
- **Watch builds:** **manual Xcode rebuild only** — EAS does not build the watchOS target.
- **Co-author convention:** every kanji-learn commit includes `Co-Authored-By: Robert A. Dennis (Buddy)` alongside the Claude co-author line.
