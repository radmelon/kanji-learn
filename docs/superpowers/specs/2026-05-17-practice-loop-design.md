# Three-Modality Practice Loop — Design Spec

**Status:** Approved design (brainstorm complete) — ready for implementation planning.
**Date:** 2026-05-17
**Scope tag:** Spec 1 of a three-spec arc (see "Where this sits").

## Context

Kanji Buddy currently exposes Study (SRS flashcards), Speaking, and Writing as three
independent drill tabs. The learner decides when and whether to move between them — the
app does not route practice. The project's pedagogy thesis is the opposite: recognition,
production (writing), and vocalisation (speaking) each strengthen retention through
different cognitive pathways, and the app should actively route the learner through them
rather than leave it to DIY tab-hopping.

This spec designs the **Practice Loop** — a single, time-boxed study session that
integrates all three modalities plus an objective quiz check, routing each kanji
just-in-time based on how the learner performs.

### Where this sits — a three-spec arc

- **Spec 1 — The Practice Loop (this document).** The integrated, rule-routed,
  time-boxed loop.
- **Spec 1.5 — FSRS migration.** Replace the SM-2 scheduler with FSRS so per-kanji
  *retrievability* becomes a real confidence signal. Best done pre-launch while the
  dataset is tiny. Its own brainstorm.
- **Spec 2 — Buddy, the AI tutor.** The mascot-fronted AI coach that consumes the loop's
  per-modality telemetry, detects weaknesses, suggests focus, and co-builds mnemonic
  hooks. Repurposes the Journal tab. Its own brainstorm.

Spec 1 produces the per-modality performance data; Spec 2 reasons over it. Spec 1's
"weak" / "slipping" detection is deliberately simple rule-based logic — the seam Buddy
later upgrades.

## Scope

**In scope**
1. Navigation restructure — Study / Speaking / Writing collapse into one loop; Browse
   promoted to a tab.
2. The loop mechanic — per-kanji just-in-time routing.
3. Time-boxed sessions — the daily goal becomes a minutes budget.
4. The quiz leg — the existing quiz engine wired into the loop, with feedback into
   scheduling.
5. Per-modality telemetry — ensure each leg records a result (the data Spec 2 needs).

**Explicitly out of scope (deferred)**
- The AI tutor / Buddy (Spec 2).
- The FSRS migration (Spec 1.5) — Spec 1 ships on the existing SM-2 engine.
- Repurposing the Journal tab (Spec 2 — left untouched here).
- Per-user FSRS parameter fitting, the planned Pedagogy MCP server, tutor-report changes.

## §1 — Navigation restructure

Current tab bar (7): Dashboard · Study · Journal · Write · Speak · Progress · Profile.

Changes:
- **Remove the Write and Speak tabs.** Their practice surfaces (`WritingPractice`,
  `VoiceEvaluator` components) are reused *inside* the loop, not as standalone
  destinations. This removal is deliberate: standalone modality tabs are a permanent
  invitation to bypass the loop, which undercuts the "app routes practice" thesis.
- **Promote Browse to a tab.** The Kanji Browser (lookup-driven study) is currently a
  buried button inside the Progress tab. Lookup-driven study is a first-class
  pedagogical pillar and deserves a tab.
- **Journal stays untouched** — Spec 2 transforms it into the Buddy tab.

Resulting tab bar (6): **Dashboard · Study · Browse · Journal · Progress · Profile**.
(Tab titles are kept as-is; no tab is renamed in Spec 1.)

Files: `apps/mobile/app/(tabs)/_layout.tsx` (tab definitions); `apps/mobile/app/(tabs)/voice.tsx`
and `writing.tsx` (removed as tab screens — their logic moves into the loop);
`apps/mobile/app/browse.tsx` (becomes a tab screen; currently a modal route).

No standalone modality practice ships in Spec 1. (A future "extra practice" affordance
from a kanji's detail page is possible but explicitly not built here.)

## §2 — The loop mechanic

One session pulls kanji one at a time and routes each *just-in-time* — the flashcard
reveals the weakness, and the intervention or check happens immediately, on that kanji.
There are no separate per-modality phases.

**New / learning kanji** — always full encoding:
`flashcard intro → writing → speaking`

**Review kanji** — flashcard first, then routed by the learner's self-grade:
- **Again / Hard** (weak) → `writing → speaking` immediately.
- **Good / Easy, flagged "maybe slipping"** → `quiz`. Pass → confirmed, done.
  Fail → `writing → speaking`.
- **Good / Easy, not flagged** → done; next kanji.

Modality order within a kanji: flashcard → writing → speaking (recognition → production →
vocalisation).

**"Maybe slipping" proxy (rule-based, v1).** A review kanji is flagged for a quiz when,
despite a Good/Easy self-grade, either:
- it carries a **Hard or Again grade within its last few reviews** (recently shaky), or
- it is a **mature card drawn into a small verification sample** (generalising today's
  ~12% "surprise burned" tier).

This proxy is intentionally crude — Spec 2's Buddy replaces it with real slippage
detection.

## §3 — Time-boxed sessions

The **daily goal changes from a card count to a minutes budget** (e.g. 10 / 15 / 20 / 30
minutes). This *replaces* the card-count goal — there is no dual mode.

Rationale: a card count is a dishonest unit (20 easy reviews vs 20 new-kanji-with-writing
differ several-fold in time), and it balloons with the SRS due-pile ("127 due" is
demoralising). A minutes budget is consistent, sustainable, and self-balances the
multi-modal loop — whatever mix of modalities fits the budget, fits.

**Session behaviour**
- The session runs until the minutes budget is spent, then **finishes the current
  kanji's path** (never a hard cut mid-writing) and ends.
- **Priority for spending the budget:** due reviews first (most-overdue first), then new
  kanji — with a **small guaranteed new-kanji allowance** so a heavy review day still
  introduces some new material and forward progress never fully stalls.
- **Beyond the budget:** after Session Complete, a "Keep studying" option lets the
  learner continue past the target duration. The daily goal is already met; this is
  clearly-optional extra effort, not a new goal.
- The due-pile may still hold cards when time runs out — that is normal, healthy SRS
  behaviour, not a failure state.

**Goal completion / streaks** key off minutes studied. `cards-reviewed` remains a tracked
statistic, so analytics and the velocity-drop metric are unaffected in unit.

Ripple surface: onboarding (collects minutes), `userProfiles.dailyGoal` semantics, the
Apple Watch `applicationContext` payload (`dailyGoal`), notification copy, and the
Session Complete screen.

## §4 — The quiz leg

The app already has a full quiz feature — `apps/mobile/app/test.tsx`,
`apps/api/src/routes/test.ts`, the `testSessions` table, five question types
(meaning_recall, reading_recall, kanji_from_meaning, vocab_reading, vocab_from_definition;
multiple-choice). Today it is deliberately decoupled from the SRS — quiz answers have no
effect on card scheduling; it is purely self-assessment.

Spec 1 wires that engine into the loop and gives the result teeth:
- When a review kanji is flagged "maybe slipping" (§2), the loop serves a quiz question
  for it.
- **Quiz pass** → the kanji is confirmed; the loop moves on.
- **Quiz fail** → treated as a genuine lapse: it routes to `writing → speaking`, **and**
  the result is fed through the existing `calculateNextReview` as a low grade so the card
  resurfaces sooner.

The feedback rule is specified **behaviourally** — "a failed quiz counts as a lapse; the
card resurfaces sooner" — not as ease-factor manipulation. This survives the Spec 1.5
FSRS swap unchanged (under FSRS a failed quiz is simply another recall-failure event).

This consciously reverses the prior "quizzes never affect scheduling" decision, but only
for quizzes served inside the loop. Whether the standalone quiz surface (`test.tsx`) is
kept, and its behaviour if so, is a detail for the implementation plan.

## §5 — Study tab UX

The Study tab is the loop's home. Three screens:
1. **Ready screen** — today's plan: the minutes budget, due count, a "Begin" action.
2. **The loop** — flashcard / writing / speaking / quiz step screens (reusing `KanjiCard`,
   `WritingPractice`, `VoiceEvaluator`, and the quiz question UI), with a quiet
   time-remaining indicator.
3. **Session Complete** — minutes studied, kanji touched, a modality breakdown (counts of
   flashcard / writing / speaking / quiz reps), streak credit, and the "Keep studying"
   option.

There is **no punitive lockout** — the loop guides; it does not gate. The original
roadmap framing ("gate further flashcard sessions until writing+speaking is done")
dissolves into the loop's structure: because the loop is a single integrated session,
there is no separate flashcard-only session left to gate.

## §6 — Data & telemetry

Every loop leg records a per-kanji, per-modality result:
- Writing → `writingAttempts`
- Speaking → `voiceAttempts`
- Quiz → `testSessions` (and per-question records)
- Flashcard grade → existing SRS review logs (`reviewLogs`)

These tables already exist. Spec 1's requirement is that the loop *consistently writes
them*, tagged with the kanji id and outcome, so a per-(kanji, modality) performance
history accumulates. This history is the substrate **Spec 2's Buddy** consumes — Spec 1
produces the data, Spec 2 reasons over it. Spec 1 introduces no new tables; the only
data-model change is the `dailyGoal` field's reinterpretation from a card count to
minutes (§3) — the implementation plan decides whether that warrants an explicit
migration or column rename.

## Verification

- **Navigation:** the Write and Speak tabs are gone; Browse is a tab; the bar shows 6
  tabs; the Browse tab opens the kanji browser.
- **Loop routing:** a new kanji runs flashcard → writing → speaking; a review kanji graded
  Again/Hard runs writing → speaking; a review kanji graded Good/Easy and flagged runs a
  quiz; a quiz fail routes to writing → speaking and resurfaces the card sooner; an
  unflagged Good/Easy kanji ends immediately.
- **Time-box:** a session ends at the minutes budget after finishing the current kanji;
  onboarding collects minutes; Session Complete reports minutes; streak credit triggers on
  the minutes goal; "Keep studying" continues past the budget.
- **Telemetry:** after a session, `writingAttempts` / `voiceAttempts` / `testSessions`
  contain rows for the kanji practised in each modality.
- Typecheck `apps/api` and `apps/mobile`; on-device walkthrough of a full loop session.

## Open questions deferred to later specs

- FSRS migration mechanics and parameter fitting (Spec 1.5).
- Buddy's weakness-detection model, the Journal→Buddy tab, mnemonic co-building (Spec 2).
- Whether a standalone "extra practice" affordance (e.g. from kanji detail) is ever added.
- The canonical learning ladder (JLPT levels vs Kyōiku grades) — a standing pedagogy
  question, not blocking this spec.
