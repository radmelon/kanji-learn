import { coCreationReducer, initialCoCreation } from '../../src/mnemonics/useCoCreation.reducer'

const kanji = { character: '持', meanings: ['hold'], kunReadings: ['も.つ'], onReadings: ['ジ'], components: ['扌', '寺'] }

describe('coCreationReducer', () => {
  it('starts at consent', () => {
    expect(initialCoCreation(kanji).stage).toBe('consent')
  })
  it('ACCEPT → location_inference', () => {
    expect(coCreationReducer(initialCoCreation(kanji), { type: 'ACCEPT' }).stage).toBe('location_inference')
  })
  // The grant path stays put so the sheet can actually show what it inferred.
  // Advancing here is what made "Looks like you're near X" unreachable for the
  // whole of Plan 3b — the stage that renders it was gone before the name
  // arrived.
  it('LOCATION_SET stores the place but STAYS on location_inference', () => {
    let s = coCreationReducer(initialCoCreation(kanji), { type: 'ACCEPT' })
    s = coCreationReducer(s, { type: 'LOCATION_SET', name: 'Beppu Station', latitude: 33.2, longitude: 131.5 })
    expect(s.stage).toBe('location_inference')
    expect(s.locationName).toBe('Beppu Station')
    expect(s.latitude).toBe(33.2)
  })
  it('LOCATION_CONFIRM advances and keeps the coordinates', () => {
    let s = coCreationReducer(initialCoCreation(kanji), { type: 'ACCEPT' })
    s = coCreationReducer(s, { type: 'LOCATION_SET', name: 'Beppu Station', latitude: 33.2, longitude: 131.5 })
    s = coCreationReducer(s, { type: 'LOCATION_CONFIRM' })
    expect(s.stage).toBe('detail_elicitation')
    expect(s.locationName).toBe('Beppu Station')
    expect(s.latitude).toBe(33.2)
  })
  it('LOCATION_TEXT overrides an inferred place AND drops its coordinates', () => {
    // "Somewhere else" means the GPS answer was wrong. Keeping the coords
    // would file the hook at a place the learner explicitly rejected.
    let s = coCreationReducer(initialCoCreation(kanji), { type: 'ACCEPT' })
    s = coCreationReducer(s, { type: 'LOCATION_SET', name: 'Beppu Station', latitude: 33.2, longitude: 131.5 })
    s = coCreationReducer(s, { type: 'LOCATION_TEXT', name: 'the kitchen' })
    expect(s.stage).toBe('detail_elicitation')
    expect(s.locationName).toBe('the kitchen')
    expect(s.latitude).toBeUndefined()
    expect(s.longitude).toBeUndefined()
  })
  it('ANCHOR_SET → assembly; DRAFT_READY stores story + tier', () => {
    let s = coCreationReducer(initialCoCreation(kanji), { type: 'ACCEPT' })
    s = coCreationReducer(s, { type: 'LOCATION_TEXT', name: 'Beppu Station' })
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
