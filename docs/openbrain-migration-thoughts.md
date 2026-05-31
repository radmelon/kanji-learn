# Open Brain migration — proposed thoughts

**Purpose:** Review list for migrating Kanji Buddy project knowledge from Claude
Code's `.claude` memory files into the `MyOpenBrain` instance
(`nscgwcepxnalchobgqhx` Supabase project).

**How to review:** Each numbered item is one atomic "thought" that will be
embedded and stored as a row in the `thoughts` table. Edit the quoted text,
delete items you don't want, or move items between the MIGRATE / SKIP sections.
When you're done, tell Claude to ingest — everything still under a MIGRATE
heading gets written via the Open Brain MCP.

**Metadata applied to every thought:** `{ "project": "kanji-learn", "source":
"claude-memory-migration", "category": "<see each item>" }`. Bug items also get
`"status": "open" | "shipped" | "stale"`.

**Source state:** Claude memory files as of ~2026-04-26 (B132 shipped). Some
items describe gaps already closed — flagged in §8.

---

## §1 — Project context  (recommend: MIGRATE — category: `context`)

### 1. What the project is
> Kanji Buddy (repo name `kanji-learn`, Japanese name 漢字 Buddy) is a mobile app for learning Japanese kanji via spaced-repetition flashcards, with Speaking and Writing practice modes and an Apple Watch companion. It is a pnpm monorepo: `apps/mobile` (Expo / React Native iPhone app), `apps/watch` (a standalone watchOS Xcode project), `apps/api` (Fastify backend), and `packages/db` (Drizzle ORM over Supabase Postgres).

### 2. Who builds it
> Kanji Buddy is built and owned by Robert A. Dennis, who goes by "Buddy" (email buddydennis@gmail.com). He is an active co-author of the codebase — design decisions, trade-offs, and reviews are his. He is also the primary hands-on TestFlight tester.

### 3. Buddy's Japanese-learning background
> Buddy learned kanji using Hadamitzky & Spahn's textbook "Kanji & Kana" (2011 revision), the source of the `sh_kk` / `sh_kk2` Kanjidic2 reference codes. His learning style is systematic and reference-heavy rather than intuition- or mnemonic-first. Practical implication for Kanji Buddy: the Hadamitzky-Spahn index has direct personal value and should appear alongside Nelson and Morohashi on the kanji details page; reference-heavy "look it up properly" features land well.

### 4. Second tester
> Kanji Buddy has a second tester named Bucky, based in Japan. During the testing phase, multi-device / multi-account scenarios (e.g. study-mate alerts) are exercised between Buddy and Bucky.

### 5. Infrastructure layout
> Kanji Buddy's API runs on AWS App Runner in us-east-1; the Supabase Postgres database is in ap-southeast-2 (a pre-launch region-consolidation item exists to move it to us-east-1). The domain is kanjibuddy.org, managed in Route 53, with SES email verified in us-east-1. iOS builds go through EAS Build and TestFlight.

### 6. EAS / TestFlight build economics
> Kanji Buddy is past the EAS free tier and bills pay-as-you-go at roughly $2 per build. Builds should be bundled into coherent feature sets (a 2–3 build plan), not cut per individual fix, both to conserve credits and to give Buddy uninterrupted time for hands-on TestFlight verification between builds.

---

## §2 — Product vision  (recommend: MIGRATE — category: `vision`)

### 7. The Three-Modality Learning Loop
> The long-term product direction for Kanji Buddy is a confidence-driven learning loop, not three independent drill tabs. SRS flashcards (Study tab) record per-kanji confidence; low-confidence kanji should automatically trigger interventions (mnemonic generation, repeated writing reps, repeated speaking reps); objective quizzing then measures whether memory actually improved and feeds the result back into confidence.

### 8. Why the learning loop matters
> The Three-Modality Learning Loop reflects Buddy's belief that the app should actively route a learner's practice rather than leave them to DIY their own movement between Study, Speaking, and Writing tabs. It mirrors his own systematic learning approach.

### 9. Learning-loop process discipline
> The Three-Modality Learning Loop is a scheduled future brainstorm/spec, not an approved task. No architectural changes to the Study↔Speaking↔Writing relationship should be made before that brainstorm happens. Any task touching confidence scoring, weakness detection, mnemonic triggering, the quiz surface, or writing/speaking reps should trigger the brainstorm first rather than bolting something on.

---

## §3 — Open bugs & follow-ups  (recommend: MIGRATE — category: `bug`, status: `open`)

### 10. Notification flood — dual trigger
> Kanji Buddy bug (Item 5, open): daily study reminders can fire multiple times per hour because `sendDailyReminders()` has two triggers — an in-app cron in `apps/api/src/cron.ts` running hourly, and an AWS Lambda on EventBridge that POSTs `/internal/daily-reminders`. Fix options: delete the in-app cron and rely only on the Lambda (cheap, one source of truth), or add a `lastDailyReminderSentAt` date column on `user_profiles` and gate on today's date (robust, both triggers coexist). Decision pending.

### 11. Study card speaker icon stuck
> Kanji Buddy bug (Item 6, open): the speaker icon on a Study card stays lit with no audio after tapping, recoverable only by force-quit. Root cause in `KanjiCard.tsx speakSequence` — `Speech.speak()` has no watchdog, so if `onDone`/`onError` never fire (iOS audio session left in a bad category by the Speaking-tab microphone path) the `speakingGroup` state never resets. Fix: reset the audio session category on Study focus via `Audio.setAudioModeAsync`, plus a setTimeout watchdog for the lit-icon symptom.

### 12. VoiceEvaluator empty-transcript dead-end
> Kanji Buddy bug (Item 7, open): when the speech recognizer ends with an empty transcript, `VoiceEvaluator.tsx` returns early with no user feedback — the card silently goes "Listening..." → idle. Fix: show a brief inline "Didn't catch that — tap mic to retry" banner that does not count as a wrong attempt or reset the hint ladder.

### 13. Tutor report still references dropped writing modality
> Kanji Buddy follow-up (open): after Writing prompts were dropped from Study cards (B131), the tutor report still has a `getWriting()` section, includes 'writing' in the `weakestModality` calculation, and surfaces it in the Claude-generated tutor analysis. These need scoping or removal. The `writingAttempts` DB table should be kept (historical value if writing returns). This work couples to the Three-Modality Learning Loop brainstorm and should follow it.

### 14. Push notifications need manual APNs key upload
> Kanji Buddy bug (B1, open): push notifications require the APNs `.p8` key to be uploaded manually to expo.dev → Credentials → iOS → Push Notifications. This is a manual step, not automatable in code.

### 15. Dashboard accuracy discrepancy
> Kanji Buddy bug (B4, open, unconfirmed root cause): the Dashboard accuracy figure looked wrong. The code uses a consistent `>= 4` quality threshold throughout, so it is likely a runtime/data issue needing investigation with real data rather than a code bug.

### 16. New-user onboarding skipped
> Kanji Buddy bug (B8, open): new users can skip onboarding. Suspected chain — the `on_auth_user_created` database trigger may not fire, so no row is created in `user_profiles`, the profile API returns 404, `useProfile` swallows the error, and the layout stays stuck with `profile === null` and never routes to onboarding.

### 17. AI tutor analysis provider failure
> Kanji Buddy bug (open): the AI-generated tutor analysis fails with "Both tier 2 providers failed" — an LLM router configuration issue on App Runner. The tutor analytics feature is otherwise complete.

### 18. SES still in sandbox mode
> Kanji Buddy pre-launch blocker: AWS SES for kanjibuddy.org is still in sandbox mode, so tutor-share invite emails only send to verified recipient addresses. Production SES access must be requested before public release.

---

## §4 — Decisions made  (recommend: MIGRATE — category: `decision`)

### 19. Writing prompts removed from Study
> Kanji Buddy decision (B131, 2026-04-24): Writing prompts were removed from Study flashcards because there is no writing input or grading surface yet. `pickReviewType` now returns 'compound' instead of 'writing' for reading-stage-3 cards, and the dev mode picker dropped its 'W' chip. The 'writing' type is left in the codebase unions for if/when a real writing modality is built.

### 20. Speaking deck mirrors Study deck
> Kanji Buddy decision: the Speaking tab drills the same kanji as the current day's Study deck. This was chosen deliberately as a loosely-coupled interim arrangement that does not pre-empt the future Three-Modality Learning Loop routing model.

### 21. Testing-phase flags must be reverted before launch
> Kanji Buddy pre-launch task: two values were relaxed for the testing phase and must be restored in a dedicated pre-launch hardening commit. (1) The mate-alert frequency cap `mateNotifyCapMs` in `notification.service.ts` is 2h and must return to 24h. (2) `EXPO_PUBLIC_DEV_TOOLS=1` in `eas.json`'s production profile (which enables the Study-tab dev mode picker on TestFlight) must be removed. Verify both before any public App Store build.

### 22. Build bundling policy
> Kanji Buddy decision: related fixes are bundled into single TestFlight builds rather than one build per fix, grouped by logical surface area, with the EAS cost flagged before each cut. Outage-level bugs are the only exception.

---

## §5 — Technical lessons  (recommend: MIGRATE — category: `lesson`)

### 23. Apple Watch ARM64_32 integer pitfall
> Kanji Buddy technical lesson: the Apple Watch target is ARM64_32, where Swift's `Int` is 32-bit. `Int(Date().timeIntervalSince1970 * 1000)` overflows Int32 and traps at runtime with `EXC_BREAKPOINT (SIGTRAP) code 0x1`. Always use `Int64` for millisecond timestamps and any Double→Int conversion that could exceed ~2.15e9 in Watch Swift code. Also use `as? Int64` (not `as? Int`) when reading cross-platform values bridged from the iPhone. This bug shipped in B129/B130 across seven files before being caught.

### 24. WCAG 2.1 AA contrast standard
> Kanji Buddy coding standard: all mobile UI must meet WCAG 2.1 AA contrast — 4.5:1 for normal text, 3:1 for large text and icons. Every `<Text>` and every state-conveying icon/border must have an explicit color from `src/theme`; never rely on React Native's default text color, which is black and invisible on the app's dark theme (`#1A1A2E` background). Originated from a B125 bug where a pitch-accent overlay inherited the default black and rendered illegibly.

### 25. EAS does not build the watchOS target
> Kanji Buddy build lesson: EAS Build only builds the Expo iPhone app at `apps/mobile/`. The standalone watchOS target at `apps/watch/KanjiLearnWatch.xcodeproj` (bundle id `com.rdennis.kanjilearn2.watchkitapp`) is NOT built by EAS. Any Swift change under `apps/watch/` ships only when Buddy rebuilds via Xcode → run on Watch. Watch-only fixes should not be gated on an EAS/TestFlight cut for verification — use the Xcode debug-run path instead.

### 26. EAS buildNumber semantics
> Kanji Buddy build lesson: in `apps/mobile/app.json`, `ios.buildNumber` is the LAST build that started, not the next target. EAS auto-bumps it by 1 when a build starts and commits the bump back. Never hand-edit it. When Buddy says "build BN", expect the next build to be on-disk-value + 1; if that disagrees, confirm before cutting (wrong builds cost ~$2 each).

### 27. Bluetooth mic HFP lag is not an app bug
> Kanji Buddy diagnostic lesson: when the Speaking recognizer "doesn't hear" the first utterance (showing "Listening..." for ~5s with no transcript), first ask whether Bluetooth headphones with a mic are connected. iOS routes input through the Hands-Free Profile (HFP/SCO), and link negotiation eats the first 1–2 seconds of audio. Workaround: pause before speaking, or disconnect Bluetooth. This is not an audio-session leak — do not pursue the `setAudioModeAsync` pre-start hypothesis for this symptom.

### 28. App Runner rolling-deploy drain gap
> Kanji Buddy deploy lesson: AWS App Runner reaching status RUNNING after a deploy does not mean old instances have drained. A user-driven request shortly after RUNNING can still hit an old instance running the previous image. After deploying a route change, wait an extra minute or two past RUNNING before verifying the new behavior.

### 29. Shared-cache hook pattern
> Kanji Buddy architecture lesson: hooks whose state spans multiple tabs (`useSocial`, `useProfile`) should use a shared module-level cache, not per-component `useState`. Per-instance state caused cross-screen staleness that only force-quit fixed. Any new multi-tab hook should adopt the shared-cache pattern by default. Likewise, a `RefreshControl` on a multi-domain screen should `Promise.all` every domain's refresher, not just the screen's primary hook.

---

## §6 — Shipped milestones  (recommend: MIGRATE — category: `milestone`)

### 30. B131 shipped
> Kanji Buddy build B131 (shipped 2026-04-24): fixed the Apple Watch launch crash (ARM64_32 Int64 timestamp fix), removed Writing prompts from Study, and hardened the Speaking evaluation — kana-only filtering of vocab readings, sokuon/okurigana near-match in the kanji-expansion path, and digit→kanji preprocessing so transcripts like "7じ" evaluate correctly.

### 31. B132 shipped
> Kanji Buddy build B132 (shipped 2026-04-26, EAS build `8e1feb3c`): study-mate invite surfacing (friend-request push + Profile-tab badge), the Tutor-share Resend URL button, the Watch `print()`→`os_log` logging migration, a dynamic About-page version (`1.0.{buildNumber}`), and a Progress-page displayName regression fix. Plus follow-ups: a shared friends/leaderboard cache and Profile pull-to-refresh.

### 32. Speaking-eval data cleanup
> Kanji Buddy data fix (2026-04-24): three `example_vocab` entries in production had romaji leaked into the `reading` field by the Claude Haiku enrichment pipeline (好意→こういi, 捜査機関→そうsakikikan, 雑多→ざったａ). Fixed via a one-shot SQL update. A defensive kana-only filter in `selectVoicePrompt` remains as belt-and-suspenders, and a follow-up task exists to add a kana-only validator inside `enrich-vocab.ts`.

### 33. Tutor analytics sharing feature
> Kanji Buddy feature: tutor analytics sharing lets a learner share their learning analytics with a teacher. All 13 implementation tasks are complete (branch `feature/tutor-analytics-sharing`, PR #5). Infrastructure done: SES domain verified, IAM role attached, migration `0014_tutor_sharing.sql` applied (5 tables). Outstanding: the AI-analysis provider failure (see bug item) and SES sandbox exit.

---

## §7 — Claude Code operational mechanics  (recommend: SKIP — not Kanji Buddy product knowledge)

These are working-process rules for the Claude Code agent, not project ideas
or bugs. Listed so you can pull any into MIGRATE if you disagree.

### S1. Commit co-author convention
> Every git commit in the kanji-learn repo includes two `Co-Authored-By` trailers: Claude, then Robert A. Dennis (Buddy) <buddydennis@gmail.com>. Buddy is credited as an active co-author.

### S2. Secret hygiene rule
> On kanji-learn, never echo plaintext secrets into transcripts: scope AWS CLI `--query` to keys only, never `cat`/read `.env` files, and treat secret rotation as a user-side action. A real exposure on 2026-04-20 (an unscoped `aws apprunner describe-service`) leaked seven keys and forced a rotation.

---

## §8 — Flagged as possibly STALE — verify before migrating  (category: `bug`, status: `stale`)

These memory items may already be resolved. Confirm against current state, then
move to MIGRATE (as historical record) or delete.

### X1. B9 — TestFlight build used local API URL
> Older Kanji Buddy bug (B9): a TestFlight build had `EXPO_PUBLIC_API_URL` pointing at a dev-machine LAN IP, so API calls failed for external testers. Very likely long resolved — the app has been on the deployed production API URL for many builds since. Verify, then keep as history or drop.

### X2. Study-mate invite surfacing gap
> Kanji Buddy gap observed 2026-04-24: incoming study-mate invites were only visible by manually navigating to Profile → Study Mates, with no push, badge, or banner. NOTE: this was the basis for B132 Item 1, which shipped a friend-request push and a Profile-tab badge — so this gap is now largely CLOSED. Migrate only as a "problem→solution" history pair with item 31, or drop.

### X3. Tutor-share Resend URL idea
> Kanji Buddy idea raised 2026-04-24: add a "Resend URL" action to the Share-with-Tutor pending state so a learner can re-share the invite link without revoking it. NOTE: this SHIPPED in B132 (commit `326dd71`). Migrate only as shipped history, or drop.

---

## Summary for the ingest step

- **MIGRATE by default:** items 1–33 (§1–§6) — 33 thoughts.
- **SKIP by default:** S1–S2 (§7).
- **DECIDE:** X1–X3 (§8) — stale/shipped; recommend dropping X2/X3 (covered by item 31) and verifying X1.
- Edit any wording above, then tell Claude: "ingest the migration file."
