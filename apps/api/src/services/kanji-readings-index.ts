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
