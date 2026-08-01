import { placementResultCopy } from '../../src/lib/placement-result-copy'

// B146, found on device: the results screen led with `totalApplied` — the count
// of progress rows written — under the label "kanji recognized", and told a
// learner "No kanji were recognized. You'll start fresh from N5" in the same
// response that carried inferredLevel N4 and theta 0.2275, from a test they got
// 6.5 of 10 right.
//
// Two independent inaccuracies: a write-count is not a measure of knowledge, and
// seeds are written as status 'reviewing', never 'remembered'.

describe('placementResultCopy', () => {
  it('leads with the estimated level, not the number of rows written', () => {
    const copy = placementResultCopy({ inferredLevel: 'N4', seededCount: 0, isRetest: false })
    expect(copy.heroValue).toBe('N4')
    expect(copy.heroLabel).toBe('estimated level')
  })

  it('never claims nothing was recognised when a level was inferred', () => {
    const copy = placementResultCopy({ inferredLevel: 'N4', seededCount: 0, isRetest: false })
    expect(copy.subtitle).not.toMatch(/no kanji were recognized/i)
    expect(copy.subtitle).not.toMatch(/start fresh from N5/i)
  })

  it('describes seeded cards as scheduled, not as remembered', () => {
    const copy = placementResultCopy({ inferredLevel: 'N3', seededCount: 12, isRetest: false })
    expect(copy.subtitle).toMatch(/12/)
    expect(copy.subtitle).not.toMatch(/remembered/i)
  })

  it('says "updated level" on a retest', () => {
    const copy = placementResultCopy({ inferredLevel: 'N2', seededCount: 3, isRetest: true })
    expect(copy.heroLabel).toBe('updated level')
  })

  it('falls back honestly when no level could be inferred', () => {
    const copy = placementResultCopy({ inferredLevel: null, seededCount: 0, isRetest: false })
    expect(copy.heroValue).toBe('—')
    expect(copy.subtitle.length).toBeGreaterThan(0)
  })
})
