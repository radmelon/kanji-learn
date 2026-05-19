# Session Handoff — 2026-05-18 (Spec 1 complete — Plans A, B & C all shipped to main)

## TL;DR

**Plan C — Practice Loop Quiz & Close-Out — was executed and merged to `main` this session.** All 10 tasks of `docs/superpowers/plans/2026-05-18-practice-loop-quiz-and-close-out.md` were implemented via `superpowers:subagent-driven-development` (a fresh subagent per task, each passing a spec-compliance review and a code-quality review), plus a whole-branch integration review. Two review-caught issues were fixed in-branch (a Critical Ready-screen bug, a dead-code cleanup). Fast-forward merged to `main` — 12 commits, `bcc0133`…`1120dab`.

**This completes Spec 1 — the Three-Modality Practice Loop.** Plan A (minutes budget), Plan B (writing/speaking legs + nav), and Plan C (quiz leg + Browse tab + Ready screen + vocab speaking + Session Complete breakdown) together implement the whole of `docs/superpowers/specs/2026-05-17-practice-loop-design.md`. **Next: Spec 1.5 (FSRS migration) and Spec 2 (Buddy, the AI tutor) — each needs its own brainstorm.**

⚠️ **API deploy owed.** Plan B Task 1 and Plan C Tasks 1–2 all changed the API (`srs.service.ts`, `test.service.ts`, `test.ts`). The live App Runner service still runs pre-Plan-B code. The quiz leg, the `maybeSlipping` routing, and the guaranteed new-kanji allowance will **not** work on-device until `./scripts/deploy-api.sh` is run. No deploy has been done.

## Current state

- **Branch:** `main` at `1120dab`. Working tree: untracked items only (housekeeping queue — see that section; one item resolved this session).
- **`main` history this session:** `def0009` (Plan A merge) → `cb11bd7` (Plan B doc) → `dd24c92`, `813454c` (handoff) → `7244317`…`da1b303` (Plan B, 7 commits) → `c8e2639` (handoff refresh) → `5f2d6c1` (Plan C doc) → `7a7cb31` (`.claude/worktrees/` gitignore) → `bcc0133`…`1120dab` (Plan C, 12 commits).
- **Not pushed.** `origin/main` is far behind (at `b091590`, April). All of Plans A/B/C is **local only**. Push when ready; no force-push is or will be needed.
- **API: CHANGED across Plan B + Plan C, not deployed.** Changed files: `apps/api/src/services/srs.service.ts` (`planQueueSlots`, `isRecentlyShaky`, `maybeSlipping` in `getReviewQueue`), `apps/api/src/services/test.service.ts` (`generateQuestionForKanji`), `apps/api/src/routes/test.ts` (`GET /v1/tests/question`). The live service runs none of it. **Deploy owed** — `./scripts/deploy-api.sh`. Last known healthy at `https://73x3fcaaze.us-east-1.awsapprunner.com`.
- **No EAS build cut.** Plans A, B, and C are all on `main` but **not in any TestFlight build** — the next build carries all three and owes a combined on-device walkthrough.
- **Watch:** unchanged.

---

## Plan C — executed & merged this session

`docs/superpowers/plans/2026-05-18-practice-loop-quiz-and-close-out.md`. All 10 tasks, each spec- and code-reviewed; commits `bcc0133`…`1120dab` on `main`:

1. **`bcc0133` — API `maybeSlipping` flag.** `getReviewQueue` flags a review kanji `maybeSlipping` when it has a Hard/Again grade in its recent reviews (the pure, unit-tested `isRecentlyShaky` helper) or it is a burned-sample card. Optional field on `ReviewQueueItem`. 6 new unit tests.
2. **`611fad9` — API single-kanji quiz question.** `TestService.generateQuestionForKanji` + `GET /v1/tests/question?kanjiId=N`.
3. **`ecd8d0f` — `QuizQuestion`** — a reusable multiple-choice question component.
4. **`3cf6456` — `QuizLeg`** — wraps `QuizQuestion`, fetches the question, records the attempt to `testSessions`/`testResults` via `POST /v1/tests/submit` (`testType: 'loop_check'`).
5. **`e18db8a` — review store quiz leg** — `'quiz'` added to `LegName`; routing; `passQuizLeg`/`failQuizLeg`; per-modality `modalityCounts`.
6. **`2757f65` — study.tsx** — renders the quiz leg.
7. **`b90abea` — SpeakingLeg vocab layout** — fetches a `voicePrompt` from `GET /v1/review/reading-queue` and renders `VoiceEvaluator`'s richer vocab-word layout.
8. **`9924bdd` — SessionComplete modality breakdown** — a "Practice breakdown" row (flashcard / writing / speaking / quiz rep counts).
9. **`0c51cf9` + `d3ce7f6` — Ready screen** — a "today's plan" screen (minutes budget + due count + Begin) before the loop starts. `d3ce7f6` is a review-caught **Critical fix**: a reactive `isWeakDrill` effect so a weak drill on a remounted Study tab skips the Ready screen instead of overwriting its queue.
10. **`9728e40` + `1120dab` — Browse → tab** — `browse.tsx` moved into `(tabs)/`; modal `Stack.Screen` removed; the Progress-tab Browse button removed. `1120dab` cleans up the resulting dead `useRouter`/`router`. Tab bar 5 → 6: Dashboard · Study · Browse · Journal · Progress · Profile.

**The mechanic added:** after a flashcard grade, a Good/Easy review kanji flagged `maybeSlipping` routes to a one-question quiz check. Pass → confirmed, loop advances. Fail → the stored flashcard grade is downgraded to Again(1) so the SRS resurfaces the card sooner, and the kanji routes on to `writing → speaking`. New + Again/Hard kanji still go straight to `writing → speaking` (no quiz).

**Verified:** mobile typecheck clean · API typecheck clean (only the one pre-existing unrelated `social-mute.test.ts:25` error) · mobile jest 37/37 · API tests 236/236 (unit + integration). Whole-branch review verdict: "Ready to merge".

### Plan C follow-ups flagged by reviewers (out of Plan C scope)
- **Unbounded `reviewLogs` fetch** — `getReviewQueue`'s `maybeSlipping` query fetches every review-log row for the due kanji, then keeps only the last 3 per kanji in JS. A windowed `ROW_NUMBER()` query would bound it. Functionally correct; a perf follow-up. **A background task was spawned for this.**
- **Stale `study.tsx` file-header comment** — the header state-machine comment predates Plans B/C (no mention of the legs / Ready phase). Cosmetic doc drift.
- **Accessibility** — leg close buttons and the new loading spinners have no `accessibilityLabel`; `modalityCounts` `Ionicons` use `icon as any`. All consistent with pre-existing project-wide patterns — not Plan C regressions, but the documented WCAG 2.1 AA standard implies an app-wide a11y pass is overdue.
- **Resume edge case (accepted v1 limitation)** — `submitResult` persists the flashcard grade at grade time; an app kill mid-quiz/writing/speaking resumes past that kanji and skips its remaining legs. A quiz-fail downgrade only persists if `failQuizLeg` ran before the kill.

---

## Plan A & Plan B — shipped earlier this session (recap)

- **Plan A** (`def0009`) — the daily goal became a minutes budget; the study session is time-boxed on a timer. Migration `0023` reinterpreted `daily_goal` as minutes (applied to the live DB 2026-05-18).
- **Plan B** (`7244317`…`da1b303`) — the writing/speaking loop legs; the Write & Speak tabs removed; the guaranteed new-kanji allowance (`planQueueSlots`).

**Verification still owed for all three plans:** a combined **on-device walkthrough** in the next EAS build —
- Plan A: minutes countdown, session ends after the in-progress card, 🎉 banner on goal met, "Keep studying", Dashboard shows the plain review count.
- Plan B: 6→5… now 6 tabs; new/Again/Hard kanji route through writing → speaking; Good/Easy end (or quiz).
- Plan C: the Ready screen → Begin; a "maybe slipping" Good/Easy kanji gets a quiz (pass advances, fail → writing → speaking + the card resurfaces sooner — **needs the API deployed**); SpeakingLeg vocab-word layout; Session Complete "Practice breakdown"; Browse is a tab.

**Minor carry-over:** WCAG — `colors.textMuted` on the dark background is ~3.86:1, under AA 4.5:1 for 12px caption text (the leg headers, `counter`, `swipeHint`). Project-wide debt.

---

## B133 — verification carry-forward

B133 shipped and was submitted to TestFlight an earlier session. Still owed:
- **Item 5** — App Runner logs should show one `[Internal] Daily reminder job triggered` per hour and no `[Cron] Running hourly reminder check`; one daily-reminder push, no duplicate.
- **Items 6, 7, Bug A** — on-device on TestFlight: Study speaker icon un-sticks; empty-transcript hint on Speaking; reported Speak vocab words pass.
- **Bug B** — resolved (stale `velocity_drop` rows cleared 2026-05-18).

**Known pre-existing issue (not Plan A/B/C, not B133):** `apps/api/test/integration/social-mute.test.ts:25` has a `FastifyRegisterOptions` typecheck error that exists on `main` independently — flagged for a future sweep.

---

## Working tree — housekeeping queue (carry-forward)

Untracked items in the main checkout. Still need eyeball decisions:

| Item | Recommendation |
|---|---|
| ~~`.claude/worktrees/`~~ | ✅ gitignored this session (commit `7a7cb31`). |
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
| 🚀 | Deploy the API (Plan B + Plan C changed `srs.service.ts`, `test.service.ts`, `test.ts`) | **owed — `./scripts/deploy-api.sh`** |
| 🚀 | Cut an EAS build | owed — carries Plans A/B/C; needed for the combined on-device walkthrough |
| 🚀 | Secrets rotation + SSM Parameter Store migration | 7 keys still owed |
| 🚀 | Migrate Supabase DB `ap-southeast-2` → `us-east-1` | Cross-region tax; dedicated session |
| 🚀 | SES out of sandbox | Needed for tutor-share email at scale |
| 🚀 | Revert testing-phase flags | `EXPO_PUBLIC_DEV_TOOLS=1` (in `eas.json` production profile) + the 2h study-mate alert cap |

---

## Other open follow-ups

- **Bound the `maybeSlipping` `reviewLogs` query** — see Plan C follow-ups above; a background task was spawned.
- **Orphaned `writing-queue` API code** — `GET /v1/review/writing-queue` + `getWritingQueue()` were used only by the deleted Write tab — now dead code (the *reading-queue* side is in use by Plan C's SpeakingLeg — keep it). A background task was spawned for the cleanup.
- **Truncated kanji readings** — `kanji.kun_readings`/`on_readings` capped at ~5 sorted entries; re-import full KanjiDic2 readings.
- **The "Kanji Buddy 1.0" rebrand** — rename Kanji Learn → Kanji Buddy, splash polish, About/Credits branding. Needs a brand-decision block first.
- **Tutor report writing scope-down** — the report still surfaces a Writing modality; Study no longer serves standalone writing prompts (writing is a loop leg). `getWriting` + `weakestModality` in the tutor report need scoping/removal.
- **Phase 3 #13 — Milestones panel refactor** — spec captured earlier.
- **`interventions.payload` double-encoded** — stored double-encoded jsonb (a Drizzle/postgres-js quirk); harmless to the JS round-trip but breaks SQL-side payload queries.
- **App-wide accessibility pass** — touch targets / `accessibilityLabel`s on interactive elements, plus the `textMuted` contrast debt. Repeated across study/quiz components; warrants its own task given the WCAG 2.1 AA standard.

---

## Working environment notes

- **Prod API:** `https://73x3fcaaze.us-east-1.awsapprunner.com`.
- **Supabase:** still `ap-southeast-2`. Migration files live in `packages/db/supabase/migrations/` (`0001`–`0023`). `0023` was applied to the live DB 2026-05-18 via `scripts/run-migration-0023.mjs`.
- **Docker / API deploy:** `./scripts/deploy-api.sh` from repo root. **Plan B + Plan C changed the API — a deploy is owed before the quiz leg / `maybeSlipping` routing / new-kanji allowance work for users.**
- **EAS builds:** from `apps/mobile/`, ~$2/build. `eas build --platform ios --profile production`. EAS auto-bumps `ios.buildNumber` — **never hand-edit `app.json`**. Submit with `eas submit`. The next build carries Plans A/B/C and covers the combined on-device walkthrough.
- **Watch builds:** **manual Xcode rebuild only** — EAS does not build the watchOS target.
- **Worktrees:** `.claude/worktrees/` is the Claude Code scratch-worktree location (now gitignored). Plan B and Plan C were each executed in a dedicated worktree there, then fast-forward merged and the worktree removed.
- **Co-author convention:** every kanji-learn commit includes `Co-Authored-By: Robert A. Dennis (Buddy)` alongside the Claude co-author line.
