import { describe, it, expect } from 'vitest'
import { EVENT_SURFACES, RECORD_SURFACES } from './routing'

describe('surface vocabulary', () => {
  it('separates event surfaces from record surfaces with no overlap', () => {
    const overlap = EVENT_SURFACES.filter((s) => (RECORD_SURFACES as readonly string[]).includes(s))
    expect(overlap).toEqual([])
  })

  it('names the four event surfaces from spec §3.1', () => {
    expect([...EVENT_SURFACES].sort()).toEqual(
      ['placement', 'progress', 'session_complete', 'weekly'],
    )
  })

  it('names the two record surfaces from spec §3.1', () => {
    expect([...RECORD_SURFACES].sort()).toEqual(['journal', 'tutor_report'])
  })
})
