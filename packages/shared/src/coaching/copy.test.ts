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

// Mirrors what detectLeech (detectors/leech.ts) actually emits: two summary
// items (KANJI_GIVING_TROUBLE, ACTIVE_KANJI) followed by up to MAX_NAMED (3)
// per-kanji LAPSES items, worst-first — `worst` is sorted by
// (lapses + regressions) descending, ties broken by kanjiId, and the
// formatter trusts that order rather than re-sorting. Slicing this array's
// first three entries (as the "one named kanji" test below does) therefore
// yields exactly one LAPSES item, matching what the detector itself emits
// for a learner with only one troubled kanji. Characters and counts match
// the spec's own §6 worked example (敗×4, 語×3, 使×2).
const leechFinding: Finding = {
  kind: 'leech',
  magnitude: 0.5,
  confidence: 1,
  evidence: [
    { label: EVIDENCE_LABELS.KANJI_GIVING_TROUBLE, value: 3 },
    { label: EVIDENCE_LABELS.ACTIVE_KANJI, value: 120 },
    { label: EVIDENCE_LABELS.LAPSES, value: 4, kanjiId: 1, character: '敗' },
    { label: EVIDENCE_LABELS.LAPSES, value: 3, kanjiId: 2, character: '語' },
    { label: EVIDENCE_LABELS.LAPSES, value: 2, kanjiId: 3, character: '使' },
  ],
  since: null,
}

// Mirrors detectHookCoverage: HOOKS_BUILT, then SUGGESTED_KANJI (the pick
// from pickHookCandidate), then — only when both sides of the lapses
// comparison exist — the two AVG_LAPSES_* items. All four included so the
// fixture matches the full real shape, even though the formatter reads only
// SUGGESTED_KANJI.
const hookCoverageFinding: Finding = {
  kind: 'hook_coverage',
  magnitude: 1,
  confidence: 1,
  evidence: [
    { label: EVIDENCE_LABELS.HOOKS_BUILT, value: 0 },
    { label: EVIDENCE_LABELS.SUGGESTED_KANJI, value: '敗', kanjiId: 1, character: '敗' },
    { label: EVIDENCE_LABELS.AVG_LAPSES_WITH_HOOK, value: 1.2 },
    { label: EVIDENCE_LABELS.AVG_LAPSES_WITHOUT_HOOK, value: 3.4 },
  ],
  since: null,
}

// Mirrors detectCommitmentGap: promised/studied minutes plus the period
// bounds, emitted exactly as CommitmentSnapshot stores them — PERIOD_END is
// EXCLUSIVE (commitment.service.ts:253), so 2026-07-20..2026-07-27 covers the
// 20th to the 26th. The -1-day adjustment is humanDateRange's job, not the
// detector's or the fixture's. confidence is always exactly 1 for this kind
// per the detector's own comment: "A promise and a measurement. There is
// nothing to be uncertain about."
const commitmentGapFinding: Finding = {
  kind: 'commitment_gap',
  magnitude: 0.7,
  confidence: 1,
  evidence: [
    { label: EVIDENCE_LABELS.MINUTES_PROMISED, value: 60 },
    { label: EVIDENCE_LABELS.MINUTES_STUDIED, value: 20 },
    { label: EVIDENCE_LABELS.PERIOD_START, value: '2026-07-20' },
    { label: EVIDENCE_LABELS.PERIOD_END, value: '2026-07-27' },
  ],
  since: null,
}

// Mirrors detectReadingLag's PLACEMENT branch (placementExcess fires):
// MEANING_ACCURACY, READING_ACCURACY, EXPECTED_READING_PENALTY,
// ITEMS_WITH_READING_ASKED. Values are proportions rounded to 2dp by the
// detector's own round2 — copy.ts's pct() converts them to whole percent.
const readingLagPlacementFinding: Finding = {
  kind: 'reading_lag',
  magnitude: 0.5,
  confidence: 1,
  evidence: [
    { label: EVIDENCE_LABELS.MEANING_ACCURACY, value: 0.88 },
    { label: EVIDENCE_LABELS.READING_ACCURACY, value: 0.62 },
    { label: EVIDENCE_LABELS.EXPECTED_READING_PENALTY, value: -0.033 },
    { label: EVIDENCE_LABELS.ITEMS_WITH_READING_ASKED, value: 24 },
  ],
  since: null,
}

// Mirrors detectReadingLag's QUIZ branch (quizExcess fires): QUIZ_READING_
// ACCURACY, QUIZ_MEANING_ACCURACY, QUIZ_READING_ANSWERS. A real finding can
// carry both shapes at once, but this fixture isolates the quiz shape alone
// so the formatter can't be silently depending on the placement labels also
// being present.
const readingLagQuizFinding: Finding = {
  kind: 'reading_lag',
  magnitude: 0.4,
  confidence: 1,
  evidence: [
    { label: EVIDENCE_LABELS.QUIZ_READING_ACCURACY, value: 0.71 },
    { label: EVIDENCE_LABELS.QUIZ_MEANING_ACCURACY, value: 0.9 },
    { label: EVIDENCE_LABELS.QUIZ_READING_ANSWERS, value: 40 },
  ],
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

describe('templateCopy — leech', () => {
  // MUTATION CAUGHT: "a handful of kanji keep slipping back" — the exact
  // sentence the owner read, whose first question was "which ones?". The
  // evidence names them, with lapse counts, and the old copy ignored it.
  it('names each kanji and its lapse count', () => {
    const text = templateCopy(leechFinding, NOW)
    expect(text).toContain('敗')
    expect(text).toContain('語')
    expect(text).toContain('4 times')
  })

  // MUTATION CAUGHT: repeating the verb for every item ('語 has lapsed 3
  // times'), which reads like a database dump rather than a sentence. The
  // design spec elides it after the first item: '敗 has lapsed 4 times, 語 3
  // times, and 使 twice'.
  it('elides the repeated verb after the first item in a three-kanji list', () => {
    const text = templateCopy(leechFinding, NOW)
    expect(text).toContain('語 3 times')
    expect(text).not.toContain('語 has lapsed')
  })

  // MUTATION CAUGHT: naming the kanji but not what to do about them. The
  // finding is Direct — its purpose is changing behaviour, and a list without
  // an action is an observation.
  it('names one kanji to start with, and explains what a hook is', () => {
    const text = templateCopy(leechFinding, NOW)
    expect(text).toContain('hook')
    expect(text.toLowerCase()).toContain('already know')
  })

  // MUTATION CAUGHT: assuming exactly MAX_NAMED kanji. The detector emits
  // BETWEEN ONE AND THREE, and a formatter that indexes worst[1] blindly
  // renders "undefined has lapsed undefined times" for a single-leech learner.
  //
  // MUTATION CAUGHT: reusing the plural branch for a single kanji, which
  // produces a grammatical error ('they come round' for one kanji) and tells
  // the learner to prioritise among one thing ('The one to work on first is
  // 敗' when 敗 is the only kanji named).
  it('reads correctly with only one named kanji', () => {
    const single = { ...leechFinding, evidence: leechFinding.evidence.slice(0, 3) }
    const text = templateCopy(single, NOW)
    expect(text).not.toContain('undefined')
    expect(text).toContain('敗')
    expect(text).toContain('it comes round')
    expect(text).not.toContain('they come round')
    expect(text).not.toContain('The one to work on first')
  })

  // MUTATION CAUGHT: an off-by-one at the two-item boundary in the list join
  // — correct for one item (handled by an entirely separate branch) and for
  // three (which already takes the Oxford-comma path regardless), but a join
  // that always applies the Oxford comma renders 'times, and' for exactly
  // two items, which neither the one- nor three-kanji tests can see.
  it('joins exactly two kanji with "and" and no comma', () => {
    const twoNamed = { ...leechFinding, evidence: leechFinding.evidence.slice(0, 4) }
    const text = templateCopy(twoNamed, NOW)
    expect(text).toContain('敗 has lapsed 4 times and 語 3 times')
    expect(text).not.toContain('times, and')
    expect(text).not.toContain('and and')
  })

  // MUTATION CAUGHT: dropping the n === 2 branch from lapseCount, which
  // would render '2 times' for the exact value the design spec calls out by
  // name as 'twice' (worked example: 敗×4, 語×3, 使×2).
  it('spells a count of exactly two as "twice", not "2 times"', () => {
    const single = {
      ...leechFinding,
      evidence: [leechFinding.evidence[0], leechFinding.evidence[1], leechFinding.evidence[4]],
    }
    const text = templateCopy(single, NOW)
    expect(text).toContain('twice')
    expect(text).not.toContain('2 times')
  })

  it('falls back with evidence stripped', () => {
    expect(templateCopy({ ...leechFinding, evidence: [] }, NOW)).not.toContain('undefined')
  })
})

describe('templateCopy — commitment_gap', () => {
  // MUTATION CAUGHT: rendering periodEnd raw. The period 2026-07-20 to
  // 2026-07-27 EXCLUSIVE covers the 20th to the 26th; "between 20 and 27 July"
  // tells the learner they were measured on a day they were not.
  it('renders the period inclusively', () => {
    const text = templateCopy(commitmentGapFinding, NOW)
    expect(text).toContain('between 20 and 26 July')
    expect(text).not.toContain('27 July')
  })

  // MUTATION CAUGHT: reverting to "we will set something you will actually
  // hit", which assumes the learner over-promised and should promise less.
  // The owner replaced it: offer mechanism, and allow that nothing is wrong.
  it('offers mechanism and allows that the week was simply busy', () => {
    const text = templateCopy(commitmentGapFinding, NOW)
    expect(text).toContain('time of day')
    expect(text).toContain('two short study sessions')
    expect(text.toLowerCase()).toContain('busy week')
  })
})

describe('templateCopy — hook_coverage', () => {
  // MUTATION CAUGHT: telling a learner to build a hook without saying what one
  // is. Instruction without explanation cannot be acted on, which reproduces
  // the original defect in a new place.
  it('explains what a hook is before offering to build one', () => {
    const text = templateCopy(hookCoverageFinding, NOW)
    expect(text).toContain('敗')
    expect(text.toLowerCase()).toContain('already know')
    expect(text).toMatch(/hook/i)
  })
})

describe('templateCopy — reading_lag', () => {
  // MUTATION CAUGHT: handling only one evidence shape. reading_lag fires from
  // EITHER placement or quiz and emits different labels for each; a formatter
  // that knows one shape degrades silently half the time, and the degradation
  // is invisible because it still returns a real sentence.
  it('builds the sentence from placement-shaped evidence', () => {
    const text = templateCopy(readingLagPlacementFinding, NOW)
    expect(text).toContain('62%')
    expect(text).toContain('88%')
    expect(text).toContain('24')
  })

  it('builds the sentence from quiz-shaped evidence', () => {
    const text = templateCopy(readingLagQuizFinding, NOW)
    expect(text).toContain('71%')
    expect(text).toContain('90%')
  })

  it('falls back with evidence stripped', () => {
    expect(templateCopy({ ...readingLagQuizFinding, evidence: [] }, NOW))
      .not.toContain('undefined')
  })
})

describe('leech and hook_coverage together', () => {
  // MUTATION CAUGHT: nothing, deliberately — this is the spec's §6.1 decision
  // under observation. Both are Direct, both can be selected, and both explain
  // hooks. The redundancy was accepted rather than engineered away; this test
  // exists so a human reads the combined output at least once.
  it('reads as emphasis rather than repetition', () => {
    const both = analysisBody([leechFinding, hookCoverageFinding], NOW)
    expect(both).not.toContain('undefined')
    // The full definition appears once; leech carries only the short form.
    expect(both.match(/memory holds on to the familiar/g) ?? []).toHaveLength(1)
  })
})
