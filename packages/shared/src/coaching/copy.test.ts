import { describe, it, expect } from 'vitest'
import { analysisBody, templateCopy } from './copy'
import type { Finding, FindingKind } from './types'

function finding(kind: FindingKind, since: string | null = null): Finding {
  return { kind, magnitude: 0.8, confidence: 1, evidence: [], since }
}

const NOW = '2026-08-02T12:00:00.000Z'

describe('analysisBody', () => {
  it('joins each finding with a blank line', () => {
    const body = analysisBody([finding('reading_lag'), finding('leech')], NOW)
    expect(body).toBe(
      `${templateCopy(finding('reading_lag'), NOW)}\n\n${templateCopy(finding('leech'), NOW)}`,
    )
  })

  it('returns an empty string for no findings', () => {
    expect(analysisBody([], NOW)).toBe('')
  })

  it('passes `now` through, so a RECENT since does NOT escalate', () => {
    // copy.ts reads `if (!now || days >= ESCALATE_AFTER_DAYS)`. Omitting `now`
    // escalates every finding that has a `since`, whatever its age. This test
    // is what stops analysisBody from dropping the argument.
    const body = analysisBody([finding('reading_lag', '2026-08-01')], NOW)
    expect(body).not.toContain('been true for a while')
  })

  it('DOES escalate a since older than the threshold', () => {
    const body = analysisBody([finding('reading_lag', '2026-06-01')], NOW)
    expect(body).toContain('been true for a while')
  })
})

describe('commitment_gap copy', () => {
  it('describes a finished period, not the current one', () => {
    // Assembly only ever passes a COMPLETED period, so "this period" was wrong.
    const text = templateCopy(finding('commitment_gap'), NOW)
    expect(text).not.toContain('this period')
    expect(text).toContain('last')
  })
})
