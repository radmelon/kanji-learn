import {
  computeReveals,
  computeAttemptsCount,
  targetChipMask,
} from '../../src/components/voice/voiceReveal.logic'

describe('computeReveals', () => {
  it('reveals nothing at attempts=0 (try 1)', () => {
    expect(computeReveals(0)).toEqual({
      showKunOn: false,
      showKanjiMeaning: false,
      showHiragana: false,
      forcePitch: false,
      showVocabMeaning: false,
      canBail: false,
    })
  })

  it('reveals kun/on and kanji meaning at attempts=1 (try 2)', () => {
    expect(computeReveals(1)).toEqual({
      showKunOn: true,
      showKanjiMeaning: true,
      showHiragana: false,
      forcePitch: false,
      showVocabMeaning: false,
      canBail: false,
    })
  })

  it('adds hiragana at attempts=2 (try 3)', () => {
    expect(computeReveals(2)).toEqual({
      showKunOn: true,
      showKanjiMeaning: true,
      showHiragana: true,
      forcePitch: false,
      showVocabMeaning: false,
      canBail: false,
    })
  })

  it('force-reveals pitch + vocab meaning + bail at attempts=3 (try 4)', () => {
    expect(computeReveals(3)).toEqual({
      showKunOn: true,
      showKanjiMeaning: true,
      showHiragana: true,
      forcePitch: true,
      showVocabMeaning: true,
      canBail: true,
    })
  })

  it('stays at max reveals for attempts > 3', () => {
    expect(computeReveals(7)).toEqual({
      showKunOn: true,
      showKanjiMeaning: true,
      showHiragana: true,
      forcePitch: true,
      showVocabMeaning: true,
      canBail: true,
    })
  })
})

describe('computeAttemptsCount', () => {
  it('converts zero-indexed attempts to 1-indexed try number', () => {
    expect(computeAttemptsCount(0)).toBe(1)
    expect(computeAttemptsCount(1)).toBe(2)
    expect(computeAttemptsCount(3)).toBe(4)
    expect(computeAttemptsCount(9)).toBe(10)
  })
})

describe('targetChipMask', () => {
  it('marks the target character only', () => {
    expect(targetChipMask('指導', '指')).toEqual([true, false])
    expect(targetChipMask('指導', '導')).toEqual([false, true])
  })

  it('marks every occurrence when the target repeats', () => {
    expect(targetChipMask('人人', '人')).toEqual([true, true])
  })

  it('returns all false when target is not in the word', () => {
    expect(targetChipMask('指導', '感')).toEqual([false, false])
  })

  it('handles empty inputs defensively', () => {
    expect(targetChipMask('', '指')).toEqual([])
    expect(targetChipMask('指導', '')).toEqual([false, false])
  })

  it('handles single-character words', () => {
    expect(targetChipMask('息', '息')).toEqual([true])
  })
})
