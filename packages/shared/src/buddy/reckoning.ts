export interface DayActivity {
  date: string
  reviewed: number
  studyMinutes: number
}

export interface PromiseInput {
  daysCommitted: number
  minutesPerDay: number
  source: 'session' | 'rolled_forward' | 'default'
}

export type PromiseVerdict = 'kept' | 'partial' | 'missed' | 'not_promised'

export interface PromiseCheck {
  verdict: PromiseVerdict
  activeDays: number
  committedDays: number
  daysOnTargetMinutes: number
  wasPromised: boolean
}

export type OpenerKind = 'strong' | 'steady' | 'off' | 'absent' | 'first_ever'

export function checkPromise(promise: PromiseInput, days: DayActivity[]): PromiseCheck {
  const activeDays = days.filter((day) => day.reviewed > 0).length
  const daysOnTargetMinutes = days.filter(
    (day) => day.reviewed > 0 && day.studyMinutes >= promise.minutesPerDay,
  ).length
  const wasPromised = promise.source === 'session'

  if (!wasPromised) {
    // Rolled-forward and default commitments were not actively agreed this week,
    // so the learner should not be scored as breaking words they never said.
    return {
      verdict: 'not_promised',
      activeDays,
      committedDays: promise.daysCommitted,
      daysOnTargetMinutes,
      wasPromised,
    }
  }

  let verdict: PromiseVerdict
  if (activeDays >= promise.daysCommitted) {
    verdict = 'kept'
  } else if (activeDays >= Math.ceil(promise.daysCommitted / 2)) {
    // The threshold rounds up so an odd commitment requires being truly close
    // before the week is framed as partial.
    verdict = 'partial'
  } else {
    verdict = 'missed'
  }

  return {
    verdict,
    activeDays,
    committedDays: promise.daysCommitted,
    daysOnTargetMinutes,
    wasPromised,
  }
}

export function selectOpener(input: { check: PromiseCheck; isFirstSession: boolean }): OpenerKind {
  if (input.isFirstSession) return 'first_ever'
  if (input.check.activeDays === 0) return 'absent'
  if (input.check.activeDays === 1) return 'off'
  if (input.check.verdict === 'kept') return 'strong'
  return 'steady'
}
