// ─── JLPT ─────────────────────────────────────────────────────────────────────

export const JLPT_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const

export const JLPT_KANJI_COUNTS = {
  N5: 79,
  N4: 166,
  N3: 370,
  N2: 371,
  N1: 1308,
} as const

export const TOTAL_JOUYOU_KANJI = 2136 // 2010 Jōyō list — does not include Jinmeiyō

// ─── SRS ──────────────────────────────────────────────────────────────────────

export const SRS_STATUS_ORDER = ['unseen', 'learning', 'reviewing', 'remembered', 'burned'] as const

export const SRS_INITIAL_EASE_FACTOR = 2.5
export const SRS_MIN_EASE_FACTOR = 1.3
export const SRS_MAX_EASE_FACTOR = 3.5

// ─── Intervention Thresholds ──────────────────────────────────────────────────

export const ABSENCE_THRESHOLD_HOURS = 48
export const VELOCITY_DROP_THRESHOLD = 0.5 // 50% drop triggers intervention
export const PLATEAU_DAYS_THRESHOLD = 7

// ─── Test Schedule ────────────────────────────────────────────────────────────

export const SURPRISE_BURNED_CHECK_RATE = 0.12 // 10–15%, use 12%

// ─── Mnemonic Refresh ─────────────────────────────────────────────────────────

export const MNEMONIC_REFRESH_DAYS = 30

// ─── Reading Stages ───────────────────────────────────────────────────────────

export const READING_STAGE_LABELS = [
  'Meaning only',
  "Kun'yomi",
  "On'yomi via vocab",
  'All readings',
  'Compound tests',
] as const

// ─── FSRS-5 ─────────────────────────────────────────────────────────────────

/** Published FSRS-5 default weights (19 elements). Sourced from the FSRS-5
 *  reference implementation at open-spaced-repetition/ts-fsrs; verify the
 *  vector matches that repo's `default_w` at implementation time. */
export const DEFAULT_FSRS_WEIGHTS: readonly number[] = [
  0.40255, 1.18385, 3.173, 15.69105,
  7.1949, 0.5345,
  1.4604,
  0.0046,
  1.54575, 0.1192, 1.01925,
  1.9395, 0.11, 0.29605, 2.2698,
  0.2315, 2.9898,
  0.51655, 0.6621,
]

/** FSRS scheduling target — R at planned nextReviewAt. */
export const TARGET_RETENTION = 0.9

/** Threshold below which a Good/Easy self-grade is suspect and the quiz fires.
 *  Modulated by difficulty in srs.service.ts: threshold = base + coef·(D − 5). */
export const MAYBE_SLIPPING_BASE = 0.85
export const MAYBE_SLIPPING_D_COEFFICIENT = 0.01

/** Status thresholds in days of stability (ported from the SM-2 interval cuts). */
export const STATUS_LEARNING_MAX_DAYS = 7
export const STATUS_REVIEWING_MAX_DAYS = 21
export const STATUS_REMEMBERED_MAX_DAYS = 180
