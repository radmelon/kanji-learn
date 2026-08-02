/**
 * Gloss selection for meaning items (B-229).
 *
 * `kanji.meanings` is stored **alphabetically** — 1,925 of 1,999 multi-gloss
 * kanji have `meanings[0]` equal to their alphabetically smallest gloss. ASCII
 * sort puts digits and capitalised proper nouns ahead of lowercase words, so
 * keying a question on `meanings[0]` asks 土 = "Turkey", 子 = "11PM-1AM",
 * 日 = "Japan". A learner who knows the character is scored **wrong**, and θ
 * moves down — the test measures "do you know our alphabetically-first gloss".
 *
 * Layer 1 of the fix does not reorder the stored data. It keys the item on a
 * short **gloss set** — "earth / ground / soil" — so anyone who knows any sense
 * can identify it. Layer 2 (a curated primary sense per kanji) is the next spec;
 * this module is the seam it will plug into.
 */

/** Joiner between glosses in a rendered set. Spaced so it wraps cleanly. */
export const GLOSS_SET_SEPARATOR = ' / '

/** Most glosses shown in one option. Beyond three the option stops being readable. */
export const GLOSS_SET_CAP = 3

/** Character budget for a rendered set, chosen to fit two lines on a phone. */
export const GLOSS_SET_MAX_LENGTH = 48

/**
 * A gloss leading with a digit or a capital is, in this corpus, overwhelmingly
 * a clock hour ("11PM-1AM"), a zodiac position, or a country name ("Turkey") —
 * an artifact of the source dictionary, not the sense a learner associates with
 * the character. Demoted, never dropped: for a kanji that genuinely only has
 * proper-noun glosses, one of these is still the right answer.
 */
function isArtifactGloss(gloss: string): boolean {
  return /^[0-9A-Z]/.test(gloss)
}

/**
 * Order a kanji's glosses best-first: real senses ahead of dictionary
 * artifacts, shorter ahead of longer, stored order as the final tiebreak.
 * Trims blanks and case-insensitive duplicates. Every surviving gloss is
 * returned — this ranks, it does not filter.
 */
export function rankGlosses(meanings: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(meanings)) return []

  const seen = new Set<string>()
  const cleaned: { gloss: string; index: number }[] = []
  for (const raw of meanings) {
    if (typeof raw !== 'string') continue
    const gloss = raw.trim()
    if (!gloss) continue
    const key = gloss.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    cleaned.push({ gloss, index: cleaned.length })
  }

  return cleaned
    .sort((a, b) => {
      const artifactDelta = Number(isArtifactGloss(a.gloss)) - Number(isArtifactGloss(b.gloss))
      if (artifactDelta !== 0) return artifactDelta
      if (a.gloss.length !== b.gloss.length) return a.gloss.length - b.gloss.length
      return a.index - b.index
    })
    .map((entry) => entry.gloss)
}

/**
 * The rendered answer for a meaning item: up to {@link GLOSS_SET_CAP} ranked
 * glosses joined by {@link GLOSS_SET_SEPARATOR}, within
 * {@link GLOSS_SET_MAX_LENGTH} characters.
 *
 * Trimming stops at the first gloss that would blow the budget rather than
 * skipping to a shorter one further down — ranking already put the short,
 * plain senses first, so anything past that point is a long zodiac phrase or a
 * demoted artifact, and appending it would be a downgrade, not a bonus.
 * At least one gloss is always returned, however long it is.
 */
export function glossKey(
  meanings: readonly string[] | null | undefined,
  options: { cap?: number; maxLength?: number } = {},
): string {
  const { cap = GLOSS_SET_CAP, maxLength = GLOSS_SET_MAX_LENGTH } = options
  const ranked = rankGlosses(meanings)
  if (ranked.length === 0) return ''

  const chosen = [ranked[0]!]
  for (const gloss of ranked.slice(1)) {
    if (chosen.length >= cap) break
    const candidate = [...chosen, gloss].join(GLOSS_SET_SEPARATOR)
    if (candidate.length > maxLength) break
    chosen.push(gloss)
  }
  return chosen.join(GLOSS_SET_SEPARATOR)
}

/**
 * True when two kanji share any sense. Used to reject a distractor whose own
 * glosses include one of the correct answer's: with sets rather than single
 * glosses, an unfiltered distractor can be *also* correct, which would trade
 * B-229's wrong key for an ambiguous item.
 */
export function glossesOverlap(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined,
): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  const normalised = new Set(
    a.filter((g): g is string => typeof g === 'string').map((g) => g.trim().toLowerCase()).filter(Boolean),
  )
  if (normalised.size === 0) return false
  return b.some((g) => typeof g === 'string' && normalised.has(g.trim().toLowerCase()))
}
