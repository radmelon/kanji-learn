import { SRS_INITIAL_EASE_FACTOR, SRS_MIN_EASE_FACTOR, SRS_MAX_EASE_FACTOR } from './constants'
import type { SrsStatus } from './types'

export interface SrsCard {
  easeFactor: number
  interval: number
  repetitions: number
  status: SrsStatus
}

export interface SrsResult {
  easeFactor: number
  interval: number
  repetitions: number
  status: SrsStatus
  nextReviewAt: Date
}

/**
 * SM-2 algorithm implementation.
 * quality: 0–5 (0–2 = fail, 3–5 = pass)
 */
export function calculateNextReview(card: SrsCard, quality: 0 | 1 | 2 | 3 | 4 | 5): SrsResult {
  const now = new Date()
  let { easeFactor, interval, repetitions } = card

  if (quality < 3) {
    // Failed — reset to start of learning phase
    repetitions = 0
    interval = 1
  } else {
    // Passed
    if (repetitions === 0) {
      interval = 1
    } else if (repetitions === 1) {
      interval = 6
    } else {
      interval = Math.round(interval * easeFactor)
    }
    repetitions += 1

    // Update ease factor
    const delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
    easeFactor = Math.max(SRS_MIN_EASE_FACTOR, Math.min(SRS_MAX_EASE_FACTOR, easeFactor + delta))
  }

  const nextReviewAt = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000)
  const status = deriveStatus(repetitions, interval)

  return { easeFactor, interval, repetitions, status, nextReviewAt }
}

export function createNewCard(): SrsCard {
  return {
    easeFactor: SRS_INITIAL_EASE_FACTOR,
    interval: 0,
    repetitions: 0,
    status: 'unseen',
  }
}

function deriveStatus(repetitions: number, interval: number): SrsStatus {
  if (repetitions === 0) return 'learning'
  if (interval < 7) return 'learning'
  if (interval < 21) return 'reviewing'
  if (interval < 180) return 'remembered'
  return 'burned'
}
