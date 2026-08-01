import { describe, it, expect } from 'vitest'
import {
  THETA_GRID, GUESSING_C, probCorrect, initPosterior, updatePosterior,
  thetaMean, thetaAtQuantile, pKnows, credibleIntervalWidth, shouldStop,
  inferredLevel, levelBands,
} from './placement'

describe('probCorrect', () => {
  it('at theta == b, equals c + (1-c)*0.5', () => {
    expect(probCorrect(0, 0)).toBeCloseTo(GUESSING_C + (1 - GUESSING_C) * 0.5, 6)
  })
  it('is monotonically increasing in theta', () => {
    expect(probCorrect(2, 0)).toBeGreaterThan(probCorrect(0, 0))
  })
  it('never drops below c, however low theta is', () => {
    expect(probCorrect(-100, 0)).toBeGreaterThan(GUESSING_C - 0.001)
  })
})

describe('initPosterior', () => {
  it('sums to 1', () => {
    const p = initPosterior(0)
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
  })
  it('is peaked at the prior mean', () => {
    const p = initPosterior(0)
    const peakIdx = p.indexOf(Math.max(...p))
    expect(Math.abs(THETA_GRID[peakIdx])).toBeLessThan(0.2)
  })
})

describe('updatePosterior', () => {
  it('a correct response shifts the mean upward', () => {
    const p0 = initPosterior(0)
    const p1 = updatePosterior(p0, 0, true)
    expect(thetaMean(p1)).toBeGreaterThan(thetaMean(p0))
  })
  it('an incorrect response shifts the mean downward', () => {
    const p0 = initPosterior(0)
    const p1 = updatePosterior(p0, 0, false)
    expect(thetaMean(p1)).toBeLessThan(thetaMean(p0))
  })
  it('always sums to 1 after update', () => {
    const p1 = updatePosterior(initPosterior(0), 1.5, true)
    expect(p1.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
  })
})

describe('pKnows excludes the guessing floor (spec §7.1 — the easiest mistake)', () => {
  it('can go well below c=0.25 when theta is far below b', () => {
    // A posterior tightly concentrated at a low theta.
    let p = initPosterior(-4)
    for (let i = 0; i < 10; i++) p = updatePosterior(p, -4, false) // reinforce low theta
    const knowledge = pKnows(p, 2) // item far above the learner's ability
    expect(knowledge).toBeLessThan(GUESSING_C)
  })
  it('differs from probCorrect at the same theta/b (the regression case)', () => {
    const p = initPosterior(-2)
    const b = 1
    expect(pKnows(p, b)).toBeLessThan(probCorrect(thetaMean(p), b))
  })
})

describe('pKnows is conservative (25th percentile, spec §7.2)', () => {
  it('a wider posterior at the same mean yields a strictly lower p(knows)', () => {
    const narrow = initPosterior(0)
    let wide = initPosterior(0)
    // Widen by alternating correct/incorrect at extreme b so the mean stays
    // near 0 but the distribution spreads.
    wide = updatePosterior(wide, 3, true)
    wide = updatePosterior(wide, -3, false)
    expect(pKnows(wide, 0)).toBeLessThanOrEqual(pKnows(narrow, 0))
  })
})

describe('credibleIntervalWidth', () => {
  it('is small for a narrow (well-informed) posterior', () => {
    let p = initPosterior(0)
    for (let i = 0; i < 20; i++) p = updatePosterior(p, 0, true)
    expect(credibleIntervalWidth(p, 0.8)).toBeLessThan(2)
  })
  it('is large for a flat (uninformed) posterior', () => {
    expect(credibleIntervalWidth(initPosterior(0, 3), 0.8)).toBeGreaterThan(2)
  })
})

describe('shouldStop', () => {
  const config = { floorItems: 8, capItems: 24, bandWidth: 1.5 }

  it('never stops before the floor, however narrow the posterior', () => {
    let p = initPosterior(0)
    for (let i = 0; i < 20; i++) p = updatePosterior(p, 0, true)
    expect(shouldStop(p, 5, config)).toBe(false)
  })
  it('always stops at the cap, however wide the posterior', () => {
    expect(shouldStop(initPosterior(0, 3), 24, config)).toBe(true)
  })
  it('stops between floor and cap once the interval is narrow enough', () => {
    // Construct a narrow posterior directly, mirroring the sibling test below
    // that constructs a wide one. This asserts the stopping RULE, not the
    // estimator's convergence rate.
    //
    // The plan's original version simulated 15 correct answers all at b=0 and
    // expected width <= 1.5. It cannot get there: with b pinned at 0 while
    // theta rises to ~2.4, p(correct) reaches 0.94 and each further item
    // carries almost no information (Fisher information peaks at b ~= theta).
    // Measured widths under that sequence: n=15 -> 2.10, n=60 -> 1.40, versus
    // a cap of 24 items. Under the adaptive selection the engine actually uses
    // (Task 7), the same posterior crosses 1.5 at n=13 and reaches 1.10 by
    // n=15 — so the estimator is correct and only the fixture was wrong.
    // Adaptive convergence is covered end-to-end by Task 12.
    expect(shouldStop(initPosterior(0, 0.5), 10, config)).toBe(true)
  })
  it('does not stop between floor and cap while the interval is still wide', () => {
    expect(shouldStop(initPosterior(0, 3), 10, config)).toBe(false)
  })
})

describe('inferredLevel', () => {
  const levels = ['N5', 'N4', 'N3', 'N2', 'N1'] as const
  const boundaries = [-2, -1, 0, 1] // 4 boundaries for 5 levels

  it('theta below the first boundary is the lowest level', () => {
    expect(inferredLevel(-3, boundaries, [...levels])).toBe('N5')
  })
  it('theta above the last boundary is the highest level', () => {
    expect(inferredLevel(2, boundaries, [...levels])).toBe('N1')
  })
  it('theta between two boundaries lands on the level between them', () => {
    expect(inferredLevel(0.5, boundaries, [...levels])).toBe('N2')
  })
})

describe('levelBands', () => {
  const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const
  const corpus = [
    { b: -2, level: 'N5' as const }, { b: -2.5, level: 'N5' as const },
    { b: -1, level: 'N4' as const },
    { b: 0, level: 'N3' as const },
    { b: 1, level: 'N2' as const },
    { b: 2, level: 'N1' as const },
  ]

  it('returns one fewer boundary than the levels it separates', () => {
    const bands = levelBands(corpus, LEVELS)
    expect(bands.levels).toEqual(['N5', 'N4', 'N3', 'N2', 'N1'])
    expect(bands.boundaries).toHaveLength(4)
  })

  it('a boundary is the midpoint of two adjacent levels’ MEAN difficulty', () => {
    // N5 mean is (-2 + -2.5)/2 = -2.25; N4 mean is -1. Midpoint: -1.625.
    expect(levelBands(corpus, LEVELS).boundaries[0]).toBeCloseTo(-1.625, 6)
  })

  it('drops a level with no entries from BOTH arrays, keeping them aligned', () => {
    const noN4 = corpus.filter((e) => e.level !== 'N4')
    const bands = levelBands(noN4, LEVELS)
    expect(bands.levels).toEqual(['N5', 'N3', 'N2', 'N1'])
    expect(bands.boundaries).toHaveLength(3)
  })

  it('ignores entries whose level is unknown', () => {
    const bands = levelBands([...corpus, { b: 99, level: null }], LEVELS)
    expect(bands.levels).toEqual(['N5', 'N4', 'N3', 'N2', 'N1'])
  })

  it('an empty corpus yields no bands at all', () => {
    expect(levelBands([], LEVELS)).toEqual({ boundaries: [], levels: [] })
  })

  // The B146 device report: "level N4 even though I got most of the kanji
  // correct". The adaptive engine maximises Fisher information, so a strong
  // learner is asked only hard items and N5/N4 never appear in the asked set.
  // Deriving bands from the ASKED items then produced boundaries for three
  // levels while the label was still read out of the full five-level list —
  // so index 1 meant "N2" but was reported as "N4". The better the learner
  // did, the lower the level they were told.
  it('a strong learner asked only N3/N2/N1 is not labelled from the full list', () => {
    const asked = corpus.filter((e) => ['N3', 'N2', 'N1'].includes(e.level))
    const bands = levelBands(asked, LEVELS)

    // Bands separate three levels, so there are two boundaries: 0.5 and 1.5.
    expect(bands.levels).toEqual(['N3', 'N2', 'N1'])
    expect(bands.boundaries).toEqual([0.5, 1.5])

    // theta = 1.2 sits between them. Paired with its own levels: N2.
    expect(inferredLevel(1.2, bands.boundaries, bands.levels)).toBe('N2')
    // Paired with the full list — the shipped bug — it read as N4.
    expect(inferredLevel(1.2, bands.boundaries, [...LEVELS])).toBe('N4')
  })
})

import { PlacementEngine } from './placement'

describe('PlacementEngine', () => {
  const baseConfig = { floorCharacters: 4, capCharacters: 12, bandWidth: 1.5, readingOffset: 0.3 }

  it('starts with theta at the configured prior mean', () => {
    const engine = new PlacementEngine({ ...baseConfig, priorMean: 0 })
    expect(engine.getThetaHat()).toBeCloseTo(0, 1)
  })

  it('a retest seeded with a stored posterior starts from that state, not flat', () => {
    // Build a posterior that's clearly shifted high, as if from a strong first placement.
    let priorPosterior = initPosterior(0)
    for (let i = 0; i < 15; i++) priorPosterior = updatePosterior(priorPosterior, 2, true)

    const retestEngine = new PlacementEngine({ ...baseConfig, priorPosterior })
    const freshEngine = new PlacementEngine({ ...baseConfig, priorMean: 0 })

    expect(retestEngine.getThetaHat()).toBeGreaterThan(freshEngine.getThetaHat() + 0.5)
  })

  it('recordItemResult moves theta and tracks asked kanji', () => {
    const engine = new PlacementEngine(baseConfig)
    engine.recordItemResult(101, 'meaning', 0, true)
    engine.recordItemResult(101, 'reading', 0.3, true)
    expect(engine.getThetaHat()).toBeGreaterThan(0)
    expect(engine.getAskedKanjiIds()).toEqual([101])
  })

  it('is not done before the character floor even with a narrow posterior', () => {
    const engine = new PlacementEngine(baseConfig)
    for (let i = 0; i < 2; i++) {
      engine.recordItemResult(i, 'meaning', 0, true)
      engine.recordItemResult(i, 'reading', 0.3, true)
    }
    expect(engine.isDone()).toBe(false) // 2 characters < floor of 4
  })

  it('is done at the character cap regardless of posterior width', () => {
    const engine = new PlacementEngine(baseConfig)
    // Alternate correct/incorrect at extreme difficulties to keep the
    // posterior wide, proving the cap fires independent of convergence.
    for (let i = 0; i < 12; i++) {
      engine.recordItemResult(i, 'meaning', 3, i % 2 === 0)
      engine.recordItemResult(i, 'reading', -3, i % 2 === 0)
    }
    expect(engine.isDone()).toBe(true)
  })

  it('getAskedItems returns every recorded response in order', () => {
    const engine = new PlacementEngine(baseConfig)
    engine.recordItemResult(5, 'meaning', 0, true)
    engine.recordItemResult(5, 'reading', 0.3, false)
    expect(engine.getAskedItems()).toEqual([
      { kanjiId: 5, itemType: 'meaning', b: 0, correct: true },
      { kanjiId: 5, itemType: 'reading', b: 0.3, correct: false },
    ])
  })
})
