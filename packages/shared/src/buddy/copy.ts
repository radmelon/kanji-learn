import type { Cadence } from './appointment'
import type { OpenerKind, PromiseCheck } from './reckoning'

export function openerCopy(kind: OpenerKind, check: PromiseCheck): string {
  switch (kind) {
    case 'strong':
      return `${check.activeDays} days this week. That's the rhythm that makes it stick.`
    case 'steady':
      return `Good to see you. Let's have a look at the week.`
    case 'off':
      // A poor week opens with care, not data — and the figures are left out
      // entirely rather than softened, because a number here reads as a verdict
      // however gently it is phrased.
      return `Hey. Quiet week on here — has work been busy?`
    case 'absent':
      // Lowest-demand welcome in the set. Nothing to explain, nothing to
      // defend, and no hint that an explanation is expected.
      return `Good to see you. Nothing to catch up on — how have you been?`
    case 'first_ever':
      // The feature's ONLY disclosure that Buddy accumulates what it learns
      // about the learner. Said plainly, once, here or nowhere.
      return `I'm Buddy. I'll check in once a week to see how studying's going, and I'll get to know you as we go so this fits round your life. Shall we set your first week?`
  }
}

export function reckonCopy(check: PromiseCheck): string | null {
  if (!check.wasPromised) {
    // Rolled-forward/default commitments were never agreed, so reporting them
    // as promises would invent a broken word rather than soften one.
    return null
  }

  switch (check.verdict) {
    case 'kept':
      return `We said ${check.committedDays} days, and you got ${check.activeDays}.`
    case 'partial':
      return `We said ${check.committedDays} days and you got ${check.activeDays} — a good chunk of it.`
    case 'missed':
      // A question, not a verdict. The learner supplies the reason; Buddy does
      // not guess at one, and does not imply there ought not to be one.
      return `We said ${check.committedDays} days; it came out at ${check.activeDays}. What got in the way?`
    case 'not_promised':
      return null
  }
}

export function stepDownCopy(next: Cadence): string {
  if (next.buddyDay !== null) {
    return `I'll come by every other week from now on, same day — I don't want to be in your way.`
  }

  // The way back matters as much as the step down: this whole mechanism exists
  // so a learner who has had enough gets relief from the app rather than by
  // silently muting notifications. An exit with no return path is just churn.
  return `I'll stop the weekly check-ins. Give me a shout whenever you want to pick them back up.`
}
