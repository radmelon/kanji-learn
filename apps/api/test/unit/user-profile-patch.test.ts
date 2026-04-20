import { describe, it, expect } from 'vitest'
import { updateProfileSchema } from '../../src/routes/user-profile.schema'

describe('updateProfileSchema — showPitchAccent', () => {
  it('accepts showPitchAccent: true', () => {
    const result = updateProfileSchema.safeParse({ showPitchAccent: true })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.showPitchAccent).toBe(true)
  })

  it('accepts showPitchAccent: false', () => {
    const result = updateProfileSchema.safeParse({ showPitchAccent: false })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.showPitchAccent).toBe(false)
  })

  it('accepts a body without showPitchAccent (optional)', () => {
    const result = updateProfileSchema.safeParse({ dailyGoal: 20 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.showPitchAccent).toBeUndefined()
  })

  it('rejects non-boolean showPitchAccent', () => {
    const result = updateProfileSchema.safeParse({ showPitchAccent: 'yes' })
    expect(result.success).toBe(false)
  })

  it('accepts showPitchAccent alongside other fields', () => {
    const result = updateProfileSchema.safeParse({
      displayName: 'Buddy',
      dailyGoal: 15,
      showPitchAccent: false,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.showPitchAccent).toBe(false)
      expect(result.data.displayName).toBe('Buddy')
    }
  })
})
