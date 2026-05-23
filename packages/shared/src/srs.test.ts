import { describe, it, expect } from 'vitest'
import {
  ratingFromQuality,
  statusFromStability,
  retrievability,
  type FsrsCard,
} from './srs'

describe('ratingFromQuality', () => {
  it('maps 0,1,2 → 1 (Again)', () => {
    expect(ratingFromQuality(0)).toBe(1)
    expect(ratingFromQuality(1)).toBe(1)
    expect(ratingFromQuality(2)).toBe(1)
  })
  it('maps 3 → 2 (Hard)', () => {
    expect(ratingFromQuality(3)).toBe(2)
  })
  it('maps 4 → 3 (Good)', () => {
    expect(ratingFromQuality(4)).toBe(3)
  })
  it('maps 5 → 4 (Easy)', () => {
    expect(ratingFromQuality(5)).toBe(4)
  })
})

describe('statusFromStability', () => {
  it('0 → learning (unseen sentinel)', () => {
    expect(statusFromStability(0)).toBe('learning')
  })
  it('below 7d → learning', () => {
    expect(statusFromStability(6.99)).toBe('learning')
  })
  it('at 7d boundary → reviewing', () => {
    expect(statusFromStability(7)).toBe('reviewing')
  })
  it('below 21d → reviewing', () => {
    expect(statusFromStability(20.99)).toBe('reviewing')
  })
  it('at 21d boundary → remembered', () => {
    expect(statusFromStability(21)).toBe('remembered')
  })
  it('below 180d → remembered', () => {
    expect(statusFromStability(179.99)).toBe('remembered')
  })
  it('at 180d boundary → burned', () => {
    expect(statusFromStability(180)).toBe('burned')
  })
})

describe('retrievability', () => {
  const baseDate = new Date('2026-05-22T00:00:00Z')
  const mkCard = (stability: number, lastReviewedAt: Date | null): FsrsCard => ({
    stability, difficulty: 5, lapses: 0, status: 'reviewing', lastReviewedAt,
  })

  it('returns 0 for unseen card (stability=0)', () => {
    expect(retrievability(mkCard(0, null), baseDate)).toBe(0)
  })
  it('returns 0 when lastReviewedAt is null', () => {
    expect(retrievability(mkCard(10, null), baseDate)).toBe(0)
  })
  it('returns 1 for elapsed=0', () => {
    expect(retrievability(mkCard(10, baseDate), baseDate)).toBeCloseTo(1, 5)
  })
  it('returns 0.9 when elapsed = stability (the FSRS target)', () => {
    const reviewedAt = new Date(baseDate.getTime() - 10 * 86400_000)
    expect(retrievability(mkCard(10, reviewedAt), baseDate)).toBeCloseTo(0.9, 5)
  })
  it('decays below 0.9 when past stability', () => {
    const reviewedAt = new Date(baseDate.getTime() - 20 * 86400_000)
    expect(retrievability(mkCard(10, reviewedAt), baseDate)).toBeLessThan(0.9)
  })
})
