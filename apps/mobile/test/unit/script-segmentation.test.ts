import { segmentByScript } from '../../src/lib/script-segments'

/**
 * B-212(a) — hook TTS spoke everything with an en-US voice, so the kanji and
 * kana embedded in a co-created story were dropped. The owner's report was
 * that TTS "skipped any hiragana or Kanji characters"; it was not skipping
 * them, it was being asked to read them in the wrong language.
 *
 * Segmentation is the whole of the fix, and it is pure — so it is tested here
 * rather than inferred from a device.
 */

describe('segmentByScript', () => {
  it('splits a hook into its English and Japanese runs', () => {
    expect(segmentByScript('The 日 shines')).toEqual([
      { text: 'The ', lang: 'en' },
      { text: '日 ', lang: 'ja' },
      { text: 'shines', lang: 'en' },
    ])
  })

  it('keeps a pure-English story as one segment', () => {
    expect(segmentByScript('A hand beside a temple.')).toEqual([
      { text: 'A hand beside a temple.', lang: 'en' },
    ])
  })

  it('keeps a pure-Japanese string as one segment', () => {
    expect(segmentByScript('あんき、暗記')).toEqual([{ text: 'あんき、暗記', lang: 'ja' }])
  })

  it('groups hiragana, katakana and kanji into a single Japanese run', () => {
    const segments = segmentByScript('read あんキ暗 aloud')
    expect(segments.map((s) => s.lang)).toEqual(['en', 'ja', 'en'])
    expect(segments[1].text.trim()).toBe('あんキ暗')
  })

  it('does not fragment on punctuation between runs', () => {
    // Pre-fix concern: naive splitting yields a segment of bare punctuation,
    // which the synthesiser reads as a pause in the wrong voice.
    const segments = segmentByScript('the kanji 暗, meaning dark, is read あん.')
    expect(segments.map((s) => s.lang)).toEqual(['en', 'ja', 'en', 'ja'])
    expect(segments.every((s) => s.text.trim().length > 0)).toBe(true)
  })

  it('attaches leading punctuation to the first real run', () => {
    expect(segmentByScript('  “dark”')).toEqual([{ text: '  “dark”', lang: 'en' }])
  })

  it('returns nothing for text with no speakable content', () => {
    expect(segmentByScript('   ')).toEqual([])
    expect(segmentByScript('')).toEqual([])
    expect(segmentByScript('— … !')).toEqual([])
  })

  it('reassembles to the original string, losing nothing', () => {
    // The narration must not silently drop characters — dropping them is
    // exactly what the bug did. Concatenating the segments has to give the
    // story back verbatim, or something is being spoken that was not written
    // (or, worse, something written is not being spoken).
    const story =
      'Picture 暗 (あん): the sun 日 hidden behind a sound 音, and the room goes dark.'
    expect(segmentByScript(story).map((s) => s.text).join('')).toBe(story)
  })

  it('reassembles a story that opens and closes in Japanese', () => {
    const story = '暗 is dark — remember あん'
    expect(segmentByScript(story).map((s) => s.text).join('')).toBe(story)
  })
})
