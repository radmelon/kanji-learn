//
// Template-tier copy (spec §7: the floor, not a degraded mode) and the two
// page-one entry bodies (spec §6). Voice matches templates/meet-buddy.ts.

import type { Beat } from './beats'
import type { Ruler } from './frame'

/** Sunday-first: index IS the buddy_day column value (JS Date.getDay()). */
export const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const

function rulerName(ruler: Ruler): string {
  return ruler === 'jlpt' ? 'JLPT levels' : 'school grades — the order Japanese kids learn them'
}

export function beatCopy(beat: Beat): string {
  switch (beat.kind) {
    case 'intro':
      return (
        "Hi — I'm Buddy. I'm the one who keeps track of how your kanji " +
        "learning is actually going, and I'll be straight with you about it."
      )
    case 'orientation':
      return (
        "Here's how this works: you study a little every day, and once a week " +
        'we sit down and look at how it went. We keep a shared notebook — what ' +
        "we decide, what we're trying, what's actually helping. I write in it, " +
        'and so do you.'
      )
    case 'why':
      return (
        'So — why Japanese? What brought you here, and what are you into? ' +
        'Pick what fits, or tell me in your own words.'
      )
    case 'frame_ask':
      return (
        'One thing I want to get right: are you aiming at something like the ' +
        'JLPT or work, or is this more for yourself — heritage, curiosity? ' +
        'It changes how I measure our progress.'
      )
    case 'meaning':
      return (
        `Got it. I'll measure us against ${rulerName(beat.ruler)}. ` +
        `For daily study, how does ${beat.proposedGoal} minutes a day sound? ` +
        'You can change it any time.'
      )
    case 'meet':
      return (
        'Last thing to settle: when do we meet? Once a week, on a day you ' +
        `pick. How about ${DAY_NAMES[beat.proposedDay]}s? Fortnightly works too.`
      )
    case 'ask':
      return (
        "That's everything I need for now. One ask before our first meeting: " +
        'take the placement test when you can. As soon as you complete it I ' +
        'can prepare a specific plan to reach your goals. We are in this together.'
      )
    case 'done':
      return "Go get started — I'll see you at our first meeting."
  }
}

export function appointmentEntryBody(day: number, intervalWeeks: number): string {
  const cadence = intervalWeeks === 2 ? 'every other week' : 'every week'
  return `We meet on ${DAY_NAMES[day]}s, ${cadence}. You picked the day.`
}

export function reasonsEntryBody(reasons: string[], ruler: Ruler): string {
  const measure = ruler === 'jlpt' ? 'JLPT level' : 'school grade'
  return `You're here for: ${reasons.join(', ')}. We measure progress by ${measure}.`
}

// F6 (whole-branch review, MED, spec §6): "Buddy's introduction, under What
// Buddy notices — authored buddy" is its own page-one bullet, distinct from
// ensureFirstOpen's decision about the notebook itself (Phase 6, unchanged).
// Reuses the intro beat's exact copy so the transcript and the notebook
// never disagree about what Buddy said.
export function introEntryBody(): string {
  return beatCopy({ kind: 'intro' })
}
