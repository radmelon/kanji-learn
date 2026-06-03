import { coCreationReducer, initialCoCreation } from '../../src/mnemonics/useCoCreation.reducer'

const kanji = { character: '持', meanings: ['hold'], kunReadings: ['も.つ'], onReadings: ['ジ'], components: ['扌', '寺'] }

describe('coCreationReducer', () => {
  it('starts at consent', () => {
    expect(initialCoCreation(kanji).stage).toBe('consent')
  })
  it('ACCEPT → location_inference', () => {
    expect(coCreationReducer(initialCoCreation(kanji), { type: 'ACCEPT' }).stage).toBe('location_inference')
  })
  it('LOCATION_SET → detail_elicitation with the place name', () => {
    let s = coCreationReducer(initialCoCreation(kanji), { type: 'ACCEPT' })
    s = coCreationReducer(s, { type: 'LOCATION_SET', name: 'Beppu Station', latitude: 33.2, longitude: 131.5 })
    expect(s.stage).toBe('detail_elicitation')
    expect(s.locationName).toBe('Beppu Station')
  })
  it('ANCHOR_SET → assembly; DRAFT_READY stores story + tier', () => {
    let s = coCreationReducer(initialCoCreation(kanji), { type: 'ACCEPT' })
    s = coCreationReducer(s, { type: 'LOCATION_SET', name: 'Beppu Station' })
    s = coCreationReducer(s, { type: 'ANCHOR_SET', anchor: 'a yellow vending machine' })
    expect(s.stage).toBe('assembly')
    s = coCreationReducer(s, { type: 'DRAFT_READY', storyText: 'a story', generatedBy: 'cloud' })
    expect(s.draft).toBe('a story')
    expect(s.generatedBy).toBe('cloud')
  })
  it('COMMITTED → commitment stage with the saved id', () => {
    const base = { ...initialCoCreation(kanji), stage: 'assembly' as const, draft: 'x', generatedBy: 'cloud' as const }
    expect(coCreationReducer(base, { type: 'COMMITTED', mnemonicId: 'abc' }).stage).toBe('commitment')
  })
})
