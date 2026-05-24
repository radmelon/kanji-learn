# Session Handoff — 2026-05-24 (Buddy v2 Refresh + Phase 0a shipped)

## TL;DR (this session, 2026-05-24)

**Buddy v2 is back in motion.** Brainstormed a "Phase 1+ Refresh" of the April 2026 Buddy v2 design + spec — confirms the original 17-section design stands, but updates the §14 phase plan to reflect what shipped between April and May (Spec 1 Practice Loop, Spec 1.5 FSRS) and corrects a major inventory error: Phase 0 schema is actually live in production (16 tables via the drizzle migration track), not "unmigrated" as a prior agent had reported. Refresh doc at [`docs/superpowers/specs/2026-05-23-buddy-v2-phase-1-refresh.md`](superpowers/specs/2026-05-23-buddy-v2-phase-1-refresh.md). Re-anchors leech detection on FSRS R(t), captures the "kanji monkey off your back" voice evolution, and defers the Apple Watch role-refactor to its own brainstorm.

**Refreshed phase ordering (constructivist-first):** Phase 0a (cleanup) → 1' (BuddyCard delivery) → 5 (Mnemonic Co-Creation) → 6 (Study Log) → 3 (Orchestration with R(t)) → 4 (Social) → 7a (Buddy onboarding). Spec 3 = Practice Loop intervention routing (lifted out of Buddy v2). Phase 2 (on-device LLM) deferred until cloud path is proven.

**Phase 0a shipped — API-only, no migration, no mobile changes.** Wired the orphaned `LearnerStateService` into a post-`submitReview` refresh hook (fire-and-forget via `setImmediate`, 30s per-user frequency cap). Added daily Buddy metrics (structured-JSON log line at 03:05 UTC covering 24h `learner_state_cache` refreshes, `buddy_llm_telemetry` rows, `learner_timeline_events` rows). Deployed via `./scripts/deploy-api.sh` — op `52099409c3d74f13bb81cb7a58885101` SUCCEEDED in 3:35. Operator did a real review on B135 TestFlight; `learner_state_cache` populated within seconds with sensible values (471 kanji seen, 3-day streak, buddy_mood=supportive). End-to-end behavior validated in production.

**Next creative work:** Phase 1' brainstorm — BuddyCard delivery skeleton. Settles surface placement (Dashboard / Study Ready / Progress), frequency cap discipline, template-vs-LLM enrichment, and whether to ship Watch nudges in Phase 1' (recommended: phone-only pending the deferred Watch refactor).

---

## Prior session — 2026-05-23 (Spec 1.5 FSRS migration shipped — B135 in TestFlight)

**Spec 1.5 (FSRS migration) is fully landed — on `main`, on the live DB, in the deployed API, and in TestFlight as B135.** 15 commits from `1561714`…`9f5357d` replaced the SM-2 scheduler with hand-rolled FSRS-5, swapped the schema (migration 0024), and seeded existing card state via a one-time replay. Live rollout sequence: safety dump → migration 0024 applied → replay walked 4 users / 742 progress rows / 2857 review_logs in ~2 min → App Runner op `3f6c157cd008489e8ac85778cf893eda` SUCCEEDED → B135 submitted to TestFlight (`6f063489-76ce-43c8-ba41-3f764d9322bb`). B135 is in TestFlight and verified working on-device.

**Side-benefit confirmed on-device:** under SM-2, the "burned" status was effectively unreachable (interval reset to 1 day on every Hard/Again). After replay, **174/742 cards (23%) correctly sit in burned**, matching the user's subjective experience of months of daily use without ever burning a kanji.

**Carry-forward verification owed on B135:** the combined Plans A/B/C walkthrough was originally owed on B134; B135 absorbs it (and adds FSRS-specific items). See the walkthrough section below.

## Current state

- **Branch:** `main` ahead of `origin/main` by 0 commits (pushed at end of session). Working tree: same housekeeping queue as prior session.
- **Recent `main` history (today's session):** `3de48f3` (refresh doc) → `73b591f` (Watch deferral) → `5aaaaa1` (initial Phase 0a plan — superseded) → `571d439` (RLS amendment — also superseded) → `c577306` (refresh §2.4 correction) → `74b8047` (rewritten Phase 0a plan) → `18b6be7` (Task 1 findings) → `1807a72` (failing tests) → `efab7c3` (LearnerStateService wiring) → `aa96580` (daily Buddy metrics).
- **Pushed to `origin/main`** ✅ — `origin/main` = `aa96580`.
- **Live DB (Supabase ap-southeast-2):** no migration this session. Confirmed via direct SQL that all 16 Buddy/UKG tables exist (Phase 0 shipped via the drizzle track in April). Dual-write health verified: 726 `learner_knowledge_state` rows, 2062 `learner_timeline_events` rows, 80 `buddy_llm_telemetry` rows. Post-Phase 0a deploy: `learner_state_cache` populating live.
- **API:** Deployed 2026-05-24. ECR digest `sha256:77b757b48424090acada90eab9156ae878508d8794d7503c15c078ee98406c30`. App Runner op `52099409c3d74f13bb81cb7a58885101` reported `SUCCEEDED` at 21:37 UTC. Smoke: `GET /v1/review/status` → 401 (route exists); `GET /` → 404 (Fastify default).
- **TestFlight:** B135 still current — Phase 0a is API-only, no new build needed. The mobile app submits to `/v1/review/submit` the same as before; the server-side wiring is invisible to the client.
- **Watch:** unchanged.

---

## On-device walkthrough — owed on B135 (FSRS items + B134 carry-forward)

User has verified B135 boots and the burned-count visibly changed (positive signal). The full systematic walkthrough is still owed:

### FSRS-specific (NEW in Spec 1.5)

- [ ] **Burned count** — verified ✓ (user confirmed previously-zero burned tier now reflects months of practice)
- [ ] An **overdue** Good/Easy review (R(now) decayed past ~0.85) triggers the **quiz leg**
- [ ] A **same-day** Easy review (R(now) = 1.0) does **NOT** trigger the quiz
- [ ] **Burned-sample surprise check** still triggers a quiz (orthogonal to R signal)
- [ ] **Session Complete** "Practice breakdown" row (flashcard / writing / speaking / quiz) renders correctly
- [ ] **Kanji-detail page** shows integer day counts in the "Interval" stat (no "3.175... days" floating-point leaks)
- [ ] After a loop quiz: a `testSessions` row exists with `test_type = 'loop_check'` and matching `testResults` (Supabase SQL spot-check)
- [ ] No FSRS-related errors in App Runner logs

### B134 carry-forward — Plans A/B/C combined (originally owed on B134, now on B135)

**Plan A (minutes-budget time-box):**
- [ ] Onboarding asks "How many minutes per day?" (5/10/15/20/30, default 15)
- [ ] Profile shows "Minutes per day"
- [ ] Study session shows a live "Nm left" countdown
- [ ] Session ends after the in-progress card (never mid-card), 🎉 banner on goal met
- [ ] "Keep studying" starts a fresh timed segment
- [ ] Dashboard shows "N reviewed today" (plain count)

**Plan B (writing/speaking legs + nav):**
- [ ] Tab bar: 6 tabs (Dashboard · Study · Browse · Journal · Progress · Profile). No Write/Speak tabs
- [ ] Grade a new kanji → writing leg → "Continue to speaking" → speaking leg → advances
- [ ] Grade a review kanji Again/Hard → routes through writing → speaking
- [ ] Time-remaining indicator shows on leg headers; session ends only after a kanji's full path
- [ ] "Drill Weak Spots" / "Drill missed cards" stay flashcard-only
- [ ] Heavy-review account: session surfaces some new kanji near the start (guaranteed allowance)

**Plan C (Ready screen, quiz/vocab/breakdown):**
- [ ] Study tab opens to the Ready screen (today's minutes + due count + Begin)
- [ ] Unflagged Good/Easy → advances (no quiz)
- [ ] Speaking leg shows vocab-word layout (vocab + pitch reading) for kanji with example vocab; legacy kanji-reading layout otherwise

### B133 carry-forward (still relevant)

- [ ] App Runner logs: one `[Internal] Daily reminder job triggered` per hour, no `[Cron] Running hourly reminder check`; one daily-reminder push, no duplicate
- [ ] Study speaker icon un-sticks (Item 6)
- [ ] Empty-transcript hint on Speaking (Item 7)
- [ ] Reported Speak vocab words pass (Bug A)

---

## Spec 1.5 — executed this session (recap)

Spec: [`docs/superpowers/specs/2026-05-22-fsrs-migration-design.md`](superpowers/specs/2026-05-22-fsrs-migration-design.md)
Plan: [`docs/superpowers/plans/2026-05-22-fsrs-migration.md`](superpowers/plans/2026-05-22-fsrs-migration.md)
Runbook: [`docs/superpowers/runbooks/2026-05-22-fsrs-rollout.md`](superpowers/runbooks/2026-05-22-fsrs-rollout.md)

Branch `spec-1.5-fsrs-migration` (deleted post-merge), worktree removed. 15 commits on `main`:

1. **`1561714`** — Task 1: FSRS-5 types + pure helpers (`FsrsCard`, `ratingFromQuality`, `statusFromStability`, `retrievability`). Adds vitest to `packages/shared` for the first time.
2. **`6b98af7`** — Task 2: `calculateNextReview` + `createNewCard` (hand-rolled FSRS-5 math, 28/28 unit tests pass).
3. **`cb662e9`** — Task 2 review fixes (corrected misleading `FACTOR` comment; added inline "DELIBERATE DIVERGENCES FROM CANONICAL FSRS-5" doc-block).
4. **`75644b1`** — Task 3: schema migration `0024` (drop `ease_factor`/`interval`/`repetitions`; add `stability`/`difficulty`/`lapses`/`total_reviews`).
5. **`3b9d423`** — Task 4: replay script (`scripts/replay-srs-fsrs.mjs`).
6. **`02e3535`** — Task 5: `submitReview` rewire.
7. **`ee8381e`** — Task 6: `getReviewQueue` + `getReadingQueue` rewire. **Eliminates the unbounded `reviewLogs` fetch** that was on the housekeeping queue as a perf follow-up (R-based predicate, no per-card log fetch).
8. **`037e99f`** — Task 7: `dual-write.service.ts` rewire (typecheck-restoring commit).
9. **`3112ba2`** — Task 8: touch-point sweep (`cron.ts`, `placement.service.ts`, `kanji.ts` route) + **amended migration `0024`** to drop+recreate `kanji_mastery_view` (it referenced the dropped `interval` column).
10. **`65e6278`** — Task 8 polish: round `srsInterval` for kanji-detail display (no floating-point days).
11. **`e3573cd`** — Task 9: 5 integration tests pinning the R-based `maybeSlipping` predicate.
12. **`77921c7`** — Task 10: rollout runbook.
13. **`9af2b83`** — final-review fixes: (a) replay `ON CONFLICT ON CONSTRAINT` → `ON CONFLICT (user_id, kanji_id)` (the named ref was a unique INDEX, not a constraint — would have crashed the live UPSERT), (b) `placement.service.ts` writes `lastReviewedAt` so the next review doesn't take the first-review branch and reset stability, (c) `isSlipping` fallback `?? 1` → `?? 0`.
14. **`08a85bf`** — clone-rehearsal-found fixes: (a) replay honors `sslmode=disable` for local DBs; (b) replay auto-refreshes `kanji_mastery_view` at end (the migration populates the view inside its transaction when stability is still default 0 — without the refresh `interval_days` is 0 everywhere).
15. **`9f5357d`** — runbook: explicit merge-after-rehearsal step + "Rehearsal findings" section.

**Verified at merge time:** workspace typecheck clean modulo known pre-existing `social-mute.test.ts:25` · API 235/235 · shared 28/28.

### Clone-rehearsal results (pre-merge)

Run against a fresh `pg_dump` of live DB restored into a local Postgres clone:
- 4 users / 742 progress rows / 2857 review_logs / 2294 kanji
- Replay finished in ~1 second
- Spot-check (5 kanji from user `6d6c500a`): all match dry-run output to 2 decimal places
- Idempotency: second replay produces identical state
- Status distribution after replay: learning=78, reviewing=107, remembered=383, burned=174 (matches live post-rollout exactly)

### Live rollout sequence (today, 2026-05-23)

| Step | Result |
|---|---|
| Safety dump (5.5MB pg_dump from live) | ✅ (removed post-verification) |
| Migration 0024 → live DB | ✅ committed cleanly |
| Replay against live DB | ✅ 742 cards in ~2 min cross-region |
| Spot-check vs rehearsal | ✅ 5/5 match exactly |
| `./scripts/deploy-api.sh` | ✅ image pushed, App Runner SUCCEEDED |
| API smoke | ✅ |
| `eas build --platform ios --profile production` | ✅ B135 |
| `eas submit --platform ios --latest` | ✅ submission `6f063489-76ce-43c8-ba41-3f764d9322bb` |

### Spec 1.5 follow-ups (Spec 2 territory)

Captured in the runbook for future cleanup:

1. **Orphan `UserKanjiProgress` interface** at `packages/shared/src/types.ts:36-48` still carries SM-2 fields. Zero consumers. Delete in cleanup.
2. **`srsEaseFactor` field-name footgun.** `apps/api/src/routes/kanji.ts` and mobile both type a field called `srsEaseFactor` but the value is now FSRS `difficulty` (1–10 absolute, not 1.3–2.5 multiplier). Field is typed but never rendered. Either rename to `srsDifficulty` (coordinated mobile + API change) or drop entirely.
3. **FSRS-5 fidelity sweep.** `packages/shared/src/srs.ts` has four documented deliberate divergences from canonical FSRS-5 (exponential R, no linear damping, mean-reversion-toward-Good, post-update D in `(11-D)`). First-review matches ts-fsrs to 8 decimals; subsequent reviews diverge ~20–28%. Revisit if community benchmarks or per-user parameter fitting ever matter.
4. **Pre-existing `social-mute.test.ts:25` typecheck error** — unrelated to migration, only remaining `pnpm typecheck` failure on `main`. Roll into a housekeeping pass.

---

## Spec 1 (Plans A/B/C) — shipped earlier (recap)

- **Plan A** (`def0009`) — daily goal became a minutes budget; the study session is time-boxed. Migration `0023` reinterpreted `daily_goal` as minutes (applied to the live DB 2026-05-18).
- **Plan B** (`7244317`…`da1b303`) — the writing/speaking loop legs; the Write & Speak tabs removed; the guaranteed new-kanji allowance (`planQueueSlots`).
- **Plan C** (`bcc0133`…`1120dab`) — Practice Loop quiz & close-out: maybeSlipping flag, quiz leg, Ready screen, vocab-word speaking layout, Session Complete modality breakdown, Browse promoted to a tab.

**Carry-forward Plan C follow-ups still relevant:**
- **Stale `study.tsx` file-header comment** — cosmetic doc drift; still not addressed.
- **Accessibility a11y debt** — leg close buttons / loading spinners need `accessibilityLabel`; `Ionicons name={icon as any}` is repeated. Still pending app-wide a11y pass.
- **Resume edge case (accepted v1 limitation)** — app kill mid-quiz/writing/speaking resumes past that kanji and skips its remaining legs.

**Plan A/B WCAG carry-forward:** `colors.textMuted` on the dark background is ~3.86:1 vs AA 4.5:1 for 12px caption text. Rolls into the app-wide a11y pass.

**Plan C follow-up now MOOT:** ~~Unbounded `reviewLogs` fetch in `maybeSlipping`~~ — eliminated by Spec 1.5 Task 6 (R-based predicate operates on already-loaded card state; no per-card log fetch).

---

## Working tree — housekeeping queue (carry-forward)

Untracked items in the main checkout. Still need eyeball decisions:

| Item | Recommendation |
|---|---|
| ~~`.claude/worktrees/`~~ | ✅ gitignored. |
| `apps/lambda/daily-reminders/daily-reminders.zip` | gitignore (build artifact) |
| `apps/mobile/credentials.json` | **gitignore IMMEDIATELY if it contains secrets** — verify content first |
| `apps/watch/KanjiLearnWatch.xcodeproj/xcshareddata/` | gitignore (Xcode personal prefs) |
| `KanjiBuddyEnamel.jpg`, `KanjiBuddyMonkey.jpeg`, `KanjiBuddyMonkey.html`, `KanjiBuddyMonkey_files/` | Move to `apps/mobile/assets/branding/` (or `docs/branding/`) before the rebrand |
| `tooclose.jpg` | If a reference screenshot, move to `docs/branding/references/`; else delete |
| `app.json`, `eas.json` (repo root, not `apps/mobile/`) | Likely orphaned from an earlier prebuild — inspect → delete |
| `docs/superpowers/mockups/` | Inspect → commit if useful |
| `docs/superpowers/plans/2026-04-*.md` (7 files) | **Commit all** — executed session plans, belong on `main` as history |
| `docs/openbrain-migration-thoughts.md` | Open Brain migration record — keep (commit to `docs/`) or delete; harmless |
| `docs/b134-verification-checklist.md` | Generated this session; was used for B134 walkthrough; can commit or delete |

`.superpowers/` (visual-companion brainstorm scratch) is already gitignored.

---

## Pre-launch infra checklist

| | Item | Status |
|---|---|---|
| ✅ | Apply migration `0023` (Plan A) to the live DB | done 2026-05-18 |
| ✅ | Push `main` to `origin` (Spec 1) | done 2026-05-21 |
| ✅ | Deploy API for Spec 1 (Plans A/B/C) | done 2026-05-21 |
| ✅ | Cut + submit B134 to TestFlight (Spec 1) | done 2026-05-21 |
| ✅ | **Apply migration `0024` (Spec 1.5) to the live DB** | done 2026-05-23 |
| ✅ | **Run FSRS replay against live DB** | done 2026-05-23 |
| ✅ | **Deploy API for Spec 1.5** | done 2026-05-23, op `3f6c157cd008489e8ac85778cf893eda` SUCCEEDED |
| ✅ | **Cut + submit B135 to TestFlight (Spec 1.5)** | done 2026-05-23 — verified on-device |
| 🚀 | On-device walkthrough on B135 (Spec 1 + Spec 1.5 combined) | partial — burned count verified; full systematic checklist still owed |
| 🚀 | Secrets rotation + SSM Parameter Store migration | 7 keys still owed |
| 🚀 | Migrate Supabase DB `ap-southeast-2` → `us-east-1` | Cross-region tax; dedicated session |
| 🚀 | SES out of sandbox | Needed for tutor-share email at scale |
| 🚀 | Revert testing-phase flags | `EXPO_PUBLIC_DEV_TOOLS=1` (in `eas.json` production profile) + the 2h study-mate alert cap |

---

## Other open follow-ups

- ~~**Bound the `maybeSlipping` `reviewLogs` query**~~ — MOOT (eliminated by Spec 1.5 Task 6).
- **Orphan `UserKanjiProgress` interface in `packages/shared/src/types.ts`** — Spec 1.5 follow-up #1.
- **`srsEaseFactor` field-name footgun** — Spec 1.5 follow-up #2.
- **FSRS-5 fidelity sweep** — Spec 1.5 follow-up #3.
- **Orphaned `writing-queue` API code** — `GET /v1/review/writing-queue` + `getWritingQueue()` were used only by the deleted Write tab. Dead code (the *reading-queue* side is in use by Plan C's SpeakingLeg — keep it). A background task was spawned.
- **Truncated kanji readings** — `kanji.kun_readings`/`on_readings` capped at ~5 sorted entries; re-import full KanjiDic2 readings.
- **The "Kanji Buddy 1.0" rebrand** — rename Kanji Learn → Kanji Buddy, splash polish, About/Credits branding. Needs a brand-decision block first.
- **Tutor report writing scope-down** — the report still surfaces a Writing modality; Study no longer serves standalone writing prompts (writing is a loop leg). `getWriting` + `weakestModality` in the tutor report need scoping/removal. (Spec 2 territory.)
- **Phase 3 #13 — Milestones panel refactor** — spec captured earlier.
- **`interventions.payload` double-encoded** — stored double-encoded jsonb (a Drizzle/postgres-js quirk); harmless to the JS round-trip but breaks SQL-side payload queries.
- **App-wide accessibility pass** — touch targets / `accessibilityLabel`s, plus the `textMuted` contrast debt. Warrants its own task given WCAG 2.1 AA standard.
- **Pre-existing `social-mute.test.ts:25` typecheck error** — Spec 1.5 follow-up #4.

---

## Working environment notes

- **Prod API:** `https://73x3fcaaze.us-east-1.awsapprunner.com`. Spec 1.5 FSRS code is live as of 2026-05-23.
- **Supabase:** still `ap-southeast-2`. Migration files in `packages/db/supabase/migrations/` (`0001`–`0024`). `0024` (FSRS) applied to live DB 2026-05-23 via `psql -f`.
- **Docker / API deploy:** `./scripts/deploy-api.sh` from repo root. Builds + pushes the image to ECR and triggers an App Runner deployment. Returns immediately; monitor rollout via the App Runner console or `aws apprunner list-operations`.
- **EAS builds:** from `apps/mobile/`, ~$2/build. `eas build --platform ios --profile production --non-interactive`. EAS auto-bumps `ios.buildNumber` — **never hand-edit `app.json`** (it tracks the LAST shipped build; EAS bumps to +1 server-side). Submit with `eas submit --platform ios --latest --non-interactive`. Apple processing follows (~5–10 min from submit).
- **Watch builds:** **manual Xcode rebuild only** — EAS does not build the watchOS target. Spec 1.5 was API-only; no Watch rebuild required.
- **FSRS replay script:** `scripts/replay-srs-fsrs.mjs`. Run via `./packages/db/node_modules/.bin/tsx scripts/replay-srs-fsrs.mjs` (or `node --import tsx/esm ...`). Honors `sslmode=disable` for local rehearsal DBs; defaults to `ssl: 'require'` for Supabase. Idempotent. Auto-refreshes `kanji_mastery_view` at end. `--dry-run` and `--user <uuid>` flags supported.
- **Clone-rehearsal pattern:** for any future destructive migration, the FSRS rollout established the pattern — fresh `pg_dump` of live → restore to local Docker Postgres → apply migration → run replay/backfill → spot-check → merge to main → live rollout. The runbook at `docs/superpowers/runbooks/2026-05-22-fsrs-rollout.md` documents it explicitly.
- **Worktrees:** `.claude/worktrees/` is the Claude Code scratch-worktree location (gitignored). Spec 1.5 was executed in `.claude/worktrees/spec-1.5-fsrs-migration` (now removed, fast-forward-merged to main).
- **Co-author convention:** every kanji-learn commit includes `Co-Authored-By: Robert A. Dennis (Buddy)` alongside the Claude co-author line.
