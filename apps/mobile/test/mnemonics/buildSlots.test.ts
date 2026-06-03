import { buildSlots, buildContext } from '../../src/mnemonics/buildSlots'

const kanji = { character: '持', meanings: ['hold', 'have'], kunReadings: ['も.つ'], onReadings: ['ジ'], components: ['扌', '寺'] }
const answers = { anchor: 'a yellow vending machine', locationName: 'Beppu Station' }

describe('buildSlots', () => {
  it('maps components through the shared dictionary and picks meaning + kana reading', () => {
    const s = buildSlots(kanji, answers)
    expect(s.kanji).toBe('持')
    expect(s.kanjiMeaning).toBe('hold')
    expect(s.reading).toBe('もつ')               // kun reading, dots stripped → kana
    expect(s.components.map((c) => c.char)).toEqual(['扌', '寺'])
    expect(s.components[0].meaning).toBe('hand') // from the shared RADICAL_DICTIONARY
    expect(s.locationName).toBe('Beppu Station')
    expect(s.anchor).toBe('a yellow vending machine')
  })
  it('degrades to on-reading kana when there is no kun reading', () => {
    expect(buildSlots({ ...kanji, kunReadings: [] }, answers).reading).toBe('ジ')
  })
})

describe('buildContext', () => {
  it('produces a single environment layer + components + generatedBy + a quiz-due stamp', () => {
    const ctx = buildContext(kanji, answers, 'cloud', '2026-06-03T00:00:00.000Z')
    expect(ctx.layerCount).toBe(1)
    expect(ctx.layers[0].source).toBe('environment')
    expect(ctx.layers[0].anchor).toBe('a yellow vending machine')
    expect(ctx.components).toEqual([{ char: '扌', meaning: 'hand' }, { char: '寺', meaning: 'temple' }])
    expect(ctx.generatedBy).toBe('cloud')
    expect(ctx.locationName).toBe('Beppu Station')
    expect(ctx.mnemonicQuizDueAt).toBe('2026-06-03T00:00:00.000Z')
  })
})
