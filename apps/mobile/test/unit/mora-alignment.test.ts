import { alignMoraToKana } from '../../src/lib/mora-alignment'

describe('alignMoraToKana', () => {
  it('splits a plain 4-mora hiragana reading one char per mora', () => {
    expect(alignMoraToKana('かんどう')).toEqual(['か', 'ん', 'ど', 'う'])
  })

  it('groups small ya/yu/yo with the preceding kana into a single mora', () => {
    expect(alignMoraToKana('きゃく')).toEqual(['きゃ', 'く'])
  })

  it('treats sokuon (small っ) as its own mora', () => {
    expect(alignMoraToKana('かった')).toEqual(['か', 'っ', 'た'])
  })

  it('handles mixed small-tsu + small-yo combos', () => {
    expect(alignMoraToKana('はっぴょう')).toEqual(['は', 'っ', 'ぴょ', 'う'])
  })

  it('applies the same rules to katakana', () => {
    expect(alignMoraToKana('カンドウ')).toEqual(['カ', 'ン', 'ド', 'ウ'])
  })

  it('groups small katakana ya/yu/yo with the preceding char', () => {
    expect(alignMoraToKana('キャク')).toEqual(['キャ', 'ク'])
  })

  it('returns an empty array for an empty string', () => {
    expect(alignMoraToKana('')).toEqual([])
  })

  it('passes through non-kana characters as their own mora', () => {
    expect(alignMoraToKana('a')).toEqual(['a'])
  })
})
