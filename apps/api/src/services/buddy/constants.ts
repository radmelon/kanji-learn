// apps/api/src/services/buddy/constants.ts
// All Buddy-layer magic numbers live here. Spec §3.1, §3.2, design doc §4.3.

export const SCAFFOLD_LEVELS = ['heavy', 'medium', 'light'] as const
export type ScaffoldLevel = (typeof SCAFFOLD_LEVELS)[number]

export const MASTERY_BY_STATUS = {
  unseen: 0,
  learning: 0.25,
  reviewing: 0.6,
  remembered: 0.85,
  burned: 1.0,
} as const

export type SrsStatus = keyof typeof MASTERY_BY_STATUS

/** A kanji becomes a leech candidate after this many lapses (spec §3.1). */
export const LEECH_LAPSE_THRESHOLD = 3

export interface LeechSignals {
  lapseCount: number
  status: SrsStatus
}

export function isLeech(signals: LeechSignals): boolean {
  if (signals.status === 'burned') return false
  return signals.lapseCount >= LEECH_LAPSE_THRESHOLD
}

export interface ScaffoldSignals {
  recentAccuracy: number // 0–1, rolling over last 20 reviews
  consecutiveFailures: number // streak of "again" answers in current session
  streakDays: number // consecutive days studied
}

/**
 * Pick a scaffold level from recent signals.
 * - heavy: user is struggling (lots of questions, step-by-step mnemonic review)
 * - medium: default for most users
 * - light: user is confident (minimal hand-holding)
 */
export function scaffoldForSignals(s: ScaffoldSignals): ScaffoldLevel {
  if (s.recentAccuracy < 0.6 || s.consecutiveFailures >= 3) return 'heavy'
  if (s.recentAccuracy >= 0.9 && s.streakDays >= 14 && s.consecutiveFailures === 0) {
    return 'light'
  }
  return 'medium'
}
