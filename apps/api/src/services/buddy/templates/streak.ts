// apps/api/src/services/buddy/templates/streak.ts
//
// Streak milestone → content string map. Phase 1' is template-only;
// voice/persona lands in Phase 5 alongside the mnemonic co-creation
// work. Editing these strings only requires an API deploy (no mobile
// rebuild). When we have ≥3 nudge types or non-engineers want to
// iterate on copy, this map moves to a `nudge_templates` DB table
// (Phase 1' design spec §7.1).

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 90, 100, 180, 365] as const
export type StreakMilestone = (typeof STREAK_MILESTONES)[number]

const CONTENT: Record<StreakMilestone, string> = {
  3: "Day 3. You're getting into a rhythm.",
  7: 'A full week. Buddy noticed.',
  14: 'Two weeks. The hardest part of habit-building is behind you.',
  30: '30-day streak. This is what consistency looks like.',
  60: '60 days. Whatever you’re doing, keep doing it.',
  90: "90 days. That's a season.",
  100: '100 days. Quietly remarkable.',
  180: 'Half a year. Most people quit before now.',
  365: "A year of kanji. Buddy's proud.",
}

export function streakContent(milestone: StreakMilestone): string {
  return CONTENT[milestone]
}

export function isStreakMilestone(day: number): day is StreakMilestone {
  return (STREAK_MILESTONES as readonly number[]).includes(day)
}
