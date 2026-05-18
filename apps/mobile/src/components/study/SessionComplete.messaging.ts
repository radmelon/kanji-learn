/**
 * SessionComplete.messaging.ts
 *
 * Pure message-bucket function for the Session Complete screen. Extracted
 * from SessionComplete.tsx so it can be unit-tested without the full
 * React Native render path.
 *
 * Bands reflect an "ease-of-recall" framing: the weighted confidence
 * score (Easy=3, Good=2, Hard=1, Again=0, normalised by count × 3)
 * represents how effortful recall felt, not whether the card was
 * answered. All-Good sessions land at 67%, which is a healthy
 * consistent-recall outcome — the copy should reinforce that.
 */

export function motivationalMessage(accuracy: number, burned: number): string {
  if (burned > 0) return `🔥 ${burned} kanji burned — locked into long-term memory!`
  if (accuracy === 100) return 'Perfect — effortless recall.'
  if (accuracy >= 85) return 'Strong — most of these felt easy.'
  if (accuracy >= 60) return 'Solid — consistent recall.'
  if (accuracy >= 35) return 'Mixed — some cards still need work.'
  return 'Rough patch — come back tomorrow.'
}

/**
 * True when this session reached the learner's daily minutes goal. Used by
 * SessionComplete to decide whether to render the 🎉 celebration banner.
 *
 * @param studyTimeMs  duration of the session just completed, in milliseconds
 * @param goalMinutes  the learner's configured target from user_profiles.daily_goal
 */
export function didMeetTimeGoal(studyTimeMs: number, goalMinutes: number): boolean {
  return studyTimeMs >= goalMinutes * 60_000
}
