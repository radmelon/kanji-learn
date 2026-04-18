# 漢字 Buddy — Enhancement Ideas

A prioritized backlog of potential improvements for the 漢字 Buddy app. Each item is tagged with estimated effort (S/M/L/XL), expected impact (Low/Med/High), whether backend changes are required, and current status. Items are ordered by priority within each section. Use this as a living document — check off items as they ship and add new ideas as they surface.

---

## 🚨 Security — Critical

> **Must fix immediately** — these are active security vulnerabilities flagged by Supabase.

- [ ] **Enable RLS on Remaining 5 Tables (Tutor + Placement)** — Audit on 2026-04-17 confirmed RLS is enabled on 30 of 35 public tables, including all major user-owned tables (`user_profiles`, `user_kanji_progress`, `review_logs`, `review_sessions`, `daily_stats`, `writing_attempts`, `voice_attempts`, `kl_test_sessions`, `kl_test_results`, `friendships`, `mnemonics`, `interventions`, etc.). The 5 tables still without RLS are all from feature branches merged after the initial security audit: `placement_sessions`, `placement_results`, `tutor_shares`, `tutor_notes`, `tutor_analysis_cache`. Each needs `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` plus policies (user-owned tables restrict to `auth.uid() = user_id`, service-role bypass where the API needs writes). Tutor tables also need a policy allowing teachers to read notes for shares they own by token — currently enforced only at the API layer.
  `[Effort: S]` `[Impact: Critical]` `[Backend: Yes]` `[Status: 🚨 Security]`

---

## 🃏 Study Card Enhancements

> **Highest priority** — directly requested by users. Several of these (stroke order, radicals, Nelson IDs) use data already stored in the database that just isn't surfaced in the UI yet, making them relatively quick wins.

- [x] **Full On/Kun Reading Display with Romaji Toggle** — Expand the KanjiCard to show all on-yomi and kun-yomi readings instead of capping at 3 each. Add a toggle button to show/hide romaji transliterations alongside the kana for learners who haven't memorized the kana sets yet.
  `[Effort: S]` `[Impact: High]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **Nelson Classic & New Dictionary IDs with Jisho Deep-Link** — Display the Nelson Classic and Nelson New index numbers (already stored in the DB) on the KanjiCard detail view. Render each as a tappable link that opens `jisho.org` (or the Nelson entry directly) so users can jump to authoritative reference material mid-study.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **Expandable "References" Section (JIS Code & Morohashi Index)** — Add a collapsible "References" bottom row on KanjiCard that reveals the JIS code, Morohashi index (volume + page), and any other dictionary identifiers stored in the DB. Keeps the card uncluttered by default while surfacing data for power users.
  `[Effort: S]` `[Impact: Low]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **Example Sentences for Vocab Words** — Show 1–2 short JLPT-appropriate example sentences on the KanjiCard and CompoundCard, with the target vocabulary highlighted. Sourced from Tatoeba CC-BY 2.0 via API (Claude Haiku fallback). Stored as `example_sentences` JSONB on the kanji table; seed script at `packages/db/src/seeds/seed-sentences.ts`. Run `pnpm --filter @kanji-learn/db seed:sentences` after running migration 0012.
  `[Effort: L]` `[Impact: High]` `[Backend: Yes]` `[Status: ✅ Shipped]`

- [x] **Stroke Order Animation** — Animate the kanji being drawn stroke-by-stroke using the KanjiVG SVG path data already stored in the DB. Accessible from a button on the KanjiCard; plays at normal speed with an option to step through one stroke at a time. No new data needed — purely a front-end rendering task.
  `[Effort: M]` `[Impact: High]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **Radical Decomposition Display** — Render the radical breakdown stored in the DB as a row of tappable radical chips on the KanjiCard. Tapping a radical could filter the kanji browser to show all kanji sharing that radical, helping users build pattern recognition across characters.
  `[Effort: M]` `[Impact: High]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **"Reveal All" Details Drawer** — Add an expandable bottom sheet on any study card that presents the full kanji record: all readings, all meanings, stroke count, JLPT level, radical breakdown, dictionary references, stroke order, and linked vocab. Lets curious learners explore deeply without cluttering the default card view.
  `[Effort: M]` `[Impact: High]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **Related Kanji Suggestions** — At the bottom of the details drawer, show 3–4 visually or semantically similar kanji (same radical, similar meaning, or commonly confused pairs). Helps learners build associations and avoid mix-ups between look-alike characters.
  `[Effort: M]` `[Impact: Med]` `[Backend: Yes]` `[Status: ✅ Shipped]`

- [ ] **Pitch Accent Indicator** — Display the pitch accent pattern (高低 pattern) for kun-yomi readings on the KanjiCard. Sourced from an open pitch accent dictionary (e.g., Wadoku or a bundled dataset). Particularly valuable for intermediate learners targeting natural spoken Japanese.
  `[Effort: L]` `[Impact: Med]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Distinguish Meaning vs Reading Prompts (Study Card)** — Users report that it's easy to blur what the card is asking for. Apply three complementary cues per prompt type: (1) colored border — violet (#7C3AED) for meaning prompts, amber (#F59E0B) for reading prompts, (2) a "Meaning" / "読み方" label below the kanji glyph using the spare whitespace, (3) a subtle 5–8% opacity background tint matching the border color. Reduces cognitive load at a glance.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **"Show Mnemonic" Button on Kanji Details Page** — Add a "Show mnemonic" button on the Kanji details page (reachable from Journal and the study card detail drawer). Default behavior: reveal the existing cached mnemonic for that kanji. If an AI mnemonic already exists, also surface a "Regenerate" option that requests a fresh one from the LLM. Keeps cost predictable (cached path is free); mirrors the Journal UX. Pairs with the mnemonic-trigger rework (mnemonics no longer auto-reveal on Hard — see Learning & SRS section) so users can still pull one up on demand.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Speak Button on Example Sentences (Kanji Details)** — The Kanji details page renders each example sentence (`exampleSentences` on `KanjiDetail`) as text-only today. Add a speak icon next to each sentence that plays the Japanese string via the existing Expo Speech TTS infra (`ja-JP`, rate ~0.9 — see `SPEECH_OPTS` in `apps/mobile/app/kanji/[id].tsx`). Mirrors the speak icons already on readings and vocab. Simple: one tap = play; disable icon while speaking to prevent overlap. Reuses existing `useTTS`/Expo Speech plumbing — no backend, no new data.
  `[Effort: XS]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Session Complete: High / Medium / Low / Missed Breakdown (replace "right vs wrong")** — `SessionComplete.tsx` currently shows a binary breakdown (`correct` vs `wrong`, where `wrong = totalItems - correctItems`). With the weighted 3/2/1/0 confidence metric shipped in B122, the binary breakdown no longer matches the percentage ring. Replace with a 4-tier count aligned to the grade buttons, all four summing to `totalItems`:
  - **High** = Easy (`quality === 5`)
  - **Medium** = Good (`quality === 4`)
  - **Low** = Hard (`quality === 3`)
  - **Missed** = Again (`quality === 1`)

  Invariant: `high + medium + low + missed === totalItems`. Use distinct colors per tier (green / blue / amber / red, or similar — use existing theme tokens; no new palette). Implementation: derive per-grade counts in the review store alongside `confidencePct` (the `results: ReviewResult[]` array already carries each quality), pass as props into `SessionComplete`, render 4 breakdown boxes replacing the current pair. Retire the old `correctItems` and `wrong` variables once all usages are migrated. Files: `apps/mobile/src/stores/review.store.ts::finishSession`, `apps/mobile/src/components/study/SessionComplete.tsx`, `apps/mobile/app/(tabs)/study.tsx` (prop thread).
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

---

## 📊 Analytics & Progress

- [x] **Fix: JLPT Progress Bars Show as Blank** — The JLPT progress bars on the dashboard are empty for most users because the bar width is calculated as `burned / total`. Burning a kanji requires months of correct reviews, so new and early-stage users see no fill at all. Fix: switch to a stacked bar showing all meaningful SRS stages — **seen** (learning + reviewing + remembered) in a muted fill, **burned** in a solid highlight — so the bar reflects real study progress from day one. This also makes the bar a richer signal (e.g. N5: 60% seen / 5% burned vs N1: 2% seen / 0% burned). Backend change: `levelProjections` in `GET /v1/analytics/summary` needs to return `seen` count in addition to `burned`; currently only `burned` is exposed.
  `[Effort: S]` `[Impact: High]` `[Backend: Yes]` `[Status: ✅ Shipped]`

- [x] **Fix: Journey Progress Bar Shows as Blank** — The Journey progress bar on the dashboard uses `completionPct = totalSeen / 2294 * 100`. For a user who has studied 50 kanji this renders as ~2% — a barely visible sliver that feels discouraging. Two fixes needed: (1) show a **dual-fill bar** — pale fill for seen/in-progress, solid fill for burned — so early progress is visually meaningful; (2) consider a log-scale or milestone-anchored axis so the first 100 kanji (N5 complete) feels like a genuine achievement rather than 4% of the whole. No API change needed; purely a UI rework in `index.tsx`.
  `[Effort: S]` `[Impact: High]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **Dashboard JLPT Bars: Match Progress Page Style** — The dashboard JLPT progress bars use a simple dual-fill (seen vs burned), but the progress page kanji breakdown uses a richer stacked bar showing all SRS stages (new, learning, reviewing, remembered, burned). Align the dashboard bars to use the same multi-segment stacked style so users see a consistent visualization across both screens.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped]`

- [ ] **Heatmap Calendar View** — A GitHub-style contribution heatmap showing daily study activity over the past year. Color intensity represents cards reviewed that day. Gives users a satisfying visual record of consistency and motivates streak maintenance.
  `[Effort: M]` `[Impact: High]` `[Backend: No]` `[Status: 💡 Idea]`

- [x] **Accuracy Breakdown by Review Type** — Break down correct/incorrect rates separately for meaning, reading, writing, and compound review types. Surfaces which modality a user struggles with most so they can focus their study time more intentionally.
  `[Effort: S]` `[Impact: High]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **JLPT Level Completion Progress** — Show a per-level progress bar (e.g., "N5: 72% mastered, 18% learning, 10% not started"). Gives learners a concrete milestone to work toward and a clear sense of how close they are to full level coverage.
  `[Effort: S]` `[Impact: High]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **Projected JLPT Exam Readiness Date** — Using current velocity and the number of remaining kanji at the target JLPT level, calculate and display an estimated date by which the user will have reviewed all kanji at least once. Updates dynamically as study pace changes.
  `[Effort: M]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped]`

- [ ] **Retention Rate Over Time Graph** — A line chart showing overall answer accuracy as a rolling 7-day or 30-day average. Helps users see whether their retention is improving or declining and whether SRS intervals are calibrated well.
  `[Effort: M]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [x] **Personal Records & Milestones** — Surface achievement-style milestones ("First 100 kanji mastered", "30-day streak", "All N5 complete") with a simple notification or badge. Low-effort motivation boost; no new data infrastructure needed.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped]`

- [ ] **Grade Level Equivalent (Kyouiku Kanji)** — Display the Japanese school grade level equivalent on the progress page based on the Kyouiku kanji list (教育漢字). Shows users where they stand relative to the Japanese elementary school curriculum (grades 1–6, ~1,026 kanji). Provides a tangible, alternative progress metric alongside JLPT levels.
  `[Effort: M]` `[Impact: Med]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **JLPT Progress Panel: Add Color Legend** — The Dashboard JLPT info panel and the Progress tab both use a multi-segment stacked bar (learning / reviewing / remembered / burned), but the color-to-stage mapping is implicit. Add a compact legend (colored dots + labels on one row) beneath or alongside the bar so users can read the bar without guessing.
  `[Effort: XS]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Leaderboard: Add Days-Studied + Remembered-Count Columns** — Augment the Leaderboard with two new metrics: `totalDaysStudied` (lifetime count of days with ≥1 review) and `rememberedCount` (kanji at status `remembered` or `burned`). Keep existing columns. Single sort order with tiebreakers: streak days → total days studied → remembered count. Requires exposing the new fields in `GET /v1/social/leaderboard` and extending `LeaderboardEntry` in [apps/mobile/src/hooks/useSocial.ts](apps/mobile/src/hooks/useSocial.ts).
  `[Effort: S]` `[Impact: Med]` `[Backend: Yes]` `[Status: 💡 Idea]`

---

## 🧠 Learning & SRS

- [ ] **Leech Detection & Leech Review Mode** — Flag cards that have been failed a configurable number of times (default: 8) as "leeches." Surface leeches in a dedicated review session with extra hints (mnemonics, stroke order, example sentences) to help break the cycle of repeated failure.
  `[Effort: M]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Custom Study Session Builder** — Let users create a filtered study session by JLPT level, SRS stage, radical, or a manually selected set of kanji. Sessions don't affect SRS intervals unless the user opts in, making it safe for targeted practice.
  `[Effort: L]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Cram Mode** — A study mode that presents cards in rapid succession without updating SRS intervals or streaks. Ideal for last-minute exam prep or revisiting a lesson without "polluting" long-term SRS data.
  `[Effort: M]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [x] **Undo Last Card Grade** — Add an undo button that reverses the most recent card grade and re-presents the card. Prevents accidental fat-finger taps from skewing SRS intervals. Limit to one level of undo to keep implementation simple.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **Audio Pronunciation (TTS for Readings)** — Play a text-to-speech audio clip of the on/kun readings and example vocabulary when a card is flipped. Can use the device's built-in TTS engine (Expo Speech) as a zero-cost first pass before considering native speaker recordings.
  `[Effort: S]` `[Impact: High]` `[Backend: No]` `[Status: ✅ Shipped]`

- [ ] **Adaptive Daily Goal** — Automatically suggest a daily card goal adjustment when the user consistently finishes well under or far over their goal. Keeps the daily goal realistic and prevents review pile-up from over-ambitious targets.
  `[Effort: M]` `[Impact: Med]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Weighted Confidence Scoring (Easy=3 / Good=2 / Hard=1 / Again=0)** — Today the dashboard "confidence" metric treats grades binarily (Easy|Good = correct, Hard|Again = incorrect). Switch to a weighted average: normalized to `sum(score) / (3 × total) × 100`. Same 4 grade buttons — no new UI. Hard and Again still keep the card in the queue. Historical reviews stay under the old binary formula (no data backfill needed). The daily Quiz continues to use binary correct/incorrect. Ship together with the mnemonic-trigger rework below.
  `[Effort: M]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Mnemonic Auto-Reveal: Only on "Again"** — Currently both Hard and Again auto-reveal the mnemonic after grading. Narrow this to Again-only — Hard returns the card to the queue without revealing. Users who want to see the mnemonic on a Hard or Good can reach it manually via the new "Show mnemonic" button on the Kanji details page (see Study Card Enhancements). Ship together with weighted confidence scoring.
  `[Effort: XS]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

---

## 🎨 UI & Experience

- [ ] **Dark / Light Theme Toggle** — Add a manual theme toggle (with system default option) for dark and light mode. Dark mode is especially useful for late-night study sessions and is a highly requested feature in language learning apps.
  `[Effort: M]` `[Impact: High]` `[Backend: No]` `[Status: 💡 Idea]`

- [x] **Haptic Feedback on Grade Buttons** — Trigger subtle haptic patterns (light tap for "Again", medium for "Hard", strong for "Easy") when grading cards. Adds a tactile dimension to the grading action and makes the UI feel more responsive and polished.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **Swipe Gestures for Grading** — Allow users to swipe the card right for "Easy", left for "Again", and down for "Hard" instead of tapping grade buttons. Speeds up review sessions and feels more natural for mobile-first users.
  `[Effort: M]` `[Impact: High]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **Swipe Up/Down Grading (Watch Parity)** — Update the mobile swipe gesture directions to match the Apple Watch behavior (swipe up/down) for consistency across devices. Users who review on both phone and Watch currently have to remember different swipe mappings.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped]`

- [ ] **Home Screen Widget (Daily Progress)** — A small iOS/Android home screen widget showing today's review count, streak, and cards remaining. Keeps the app top-of-mind without requiring the user to open it to check progress.
  `[Effort: L]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [x] **Onboarding Tutorial** — A guided first-run walkthrough that explains the SRS system, how review types work, and how to interpret card metadata. Reduces early churn from users who don't understand spaced repetition and abandon the app prematurely.
  `[Effort: M]` `[Impact: High]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **Card Flip Animation Polish** — Add a smooth 3D card-flip animation when revealing the answer side of a flashcard. A small UX detail that significantly improves the feel of the core study loop.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped]`

- [ ] **Accuracy → Confidence Terminology Audit** — The app uses "confidence" to describe the self-graded SRS score (Easy/Good/Hard/Again) but still shows "accuracy" in several user-facing strings (e.g. Session Complete ring label, Drill Weak Spots dialog, Progress tab info panels "Avg accuracy" and "Accuracy colour coding", session history rows). Sweep every user-facing "accuracy" string and flip to "confidence" wherever the context is SRS. Writing and voice practice statistics remain "accuracy" (they're objective stroke / speech scores). Internal variable names don't need to change.
  `[Effort: S]` `[Impact: Low]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Onboarding findHelp Panel: Append Motivational Line** — Append the sentence `"Studying daily is the key to making progress."` to the existing footer on the onboarding findHelp panel (after `"You don't need to memorise any of this now."`). File: [apps/mobile/src/config/onboarding-content.ts](apps/mobile/src/config/onboarding-content.ts). OTA-updatable — no rebuild needed.
  `[Effort: XS]` `[Impact: Low]` `[Backend: No]` `[Status: 💡 Idea]`

---

## 🔐 Authentication

- [x] **OAuth 2.0 Social Login (Apple, Google)** — Add Sign in with Apple and Sign in with Google as registration and login options alongside the existing email/password flow. Reduces sign-up friction significantly — users skip the email/password form entirely and authenticate with a single tap. Sign in with Apple is required by App Store guidelines for any app that offers third-party social login. Supabase supports both providers natively via its Auth module; integration requires (1) configuring the OAuth app credentials in the Supabase dashboard, (2) adding the Apple and Google entitlements/capabilities to the Expo project via a config plugin, (3) adding deep-link redirect URL handling for the OAuth callback, (4) updating the auth store and login screen to offer provider buttons alongside the email form, and (5) handling the `user_profiles` row creation for OAuth users (the existing `on_user_created` DB trigger should handle this automatically).
  `[Effort: M]` `[Impact: High]` `[Backend: Yes]` `[Status: ✅ Shipped]`

- [x] **Delete Account (App Store 5.1.1 compliance)** — In-app account deletion required by App Store Review Guideline 5.1.1. Profile tab → "Danger zone" → typed-DELETE confirmation modal → `DELETE /v1/user/me` API → `supabaseAdmin.auth.admin.deleteUser()` triggers FK cascade through `auth.users → user_profiles → learner_identity` and every user-keyed table → farewell screen → sign-in. Hard delete only, no grace period. Spec at `docs/superpowers/specs/2026-04-17-delete-account-design.md`, plan at `docs/superpowers/plans/2026-04-17-delete-account.md`.
  `[Effort: M]` `[Impact: High]` `[Backend: Yes]` `[Status: ✅ Shipped (B120, awaiting TestFlight verification)]`

---

## 🔧 Backend & Data

- [x] **Example Sentences API Integration** — Integrate a sentence corpus (Tatoeba CC-BY or a curated JLPT sentence dataset) into the backend. Index sentences by vocabulary and expose a `/sentences?vocab=xxx` endpoint for the card UI to call. Consider pre-caching at the kanji/vocab level to avoid latency during review.
  `[Effort: L]` `[Impact: High]` `[Backend: Yes]` `[Status: ✅ Shipped]`

- [x] **Placement Test (Adaptive Kanji Self-Assessment)** — An adaptive ~50-question test surfaced during sign-up and in Settings that identifies which kanji a user already knows. Starts at N3, shifts up/down based on a 5-question performance window (≥70% pass → level up, ≤30% → level down). Each kanji is tested in two phases: meaning MCQ first, then reading MCQ (hiragana) only if meaning is correct. Kanji that pass both phases are written to `user_kanji_progress` as `remembered` (21-day interval) so the SRS queue skips them. Correctly-remembered/burned kanji are never downgraded. Architecture: adaptive engine in `packages/shared`, two API endpoints (`GET /v1/placement/kanji-ids`, `POST /v1/placement/questions`, `POST /v1/placement/complete`), Zustand store, and a dedicated `(auth)/placement.tsx` screen. Full design spec at `~/.claude/plans/fluffy-gliding-thunder.md`.
  `[Effort: L]` `[Impact: High]` `[Backend: Yes]` `[Status: ✅ Shipped]`

- [ ] **Data Export (CSV / JSON)** — Allow users to export their full study history — card grades, timestamps, SRS intervals — as a CSV or JSON file. Builds trust with users who worry about data lock-in and satisfies power users who want to run their own analysis.
  `[Effort: M]` `[Impact: Med]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Multiple SRS Deck Support** — Allow users to create custom decks (e.g., "JLPT N3 Vocab", "Business Kanji") alongside the default deck. Each deck has its own SRS queue and daily goal, enabling more targeted study campaigns.
  `[Effort: XL]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Webhook / Zapier Integration for Study Events** — Emit events (streak milestone reached, level completed, daily goal hit) to a configurable webhook URL. Enables power users to build their own integrations (e.g., log to Notion, trigger a Discord message, update a spreadsheet).
  `[Effort: M]` `[Impact: Low]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Broaden Streak to Count All Study Activity (Not Just SRS Reviews)** — The daily streak currently only counts days where the user submitted at least one SRS review (`daily_stats.reviewed >= 1`). Placement test sessions, quiz sessions, and writing practice attempts do NOT contribute to the streak, so a student who spends 30 min taking a placement test on a given day will still see their streak broken the next day. Fix options: (a) change the streak query in `analytics.service.ts` and `tutor-report.service.ts` to look at any-activity — `placement_sessions.completed_at`, `test_sessions.completed_at`, `writing_attempts.created_at`, or `daily_stats.reviewed >= 1`; (b) introduce a `recordStudyActivity(userId, date)` helper that upserts a `daily_stats` row whenever any study activity completes, then change the streak filter from `reviewed >= 1` to `(reviewed >= 1 OR study_time_ms > 0)`. Option (b) is simpler and localizes the change. Also update the mobile dashboard streak widget consistently.
  `[Effort: S]` `[Impact: Med]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Japanese Language Option for Tutor Report** — Add a language toggle (EN/JP) to the tutor report so it can be viewed entirely in Japanese. This includes all section headings, stat labels, chart legends, footnotes, and the AI analysis itself. The AI analysis prompt should be sent with a Japanese system prompt so Claude generates strengths, recommendations, and observations in natural Japanese. Many students will work with native Japanese-speaking tutors who would benefit from reviewing the report in their own language. Implementation: (1) add a `?lang=ja` query param to the report route, (2) create a parallel `report-ja.eta` template (or use ETA partials with i18n keys), (3) add a Japanese variant of the analysis system prompt in `tutor-analysis.service.ts`, (4) cache Japanese analysis separately in `tutor_analysis_cache` (e.g. `analysis_json_ja` column or a `locale` discriminator).
  `[Effort: L]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Configure Groq & Gemini API keys on App Runner** — The LLM router's tier 2 providers (Groq and Gemini) have no API keys set in the App Runner environment. This means any LLM request that can't use tier 3 (Claude) falls through to tier 2 and fails with "Both tier 2 providers failed". Add `GROQ_API_KEY` and `GEMINI_API_KEY` to the App Runner service environment variables so the full tiered fallback chain works. This also reduces cost by allowing cheaper tier 2 models to handle non-critical LLM calls (e.g., mnemonic generation, quick diagnostics).
  `[Effort: XS]` `[Impact: High]` `[Backend: Yes]` `[Status: 🚀 Pre-Launch]`

- [ ] **Migrate Supabase DB to us-east-1** — The Supabase project is currently hosted in `ap-southeast-2` (Sydney) while App Runner, ECR, SES, and Lambda all run in `us-east-1`. Every API request pays ~200ms cross-region latency to the database. Before public release, migrate the Supabase project to `us-east-1` to co-locate with the rest of the infrastructure. Steps: (1) create a new Supabase project in us-east-1, (2) `pg_dump` the existing database and restore into the new project, (3) update `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` in App Runner env vars, Lambda env vars, mobile app EAS environment, and local `.env`, (4) verify RLS policies and triggers transferred correctly, (5) decommission the Sydney project. Schedule during a maintenance window — requires brief downtime for the cutover.
  `[Effort: M]` `[Impact: High]` `[Backend: Yes]` `[Status: 🚀 Pre-Launch]`

- [ ] **Backend Scaling: Analytics Cache + Supabase Pro Upgrade** — The `/v1/analytics/summary` endpoint runs 8–10 complex SQL aggregations per request and is the primary DB bottleneck at scale (observed 400–1200ms per call). Full scaling plan in `docs/SCALING.md`. Phase 1 (pre-launch): add a per-user `user_stats_cache` table updated after each review session; dashboard reads cache row instead of running live aggregations. Phase 2 (500+ users): upgrade Supabase to Pro tier for dedicated compute and higher pooler limits. Phase 3 (2K+ users): read replica for analytics, App Runner min-instance configuration. The current transaction-mode PgBouncer fix (5 conn/instance) supports ~300–500 concurrent active users before Phase 1 is needed.
  `[Effort: M]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

---

## 🔮 Future / Big Ideas

- [ ] **OCR Kanji Lookup** — Point the device camera at any Japanese text to detect and look up kanji in real time. Tapping a detected character opens the full KanjiCard detail view. Requires an on-device or cloud OCR model and a camera permission flow.
  `[Effort: XL]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Graded Reading Passage Mode** — Present short, JLPT-level-appropriate reading passages where any kanji can be tapped to reveal its card details. Bridges the gap between isolated flashcard study and real reading comprehension practice.
  `[Effort: XL]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [x] **Social Features (Study Groups & Shared Mnemonics)** — Let users join study groups, compare streaks on a leaderboard, and share or upvote community-created mnemonics. Adds an accountability and discovery layer on top of the existing mnemonic system.
  `[Effort: XL]` `[Impact: Med]` `[Backend: Yes]` `[Status: ✅ Shipped]`

- [ ] **Study Group Milestone: Top Performer Badge** — Add a milestone badge awarded when a user is the top performer in their study group. Adds a competitive motivation layer to the existing social features.
  `[Effort: S]` `[Impact: Med]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Study Group: Expanded Shared Stats** — Share daily average, day streak, and mastered kanji count in study groups in addition to burned count. Consider including grade level equivalent (Kyouiku) as an additional shared metric. Gives group members a richer picture of each other's progress and consistency.
  `[Effort: S]` `[Impact: Med]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Study Mate Invite Notifications** — Currently, incoming study mate invites are only discoverable by manually navigating to Profile → Study Mates. Recipients receive no push notification, no badge on the Profile tab, and no app-launch prompt. Three improvements: (1) send a push notification via the existing Expo push infrastructure when a friend request is created (`POST /v1/social/request`), (2) add a badge/dot indicator on the Profile tab when pending invites exist, and (3) optionally show a modal on app launch if there are new pending invites since last session. The notification service already handles study mate activity alerts — friend request notifications follow the same pattern.
  `[Effort: S]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [x] **Apple Watch Complication for Quick Reviews** — A watchOS companion app that surfaces the 5 most urgent due cards for a quick wrist-based review session. Ideal for commuters or users who want to squeeze in micro-study sessions throughout the day.
  `[Effort: XL]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped]`

- [ ] **iPad & Mac Catalyst Support** — Optimize the layout for larger screens with a two-column study view (card on left, details/mnemonics on right) and full keyboard shortcut support for grading. Opens the app to desktop study sessions and multi-device users.
  `[Effort: L]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **AI-Powered Personalized Study Plan** — Use the user's error history, leech patterns, and JLPT target date to generate a week-by-week study roadmap. The plan dynamically adjusts based on actual performance and flags which radicals or reading patterns are causing the most failures.
  `[Effort: XL]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Dashboard "Invite a Study Mate" Banner** — When the user has zero study mates and hasn't dismissed the prompt in the past 7 days, show a dismissible banner on the Dashboard encouraging them to invite a friend. Tap → opens the existing invite flow. The X / dismiss button writes a `studyMateInviteDismissedAt` timestamp to `AsyncStorage` so the banner reappears after the cooldown. Distinct from the existing "Study Mate Invite Notifications" idea (which handles *receiving* invites).
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Study Mate Nudge / "Poke"** — Add a tappable nudge action on each row of the Study Mates list. Rate-limited to one poke per sender → receiver per 24-hour window. On send: push notification to the receiver (`"{senderName} poked you — time to study!"`), with Apple Watch haptic if the Watch companion is paired. Each poker sends a separate push (not aggregated). The receiver's Study Mates list shows a "You were poked" indicator next to the sender's row until acknowledged. Requires a new `pokes` table, API endpoint, push delivery, mates-list UI, and Watch complication update.
  `[Effort: L]` `[Impact: Med]` `[Backend: Yes]` `[Status: 💡 Idea]`
