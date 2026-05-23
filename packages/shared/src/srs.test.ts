import { describe, it, expect } from 'vitest'
import {
  ratingFromQuality,
  statusFromStability,
  retrievability,
  createNewCard,
  calculateNextReview,
  type FsrsCard,
} from './srs'
import { DEFAULT_FSRS_WEIGHTS } from './constants'

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

describe('DEFAULT_FSRS_WEIGHTS', () => {
  it('has 19 elements (FSRS-5)', () => {
    expect(DEFAULT_FSRS_WEIGHTS.length).toBe(19)
  })
})

describe('createNewCard', () => {
  it('returns the unseen sentinel state', () => {
    const c = createNewCard()
    expect(c.stability).toBe(0)
    expect(c.difficulty).toBe(5)
    expect(c.lapses).toBe(0)
    expect(c.status).toBe('learning')
    expect(c.lastReviewedAt).toBeNull()
  })
})

describe('calculateNextReview — first review (initial state)', () => {
  const now = new Date('2026-05-22T00:00:00Z')
  const fresh = () => createNewCard()

  it('Again on a new card produces small S and high D', () => {
    const r = calculateNextReview(fresh(), 1, now)
    // FSRS-5 weight w[0] = 0.40255 → initial S for Again
    expect(r.stability).toBeCloseTo(0.40255, 4)
    expect(r.lapses).toBe(1)
    expect(r.difficulty).toBeGreaterThan(5)
    expect(r.lastReviewedAt).toEqual(now)
  })

  it('Good on a new card uses w[2] for initial stability', () => {
    const r = calculateNextReview(fresh(), 3, now)
    expect(r.stability).toBeCloseTo(3.173, 4)
    expect(r.lapses).toBe(0)
  })

  it('Easy on a new card uses w[3] for initial stability', () => {
    const r = calculateNextReview(fresh(), 4, now)
    expect(r.stability).toBeCloseTo(15.69105, 4)
    expect(r.lapses).toBe(0)
  })

  it('next_review_at sits ~stability days in the future (target R = 0.9)', () => {
    const r = calculateNextReview(fresh(), 3, now)
    const days = (r.nextReviewAt.getTime() - now.getTime()) / 86_400_000
    // For target R = 0.9, the interval should ~= stability days (with FSRS-5's
    // decay-adjusted scheduling); accept anything within ±1 day for the ~3.17d
    // initial Good stability.
    expect(days).toBeGreaterThan(2)
    expect(days).toBeLessThan(5)
  })

  it('status is derived from final stability', () => {
    const r = calculateNextReview(fresh(), 4, now)
    // Initial Easy stability ~15.7d → reviewing band (7..21)
    expect(r.status).toBe('reviewing')
  })
})

describe('calculateNextReview — subsequent reviews', () => {
  const t0 = new Date('2026-05-22T00:00:00Z')

  it('Again on a learned card drops stability sharply and increments lapses', () => {
    const card = createNewCard()
    const c1 = calculateNextReview(card, 3, t0)               // Good, day 0
    const t1 = new Date(c1.nextReviewAt)
    const c2 = calculateNextReview(c1, 1, t1)                  // Again, on time
    expect(c2.lapses).toBe(1)
    expect(c2.stability).toBeLessThan(c1.stability)
    expect(c2.difficulty).toBeGreaterThan(c1.difficulty)
  })

  it('Good on time grows stability', () => {
    const card = createNewCard()
    const c1 = calculateNextReview(card, 3, t0)
    const t1 = new Date(c1.nextReviewAt)
    const c2 = calculateNextReview(c1, 3, t1)
    expect(c2.stability).toBeGreaterThan(c1.stability)
    expect(c2.lapses).toBe(0)
  })

  it('Easy grows stability more than Good (easy_bonus)', () => {
    const card = createNewCard()
    const cGood = calculateNextReview(card, 3, t0)
    const cEasy = calculateNextReview(card, 4, t0)
    expect(cEasy.stability).toBeGreaterThan(cGood.stability)
  })

  it('Hard grows stability less than Good (hard_penalty)', () => {
    const card = createNewCard()
    const c0 = calculateNextReview(card, 3, t0)
    const t1 = new Date(c0.nextReviewAt)
    const cHard = calculateNextReview(c0, 2, t1)
    const cGood = calculateNextReview(c0, 3, t1)
    expect(cHard.stability).toBeLessThan(cGood.stability)
  })

  it('difficulty stays within [1, 10] under repeated extreme grades', () => {
    let card = createNewCard()
    let t = t0
    for (let i = 0; i < 20; i++) {
      card = calculateNextReview(card, 1, t)
      t = new Date(t.getTime() + 86_400_000)
    }
    expect(card.difficulty).toBeLessThanOrEqual(10)
    expect(card.difficulty).toBeGreaterThanOrEqual(1)
  })
})
