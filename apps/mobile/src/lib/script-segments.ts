export type ScriptSegment = { text: string; lang: 'ja' | 'en' }

/** Hiragana, katakana, CJK ideographs (incl. extension A and compatibility),
 *  plus the iteration marks and the katakana prolonged-sound mark. */
const JA_CHAR =
  /[぀-ゟ゠-ヿ々〆ー㐀-䶿一-鿿豈-﫿]/

function classify(ch: string): 'ja' | 'en' | 'neutral' {
  if (JA_CHAR.test(ch)) return 'ja'
  if (/[A-Za-z]/.test(ch)) return 'en'
  return 'neutral'
}

/**
 * Split mixed-script prose into consecutive same-language runs.
 *
 * B-212(a): a co-created hook is English prose that embeds the kanji and its
 * kana reading — exactly the parts worth hearing — and both sheets spoke the
 * whole string with an en-US voice, which drops them silently. The learner's
 * report was that TTS "skipped any hiragana or Kanji characters". It was not
 * skipping them; it was being asked to read them in the wrong language.
 *
 * Neutral characters (spaces, punctuation, digits) attach to the run they
 * follow rather than starting one of their own, so "the 日 shines." yields
 * three segments and not seven. Punctuation riding along with the preceding
 * run also keeps the synthesiser's prosody intact — a segment that is bare
 * punctuation would be read as a pause in the wrong voice.
 *
 * Lives apart from tts.ts because that module imports expo-speech, which is
 * ESM and cannot be loaded by this repo's node-environment jest. Keeping the
 * pure half separate is what makes it testable at all.
 */
export function segmentByScript(text: string): ScriptSegment[] {
  const segments: ScriptSegment[] = []
  let current: ScriptSegment | null = null
  let pending = ''

  for (const ch of text) {
    const cls = classify(ch)
    if (cls === 'neutral') {
      pending += ch
      continue
    }
    if (current && current.lang === cls) {
      current.text += pending + ch
    } else {
      // Neutral text between two runs belongs to the run it followed; only a
      // leading run of neutral text has nowhere to go but forward.
      const lead: string = current ? '' : pending
      if (current) current.text += pending
      current = { text: lead + ch, lang: cls }
      segments.push(current)
    }
    pending = ''
  }
  if (current) current.text += pending

  return segments.filter((s) => s.text.trim().length > 0)
}
