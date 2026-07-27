/**
 * The "Not now" cooldown (parent spec §11).
 *
 * Declining a Buddy moment is per-kanji, not global: a learner who does not
 * want to build a hook for 持 right now has said nothing about 待. Plan 3b
 * closed the sheet and forgot; this is what makes the decline stick.
 */

export const SNOOZE_DAYS = 7

/**
 * Which of these kanji are still inside their cooldown.
 *
 * Total by design — this runs while deciding whether to offer a Buddy moment,
 * so an unparseable stamp degrades to "not snoozed" rather than throwing. The
 * failure mode that matters is the silent one: a bad row must not suppress the
 * feature indefinitely with no way for the learner to tell why.
 */
export function snoozedKanjiIds(
  cards: Array<{ kanjiId: number; buddyMomentSnoozedUntil: string | null }>,
  now: Date,
): number[] {
  return cards
    .filter((c) => {
      if (c.buddyMomentSnoozedUntil == null) return false
      const until = new Date(c.buddyMomentSnoozedUntil).getTime()
      if (Number.isNaN(until)) return false
      // Strictly greater: at the exact expiry instant the cooldown is over.
      return until > now.getTime()
    })
    .map((c) => c.kanjiId)
}

/** When a decline taken at `now` stops suppressing that kanji. */
export function snoozeUntil(now: Date): Date {
  return new Date(now.getTime() + SNOOZE_DAYS * 24 * 60 * 60 * 1000)
}
