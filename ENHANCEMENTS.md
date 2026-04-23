# 漢字 Buddy — Enhancement Ideas

A prioritized backlog of potential improvements for the 漢字 Buddy app. Each item is tagged with estimated effort (S/M/L/XL), expected impact (Low/Med/High), whether backend changes are required, and current status. Items are ordered by priority within each section. Use this as a living document — check off items as they ship and add new ideas as they surface.

---

## 🚨 Security — Critical

> **Must fix immediately** — these are active security vulnerabilities flagged by Supabase.

- [x] **Enable RLS on Remaining 5 Tables (Tutor + Placement)** — ~~SHIPPED~~ 2026-04-19 via migration 0018. RLS enabled on `placement_sessions`, `placement_results`, `tutor_shares`, `tutor_notes`, `tutor_analysis_cache`. Each gets an authenticated-user policy scoped via `auth.uid() = user_id` (or via parent table for child rows) plus an explicit service_role bypass policy, matching the pattern from migration 0009. Tutor notes use a SELECT-only policy for the owning student — tutor writes flow through the API's service_role since tutors authenticate by opaque share token, not Supabase auth. Verified post-apply: all 5 tables show `rowsecurity = t` with 2 policies each.
  `[Effort: S]` `[Impact: Critical]` `[Backend: Yes]` `[Status: ✅ Shipped]`

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

- [ ] **Pitch Accent Indicator** — Display the pitch accent pattern (高低 pattern) on vocab/reading entries. **Status 2026-04-20: data shipped, UI pending.** Kanjium snapshot vendored at `packages/db/data/kanjium/accents.txt` (commit `d3346b9`); the vocab seed (`enrich-vocab.ts`) now merges Tokyo-primary pitch patterns into each `example_vocab` entry as `pitchPattern: number[]`. Prod coverage: 8,053 vocab entries have pitch data (~75% of accepted entries; the tail has Kanjium gaps for rare vocab). UI rendering component (NHK-style overline) + preference toggle ships in **Build 3-C Phase 4** (mobile, requires B125 EAS build).
  `[Effort: L]` `[Impact: Med]` `[Backend: Yes]` `[Status: 🔄 Data shipped 2026-04-20; UI pending Phase 4]`

- [ ] **Vocab as the Primary SRS Drill Unit (long-term structural refinement)** — Today the SRS queue surfaces **individual kanji** and the learner grades recall of a kanji in isolation. The stronger pedagogical unit is a **vocabulary word**: it provides phonetic disambiguation (homophone kanji are resolved by context — see the Speak-evaluation bug for the failure mode this fixes), pitch accent has a natural home (pitch is a word-level property), example sentences slot in naturally, and review sessions feel closer to real reading practice. Under this model: the SRS queue surfaces vocab words; kanji-level progress (stages, streaks, JLPT completion) is **derived** from the vocab words the learner has mastered. This is a significant change to the review.store / srs.service / daily_stats / analytics stack and should land only after the narrower Build 3-C deliverable (vocab-level Speak drill only, with kanji-level SRS unchanged) ships and validates the hypothesis. Tracking as a post-launch North Star refinement.
  `[Effort: XL]` `[Impact: High]` `[Backend: Yes]` `[Status: 🚀 Future Refinement]`

- [ ] **Distinguish Meaning vs Reading Prompts (Study Card)** — Implemented in B121 (commit `14f1f62`). **Meaning prompts verified** by user on 2026-04-18 — violet border + tint appear correctly. **Reading prompts amber cue pending** — user hasn't encountered a reading prompt yet during verification. The code path is identical for both (`colors.accent` for reading vs `colors.meaningCue` for meaning), so amber should work once a reading prompt surfaces. Close this entry once reading is visually confirmed.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: 🧪 Meaning verified; reading pending]`

- [x] **"Show Mnemonic" Button on Kanji Details Page** — ~~SHIPPED~~ in B121 (commit `5f2c009`). Verified by user on 2026-04-18: Kanji details page now has a Mnemonic section between Readings and Example Vocabulary. When a mnemonic exists, it renders with a Regenerate button; when none exists, a "Generate mnemonic" button is shown instead. Uses the existing `useMnemonics(kanjiId)` hook — no new backend endpoints.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **Expand Example Vocab + Sentences per Kanji** — ~~SHIPPED~~ 2026-04-20 as Build 3-C Phase 2. Vocab seed (`enrich-vocab.ts`) upgraded from 2 to 5 entries per kanji via Claude Haiku + self-containment validator (closes B4) + Kanjium pitch merge. Tatoeba sentence seed (`seed-sentences.ts`) cap raised 2→5. Prod state: 2,120/2,294 kanji have 5 vocab entries, 158 have 4, 13 have 3, and only 3 are below floor (N1 Jinmeiyō rarities 倖/嚇/錬). Sentences: 1,906 kanji at 5, 210 kanji at 1-4, 178 with 0 (Tatoeba coverage gaps for rare kanji). Two seed bugs caught during the run (jsonb double-encoding in raw postgres.js AND Drizzle's sql-template workaround) — both fixed with `sql.json()` pattern + post-write `jsonb_typeof` assertions. Note: we did NOT source from JMdict — Claude Haiku generation was pragmatic and produces equivalent quality; upgrading to JMdict remains available as a future refinement if needed.
  `[Effort: M]` `[Impact: High]` `[Backend: Yes — seed pipeline + data regen]` `[Status: ✅ Shipped]`

- [x] **Daily-goal progress indicator + celebration banner** — ~~SHIPPED~~ 2026-04-20 in B126. Dashboard now shows `N / M today` under the Start Today's Reviews CTA with a success checkmark when the goal is met. SessionComplete renders a 🎉 'Daily goal met' banner on the session that crosses the threshold for the first time each day (suppressed when burned > 0). No daily cap; soft target only. Deliberate design choice per the brainstorm: keep unlimited same-day review for motivated learners; the pedagogical gate belongs to the future Three-Modality Learning Loop.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **Study-card reveal vocab rows — speak icons (parity with details page)** — ~~SHIPPED~~ 2026-04-20 in B126. Closes the gap where B124's speak-icon work touched the details page but missed KanjiCard.tsx's reveal panel. Reuses the existing SpeakButton + speakSequence machinery already in scope for the kun/on reading groups.
  `[Effort: XS]` `[Impact: Low]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **Kanjidic2 reference codes surfaced on kanji details page** — ~~SHIPPED~~ 2026-04-20 in B126. Phase 2 migration 0019 + seed-kanjidic-refs populated `grade` (99.2% of corpus), `frequency_rank` (93.8%), and `hadamitzky_spahn` (98.3%) back on 2026-04-20, but neither the API nor the mobile UI surfaced the data. API now includes the three fields in `/v1/kanji/:id`; mobile details page renders Kyōiku Grade, Frequency, and Hadamitzky-Spahn rows in the Cross-references card (alongside JIS, Nelson, Morohashi).
  `[Effort: S]` `[Impact: Med]` `[Backend: Yes]` `[Status: ✅ Shipped]`

- [ ] **Speak Button on Example Sentences + Vocab (Kanji Details AND Study Card Reveal)** — The Kanji details page renders each example sentence (`exampleSentences` on `KanjiDetail`) and example vocab word (`exampleVocab`) as text-only today. Add a speak icon next to each sentence AND each vocab word that plays the Japanese string via the existing Expo Speech TTS infra (`ja-JP`, rate ~0.9 — see `SPEECH_OPTS` in `apps/mobile/app/kanji/[id].tsx`). Mirrors the speak icons already on readings. **Scope extended 2026-04-18:** the study card's reveal panel (`KanjiCard.tsx`) ALSO shows vocab and sentences and should receive the same speak icons — users want to hear pronunciation mid-session without tapping through to the details page. Simple: one tap = play; disable icon while speaking to prevent overlap. Reuses existing Expo Speech plumbing — no backend, no new data.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Study Card Gesture Mapping: Clarify or Remap Swipe Directions** — The current swipe-to-grade mapping is counterintuitive and has caused real user confusion (owner was testing B121 on 2026-04-18, believed they were grading "Again" on 17 cards, DB recorded them as Hard — actual cause was swipe-down = Hard, not Again). Current mapping at [apps/mobile/app/(tabs)/study.tsx:108–144](apps/mobile/app/(tabs)/study.tsx:108): swipe right = Easy, swipe left = Again, swipe up = Good, **swipe down = Hard**. Users intuitively associate "swipe down" with "dismiss / don't know / again," so mapping it to Hard produces silent grading errors that degrade SRS scheduling. Three candidate fixes: (1) **remap** — move Again to swipe-down and Hard to swipe-left (keeps Easy on swipe-right as the most common intuitive direction); (2) **visible cue during drag** — the existing `againOpacity` / `hardOpacity` / etc. already fade in labels during swipes, but the labels are small — enlarge and center them mid-drag; (3) **onboarding gesture diagram** — add a one-time explainer showing the 4 swipe directions → 4 grades. Option 2 is lowest-risk and complements whichever other change ships.
  `[Effort: S]` `[Impact: High]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Drill Weak Spots: Check Most-Recent-Session Confidence, Not Cumulative** — The Dashboard "Drill Weak Spots" button currently decides whether to offer the drill (the "Great news — your confidence is above 65%" dialog) against the user's cumulative last-30-days weighted confidence from `getConfidenceRate` ([apps/api/src/services/analytics.service.ts:193](apps/api/src/services/analytics.service.ts:193)). Owner feedback 2026-04-18: this should scope to the MOST RECENT study session, so the "drill weak spots" decision reflects today's performance rather than a 30-day rolling average. A user who had a bad session today but a strong prior month shouldn't be told "everything's fine." Likely new endpoint: `/v1/analytics/last-session-confidence` that queries `review_logs` grouped by `session_id = (SELECT id FROM review_sessions WHERE user_id = $1 ORDER BY completed_at DESC LIMIT 1)`. Mobile's `handleDrillWeak` calls this instead of using `summary.confidence`. Also reconsider the underlying `getWeakKanjiQueue` — it already filters to 30-day history with `minAttempts >= 3`, which is reasonable for finding individual weak kanji; this refinement is about the GATE, not the queue.
  `[Effort: S]` `[Impact: Med]` `[Backend: Yes]` `[Status: 💡 Idea]`

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

- [ ] **Grade Level Equivalent (Kyouiku Kanji) + Grade-Level Badges** — Display the Japanese school grade level equivalent on the Progress page based on the Kyouiku kanji list (教育漢字, grades 1–6, ~1,026 kanji). Provides a tangible alternative progress metric alongside JLPT levels.

  **Badge scope (added 2026-04-19):** completing a grade level earns a milestone achievement:
  - **🥈 Silver badge** — the learner has reached `remembered` status on every kanji at a given Kyouiku grade.
  - **🥇 Gold badge** — the learner has `burned` every kanji at a given Kyouiku grade (genuine long-term mastery).

  Both awards surface in the existing Milestones panel (see the shipped "Personal Records & Milestones" entry) and are shared socially with study mates: the Leaderboard / Study Mates views pick up a new badge column, and the friend-notification pipeline (same infra used by study-mate activity notifications) emits a one-time push when a mate earns one. Silver-before-gold is the natural progression; gold supersedes silver on the same grade.

  **Implementation hooks:**
  - Schema: kanji table needs a `kyouiku_grade smallint` column (1–6) populated from the Kyouiku list; or compute grade from existing `jlptOrder` + a reference mapping.
  - Backend: new `/v1/analytics/grade-progress` returning `{ grade: 1..6, total, remembered, burned, silverEarnedAt?, goldEarnedAt? }`. Badge earn events persist to the existing milestones/achievements table so the Milestones panel renders them consistently.
  - Social: extend the study-mate notification payload to carry badge-earn events; add a badge avatar/ring to rows in the Leaderboard + Study Mates list.

  `[Effort: M]` `[Impact: Med]` `[Backend: Yes]` `[Status: 💡 Idea]`

- [x] **JLPT Progress Panel: Add Color Legend** — ~~SHIPPED~~ in B121 (commit `6e779a8`). Verified by user on 2026-04-18: a compact legend with 4 colored dots + labels (Learning / Reviewing / Remembered / Burned) appears beneath the JLPT stacked bars. Lives inside `JlptProgressGrid` so every consumer (Dashboard + Progress tab) gets it automatically.
  `[Effort: XS]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **Leaderboard: Add Days-Studied + Remembered-Count Columns** — ~~SHIPPED~~ in B121 (commit `91e8161`, API deploy 2026-04-18). Verified by user on 2026-04-18: leaderboard rows now show `📅 N days` + `🌱 N remembered` beneath the existing line; server sorts streak → days → remembered.
  `[Effort: S]` `[Impact: Med]` `[Backend: Yes]` `[Status: ✅ Shipped]`

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

- [x] **Weighted Confidence Scoring (Easy=3 / Good=2 / Hard=1 / Again=0)** — ~~SHIPPED~~ in B121 (server commit `aaa874a`, client commit `dededf3`, App Runner deploy op `7a2c8a31df514442bedbc29b0c79ab8a` on 2026-04-18). **Verified end-to-end 2026-04-18 via a controlled 20-card test** on account `buddy@g.ucla.edu` (5 × Again + 5 × Hard + 5 × Good + 5 × Easy, all via button taps): DB recorded exactly 5 of each quality (1/3/4/5), Session Complete ring showed 50% (client math), Dashboard confidence showed 47% after cumulative aggregation over 40 reviews (server math, matches manual SQL). Ground truth revealed no data migration was needed — `review_logs.quality` was already stored 0–5, so the weighted formula applies retroactively to all historical reviews.
  `[Effort: M]` `[Impact: High]` `[Backend: Yes]` `[Status: ✅ Shipped]`

- [x] **Mnemonic Auto-Reveal: Only on "Again"** — ~~SHIPPED~~ in B121 (commit `b5ec166`). Verified by user on 2026-04-18: grading a card **Hard** no longer surfaces the mnemonic nudge sheet — it returns the card to the queue silently. "Again" path (which triggers the nudge) was the pre-existing behavior and is preserved. Users can still access the mnemonic on demand via the "Show mnemonic" button on the Kanji details page.
  `[Effort: XS]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped]`

---

## 🎨 UI & Experience

- [ ] **Dark / Light Theme Toggle** — Add a manual theme toggle (with system default option) for dark and light mode. Dark mode is especially useful for late-night study sessions and is a highly requested feature in language learning apps.

  **WCAG 2.1 AA requirement (added 2026-04-20):** every foreground / background pair must clear **4.5:1 for normal text**, **3:1 for large text or graphical UI**, in *both* themes. Same rule introduced after the B125 pitch-overlay contrast bug (see [`feedback_accessibility_wcag.md`](../../../.claude/projects/-Users-rdennis-Documents-projects-kanji-learn/memory/feedback_accessibility_wcag.md) in memory). Implementation consequence: theme tokens must be semantic (`colors.textPrimary`, `colors.bgCard`, etc.) and the exact hex for each token switches per theme — consumer components reference the semantic name and automatically remain compliant.

  **Known problem colours to resolve during the theme-toggle spec:**
  - `colors.accent` = `#F4A261` (warm amber) — on the current dark `bgCard #1A1A2E` contrast is ~7.9:1 (passes AA). On a plausible light `bgCard` (e.g. `#F5F5F5`) the same amber drops to ~1.85:1 (**fails AA for text and graphical**). The `PitchAccentReading` overline, `Pitch` toggle chip, `Rōmaji` toggle chip, and several success/accent indicators would need a darker accent in light mode — `colors.accentDark #E07B2A` is already in the theme and clears ~4.1:1 on white, which passes AA graphical and AA-large-text. The theme-toggle implementation should map `accent` to different hex per theme rather than leaving the current shared token.
  - Other shared tokens to re-check per theme: `info`, `warning`, `error`, `success`, `primary` (vermillion), `meaningCue`. Each needs a swatch-on-swatch contrast audit against both themes' `bg` / `bgCard` / `bgElevated`.

  **Sanity check before merging:** an automated contrast check against every semantic pair (or a manual table committed alongside the theme file) so regressions are caught before shipping, not in the next bug report.

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

- [x] **Accuracy → Confidence Terminology Audit** — ~~SHIPPED~~ in B121 (commit `744dede`). Verified by user on 2026-04-18: Session Complete ring label, Drill Weak Spots dialog, and Progress tab "Confidence colour coding" info panel now read "confidence". Writing/voice practice stats correctly remain "accuracy" (objective scores). Internal variable names and style keys left untouched.
  `[Effort: S]` `[Impact: Low]` `[Backend: No]` `[Status: ✅ Shipped]`

- [x] **Session Complete "confidence" copy + colour bands recalibrated** — ~~SHIPPED~~ 2026-04-20 (Build 3-C session, commits `6a4b74d` + `9c086d2`). Threshold bands shifted from ≥80 / ≥60 to ≥60 / ≥35 so all-Good sessions (67%) now render with the green checkmark + "Solid — consistent recall." copy instead of amber-star "Decent effort — review the misses" (which leaked failure framing when there were zero misses). Weight table unchanged; "confidence" label unchanged. `motivationalMessage` extracted to `SessionComplete.messaging.ts` so the band logic is unit-tested independently of the React render path. **Verified on B125 2026-04-20** — user confirmed new bands + encouragement line on-device.
  `[Effort: XS]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped & Verified]`

- [x] **Onboarding findHelp Panel: Append Motivational Line** — ~~SHIPPED~~ in B121 (commit `378f85c`). Verified by user on 2026-04-18: onboarding findHelp panel footer now reads "You don't need to memorise any of this now. Studying daily is the key to making progress."
  `[Effort: XS]` `[Impact: Low]` `[Backend: No]` `[Status: ✅ Shipped]`

- [ ] **Expand My Interests options (Profile + onboarding)** — Owner wants the interests list enriched so sentence seeding and (future) mnemonic generation can pull from a broader and more personally-relevant set of domains. Today `INTEREST_OPTIONS` in [profile.tsx:129](apps/mobile/app/(tabs)/profile.tsx:129) has 10 items: Manga, Anime, Gaming, Literature, Film, Travel, Business, History, Technology, Other.

  **New labels to add (from 2026-04-22 owner note):**
  - **Education cluster:** Learning & Instruction, Pedagogy, Educational Technology
  - **STEM cluster:** AI, Algorithms & Engineering
  - **Culture cluster:** Culture, Religion & Spirituality, Temples & Shrines
  - **Daily-life cluster:** Food, Crafts, Pottery, Liquor (sake / beer / etc.), Customs & Etiquette

  **Open decisions to resolve in the design pass (likely Journal/Mnemonic brainstorm):**
  - Keep the flat chip grid, or group chips under collapsible cluster headings once the list grows past ~15?
  - Profile-only (current state — wizard never asks per B118 fix) vs. re-introduce an optional interests step in onboarding? The current wizard intentionally skips interests to avoid overwriting existing selections; adding the question back requires handling the returning-user case without the B118 regression.
  - Do any of these need to propagate to sentence-seed topic weighting or mnemonic generation prompts? That's where the value lives.

  **Affected files (implementation):**
  - `apps/mobile/app/(tabs)/profile.tsx:129` — `INTEREST_OPTIONS` array
  - `apps/mobile/app/onboarding.tsx` — if we re-introduce interests in the wizard
  - Any seed-topic weighting in `packages/db/src/seeds/` that references the interest list
  - Mnemonic-generation prompt templates (future work — see the Mnemonic constructivist design)

  Found 2026-04-22 (owner note, post-B127).

  `[Effort: XS (chip list only) / S (chip list + onboarding step)]` `[Impact: Med — feeds downstream personalization]` `[Backend: No (chip list) / No (seed weighting)]` `[Status: 💡 Idea — decisions deferred to Journal/Mnemonic brainstorm session]`

- [ ] **Voice drill: restore difficulty-picker as a "starting-tier" preference for the attempt ladder** — After the Speaking progressive-hints refactor lands, the 4-level difficulty picker at [voice.tsx:237-262](apps/mobile/app/(tabs)/voice.tsx:237) gets hidden (the attempt ladder becomes the single reveal engine). This enhancement re-introduces the picker as a user preference that shifts where on the ladder a drill *starts* — e.g., level 4 starts at try 1's layout (nothing shown), level 1 starts at try 2's layout (kun/on + meaning already visible). Maps the existing `kl:voice_difficulty` SecureStore value onto starting-tier semantics. Persisted preference is preserved across the refactor cycle even though the UI is hidden during it.

  **Why separate:** the attempt-ladder's reveal semantics need to be validated in isolation first. Adding a starting-tier knob on top before the baseline is proven adds variables we can't pull apart if something feels off in testing.

  Captured 2026-04-22 during Speaking refactor brainstorm.

  `[Effort: S]` `[Impact: Med — power-user flexibility]` `[Backend: No]` `[Status: 💡 Staged — post Speaking refactor]`

- [ ] **Clean stale `voice_attempts` rows predating the 2026-04-19 homophone fix** — Owner reports "0% speaking accuracy" on many kanji in Progress panels, driven by pre-fix `voice_attempts` rows marked `passed = false` because the old evaluator couldn't match homophone kanji transcripts. Those rows now pollute per-kanji speaking-accuracy metrics that a user cannot realistically recover from without re-drilling every affected kanji. One-shot cleanup: `DELETE FROM voice_attempts WHERE user_id = '<owner>' AND attempted_at < '2026-04-19';` (or use the homophone-fix deploy timestamp from the Bug 3-C Phase 1 release). Fold execution into the Speaking-section refactor spec as a pre-work step so the "run this once" note is captured in the same commit as the UI redesign.

  **Scope decision point:** owner-only vs. all users. TestFlight cohort is small (primarily owner + Bucky) so all-users is low-risk; a WHERE on owner's user_id is safer and sufficient if we're unsure.

  Found 2026-04-22 (owner note, post-B127).

  `[Effort: XS]` `[Impact: Med — unblocks fair speaking metrics]` `[Backend: Yes — one SQL statement in prod]` `[Status: 💡 Idea — execute alongside Speaking refactor]`

- [ ] **Review-history list (what kanji did I see in past study sessions?)** — Owner encountered a questionable vocab example on some kanji and couldn't find it again afterwards. Need a way to browse the kanji reviewed in a given past session (or within a date range) from the Progress page's session-history list — tap a session row → see the kanji that appeared in it. Related to "report questionable example" / content-quality feedback loop.

  **Likely shape:**
  - Expand each row in the session history list into a collapsible detail that lists the kanji reviewed (character, meaning, link to details page).
  - Alternatively: tap-through to a new "Session detail" screen that lists kanji + grades given.
  - Data is already in `srs_reviews` (or equivalent) — no new events needed, just a read endpoint or a client-side join.

  **Fold into:** the Journal/Browse redesign brainstorm (this is arguably a Journal tab feature — "history of what you've studied" is a journal concept).

  Found 2026-04-22 (owner note, post-B127).

  `[Effort: M]` `[Impact: Med — unlocks content-quality feedback]` `[Backend: Yes — read-only endpoint to join reviews→kanji]` `[Status: 💡 Idea — merge into Journal brainstorm]`

---

## 🔐 Authentication

- [x] **OAuth 2.0 Social Login (Apple, Google)** — Add Sign in with Apple and Sign in with Google as registration and login options alongside the existing email/password flow. Reduces sign-up friction significantly — users skip the email/password form entirely and authenticate with a single tap. Sign in with Apple is required by App Store guidelines for any app that offers third-party social login. Supabase supports both providers natively via its Auth module; integration requires (1) configuring the OAuth app credentials in the Supabase dashboard, (2) adding the Apple and Google entitlements/capabilities to the Expo project via a config plugin, (3) adding deep-link redirect URL handling for the OAuth callback, (4) updating the auth store and login screen to offer provider buttons alongside the email form, and (5) handling the `user_profiles` row creation for OAuth users (the existing `on_user_created` DB trigger should handle this automatically).
  `[Effort: M]` `[Impact: High]` `[Backend: Yes]` `[Status: ✅ Shipped]`

- [x] **Delete Account (App Store 5.1.1 compliance)** — In-app account deletion required by App Store Review Guideline 5.1.1. Profile tab → "Danger zone" → typed-DELETE confirmation modal → `DELETE /v1/user/me` API → `supabaseAdmin.auth.admin.deleteUser()` triggers FK cascade through `auth.users → user_profiles → learner_identity` and every user-keyed table → farewell screen → sign-in. Hard delete only, no grace period. Spec at `docs/superpowers/specs/2026-04-17-delete-account-design.md`, plan at `docs/superpowers/plans/2026-04-17-delete-account.md`.
  `[Effort: M]` `[Impact: High]` `[Backend: Yes]` `[Status: ✅ Shipped (B120, awaiting TestFlight verification)]`

---

## 🔧 Backend & Data

- [x] **Multi-Device Push Notifications + Per-Study-Mate Mute** — ~~SHIPPED~~ 2026-04-21 in B127. Replaces the single `user_profiles.push_token` column (last-write-wins across devices) with a dedicated `user_push_tokens` table (migration 0021). New `POST /v1/push-tokens` + `DELETE /v1/push-tokens/:token` endpoints; new `sendToUserTokens` service helper fans out across all a user's tokens in one batched Expo call and synchronously prunes dead tokens on `DeviceNotRegistered` / `InvalidCredentials` / `MessageTooBig`. All three production push paths migrated. Per-friendship mute stored as two directional columns on `friendships` (`requester_notify_of_activity` + `addressee_notify_of_activity`); exposed via new `PATCH /v1/social/friends/:friendId` and rendered as a bell toggle on each accepted-friend row in the mobile Study Mates panel. Spec + plan at `docs/superpowers/{specs,plans}/2026-04-21-multi-device-push*`. Awaiting on-device verification once B127 installs.
  `[Effort: L]` `[Impact: High]` `[Backend: Yes]` `[Status: ✅ Shipped — pending B127 verification]`

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

- [x] **Configure Groq & Gemini API keys on App Runner** — ~~SHIPPED~~ 2026-04-19 (App Runner operation `fed113f85bcf4883a6d0d3ad927d2ea5`, SUCCEEDED). `GROQ_API_KEY` + `GEMINI_API_KEY` injected alongside the existing `ANTHROPIC_API_KEY`; post-deploy health check HTTP 200 in 470ms. The LLM router's tier 2 fallback path now has credentials, closing the "Both tier 2 providers failed" failure mode that had caused tutor-report analysis outages earlier in the month.
  `[Effort: XS]` `[Impact: High]` `[Backend: Yes]` `[Status: ✅ Shipped]`

- [ ] **Secrets Management — Rotate Exposed Keys + Move to SSM Parameter Store** — All production secrets are currently stored as plaintext `RuntimeEnvironmentVariables` on App Runner and mirrored in `packages/db/.env` for local development. This works at today's scale but carries real risk: (a) keys pasted through chat / screen share / support logs can leak; (b) App Runner env vars are visible to anyone with AWS console access to the account — there's no per-variable access control; (c) there's no rotation cadence, so a leaked key stays valid until manually revoked; (d) `aws apprunner describe-service` without a scoped `--query` returns the full plaintext map, so routine ops commands can dump secrets into logs.

  **Known exposure events (2026-04-19 → 2026-04-20):**
  - 2026-04-19 — `GROQ_API_KEY` and `GEMINI_API_KEY` pasted through chat when being added to App Runner for the first time.
  - 2026-04-20 — `ANTHROPIC_API_KEY` echoed via an unmasked `grep` on `packages/db/.env`.
  - 2026-04-20 — `DATABASE_URL` (with Supabase postgres password), `INTERNAL_SECRET`, `SUPABASE_JWT_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` returned in the response body of an `aws apprunner describe-service` call. **All seven keys now require rotation.**

  **Why SSM Parameter Store over AWS Secrets Manager:**
  - Standard `SecureString` parameters are **free** under the AWS-managed `aws/ssm` KMS key; Secrets Manager is $0.40/secret/month × 7 secrets = $2.80/mo with no added benefit for this app.
  - No automated rotation infrastructure needed — quarterly manual rotation is the operating model, not Lambda-driven DB-credential rotation.
  - 4KB size limit is irrelevant for API keys / connection strings.
  - App Runner's `RuntimeEnvironmentSecrets` accepts SSM Parameter Store ARNs natively — no startup hook or code change required. At container start, App Runner resolves each ARN and injects the decrypted value as a normal env var. Fastify reads `process.env.GROQ_API_KEY` exactly as today.

  **Current AWS state (verified 2026-04-20):**
  - App Runner service ARN: `arn:aws:apprunner:us-east-1:087656010655:service/kanji-learn-api/470f4fc9f81c407e871228fb9dd93654`
  - `InstanceRoleArn` is already set: `arn:aws:iam::087656010655:role/kanji-learn-apprunner-instance` — **no role creation needed**, just an inline SSM read policy to attach.
  - `RuntimeEnvironmentSecrets` is currently `null` — clean migration target.

  **Target `RuntimeEnvironmentSecrets` shape (seven entries):**
  ```jsonc
  {
    "GROQ_API_KEY":              "arn:aws:ssm:us-east-1:087656010655:parameter/kanji-learn/prod/groq-api-key",
    "GEMINI_API_KEY":            "arn:aws:ssm:us-east-1:087656010655:parameter/kanji-learn/prod/gemini-api-key",
    "ANTHROPIC_API_KEY":         "arn:aws:ssm:us-east-1:087656010655:parameter/kanji-learn/prod/anthropic-api-key",
    "DATABASE_URL":              "arn:aws:ssm:us-east-1:087656010655:parameter/kanji-learn/prod/database-url",
    "INTERNAL_SECRET":           "arn:aws:ssm:us-east-1:087656010655:parameter/kanji-learn/prod/internal-secret",
    "SUPABASE_JWT_SECRET":       "arn:aws:ssm:us-east-1:087656010655:parameter/kanji-learn/prod/supabase-jwt-secret",
    "SUPABASE_SERVICE_ROLE_KEY": "arn:aws:ssm:us-east-1:087656010655:parameter/kanji-learn/prod/supabase-service-role-key"
  }
  ```

  **IAM policy to attach to `kanji-learn-apprunner-instance`:**
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["ssm:GetParameters"],
      "Resource": "arn:aws:ssm:us-east-1:087656010655:parameter/kanji-learn/prod/*"
    }]
  }
  ```
  KMS permissions are **not** required for the AWS-managed `aws/ssm` key — roles can decrypt by default. A custom CMK would require an additional `kms:Decrypt` statement.

  **Pre-launch execution checklist:**
  1. **User rotates all seven exposed keys** in their provider consoles / Supabase dashboard. Supabase JWT secret + service-role key rotation may cascade to `DATABASE_URL` and require coordinated rotation of all Supabase-issued credentials.
  2. **User creates SSM parameters locally** (value never touches tool output):
     ```
     aws ssm put-parameter --name /kanji-learn/prod/groq-api-key \
       --type SecureString --value "$(cat ~/tmp/groq.key)" --region us-east-1
     ```
     Repeat for each of the seven keys.
  3. Claude attaches the SSM read policy to `kanji-learn-apprunner-instance` (ARN-only, no secret values touch tool output).
  4. Claude updates App Runner via `aws apprunner update-service` with `apprunner-env.json` that moves all seven variables from `RuntimeEnvironmentVariables` → `RuntimeEnvironmentSecrets`. Response body only echoes ARNs.
  5. Verify with health check and one provider-exercising call per tier: Groq (tier 2 primary), Gemini (tier 2 fallback), Anthropic (tier 1), Supabase (via any authenticated API route).
  6. User updates local `packages/db/.env` with the new Anthropic key (and any rotated Supabase values) — user edits directly; Claude never `cat`s.
  7. **Rotation runbook** at `docs/runbooks/secret-rotation.md` — document the `aws ssm put-parameter --overwrite` + `aws apprunner start-deployment` cycle, add quarterly calendar reminder, include the `--query "Service.InstanceConfiguration.InstanceRoleArn"`-style scoped query patterns.

  **Chat-hygiene rules to enforce going forward:**
  - Never run `aws apprunner describe-service` / `get-parameter` / `env` dumps without a `--query` scoped to keys or structural fields only.
  - Never `cat` / `grep` files known to contain secrets (`packages/db/.env`, `apps/mobile/credentials.json`, `*.key`).
  - Secret rotation is always a user-side action in their own terminal; Claude operates on ARN references only.

  `[Effort: M]` `[Impact: High — compliance + breach-risk]` `[Backend: Yes]` `[Status: 🚀 Pre-Launch]`

- [ ] **Migrate Supabase DB to us-east-1** — The Supabase project is currently hosted in `ap-southeast-2` (Sydney) while App Runner, ECR, SES, and Lambda all run in `us-east-1`. Every API request pays ~200ms cross-region latency to the database. Before public release, migrate the Supabase project to `us-east-1` to co-locate with the rest of the infrastructure. Steps: (1) create a new Supabase project in us-east-1, (2) `pg_dump` the existing database and restore into the new project, (3) update `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` in App Runner env vars, Lambda env vars, mobile app EAS environment, and local `.env`, (4) verify RLS policies and triggers transferred correctly, (5) decommission the Sydney project. Schedule during a maintenance window — requires brief downtime for the cutover.
  `[Effort: M]` `[Impact: High]` `[Backend: Yes]` `[Status: 🚀 Pre-Launch]`

- [ ] **Backend Scaling: Analytics Cache + Supabase Pro Upgrade** — The `/v1/analytics/summary` endpoint runs 8–10 complex SQL aggregations per request and is the primary DB bottleneck at scale (observed 400–1200ms per call). Full scaling plan in `docs/SCALING.md`. Phase 1 (pre-launch): add a per-user `user_stats_cache` table updated after each review session; dashboard reads cache row instead of running live aggregations. Phase 2 (500+ users): upgrade Supabase to Pro tier for dedicated compute and higher pooler limits. Phase 3 (2K+ users): read replica for analytics, App Runner min-instance configuration. The current transaction-mode PgBouncer fix (5 conn/instance) supports ~300–500 concurrent active users before Phase 1 is needed.
  `[Effort: M]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

---

## 🔮 Future / Big Ideas

- [ ] **Three-Modality Learning Loop** — Owner-proposed 2026-04-20 during Build 3-C Phase 4 verification. After each daily-goal flashcard batch, gate further flashcard sessions until the same kanji have been practiced in *writing* AND *speaking* modalities. Only after both gates clear does the next batch of flashcards become available. Pedagogically grounded: multi-modal encoding strengthens memory; the gate prevents the "flashcard-only" trap most Anki-style apps fall into, and forces real integration of the kanji into active recall. Would be a meaningful differentiator vs. generic SRS apps.

  **Prerequisites that must be solid first:**
  - Writing evaluation path: reliable, fast grading (audit not yet done as of 2026-04-20).
  - Voice evaluation: Build 3-C Phase 1 homophone fix shipped + Phase 4 vocab-level prompts in B125. Needs to bake in production before becoming a *gate*.
  - Cross-tab state machine: Study / Writing / Voice tabs currently have independent queues with no shared "session" concept. A new orchestration layer is required.

  **Open design questions (for future brainstorm/spec):**
  1. Per-session cycle ("this 5 flashcards locked until writing + voice of these same 5") or per-day ("first session sets the 5, all further flashcards locked until both modalities clear")?
  2. "Completed" definition — attempted vs. passed at threshold X? Leniency matters: too strict and users get stuck; too loose and the gate is theatre.
  3. Sparse data edge cases — if only 3 of 5 kanji have practicable vocab with pitch data and only 4 are writable, gate on available subset or block entirely?
  4. Cross-day persistence — user writes Monday, voices Wednesday. Does the cycle survive that, or reset daily?
  5. Escape hatch — days when writing is impractical (no stylus, commuting, one-handed). Some form of "skip this modality with a mild penalty" may be needed.
  6. Interaction with Drill Weak Spots and other non-daily-queue flows — do those count toward modality completion?

  Needs its own brainstorm → spec → plan cycle. Estimated 1–2 weeks of implementation once prerequisites are solid. Natural headline feature for whatever the next major version becomes.
  `[Effort: XL]` `[Impact: High]` `[Backend: Yes]` `[Status: 💡 Idea]`

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

- [x] **Dashboard "Invite a Study Mate" Banner** — ~~SHIPPED~~ in B121 (commit `87f2695`). Verified by user on 2026-04-18: fresh account with zero mates sees the "Study with a friend" banner on the Dashboard; X dismisses for 7 days (persisted via `kl:invite_mate_dismissed_at` AsyncStorage key); tap body navigates to the Profile tab.
  `[Effort: S]` `[Impact: Med]` `[Backend: No]` `[Status: ✅ Shipped]`

- [ ] **Study Mate Nudge / "Poke"** — Add a tappable nudge action on each row of the Study Mates list. Rate-limited to one poke per sender → receiver per 24-hour window. On send: push notification to the receiver (`"{senderName} poked you — time to study!"`), with Apple Watch haptic if the Watch companion is paired. Each poker sends a separate push (not aggregated). The receiver's Study Mates list shows a "You were poked" indicator next to the sender's row until acknowledged. Requires a new `pokes` table, API endpoint, push delivery, mates-list UI, and Watch complication update.
  `[Effort: L]` `[Impact: Med]` `[Backend: Yes]` `[Status: 💡 Idea]`
