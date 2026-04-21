# Session Handoff — 2026-04-20

## TL;DR

Build 3-C is shipped in full (Phases 1–4) and B126 UX polish is in flight to TestFlight. The next session's work is on-device verification of B126, Phase 5 tracker hygiene, and — when you have the window — rotating the seven exposed secrets that accumulated across this sprint.

## Current state

- **Branch:** `main`.
- **TestFlight builds this session:**
  - **B125** — Build 3-C Phase 4 (mobile vocab-drill + pitch overlay). Build ID `f027ab70-823e-4143-b15c-7f8d62105358`. User verified most surfaces; the pitch overlay itself rendered with invisible text (contrast bug), which drove B126.
  - **B126** — UX polish bundle. Build ID `24bc4061-b0f1-4e43-91c2-96b0c5292b7b`. Submission ID `a8da4420-9c13-4404-855c-bb3350384411`. Fixes contrast + daily-goal progress + flash-race + study-card vocab speak icons + Kanjidic2 refs on details page.
- **API deploys this session:**
  - `03b663dd…` — toArr defense on kanji routes (radicals repair).
  - `fed113f85b…` — Groq + Gemini env vars injected.
  - `53710d9b…` + `e24febc1…` — Build 3-C Phase 1 (homophone workaround).
  - `24f17892…` — Build 3-C Phase 3 (`voicePrompt` + `showPitchAccent` PATCH).
  - `4df7047c…` — B126 `/v1/kanji/:id` extension (grade, frequencyRank, hadamitzkySpahn).
- **Prod API URL:** `https://73x3fcaaze.us-east-1.awsapprunner.com` — health HTTP 200 as of 420ms.
- **DB migrations shipped this session (prod):** 0017 (auth cascade FK), 0018 (RLS on last 5 tables — 35/35 coverage), 0019 (kanji Kanjidic2 refs), 0020 (`user_profiles.show_pitch_accent`).

---

## What shipped today

### Build 3-C — all phases complete

Plan: [docs/superpowers/plans/2026-04-19-vocab-as-drill-unit.md](superpowers/plans/2026-04-19-vocab-as-drill-unit.md). Spec: [docs/superpowers/specs/2026-04-19-vocab-as-drill-unit-design.md](superpowers/specs/2026-04-19-vocab-as-drill-unit-design.md).

- **Phase 1** (server homophone workaround): 9 commits on main. In-memory kanji→readings index loaded at API boot; evaluator expands CJK transcripts through the index. Verified on B124: `缶` transcript for `感` now grades Perfect. 109/109 unit tests.
- **Phase 2** (data layer): 9 commits. Migrations 0019 + 0020 applied to prod. Vocab seed expanded (5-entry target, self-containment validator closed B4), Tatoeba cap raised to 5, Kanjium pitch merge. Two jsonb double-encoding seed bugs discovered and fixed mid-run. Prod state: 99.9% of kanji meet 3-entry vocab floor; `grade` 99.2%, `frequency_rank` 93.8%, `hadamitzky_spahn` 98.3% populated; 8,053 vocab entries carry `pitchPattern` (~75% of accepted entries).
- **Phase 3** (API contract): 3 commits. `/v1/review/reading-queue` now attaches `voicePrompt` per item (round-robin by `repetitions`, not `reviewCount` — plan deviation, the spec column doesn't exist). `showPitchAccent` accepted in PATCH `/v1/user/profile`. `VoicePrompt` type exported from `@kanji-learn/shared`.
- **Phase 4** (mobile): 8 commits. Pure helpers (`mora-alignment`, `PitchAccentReading`, `useShowPitchAccent`) + UI integration (VoiceEvaluator vocab layout, kanji details pitch chip, study-card pitch overlay, Profile tab toggle, placement-level default). Plan deviations documented in each commit (single-source-of-truth hook, `voice.tsx` consumer, Pitch chip on details page not KanjiCard, placement test supplies level not an onboarding picker). Shipped in **B125**.

### B126 UX polish bundle

Plan: [docs/superpowers/plans/2026-04-20-b126-ux-polish-bundle.md](superpowers/plans/2026-04-20-b126-ux-polish-bundle.md). Spec: [docs/superpowers/specs/2026-04-20-daily-goal-celebration-design.md](superpowers/specs/2026-04-20-daily-goal-celebration-design.md).

11 tasks executed via subagent-driven-development. Code-review pass caught two real issues (mid-file import, stale-closure on `analyticsSummary`); both fixed.

| Commit | Change |
|---|---|
| `a704ad2` | fix(mobile): PitchAccentReading explicit textPrimary colour (WCAG AA) |
| `23941b5` | feat(api): extend /v1/kanji/:id with Kanjidic2 reference fields |
| `7a1d25f` + `5e9db98` | feat(mobile): didCrossGoal helper for daily-goal celebration |
| `003ec81` | fix(mobile): review store isLoading initial true to prevent caught-up flash |
| `a50cd31` + `ab870ed` | feat(mobile): daily-goal celebration banner + analyticsSummary ref |
| `9f74917` | feat(mobile): Dashboard daily-goal progress indicator |
| `e5e349f` | feat(mobile): speak icons on study-card reveal vocab rows |
| `8592a7a` | feat(mobile): KanjiDetail type + formatGrade for Kanjidic2 refs |
| `d0247f1` | feat(mobile): surface Kyōiku grade + frequency + Hadamitzky-Spahn on details page |
| `dda6d79` | docs: log B126 fixes in trackers |
| `065ff23` | docs(handoff): B126 EAS build submitted |

### Session Complete rebalance + dailyGoal race fix

Plan: [docs/superpowers/plans/2026-04-20-session-complete-feedback-rebalance.md](superpowers/plans/2026-04-20-session-complete-feedback-rebalance.md). Spec: [docs/superpowers/specs/2026-04-20-session-complete-feedback-rebalance-design.md](superpowers/specs/2026-04-20-session-complete-feedback-rebalance-design.md).

All-Good sessions now render green "Solid — consistent recall" at 67% instead of amber "Decent effort — review the misses". Study screen's `useEffect` now gates on `profile` so `dailyGoal` isn't read as its 20 fallback. Shipped in B125. User confirmed the new bands + copy on-device.

### Documentation landed this session

- **New feedback memories:** secret hygiene (never dump plaintext to transcript), accessibility WCAG 2.1 AA (explicit theme color on every Text/icon), commit co-author attribution (Buddy added as co-author on every commit).
- **ROADMAP + ENHANCEMENTS entries:** Three-Modality Learning Loop (owner-proposed post-Build-3-C initiative), Dark/Light theme toggle (annotated with the WCAG accent-color problem), Secrets Management (rewritten around SSM Parameter Store instead of Secrets Manager).
- **Specs and plans:** four new artifacts under `docs/superpowers/` — the Build 3-C design/plan from yesterday, the Session Complete rebalance, and the B126 bundle.

---

## ⚠️ Security actions owed (unchanged from earlier in the session)

Seven keys exposed through this sprint, pending rotation. Buddy will rotate at end of day / when convenient; Claude does not touch the values.

| Key | Regenerate |
|---|---|
| `GROQ_API_KEY` | https://console.groq.com/keys |
| `GEMINI_API_KEY` | https://aistudio.google.com/app/apikey |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys (also update local `packages/db/.env`) |
| `DATABASE_URL` password | Supabase → Database → Reset password |
| `INTERNAL_SECRET` | `openssl rand -hex 32` locally |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API → service_role → Regenerate |
| `SUPABASE_JWT_SECRET` | Supabase → API → JWT Secret → Generate new secret ⚠️ **kicks all testers off — defer until ready** |

**Rotation flow:** Buddy regenerates in provider consoles → updates values in `apprunner-env.json` in his own terminal → runs `aws apprunner update-service` himself → pings Claude. Claude then runs health check + provider-exercising smoke calls.

**Long-term fix** tracked under ROADMAP + ENHANCEMENTS "Secrets Management — SSM Parameter Store" with full migration plan.

---

## 🧪 On-device verification checklist for B126

When TestFlight delivers B126 (typically 20–40 min end to end):

**Pitch overlay (contrast regression — main B126 driver):**
- [ ] Study card reveal: vocab reading shows readable kana with amber overline + drop hook (was invisible in B125).
- [ ] Kanji details page vocab rows: same, at `size="small"`.
- [ ] VoiceEvaluator vocab prompt: same, at `size="large"`.
- [ ] Pitch toggle chip on kanji details flips all three surfaces atomically.

**Daily-goal UX:**
- [ ] Dashboard under "Start Today's Reviews" shows `N / M today`; green checkmark appears when N ≥ M.
- [ ] Finishing the session that crosses the goal for the first time that day renders the 🎉 "Daily goal met — nice work." banner above the confidence ring.
- [ ] Subsequent sessions that day do NOT render the banner again.
- [ ] Burned-kanji message still takes precedence when both would apply.

**Flash-race fix:**
- [ ] Background app 10+ min, cold-open Study tab. Should show loading spinner briefly, then cards. No "All caught up!" flash.

**Study-card vocab speak icons:**
- [ ] Reveal a study card with example vocab. Each vocab row shows a speak icon. Tapping plays TTS; icon state cycles `volume-medium-outline → volume-high → back` as it plays. Tapping a different row cancels the previous playback.

**Kanjidic2 references on kanji details:**
- [ ] Open `水` (or any common elementary kanji): Cross-references card shows `Kyōiku Grade 1`, `Frequency #{small}`, `Hadamitzky-Spahn #{small}` alongside JIS / Nelson / Morohashi.
- [ ] Open `憂` (or any JHS-only Jōyō): Kyōiku Grade reads `Junior High`.
- [ ] Open `倖` (Jinmeiyō): Kyōiku Grade reads `Jinmeiyō`; Frequency row absent (Jinmeiyō kanji rarely in the 2,500-frequency corpus).

**Outstanding from B124/B125 that B126 does not change:**
- [ ] Amber reading-prompt cue (should show on a reading-stage card). Still unverified — the code path lands via `colors.accent`. Close the amber-cue ENHANCEMENTS entry after confirmation.

---

## 🚦 Next-session first tasks

1. **Verify B126 on device** using the checklist above.
2. **Close Build 3-C Phase 5** tracker items once B126 verification passes: flip the homophone bug fully Fixed (Phase 1 workaround + Phase 4 structural shift), confirm B4 is fully closed, flip E5 / E6 / speak-icons-scope to `✅ Shipped & Verified`, and verify the amber reading-prompt cue.
3. **Rotate the 7 exposed secrets** whenever the ~10 min window opens up.
4. **(Optional)** Re-run `pnpm seed:vocab` (no `--force`) to top up the 3 kanji still below the 3-entry floor (倖, 嚇, 錬). Cost: negligible.
5. **(Optional)** File a follow-up for the timezone-sensitive "today" date string — current code uses `toISOString().slice(0, 10)` (UTC), which mis-rolls for non-UTC users in a ~7h window around midnight. Acceptable for current 2-user scale; worth cleaning up before a broader launch.

---

## Known deferred items and technical debt

- **Local iOS dev tooling is flakey.** `ios/Pods` wiped, last successful Xcode build Apr 10. Starting point: `pod install` then `pnpm ios`. Not on the critical path; track as a post-launch cleanup so Buddy can get back to a systematic dev-then-ship cycle instead of direct-to-prod builds.
- **Three-Modality Learning Loop** — owner-proposed 2026-04-20. Pedagogical gate: after each daily-goal flashcard batch, require the same kanji to be practiced in writing + speaking before the next batch unlocks. ROADMAP Phase 6 row 23 + ENHANCEMENTS Future entry. Prerequisites: reliable writing eval audit, B125+ voice eval bake, cross-tab session state. 1–2 week scope in its own brainstorm → spec → plan cycle.
- **Integration test gap at `/v1/kanji/:id`.** Pre-existing — B126 is the first task to add fields the mobile UI depends on. A single integration assertion that the response contains `grade`, `frequencyRank`, `hadamitzkySpahn` (null OK) would protect the endpoint going forward. Not blocking.
- **`user-delete` integration test fails on `learner_identity_pkey` duplicate.** Pre-existing test-cleanup issue. Masked during Phase 3 verification; will clear with a TEST_DATABASE reset.
- **Migration 0020 applied to `TEST_DATABASE_URL` this session** — local integration tests no longer fail on the missing `show_pitch_accent` column.

---

## Working environment notes

- **Prod API:** `https://73x3fcaaze.us-east-1.awsapprunner.com`.
- **Supabase:** still in `ap-southeast-2`. Pre-launch us-east-1 migration remains pending (ENHANCEMENTS E22).
- **Docker deploys:** `DOCKER_CONTEXT=default ./scripts/deploy-api.sh` from repo root. OrbStack default context produces ARM images that crash App Runner; the script forces `linux/amd64`.
- **EAS builds:** from `apps/mobile/`. Pay-as-you-go ~$2/build (monthly credits exhausted). Require `eas-cli ≥ 18.7.0` (18.5.0 silently fails at request submission). EAS auto-bumps `ios.buildNumber`; don't hand-edit.
- **EAS env vars** with `EXPO_PUBLIC_` prefix are baked into each build. Changing Supabase URL (pre-launch E22) requires a fresh EAS build.
- **Monorepo test commands:** `pnpm exec jest` (mobile, not `pnpm test` — turborepo ate that). `pnpm test` works from repo root via Turbo and from `apps/api/` (vitest).

---

## Tomorrow's first command

```
cd /Users/rdennis/Documents/projects/kanji-learn
git pull origin main
# 1. Open TestFlight on device → install B126 if not auto-delivered yet.
# 2. Walk the on-device verification checklist above (copy/paste from the section heading).
# 3. If all pass: flip Phase 5 tracker items (homophone bug Fixed, E5/E6 Shipped & Verified, amber cue closed).
# 4. If anything regresses: queue tweaks, cut B127 (~$2) or fold into a larger change.
# 5. Rotate the 7 exposed secrets when the window opens.
```
