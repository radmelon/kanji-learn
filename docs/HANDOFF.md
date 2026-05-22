# Session Handoff — 2026-05-21 (Spec 1 in TestFlight — B134 submitted, API deployed, origin pushed)

## TL;DR

**Plans A, B, and C are all on `main`, pushed to `origin`, in the deployed API, and in TestFlight as B134.** Plan C (the Practice Loop quiz & close-out) was executed and merged earlier (`bcc0133`…`1120dab`), completing Spec 1 — the Three-Modality Practice Loop. Today's ship operations: 51 commits pushed to `origin/main` (now at `c482f35`); the API was deployed (App Runner op `8fcf22cf275d4d9f871951be3d2a2d8f`, rolling out the new image); EAS build **B134** was cut and submitted to TestFlight (`fdb4b033-adcf-4a5b-8f1e-bc197f9e818d`, submission `9260ec3e-7073-48d8-a3ee-baba36255fd1`). Apple is processing the binary.

**Next: the combined on-device walkthrough of Plans A/B/C on B134.** Once Apple finishes processing (the email arrives, the build appears in TestFlight) and the App Runner rollout is live, walk through the verification checklist below.

**Next creative work:** Spec 1.5 (FSRS migration) and Spec 2 (Buddy, the AI tutor) — each needs its own brainstorm. Plan C scope decisions left these explicitly out; the spec deck calls FSRS "best done pre-launch while the dataset is tiny."

## Current state

- **Branch:** `main` at `c482f35` (the handoff refresh after Plan C). Working tree: untracked items only (housekeeping queue — see that section; one item resolved this session).
- **`main` history (recent):** Plan B merge (`def0009`-era through `da1b303`) → `c8e2639` (post-Plan-B handoff) → `5f2d6c1` (Plan C plan doc) → `7a7cb31` (`.claude/worktrees/` gitignore) → `bcc0133`…`1120dab` (Plan C, 12 commits) → `c482f35` (post-Plan-C handoff).
- **Pushed to `origin/main`** ✅ — `origin/main` is now at `c482f35` (was at `b091590` since April; 51 commits fast-forwarded).
- **API: deployed** ✅ — `./scripts/deploy-api.sh` ran cleanly: Docker image pushed to ECR (digest `sha256:d4d9f76a22f5...`); App Runner deployment triggered (operation `8fcf22cf275d4d9f871951be3d2a2d8f`). The new code (`planQueueSlots`, `isRecentlyShaky` + `maybeSlipping` in `getReviewQueue`, `generateQuestionForKanji` + `GET /v1/tests/question`) is rolling out. Confirm via the App Runner console (https://us-east-1.console.aws.amazon.com/apprunner/home?region=us-east-1) or by hitting the prod API once the rollout completes (typically ~5–10 min from trigger). Prod API: `https://73x3fcaaze.us-east-1.awsapprunner.com`.
- **TestFlight: B134 submitted** ✅ — EAS build `fdb4b033-adcf-4a5b-8f1e-bc197f9e818d` (`buildNumber: 134`, version `1.0.0`); IPA at https://expo.dev/artifacts/eas/xk4EwEWbauZBstXNjnDLV4.ipa. Submission `9260ec3e-7073-48d8-a3ee-baba36255fd1`. **Apple is processing** — you'll get an email when it's testable; TestFlight URL: https://appstoreconnect.apple.com/apps/6761603490/testflight/ios. Note: `app.json` ios.buildNumber is still `133` (the LAST shipped before today); the bump to 134 happened EAS-side per project convention — do not hand-edit.
- **Watch:** unchanged.

---

## On-device walkthrough — owed on B134 (Plans A + B + C combined)

When B134 lands in TestFlight and the API rollout is live:

**Plan A (minutes-budget time-box):**
- Onboarding asks "How many minutes per day?" (options 5/10/15/20/30, default 15).
- Profile shows "Minutes per day".
- The Study session shows a live "Nm left" countdown.
- The session ends after the in-progress card (never mid-card), 🎉 banner on goal met.
- "Keep studying" starts a fresh timed segment.
- Dashboard shows "N reviewed today" (plain count, not cards-vs-goal fraction).

**Plan B (writing/speaking legs + nav):**
- Tab bar shows **6** tabs: Dashboard · Study · **Browse** · Journal · Progress · Profile. No Write/Speak tabs.
- Grade a **new** kanji → writing leg → "Continue to speaking" → speaking leg → advances.
- Grade a review kanji **Again/Hard** → routes through writing → speaking.
- The time-remaining indicator shows on leg headers; the session ends only after a kanji's *full* path, never mid-leg.
- "Drill Weak Spots" / "Drill missed cards" remain flashcard-only.
- On a heavy-review account, a Study session surfaces some new kanji near the start (the guaranteed allowance).

**Plan C (quiz leg + Ready screen + vocab speaking + Session Complete breakdown):**
- Opening the Study tab shows the **Ready screen** (today's minutes + due count + Begin).
- Grade a Good/Easy review kanji that's "maybe slipping" (has a recent Hard/Again, or is a burned-sample card) → a **quiz** question. **Pass** → advances. **Fail** → routes to writing → speaking AND the card resurfaces sooner (confirm on a later session).
- Unflagged Good/Easy → advances straight on (no quiz).
- **Speaking leg** shows the vocab-word layout (vocab + pitch reading) for kanji with example vocab; legacy kanji-reading layout otherwise.
- **Session Complete** shows the "Practice breakdown" row (flashcard / writing / speaking / quiz rep counts).
- After a loop quiz: a `testSessions` row exists with `test_type = 'loop_check'` and matching `testResults`.

**Other:** check the App Runner logs for one `[Internal] Daily reminder job triggered` per hour and no `[Cron] Running hourly reminder check`; one daily-reminder push, no duplicate (B133 carry-over). Confirm Study speaker icon un-sticks; empty-transcript hint on Speaking; reported Speak vocab words pass (B133 carry-over Items 6/7/Bug A).

---

## Plan C — executed & merged this session (recap)

`docs/superpowers/plans/2026-05-18-practice-loop-quiz-and-close-out.md`. All 10 tasks, each spec- and code-reviewed; commits `bcc0133`…`1120dab` on `main`:

1. **`bcc0133`** — API `maybeSlipping` flag (`isRecentlyShaky` + 6 unit tests; burned-sample tier always-flagged).
2. **`611fad9`** — API single-kanji quiz question (`generateQuestionForKanji` + `GET /v1/tests/question`).
3. **`ecd8d0f`** — `QuizQuestion` component.
4. **`3cf6456`** — `QuizLeg` component (telemetry via `POST /v1/tests/submit` with `testType: 'loop_check'`).
5. **`e18db8a`** — review store: `'quiz'` leg + routing + `passQuizLeg`/`failQuizLeg` + `modalityCounts`.
6. **`2757f65`** — study.tsx renders the quiz leg.
7. **`b90abea`** — SpeakingLeg fetches `voicePrompt` and renders the vocab-word layout.
8. **`9924bdd`** — SessionComplete modality breakdown row.
9. **`0c51cf9` + `d3ce7f6`** — Ready screen (`d3ce7f6` = review-caught Critical fix: reactive `isWeakDrill` effect for remounted-tab weak-drill case).
10. **`9728e40` + `1120dab`** — Browse promoted to a tab (`1120dab` cleans up dead `useRouter`/`router` in `progress.tsx`).

**Verified at merge time:** mobile typecheck clean · API typecheck clean (only the known pre-existing `social-mute.test.ts:25` error) · mobile jest 37/37 · API tests 236/236.

### Plan C follow-ups flagged by reviewers (out of Plan C scope)
- **Unbounded `reviewLogs` fetch** — `getReviewQueue`'s `maybeSlipping` query fetches every review-log row for the due kanji, then keeps only the last 3 per kanji in JS. A windowed `ROW_NUMBER()` query would bound it. Perf follow-up. **A background task was spawned.**
- **Stale `study.tsx` file-header comment** — cosmetic doc drift; the header state-machine comment predates Plans B/C.
- **Accessibility** — leg close buttons / new loading spinners have no `accessibilityLabel`; `Ionicons name={icon as any}` is repeated. Consistent with pre-existing project patterns; an app-wide a11y pass is overdue.
- **Resume edge case (accepted v1 limitation)** — an app kill mid-quiz/writing/speaking resumes past that kanji and skips its remaining legs. A quiz-fail downgrade only persists if `failQuizLeg` ran before the kill.

---

## Plan A & Plan B — shipped earlier (recap)

- **Plan A** (`def0009`) — daily goal became a minutes budget; the study session is time-boxed. Migration `0023` reinterpreted `daily_goal` as minutes (applied to the live DB 2026-05-18).
- **Plan B** (`7244317`…`da1b303`) — the writing/speaking loop legs; the Write & Speak tabs removed; the guaranteed new-kanji allowance (`planQueueSlots`).

**Minor carry-over:** WCAG — `colors.textMuted` on the dark background is ~3.86:1, under AA 4.5:1 for 12px caption text (the leg headers, `counter`, `swipeHint`). Project-wide debt; rolls into the app-wide a11y pass follow-up.

---

## B133 — verification carry-forward

B133 shipped and was submitted to TestFlight an earlier session. The B134 walkthrough above absorbs the remaining items:
- **Item 5** — App Runner logs: one `[Internal] Daily reminder job triggered` per hour, no `[Cron] Running hourly reminder check`; one daily-reminder push, no duplicate.
- **Items 6, 7, Bug A** — Study speaker icon un-sticks; empty-transcript hint on Speaking; reported Speak vocab words pass.
- **Bug B** — resolved (stale `velocity_drop` rows cleared 2026-05-18).

**Known pre-existing issue (not Plan A/B/C, not B133):** `apps/api/test/integration/social-mute.test.ts:25` has a `FastifyRegisterOptions` typecheck error that exists on `main` independently — flagged for a future sweep.

---

## Working tree — housekeeping queue (carry-forward)

Untracked items in the main checkout. Still need eyeball decisions:

| Item | Recommendation |
|---|---|
| ~~`.claude/worktrees/`~~ | ✅ gitignored (commit `7a7cb31`). |
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

## Pre-launch infra checklist

| | Item | Status |
|---|---|---|
| ✅ | Apply migration `0023` to the live DB | done 2026-05-18 |
| ✅ | Push `main` to `origin` | done 2026-05-21 — `origin/main` = `c482f35` |
| ✅ | Deploy the API (Plan B + Plan C) | triggered 2026-05-21, op `8fcf22cf275d4d9f871951be3d2a2d8f` — confirm rollout completed in the App Runner console |
| ✅ | Cut + submit B134 to TestFlight (Plans A/B/C) | done 2026-05-21 — Apple processing |
| 🚀 | On-device walkthrough on B134 | owed once Apple processing completes — checklist above |
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

- **Prod API:** `https://73x3fcaaze.us-east-1.awsapprunner.com`. Plan B + Plan C deployment is in flight as of 2026-05-21.
- **Supabase:** still `ap-southeast-2`. Migration files live in `packages/db/supabase/migrations/` (`0001`–`0023`). `0023` was applied to the live DB 2026-05-18 via `scripts/run-migration-0023.mjs`.
- **Docker / API deploy:** `./scripts/deploy-api.sh` from repo root. Builds + pushes the image to ECR and triggers an App Runner deployment. The script returns immediately after triggering; monitor rollout in the App Runner console.
- **EAS builds:** from `apps/mobile/`, ~$2/build. `eas build --platform ios --profile production --non-interactive`. EAS auto-bumps `ios.buildNumber` — **never hand-edit `app.json`** (it tracks the LAST shipped build; EAS bumps to +1 server-side). Submit with `eas submit --platform ios --latest --non-interactive`. Apple processing follows (~5–10 min from submit).
- **Watch builds:** **manual Xcode rebuild only** — EAS does not build the watchOS target.
- **Worktrees:** `.claude/worktrees/` is the Claude Code scratch-worktree location (now gitignored). Plan B and Plan C were each executed in a dedicated worktree there, then fast-forward merged and the worktree removed.
- **Co-author convention:** every kanji-learn commit includes `Co-Authored-By: Robert A. Dennis (Buddy)` alongside the Claude co-author line.
