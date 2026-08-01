import type { JlptLevel } from '@kanji-learn/shared'

export interface PlacementResultCopy {
  heroValue: string
  heroLabel: string
  subtitle: string
}

/**
 * What the results screen says after a placement test.
 *
 * B146: this screen led with `totalApplied` — the number of progress rows
 * written — labelled "kanji recognized", and told a learner "No kanji were
 * recognized. You'll start fresh from N5" in the same response that inferred
 * **N4** from a test they got 6.5 of 10 right.
 *
 * The seeded count is not a measure of knowledge. It is near-zero by design for
 * any returning learner, because seeding skips kanji they already have. The
 * ability estimate is the test's actual conclusion, so it leads.
 *
 * Seeds are also written as status 'reviewing', never 'remembered' — the old
 * copy claimed otherwise.
 */
export function placementResultCopy(input: {
  inferredLevel: JlptLevel | null
  seededCount: number
  isRetest: boolean
}): PlacementResultCopy {
  const { inferredLevel, seededCount, isRetest } = input

  const scheduled =
    seededCount > 0
      ? ` We've scheduled ${seededCount} kanji you already seem to know, so they'll come round as reviews rather than as new cards.`
      : ''

  if (inferredLevel === null) {
    return {
      heroValue: '—',
      heroLabel: 'estimated level',
      subtitle:
        "That wasn't quite enough to place you confidently, so we'll start from the beginning and adjust as you go." +
        scheduled,
    }
  }

  return {
    heroValue: inferredLevel,
    heroLabel: isRetest ? 'updated level' : 'estimated level',
    subtitle: `Your reviews are pitched around ${inferredLevel}, and they'll keep adjusting as you study.${scheduled}`,
  }
}
