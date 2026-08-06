// Contracts for Buddy's coaching analysis (spec §2).
//
// `LearnerSnapshot` is the ONLY input to the analyzer. Everything the feature
// will ever tell a learner is computed from this shape, with no I/O and no
// clock — `now` is passed in. Slice 2 fills it from Postgres; slice 1 proves
// the arithmetic without a database.

import type { JlptLevel, SrsStatus } from '../types'

export type FindingKind =
  // Direct — findings that change behaviour (priority 1)
  | 'reading_lag' | 'leech' | 'commitment_gap' | 'hook_coverage'
  // Orient — trust and understanding (priority 2)
  | 'level_estimate' | 'mechanics_explainer'
  // Motivate — reasons to come back (priority 3)
  | 'fluency_gain' | 'theta_delta' | 'hardest_cleared' | 'retest_due'

/** Priority band per §3. Lower sorts first when scores tie. */
export const FINDING_PRIORITY: Record<FindingKind, 1 | 2 | 3> = {
  reading_lag: 1, leech: 1, commitment_gap: 1, hook_coverage: 1,
  level_estimate: 2, mechanics_explainer: 2,
  fluency_gain: 3, theta_delta: 3, hardest_cleared: 3, retest_due: 3,
}

/**
 * A specific value behind a finding. The LLM sees these; it never sees a row.
 * `label` is display-safe text already computed here, so the voice layer has
 * nothing left to calculate — that is the load-bearing invariant of §1.
 */
export interface Evidence {
  label: string
  value: number | string
  kanjiId?: number
  character?: string
}

/**
 * Every `Evidence.label` the detectors emit.
 *
 * Shared between the detector that WRITES a label and the formatter in copy.ts
 * that READS it. Without this, a formatter matches a string literal and a
 * rename yields `undefined` inside a learner-facing sentence — the exact
 * failure mode that produced the note this work exists to fix.
 *
 * ⚠️ These strings are a WIRE CONTRACT, not an implementation detail. Slice 3's
 * buildCoachingPrompt serialises `${label}: ${value}` into the LLM prompt, so
 * renaming one changes what the model is told. labels.test.ts pins them.
 */
export const EVIDENCE_LABELS = {
  KANJI_GIVING_TROUBLE: 'kanji giving trouble',
  ACTIVE_KANJI: 'active kanji',
  LAPSES: 'lapses',
  MOST_LIKELY_LEVEL: 'most likely level',
  LOWER_BOUND: 'lower bound',
  UPPER_BOUND: 'upper bound',
  ABILITY_ESTIMATE: 'ability estimate',
  STANDARD_ERROR: 'standard error',
  MINUTES_PROMISED: 'minutes promised',
  MINUTES_STUDIED: 'minutes studied',
  PERIOD_START: 'period start',
  PERIOD_END: 'period end',
  HOOKS_BUILT: 'hooks built',
  SUGGESTED_KANJI: 'suggested kanji',
  AVG_LAPSES_WITH_HOOK: 'average lapses with a hook',
  AVG_LAPSES_WITHOUT_HOOK: 'average lapses without one',
  MEANING_ACCURACY: 'meaning accuracy',
  READING_ACCURACY: 'reading accuracy',
  EXPECTED_READING_PENALTY: 'expected reading penalty',
  ITEMS_WITH_READING_ASKED: 'items with a reading asked',
  QUIZ_READING_ACCURACY: 'quiz reading accuracy',
  QUIZ_MEANING_ACCURACY: 'quiz meaning accuracy',
  QUIZ_READING_ANSWERS: 'quiz reading answers',
  PERCENT_FASTER: 'percent faster',
  AVG_SECONDS_BEFORE: 'average seconds before',
  AVG_SECONDS_NOW: 'average seconds now',
  KANJI_MEASURED: 'kanji measured',
  WINDOW_DAYS: 'window days',
  ABILITY_THEN: 'ability then',
  ABILITY_NOW: 'ability now',
  MEASURED_ON: 'measured on',
  PREVIOUSLY_MEASURED_ON: 'previously measured on',
  HARDEST_KANJI_CLEARED: 'hardest kanji cleared',
  ITEM_DIFFICULTY: 'item difficulty',
  STROKE_COUNT: 'stroke count',
  READING_COUNT: 'reading count',
  CURRENT_UNCERTAINTY: 'current uncertainty',
  UNCERTAINTY_WHEN_MEASURED: 'uncertainty when measured',
  DAYS_SINCE_THE_TEST: 'days since the test',
} as const

export interface Finding {
  kind: FindingKind
  /** 0..1, normalised per kind — see each detector's documented mapping. */
  magnitude: number
  /** 0..1, how much data backs it. 0 means "do not speak this". */
  confidence: number
  evidence: Evidence[]
  /** ISO date first raised; null when this is the first time. */
  since: string | null
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

export interface PlacementItemOutcome {
  kanjiId: number
  character: string
  meaningCorrect: boolean
  /** null when the reading half was not asked for this item. */
  readingCorrect: boolean | null
  /** Population reading penalty for this item — `reading_lag` must exceed it. */
  readingOffset: number
  difficultyAtAsk: number
  /** Strokes in the character. Part of what the difficulty model weighs, and
   *  what `hardest_cleared` cites to justify calling an item hard. */
  strokeCount: number
  /** Total on- plus kun-readings. Computed in ASSEMBLY, not here — the
   *  analyzer must not learn the shape of a jsonb column. */
  readingCount: number
}

export interface PlacementSnapshot {
  theta: number
  se: number
  /** ISO. */
  completedAt: string
  level: JlptLevel
  /** 80% credible interval, so `level_estimate` is never a bare label (§3). */
  thetaLow: number
  thetaHigh: number
  levelLow: JlptLevel
  levelHigh: JlptLevel
  /** The session before the latest. null when only one exists — `theta_delta`
   *  needs two (§3). */
  previous: { theta: number; se: number; completedAt: string } | null
  items: PlacementItemOutcome[]
}

export interface CardSnapshot {
  kanjiId: number
  character: string
  status: SrsStatus
  lapses: number
  readingStage: number | null
  /** remembered→learning transitions inside the window. */
  regressions: number
  /** Mean response ms over the older and newer halves of the window; null when
   *  that half holds no reviews. `fluency_gain` needs both. */
  responseMsEarly: number | null
  responseMsLate: number | null
  /** Accuracy (0..1) over the same two halves. Fluency only counts at flat
   *  accuracy — faster *and* wronger is not a gain. */
  accuracyEarly: number | null
  accuracyLate: number | null
  /** Recent grades, newest last, 0–5 scale. Used to pick the kanji
   *  `hook_coverage` offers to work on (§14.4). */
  recentQualities: number[]
  /** Whether this kanji has a co-created hook. */
  hasCoCreatedHook: boolean
}

/**
 * One row of `kl_test_results`.
 *
 * ⚠️ `question_type` is a plain TEXT column — **no enum**, nothing enforcing
 * the vocabulary. A design inventory circulating as of 2026-08-02 lists seven
 * types (`kunyomi_voice`, `onyomi_voice`, `onyomi_choice`, `write_from_meaning`,
 * `vocab_context`, `compound_reading`, `meaning_recall`). **Six of those have
 * zero rows on live.** Verified 2026-08-02, these five are what exists:
 *
 * | value | rows | side |
 * |---|---|---|
 * | `meaning_recall` | 1,069 | meaning |
 * | `kanji_from_meaning` | 404 | meaning |
 * | `reading_recall` | 403 | **reading** |
 * | `vocab_from_definition` | 168 | meaning |
 * | `vocab_reading` | 160 | **reading** |
 *
 * They match `TestService`'s `QuestionType` union exactly. A detector keyed on
 * the design list would match nothing and fail silently — the same shape of
 * defect as B-229. Session `test_type` is likewise only `exit_quiz` and
 * `loop_check`, not the five in that inventory.
 */
export interface QuizOutcome {
  kanjiId: number
  questionType: string
  correct: boolean
  /** ISO. */
  answeredAt: string
}

/** Quiz question types that test a READING. See the caveat on QuizOutcome. */
export const READING_QUESTION_TYPES: readonly string[] = ['reading_recall', 'vocab_reading']

/** Quiz question types that test a MEANING. `kanji_from_meaning` counts here:
 *  the prompt is the gloss and the answer is the character, so it is
 *  meaning-side recall regardless of which way round it is displayed. */
export const MEANING_QUESTION_TYPES: readonly string[] = [
  'meaning_recall', 'kanji_from_meaning', 'vocab_from_definition',
]

/**
 * The population meaning-vs-reading accuracy gap, **measured** across every
 * quiz row on live 2026-08-02: meaning 0.8848 (n=1,641) vs reading 0.8117
 * (n=563). Readings run about seven points behind for everybody, so only the
 * excess over this is a finding about a particular learner.
 *
 * This is the quiz-side counterpart to `kanji_difficulty.readingOffset`, which
 * placement items carry per-item. Unlike that one it is already a
 * **probability**, so it is directly comparable to an accuracy gap — no logit
 * conversion, and none of risk #2 below applies to this half.
 *
 * Pooled across all learners and n=563 on the reading side is modest. Recompute
 * it when the corpus of quiz answers grows.
 */
export const POPULATION_QUIZ_READING_GAP = 0.073

/**
 * The same thing for PLACEMENT items, and it points the other way.
 *
 * Measured across every placement item with a reading asked (live,
 * 2026-08-02): readings came out **0.033 BETTER** than meanings. Per session:
 * -0.182, 0.000, +0.100 over n = 11, 9, 10.
 *
 * The likely reason is instrument, not learner: placement readings are
 * four-option multiple choice with a 25% guess floor, while quiz
 * `reading_recall` is typed. Whatever the cause, it is the baseline a
 * placement gap must be measured against.
 *
 * ⚠️ **Do NOT use `kanji_difficulty.readingOffset` for this.** The plan
 * originally averaged it per item. It is (a) a single constant 0.4 for every
 * kanji — the per-item framing is fiction — and (b) in **logits**, while an
 * accuracy gap is a probability. Subtracting 0.4 from a gap that averages
 * -0.03 means the learner would need a >50-point accuracy gap before this
 * finding could fire. It was as dead as `leech`, for the same reason, and was
 * caught the same way.
 *
 * n = 30 items total. Thin. Recompute as placements accumulate.
 */
export const POPULATION_PLACEMENT_READING_GAP = -0.033

export interface ReviewSnapshot {
  cards: CardSnapshot[]
  quiz: QuizOutcome[]
  /** Length of the window `cards` was computed over. Owned by the assembly
   *  layer (REVIEW_WINDOW_DAYS); carried here so `fluency_gain`'s copy can
   *  state the period without inlining a constant it does not own. */
  windowDays: number
}

export interface CommitmentSnapshot {
  promisedMinutes: number
  actualMinutes: number
  /** ISO dates bounding the commitment period. */
  periodStart: string
  periodEnd: string
}

export interface HookSnapshot {
  /** Co-created hooks only — `generationMethod = 'cocreated'`. */
  count: number
  /** ISO date of the most recent co-created hook; null when none exist. */
  latestAt: string | null
  /** Buddy session dates, newest first. §14.4's trigger needs the second one. */
  sessionDates: string[]
  /** Mean lapses for cards with vs without a hook — the evidence hooks help.
   *  null when either group is empty. */
  lapsesWithHook: number | null
  lapsesWithoutHook: number | null
}

/** What the previous analysis said, read back from the superseded notebook
 *  entry. This is the memory that makes decay work (§4). */
export interface PriorFinding {
  kind: FindingKind
  /** ISO date the kind was FIRST raised. */
  since: string
  /** ISO date it was MOST RECENTLY raised. */
  lastRaisedAt: string
}

export interface LearnerSnapshot {
  /** ISO. The analyzer has no clock; time enters here. */
  now: string
  placement: PlacementSnapshot | null
  reviews: ReviewSnapshot
  commitment: CommitmentSnapshot | null
  hooks: HookSnapshot
  priorFindings: PriorFinding[]
}
