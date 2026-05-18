# Session Handoff — 2026-05-17 (B133 shipped · Practice Loop spec & Plan A)

## TL;DR

Two things happened this session. **(1) B133 — the reliability bug bundle — shipped.** Five fixes (notification-trigger consolidation, Dashboard "0% drop" copy, Study speaker stuck, empty-transcript banner, Speak-vocab eval failures) landed on `main`, the API was deployed and is healthy, the daily-reminders Lambda was redeployed, the redundant AWS scheduler was disabled, and the **B133 EAS build was cut and submitted to TestFlight**. **(2) The Three-Modality Learning Loop was brainstormed into a spec, and the first implementation plan was written.** The spec is `docs/superpowers/specs/2026-05-17-practice-loop-design.md`; Plan A is `docs/superpowers/plans/2026-05-17-minutes-based-study-goal.md`. **Next session: execute Plan A** via the `superpowers:subagent-driven-development` skill.

## Current state

- **Branch:** `main` at `e979b7a`. Working tree: untracked items only (housekeeping queue, unchanged) — see that section below.
- **API:** deployed and healthy at `https://73x3fcaaze.us-east-1.awsapprunner.com`. This session's deploy — App Runner operation `171b38eaf0d3413490081c6ddd286341`, status `SUCCEEDED`, service `RUNNING`, `/health` → 200.
- **EAS build B133:** build `5452aab7-d06e-4ac7-86de-9fe8360ae695` — `finished`. EAS auto-bumped `ios.buildNumber` 132→133, committed in `e09cde7`. **Submitted to TestFlight** 2026-05-17 — submission `e857a3ae-2d8f-4fe3-a7f5-e82032560c60`; Apple was processing the binary (~5–10 min) before it reaches testers.
- **Watch:** unchanged this session (no Swift changes; EAS does not build the watchOS target).

---

## B133 — shipped this session

Five items, all on `main`, one commit each. Two more bug reports (A, B) were captured via Open Brain and folded into the bundle.

| Commit | Item | Side |
|---|---|---|
| `975307f` | **Item 5** — daily-reminder triggers collapsed to one | API + Lambda |
| `994974a` | **Bug B** — Dashboard "review pace dropped 0%" → real % | API |
| `bc1cfc8` | **Item 6** — Study speaker icon unstuck (audio reset + TTS watchdog) | mobile |
| `67c7d10` | **Item 7** — VoiceEvaluator empty-transcript retry hint | mobile |
| `6655067` | **Bug A** — Speak vocab accepts the kanji-form transcript | mobile |
| `e09cde7` | EAS-bumped `ios.buildNumber` → 133 | mobile config |

**Item 5 detail.** `sendDailyReminders()` had **three** live triggers (in-app `node-cron`, an hourly EventBridge Rule, and a redundant daily EventBridge Scheduler) — a 2–3× notification flood. Fix: the in-app cron was deleted; the hourly EventBridge Rule `kanji-learn-hourly-reminders` is now the **single source of truth**; rest-day summaries moved into `POST /internal/daily-reminders`; the Lambda's hourly tutor-analysis chain was removed (tutor analysis stays on its in-app 03:00 UTC cron). **AWS change applied:** the `kanji-learn-daily-reminders` Scheduler is now `DISABLED` (reversible).

**Bug A detail.** Speak vocab words (e.g. 貸付) always failed. Root cause confirmed from the prod `voice_attempts` log: the iOS recognizer returns **kanji** transcripts, and the evaluator's kanji-expansion can't rebuild compound readings (rendaku/jukujikun/okurigana). Fix: in vocab mode the client now sends the word's kanji form alongside the kana reading, so an exact transcript-vs-word match resolves it. **A deeper data bug was found and spawned as a separate task:** `kanji.kun_readings`/`on_readings` are truncated to ~5 sorted entries — this degrades Study-card displays and the Speaking evaluator's expansion index. Not in B133.

**B133 verification still owed:**
- **Item 5** — over the next hours, App Runner logs should show **one** `[Internal] Daily reminder job triggered` per hour and **no** `[Cron] Running hourly reminder check` line; one daily-reminder push on device, no duplicate.
- **Items 6, 7, Bug A** — on-device once B133 lands on TestFlight: speaker icon un-sticks on Study; empty-transcript hint on Speaking; reported Speak vocab words now pass.
- **Bug B** — only shows for a user with a real ≥50% week-over-week drop.

**Known pre-existing issue (not B133):** `apps/api/test/integration/social-mute.test.ts:25` has a `FastifyRegisterOptions` typecheck error that exists on `main` independently — untouched here, flagged for a future sweep.

---

## Practice Loop — brainstormed & planned this session

The Three-Modality Learning Loop (old "Plan B") was brainstormed in full and decomposed into a **three-spec arc**:

- **Spec 1 — The Practice Loop** — `docs/superpowers/specs/2026-05-17-practice-loop-design.md` (committed `6b7e43a`). Collapses Study / Speaking / Writing into one time-boxed, per-kanji-routed session with a quiz verification leg. Removes the Write & Speak tabs (absorbed into the loop) and promotes Browse to a tab.
- **Spec 1.5 — FSRS migration** — replace the SM-2 scheduler with FSRS so per-kanji *retrievability* becomes a real confidence signal. Best done pre-launch while the dataset is tiny. Own brainstorm, not yet written.
- **Spec 2 — Buddy, the AI tutor** — the monkey mascot becomes an in-app AI coach: cross-modality weakness detection, focus suggestions, AI mnemonic co-building. Repurposes the Journal tab into a "Buddy" tab. Own brainstorm, not yet written. (Buddy is the thing Buddy-the-owner is most excited about — but it depends on the loop's data, so 1 → 1.5 → 2.)

**Spec 1 itself is being implemented as three sequential plans**, each independently shippable:

- **Plan A — Minutes-Based Study Goal** — `docs/superpowers/plans/2026-05-17-minutes-based-study-goal.md` (committed `e979b7a`). **Written and ready.** 9 tasks: the `daily_goal`→minutes migration, onboarding/profile copy, the time-boxed review store, `didMeetTimeGoal` (TDD), SessionComplete rewiring, the time-remaining indicator, the dashboard fix, "Keep studying."
- **Plan B — Loop legs + nav** — per-kanji routing (new kanji → flashcard→writing→speaking; weak review kanji → writing+speaking), reusing `WritingPractice`/`VoiceEvaluator` inside the loop; remove the Write & Speak tabs. **Not yet written** — write it (via `superpowers:writing-plans`) after Plan A ships.
- **Plan C — Quiz leg + Browse tab + telemetry** — wire the existing quiz engine in for "maybe-slipping" review kanji (Medium feedback: a failed quiz counts as a lapse); promote Browse to a tab. **Not yet written.**

---

## Next session — execute Plan A

Decided this session: execution uses the **Subagent-Driven** approach.

```
cd /Users/rdennis/Documents/projects/kanji-learn
git pull origin main
# Then: invoke the superpowers:subagent-driven-development skill, pointed at
#   docs/superpowers/plans/2026-05-17-minutes-based-study-goal.md
# It dispatches a fresh subagent per task with review checkpoints between tasks.
# (A dedicated git worktree for the execution is recommended.)
```

Plan A ships independently — when it's done the daily goal is minutes and the study session is time-boxed (still flashcard-only). Then write & execute Plan B, then Plan C. After the Practice Loop: Spec 1.5 (FSRS) and Spec 2 (Buddy) each get their own brainstorm.

---

## Working tree — housekeeping queue (carry-forward, unchanged)

Untracked items in the main checkout. Still need eyeball decisions:

| Item | Recommendation |
|---|---|
| `.claude/worktrees/` | gitignore (Claude scratch). The `loving-greider-2122d0` worktree used this session is fully merged to `main` and can be removed. |
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
| 🚀 | Secrets rotation + SSM Parameter Store migration | 7 keys still owed |
| 🚀 | Migrate Supabase DB `ap-southeast-2` → `us-east-1` | Cross-region tax; dedicated session |
| 🚀 | SES out of sandbox | Needed for tutor-share email at scale |
| 🚀 | Revert testing-phase flags | `EXPO_PUBLIC_DEV_TOOLS=1` (in `eas.json` production profile) + the 2h study-mate alert cap |

---

## Other open follow-ups

- **Truncated kanji readings** — `kanji.kun_readings`/`on_readings` capped at ~5 sorted entries; re-import full KanjiDic2 readings. Spawned as a task this session.
- **The "Kanji Buddy 1.0" rebrand** (old plan "C") — rename Kanji Learn → Kanji Buddy, splash polish, About/Credits branding. Independent of the Practice Loop; can slot in whenever. Needs a brand-decision block first.
- **Tutor report writing scope-down** — the report still surfaces a Writing modality that Study no longer serves; revisit alongside the loop work.
- **Phase 3 #13 — Milestones panel refactor** — spec captured earlier; after the Practice Loop.

---

## Working environment notes

- **Prod API:** `https://73x3fcaaze.us-east-1.awsapprunner.com` — healthy.
- **Supabase:** still `ap-southeast-2`. Two migration systems live in `packages/db`: `drizzle/` (0000–0011) and `supabase/migrations/` (0001–0022, the live one). Plan A adds `supabase/migrations/0023_daily_goal_minutes.sql`.
- **Docker / API deploy:** `./scripts/deploy-api.sh` from repo root. App Runner ARN wired in.
- **EAS builds:** from `apps/mobile/`, ~$2/build. `eas build --platform ios --profile production`. EAS auto-bumps `ios.buildNumber` — **never hand-edit `app.json`**. Submit with `eas submit`.
- **Watch builds:** **manual Xcode rebuild only** — EAS does not build the watchOS target.
- **Co-author convention:** every kanji-learn commit includes `Co-Authored-By: Robert A. Dennis (Buddy)` alongside the Claude co-author line.
