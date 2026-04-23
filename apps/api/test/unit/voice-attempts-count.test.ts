import { describe, it, expect } from 'vitest'
import { voiceSchema } from '../../src/routes/review'

describe('voiceSchema (POST /v1/review/voice body)', () => {
  const base = {
    kanjiId: 42,
    transcript: 'しどう',
    correctReadings: ['しどう'],
  }

  it('accepts a valid attemptsCount of 1', () => {
    const r = voiceSchema.safeParse({ ...base, attemptsCount: 1 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.attemptsCount).toBe(1)
  })

  it('accepts a valid attemptsCount of 3', () => {
    const r = voiceSchema.safeParse({ ...base, attemptsCount: 3 })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.attemptsCount).toBe(3)
  })

  it('defaults attemptsCount to 1 when omitted', () => {
    const r = voiceSchema.safeParse(base)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.attemptsCount).toBe(1)
  })

  it('rejects attemptsCount of 0', () => {
    const r = voiceSchema.safeParse({ ...base, attemptsCount: 0 })
    expect(r.success).toBe(false)
  })

  it('rejects negative attemptsCount', () => {
    const r = voiceSchema.safeParse({ ...base, attemptsCount: -1 })
    expect(r.success).toBe(false)
  })

  it('rejects attemptsCount above upper bound (50)', () => {
    const r = voiceSchema.safeParse({ ...base, attemptsCount: 51 })
    expect(r.success).toBe(false)
  })

  it('rejects non-integer attemptsCount', () => {
    const r = voiceSchema.safeParse({ ...base, attemptsCount: 1.5 })
    expect(r.success).toBe(false)
  })

  it('rejects string attemptsCount', () => {
    const r = voiceSchema.safeParse({ ...base, attemptsCount: 'two' })
    expect(r.success).toBe(false)
  })

  it('accepts attemptsCount at the upper bound (50)', () => {
    const r = voiceSchema.safeParse({ ...base, attemptsCount: 50 })
    expect(r.success).toBe(true)
  })

  it('rejects null attemptsCount', () => {
    const r = voiceSchema.safeParse({ ...base, attemptsCount: null })
    expect(r.success).toBe(false)
  })
})
