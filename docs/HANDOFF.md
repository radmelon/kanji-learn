# Session Handoff — 2026-05-18 (Plan A & Plan B both shipped to main · Plan C to write)

## TL;DR

**(1) Plan B — Practice Loop Legs & Nav — was executed and merged to `main` this session.** All 6 tasks of `docs/superpowers/plans/2026-05-18-practice-loop-legs-and-nav.md` were implemented via `superpowers:subagent-driven-development` (a fresh subagent per task, each passing a spec-compliance review and a code-quality review), plus a whole-branch integration review and one review-driven parity fix. After the flashcard grade, new kanji and Again/Hard review kanji now route through writing → speaking legs inside the study session; the standalone Write & Speak tabs were removed (tab bar 7 → 5). Fast-forward merged to `main` — 7 commits, `7244317`…`da1b303`. **(2) Plan A — Minutes-Based Study Goal — shipped earlier this session** (merge `def0009`). **(3) Next session: write Plan C** via `superpowers:writing-plans` (quiz leg + Browse tab + Session Complete modality breakdown).

⚠️ **API deploy owed.** Plan B Task 1 changed the review-queue API (`getReviewQueue` in `srs.service.ts`). The guaranteed new-kanji allowance will **not** take effect for users until `./scripts/deploy-api.sh` is run. No deploy was done this session.

✅ **Migration `0023` was applied to the live Supabase DB** earlier this session (2026-05-18) — `daily_goal` is now a minutes value; all 4 tester rows reset to 15.

## Current state

- **Branch:** `main` at `da1b303`. Working tree: untracked items only (housekeeping queue, unchanged — see that section).
- **`main` history this session:** `def0009` (Plan A merge) → `cb11bd7` (Plan B plan doc) → `dd24c92`, `813454c` (handoff updates) → `7244317`…`da1b303` (Plan B — 7 commits). Below `def0009`: `8b0ba20` ("B133 submitted to TestFlight") and the rest of the pre-existing history.
- **Not pushed.** `origin/main` is far behind (at `b091590`, April). All of this session's work — Plan A, the Plan B doc, and Plan B itself — is **local only**. Push when ready; no force-push is or will be needed.
- **API: CHANGED but not deployed.** Plan B Task 1 modified `apps/api/src/services/srs.service.ts` (`getReviewQueue` + the new `planQueueSlots` helper). The live App Runner service still runs the old code. **Deploy owed** — `./scripts/deploy-api.sh`. Last known healthy at `https://73x3fcaaze.us-east-1.awsapprunner.com`.
- **No EAS build cut** this session. **Both** Plan A and Plan B are on `main` but **not yet in any TestFlight build** — the next build carries both, and both owe an on-device walkthrough.
- **Watch:** unchanged.

---

## Plan B — executed & merged this session

`docs/superpowers/plans/2026-05-18-practice-loop-legs-and-nav.md`. All 6 tasks, each spec- and code-reviewed; commits `7244317`…`da1b303` on `main`:

1. **`7244317` — API guaranteed new-kanji allowance.** A pure, unit-tested `planQueueSlots` helper (`NEW_KANJI_FLOOR = 4`) front-loads a small new-kanji batch into `getReviewQueue` so a heavy review day still introduces new material. 6 new unit tests.
2. **`0aaec2e` — `WritingLeg`** — wraps `WritingPractice` for one kanji (`apps/mobile/src/components/study/WritingLeg.tsx`).
3. **`9c559c6` — `SpeakingLeg`** — wraps `VoiceEvaluator` for one kanji, legacy kanji-reading layout (`SpeakingLeg.tsx`).
4. **`5da1ddb` — review store leg state machine** — per-kanji `leg` (`flashcard → writing → speaking`); the time-box check moved into a new `endKanji` action so a session never cuts off mid-leg.
5. **`d82436e` — study.tsx** — renders the writing/speaking legs based on `leg`.
6. **`fe43411` — removed the Write & Speak tabs** — deleted `writing.tsx` / `voice.tsx`, edited `_layout.tsx`; tab bar 7 → 5 (Dashboard · Study · Journal · Progress · Profile).

**Review-driven fix folded in:** `da1b303` — `leg: 'flashcard'` added to the `loadWeakQueue` loading-state `set` for parity with every other queue-load path (harmless today — weak drills have `goalMinutes 0` so `leg` never advances — but closes a latent stale-state trap).

**The mechanic:** after the flashcard grade, new kanji and weak (Again/Hard) review kanji route through `writing → speaking`; Good/Easy review kanji end immediately. Leg routing is gated on `goalMinutes > 0`, so "Drill Weak Spots" / "Drill missed cards" stay flashcard-only.

**Verified:** mobile typecheck clean · mobile jest 37/37 · API typecheck clean (only the one pre-existing unrelated `social-mute.test.ts:25` error) · API tests 230/230. The whole-branch integration review verdict was "Ready to merge".

**Process note (Plan A's leaked-commit warning heeded):** every Plan B task was confirmed committed to the feature branch — all 7 commits landed on `claude/optimistic-gauss-f7f1e1`, fast-forward merged cleanly to `main`. **No commits leaked onto `main` this time.**

### Plan B verification still owed — on-device walkthrough (next EAS build)
- Tab bar shows **5** tabs, no Write/Speak.
- Grade a **new** kanji → routes to writing leg → "Continue to speaking" → speaking leg → advances.
- Grade a review kanji **Again/Hard** → routes through writing → speaking. **Good/Easy** → advances straight to the next kanji.
- The time-remaining indicator shows on the writing/speaking leg headers; the session ends only after a kanji's *full* path, never mid-leg.
- "Drill Weak Spots" / "Drill missed cards" remain flashcard-only.
- On a heavy-review account, a Study session still surfaces some new kanji near the start (the guaranteed allowance) — **only after the API is deployed.**

### Plan B follow-ups flagged by reviewers (out of Plan B scope)
- **Orphaned `writing-queue` API code.** `GET /v1/review/writing-queue` + `getWritingQueue()` in `srs.service.ts` were used *only* by the deleted Write tab — now dead code. A clean removal candidate (the *reading-queue* side is intentionally kept warm for Plan C — do **not** remove that). A background task was spawned for this cleanup.
- **Stale comments** in `study.tsx` (file header + a `useFocusEffect`) still say "the Speaking tab" — the audio-session reset is still correct, only the wording is stale.
- **Accessibility:** the writing/speaking leg close buttons have no `accessibilityLabel` (consistent with the pre-existing `study.tsx` pattern — project-wide debt, not a Plan B regression).
- **Resume edge case (accepted v1 limitation):** `submitResult` persists the flashcard grade at grade time; if the app is killed mid-writing/mid-speaking, resume restores `currentIndex` past that kanji and skips its legs. The SRS grade is preserved.

---

## Plan A — shipped earlier this session (recap)

`docs/superpowers/plans/2026-05-17-minutes-based-study-goal.md`, merged as `def0009`. The daily goal is now a minutes budget; the study session is time-boxed on a timer instead of a fixed card count. Migration `0023` reinterpreted `daily_goal` as minutes and was applied to the live DB. **Plan A verification still owed:** an on-device walkthrough (countdown visible, session ends after the in-progress card, 🎉 banner on goal met, "Keep studying" starts a fresh timed segment, Dashboard shows the plain review count) — fold into the same next-build walkthrough as Plan B.

**Minor Plan A follow-up still open:** WCAG — `colors.textMuted` on the dark background is ~3.86:1, under AA 4.5:1 for 12px caption text (affects the `timeLeft` label and the pre-existing `counter`/`swipeHint`). Project-wide debt. The new Plan B leg headers reuse the same `textMuted` caption style, so they inherit it.

---

## Plan C — still to be written

**Quiz leg + Browse tab + telemetry.** Wire the existing quiz engine in for "maybe-slipping" review kanji (spec §2/§4 — a failed quiz counts as a lapse and resurfaces the card sooner); promote Browse to a tab (spec §1); add the Session Complete modality breakdown (spec §5). Also revives the **richer vocab-word speaking layout** (`VoiceEvaluator` with a `voicePrompt`) that Plan B deferred — Plan C already touches the queue API, so the `reading-queue` endpoint / `selectVoicePrompt` are intentionally kept alive for it. Write it via `superpowers:writing-plans` after the on-device walkthrough.

After the Practice Loop: Spec 1.5 (FSRS migration) and Spec 2 (Buddy, the AI tutor) each get their own brainstorm.

---

## B133 — verification carry-forward

B133 shipped and was submitted to TestFlight an earlier session. Still owed:
- **Item 5** — App Runner logs should show one `[Internal] Daily reminder job triggered` per hour and no `[Cron] Running hourly reminder check`; one daily-reminder push, no duplicate.
- **Items 6, 7, Bug A** — on-device on TestFlight: Study speaker icon un-sticks; empty-transcript hint on Speaking; reported Speak vocab words pass.
- **Bug B** — resolved (stale `velocity_drop` rows cleared 2026-05-18).

**Known pre-existing issue (not Plan A/B, not B133):** `apps/api/test/integration/social-mute.test.ts:25` has a `FastifyRegisterOptions` typecheck error that exists on `main` independently — flagged for a future sweep.

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
| 🚀 | Deploy the API (Plan B Task 1 changed `getReviewQueue`) | **owed — `./scripts/deploy-api.sh`** |
| 🚀 | Secrets rotation + SSM Parameter Store migration | 7 keys still owed |
| 🚀 | Migrate Supabase DB `ap-southeast-2` → `us-east-1` | Cross-region tax; dedicated session |
| 🚀 | SES out of sandbox | Needed for tutor-share email at scale |
| 🚀 | Revert testing-phase flags | `EXPO_PUBLIC_DEV_TOOLS=1` (in `eas.json` production profile) + the 2h study-mate alert cap |

---

## Other open follow-ups

- **Orphaned `writing-queue` API code** — see Plan B follow-ups above; a background task was spawned for it.
- **Truncated kanji readings** — `kanji.kun_readings`/`on_readings` capped at ~5 sorted entries; re-import full KanjiDic2 readings.
- **The "Kanji Buddy 1.0" rebrand** — rename Kanji Learn → Kanji Buddy, splash polish, About/Credits branding. Independent of the Practice Loop. Needs a brand-decision block first.
- **Tutor report writing scope-down** — the report still surfaces a Writing modality; Study no longer serves standalone writing prompts (and as of Plan B writing is a loop leg). `getWriting` + `weakestModality` in the tutor report need scoping/removal — revisit alongside the loop work.
- **Phase 3 #13 — Milestones panel refactor** — spec captured earlier; after the Practice Loop.
- **`interventions.payload` double-encoded** — stored double-encoded jsonb (a Drizzle/postgres-js quirk); harmless to the JS round-trip but breaks SQL-side payload queries.

---

## Working environment notes

- **Prod API:** `https://73x3fcaaze.us-east-1.awsapprunner.com`.
- **Supabase:** still `ap-southeast-2`. Migration files live in `packages/db/supabase/migrations/` (`0001`–`0023`). `0023` was applied to the live DB 2026-05-18 via `scripts/run-migration-0023.mjs`.
- **Docker / API deploy:** `./scripts/deploy-api.sh` from repo root. **Plan B Task 1 changed the API — a deploy is owed before the new-kanji allowance is live.**
- **EAS builds:** from `apps/mobile/`, ~$2/build. `eas build --platform ios --profile production`. EAS auto-bumps `ios.buildNumber` — **never hand-edit `app.json`**. Submit with `eas submit`. The next build should carry both Plan A and Plan B and cover both owed on-device walkthroughs.
- **Watch builds:** **manual Xcode rebuild only** — EAS does not build the watchOS target.
- **Co-author convention:** every kanji-learn commit includes `Co-Authored-By: Robert A. Dennis (Buddy)` alongside the Claude co-author line.
