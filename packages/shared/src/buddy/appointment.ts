// The appointment — spec §3 and §8.1 of
// docs/superpowers/specs/2026-07-30-weekly-buddy-review-design.md.
//
// The appointment is a THIRD mode alongside push and pull: the learner agreed
// to it in advance, on a day they chose, so Buddy may bring things without
// those things being unbidden.
//
// Every function here is pure and takes the learner's LOCAL date as a
// YYYY-MM-DD string. Timezone conversion happens at the edge — never in here.

/** Consecutive missed appointments before cadence drops (spec §8.1). */
export const STEP_DOWN_AFTER_MISSES = 3

const MS_PER_DAY = 86_400_000

export interface Cadence {
  buddyDay: number | null
  intervalWeeks: number
}

export interface AppointmentInput extends Cadence {
  localDate: string
  /**
   * The ANCHOR date of the last completed session — i.e. its `weekStart` —
   * NOT the wall-clock date the learner happened to hold it.
   *
   * Load-bearing: `nextDueAfter` counts a whole period forward from this value
   * and then advances to the next buddyDay. Pass the real date of a session
   * held three days into its window and the learner is pushed an extra week.
   * Callers should pass `buddy_commitments.week_start`.
   */
  lastSessionDate: string | null
}

export type AppointmentState =
  | { kind: 'not_scheduled' }
  | { kind: 'due'; weekStart: string }
  | { kind: 'waiting'; nextDue: string }

export function weekdayOf(iso: string): number {
  return dateFromIso(iso).getUTCDay()
}

export function addDays(iso: string, n: number): string {
  return isoFromTime(dateFromIso(iso).getTime() + n * MS_PER_DAY)
}

export function evaluateAppointment(input: AppointmentInput): AppointmentState {
  const { buddyDay, intervalWeeks, localDate, lastSessionDate } = input

  if (buddyDay === null) return { kind: 'not_scheduled' }

  const periodDays = 7 * intervalWeeks
  const daysSinceBuddyDay = (weekdayOf(localDate) - buddyDay + 7) % 7
  const anchor = addDays(localDate, -daysSinceBuddyDay)
  const lastSessionBeforeAnchor = lastSessionDate === null || lastSessionDate < anchor
  const anchorIsNewPeriod =
    lastSessionDate === null || daysBetween(lastSessionDate, anchor) >= periodDays
  const withinWindow = daysBetween(anchor, localDate) <= Math.floor(periodDays / 2)

  if (anchorIsNewPeriod && lastSessionBeforeAnchor && withinWindow) {
    return { kind: 'due', weekStart: anchor }
  }

  // When a session exists, the next period is anchored to that completed
  // session. Reusing this week's anchor would skip an extra period on
  // fortnightly cadences after an on-time session.
  return {
    kind: 'waiting',
    nextDue: nextDueAfter(lastSessionDate ?? anchor, periodDays, buddyDay),
  }
}

export function shouldStepDown(consecutiveMisses: number): boolean {
  return consecutiveMisses >= STEP_DOWN_AFTER_MISSES
}

export function nextCadence(current: Cadence): Cadence {
  if (current.buddyDay === null) return current
  if (current.intervalWeeks === 1) return { ...current, intervalWeeks: 2 }
  return { ...current, buddyDay: null }
}

export function defaultBuddyDay(restDay: number | null): number | null {
  if (restDay === null) return null
  return (restDay + 1) % 7
}

function nextDueAfter(base: string, periodDays: number, buddyDay: number): string {
  let candidate = addDays(base, periodDays)

  while (weekdayOf(candidate) !== buddyDay) {
    candidate = addDays(candidate, 1)
  }

  return candidate
}

function daysBetween(start: string, end: string): number {
  return (dateFromIso(end).getTime() - dateFromIso(start).getTime()) / MS_PER_DAY
}

function dateFromIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

function isoFromTime(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}
