# 漢字 Buddy — Enhancement Ideas

A prioritized backlog of potential improvements for the 漢字 Buddy app. Each item is tagged with estimated effort (S/M/L/XL), expected impact (Low/Med/High), whether backend changes are required, and current status. Items are ordered by priority within each section. Use this as a living document — check off items as they ship and add new ideas as they surface.

---

## 🚨 Security — Critical

> **Must fix immediately** — these are active security vulnerabilities flagged by Supabase.

- [x] **Enable RLS on `kanji_difficulty` — the last table without it** — ~~SHIPPED~~ 2026-08-06 via migration 0036, after the Supabase database linter flagged *"Table public.kanji_difficulty is public, but RLS has not been enabled."* It was the **only one of 39 public tables** missing RLS — a single table missed when 0009 and 0018 swept the rest, not a category gap.

  **The linter understated it, and that is the part worth remembering.** It reports only the missing RLS. The severity came from the grants underneath: `anon` and `authenticated` hold INSERT, UPDATE, DELETE **and TRUNCATE** on this table. They hold those on *every* table — it is the Supabase default grant on the public schema — but everywhere else RLS makes them inert, because a policy only permits what it permits. `kanji` carries identical grants and one SELECT-only policy, so its write grants cannot be used. Here there was no RLS and therefore nothing neutralising them. **Read the grants, not just the linter line.**

  **This was live, not theoretical.** Probed read-only before the fix (`SET ROLE anon`, inside a rolled-back transaction): anon saw all **2,294 rows** and a `DELETE` would have taken every one. The rows are the IRT parameters `placement.service.ts` scores the placement test against, and the anon key ships inside the mobile app by design. Corrupting them leaks nothing and silently invalidates every learner's placement result — integrity and availability, not disclosure.

  **No anon/authenticated policy was added, deliberately** — unlike `kanji`, which needs a public SELECT. Verified first: the API connects as `postgres` (`rolbypassrls = t`) and `service_role` bypasses too; `apps/mobile` contains **zero** `.from(` calls, so no client reads any table directly. Reference data the client never touches should be closed entirely. A `service_role` policy is included as belt-and-braces, matching 0018's reasoning.

  **Verified after applying:** anon reads 2,294 → **0**, anon `DELETE` affects 2,294 → **0**, `postgres` still reads 2,294, row count and `updated_at` unchanged. **39 of 39 public tables now have RLS.**

  `[Effort: S]` `[Impact: Critical — anon could have truncated the placement difficulty model]` `[Backend: Yes — migration]` `[Status: ✅ Shipped & Verified]`

- [x] **Enable RLS on Remaining 5 Tables (Tutor + Placement)** — ~~SHIPPED~~ 2026-04-19 via migration 0018. RLS enabled on `placement_sessions`, `placement_results`, `tutor_shares`, `tutor_notes`, `tutor_analysis_cache`. Each gets an authenticated-user policy scoped via `auth.uid() = user_id` (or via parent table for child rows) plus an explicit service_role bypass policy, matching the pattern from migration 0009. Tutor notes use a SELECT-only policy for the owning student — tutor writes flow through the API's service_role since tutors authenticate by opaque share token, not Supabase auth. Verified post-apply: all 5 tables show `rowsecurity = t` with 2 policies each.
  `[Effort: S]` `[Impact: Critical]` `[Backend: Yes]` `[Status: ✅ Shipped]`

---

## 🃏 Study Card Enhancements

> **Highest priority** — directly requested by users. Several of these (stroke order, radicals, Nelson IDs) use data already stored in the database that just isn't surfaced in the UI yet, making them relatively quick wins.

- [ ] **"Study on the Go" — flashcard-only study mode on the Dashboard** — A second study entry point next to the regular Study button that drills flashcards WITHOUT the writing and speaking legs of the B134 three-modality practice loop. When the student is on a train or in public, finger-writing and speaking aloud are awkward — this mode restores the original flip-and-grade flashcard process as a first-class alternative. Grading feeds the SRS as normal; the writing/speaking legs are simply skipped for that session.

  **Design consideration for the spec pass:** how a legs-skipped session interacts with per-kanji modality progression (`reading_stage`, writing/speaking accuracy metrics) so on-the-go sessions don't stall or skew multi-modal stats. Also decide whether the co-creation Buddy-moment trigger fires after on-the-go sessions (probably yes — it's a main-loop session, not a drill).

  Captured 2026-07-05 (owner idea, during Plan 3b walkthrough). Also in Open Brain.

  `[Effort: M]` `[Impact: High — removes a real-world barrier to daily study]` `[Backend: Maybe — depends on how session type is recorded]` `[Status: 💡 Idea]`

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

> **Worse than recorded, 2026-07-28.** The owner now reads *"All 2294 Jouyou kanji: Jul 2053"* — the date has slipped from **Nov 2034 to Jul 2053**, and the count has changed from 2254 to 2294. Their words: *"Tells me that I will be 96 years old before I get the monkey off my back. This is not good motivational material, and it is based on a weak linear extrapolation that is difficult to defend."*
>
> Two separate faults, and the second is the one to fix first:
>
> 1. **The projection is indefensible, not just discouraging.** A linear extrapolation from recent pace swings by two decades between sessions — a number that unstable should not be presented as a date at all. Slowing down for a fortnight should not cost you nineteen years.
> 2. **The string is also factually wrong** — those are not all Jōyō kanji. See the re-scoped count entry in `BUGS.md`; the deck holds 2,294 (Jōyō 2,136 + 158 Jinmeiyō), and three different totals are in circulation.
>
> The cheapest honest improvement is to stop projecting a completion date for the full deck at all, and lead with the nearest milestone as the entry below already proposes. A wrong date removed beats a wrong date explained.

- [ ] **Rework Velocity estimate: near-term milestones + goal calculator** — The Dashboard Velocity section projects the FULL Jōyō horizon ("All 2254 Jōyō Kanji: Nov 2034" for the owner) — a decade-out date that reads as discouraging rather than motivating. Three-part rework: (1) **lead with the nearest milestone** — next JLPT level, next 100 kanji, next Kyōiku grade — full-Jōyō becomes a secondary line, if shown at all; (2) **explain the estimate** — surface how it's calculated (current pace, review load) and make explicit that more effort shortens it; (3) **goal calculator** — learner picks a target ("N2 by July 2027") and the app computes the required pace: new kanji/day, minutes/day, vs their current pace. Framing principle: velocity should feel like a lever the learner controls, not a sentence being served. Same discouragement dynamic as the shipped Journey-bar fix above (a 2% sliver vs a 2034 date — both "the mountain is too big" signals). The calculator is arguably the lightweight first slice of the AI-Powered Personalized Study Plan idea (Future/Big Ideas).

  Captured 2026-07-05 (owner: "Nov 2034 — I find that a little discouraging"). Also in Open Brain.

  `[Effort: M]` `[Impact: High — motivation is the product]` `[Backend: Maybe — pace math may live client-side on existing analytics]` `[Status: 💡 Idea]`

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

## 🌱 New Learner Experience

> Four observations from the owner, 2026-07-28, after B145 device testing. Recorded
> together because they are one theme: **the app collects and computes a great deal
> about a new learner and gives almost none of it back to them.**
>
> ⚠️ **All four re-verified against the code 2026-08-07. Three had drifted, and two
> stated things that are now false — read each entry's dated correction before
> acting on it.** The Buddy/coaching work (Phase 5, and the coaching analyzer
> slices) landed in between and consumed data these entries describe as unused.
>
> **The theme has shifted rather than been resolved.** The app *does* give it back
> now — but almost all of it arrives in **one place (the Journal) on one cadence**
> (`ANALYSIS_STALE_HOURS = 6`, so days later). Placement analysis exists but not at
> the test; explanations exist but not at the panel.
>
> So items 2 and 3 are now **delivery problems on shipped machinery**, which is a
> far smaller class of work than their `[Effort]` tags imply. Item 4 is mostly
> done. **Item 1's JLPT deadline is the only genuinely absent capability in the
> group** — and it is absent completely, not partially.

- [ ] **Give the JLPT goal a deadline — countdown, pace, seasonal encouragement** *(headline was "Onboarding collects interests and goals, then never uses them"; corrected 2026-08-07 — the data IS used now, the exam date is what is missing)* — Owner (2026-07-28): *"We collect data from a new user regarding focus and interests. We don't make good use of these data. If a new user indicates that s/he is interested in the JLPT exam, we should check the upcoming exam dates for the user's location and Buddy should use that data to help motivate and schedule study effort and encouragement."*

  ⚠️ **CORRECTED 2026-08-07 — the original diagnosis is now false, but the ask is still open.** This entry read: *"read in exactly two places: the profile CRUD route… and `tutor-report.service.ts`… **Nothing in the learner's own experience consults either.**"* Re-verified against the code, both sentences are wrong now:

  - `reasonsForLearning` → `resolveFrame` (`packages/shared/src/buddy/frame.ts:21`) → `milestoneFocusFromReasons` → `MilestonesSection.tsx:47`. **Reasons pick the milestone ruler** (JLPT vs school grade). That is learner-facing.
  - Reasons *and* interests are now **required to finish onboarding** (`packages/shared/src/buddy/meeting.ts:28`) and are fed to the Meet Buddy prompt (`meeting-prompt.ts:6`: *"what they are into (interests)"*).

  So the "questionnaire that shapes nothing" framing no longer holds — the Meet Buddy work (Phase 5) consumed both fields.

  **What remains genuinely unbuilt is the JLPT deadline, and it is 100% absent.** A repo-wide search for `examDate` / `exam_date` / `nextExam` / `examSitting` returns **nothing but prose in ⓘ copy**. `resolveFrame` picks a *ruler*, never a *date*. Everything below — countdown, pace calculator, seasonal reminder copy — is still unstarted, and none of it is blocked by the correction above.

  **Read the rest of this entry as a spec for the deadline feature, not as a report that the data is unused.**

  **The JLPT hook is the sharpest instance.** Exams run twice yearly (first Sunday of July and December) but **not every site offers both sittings**, so "the next exam" genuinely depends on where the learner is — which is why the ask is location-aware rather than a lookup table. `user_profiles.timezone` now carries a real IANA zone for every active account (Task 17), which is a usable first approximation without asking again.

  What it unlocks, roughly in order of cheapness:
  - A **countdown** — "N3 is 94 days away" — which turns an abstract goal into a deadline.
  - A **required pace**, computed backwards from the exam date against the learner's N-level gap. This is the goal calculator in the Velocity entry below, with the date supplied rather than invented.
  - **Reminder copy that knows the season** — encouragement in month one, urgency in the final fortnight.
  - **Deck weighting** toward the target level, which is a bigger change and wants its own thinking.

  **Design caution:** a countdown to a date the learner will not be ready for is demotivating, which is the exact failure mode of the Velocity estimate below. The calculator must be able to say *"N3 by December is not reachable at this pace; N4 is"* — a lever, not a verdict.

  **Open:** where exam dates come from. Hard-coding two dates a year is trivial and stale by definition; scraping JLPT sites is fragile. A small seeded table with a yearly manual refresh is probably the honest answer.

  `[Effort: M]` `[Impact: High — the exam deadline is the one capability in this group that is fully absent]` `[Backend: Yes]` `[Status: 💡 Idea — scope is the DEADLINE only; the "data is unused" premise was corrected 2026-08-07]`

- [ ] **The placement test ends without analysis — its results are the best diagnostic we will ever have and we discard them** — Owner (2026-07-28): *"New users are encouraged to complete the placement test first thing. We don't really provide much analysis or diagnostics at the conclusion of the test. This is an underdeveloped opportunity."*

  **The one moment a learner volunteers a full diagnostic.** A new user takes the placement test before they have any reason to trust the app, and gets back a starting position and nothing else. No reading of where they are strong, no shape of what comes next, no sense that the effort bought them anything.

  ✅ **STILL TRUE 2026-08-07 — and much cheaper than `[Effort: M]` now suggests.** Re-verified: the result screen is still three fields (`apps/mobile/src/lib/placement-result-copy.ts` — level, the label "estimated level", one sentence *"Your reviews are pitched around N3, and they'll keep adjusting as you study."*).

  **But the analysis this entry asks for now EXISTS and is live in production.** The coaching detectors shipped it, and all three were rendered against real learner data on 2026-08-07:

  - `level_estimate` — *"Your placement test on 1 August puts you at N3, and the honest range runs from N3 to N2… It narrows when you take the placement test again."* — which is the "read on the learner, not a score" bullet below.
  - `hardest_cleared` — *"You cleared 願, the hardest item you got right: it has 19 strokes and 3 readings."*
  - `mechanics_explainer` — what IRT is, and why a dozen questions suffice.

  `PlacementSnapshot.items` already carries per-item outcomes, and `CoachingService.levelInterval` already derives the level and its 80% band from `ability_theta`.

  🔴 **So the gap is DELIVERY, not capability.** Those sentences land in the **Journal**, gated by `ANALYSIS_STALE_HOURS = 6` (`coaching.service.ts`), typically days later — never at the moment the test ends, which is the entire point of this entry. The work is plausibly "render findings that already exist at the moment they are freshest", not "build placement analysis". **Re-estimate before planning.**

  **What the results could produce, at the moment they are freshest:**
  - **A read on the learner**, not a score — which JLPT level they sit at, which grades are solid, where the boundary is ragged.
  - **A suggested study plan** — daily goal and horizon derived from measured performance, rather than the 15/day default everyone gets regardless.
  - **Near milestones**, deliberately close. "Finish N5: 34 kanji away" is a week; "All Jōyō" is decades. Milestones already exist (Wave 3 #13) but are earned passively rather than *set* here.
  - **A first Buddy moment with something to say** — the tour in the entry below has a natural opening if it starts from the learner's own results.

  **Ties directly to the Velocity rework below**, which is the same failure at the other end of the journey: a number computed and presented without the framing that makes it useful.

  ~~**Note B-210 first.** Retaking the placement test currently destroys FSRS state on in-progress kanji, and any work that makes the test more attractive raises the odds of a retake. Fix that before inviting people back to it.~~ **B-210 was closed 2026-08-02** — `applyPlacementResults` no longer exists, `alreadyHas` covers every owned kanji at any status, and the write is `onConflictDoNothing()`. **A retake is safe, and this blocker no longer applies.** Noted here because the warning outlived the bug: `retest_due` already ships copy inviting a retake ("You can start it from your Profile"), so a reader acting on the struck-through text would have gone looking for a defect that was fixed four days earlier.

  `[Effort: M → probably S–M, RE-ESTIMATE FIRST]` `[Impact: High — first impression, and the only structured diagnostic we ever collect]` `[Backend: Maybe — the findings already exist; this may be delivery only]` `[Status: 💡 Idea — best value in this group, see the 2026-08-07 correction]`

- [ ] **Explanatory content exists but is never brought to the learner — Buddy should tour, then keep teaching** — Owner (2026-07-28): *"I feel like we have lots of explanatory text in different places, but we don't bring it forward to help a new user. Perhaps Buddy can do an initial guided tour of the most important aspects of the app and the UI. And then periodically, Buddy can add more details to different areas of the app and the UI and tie in some motivational therapy. For example, once the user hits the first milestone, Buddy can congratulate and then go through a short tour of the one or two panels under progress."*

  **The content is already written.** The Progress tab has `InfoSection[]` arrays behind ⓘ buttons (`INFO_BREAKDOWN`, `INFO_CONFIDENCE`, `INFO_VELOCITY`, "How evaluation works"), the Study tab has its grading explainer, onboarding has its own copy. All of it waits to be *asked for* — by a learner who does not yet know the question.

  ✅ **STILL TRUE 2026-08-07, now with a count and a proven beachhead.** Re-verified: **61 written explanation blocks** sit behind ⓘ — 29 in `progress.tsx`, 27 in `index.tsx`, 5 in `journal.tsx`. The one-shot overlay this entry warns about is also still there, unchanged: `study.tsx:58`, `kl_has_seen_study_help`, still impossible to summon again.

  **The beachhead is `mechanics_explainer`** (`packages/shared/src/coaching/detectors/orient.ts:64`). It is **already Buddy volunteering an explanation nobody asked for**, it renders `SHOWN` in production, and it was verified against live data on 2026-08-07. So "Buddy teaches unprompted" is shipped, proven machinery — this entry is about **new content and new triggers on it**, not a new subsystem. That was the original judgement and it has since been demonstrated rather than assumed.

  **Progressive disclosure tied to milestones is the right shape**, and better than a front-loaded tour, because a tour given on day one explains panels the learner has no data in yet. Earning the first milestone is the ideal moment to explain the Progress tab: they now have something to look at, and they have just done something worth congratulating.

  **Buddy is already the right voice.** The nudge system (Phase 1') and Buddy moments (Phase 5) exist; this is new *content and triggers* on shipped machinery, not a new subsystem.

  **Design constraints, from this project's own history:**
  - **Dismissible, and re-openable.** The study explainer is a first-run overlay that writes `kl_has_seen_study_help` and can never be summoned again — see the ⓘ entry below. Do not build a second one of those.
  - **Respect the anti-nag switch.** `mnemonicCoachingEnabled` is an opt-out that exists because interruption is a real cost. A tour system needs the same escape.
  - **Never during a session.** Interrupting retrieval to explain a panel damages the thing being explained.

  **Related:** the ⓘ-to-reopen entry below is the smallest slice of this idea and could ship first.

  `[Effort: M–L]` `[Impact: High — 61 written explanation blocks nobody is shown]` `[Backend: No, unless tour state is server-side]` `[Status: 💡 Idea — new content and triggers on shipped machinery, demonstrated 2026-08-07, not assumed]`

- [ ] **What is the Journal actually for? — ANSWERED 2026-08-07: it is where Buddy writes** *(headline was "the Study Log vision exists but was never built"; Task 8 shipped it)* — Owner (2026-07-28): *"I will likely have more input on this section. Not sure of its utility at this point. Don't we have a plan to repurpose this section for Buddy the tutor?"*

  **Yes — and the recollection is right.** [`2026-04-09-kanji-buddy-design.md`](superpowers/specs/2026-04-09-kanji-buddy-design.md) §153 reimagines the Journal as the **Study Log**: *"a personal record of each learner's memory journey, not just a list of mnemonics."* The same spec names the Journal as Buddy's Stage 2 (**Anchor**) destination — where Buddy takes a learner whose kanji is not sticking — and lists it among the *"disconnected functional areas… the Journal sits as a personal scrapbook, disconnected from the learning loop."*

  **B-211 built the floor of that vision, not the vision.** The tab can now list what the learner has written, which it could never do before. The spec asks for more: entries as a record of *when and where* something was learned, effectiveness surfaced per hook, and opt-in sharing so friends can adopt a hook that demonstrably works, with attribution.

  ⚠️ **LARGELY ANSWERED 2026-08-07 — the repurposing the owner half-remembered has since SHIPPED.** The owner asked *"Don't we have a plan to repurpose this section for Buddy the tutor?"* The answer is yes, and it is no longer a plan. The tab now opens on **Buddy's notebook** (Task 8): agreement, experiments, observations, settled decisions and tutor notes assembled by `assembleNotebook` and rendered by `NotebookBody`, with "Your hooks" kept below it unchanged. Live entry kinds:

  | kind | rows |
  |---|---|
  | `coaching_analysis` | 6 |
  | `onboarding_reasons` / `_intro` / `_appointment` | 3 each |
  | `first_open` | 2 |
  | `commitment` | 1 |

  **So "what is the Journal for?" now has an answer: it is where Buddy writes.** Re-open the question only if that answer is unsatisfying in use — it is no longer unsettled by default.

  **What is still unbuilt from the 2026-04-09 spec**, and all of it is hook-side rather than notebook-side: *when and where* a hook was built, effectiveness surfaced per hook, and opt-in sharing with attribution.

  ⚠️ **The delivery critique now applies here instead.** Everything Buddy gives back lands in this one tab on one staleness-gated cadence (`ANALYSIS_STALE_HOURS = 6`), so the Journal has quietly become the single destination for all returned value — which is why the two entries above are really about getting it out of here and to the moment it matters.

  **The honest question underneath the owner's is whether the Journal should be a destination at all.** If Buddy routes learners there when a kanji fails, it is a *workspace* reached in flow, not a tab browsed on purpose. Those imply different designs, and the current tab is neither.

  **Do not design this in isolation** — it is one of the seven tabs the parent design says do not talk to each other, and the Study Log is the piece meant to connect the study loop to the memory record.

  `[Effort: L → mostly done; what remains is hook-side]` `[Impact: Low-Med — the tab's purpose is SETTLED as of Task 8; this is no longer an open question]` `[Backend: Yes]` `[Status: 💡 Idea — largely answered 2026-08-07; reopen only if the shipped answer disappoints in use]`

## 🎨 UI & Experience

- [x] **Backfill `placement_sessions.inferred_level` for pre-B146 rows — two API surfaces now disagree about a learner's level** — ~~SHIPPED~~ 2026-08-07. **Both** options this entry weighed were done, because each fixes a different half. The migration (`0037`) repaired the data: `UPDATE 3`, the three pre-`504b1ea` sessions going N4 → N3, with the post-fix session and both θ-null rows correctly untouched. Then **B-233** made the tutor derive the level on read (`apps/api/src/services/level-bands.ts`, shared with `CoachingService`), because the backfill alone could not hold — `kanji_difficulty` is a recalibrating table, so the next recalibration would have reopened the split with no bug to blame. Verified against live: all four θ-bearing sessions derive N3 from bands `[-1.454, -0.149, 1.241, 3.112]`. Deployed in `3254290`.

  ⚠️ **One behaviour change:** a session with no `ability_theta` now reports `unknown` to the tutor instead of its stored label. Two live rows are in that state; they need a re-test, not a column.

  <details><summary>Original entry, kept for the reasoning</summary>

  The coaching copy floor (2026-08-04) changed `CoachingService` to **recompute** the level from today's difficulty bands rather than read `placement_sessions.inferred_level`, because the stored value could contradict the credible-interval bounds shown in the same sentence — rendering *"puts you at N4, and the honest range runs from N3 to N2"* on the owner's own session.

  **The stored values are stale, not drifting.** `kanji_difficulty` has not changed since 2026-07-31. Those rows were written by a build predating [`504b1ea` *fix(placement): the level bands were built from the learner's own answers*](https://github.com/radmelon/kanji-learn/commit/504b1ea), which landed 2026-08-01 — and the single live session completed after it is the only one whose stored level agrees with a recomputation. **They will not self-heal until each learner retakes the placement test.**

  **The consequence is a live inconsistency.** `apps/api/src/services/tutor-report.service.ts:141` and `apps/api/src/services/tutor-analysis.service.ts:168` still read the column raw — the latter interpolates it into an LLM prompt as `inferred level = N4`. On **3 of the 4 live sessions** those two surfaces now report a different level from the Journal. Both are exposed through `apps/api/src/routes/report.ts`. Mobile is unaffected: it renders the level from the completion response at test time and never reads it back.

  **Two options.** The durable one is a migration that recomputes and backfills `inferred_level` for pre-B146 rows, which also repairs anything else reading the column. The cheap one is having the tutor path recompute the same way coaching now does, leaving the column stale but unread. The migration is better; the coaching branch deliberately did not attempt it because a data backfill is not a copy change.

  Found 2026-08-04 by the whole-branch review of the copy floor, checking rendered copy against live rows.

  </details>

  `[Effort: M]` `[Impact: Med — a tutor and a learner saw different levels for the same test]` `[Backend: Yes — migration]` `[Status: ✅ Shipped & Verified 2026-08-07]`

- [x] **Build a live-render smoke check for coaching copy** — Eight truthfulness defects were found on the copy-floor branch. **Every one was found by rendering a sentence and checking it against its detector or against live data. Not one was found by a failing test**, and 541 shared tests pass either way.

  The reason is structural: every fixture in the suite is self-consistent by construction, so a fixture can never reproduce the disagreement between a stored value and a recomputed one, or a superlative that is true of the fixture and false of a real session. `apps/api/test/integration/coaching-snapshot.test.ts` even contained an invariant assertion that live data violated, because it seeded its input from the same source it asserted against.

  **What to build:** a script that pulls each real placement session and learner snapshot, renders all ten finding sentences, and prints them for a human to read. It cannot live in CI — it needs live read access — so it belongs beside `scripts/with-live-db.sh` as a manual pre-merge tool. Recorded in the copy-floor spec's §12.5.

  ✅ **SHIPPED 2026-08-06** as `scripts/coaching-smoke-render.mjs`:

  ```bash
  ./scripts/with-live-db.sh node \
    --import ./packages/db/node_modules/tsx/dist/esm/index.cjs \
    scripts/coaching-smoke-render.mjs
  ```

  It drives the **production** path — `CoachingService.assembleSnapshot`, not a reimplementation — then calls `analyze(snapshot, 10)` to bypass the top-3 cap, and prints each sentence directly above the evidence it was built from so the two can be checked against each other. It classifies every kind as **SHOWN** (production displays it today), **HIDDEN** (fires, but loses the top-3 cut, so nobody has ever read it) or **SILENT** (the detector returned null).

  **That distinction was the point.** Before it, 5 of 10 kinds had ever reached a notebook entry. The first run rendered **7 of 10** — `reading_lag` and `retest_due` had been firing all along and losing the cut, so their copy was shipped-but-unread rather than never-triggered. `commitment_gap`, `fluency_gain` and `theta_delta` remain SILENT and their copy is still unverified against reality; checking them needs a learner whose data makes them fire.

  **First run found no truthfulness defects** — worth recording, given the branch's base rate was eight. It did surface one evidence-contract gap: `hook_coverage` renders *"字 keeps catching you out"*, which is guaranteed true by `pickHookCandidate`'s `score >= MIN_STRUGGLE_SIGNALS` filter, but the struggle score is **not** in the finding's evidence — so the sentence's central claim cannot be checked against its own evidence, which is exactly the workflow this tool exists for. Worth adding.

  `[Effort: S]` `[Impact: High — it is the only thing that has ever caught this defect class]` `[Backend: No — read-only script]` `[Status: ✅ Shipped & Verified]`

- [ ] **Review the Journal's UI/UX — nothing owns it, and it is the surface Buddy's coaching lands on** — The Journal was built by the [2026-07-31 notebook spec](https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-07-31-buddy-home-notebook-design.md) and has not been revisited since. **Verified 2026-08-03: no slice owns its presentation layer.** The parent coaching spec's §12 lists six slices — analyzer, notebook surface, conversational surface, companion mode, IRT explainer, goal beat — and none is presentation. The notebook spec's own §15 out-of-scope list defers voice conversation, the localised tutor report, Phase 4 social and Progress refinements, and lists **no** Journal presentation work, because it considered the surface finished when it shipped. So this is not deferred; it is unowned.

  **Deliberately not specced on 2026-08-03**, when the coaching copy floor was written. The owner's complaint that Buddy's note gave "less than zero value" was entirely about *content* — which test, which kanji, what to do — and no part of it was about layout, spacing or hierarchy. Speccing presentation then would have been guessing at a second problem before the first was fixed.

  **The honest trigger for this review:** read the Journal again once the copy floor ships. If the entries are now useful but hard to read — too dense, unclear which entry is current, no sense of trajectory across the superseded chain — spec it from what is actually wrong, not from a guess. The nearest already-queued item is the notebook spec's §14.1, *how many observations stay live before ageing into the archive*, which that spec calls "a number to tune against real sessions, not to guess once" — a presentation decision wearing a data-retention costume.

  Captured 2026-08-03 (owner, after the slice 3 deploy).

  `[Effort: M]` `[Impact: Med — the surface all coaching output lands on]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Decide whether co-authored hooks belong in the Journal or under Progress** — Open question raised by the owner 2026-08-03, to be settled as part of the Journal UI/UX review above rather than in isolation.

  The tension is real in both directions. **For the Journal:** a hook is something the learner and Buddy *made together*, and the Journal's whole premise is the shared record of what was decided — the notebook spec's §4 is titled "Authorship and rights". **For Progress:** a hook is an artifact you go back and *use*, and Progress is where the learner already looks things up; a growing list of hooks is closer to a collection than to a conversation. There is also a volume argument — hooks accumulate without bound while Journal entries age into an archive.

  Worth settling with the retention question (§14.1) in the same pass, since "where do hooks live" and "how long do observations stay live" are the same decision about what the Journal is *for*.

  `[Effort: S to decide, M to move]` `[Impact: Med]` `[Backend: Maybe — depends on the surface]` `[Status: ❓ Open question]`

- [ ] **A quiz item that challenges a hook after it has caught — specced in 2026-05-31 and never built** — The owner asked on 2026-08-03 whether we had discussed a test item that challenges a kanji where a hook has caught. **We did, in detail, and it does not exist.**

  The [Phase 5 co-creation spec](https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-05-31-phase-5-mnemonic-cocreation-design.md) §8 is titled "The story → kanji quiz (first-test of a fresh hook)", and its §1 states the principle directly: *"A freshly-built hook is tested soon via a new story → kanji quiz item."* Its parking lot then explicitly defers the broader version: *"Story → kanji as a **recurring** review modality across all hooks (not just the fresh-hook first-test)."*

  **Verified 2026-08-03: neither shipped.** `TestService.QuestionType` is `meaning_recall | kanji_from_meaning | reading_recall | vocab_reading | vocab_from_definition` — five types, none hook-related. `mnemonic_recall`, `story_to_kanji` and equivalents appear **nowhere** in `apps/` or `packages/`. This is the same class of defect the coaching spec's `QuizOutcome` header already records: a design-list question type with zero rows, which a detector keyed on it would match silently and forever.

  **Why it matters more now than it did in May.** The coaching analyzer offers to build hooks (`hook_coverage`) and measures whether they help by comparing mean lapses on ordinary reviews with and without a hook (`lapsesWithHook` vs `lapsesWithoutHook` in `HookSnapshot`). That is an *indirect* proxy — nothing ever tests the hook itself. A story → kanji item would turn hook efficacy from an inference into a measurement, and would give `hook_coverage`'s offer a closing loop it currently lacks.

  What the owner asked for is closer to the **parked recurring version** than to the fresh-hook first-test: challenging a hook *after it has caught*, not immediately after it is built.

  Captured 2026-08-03 (owner, during the copy floor spec review).

  `[Effort: M]` `[Impact: High — closes the loop on the co-creation flow's core claim]` `[Backend: Yes — new question type, generation, and `kl_test_results` vocabulary]` `[Status: 💡 Idea — specced 2026-05-31, never implemented]`

- [ ] **"How studying works" is unreachable after first dismissal — add an ⓘ to reopen it** — The study-screen explainer (grading semantics, swipe directions, what Again/Hard/Good/Easy each do) is a **first-run overlay only**. It is gated on `showOnboarding` and dismissal writes `HELP_KEY = 'kl_has_seen_study_help'` to SecureStore ([study.tsx:55,263,769](apps/mobile/app/(tabs)/study.tsx)), after which nothing in the UI can bring it back. A learner who taps past it on day one — when the content means least, because they have not studied yet — never sees it again.

  **The app already has the pattern.** The Progress tab surfaces the same kind of explainer on demand via `information-circle-outline` buttons over `InfoSection[]` arrays (`INFO_BREAKDOWN`, `INFO_CONFIDENCE`, `INFO_VELOCITY`, "How evaluation works", …) at [progress.tsx:679](apps/mobile/app/(tabs)/progress.tsx). The onboarding copy even teaches ⓘ as the convention — *"Tap ⓘ to understand how stroke-order scoring works"* ([onboarding-content.ts:44](apps/mobile/src/config/onboarding-content.ts)). Study is the outlier: its explainer is the one that is one-shot.

  **Fix:** add an ⓘ button to the study screen header that sets `showOnboarding` to true, reusing the existing Modal verbatim — no new content, no new component, and dismissal keeps writing `HELP_KEY` so first-run behaviour is unchanged. Worth auditing whether any other first-run overlay is similarly stranded.

  Found 2026-07-27 (owner, during the Plan 4 co-creation smoke test): *"the popup is useful and we should provide a UI mechanism for accessing it on demand — I am seeing it now while testing and had forgotten it was available."* Note the discovery path: the only reason it reappeared was a **fresh test account**, which is exactly the state a real new user is in and an existing user can never return to.

  `[Effort: XS]` `[Impact: Med — grading semantics drive SRS quality; a learner who mis-grades gets a mis-tuned schedule]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **A hook can be reinforce-challenged in the same session it was created — add a freshness guard** — Observed on-device in **B144** (2026-07-28): the owner built a hook mid-session, and the reinforce challenge fired on that same hook at Session Complete minutes later.

  **Mechanism.** `pickBuddyMomentAction` selects `reinforce` for any kanji where `hasHook && struggledToday`, with **no check on when the hook was created** ([trigger.ts](packages/shared/src/mnemonics/trigger.ts)). Building a hook for a kanji you just graded Again makes it instantly eligible for its own reinforce challenge — asking a learner to recall a story they wrote four minutes ago.

  **Same class of flaw as the immediate quick-check deleted the same day (B-218):** a test with no failure mode, run so soon after creation that it measures nothing, and whose result nonetheless feeds `effectivenessScore`. A 👍 there inflates the EMA for a hook that has never actually been retained; a 👎 penalises one that has never been tested.

  **Fix direction:** require some minimum age (or at least one intervening session) before a hook is reinforce-eligible. `mnemonics.created_at` is already available to `getBuddyMomentContext`, which is where the other Buddy-moment fields are assembled.

  **Related:** the recall-quiz redundancy entry below, and B-218. All three are the same question — *what is the earliest moment at which testing a hook actually measures anything?* — and would be better answered once than three times.

  `[Effort: S]` `[Impact: Med — inflates effectivenessScore, which drives the deepen gate]` `[Backend: Yes — one extra column in the context projection]` `[Status: 💡 Decision needed]`

- [ ] **The recall quiz tests a kanji immediately before its own flashcard — decide what a "test" means here** — Found on-device in **B144** (owner, 2026-07-28), while confirming the recall-quiz loop works: *"Do we want the mnemonic challenges as part of the normal flashcard study session?"*

  **The redundancy.** `insertRecallQuizFirst` front-loads the freshly-hooked kanji, and the recall leg runs before that kanji's flashcard. So the learner reads their story, picks 暗 from four tiles — and is then immediately shown 暗's flashcard. **The second test is primed by the first**, seconds earlier, so whatever grade they give is inflated. That quietly corrupts the FSRS signal for precisely the kanji they care most about.

  Parent spec §8 asks for the test "early, while fresh". It does not ask for it to be adjacent to the same kanji's flashcard; that is an artefact of front-loading, not a design decision.

  **Three ways out** (owner leaning toward 2, 2026-07-28):

  1. Move the recall quiz to the **end** of the session — still fresh, no longer adjacent.
  2. **Keep it first and skip that kanji's flashcard for the session.** The recall quiz *is* a retrieval test; a second test of the same item in the same minute is redundant regardless of ordering.
  3. Keep both but **separate them** in the queue.

  **Option 2 costs less than it first appears.** The recall quiz tests story→kanji recognition; the flashcard tests meaning or reading recall. Only the latter is what FSRS schedules on. So the honest reading is that the kanji **simply was not reviewed that day** — record no grade, touch no schedule, leave it due, let it return on normal rotation. No SRS consequence at all.

  **Should these move into "Take a Quiz" instead? No — not as a replacement.** `/test` is **elective**: the learner chooses to enter it, it pulls 10 questions and submits as `exit_quiz`. The recall quiz is **scheduled** — its due stamp is set at hook creation and its whole value is proximity to creation. Move it somewhere the learner must opt into and a hook may go untested for weeks, or forever; the stamp becomes decorative. The study session is the only place they reliably appear.

  **But worth adding there separately.** `mnemonic_recall` already persists as a `testType` (verified Plan 4 Task 11 Step 1, no migration needed) and `/v1/tests/questions` already accepts `types=`. A "drill my hooks" option in Take a Quiz is a small addition for deliberate practice — elective repetition on top of a guaranteed first test, not instead of it.

  `[Effort: S (option 2) / S (Take a Quiz type)]` `[Impact: Med — inflated grades on hooked kanji feed bad scheduling]` `[Backend: No for option 2]` `[Status: 💡 Decision needed — akin to B-210, a "what should a test mean" question rather than a defect]`

- [ ] **Review and reorder the Profile page sections — "About & Licences" is buried** — The Profile screen has eleven sections and their order looks accreted rather than decided. Owner (2026-07-27): *"I find myself often searching for the About & License page link and it is buried half way down the profile page, while Notifications and Privacy and Study Preferences are high up."*

  **Current order** ([profile.tsx](apps/mobile/app/(tabs)/profile.tsx)): Display Name (424) → Daily Review Goal (438) → Notifications (456) → Privacy (552) → Study Preferences (595) → Apple Watch (598) → **App** (630) → Learning Profile (659) → Study Mates (743) → Share with Tutor (881) → Sign out / Delete account.

  **Two problems, not one.** The obvious one is position: **About & Licences sits 7th of 11**. The subtler one is that its parent section, **"App", is a grab-bag** — it pairs *Placement Test* (an action that starts a study activity) with *About & Licences* (a static info link). Nothing about the heading predicts either, so scanning for "About" fails even once you are looking at the right region of the page.

  **Worth deciding rather than nudging.** A principled ordering would group by *how often a setting is touched and why*: identity and goals first (Display Name, Daily Review Goal, Learning Profile), then things tuned occasionally (Notifications, Privacy, Study Preferences, Apple Watch), then social (Study Mates, Share with Tutor), then rarely-visited-but-must-be-findable (Placement Test, About & Licences), then destructive last (Sign out, Delete account). Note that under that rule About moves *down*, not up — the fix is a predictable home plus a heading that names it, not raising it above settings people actually change. Also worth asking whether an eleven-section scroll wants grouping headers or a search field at all.

  `[Effort: S — reorder + rename sections; no new components]` `[Impact: Med — pure findability; the owner already hits this repeatedly]` `[Backend: No]` `[Status: 💡 Idea — ordering to be decided]`

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

- [ ] **"Buddy voice": cloud TTS for hooks, tiered like the assembly cascade (Plan 4)** — The free tier shipped 2026-07-05 (`src/utils/tts.ts` `getBestVoice`: prefer the device's Enhanced voice over the compact default, applied to hook Speak-it, kanji-detail readings, and study-card readings). Next tiers, deferred to Plan 4 / pre-launch: **(a) Cloud TTS cached per hook** — synthesize audio once at hook creation (OpenAI TTS / ElevenLabs / Polly; multilingual voice fixes Japanese pronunciation for free), store the file, play thereafter; works offline after first fetch; gives Buddy a consistent branded voice; needs a backend surface + the BYOK cost story. **(b) Tiered fallback** mirroring the assembly cascade: cloud TTS when online → best local Enhanced voice offline. Consider alongside `speakMixed` (entry above) — a multilingual cloud voice may make per-run language segmentation unnecessary on the cloud tier.

  Captured 2026-07-05 (owner: "the voice was not very good" — Speak-it walkthrough feedback). Also in Open Brain.

  `[Effort: M (cloud tier) ]` `[Impact: High — Buddy gets a voice; every speak surface improves]` `[Backend: Yes — synthesis + audio storage]` `[Status: 💡 Planned — Plan 4 / pre-launch]`

- [ ] **Mixed-language TTS: Japanese voice for Japanese runs inside English speech** — The co-creation "Speak it" button (added 2026-07-05 on `phase-5-cocreation-ui`) reads the whole hook story with the en-US voice, so embedded Japanese — kanji (円), kana (まど), readings, `readingPlay` wordplay — gets mangled. Build a shared `speakMixed(text)` utility that segments text into language runs (Unicode kana/kanji/CJK ranges vs everything else) and speaks each run with the matching expo-speech voice (`ja-JP` vs `en-US`), queued sequentially — the kanji detail screen already uses the sequential-speak pattern for reading lists (mind its noted iOS transient "stopping" state issue when chaining `Speech.speak`). Apply everywhere speech mixes languages: hook Speak-it, mnemonic display on kanji detail, future Buddy speech.

  Captured 2026-07-05 (owner request, during Plan 3b walkthrough). Also in Open Brain.

  `[Effort: S]` `[Impact: Med — polish that compounds across every speak surface]` `[Backend: No]` `[Status: 💡 Idea]`

- [ ] **Hook co-creation location: `attach_location_to_hooks` privacy switch + first-time Buddy explainer (Plan 4)** — Co-created hooks store GPS coordinates (`mnemonics.latitude/longitude`) gated only by the app-wide iOS location permission, so a user who granted location for milestones silently opts into hook coordinates too. Add a second Privacy switch on the Profile page (`attach_location_to_hooks`), mirroring the `attach_location_to_milestones` pattern in all four layers: `user_profiles` column, `user-profile.schema.ts`, a Switch row in the Privacy section, and a gate in `useCoCreation.accept()` (skip `getPlace()` when off).

  **Decision (owner, 2026-07-05):** the **first time** a learner enters hook co-creation, Buddy asks in-flow whether to turn the feature on — new users won't discover or understand the value from a buried settings row, and the moment gives Buddy the chance to explain what is stored and why (future geo-triggered recall: re-surfacing a hook when the learner returns to the place they built it — see Open Brain "Geo-triggered Recall" idea). After that single ask, the switch governs absolutely:
  - **OFF** → skip GPS inference; typed "Where are you right now?" question only; no coordinates stored; never re-ask (optional passive caption: "Location is off for hooks · Profile → Privacy").
  - **ON + OS permission not determined** → the iOS dialog fires mid-flow right after "Let's do it".
  - **ON + OS denied** → typed question (re-enable lives in iOS Settings).

  Needs a per-user first-ask-seen flag, server-side so it survives reinstalls. Slots into Plan 4 alongside the `location_inference` reducer cleanup and the "Not now" 7-day cooldown.

  `[Effort: S]` `[Impact: High — privacy trust + unlocks geo-recall]` `[Backend: Yes — profile column + schema]` `[Status: 💡 Planned — Plan 4]`

- [ ] **Stickier-after-save: "Go deeper" must reopen the stickier inputs on an existing hook (Plan 4)** — Today "Make it stickier" (the step where the learner adds a personal detail and Buddy rebuilds the story to weave it in, plus records it in `cocreation_context.layers`) exists **only inside the create flow**, in `CoCreationSheet.tsx`. Once the hook is saved the door closes: the sheet unmounts, and `kanji/[id].tsx` hides the manual entry point entirely once `generationMethod === 'cocreated'` — the branch already marks the gap in-line ("Go deeper" entry is Plan 4 — this is only the create entry).

  Practical effect: a hook can only ever be improved during the ~60 seconds it is first built. A learner who later discovers a better personal anchor — which is exactly when the memory work is most valuable, since the hook has by then failed them in a review — has no way in. The kanji detail page shows the co-created hook with no affordance to strengthen it.

  **Shape:** replace the hidden "Build a hook" button with a **"Go deeper"** button on kanji detail whenever a co-created hook exists. It reopens `CoCreationSheet` directly at the stickier step, pre-loaded with the saved story, and routes the rebuild through the existing `/deepen` endpoint (shipped in Plan 2) rather than `/assemble`. Per the spec, deepen is **additive — append a layer, never discard** the prior story, so previous layers stay in `cocreation_context.layers` and the learner can't lose a hook by experimenting with it.

  Captured 2026-07-05 (Plan 3b walkthrough). Was previously tracked only in the HANDOFF Plan-4 scope line and Open Brain — written up here 2026-07-26 so the Plan 4 input list is complete.

  `[Effort: S–M]` `[Impact: High — a hook is only improvable in the one minute it's born]` `[Backend: No — /deepen already exists]` `[Status: 💡 Planned — Plan 4]`

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

- [x] **`GET /health` returns the build's git SHA — deploys are verifiable by one curl** — ~~SHIPPED~~ 2026-08-06. `scripts/deploy-api.sh` computes `git rev-parse --short HEAD` (with a `-dirty` suffix when the tree has uncommitted changes) and passes it as `--build-arg GIT_SHA`; the Dockerfile bakes it to `ENV` as the last layer before `EXPOSE`, and `health.ts` returns it as `sha`. Verify a deploy by comparing it to `git rev-parse --short HEAD`.

  **Why it exists.** `docs/SOP.md` requires every deploy be verified by response *content* because status codes lie here — a Phase 5 rollout was reported "verified" while App Runner served a 6-week-old image. Until now each feature needed its own bespoke canary, and they got progressively worse: Phase 5 used `components` on `GET /v1/kanji/:id`; the coaching copy floor (2026-08-06) required opening the app to force a staleness-gated refresh and then comparing row timestamps, because `ANALYSIS_STALE_HOURS` means **a deploy rewrites no rows and the pre-deploy text is indistinguishable from a failed rollout.** That check was nearly read as a failure.

  A SHA cannot be faked by route shadowing, needs no auth, no learner and no waiting. The repo is public, so the value discloses nothing not already on GitHub.

  **Not yet proven in production** — the field only appears on the first deploy that carries it, so it verifies itself on the next rollout.

  `[Effort: S]` `[Impact: High — retires a recurring class of false "verified"]` `[Backend: Yes]` `[Status: ✅ Shipped — proves itself on the next deploy]`

- [ ] **Secrets Management — Rotate Exposed Keys + Move to SSM Parameter Store** — All production secrets are currently stored as plaintext `RuntimeEnvironmentVariables` on App Runner and mirrored in `packages/db/.env` for local development. This works at today's scale but carries real risk: (a) keys pasted through chat / screen share / support logs can leak; (b) App Runner env vars are visible to anyone with AWS console access to the account — there's no per-variable access control; (c) there's no rotation cadence, so a leaked key stays valid until manually revoked; (d) `aws apprunner describe-service` without a scoped `--query` returns the full plaintext map, so routine ops commands can dump secrets into logs.

  **Known exposure events (2026-04-19 → 2026-04-20):**
  - 2026-04-19 — `GROQ_API_KEY` and `GEMINI_API_KEY` pasted through chat when being added to App Runner for the first time.
  - 2026-04-20 — `ANTHROPIC_API_KEY` echoed via an unmasked `grep` on `packages/db/.env`.
  - 2026-04-20 — `DATABASE_URL` (with Supabase postgres password), `INTERNAL_SECRET`, `SUPABASE_JWT_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` returned in the response body of an `aws apprunner describe-service` call. **All seven keys required rotation.**

  ✅ **Half of this shipped 2026-07-29 — the SSM migration is DONE.** **Verified against live AWS on 2026-08-06.** All seven secrets are `SecureString` parameters under `/kanji-learn/prod/`, and App Runner reads them through `RuntimeEnvironmentSecrets` by ARN. `RuntimeEnvironmentVariables` now holds only ten non-sensitive values (`HOST`, `PORT`, `CORS_ORIGIN`, `LOG_LEVEL`, `SES_SENDER_EMAIL`, …). **The plaintext-env exposure described above is closed.**

  🔴 **The rotation is HALF done — and it is the wrong half.** SSM parameter versions are the record. Version 2 means written twice — created, then rotated. Version 1 means never touched since creation:

  | Parameter | Version | Rotated? |
  |---|---|---|
  | `anthropic-api-key` | 2 | ✅ |
  | `groq-api-key` | 2 | ✅ |
  | `gemini-api-key` | 2 | ✅ |
  | `internal-secret` | 2 | ✅ |
  | `database-url` | **1** | ❌ |
  | `supabase-jwt-secret` | **1** | ❌ |
  | `supabase-service-role-key` | **1** | ❌ |

  **Confirmed by value, not merely by version.** On 2026-08-06 the three Supabase parameters were fetched with `--with-decryption` and compared by sha256 fingerprint against `packages/db/.env` (fingerprints and JWT time claims only; **no value was printed**). All three are **byte-identical in production and locally**, and `supabase-service-role-key` decodes to `iat` 2026-03-27, `exp` **2036-03-26**, `role=service_role`.

  **That means the credentials exposed on 2026-04-20 are still live in production and remain valid until 2036.** The `iat` predates the exposure, so this is the leaked key itself, not a successor.

  **The Supabase rotation was deferred to October by the owner** — a decision on record in the 2026-08-02 handoff section, not an oversight.

  ⏰ **The three LLM keys expire 2026-10-26, and expiry is SILENT.** `ANTHROPIC_API_KEY`, `GROQ_API_KEY` and `GEMINI_API_KEY` were issued **2026-07-28** with a 90-day life. The SSM record agrees exactly: those three sit at version 2, modified 2026-07-29 — the day after issue.

  **`/v1/buddy/meet/turn` returns `{fallback:true}` at HTTP 200 on any failure**, so an expired key does not error. Buddy silently drops to template tier and nothing surfaces. Meanwhile `docs/secrets-rotation.md` schedules the rotation *for 2026-10-26* — the expiry date itself, i.e. **zero margin**. **Rotate in early October.** The owner's stated target is **2026-10-02**.

  **This resolves an apparent contradiction; do not re-investigate it.** An owner report on 2026-08-06 described "the Supabase credentials, rotated, expiring in ~90 days in October", which the SSM evidence appeared to refute outright. Two separate facts had merged: the **LLM** keys were rotated and do expire in October; the **Supabase** keys were neither. Both halves were true — of different keys.

  **What is actually outstanding:** rotate `DATABASE_URL`, `SUPABASE_JWT_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`, revoke the old ones, and `put-parameter --overwrite` each — which bumps them to version 2 and makes the table above self-verifying next time.

  ⏳ **The deferral expires 2026-10-02.** Rotating the Supabase three is deferred to the `ap-southeast-2` → `us-east-1` migration, which reissues them by construction — sound reasoning, since rotating now is throwaway work. **But if cutover has not happened by 2026-10-02, rotate them anyway**, alongside the LLM keys being done that day. The exposed values stay live until one or the other occurs, and they have been live since 2026-04-20 — each deferral individually reasonable, none ever forcing a re-decision. Migration spike: `docs/superpowers/plans/2026-08-06-supabase-region-migration-spike.md`. Full backstop: `docs/secrets-rotation.md`.

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

- [x] **Three-Modality Learning Loop** — Owner-proposed 2026-04-20 during Build 3-C Phase 4 verification. ~~SHIPPED (core)~~ in B134 as the **Practice Loop** (Plans A/B/C, 2026-05). The multi-modal pedagogy landed in a different — better — form than spec'd here: instead of a batch-level gate between sessions, every *new* kanji and every review graded *Again/Hard* routes **inline** through flashcard → writing → speaking within the same session (`review.store.ts` leg state machine; a session never ends mid-path). "Maybe slipping" Good/Easy reviews get a quiz leg. Drill Weak Spots / missed-card drills stay flashcard-only by design.

  The inline design mooted the original open questions: no cross-tab orchestration layer needed (Write/Speak tabs were absorbed into the study session, B134 nav rework); no cross-day persistence, sparse-data, or escape-hatch problems because the legs are immediate and per-kanji.

  **Not built (retained as an idea only if the inline loop proves insufficient):** the batch-gate variant — locking *further flashcard sessions* until the previous batch's kanji clear writing AND speaking.
  `[Effort: XL]` `[Impact: High]` `[Backend: Yes]` `[Status: ✅ Core shipped B134 — batch-gate variant remains 💡 Idea]`

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
