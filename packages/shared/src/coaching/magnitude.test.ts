import { describe, it, expect } from 'vitest'
import { normaliseLinear, normaliseSaturating, confidenceFromCount } from './magnitude'

describe('normaliseLinear', () => {
  it('is 0 at or below zeroAt and 1 at or above oneAt', () => {
    expect(normaliseLinear(0.1, 0.2, 1.0)).toBe(0)
    expect(normaliseLinear(0.2, 0.2, 1.0)).toBe(0)
    expect(normaliseLinear(1.0, 0.2, 1.0)).toBe(1)
    expect(normaliseLinear(9.9, 0.2, 1.0)).toBe(1)
  })

  it('interpolates in between', () => {
    expect(normaliseLinear(0.6, 0.2, 1.0)).toBeCloseTo(0.5, 6)
  })

  it('handles a degenerate range without dividing by zero', () => {
    expect(normaliseLinear(5, 3, 3)).toBe(1)
    expect(normaliseLinear(1, 3, 3)).toBe(0)
  })
})

describe('normaliseSaturating', () => {
  it('is 0 at 0 and approaches 1 without reaching it', () => {
    expect(normaliseSaturating(0, 10)).toBe(0)
    expect(normaliseSaturating(1000, 10)).toBeLessThan(1)
    expect(normaliseSaturating(1000, 10)).toBeGreaterThan(0.99)
  })

  it('is monotonically increasing', () => {
    let prev = -1
    for (const v of [0, 1, 2, 5, 10, 20, 50]) {
      const n = normaliseSaturating(v, 10)
      expect(n).toBeGreaterThan(prev)
      prev = n
    }
  })

  it('clamps negative input to 0 rather than returning a negative magnitude', () => {
    expect(normaliseSaturating(-5, 10)).toBe(0)
  })
})

describe('confidenceFromCount', () => {
  it('is 0 with no observations — absent data must never speak', () => {
    expect(confidenceFromCount(0, 20)).toBe(0)
  })

  it('rises with observations and never reaches 1', () => {
    expect(confidenceFromCount(4, 20)).toBeLessThan(confidenceFromCount(40, 20))
    expect(confidenceFromCount(10_000, 20)).toBeLessThan(1)
  })

  it('hedges a four-observation finding well below a four-hundred one (spec §2)', () => {
    expect(confidenceFromCount(4, 20)).toBeLessThan(0.3)
    expect(confidenceFromCount(400, 20)).toBeGreaterThan(0.9)
  })
})
