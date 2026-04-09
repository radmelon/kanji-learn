# 漢字 Buddy — Enhancement Ideas

A prioritized backlog of potential improvements for the 漢字 Buddy app. Each item is tagged with estimated effort (S/M/L/XL), expected impact (Low/Med/High), whether backend changes are required, and current status. Items are ordered by priority within each section. Use this as a living document — check off items as they ship and add new ideas as they surface.

---

## 🚨 Security — Critical

> **Must fix immediately** — these are active security vulnerabilities flagged by Supabase.

- [ ] **Enable Row-Level Security on All Public Tables** — Row-Level Security is only enabled on the `kanji` table. All other tables (`user_profiles`, `user_kanji_progress`, `review_sessions`, `review_logs`, `mnemonics`, `daily_stats`, `interventions`, `writing_attempts`, `voice_attempts`, `test_sessions`, `test_results`, `friendships`) are publicly accessible to anyone with the project URL. Each table needs `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` plus appropriate policies: user-owned tables should restrict to `auth.uid() = user_id`, the `kanji` table (already done) allows public read, and service-role bypass policies should be added where the API server needs write access.
  `[Effort: M]` `[Impact: Critical]` `[Backend: Yes]` `[Status: 🚨 Security]`

- [ ] **Restrict Sensitive Column Exposure on user_profiles** — The `user_profiles` table contains sensitive data (email, push token, timezone, reminder preferences) and is accessible through the API without any access restrictions. Enable RLS and create policies so users can only read/update their own profile. For social features (friends, leaderboards), create a restricted SELECT policy that only exposes `id`, `display_name`, and aggregate stats to other authenticated users — never email or push tokens.
  `[Effort: M]` `[Impact: Critical]` `[Backend: Yes]` `[Status: 🚨 Security]`

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

- [ ] **Onboarding Tutorial** — A guided first-run walkthrough that explains the SRS system, how review types work, and how to interpret card metadata. Reduces early churn from users who don't understand spaced repetition and abandon the app prematurely.
  `[Effort: M]` `[Impact: High]` `[Backend: No]` `[Status: 💡 Idea]`

- [x] **Card Flip Animation Polish** — Add a smooth 3D card-flip animation when revealing the answer side of a flashcard. A small UX detail that significantly improves the feel of the core study loop.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped]`

---

## 🔐 Authentication

- [ ] **OAuth 2.0 Social Login (Apple, Google)** — Add Sign in with Apple and Sign in with Google as registration and login options alongside the existing email/password flow. Reduces sign-up friction significantly — users skip the email/password form entirely and authenticate with a single tap. Sign in with Apple is required by App Store guidelines for any app that offers third-party social login. Supabase supports both providers natively via its Auth module; integration requires (1) configuring the OAuth app credentials in the Supabase dashboard, (2) adding the Apple and Google entitlements/capabilities to the Expo project via a config plugin, (3) adding deep-link redirect URL handling for the OAuth callback, (4) updating the auth store and login screen to offer provider buttons alongside the email form, and (5) handling the `user_profiles` row creation for OAuth users (the existing `on_user_created` DB trigger should handle this automatically).
  `[Effort: M]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

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

- [x] **Apple Watch Complication for Quick Reviews** — A watchOS companion app that surfaces the 5 most urgent due cards for a quick wrist-based review session. Ideal for commuters or users who want to squeeze in micro-study sessions throughout the day.
  `[Effort: XL]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped]`

- [ ] **iPad & Mac Catalyst Support** — Optimize the layout for larger screens with a two-column study view (card on left, details/mnemonics on right) and full keyboard shortcut support for grading. Opens the app to desktop study sessions and multi-device users.
  `[Effort: L]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **AI-Powered Personalized Study Plan** — Use the user's error history, leech patterns, and JLPT target date to generate a week-by-week study roadmap. The plan dynamically adjusts based on actual performance and flags which radicals or reading patterns are causing the most failures.
  `[Effort: XL]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`
