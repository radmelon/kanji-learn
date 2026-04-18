# Session Handoff — 2026-04-18 (evening)

## Current State

**Branch:** `main` — all session work merged and pushed (origin/main up to date).
**Latest TestFlight build:** **B121** (iOS) — auto-submitted by EAS, bundles Build 1 + Build 2 together (13 feature commits). User verified 12 of 14 items during an end-of-day pass.
**API:** Redeployed to App Runner `us-east-1` on 2026-04-18 (op `7a2c8a31df514442bedbc29b0c79ab8a`) with the new weighted-confidence SQL + leaderboard columns. Health 200.
**DB:** No migrations this session. No schema changes. One ad-hoc data flip remains in place: for the test account `buddy@g.ucla.edu` (id `c0d80f51-9355-4116-ba46-66760c7352a8`), all 20 user_kanji_progress rows have `next_review_at` set to ~2026-04-18 23:02 UTC so the cards remain due for further morning-after testing if desired.

## What shipped this session

Plans written and executed:
- [docs/superpowers/plans/2026-04-18-b121-copy-and-ux-sweep.md](docs/superpowers/plans/2026-04-18-b121-copy-and-ux-sweep.md) — Build 1, 6 tasks
- [docs/superpowers/plans/2026-04-18-b122-study-loop-and-leaderboard.md](docs/superpowers/plans/2026-04-18-b122-study-loop-and-leaderboard.md) — Build 2, 6 tasks (filename says "b122" but everything bundled into B121 on EAS — see note below)

Execution style: subagent-driven, fresh implementer per task, light inline diff review (no separate spec / quality reviewer subagents — user chose lighter process).

### Build 1 commits (copy + UX sweep)
- `744dede` fix(mobile): flip accuracy→confidence in SRS-context copy
- `9295c06` refactor(mobile): expose refresh from useInterventions hook
- `d03cfad` feat(mobile): auto-refresh Dashboard data on tab focus
- `63c464e` fix(mobile): dedicated empty state + Start studying CTA on quiz screen
- `378f85c` chore(mobile): add motivational line to onboarding findHelp footer
- `6e779a8` feat(mobile): add color legend under JLPT progress grid

### Build 2 commits (study loop + leaderboard)
- `b5ec166` fix(mobile): mnemonic auto-reveal only on Again (quality=1), not Hard
- `aaa874a` feat(api): weighted 3/2/1/0 confidence scoring (Easy=3 / Good=2 / Hard=1 / Again=0)
- `dededf3` feat(mobile): weighted session confidence on Session Complete screen
- `5f2c009` feat(mobile): show-mnemonic section on Kanji details page
- `14f1f62` feat(mobile): meaning/reading visual cue on study card (violet/amber)
- `87f2695` feat(mobile): dismissible invite-a-study-mate banner on Dashboard
- `91e8161` feat(leaderboard): add days-studied + remembered columns; sort streak→days→remembered

**Note on build numbering:** EAS auto-incremented to **B121** after our push (one build, bundling both plans). There is no separate B122 — the "B122 plan" filename is a misnomer from mid-session.

## B121 verification results (TestFlight, 2026-04-18 evening)

**12 of 14 items verified end-to-end:**

✅ SessionComplete "confidence" label
✅ Drill Weak Spots dialog copy
✅ Progress tab info panel ("Confidence colour coding")
✅ Dashboard auto-refresh on tab focus (no pull-to-refresh needed)
✅ Take Quiz empty state + "Start studying" CTA (tested via fresh account → Start Studying worked)
✅ Onboarding findHelp motivational footer
✅ JLPT color legend under progress bars
✅ Mnemonic auto-reveal: Hard no longer triggers nudge
✅ Kanji details page: Mnemonic section with Show / Regenerate button
✅ Meaning-prompt violet border + tint (study card)
✅ Invite-a-study-mate banner (fresh account, 0 mates)
✅ Leaderboard: days-studied + remembered columns, sorted streak → days → remembered
✅ **Weighted 3/2/1/0 confidence math** — fully proved via a controlled 20-card test (5 × Again + 5 × Hard + 5 × Good + 5 × Easy, all button taps). DB recorded exactly 5 of each quality; Session Complete showed 50%; Dashboard showed 47% cumulative; manual SQL matched Dashboard.

**Remaining to verify:**
🧪 **Amber reading-prompt cue** — will naturally surface when a reading-stage card appears in a session. Not a code concern; same code path as the verified meaning cue.

## Bugs discovered during B121 verification

Tracked in [BUGS.md](BUGS.md). Four new active bugs from this session:

1. **Save-session latency ~45 seconds** — Root cause confirmed by reading the code: the submit path at [srs.service.ts:276–330](apps/api/src/services/srs.service.ts:276) does ~7 DB round trips per review (findFirst UKG + a 4-write transaction with BEGIN/COMMIT). For a 20-card session that's **~145 round trips**. At ~300ms cross-region RTT (us-east-1 API ↔ ap-southeast-2 Supabase), 145 × 300ms = 43.5s — matches observed 45s exactly. **Fix path specified:** batch the loop into a single transaction with bulk INSERT + ON CONFLICT DO UPDATE statements (~12 RTTs instead of 145, expected ~12× speedup). Also requires adding a `recordReviewSubmissions` plural method on `DualWriteService`. See BUGS entry for full investigation steps + affected files. `[Effort: M]` `[Impact: High]` `[Status: 🔎 Investigation complete; fix pending sign-off]`

2. **Session Complete screen persists after returning to Study tab** — `onDone` at [study.tsx:375](apps/mobile/app/(tabs)/study.tsx:375) only calls `router.replace('/(tabs)')` but doesn't clear the local `sessionSummary` state or call the review-store `reset()`. Because Expo Router tabs stay mounted, state survives navigations and the stale Session Complete re-renders. **Workaround for user:** force-quit the app to remount the Study tab. **Fix:** add `setSessionSummary(null)` + `reset()` in `onDone` before navigating. `[Effort: XS]` `[Impact: High]`

3. **Study queue ignores `profile.dailyGoal`** — `study.tsx:165` calls `loadQueue(20)` hardcoded. A new user who picks dailyGoal=5 in onboarding still gets 20-card sessions. Same hardcoded literal on line 334 (offline retry). **Fix:** destructure `dailyGoal` from `useProfile()` and pass to `loadQueue`. `[Effort: XS]` `[Impact: High]`

4. **Post-delete relational cascade — deleted users linger in mates + leaderboard** — Confirmed reproducible in B121: a deleted user still shows on another user's leaderboard and mates list. Root cause is missing `ON DELETE CASCADE` FKs on friendships / mate / tutor-share tables back to `auth.users` / `user_profiles`. Known since B120; repro'd this session. **Fix:** schema audit + migration 0017 + optional farewell push to affected friends. `[Effort: M]` `[Impact: High]`

## New refinements / enhancements logged

Tracked in [ENHANCEMENTS.md](ENHANCEMENTS.md). Three new entries worth bundling into Build 3 where relevant:

- **Study Card Gesture Mapping: Clarify or Remap Swipe Directions** — Origin of the session's confusing 43% result. The user swiped down on cards intending "Again" but swipe-down maps to Hard ([study.tsx:108–144](apps/mobile/app/(tabs)/study.tsx:108)). Current mapping: right=Easy, left=Again, up=Good, down=Hard. Intuition says down=reject/dismiss/again. Three candidate fixes documented: remap, enlarge mid-drag labels, or onboarding gesture diagram. `[Effort: S]` `[Impact: High]`

- **Session Complete: High / Medium / Low / Missed breakdown** — Replace the binary "correct vs wrong" breakdown with a 4-tier count (Easy=High, Good=Medium, Hard=Low, Again=Missed) aligned to the new weighted ring. `[Effort: S]` `[Impact: Med]`

- **Speak button on example sentences (Kanji details)** — One-tap TTS on each sentence using existing Expo Speech infra. `[Effort: XS]` `[Impact: Med]`

## Latency investigation: root cause + fix plan (ready to ship)

### Evidence from reading the code

- `apps/api/src/services/srs.service.ts::submitReview` (lines 215–339) runs a FOR-loop over `results` with one `findFirst` + one `dualWrite.recordReviewSubmission` call per review.
- `dual-write.service.ts` opens a Drizzle transaction for each call with 4 writes inside (review_logs insert, user_kanji_progress upsert, learner_knowledge_state upsert, learner_timeline_events insert).
- Each transaction = BEGIN + 4 writes + COMMIT = **6 RTT minimum**. Plus the pre-transaction findFirst = **7 RTT per review**.
- Plus fixed setup queries (userProfiles upsert, learnerIdentity upsert, reviewSessions insert, kanji batch select) and a final UPDATE reviewSessions completedAt.
- **20-card session: 4 + (20×7) + 1 = 145 RTTs**.

### Fix plan

Add a new `DualWriteService.recordReviewSubmissions(inputs: ReviewSubmissionInput[])` (plural) that:
- Performs ONE `findMany` for existing UKG rows (using `inArray(kanjiId, kanjiIds)`).
- Computes all SRS math in-memory (pure function `calculateNextReview` from shared).
- Runs a SINGLE transaction with FOUR bulk statements:
  - Bulk insert review_logs
  - Bulk upsert user_kanji_progress (`VALUES ...`, `ON CONFLICT ... DO UPDATE SET col = excluded.col`)
  - Bulk upsert learner_knowledge_state (same pattern, with `reviewCount = learner_knowledge_state.reviewCount + 1` via `sql\`excluded\` references`)
  - Bulk insert learner_timeline_events

Update `SrsService.submitReview` to call the new plural method. Keep the existing singular `recordReviewSubmission` for backwards compatibility (and in case some future caller really does want per-row atomicity).

### Trade-off (needs user sign-off before shipping)

**Today:** per-review atomicity — if review 15/20 fails, 0–14 are committed, 15–19 skipped. The client-side offline queue handles session-level retry.
**After fix:** session-level atomicity — a single bad row rolls back the whole session. The client offline queue still handles retry.

In practice, pre-validation at [srs.service.ts:301–306](apps/api/src/services/srs.service.ts:301) rejects unknown kanjiIds before any write, so the remaining failure modes are connection-level — in which case rolling back the session and letting the offline queue retry is arguably cleaner than leaving a half-committed session. Recommendation: **accept the trade-off**.

### Expected speedup

- Before: 145 RTTs × ~300ms = 43.5s
- After: ~12 RTTs × ~300ms = ~3.6s
- **~12× speedup**, no DB migration needed, matches the observed user pain exactly.

### Testing strategy

Per systematic-debugging skill: "no fix without a failing test." Options discussed:
- **(a) Unit-test the batching transformation** (pure function: given inputs + existing UKG, produce correct row sets) — no DB needed, runs in Jest today. Recommended.
- (b) Full integration test — requires `TEST_DATABASE_URL` setup.
- (c) Manual TestFlight verification only.

Tomorrow's first decision is (a) vs. (c) and go.

---

## 🚦 Tomorrow's first tasks

1. **Amber reading-prompt cue** — start a study session on a mature account that has reading-stage cards, verify amber border/tint shows when a reading prompt appears. Close the partial entry in ENHANCEMENTS.md. (The code path is identical to the verified meaning cue, so this should just visually confirm.)

2. **Latency fix decision + ship** — decide between "unit test + batch submit" (my recommendation) or defer. If ship: the fix is API-only (server-side change in `apps/api/`), so requires an App Runner redeploy but **no new EAS build**. Save on EAS credits.

3. **Build 3 plan scope** — bundle the remaining open work. Candidates:
   - Fix: Session Complete stale state (`onDone` reset) — XS
   - Fix: daily goal hardcoded-20 — XS
   - Fix: post-delete relational cascade (migration 0017 + farewell push) — M
   - Feature: nudge/poke (still outstanding from B120 triage) — L
   - Refinement: High/Medium/Low/Missed breakdown on Session Complete — S
   - Refinement: Speak button on Kanji details sentences — XS
   - Refinement: Gesture mapping clarity — S

   The first two XS fixes are good candidates for an immediate hotfix build even before Build 3.

---

## Working environment notes

- **API URL (production):** `https://73x3fcaaze.us-east-1.awsapprunner.com`
- **Supabase project:** `pyltysrcqvskxgumzrlg.supabase.co` — still in `ap-southeast-2` (Sydney). Migration to us-east-1 is queued as a Pre-Launch item in ENHANCEMENTS.md and would independently resolve the 45s submit latency.
- **Build numbers:** EAS auto-increments. Last shipped: **B121**. Don't manually bump.
- **Docker deploys:** API → App Runner via `DOCKER_CONTEXT=default ./scripts/deploy-api.sh` from the repo root. OrbStack's default context produces ARM images that crash App Runner.
- **EAS builds:** from `apps/mobile/`, not repo root. Current status: past 100% of included monthly tier, billing at ~$2/build. Continue to bundle builds.
- **EAS credits:** at pay-as-you-go rate. Bundle fixes into coherent TestFlight cuts (see memory: "Bundle TestFlight builds to conserve EAS credits and test time").
- **Database connection:** `DATABASE_URL` in `apps/api/.env` (used by the `psql` calls this session).
- **Test account for weighted-math verification:** `buddy@g.ucla.edu` (id `c0d80f51-9355-4116-ba46-66760c7352a8`). As of session end, has 40 total review_logs rows (5/5/5/5/5/17 across qualities 1/3/4/5 + the original 17/3 split). Cards are due NOW for further testing if needed.

## Tomorrow's first command

```
cd /Users/rdennis/Documents/projects/kanji-learn
git pull origin main
# 1. Verify the amber reading-prompt cue in TestFlight B121
# 2. Decide on latency-fix approach (batch submit + unit test, or defer)
# 3. Scope Build 3 bundle
```

---

## Recent commits (this session, in chronological order — reverse of git log)

```
6a69d62 docs(trackers): log B120 verification findings — 5 bugs + 10 enhancements

# Build 1 (copy + UX sweep)
744dede fix(mobile): flip accuracy→confidence in SRS-context copy
9295c06 refactor(mobile): expose refresh from useInterventions hook
d03cfad feat(mobile): auto-refresh Dashboard data on tab focus
63c464e fix(mobile): dedicated empty state + Start studying CTA on quiz screen
378f85c chore(mobile): add motivational line to onboarding findHelp footer
6e779a8 feat(mobile): add color legend under JLPT progress grid

# Build 2 (study loop + leaderboard)
b5ec166 fix(mobile): mnemonic auto-reveal only on Again (quality=1), not Hard
aaa874a feat(api): weighted 3/2/1/0 confidence scoring (Easy/Good/Hard/Again)
dededf3 feat(mobile): weighted session confidence on Session Complete screen
5f2c009 feat(mobile): show-mnemonic section on Kanji details page
14f1f62 feat(mobile): meaning/reading visual cue on study card (violet/amber)
87f2695 feat(mobile): dismissible invite-a-study-mate banner on Dashboard
91e8161 feat(leaderboard): add days-studied + remembered columns; sort streak→days→remembered

# Verification + investigation docs
08ccbb6 docs(enhancements): log speak button on example sentences (Kanji details)
c3ab643 docs(bugs): log 45s save-session latency observed in B121
a73babf docs(enhancements): log High/Medium/Low/Missed breakdown on Session Complete
ce0e3f1 docs(bugs): close SessionComplete + Drill Weak Spots copy — verified B121
9dc04ff docs(trackers): leaderboard metrics shipped; post-delete cascade confirmed in B121
a8b7e63 docs(enhancements): invite-a-study-mate banner shipped and verified in B121
b9b7f44 docs(enhancements): close 4 B121 features; meaning/reading cue partial
75cc363 docs(enhancements): revert weighted-scoring to pending — math not yet verified
8850827 docs(enhancements): JLPT color legend shipped — verified in B121
021b208 docs(trackers): close 3 more B121 items — Dashboard refresh, Take Quiz empty, onboarding footer
5f625e1 docs(bugs): log daily-goal-ignored bug + refine 45s latency investigation
d6f376d docs(bugs): log stale Session Complete state after tab navigation
f280573 docs: close weighted-math verification + log gesture-mapping refinement
```
