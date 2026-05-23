import {
  STATUS_LEARNING_MAX_DAYS,
  STATUS_REVIEWING_MAX_DAYS,
  STATUS_REMEMBERED_MAX_DAYS,
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
  return Math.exp(Math.log(0.9) * elapsedDays / card.stability)
}
