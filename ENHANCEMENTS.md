# 漢字 Buddy — Enhancement Ideas

A prioritized backlog of potential improvements for the 漢字 Buddy app. Each item is tagged with estimated effort (S/M/L/XL), expected impact (Low/Med/High), whether backend changes are required, and current status. Items are ordered by priority within each section. Use this as a living document — check off items as they ship and add new ideas as they surface.

---

## 🃏 Study Card Enhancements

> **Highest priority** — directly requested by users. Several of these (stroke order, radicals, Nelson IDs) use data already stored in the database that just isn't surfaced in the UI yet, making them relatively quick wins.

- [ ] **Full On/Kun Reading Display with Romaji Toggle** — Expand the KanjiCard to show all on-yomi and kun-yomi readings instead of capping at 3 each. Add a toggle button to show/hide romaji transliterations alongside the kana for learners who haven't memorized the kana sets yet.
  `[Effort: S]` `[Impact: High]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Nelson Classic & New Dictionary IDs with Jisho Deep-Link** — Display the Nelson Classic and Nelson New index numbers (already stored in the DB) on the KanjiCard detail view. Render each as a tappable link that opens `jisho.org` (or the Nelson entry directly) so users can jump to authoritative reference material mid-study.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Expandable "References" Section (JIS Code & Morohashi Index)** — Add a collapsible "References" bottom row on KanjiCard that reveals the JIS code, Morohashi index (volume + page), and any other dictionary identifiers stored in the DB. Keeps the card uncluttered by default while surfacing data for power users.
  `[Effort: S]` `[Impact: Low]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Example Sentences for Vocab Words** — Show 1–2 short JLPT-appropriate example sentences on the KanjiCard and CompoundCard, with the target vocabulary highlighted. The DB currently stores vocab examples (word/reading/meaning) but no full sentence text. Requires: (1) sourcing a sentence corpus — Tatoeba CC-BY or a curated JLPT sentence dataset are the best free options; (2) enriching the seed data or adding a new `example_sentences` table keyed by vocabulary; (3) a backend endpoint `/sentences?vocab=xxx`; (4) updating the card UI to display and audio-play each sentence. The Tatoeba Japanese–English dataset has ~200k sentence pairs and is freely available at tatoeba.org/en/downloads.
  `[Effort: L]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Stroke Order Animation** — Animate the kanji being drawn stroke-by-stroke using the KanjiVG SVG path data already stored in the DB. Accessible from a button on the KanjiCard; plays at normal speed with an option to step through one stroke at a time. No new data needed — purely a front-end rendering task.
  `[Effort: M]` `[Impact: High]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Radical Decomposition Display** — Render the radical breakdown stored in the DB as a row of tappable radical chips on the KanjiCard. Tapping a radical could filter the kanji browser to show all kanji sharing that radical, helping users build pattern recognition across characters.
  `[Effort: M]` `[Impact: High]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **"Reveal All" Details Drawer** — Add an expandable bottom sheet on any study card that presents the full kanji record: all readings, all meanings, stroke count, JLPT level, radical breakdown, dictionary references, stroke order, and linked vocab. Lets curious learners explore deeply without cluttering the default card view.
  `[Effort: M]` `[Impact: High]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Related Kanji Suggestions** — At the bottom of the details drawer, show 3–4 visually or semantically similar kanji (same radical, similar meaning, or commonly confused pairs). Helps learners build associations and avoid mix-ups between look-alike characters.
  `[Effort: M]` `[Impact: Med]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Pitch Accent Indicator** — Display the pitch accent pattern (高低 pattern) for kun-yomi readings on the KanjiCard. Sourced from an open pitch accent dictionary (e.g., Wadoku or a bundled dataset). Particularly valuable for intermediate learners targeting natural spoken Japanese.
  `[Effort: L]` `[Impact: Med]` `[Backend: Yes]` `[Status: 💡 Idea]`

---

## 📊 Analytics & Progress

- [ ] **Heatmap Calendar View** — A GitHub-style contribution heatmap showing daily study activity over the past year. Color intensity represents cards reviewed that day. Gives users a satisfying visual record of consistency and motivates streak maintenance.
  `[Effort: M]` `[Impact: High]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Accuracy Breakdown by Review Type** — Break down correct/incorrect rates separately for meaning, reading, writing, and compound review types. Surfaces which modality a user struggles with most so they can focus their study time more intentionally.
  `[Effort: S]` `[Impact: High]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **JLPT Level Completion Progress** — Show a per-level progress bar (e.g., "N5: 72% mastered, 18% learning, 10% not started"). Gives learners a concrete milestone to work toward and a clear sense of how close they are to full level coverage.
  `[Effort: S]` `[Impact: High]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Projected JLPT Exam Readiness Date** — Using current velocity and the number of remaining kanji at the target JLPT level, calculate and display an estimated date by which the user will have reviewed all kanji at least once. Updates dynamically as study pace changes.
  `[Effort: M]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Retention Rate Over Time Graph** — A line chart showing overall answer accuracy as a rolling 7-day or 30-day average. Helps users see whether their retention is improving or declining and whether SRS intervals are calibrated well.
  `[Effort: M]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Personal Records & Milestones** — Surface achievement-style milestones ("First 100 kanji mastered", "30-day streak", "All N5 complete") with a simple notification or badge. Low-effort motivation boost; no new data infrastructure needed.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

---

## 🧠 Learning & SRS

- [ ] **Leech Detection & Leech Review Mode** — Flag cards that have been failed a configurable number of times (default: 8) as "leeches." Surface leeches in a dedicated review session with extra hints (mnemonics, stroke order, example sentences) to help break the cycle of repeated failure.
  `[Effort: M]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Custom Study Session Builder** — Let users create a filtered study session by JLPT level, SRS stage, radical, or a manually selected set of kanji. Sessions don't affect SRS intervals unless the user opts in, making it safe for targeted practice.
  `[Effort: L]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Cram Mode** — A study mode that presents cards in rapid succession without updating SRS intervals or streaks. Ideal for last-minute exam prep or revisiting a lesson without "polluting" long-term SRS data.
  `[Effort: M]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Undo Last Card Grade** — Add an undo button that reverses the most recent card grade and re-presents the card. Prevents accidental fat-finger taps from skewing SRS intervals. Limit to one level of undo to keep implementation simple.
  `[Effort: S]` `[Impact: Med]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Audio Pronunciation (TTS for Readings)** — Play a text-to-speech audio clip of the on/kun readings and example vocabulary when a card is flipped. Can use the device's built-in TTS engine (Expo Speech) as a zero-cost first pass before considering native speaker recordings.
  `[Effort: S]` `[Impact: High]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Adaptive Daily Goal** — Automatically suggest a daily card goal adjustment when the user consistently finishes well under or far over their goal. Keeps the daily goal realistic and prevents review pile-up from over-ambitious targets.
  `[Effort: M]` `[Impact: Med]` `[Backend: Yes]` `[Status: 💡 Idea]`

---

## 🎨 UI & Experience

- [ ] **Dark / Light Theme Toggle** — Add a manual theme toggle (with system default option) for dark and light mode. Dark mode is especially useful for late-night study sessions and is a highly requested feature in language learning apps.
  `[Effort: M]` `[Impact: High]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Haptic Feedback on Grade Buttons** — Trigger subtle haptic patterns (light tap for "Again", medium for "Hard", strong for "Easy") when grading cards. Adds a tactile dimension to the grading action and makes the UI feel more responsive and polished.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Swipe Gestures for Grading** — Allow users to swipe the card right for "Easy", left for "Again", and down for "Hard" instead of tapping grade buttons. Speeds up review sessions and feels more natural for mobile-first users.
  `[Effort: M]` `[Impact: High]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Home Screen Widget (Daily Progress)** — A small iOS/Android home screen widget showing today's review count, streak, and cards remaining. Keeps the app top-of-mind without requiring the user to open it to check progress.
  `[Effort: L]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Onboarding Tutorial** — A guided first-run walkthrough that explains the SRS system, how review types work, and how to interpret card metadata. Reduces early churn from users who don't understand spaced repetition and abandon the app prematurely.
  `[Effort: M]` `[Impact: High]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Card Flip Animation Polish** — Add a smooth 3D card-flip animation when revealing the answer side of a flashcard. A small UX detail that significantly improves the feel of the core study loop.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

---

## 🔧 Backend & Data

- [ ] **Example Sentences API Integration** — Integrate a sentence corpus (Tatoeba CC-BY or a curated JLPT sentence dataset) into the backend. Index sentences by vocabulary and expose a `/sentences?vocab=xxx` endpoint for the card UI to call. Consider pre-caching at the kanji/vocab level to avoid latency during review.
  `[Effort: L]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Bulk Import of Known Kanji (Onboarding Self-Assessment)** — Let new users mark kanji they already know during onboarding (e.g., via a quick JLPT-level self-assessment quiz or a manual selection grid). Bootstraps their SRS with realistic starting intervals rather than treating everything as new.
  `[Effort: L]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Data Export (CSV / JSON)** — Allow users to export their full study history — card grades, timestamps, SRS intervals — as a CSV or JSON file. Builds trust with users who worry about data lock-in and satisfies power users who want to run their own analysis.
  `[Effort: M]` `[Impact: Med]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Multiple SRS Deck Support** — Allow users to create custom decks (e.g., "JLPT N3 Vocab", "Business Kanji") alongside the default deck. Each deck has its own SRS queue and daily goal, enabling more targeted study campaigns.
  `[Effort: XL]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Webhook / Zapier Integration for Study Events** — Emit events (streak milestone reached, level completed, daily goal hit) to a configurable webhook URL. Enables power users to build their own integrations (e.g., log to Notion, trigger a Discord message, update a spreadsheet).
  `[Effort: M]` `[Impact: Low]` `[Backend: Yes]` `[Status: 💡 Idea]`

---

## 🔮 Future / Big Ideas

- [ ] **OCR Kanji Lookup** — Point the device camera at any Japanese text to detect and look up kanji in real time. Tapping a detected character opens the full KanjiCard detail view. Requires an on-device or cloud OCR model and a camera permission flow.
  `[Effort: XL]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Graded Reading Passage Mode** — Present short, JLPT-level-appropriate reading passages where any kanji can be tapped to reveal its card details. Bridges the gap between isolated flashcard study and real reading comprehension practice.
  `[Effort: XL]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Social Features (Study Groups & Shared Mnemonics)** — Let users join study groups, compare streaks on a leaderboard, and share or upvote community-created mnemonics. Adds an accountability and discovery layer on top of the existing mnemonic system.
  `[Effort: XL]` `[Impact: Med]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [ ] **Apple Watch Complication for Quick Reviews** — A watchOS companion app that surfaces the 5 most urgent due cards for a quick wrist-based review session. Ideal for commuters or users who want to squeeze in micro-study sessions throughout the day.
  `[Effort: XL]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **iPad & Mac Catalyst Support** — Optimize the layout for larger screens with a two-column study view (card on left, details/mnemonics on right) and full keyboard shortcut support for grading. Opens the app to desktop study sessions and multi-device users.
  `[Effort: L]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **AI-Powered Personalized Study Plan** — Use the user's error history, leech patterns, and JLPT target date to generate a week-by-week study roadmap. The plan dynamically adjusts based on actual performance and flags which radicals or reading patterns are causing the most failures.
  `[Effort: XL]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`
