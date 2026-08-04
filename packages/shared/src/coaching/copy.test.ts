import { describe, it, expect } from 'vitest'
import { analysisBody, humanDate, humanDateRange, templateCopy } from './copy'
import type { Finding, FindingKind } from './types'
import { EVIDENCE_LABELS } from './types'

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

// Mirrors what detectLevelEstimate (orient.ts) actually emits: level, its 80%
// credible interval, ability estimate + SE, and the date the test was taken.
// levelLow/levelHigh are named for the ABILITY bound, which is why the "lower"
// bound is N5 (less advanced) and the "upper" bound is N3 (more advanced) —
// JLPT numbering runs the opposite way from ability.
const levelEstimateFinding: Finding = {
  kind: 'level_estimate',
  magnitude: 0.5,
  confidence: 1,
  evidence: [
    { label: EVIDENCE_LABELS.MOST_LIKELY_LEVEL, value: 'N4' },
    { label: EVIDENCE_LABELS.LOWER_BOUND, value: 'N5' },
    { label: EVIDENCE_LABELS.UPPER_BOUND, value: 'N3' },
    { label: EVIDENCE_LABELS.ABILITY_ESTIMATE, value: 0.42 },
    { label: EVIDENCE_LABELS.STANDARD_ERROR, value: 0.35 },
    { label: EVIDENCE_LABELS.MEASURED_ON, value: '2026-07-29' },
  ],
  since: null,
}

// A collapsed interval: low === high because the 80% credible interval sits
// entirely inside one band. Reachable at the codebase's own SE_TIGHT = 0.3
// (detectors/orient.ts) — band boundaries computed from real per-level mean
// difficulty make the narrowest band (N4) 1.31 logits wide, while the 80%
// interval at SE_TIGHT spans only ~0.77 logits, so theta = -2.0, se = 0.3
// never leaves N5.
const levelEstimateFindingCollapsed: Finding = {
  kind: 'level_estimate',
  magnitude: 0.5,
  confidence: 1,
  evidence: [
    { label: EVIDENCE_LABELS.MOST_LIKELY_LEVEL, value: 'N5' },
    { label: EVIDENCE_LABELS.LOWER_BOUND, value: 'N5' },
    { label: EVIDENCE_LABELS.UPPER_BOUND, value: 'N5' },
    { label: EVIDENCE_LABELS.ABILITY_ESTIMATE, value: -2.0 },
    { label: EVIDENCE_LABELS.STANDARD_ERROR, value: 0.3 },
    { label: EVIDENCE_LABELS.MEASURED_ON, value: '2026-07-29' },
  ],
  since: null,
}

// Mirrors detectMechanicsExplainer: fixed copy, no evidence, since always null.
const mechanicsFinding: Finding = {
  kind: 'mechanics_explainer',
  magnitude: 0.1,
  confidence: 1,
  evidence: [],
  since: null,
}

describe('humanDate', () => {
  // MUTATION CAUGHT: using toLocaleDateString, whose output depends on the
  // host locale and timezone. The analyzer is pure by contract and CI must not
  // render a different sentence from a developer's machine.
  it('renders an ISO date as a day and month', () => {
    expect(humanDate('2026-07-29')).toBe('29 July')
    expect(humanDate('2026-08-03T17:19:55.000Z')).toBe('3 August')
  })
})

describe('humanDateRange', () => {
  // MUTATION CAUGHT: rendering periodEnd raw. It is EXCLUSIVE
  // (commitment.service.ts:253 computes weekStart + periodDays), so a period
  // starting 20 July ends on the 26th and must not read "27 July". Nothing
  // else in the system would catch an off-by-one in prose.
  it('subtracts a day from the exclusive end', () => {
    expect(humanDateRange('2026-07-20', '2026-07-27')).toBe('20 and 26 July')
  })

  // MUTATION CAUGHT: collapsing to one month name when the period straddles
  // two, which would render "27 and 2 August" for a period ending in August.
  it('names both months when the period straddles them', () => {
    expect(humanDateRange('2026-07-27', '2026-08-03')).toBe('27 July and 2 August')
  })
})

describe('templateCopy — level_estimate', () => {
  // MUTATION CAUGHT: the original defect. "Your placement puts you around this
  // level, with some room either side" answers none of the owner's questions —
  // which test, when, what level, what range.
  it('names the level, the range and the date', () => {
    const text = templateCopy(levelEstimateFinding, NOW)
    expect(text).toContain('29 July')
    expect(text).toContain('N4')
    expect(text).toContain('N5')
    expect(text).toContain('N3')
  })

  // MUTATION CAUGHT: saying the range narrows "as you do more". Verified
  // 2026-08-03: abilityTheta/abilitySe are written ONLY by
  // placement.service.ts:319, on completing a placement test. Read as "more
  // studying", that sentence is FALSE, not merely vague.
  it('says retaking the test narrows the range, not studying', () => {
    const text = templateCopy(levelEstimateFinding, NOW).toLowerCase()
    expect(text).toContain('again')
    expect(text).not.toMatch(/as you do more\b/)
  })

  // MUTATION CAUGHT: returning a half-built sentence when evidence is absent.
  // The degradation path must yield the base string, never "puts you at
  // undefined".
  it('falls back to the base sentence with evidence stripped', () => {
    const text = templateCopy({ ...levelEstimateFinding, evidence: [] }, NOW)
    expect(text).not.toContain('undefined')
    expect(text).toContain('around this level')
  })

  // MUTATION CAUGHT: re-adding an independent confidence claim to this
  // branch (e.g. "...so the test is reasonably confident about it"). Per
  // copy.ts's comment on this branch, collapse only means the interval
  // doesn't cross a band edge, not that it's narrow, and confidence is
  // `finding.confidence`'s job (the hedge below), not this sentence's — an
  // independent claim here can be directly contradicted by "Early signal"
  // in the same paragraph once se exceeds about 0.84 (demonstrated by the
  // hedged test below). Also pins the mechanism sentence ("again", not "as
  // you do more") on the collapsed branch's OWN copy: "says retaking the
  // test narrows the range, not studying" above exercises only the spread
  // fixture, so it would not catch this branch's mechanism sentence being
  // dropped. Still covers the original defect too: removing the
  // `low === high` branch renders "the honest range runs from N5 to N5.
  // That range is wide", reachable at the codebase's own definition of a
  // tight estimate (SE_TIGHT = 0.3 in detectors/orient.ts), not a
  // hypothetical: see levelEstimateFindingCollapsed above.
  it('does not call the range wide when it collapses to one band', () => {
    const text = templateCopy(levelEstimateFindingCollapsed, NOW)
    expect(text).not.toContain('That range is wide')
    expect(text).not.toContain('N5 to N5')
    expect(text).not.toContain('confident')
    expect(text).toContain('stays entirely within N5')
    expect(text).toContain('again')
  })

  // MUTATION CAUGHT: a confidence claim reappearing in copy that the hedge
  // simultaneously undercuts. copy.ts trusts `finding.confidence` as given
  // rather than deriving it from the evidence shown, so a collapsed
  // interval can still be a weak signal: theta = -3.0, se = 0.9 still
  // collapses to N5 (both ends stay below the N5/N4 boundary) but gives
  // confidence = 1 - normaliseLinear(0.9, 0.3, 1.2) = 0.33, below
  // HEDGE_BELOW. If the collapsed branch asserted confidence on top of
  // that, "Early signal, so take it lightly" and "...confident about it"
  // would sit in the same paragraph.
  it('hedges instead of asserting confidence when the collapsed signal is weak', () => {
    const text = templateCopy({ ...levelEstimateFindingCollapsed, confidence: 0.33 }, NOW)
    expect(text).toContain('Early signal')
    expect(text).not.toContain('confident')
  })
})

describe('templateCopy — mechanics_explainer', () => {
  // MUTATION CAUGHT: leaving the Profile pointer in. Re-verified 2026-08-03:
  // Profile has a Placement Test row (profile.tsx:729) and NO IRT section.
  // That string is live in production sending learners to a dead end, on the
  // one finding whose entire purpose is building trust.
  it('no longer points at a Profile page that does not exist', () => {
    const text = templateCopy(mechanicsFinding, NOW)
    expect(text).not.toContain('Profile')
    expect(text).toContain('IRT')
  })
})
