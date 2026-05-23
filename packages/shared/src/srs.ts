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
//
// DELIBERATE DIVERGENCES FROM CANONICAL FSRS-5
// --------------------------------------------
// The implementation below intentionally simplifies four points of canonical
// FSRS-5. All four were locked at spec/plan time and are pre-launch tunable.
// Cross-validation against ts-fsrs 4.7.1 matches first-review S/D to 8
// decimal places; subsequent reviews diverge by up to ~28% in S and ~20%
// in D compared with strict FSRS-5. See:
//   - docs/superpowers/specs/2026-05-22-fsrs-migration-design.md §3.2
//   - docs/superpowers/plans/2026-05-22-fsrs-migration.md "Task 2"
//
// 1. retrievability() uses the FSRS-4 exponential form R = exp(ln(0.9)·t/S)
//    instead of FSRS-5's power-law (1 + FACTOR·t/(9·S))^DECAY. Both equal 0.9
//    at t=S; they diverge elsewhere. Spec §3.2 explicitly defines the
//    exponential form.
//
// 2. No linear_damping factor (10 - oldD)/9 on dDelta. Canonical FSRS-5
//    softens difficulty updates on already-hard cards; we apply dDelta
//    uniformly. Practical effect: D saturates at the clamp boundaries
//    sooner under streaks.
//
// 3. Mean reversion targets initDifficulty(Good) ≈ 5.28, not
//    initDifficulty(Easy) ≈ 3.22 as canonical FSRS-5 does. Practical
//    effect: long-run D sits ~2 points higher.
//
// 4. The (11 - difficulty) term in sGrowth uses the POST-update difficulty,
//    not the PRE-update one as canonical FSRS-5 does. Small effect since
//    dDelta ≈ W[6] · (rating - 3) is bounded, but real.
//
// If a future fidelity sweep against canonical FSRS-5 becomes necessary
// (e.g. to compare against published community benchmarks), revisit these
// four points together — they're an internally consistent simplification.

const W = DEFAULT_FSRS_WEIGHTS
const DECAY = -0.5
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1   // ≈ 0.2346 — for target=0.9, the interval formula cancels to intervalDays = stability exactly

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
