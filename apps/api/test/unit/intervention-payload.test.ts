import { describe, it, expect } from 'vitest'
import { parseInterventionPayload } from '../../src/services/intervention.service.js'

// The interventions.payload jsonb column is double-encoded on write — rows read
// back give `payload` as a JSON *string*, not an object. parseInterventionPayload
// decodes it so buildMessage can read payload fields (the velocity-drop nudge was
// stuck at "0%" because payload.dropPct was undefined on an undecoded string).
describe('parseInterventionPayload', () => {
  it('decodes a double-encoded JSON-string payload into an object', () => {
    const raw = '{"currentAvg":10,"previousAvg":24,"dropPct":0.583}'
    expect(parseInterventionPayload(raw)).toEqual({
      currentAvg: 10,
      previousAvg: 24,
      dropPct: 0.583,
    })
  })

  it('passes a plain object payload through unchanged', () => {
    expect(parseInterventionPayload({ dropPct: 0.6 })).toEqual({ dropPct: 0.6 })
  })

  it('returns an empty object for a malformed JSON string', () => {
    expect(parseInterventionPayload('not json')).toEqual({})
  })

  it('returns an empty object for null', () => {
    expect(parseInterventionPayload(null)).toEqual({})
  })
})
