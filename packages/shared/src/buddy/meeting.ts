// Spec §4: onboarding cannot end without reasons, interests, focus (the
// resolved Frame), dailyGoal, buddyDay, buddyIntervalWeeks, timezone.
// timezone is captured by the deviceTimezone() sync and never asked, so it is
// not a Requirement here. buddyIntervalWeeks is settled inside the meet beat
// (defaults 1) rather than being independently required.

import { resolveFrame, type Ruler } from './frame'

export interface CollectedState {
  reasons: string[]
  interests: string[]
  /** In-session only. Persistence is via the reasons vocabulary (see beats.ts
   *  frame_ask): spec §8 permits no new columns beyond met_buddy_at. */
  explicitRuler: Ruler | null
  dailyGoal: number | null
  buddyDay: number | null
  buddyIntervalWeeks: number | null
  timezone: string | null
  /** profile.onboardingCompletedAt was set when the meeting began — the
   *  discriminator between "defaulted" and "previously answered" values. */
  hadPriorData: boolean
}

export type Requirement = 'reasons' | 'interests' | 'frame' | 'daily_goal' | 'buddy_day'

export function nextRequirement(s: CollectedState): Requirement | null {
  if (s.reasons.length === 0) return 'reasons'
  if (s.interests.length === 0) return 'interests'
  if (resolveFrame({ explicitRuler: s.explicitRuler, reasons: s.reasons }).kind === 'ask') {
    return 'frame'
  }
  if (s.dailyGoal === null) return 'daily_goal'
  if (s.buddyDay === null) return 'buddy_day'
  return null
}

export interface ExtractedPatch {
  reasons?: string[]
  interests?: string[]
  explicitRuler?: Ruler
  dailyGoal?: number
  buddyDay?: number
  buddyIntervalWeeks?: number
}

const ARRAY_CAP = 12

function union(existing: string[], incoming: string[] | undefined): string[] {
  const out = [...existing]
  for (const item of incoming ?? []) {
    const needle = item.toLowerCase().trim()
    if (needle.length === 0) continue
    if (!out.some((e) => e.toLowerCase().trim() === needle)) out.push(item)
  }
  return out.slice(0, ARRAY_CAP)
}

export function mergeExtracted(s: CollectedState, p: ExtractedPatch): CollectedState {
  return {
    ...s,
    reasons: union(s.reasons, p.reasons),
    interests: union(s.interests, p.interests),
    explicitRuler: p.explicitRuler ?? s.explicitRuler,
    dailyGoal: p.dailyGoal ?? s.dailyGoal,
    buddyDay: p.buddyDay ?? s.buddyDay,
    buddyIntervalWeeks: p.buddyIntervalWeeks ?? s.buddyIntervalWeeks,
  }
}
