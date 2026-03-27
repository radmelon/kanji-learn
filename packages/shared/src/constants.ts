// ─── JLPT ─────────────────────────────────────────────────────────────────────

export const JLPT_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const

export const JLPT_KANJI_COUNTS = {
  N5: 80,
  N4: 166,
  N3: 367,
  N2: 367,
  N1: 1136,
} as const

export const TOTAL_JOUYOU_KANJI = 2136

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
