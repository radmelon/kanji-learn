import {
  STATUS_LEARNING_MAX_DAYS,
  STATUS_REVIEWING_MAX_DAYS,
  STATUS_REMEMBERED_MAX_DAYS,
  DEFAULT_FSRS_WEIGHTS,
  TARGET_RETENTION,
} from './constants'
import type { SrsStatus } from './types'

// ─── Types ─────────────────────────────────────────────────────────────────

export type FsrsRating = 1 | 2 | 3 | 4  // Again | Hard | Good | Easy

export interface FsrsCard {
  /** Days. 0 = unseen sentinel. */
  stability: number
  /** 1..10. FSRS-5 midpoint is 5. */
  difficulty: number
  /** Number of `Again` events the card has received. */
  lapses: number
  status: SrsStatus
  lastReviewedAt: Date | null
}

export interface FsrsResult extends FsrsCard {
  nextReviewAt: Date
}

// ─── Boundary helpers ─────────────────────────────────────────────────────

/**
 * Map the app's 0–5 SM-2 quality scale to FSRS's 4-bucket rating.
 *   0,1,2 → 1 (Again)
 *   3     → 2 (Hard)
 *   4     → 3 (Good)
 *   5     → 4 (Easy)
 */
export function ratingFromQuality(quality: 0 | 1 | 2 | 3 | 4 | 5): FsrsRating {
  if (quality <= 2) return 1
  if (quality === 3) return 2
  if (quality === 4) return 3
  return 4
}

/**
 * Derive the user-visible `status` label from stability (in days).
 * Thresholds ported from the prior SM-2 interval cuts.
 */
export function statusFromStability(stability: number): SrsStatus {
  if (stability < STATUS_LEARNING_MAX_DAYS) return 'learning'
  if (stability < STATUS_REVIEWING_MAX_DAYS) return 'reviewing'
  if (stability < STATUS_REMEMBERED_MAX_DAYS) return 'remembered'
  return 'burned'
}

/**
 * Predicted recall probability at `atTime` for a card last reviewed at
 * `card.lastReviewedAt` with stability `card.stability`.
 *
 * Returns 0 for unseen cards (no stability or no last-review timestamp).
 * The Spec 2 bridge — pure function, no DB, no service.
 */
export function retrievability(card: FsrsCard, atTime: Date): number {
  if (card.stability <= 0 || card.lastReviewedAt == null) return 0
  const elapsedDays =
    (atTime.getTime() - card.lastReviewedAt.getTime()) / 86_400_000
  if (elapsedDays <= 0) return 1
  // The literal 0.9 here is the definition of stability ("interval at which
  // R = 0.9"), not the TARGET_RETENTION config knob. They happen to coincide
  // numerically but represent different ideas — keep this as a literal.
  return Math.exp(Math.log(0.9) * elapsedDays / card.stability)
}

// ─── FSRS-5 algorithm ──────────────────────────────────────────────────────
//
// Reference: open-spaced-repetition/ts-fsrs BasicScheduler. The formulas
// below mirror that implementation. Weight vector indices match the FSRS-5
// paper (w[0..3] = initial stability per rating, w[4..5] = initial
// difficulty, w[6..7] = difficulty update, w[8..10] = success stability,
// w[11..14] = lapse stability, w[15..16] = hard/easy modifiers,
// w[17..18] = same-day short-term scheduler — unused here, see note below).

const W = DEFAULT_FSRS_WEIGHTS
const DECAY = -0.5
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1   // ≈ -0.9... used in interval calc

export function createNewCard(): FsrsCard {
  return {
    stability: 0,
    difficulty: 5,
    lapses: 0,
    status: 'learning',
    lastReviewedAt: null,
  }
}

/**
 * Apply one review to a card and return the updated state plus the next
 * scheduled review timestamp.
 *
 * - On `rating === 1` (Again), `lapses` is incremented internally — callers
 *   must NOT increment it themselves.
 * - `lastReviewedAt` is set to `now`.
 * - `nextReviewAt` is computed for target retention 0.9 (decay-adjusted).
 * - `status` is derived from the post-review stability.
 *
 * Same-day re-reviews (the FSRS-5 short-term scheduler using w[17..18]) are
 * not modelled — our submitReview path never issues two grades for the same
 * card in the same session. If that ever changes, port the short-term branch.
 */
export function calculateNextReview(
  card: FsrsCard,
  rating: FsrsRating,
  now: Date,
): FsrsResult {
  let stability: number
  let difficulty: number
  let lapses = card.lapses

  // ── First review: card.stability === 0 means unseen ──────────────────────
  if (card.stability <= 0 || card.lastReviewedAt == null) {
    stability = Math.max(W[rating - 1], 0.1)
    difficulty = clamp(W[4] - Math.exp(W[5] * (rating - 1)) + 1, 1, 10)
    if (rating === 1) lapses += 1
  } else {
    // ── Subsequent review ───────────────────────────────────────────────────
    const elapsedDays = Math.max(
      0,
      (now.getTime() - card.lastReviewedAt.getTime()) / 86_400_000,
    )
    const R = Math.exp(Math.log(0.9) * elapsedDays / card.stability)

    // Difficulty update: linear delta + mean reversion toward initial Good D
    const dDelta = -W[6] * (rating - 3)
    const dRaw = card.difficulty + dDelta
    const initDifficultyGood = W[4] - Math.exp(W[5] * (3 - 1)) + 1
    difficulty = clamp(W[7] * initDifficultyGood + (1 - W[7]) * dRaw, 1, 10)

    if (rating === 1) {
      // Lapse: stability shrinks per the failure formula, capped at current S.
      const sLapse =
        W[11] *
        Math.pow(card.difficulty, -W[12]) *
        (Math.pow(card.stability + 1, W[13]) - 1) *
        Math.exp((1 - R) * W[14])
      stability = Math.max(0.1, Math.min(sLapse, card.stability))
      lapses += 1
    } else {
      // Success: stability grows per the success formula with hard/easy
      // modifiers.
      const hardPenalty = rating === 2 ? W[15] : 1
      const easyBonus = rating === 4 ? W[16] : 1
      const sGrowth =
        1 +
        Math.exp(W[8]) *
          (11 - difficulty) *
          Math.pow(card.stability, -W[9]) *
          (Math.exp((1 - R) * W[10]) - 1) *
          hardPenalty *
          easyBonus
      stability = card.stability * sGrowth
    }
  }

  // Interval = S · ((R_target ^ (1/decay)) − 1) / factor
  // For target = 0.9, this simplifies to stability days exactly.
  const intervalDays = (stability * (Math.pow(TARGET_RETENTION, 1 / DECAY) - 1)) / FACTOR
  const nextReviewAt = new Date(now.getTime() + Math.max(1, intervalDays) * 86_400_000)

  return {
    stability,
    difficulty,
    lapses,
    status: statusFromStability(stability),
    lastReviewedAt: now,
    nextReviewAt,
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi)
}
