/**
 * mora-alignment.ts
 *
 * Splits a kana reading into mora-level groups so each group aligns 1:1
 * with a pitch-accent pattern entry. Japanese pitch accent is marked
 * per-mora, not per-character: きゃく is 2 moras (きゃ + く), not 3.
 *
 * Rules:
 * - A small ゃゅょ (and katakana ャュョ) fuses with the preceding kana.
 * - Sokuon (っ / ッ) is its own mora.
 * - Hatsuon (ん / ン) is its own mora.
 * - Long-vowel marker ー is its own mora.
 * - Non-kana characters pass through as their own mora (degraded graceful
 *   rendering — the caller typically checks reading length vs pattern
 *   length and falls back to plain text on mismatch).
 */

const SMALL_Y_KANA = new Set(['ゃ', 'ゅ', 'ょ', 'ャ', 'ュ', 'ョ'])

export function alignMoraToKana(reading: string): string[] {
  if (reading.length === 0) return []

  const moras: string[] = []
  for (const ch of reading) {
    if (SMALL_Y_KANA.has(ch) && moras.length > 0) {
      moras[moras.length - 1] += ch
    } else {
      moras.push(ch)
    }
  }
  return moras
}
