export type CommitmentSource = 'session' | 'rolled_forward' | 'default'

export interface Commitment {
  weekStart: string
  daysCommitted: number
  dayTargets: number[] | null
  minutesPerDay: number
  focus: string | null
  source: CommitmentSource
}

export const DEFAULT_COMMITMENT: Pick<Commitment, 'daysCommitted' | 'minutesPerDay'> = {
  daysCommitted: 4,
  minutesPerDay: 15,
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: 'days_out_of_range' | 'minutes_out_of_range' | 'day_targets_mismatch' }

export function validateCommitment(input: {
  daysCommitted: number
  minutesPerDay: number
  dayTargets?: number[] | null
}): ValidationResult {
  if (!Number.isInteger(input.daysCommitted) || input.daysCommitted < 1 || input.daysCommitted > 7) {
    return { ok: false, reason: 'days_out_of_range' }
  }

  if (!Number.isInteger(input.minutesPerDay) || input.minutesPerDay < 1) {
    return { ok: false, reason: 'minutes_out_of_range' }
  }

  if (input.dayTargets != null && input.dayTargets.length !== input.daysCommitted) {
    return { ok: false, reason: 'day_targets_mismatch' }
  }

  return { ok: true }
}

export function rollForward(previous: Commitment | null, weekStart: string): Commitment {
  if (previous == null) {
    return {
      weekStart,
      daysCommitted: DEFAULT_COMMITMENT.daysCommitted,
      dayTargets: null,
      minutesPerDay: DEFAULT_COMMITMENT.minutesPerDay,
      focus: null,
      source: 'default',
    }
  }

  return {
    weekStart,
    daysCommitted: previous.daysCommitted,
    dayTargets: previous.dayTargets == null ? null : [...previous.dayTargets],
    minutesPerDay: previous.minutesPerDay,
    // Focus is qualitative; keeping it would imply the learner re-agreed to a theme they missed.
    focus: null,
    source: 'rolled_forward',
  }
}

export function countConsecutiveRolledForward(rows: Array<{
  weekStart: string
  source: CommitmentSource
}>): number {
  const sortedRows = [...rows].sort((a, b) => b.weekStart.localeCompare(a.weekStart))
  let count = 0

  for (const row of sortedRows) {
    if (row.source !== 'rolled_forward') {
      // A default seed is not a missed appointment; only carried commitments count.
      break
    }
    count += 1
  }

  return count
}
