// Spec §3: beats, not steps. selectBeat is stateless over (collected, seen) —
// a learner who answers several beats at once skips them by construction,
// which is what "must not re-ask what he already has" means mechanically.

import { defaultBuddyDay } from './appointment'
import { resolveFrame, type Ruler } from './frame'
import { nextRequirement, type CollectedState } from './meeting'

export type BeatKind =
  | 'intro' | 'orientation' | 'why' | 'frame_ask'
  | 'meaning' | 'meet' | 'ask' | 'done'

export type Beat =
  | { kind: 'intro' }
  | { kind: 'orientation' }
  | { kind: 'why' }
  | { kind: 'frame_ask' }
  | { kind: 'meaning'; ruler: Ruler; proposedGoal: number }
  | { kind: 'meet'; proposedDay: number }
  | { kind: 'ask' }
  | { kind: 'done' }

/** Exam- and work-driven learners get a slightly firmer default. Values are
 *  from the onboarding daily-target options [5, 10, 15, 20, 30]. */
export function proposeDailyGoal(reasons: string[]): number {
  const frame = resolveFrame({ reasons })
  return frame.kind !== 'ask' && frame.ruler === 'jlpt' ? 20 : 15
}

export function selectBeat(
  s: CollectedState,
  seen: readonly BeatKind[],
  restDay: number | null,
): Beat {
  if (!seen.includes('intro')) return { kind: 'intro' }
  if (!seen.includes('orientation')) return { kind: 'orientation' }

  const req = nextRequirement(s)
  if (req === 'reasons' || req === 'interests') return { kind: 'why' }
  if (req === 'frame') return { kind: 'frame_ask' }
  if (req === 'daily_goal') {
    const frame = resolveFrame({ explicitRuler: s.explicitRuler, reasons: s.reasons })
    // 'ask' is unreachable here (the frame requirement sorts first); collapse
    // defensively the same way milestoneFocusFromReasons does.
    const ruler: Ruler = frame.kind === 'ask' ? 'jlpt' : frame.ruler
    return { kind: 'meaning', ruler, proposedGoal: proposeDailyGoal(s.reasons) }
  }
  if (req === 'buddy_day') return { kind: 'meet', proposedDay: defaultBuddyDay(restDay) ?? 0 }

  if (!seen.includes('ask')) return { kind: 'ask' }
  return { kind: 'done' }
}
