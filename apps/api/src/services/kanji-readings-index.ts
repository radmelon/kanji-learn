/**
 * kanji-readings-index.ts
 *
 * In-memory index mapping each kanji character to its accepted readings,
 * plus helpers for the homophone-workaround path in reading-eval.service.ts.
 *
 * The iOS ja-JP speech recognizer often returns a kanji transcript instead of
 * phonetic hiragana. Wanakana cannot normalise kanji to readings, so the
 * evaluator expands CJK characters through this index before comparison.
 */

// CJK Unified Ideographs block (covers all Jōyō kanji and the entire corpus
// our app ships). We intentionally do NOT include the compatibility block
// (U+F900-U+FAFF) because those glyphs round-trip to the main block.
// No `g` flag — .test() is the only consumer; keeping lastIndex fixed avoids
// the global-regex alternating-result footgun if this ever gains a g flag.
const CJK_RE = /[\u4E00-\u9FFF]/

export function containsCJK(s: string): boolean {
  return CJK_RE.test(s)
}

export type KanjiReadingsIndex = Map<string, Set<string>>

/**
 * Hard cap on cartesian-product output. A well-formed vocab word of 2-3
 * kanji rarely exceeds ~50 candidates; the cap protects against pathological
 * input (e.g. a 5-kanji compound where every char has 6+ readings).
 */
const MAX_CANDIDATES = 200

/**
 * Expand CJK characters in `input` to their accepted readings from `index`,
 * returning the cartesian product of all possible phonetic strings.
 *
 * If `input` has no CJK chars, returns `[input]` unchanged.
 * If a CJK char is not in the index, it is passed through literally.
 * Output is capped at MAX_CANDIDATES (truncated; order is stable).
 */
export function expandReadings(input: string, index: KanjiReadingsIndex): string[] {
  if (!containsCJK(input)) return [input]

  let candidates: string[] = ['']
  for (const ch of input) {
    const readings = index.get(ch)
    const options = readings && readings.size > 0 ? [...readings] : [ch]

    const next: string[] = []
    for (const prefix of candidates) {
      for (const opt of options) {
        next.push(prefix + opt)
        if (next.length >= MAX_CANDIDATES) {
          return next.slice(0, MAX_CANDIDATES)
        }
      }
    }
    candidates = next
  }

  return candidates.slice(0, MAX_CANDIDATES)
}
