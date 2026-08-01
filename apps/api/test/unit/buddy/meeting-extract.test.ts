// Placed under test/unit/buddy/ rather than colocated with src (as the
// brief's illustrative path suggested) because apps/api's vitest config
// (apps/api/vitest.config.ts) sets `include: ['test/**/*.test.ts']` — a
// colocated src/**/*.test.ts file would never be picked up.
import { describe, it, expect } from 'vitest'
import { extractJsonObject, extractedPatchSchema } from '../../../src/services/buddy/meeting-extract'

describe('extractJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(extractJsonObject('{"reply":"hi","patch":{}}')).toEqual({ reply: 'hi', patch: {} })
  })
  it('parses JSON wrapped in a fenced block with prose around it', () => {
    const text = 'Sure!\n```json\n{"reply":"hi","patch":{"dailyGoal":20}}\n```\nHope that helps.'
    expect(extractJsonObject(text)).toEqual({ reply: 'hi', patch: { dailyGoal: 20 } })
  })
  it('returns null for prose, arrays, and broken JSON', () => {
    expect(extractJsonObject('I could not decide.')).toBeNull()
    expect(extractJsonObject('[1,2]')).toBeNull()
    expect(extractJsonObject('{"reply": unclosed')).toBeNull()
  })
})

describe('extractedPatchSchema', () => {
  it('accepts a full valid patch', () => {
    expect(extractedPatchSchema.safeParse({
      reasons: ['Travel'], interests: ['food'], explicitRuler: 'jlpt',
      dailyGoal: 20, buddyDay: 3, buddyIntervalWeeks: 2,
    }).success).toBe(true)
  })
  it('rejects out-of-range and unknown keys — a hallucinated field must not reach merge', () => {
    expect(extractedPatchSchema.safeParse({ buddyDay: 7 }).success).toBe(false)
    expect(extractedPatchSchema.safeParse({ metBuddyAt: 'x' }).success).toBe(false)
  })
})
