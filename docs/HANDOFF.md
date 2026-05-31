# Session Handoff — 2026-05-30 (Two B138 testing bugs fixed: vocab TTS reading + session-minutes cap; API deployed, mobile fix pending next cut)

## TL;DR (this session, 2026-05-30 — two B138 walkthrough bugs)

Two bugs reported from B138 testing, both root-caused (subagent fan-out + verified against code) and fixed:

**Bug 1 — vocab voice reading wrong (mobile).** Tapping the speaker icon on a vocab word (e.g. 然り) fed the **kanji surface form** `v.word` to iOS TTS, which guessed the on-reading and said "zenri" instead of しかり. The correct kana reading `v.reading` sits on the same object (used for display) but wasn't used for audio — the kun/on speaker buttons already correctly speak kana. Fixed both call sites to speak `v.reading`: [`KanjiCard.tsx:358`](../apps/mobile/src/components/study/KanjiCard.tsx) (study flashcard) + [`kanji/[id].tsx:430`](../apps/mobile/app/kanji/[id].tsx) (Browse detail). Commit `b170653`. **Mobile-only — NOT yet in TestFlight; bundle into the next EAS cut** alongside the pending softened-silver-rule shared change.

**Bug 2 — session minutes undercounted (API).** The Session Complete "Time" stat only reflected ~flashcard time, excluding writing/speaking/quiz legs. Root cause was NOT the client clock (which correctly spans all legs via a single `studyStartMs` → session-end wall-clock). It was a server-side anti-cheat cap in [`srs.service.ts:341`](../apps/api/src/services/srs.service.ts) that clamped `studyTimeMs` to `30s × results.length`, where `results` counts flashcard grades only. In the Practice Loop one flashcard grade fans out to writing/speaking/quiz legs that add real minutes but no extra `results` entries, so legitimate multi-leg sessions were crushed down to roughly flashcard-only time. The capped server value overrides the (correct) client value on Session Complete. Fix: dropped the per-item cap; kept the 60-minute hard ceiling as the runaway-clock guard (daily minutes budget already bounds normal sessions). Commit `bf0f300` + regression tests `9014aed` (2 cases in phase0-smoke: 3-min single-flashcard loop not clamped; 60-min ceiling still fires).

**Rollout this slice:**
- ✅ Both fixes committed to `main` and pushed (`b170653`, `bf0f300`, `9014aed`).
- ✅ API deployed: op `f62eb461828c40129d34611e2a2e6fdc` SUCCEEDED 2026-05-31T00:33:51Z; image `sha256:71fb7e496ba0b4000ff5f12171b39ad964345f30c5a31e7f1afcca369428bf23`. Smoke: `/health` 200, `/v1/buddy/nudges` 401. Full suite 281/281 green.
- 🚀 **Mobile (Bug 1) NOT yet in TestFlight** — bundle into the next EAS cut with the softened-silver-rule shared change. Until then, vocab TTS still says "zenri" on-device.

**Process notes (for next time):** (1) A research subagent hallucinated a non-existent `srs.service.test.ts` with a `makeDb()` mock; the first "tests pass" was the pre-existing suite — the regression test never ran. Caught by checking the vitest `include` (`test/**/*.test.ts`) and `git status`; re-added the 2 cases to the real integration file `phase0-smoke.test.ts`. (2) `submitReview` requires `responseTimeMs` on each result (NOT NULL in `review_logs`) — the first test draft omitted it and tripped a 23502. (3) A force-push to amend an already-pushed commit was (correctly) auto-denied — landed the test fix as a forward commit instead. (4) Batching sequential git/deploy commands in one parallel block caused a cascade of cancellations when the first failed — run git/deploy strictly sequentially.

---

# Session Handoff — 2026-05-26 (Softened silver rule shipped (API); B138 hot-fix in TestFlight; T15 + B138 walkthroughs + mobile rule sync pending)

## TL;DR (this session, 2026-05-26 — fourth slice: softened silver tier rule)

**Silver tier rule softened to allow long-tail reviewing stragglers.** Walkthrough finding: Buddy's 78/79 N5 mastery (98.7%) earned ZERO JLPT recognition because one card (語, next-review 11 days out) was still in `reviewing` status. The strict `learning === 0 && reviewing === 0` silver rule treats a single straggler as a hard block. Softened to `learning === 0 && reviewing <= max(1, floor(total * 0.02)) && (remembered + burned) > 0` in [`packages/shared/src/milestones/tier-rules.ts`](../packages/shared/src/milestones/tier-rules.ts) (commit `7fe82c2`). Learning gate stays strict (cards being introduced don't count toward "done"). Bronze/gold unaffected.

**Impact under live data (probed before patching):** exactly ONE new silver fires — **Buddy N5**. No existing silvers regress, no other account gains anything spurious. Probed via SQL over all 4 users + N1-N5 + G1-G9.

**Rollout this slice:**
- ✅ API deployed: op `c677b8b5ec6b4e3a98b89080c8a9775c` SUCCEEDED at ~2026-05-25 19:44 PT; image `sha256:c89367c6bed524e0c49e066672e748640bcb0d4e1984d2cf29dc00068c353ab6`. Smoke 200.
- ✅ Buddy's N5 silver written directly via `tsx LearnerStateService.refreshState` (using the local patched code against `packages/db/.env` DATABASE_URL) — milestone count 14 → 15. Entry: `{type: jlpt_level, payload: {tier: silver, level: N5}, achievedAt: "2026-05-26T02:40:12.769Z"}`. Real timestamp (not grandfathered, since existing.length > 0). NO location field (Bug B fix held — opts.location wasn't supplied to this manual refresh).
- 🚀 **Mobile (shared package) NOT yet rebuilt and shipped.** Per the bundling choice, deferred to the next mobile cut. Caveat: mobile's `computeUpNext` uses the old rule semantics from the cached shared bundle in B138 — Buddy may briefly see N5 silver in BOTH the badges row AND the "Up Next" list until B139 (or whenever the next EAS cut bundles the shared change). Cosmetic mismatch only; no data integrity issue.

**Diagnostic pattern reinforced:** before changing a rule, run a SQL impact probe across ALL users to see who gains/loses — this caught that softening would only affect Buddy N5 (zero other deltas), validating the change as low-risk and well-targeted before patching.

---

## Earlier session — 2026-05-26 (B138 hot-fix in TestFlight — grandfather-location + stale-cache bugs)

### TL;DR (2026-05-26 — third session, hot-fix B138 after walkthrough findings)

**B138 hot-fix shipped to TestFlight.** During the B137 walkthrough on the RAD account (me.com, `7c707446…`), badges didn't appear despite the DB having 3 grandfathered milestones. Diagnosis caught two real bugs in the milestones rollout, both patched and shipped as B138:

- **Bug A — stale analytics cache (mobile).** `useAnalytics` cache key `'kl:analytics_cache'` wasn't versioned. B137 added `recentMilestones` + `perGradeBuckets` to the response shape; existing users upgrading from B135/B136 get the OLD shape from local cache on first paint. The hook fetches fresh in background and overwrites — but if the fresh fetch transiently fails (network blip, expired token), the catch block leaves stale cache in place and MilestonesSection renders the "first milestone awaits" placeholder. RAD hit this; pull-to-refresh didn't unstick (silent fetch failure); force-quit + reopen did. Fix: bump key to `'kl:analytics_cache_v2'` in [`apps/mobile/src/hooks/useAnalytics.ts`](../apps/mobile/src/hooks/useAnalytics.ts). Auto-invalidates every stale cached blob on first run of B138.
- **Bug B — grandfather location attachment (API).** [`LearnerStateService.refreshState`](../apps/api/src/services/buddy/learner-state.service.ts) was attaching the current device location to ALL newly-detected milestones, including those from the grandfather pass. Grandfather entries are historical; today's coordinates are geographically meaningless on them and may leak the user's location without the intent the opt-in toggle implies ("where I earned this *now*"). Fix: gate the location attachment by `!isGrandfather` at line 175-180.

**Rollout this session (clean, no surprises):** API redeploy op `6d5fb02183884733894b60508557f22d` SUCCEEDED at ~2026-05-25 18:01 PT (image `sha256:7c6a7b495e6d041a457b2c68273e7675440987daa83a63d1f310b327c327a7aa`, no env-var change so single-deploy worked this time). B138 EAS build `5fc58b14-6fed-4f74-bc27-54dd94617c56` (buildNumber 137 → 138), submitted to TestFlight as submission `af845507-d016-44b2-8e80-eb9e001c915c`. Apple processing.

**Data cleanup applied to RAD:** the 3 grandfather entries already in RAD's `learner_state_cache.recent_milestones` were polluted with location data from the bug. One-row UPDATE stripped the `location` field from any entry where `achievedAt = 'grandfathered'`. Verified post-update: entries now contain only `type`/`threshold`/`achievedAt`.

**Buddy/gmail account still has zero milestones** in DB (its last refresh was 2026-05-25 16:20Z, PRE the milestones deploy at 23:40Z). To populate: submit one review on that account; the post-review `setImmediate` triggers `LearnerStateService.refreshState` which runs the new MilestoneDetector code and writes the grandfather entries — now without spurious location data thanks to Bug B's fix.

**Diagnostic pattern worth remembering:** when mobile renders the empty state but DB has data, the bug is almost always either (a) the API response is missing the field, or (b) the local cache is masking it. To distinguish without a JWT: use `apps/api/node_modules/.bin/tsx` to run the service code directly against `packages/db/.env`'s DATABASE_URL — proves whether the API would return the expected shape. Used here to definitively rule out the API as the cause, pointing to mobile cache.

---

## Earlier session — 2026-05-25 (Milestones panel rework shipped end-to-end + B137 in TestFlight; T15 + B137 walkthroughs pending)

### TL;DR (2026-05-25 — second session of the day)

**Milestones panel rework is fully landed on `main`, on the live DB, and in the deployed API.** The 24-task `milestones-rework` branch (28 commits, +1807/-139 across 40 files) merged into `main` via `--no-ff` merge commit `52ff639`, drizzle migrations `0012_kanji_grade_idx.sql` and `0013_user_profile_attach_location.sql` applied via `psql -f` against live Supabase, API redeployed twice (op `4f7b21c40b1541898d9960ffb434b755` SUCCEEDED with the new image; op `2f536eedd4ce4f459e7fc8eb77236dd0` SUCCEEDED with `MILESTONES_DEPLOY_CUTOFF_ISO=2026-05-25T23:50:00Z` added to the runtime env vars). Smoke: `/health` 200, `/v1/buddy/nudges` 401. Pre-migration safety dump at `/tmp/buddy-milestones-safety/live-20260525-2329.sql` (5.8M; delete after 24h stability).

**Mobile B137 cut and submitted to TestFlight** — build `aa732953-22e3-49d5-bceb-7e681f04dbe8`, submission `44850bda-5e24-42d2-a7c8-6e1557f35415`, Apple processing 5–10 min from submit. Bundled four items: (a) MilestonesSection UI (badges + UpNext + date sheet, wired into Progress tab), (b) Profile "Attach location to milestones" toggle (opt-in, default OFF), (c) BuddyCard placement refinement (moved up under Drill Weak Spots, now mounts outside the `summary?` conditional so it renders independently of the dashboard summary fetch), (d) Velocity-card copy patch ("Start burning kanji to see a projection" → "Projection coming soon"). EAS auto-bumped `app.json ios.buildNumber` 136 → 137. Real Velocity-projection rework is parked as a real priority — see [[velocity-projections-priority]] in memory; operator framed projections as a major motivator, not nice-to-have.

**Two-deploy rollout footgun, document for next time:** [`scripts/deploy-api.sh:24`](../scripts/deploy-api.sh:24) uses `APPRUNNER_SERVICE_ARN="${APPRUNNER_SERVICE_ARN:-…}"` (colon-dash). An empty-string override does NOT skip `start-deployment` — bash treats empty as "use the default". Result this session: the build/push step also triggered a deploy of the new image with OLD env vars (no `MILESTONES_DEPLOY_CUTOFF_ISO`), requiring a corrective second deploy via `update-service`. Future fix options: (i) edit the script to `${VAR-…}` (no colon), OR (ii) when bundling env-var changes with a deploy, run `aws apprunner update-service` BEFORE `deploy-api.sh` so the old image accepts the new env var first.

**Practical impact of the gap:** effectively zero. The default `MILESTONES_DEPLOY_CUTOFF_ISO` fallback (`2026-05-25T00:00:00Z`, hardcoded in [`apps/api/src/services/milestones/detector.ts:103-104`](../apps/api/src/services/milestones/detector.ts:103)) still grandfathers all 4 existing users because their `user_kanji_progress.createdAt` rows predate today. Only a user whose first-ever SRS activity landed strictly after UTC midnight today would have been mis-grandfathered, and the corrected cutoff (`23:50:00Z`) was set ~9 min after the second deploy completed (`23:40:59Z`), so any real activity is covered.

**Side observation — Supabase PG log noise:** a `relation "supabase_migrations.schema_migrations" does not exist` notice fired at ~23:31 UTC. Confirmed harmless. That schema isn't created in this project — you apply migrations via raw `psql -f`, not via Supabase CLI — so any client that queries it (pg_dump introspection, Supabase Studio Migrations panel) logs this. No action taken; leaving as log noise. To silence: `CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);` — but creating an empty table risks confusing the Supabase CLI if you ever adopt it later.

**Closeout doc for milestones still owed.** No `docs/superpowers/findings/2026-05-25-milestones-panel-rework.md` was written; the 24-task plan's checkboxes were also never ticked. Worth backfilling for HANDOFF continuity (one short findings doc summarizing what shipped + the deploy footgun above).

---

## Earlier session — 2026-05-25 (Phase 1' shipped — B136 in TestFlight; T15 on-device walkthrough still pending)

**Phase 1' is shipped, end-to-end.** Migration 0025 applied to live; API deployed twice (first rollback on a runtime import bug, second SUCCEEDED at op `c955bd8cb5f64cbab032e24df83c4c00`); B136 EAS build cut and submitted to TestFlight (build `f5b04f00-1799-41f7-aafe-6b99f39bf104`; submission `f58e6982-156d-4635-9d04-52679a6b1114`). What's left is T15 — the on-device walkthrough on B136 and the closeout findings doc. Once that's done the next slice per the refresh doc §9 ordering is Phase 5 (Contextual Mnemonic Co-Creation — the signature feature).

**Phase 1' executed via `superpowers:subagent-driven-development`** — fresh subagent per task, two-stage spec + quality review after each, then a final integration review across the whole diff. The pattern caught two production bugs that per-task reviews would have shipped silently:

1. **jsonb double-encoding (storage-layer)** — drizzle's `PgJsonb.mapToDriverValue` calls `JSON.stringify(value)`, then postgres-js's jsonb serializer calls `JSON.stringify` on what it received. Result: `actionPayload: { kind: 'meet_buddy' }` was stored as `"{\"kind\":\"meet_buddy\"}"` (a JSON-encoded string). SQL-side `->>` returns NULL on a string, so the partial unique indexes from migration 0025 never enforced. Round-trips via JS appeared to work (mapFromDriverValue JSON.parses), masking the bug. Fixed globally with a one-line `PgJsonb.prototype.mapToDriverValue = v => v` override in [`packages/db/src/client.ts`](packages/db/src/client.ts) (commit `f1d111b`). Side-benefit: closes the long-standing `interventions.payload` double-encoded note from prior HANDOFFs for new writes.

2. **GET envelope mismatch (caught by final review only)** — `/v1/buddy/nudges` initially returned `{ data: nudges }`; the mobile ApiClient throws on `!json.ok`. Every BuddyCard would have been invisible in production. Fixed to `{ ok: true, data: nudges }` with a regression-catching test assertion (commit `b0a37d4`).

**Other notable in-flight discoveries:**
- Drizzle's `.onConflictDoNothing({ target })` only accepts PgColumn refs — can't target migration 0025's partial unique indexes whose targets are SQL expressions (`action_payload->>'milestone'`). Fix: typed `isUniqueViolation(err)` helper using `instanceof PostgresError && code === '23505'`. Re-routed `PostgresError` through `@kanji-learn/db` because `apps/api/node_modules` doesn't contain `postgres` at runtime even though it's a declared dep (this was the cause of the first deploy's rollback).
- `BuddyNotifier` port interface extracted to drop 7 `as any` casts from the test files.
- T8 introduced a stealth typecheck regression — `useFocusEffect` was imported from `@react-navigation/native` (not a project dep). The project uses `expo-router`. Caught in T9's typecheck run, fixed in commit `9134db9`.

**Final pre-ship review** (Opus, full Phase 1' diff): "Ship with one Critical fix" — addressed before deploy.

**B137 refinement queued and Velocity-card bug filed.** Operator feedback during the B136 walkthrough flagged a placement adjustment (BuddyCard up under Drill Weak Spots) — captured in [`docs/superpowers/findings/2026-05-25-b137-refinements.md`](superpowers/findings/2026-05-25-b137-refinements.md). Separate find: the Velocity card on Dashboard still shows "Start burning kanji to see a projection" despite the operator having 174 burned cards post-Spec-1.5 — copy assumed the pre-FSRS unreachable-burned state. Filed into [`docs/superpowers/plans/2026-05-25-milestones-panel-rework.md`](superpowers/plans/2026-05-25-milestones-panel-rework.md) under "Related Dashboard fixes (file while in the area)" so the Milestones session picks it up while doing adjacent UI work.

---

## Prior session — 2026-05-23 (Spec 1.5 FSRS migration shipped — B135 in TestFlight)

**Spec 1.5 (FSRS migration) is fully landed — on `main`, on the live DB, in the deployed API, and in TestFlight as B135.** 15 commits from `1561714`…`9f5357d` replaced the SM-2 scheduler with hand-rolled FSRS-5, swapped the schema (migration 0024), and seeded existing card state via a one-time replay. Live rollout sequence: safety dump → migration 0024 applied → replay walked 4 users / 742 progress rows / 2857 review_logs in ~2 min → App Runner op `3f6c157cd008489e8ac85778cf893eda` SUCCEEDED → B135 submitted to TestFlight (`6f063489-76ce-43c8-ba41-3f764d9322bb`). B135 is in TestFlight and verified working on-device.

**Side-benefit confirmed on-device:** under SM-2, the "burned" status was effectively unreachable (interval reset to 1 day on every Hard/Again). After replay, **174/742 cards (23%) correctly sit in burned**, matching the user's subjective experience of months of daily use without ever burning a kanji.

**Carry-forward verification owed on B135:** the combined Plans A/B/C walkthrough was originally owed on B134; B135 absorbs it (and adds FSRS-specific items). See the walkthrough section below.

## Current state

- **Branch:** `main` at `52ff639` (the milestones-rework merge commit), fully pushed to `origin`. Working tree: same housekeeping queue as prior sessions (no new untracked items resolved).
- **Latest on `main` (this session, 2026-05-25 — second session):**
  - `52ff639` — `Merge branch 'milestones-rework'` (28 commits + merge; shared milestones types/ladders/tier rules + selection helpers, drizzle migrations 0012/0013, MilestoneDetector with numeric/JLPT/Grade tiers and gating, per-grade & per-JLPT bucket queries, hasPreDeployHistory grandfather pass, LearnerStateService refresh integration, recentMilestones+perGradeBuckets in analytics summary, mobile Milestone/Grade badge components, CoreBadgesRow/GradeBadgesRow, UpNextList, MilestoneDateSheet, MilestonesSection orchestrator wired into Progress tab, bronze/silver/gold theme tokens, Profile "Attach location to milestones" opt-in, tryGetCoordsForCapture helper, mobile→server wiring for optional coords). Merged cleanly on top of Phase 1' fixes; the merged tree also clears the long-standing `social-mute.test.ts:25` typecheck error (the fix was on `main` via `7ccfe32`, not on the branch).
- **Recent `main` history (earlier today's session — Phase 1', 22 commits in order):**
  - **Phase 1' T4** (test coverage + bug fixes caught by tests): `f1d111b` (jsonb storage-layer fix) → `8db3854` (23505 try/catch in NudgeService) → `1946de4` (T4 tests) → `ee2911e` (typed PostgresError + isUniqueViolation helper, T4 review-fix)
  - **Phase 1' T5** (API routes): `60cc638` (routes + wiring) → `cf51a0a` (envelope + preHandler array, T5 review-fix)
  - **Phase 1' T6** (push method): `f016dcc` (sendBuddyNudgePush) → `ae29d5b` (notificationsEnabled + sound, T6 review-fix)
  - **Phase 1' T7** (setImmediate wiring): `2b00e3c` (4th SrsService arg + 6 callsites) → `e18265c` (BuddyNotifier port extraction, T7 review-fix)
  - **Phase 1' T8** (mobile hook): `838e9b8` (useBuddyNudges) → `9813a90` (drop double-fetch + clarify dismiss posture, T8 review-fix)
  - **Phase 1' T9** (components): `ef68cd8` (BuddyCard + BuddyCardStack) → `9134db9` (T8 retroactive: useFocusEffect from expo-router, not @react-navigation/native)
  - **Phase 1' T10-12** (surface mounts): `2a416c7` (Dashboard / Study Ready / Progress, bundled commit)
  - **Final pre-ship review fixes:** `b0a37d4` (Critical envelope `ok:true` + Important width + a11y role)
  - **Operator T13 + T14:** (no new commits for T13; database-only) → `6846822` (PostgresError import fix, deploy-rollback recovery) → `1d793f3` (record EAS-bumped buildNumber 136)
  - **Post-ship docs:** `4820559` (file B137 refinement + Velocity-projection bug)
  - (Two parallel docs commits from the operator's separate Milestones-rework work landed mid-session: `12f1a50` and `5684527` — unrelated to Phase 1')
- **Live DB (Supabase ap-southeast-2):** drizzle migrations `0012_kanji_grade_idx.sql` and `0013_user_profile_attach_location.sql` applied 2026-05-25 via `psql -f` (later session). Pre-migration safety dump at `/tmp/buddy-milestones-safety/live-20260525-2329.sql` (5.8M; delete after 24h stability). Verified: `kanji_grade_idx` present on `kanji`; `user_profiles.attach_location_to_milestones boolean DEFAULT false NOT NULL` column present. Earlier today: migration `0025_buddy_nudges_dedupe_indexes.sql` applied (Phase 1') — pre-migration safety dump at `/tmp/buddy-phase1-safety/live-20260525-1138.sql` (5.7M).
- **API:** Currently running op `2f536eedd4ce4f459e7fc8eb77236dd0` SUCCEEDED at ~2026-05-25 16:40 PT (23:40 UTC) — image `sha256:266a01a254cae1004754a9f92cde19d30523c355a9c87a3bc32a80a7e9d5bc06` with 17 env vars including `MILESTONES_DEPLOY_CUTOFF_ISO=2026-05-25T23:50:00Z`. Smoke: `/health` 200, `/v1/buddy/nudges?screen=dashboard` 401. Today's deploy sequence was: (Phase 1' session) `5515dd96…` ROLLED BACK on missing-postgres-import → `c955bd8c…` SUCCEEDED clean → (Milestones session) `4f7b21c4…` SUCCEEDED (new image, OLD env vars — deploy-api.sh footgun, see TL;DR) → `2f536ee…` SUCCEEDED (env var corrected via `update-service`).
- **TestFlight:** B137 submitted 2026-05-26 00:0X UTC (build `aa732953-22e3-49d5-bceb-7e681f04dbe8`; submission `44850bda-5e24-42d2-a7c8-6e1557f35415`). Bundle: Phase 1' BuddyCard placement refinement + Velocity-card copy patch + Milestones mobile UI (badges/UpNext/date sheet wired into Progress) + Profile location-opt-in toggle. EAS auto-bumped `ios.buildNumber` 136 → 137; recorded locally in a follow-up `chore(mobile)` commit. B136 (Phase 1') still in TestFlight in parallel until B137 supersedes.
- **Watch:** unchanged. Per refresh §6.3, deferred for complete reconceptualization in its own brainstorm.

## How to resume next session

Two parallel tracks are owed before Phase 5 kicks off:

**Track A — T15 on-device walkthrough on B136** (still pending from Phase 1'). Operator drives the device, agent guides. Write the findings doc at `docs/superpowers/findings/2026-05-25-phase-1-prime-verification.md` and update HANDOFF.md.

**Track B — cut B137 and verify the milestones rework on-device.** Server + DB are live; mobile is not. Bundle the four items listed in the TL;DR (Milestones UI, location-opt-in toggle, BuddyCard placement refinement, Velocity-card copy fix). Then walk a milestones-specific checklist on B137. Findings doc at `docs/superpowers/findings/2026-05-25-milestones-panel-rework.md`.

Suggested orientation for the next agent:

> "Phase 1' API+DB shipped to B136 (T15 walkthrough still owed). Milestones panel rework API+DB also shipped to live today — see HANDOFF.md TL;DR for full state including the `MILESTONES_DEPLOY_CUTOFF_ISO` env var. Mobile changes for milestones are NOT in TestFlight yet. Two jobs: (Track A) walk T15 on B136 per `docs/superpowers/plans/2026-05-24-buddy-phase-1-prime.md`; (Track B) cut B137 bundling Milestones UI + Profile location-opt-in toggle + B137 placement refinement + Velocity-card copy fix, then walk a milestones checklist (Progress tab badges + UpNext + date sheet, Profile toggle, optional location attached to a newly-earned milestone). Pick whichever the operator prefers to verify first; B137 cut takes ~30min EAS time so it can run in the background while T15 walkthrough proceeds. After both verifications, the next slice per the refresh doc §9 ordering is the Phase 5 brainstorm (Contextual Mnemonic Co-Creation)."

**Canonical operator test account (for Supabase verification queries):** `7c707446-a006-4be6-8c9e-6e1f207a76df` (display_name `RAD`, email `buddydennis@me.com`). This is the account RAD actually walks builds on. A second parallel account exists — `b8503589-1695-4659-b69d-b9e77d1cf655` (display_name `Buddy`, email `buddydennis@gmail.com`) — historically referenced in prior HANDOFFs but NOT the verification target. Always default to the RAD user_id unless explicitly told otherwise.

**T15 checklist** (from the plan + final-review additions):
1. Dashboard shows Meet Buddy card on first launch post-deploy
2. Dismiss it → re-open Dashboard → card stays gone
3. Study Ready: streak card only if on a milestone-day streak (3/7/14/30/60/90/100/180/365)
4. Progress: no Buddy card visible (rules don't fire there in v1)
5. If on a milestone-day streak, grade a card to complete a session → watch for Expo push
6. Supabase SQL spot-check: rows for the operator's user_id with `dismissed_at`/`push_delivered_at` matching observed behavior

**Operator gotcha to confirm first:** the operator's `user_profiles.notificationsEnabled` must be `true` for the milestone push to actually fire. The in-app BuddyCard appears regardless.

**B137 refinements queue:** see [`docs/superpowers/findings/2026-05-25-b137-refinements.md`](superpowers/findings/2026-05-25-b137-refinements.md) — currently one item (BuddyCard placement under Drill Weak Spots).

---

## On-device walkthrough — owed on B136 (Phase 1' items + B135 + B134 carry-forward)

The B136 build supersedes B135 in TestFlight. The B135 systematic walkthrough was never fully completed (only the burned-count was eyeballed); B136 absorbs it AND adds Phase 1'-specific items.

### Phase 1' specific (NEW in B136)

- [ ] **Dashboard: Meet Buddy card** appears on first launch post-deploy (one-time, lifetime per user)
- [ ] Dismiss Meet Buddy → re-open Dashboard → card stays gone (verify both same-session and after a kill-and-relaunch)
- [ ] **Dashboard: streak card** appears if the operator is currently on a milestone-day streak (3/7/14/30/60/90/100/180/365). If not on a milestone day, Dashboard shows Meet Buddy only.
- [ ] When BOTH cards are present on Dashboard: Meet Buddy renders above streak (priority 10 > priority 5, design spec §4.2 stacking)
- [ ] **Study Ready screen: streak mirror card** appears between the stats row and the Begin button if on a milestone day. Dismissing the Dashboard streak card does NOT dismiss the Study Ready one (independent rows by design — separate dedupe keys).
- [ ] **Progress tab: no Buddy card visible** (placement is wired but no rules fire on Progress in v1)
- [ ] If the operator is on a milestone-day streak: grade a card to complete a review session → watch for an Expo push notification ("Kanji Buddy" title, streak message body, with sound). Push fires exactly once per milestone — a second session same day does not re-fire.
- [ ] No `[BuddyPush]` or `[Buddy post-submit]` warnings in App Runner logs during the walkthrough
- [ ] Supabase SQL spot-check (RAD user_id `7c707446-a006-4be6-8c9e-6e1f207a76df`):
  ```sql
  SELECT id, user_id, screen, nudge_type, action_payload, dismissed_at, push_delivered_at, created_at
  FROM buddy_nudges
  WHERE user_id = '7c707446-a006-4be6-8c9e-6e1f207a76df'
  ORDER BY created_at DESC LIMIT 10;
  ```
  Expected: Meet Buddy row + (if milestone) Dashboard + Study Ready streak rows; `push_delivered_at` set on the Dashboard streak row only.

### FSRS-specific (carry-forward from B135)

### FSRS-specific (NEW in Spec 1.5)

- [ ] **Burned count** — verified ✓ (user confirmed previously-zero burned tier now reflects months of practice)
- [ ] An **overdue** Good/Easy review (R(now) decayed past ~0.85) triggers the **quiz leg**
- [ ] A **same-day** Easy review (R(now) = 1.0) does **NOT** trigger the quiz
- [ ] **Burned-sample surprise check** still triggers a quiz (orthogonal to R signal)
- [ ] **Session Complete** "Practice breakdown" row (flashcard / writing / speaking / quiz) renders correctly
- [ ] **Kanji-detail page** shows integer day counts in the "Interval" stat (no "3.175... days" floating-point leaks)
- [ ] After a loop quiz: a `testSessions` row exists with `test_type = 'loop_check'` and matching `testResults` (Supabase SQL spot-check)
- [ ] No FSRS-related errors in App Runner logs

### B134 carry-forward — Plans A/B/C combined (originally owed on B134, now on B136)

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
| ✅ | **Apply migration `0025` (Phase 1') to the live DB** | done 2026-05-25; pre-check passed, table was empty |
| ✅ | **Deploy API for Phase 1'** | done 2026-05-25, op `c955bd8cb5f64cbab032e24df83c4c00` SUCCEEDED (first deploy `5515dd9608...` rolled back on missing-postgres-import; fixed in `6846822` and redeployed) |
| ✅ | **Cut + submit B136 to TestFlight (Phase 1')** | done 2026-05-25 — Apple processing |
| ✅ | **Merge `milestones-rework` to `main`** | done 2026-05-25; merge commit `52ff639`, pushed to `origin` |
| ✅ | **Apply drizzle migrations `0012` + `0013` (Milestones) to live DB** | done 2026-05-25; both verified present |
| ✅ | **Deploy API for Milestones rework + set `MILESTONES_DEPLOY_CUTOFF_ISO`** | done 2026-05-25, ops `4f7b21c4…` then `2f536ee…` both SUCCEEDED; env var set to `2026-05-25T23:50:00Z` |
| ✅ | **Cut + submit B137 to TestFlight (Milestones mobile + Phase 1' refinement + Velocity copy)** | done 2026-05-26 — build `aa732953…`, submission `44850bda…`; Apple processing |
| ✅ | **Deploy API for B138 hot-fix (grandfather location)** | done 2026-05-26, op `6d5fb02183884733894b60508557f22d` SUCCEEDED; image `sha256:7c6a7b49…` |
| ✅ | **Cut + submit B138 to TestFlight (stale-cache + grandfather-location hot-fix)** | done 2026-05-26 — build `5fc58b14-6fed-4f74-bc27-54dd94617c56`, submission `af845507-d016-44b2-8e80-eb9e001c915c`; Apple processing |
| ✅ | **Deploy API for softened silver rule** | done 2026-05-26, op `c677b8b5ec6b4e3a98b89080c8a9775c` SUCCEEDED; image `sha256:c89367c6…`. Buddy N5 silver written via direct refreshState; milestone count 14 → 15. |
| 🚀 | **Mobile/shared cut bundling the softened silver rule** | bundle into next mobile EAS cut. Cosmetic mismatch until then (UpNext may double-show silvers). |
| 🚀 | On-device walkthrough on B136 (Phase 1' + Spec 1 + Spec 1.5 combined) | T15 owed — see "On-device walkthrough" section above |
| 🚀 | On-device walkthrough on B138 (Milestones rework + B137 refinements + B138 hot-fix) | B138 supersedes B137; once it lands, verify badges actually appear on first launch (no force-quit), and that a fresh review on Buddy/gmail account populates milestones WITHOUT location. Findings doc at `docs/superpowers/findings/2026-05-25-milestones-panel-rework.md` (combine with B137 refinements + B138 hot-fix verification). |
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
- ~~**Milestones panel rework**~~ — SHIPPED (API + DB) 2026-05-25, merge commit `52ff639`. Mobile UI + Velocity-card copy fix bundled into the owed B137 cut. Plan checkboxes were never ticked during execution; closeout findings doc at `docs/superpowers/findings/2026-05-25-milestones-panel-rework.md` still owed.
- **`scripts/deploy-api.sh` footgun** — line 24 `${APPRUNNER_SERVICE_ARN:-…}` doesn't accept empty-string override to skip `start-deployment`. Fix: change to `${VAR-…}` (no colon). Low-priority since the workaround (run `update-service` before `deploy-api.sh` when bundling env-var changes) works.
- ~~**`interventions.payload` double-encoded**~~ — FIXED for new writes by Phase 1' T4's storage-layer jsonb fix (commit `f1d111b`, `packages/db/src/client.ts`). Existing legacy rows remain double-encoded; only SQL-side `->>` queries against historical interventions are affected (none in current code paths).
- **B137 refinements queue** — [`docs/superpowers/findings/2026-05-25-b137-refinements.md`](superpowers/findings/2026-05-25-b137-refinements.md). Currently one item: move BuddyCardStack on Dashboard up under the Drill Weak Spots button (operator feedback from B136 walkthrough). To be bundled into the same B137 cut as the Milestones mobile UI + Velocity-card copy fix.
- **App-wide accessibility pass** — touch targets / `accessibilityLabel`s, plus the `textMuted` contrast debt. Warrants its own task given WCAG 2.1 AA standard.
- ~~**Pre-existing `social-mute.test.ts:25` typecheck error**~~ — FIXED on `main` via `7ccfe32` (Phase 1' session, "allow standard register options in buildTestApp RouteSpec"); the milestones merge confirmed `pnpm typecheck` is now clean across all 4 packages.
- **`useBuddyNudges` hook tests** — design spec §6.4 called for them; Phase 1' shipped without (per the project convention of not unit-testing mobile hooks). Worth adding if any complex behavior accrues.

---

## Working environment notes

- **Prod API:** `https://73x3fcaaze.us-east-1.awsapprunner.com`. Milestones rework (MilestoneDetector + LearnerStateService refresh integration + analytics summary additions) live as of 2026-05-25 23:40 UTC; Phase 1' (Buddy NudgeService + routes + push) live since 2026-05-25 ~12:00 PT; Spec 1.5 FSRS live since 2026-05-23. App Runner service ARN: `arn:aws:apprunner:us-east-1:087656010655:service/kanji-learn-api/470f4fc9f81c407e871228fb9dd93654`. AutoDeploymentsEnabled=False — deploys only via explicit `start-deployment` or `update-service` (the latter triggers redeploy on config change).
- **Supabase:** still `ap-southeast-2`. Two migration tracks coexist: (a) supabase-format files in `packages/db/supabase/migrations/` (`0001`–`0025`; `0024` FSRS applied 2026-05-23, `0025` buddy_nudges dedupe applied 2026-05-25); (b) drizzle-format files in `packages/db/drizzle/` (`0012` kanji_grade_idx applied 2026-05-25, `0013` user_profile_attach_location applied 2026-05-25). Both tracks applied via raw `psql -f` — Supabase CLI is NOT used in this project, which is why `supabase_migrations.schema_migrations` doesn't exist (harmless log notice if anything queries it).
- **App Runner env vars:** managed via `aws apprunner update-service` against the service's `SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables`. Current keys (17): `ANTHROPIC_API_KEY`, `API_BASE_URL`, `AWS_REGION`, `CORS_ORIGIN`, `DATABASE_URL`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `HOST`, `INTERNAL_SECRET`, `LOG_LEVEL`, `MILESTONES_DEPLOY_CUTOFF_ISO`, `NODE_ENV`, `PORT`, `SES_SENDER_EMAIL`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`. To add/change without leaking secrets to the transcript: `describe-service --query 'Service.SourceConfiguration' --output json` → modify via `jq` → `update-service --source-configuration file://...`.
- **Docker / API deploy:** `./scripts/deploy-api.sh` from repo root. Builds + pushes the image to ECR and triggers an App Runner deployment. Returns immediately; monitor rollout via the App Runner console or `aws apprunner list-operations`.
- **EAS builds:** from `apps/mobile/`, ~$2/build. `eas build --platform ios --profile production --non-interactive`. EAS auto-bumps `ios.buildNumber` — **never hand-edit `app.json`** (it tracks the LAST shipped build; EAS bumps to +1 server-side). Submit with `eas submit --platform ios --latest --non-interactive`. Apple processing follows (~5–10 min from submit).
- **Watch builds:** **manual Xcode rebuild only** — EAS does not build the watchOS target. Spec 1.5 was API-only; no Watch rebuild required.
- **FSRS replay script:** `scripts/replay-srs-fsrs.mjs`. Run via `./packages/db/node_modules/.bin/tsx scripts/replay-srs-fsrs.mjs` (or `node --import tsx/esm ...`). Honors `sslmode=disable` for local rehearsal DBs; defaults to `ssl: 'require'` for Supabase. Idempotent. Auto-refreshes `kanji_mastery_view` at end. `--dry-run` and `--user <uuid>` flags supported.
- **Clone-rehearsal pattern:** for any future destructive migration, the FSRS rollout established the pattern — fresh `pg_dump` of live → restore to local Docker Postgres → apply migration → run replay/backfill → spot-check → merge to main → live rollout. The runbook at `docs/superpowers/runbooks/2026-05-22-fsrs-rollout.md` documents it explicitly.
- **Worktrees:** `.claude/worktrees/` is the Claude Code scratch-worktree location (gitignored). Spec 1.5 was executed in `.claude/worktrees/spec-1.5-fsrs-migration` (now removed, fast-forward-merged to main).
- **Co-author convention:** every kanji-learn commit includes `Co-Authored-By: Robert A. Dennis (Buddy)` alongside the Claude co-author line.
