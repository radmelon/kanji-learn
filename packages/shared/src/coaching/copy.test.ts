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
// formatter trusts that order rather than re-sorting. Characters and counts
// match the spec's own §6 worked example (敗×4, 語×3, 使×2).
// KANJI_GIVING_TROUBLE (3) equals the number named (3) here — see
// leechFinding23 below for the case where the display cap actually hides
// something.
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

// Finding 1 (CRITICAL), verified against live data: a learner with 23
// troubled kanji but only MAX_NAMED (3) ever named in evidence.
// KANJI_GIVING_TROUBLE (23) must win over named.length (3) — the old copy
// read named.length and rendered "Three kanji", understating an account with
// 23 by a factor of eight.
const leechFinding23: Finding = {
  ...leechFinding,
  evidence: [
    { label: EVIDENCE_LABELS.KANJI_GIVING_TROUBLE, value: 23 },
    ...leechFinding.evidence.slice(1),
  ],
}

// A learner with exactly TWO troubled kanji: KANJI_GIVING_TROUBLE equals the
// number named, exercising the "equals, and more than one" branch distinctly
// from the three-named case above.
const leechFindingTwoNamed: Finding = {
  kind: 'leech',
  magnitude: 0.4,
  confidence: 1,
  evidence: [
    { label: EVIDENCE_LABELS.KANJI_GIVING_TROUBLE, value: 2 },
    { label: EVIDENCE_LABELS.ACTIVE_KANJI, value: 120 },
    { label: EVIDENCE_LABELS.LAPSES, value: 4, kanjiId: 1, character: '敗' },
    { label: EVIDENCE_LABELS.LAPSES, value: 3, kanjiId: 2, character: '語' },
  ],
  since: null,
}

// A learner with exactly ONE troubled kanji: KANJI_GIVING_TROUBLE is 1,
// matching named.length, exactly as detectLeech would emit it for a single
// troubled card. (This replaces an earlier version of this fixture built by
// slicing leechFinding down to one LAPSES item while leaving
// KANJI_GIVING_TROUBLE at 3 — internally inconsistent, and invisible only
// because the old formatter never read the count.)
const leechFindingOneNamed: Finding = {
  kind: 'leech',
  magnitude: 0.3,
  confidence: 1,
  evidence: [
    { label: EVIDENCE_LABELS.KANJI_GIVING_TROUBLE, value: 1 },
    { label: EVIDENCE_LABELS.ACTIVE_KANJI, value: 120 },
    { label: EVIDENCE_LABELS.LAPSES, value: 4, kanjiId: 1, character: '敗' },
  ],
  since: null,
}

// Finding 1 (Important): the true troubled count can exceed 1 while only ONE
// kanji survives to be named — distinct from leechFindingOneNamed above,
// where KANJI_GIVING_TROUBLE genuinely IS 1. Here it is 3, and the other two
// candidates the detector would have supplied are dropped by copy.ts's own
// filtering: one has a blanked character (fillCharacters's `?? ''` fallback,
// coaching.service.ts:444, when a kanji id has no matching row) and one has
// zero lapses (a regression-only card, same mechanism as
// leechFindingZeroLapseCard below). 使 is the sole survivor of three actually
// troubled kanji.
const leechFindingOneNamedOfThree: Finding = {
  kind: 'leech',
  magnitude: 0.3,
  confidence: 1,
  evidence: [
    { label: EVIDENCE_LABELS.KANJI_GIVING_TROUBLE, value: 3 },
    { label: EVIDENCE_LABELS.ACTIVE_KANJI, value: 120 },
    { label: EVIDENCE_LABELS.LAPSES, value: 5, kanjiId: 11, character: '' },
    { label: EVIDENCE_LABELS.LAPSES, value: 0, kanjiId: 9, character: '規' },
    { label: EVIDENCE_LABELS.LAPSES, value: 2, kanjiId: 3, character: '使' },
  ],
  since: null,
}

// Finding 2's own case: MIN_TROUBLE_SCORE = 1 in the leech detector, so a
// SINGLE lapse already qualifies a kanji as trouble — 19 of 23 troubled cards
// on the largest live account have exactly one lapse. Exists to prove the
// sentence reads cleanly at count = 1 now that it no longer claims
// repetition ("no matter how often it comes round") beside "has lapsed
// once".
const leechFindingSingleLapse: Finding = {
  kind: 'leech',
  magnitude: 0.1,
  confidence: 1,
  evidence: [
    { label: EVIDENCE_LABELS.KANJI_GIVING_TROUBLE, value: 1 },
    { label: EVIDENCE_LABELS.ACTIVE_KANJI, value: 120 },
    { label: EVIDENCE_LABELS.LAPSES, value: 1, kanjiId: 5, character: '習' },
  ],
  since: null,
}

// Finding 5: a card that qualifies as troubled PURELY on regressions has
// lapses: 0 (troubleScore = lapses + regressions). 規 is listed first
// (mirroring a card whose regressions push its troubleScore above 語's and
// 使's) but must be filtered out of the named list rather than rendering
// "has lapsed 0 times" — the worst NAMED kanji becomes 語 once 規 is
// excluded.
const leechFindingZeroLapseCard: Finding = {
  kind: 'leech',
  magnitude: 0.4,
  confidence: 1,
  evidence: [
    { label: EVIDENCE_LABELS.KANJI_GIVING_TROUBLE, value: 3 },
    { label: EVIDENCE_LABELS.ACTIVE_KANJI, value: 120 },
    { label: EVIDENCE_LABELS.LAPSES, value: 0, kanjiId: 9, character: '規' },
    { label: EVIDENCE_LABELS.LAPSES, value: 3, kanjiId: 2, character: '語' },
    { label: EVIDENCE_LABELS.LAPSES, value: 2, kanjiId: 3, character: '使' },
  ],
  since: null,
}

// Finding 2 (Minor): an over-cap count that still falls inside spell()'s 0-5
// table. 4 is one more than the 3 named — mirrors leechFinding's own shape
// with KANJI_GIVING_TROUBLE raised from 3 to 4, so the over-cap branch fires
// with a count small enough for the numeral-vs-spelled-word distinction to
// actually be visible in the rendered text (leechFinding23's 23 renders
// identically either way, which is why it can't pin this).
const leechFindingSmallOverCap: Finding = {
  ...leechFinding,
  evidence: [
    { label: EVIDENCE_LABELS.KANJI_GIVING_TROUBLE, value: 4 },
    ...leechFinding.evidence.slice(1),
  ],
}

// The degradation path: KANJI_GIVING_TROUBLE absent entirely (an older
// caller, or a stripped fixture). Must fall back to named.length rather than
// throwing or rendering "NaN".
const leechFindingNoCountEvidence: Finding = {
  ...leechFinding,
  evidence: leechFinding.evidence.filter((e) => e.label !== EVIDENCE_LABELS.KANJI_GIVING_TROUBLE),
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

// Finding 3's worked case, reproduced exactly: placement's OWN numbers show
// reading AHEAD of meaning (85% vs 77% — no real placement lag) while quiz
// shows a genuine lag (55% vs 90%) over a far larger n (200 vs 13). Both
// shapes present at once, as a real finding can carry — quiz must win
// because it has more answers behind it.
const readingLagMixedQuizWinsFinding: Finding = {
  kind: 'reading_lag',
  magnitude: 0.5,
  confidence: 1,
  evidence: [
    { label: EVIDENCE_LABELS.MEANING_ACCURACY, value: 0.77 },
    { label: EVIDENCE_LABELS.READING_ACCURACY, value: 0.85 },
    { label: EVIDENCE_LABELS.EXPECTED_READING_PENALTY, value: -0.033 },
    { label: EVIDENCE_LABELS.ITEMS_WITH_READING_ASKED, value: 13 },
    { label: EVIDENCE_LABELS.QUIZ_READING_ACCURACY, value: 0.55 },
    { label: EVIDENCE_LABELS.QUIZ_MEANING_ACCURACY, value: 0.9 },
    { label: EVIDENCE_LABELS.QUIZ_READING_ANSWERS, value: 200 },
  ],
  since: null,
}

// The same shape, but placement now carries the LARGER count (24 vs 10), so
// it is the chosen source — and placement's own numbers still show reading
// ahead of meaning. This is the reviewer's "flatly false" case: the weighted
// blend clears the floor (quiz strength drags it there) but the chosen
// source's own numbers say the opposite of what the sentence would claim.
const readingLagChosenSourceContradictsFinding: Finding = {
  kind: 'reading_lag',
  magnitude: 0.5,
  confidence: 1,
  evidence: [
    { label: EVIDENCE_LABELS.MEANING_ACCURACY, value: 0.77 },
    { label: EVIDENCE_LABELS.READING_ACCURACY, value: 0.85 },
    { label: EVIDENCE_LABELS.EXPECTED_READING_PENALTY, value: -0.033 },
    { label: EVIDENCE_LABELS.ITEMS_WITH_READING_ASKED, value: 24 },
    { label: EVIDENCE_LABELS.QUIZ_READING_ACCURACY, value: 0.55 },
    { label: EVIDENCE_LABELS.QUIZ_MEANING_ACCURACY, value: 0.9 },
    { label: EVIDENCE_LABELS.QUIZ_READING_ANSWERS, value: 10 },
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

  // MUTATION CAUGHT: naming the kanji but not which to start with, or not
  // saying what to do about them. The finding is Direct — its purpose is
  // changing behaviour, and a list without a priority and an action is an
  // observation.
  it('names one kanji to start with, and explains what a hook is', () => {
    const text = templateCopy(leechFinding, NOW)
    expect(text).toContain('The one to work on first is 敗')
    expect(text).toContain('hook')
    expect(text.toLowerCase()).toContain('already know')
  })

  // Finding 1 (CRITICAL): the opener must state the learner's TRUE trouble
  // count, not how many the display cap (MAX_NAMED = 3) let us name.
  //
  // MUTATION CAUGHT: deriving the count from named.length (the display cap)
  // instead of reading KANJI_GIVING_TROUBLE. Verified against live data: one
  // account has 23 troubled kanji and the old copy rendered "Three kanji
  // keep slipping back", understating by a factor of eight; another with 8
  // troubled also rendered "Three". False for every real learner on live
  // whose trouble count exceeds 3.
  it('reads the true trouble count from evidence, not the display cap', () => {
    const text = templateCopy(leechFinding23, NOW)
    expect(text).toContain('23')
    expect(text).not.toContain('Three kanji')
  })

  // MUTATION CAUGHT: dropping the em dash before the list in the over-cap
  // branch (a space in its place), which runs the lead-in directly into the
  // list's own subject-verb clause instead of introducing it as a complete
  // phrase.
  it('pins the over-cap branch wording with an em dash before the list', () => {
    const text = templateCopy(leechFinding23, NOW)
    expect(text).toContain('23 kanji are giving you trouble, and here are three of them — 敗 has lapsed')
  })

  // MUTATION CAUGHT: a specific guard to catch reverting the lead-in to put
  // "are" directly in front of the list — "...and here are 敗 has lapsed 4
  // times" is ungrammatical; "are" must be followed by "N of them", not by
  // the list's own subject-verb clause.
  it('does not render "are" followed by the list with its own verb', () => {
    const text = templateCopy(leechFinding23, NOW)
    expect(text).not.toContain('are 敗 has lapsed')
  })

  // Finding 1 (Important): the true count can exceed 1 while only one kanji
  // survives to be named — leechFindingOneNamedOfThree has
  // KANJI_GIVING_TROUBLE: 3 but only 使 survives copy.ts's own filtering. The
  // old code branched on `rest.length === 0` (equivalently `named.length ===
  // 1`), so this rendered "One kanji is giving you trouble", reporting the
  // size of the display list as the size of the learner's problem — the same
  // class of understatement the Critical fix (above) closed, surviving in
  // the one branch that never read KANJI_GIVING_TROUBLE. It must instead use
  // the over-cap shape, naming the one survivor as one of three.
  //
  // MUTATION CAUGHT: branching on how many kanji were named (`named.length
  // === 1` / `rest.length === 0`) rather than on how many are troubled
  // (`count === 1`).
  it('uses the over-cap shape, not the single-kanji sentence, when the true count exceeds one but only one kanji is named', () => {
    const text = templateCopy(leechFindingOneNamedOfThree, NOW)
    expect(text).toContain('Three kanji are giving you trouble')
    expect(text).not.toContain('One kanji is giving you trouble')
    expect(text).toContain('here is one of them — 使 has lapsed twice')
    expect(text).toContain('The one to work on first is 使')
  })

  // Finding 2 (Minor): the over-cap branch must spell a small count the same
  // way the equals branch does, not render a bare numeral — leechFinding23's
  // 23 renders identically either way (spell()'s fallback for values above
  // five is `String(n)`), so it cannot catch this on its own.
  //
  // MUTATION CAUGHT: reverting the over-cap branch's count back to a bare
  // `${count}`, which renders "4 kanji are giving you trouble" instead of
  // "Four kanji are giving you trouble" — correct one branch over, in the
  // equals-branch rendering of the same count.
  it('spells a small over-cap count the same way as the equals branch', () => {
    const text = templateCopy(leechFindingSmallOverCap, NOW)
    expect(text).toContain('Four kanji are giving you trouble')
    expect(text).not.toContain('4 kanji are giving you trouble')
  })

  // Finding 2 (Important): dropping the repetition claim entirely means it
  // must never reappear in any evidence-bearing render, across every
  // named-count shape (three, two, one, and a single lapse).
  //
  // MUTATION CAUGHT: reintroducing 'no matter how often it/they come round'.
  // MIN_TROUBLE_SCORE = 1 in the leech detector, so a single lapse already
  // qualifies a kanji as trouble; 19 of 23 troubled cards on the largest live
  // account have exactly one lapse, which the old copy's repetition claim
  // directly contradicted.
  it('never claims repetition the detector does not require', () => {
    const renders = [
      templateCopy(leechFinding, NOW),
      templateCopy(leechFindingTwoNamed, NOW),
      templateCopy(leechFindingOneNamed, NOW),
      templateCopy(leechFindingSingleLapse, NOW),
    ]
    for (const text of renders) {
      expect(text).not.toContain('no matter how often')
    }
  })

  // MUTATION CAUGHT: assuming exactly MAX_NAMED kanji when building the list
  // — the detector emits BETWEEN ONE AND THREE, and indexing named[1] blindly
  // renders "undefined has lapsed undefined times" for a single-leech
  // learner.
  //
  // MUTATION CAUGHT: reusing the multi-kanji branch for a single kanji, which
  // tells the learner to prioritise among one thing ('The one to work on
  // first is 敗' when 敗 is the only kanji named).
  it('reads correctly with only one named kanji', () => {
    const text = templateCopy(leechFindingOneNamed, NOW)
    expect(text).not.toContain('undefined')
    expect(text).toContain('One kanji is giving you trouble')
    expect(text).toContain('敗')
    expect(text).not.toContain('The one to work on first')
  })

  // Finding 2's edge case: a single lapse is enough to qualify
  // (MIN_TROUBLE_SCORE = 1), and the sentence must read cleanly at that count
  // now that it no longer asserts repetition alongside it.
  //
  // MUTATION CAUGHT: dropping the `n === 1` branch from lapseCount, which
  // would render 'has lapsed 1 times' — the exact evidence-adjacent detail
  // the old repetition claim used to paper over.
  it('reads correctly with exactly one lapse', () => {
    const text = templateCopy(leechFindingSingleLapse, NOW)
    expect(text).toContain('has lapsed once')
    expect(text).not.toContain('no matter how often')
  })

  // Finding 5: a card qualifying purely on regressions has lapses: 0
  // (troubleScore = lapses + regressions) and must not be named with "has
  // lapsed 0 times" — nor should it silently become `worst` just because it
  // sorts first in the evidence array.
  //
  // MUTATION CAUGHT: dropping the `e.value > 0` filter clause (reverting to
  // `typeof e.value === 'number'` alone), which both renders "規 has lapsed 0
  // times" and wrongly picks 規 as `worst` instead of 語.
  it('excludes a card whose lapses are zero from the named list', () => {
    const text = templateCopy(leechFindingZeroLapseCard, NOW)
    expect(text).not.toContain('規')
    expect(text).not.toContain('lapsed 0')
    expect(text).toContain('The one to work on first is 語')
  })

  // MUTATION CAUGHT: an off-by-one at the two-item boundary in the list join
  // — correct for one item (handled by an entirely separate branch) and for
  // three (which already takes the Oxford-comma path regardless), but a join
  // that always applies the Oxford comma renders 'times, and' for exactly
  // two items, which neither the one- nor three-kanji tests can see.
  it('joins exactly two kanji with "and" and no comma', () => {
    const text = templateCopy(leechFindingTwoNamed, NOW)
    expect(text).toContain('Two kanji are giving you trouble')
    expect(text).toContain('敗 has lapsed 4 times and 語 3 times')
    expect(text).not.toContain('times, and')
    expect(text).not.toContain('and and')
  })

  // MUTATION CAUGHT: dropping the n === 2 branch from lapseCount, which
  // would render '2 times' for the exact value the design spec calls out by
  // name as 'twice' (worked example: 敗×4, 語×3, 使×2).
  //
  // This fixture's shape — KANJI_GIVING_TROUBLE: 3 with only 使's LAPSES item
  // supplied — is also Finding 1's bug case: the old code would render "One
  // kanji is giving you trouble" here, and this test would still have passed
  // because it only ever asserted on "twice". Reconciled per Finding 1 to
  // assert the count as well, so it cannot pass on a sentence that silently
  // understates it (dedicated coverage for the branching itself lives in
  // 'uses the over-cap shape...' above, with leechFindingOneNamedOfThree).
  it('spells a count of exactly two as "twice", not "2 times"', () => {
    const single = {
      ...leechFinding,
      evidence: [leechFinding.evidence[0], leechFinding.evidence[1], leechFinding.evidence[4]],
    }
    const text = templateCopy(single, NOW)
    expect(text).toContain('twice')
    expect(text).not.toContain('2 times')
    expect(text).toContain('Three kanji are giving you trouble')
    expect(text).not.toContain('One kanji is giving you trouble')
  })

  // The degradation path: an older caller (or a stripped fixture) with no
  // KANJI_GIVING_TROUBLE evidence at all must not crash or render "NaN" — it
  // falls back to "as many as we can name".
  //
  // MUTATION CAUGHT: `Number(undefined)` flowing through unguarded to
  // `count`, rendering "NaN kanji are giving you trouble" instead of
  // degrading to named.length.
  it('falls back to named.length as the count when KANJI_GIVING_TROUBLE is absent', () => {
    const text = templateCopy(leechFindingNoCountEvidence, NOW)
    expect(text).toContain('Three kanji are giving you trouble')
    expect(text).not.toContain('NaN')
  })

  // MUTATION CAUGHT: removing the `named.length === 0` guard, which crashes
  // destructuring `worst` off an empty array instead of degrading to BASE.
  //
  // MUTATION CAUGHT: restoring a repetition claim ('no matter how often') to
  // BASE.leech — the string that renders when there is no evidence to support
  // any claim at all, so a vague sentence is the only kind it can honestly
  // make. Owner-directed fix, 2026-08-03: BASE.leech used to read "A handful
  // of kanji keep slipping back no matter how often they come round", which
  // overstated the detector (MIN_TROUBLE_SCORE = 1 — a single lapse already
  // qualifies) in exactly the same way the formatter's own repetition claim
  // once did.
  it('falls back with evidence stripped', () => {
    const text = templateCopy({ ...leechFinding, evidence: [] }, NOW)
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('no matter how often')
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
  //
  // MUTATION CAUGHT: swapping the explanation and the offer so the offer
  // comes first — the title makes an ORDER claim ("before"), so this pins the
  // order, not just the presence of both pieces.
  it('explains what a hook is before offering to build one', () => {
    const text = templateCopy(hookCoverageFinding, NOW)
    expect(text).toContain('敗')
    expect(text.toLowerCase()).toContain('already know')
    expect(text).toMatch(/hook/i)
    const explanationIndex = text.indexOf('that connection is what we call a hook')
    const offerIndex = text.indexOf('Would you like to build one')
    expect(explanationIndex).toBeGreaterThan(-1)
    expect(offerIndex).toBeGreaterThan(-1)
    expect(explanationIndex).toBeLessThan(offerIndex)
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
    expect(text).toContain('across 24 answers')
  })

  // Finding 4: QUIZ_READING_ANSWERS counts reading rows only — the meaning
  // percentage comes from a separate, larger set of rows — so "across 40
  // answers" would imply both numbers came from the same 40 asked items,
  // which is false for this shape (true only for placement, where both
  // accuracies are measured over the same asked set).
  //
  // MUTATION CAUGHT: rendering "across 40 answers" for the quiz shape instead
  // of "across 40 reading answers".
  it('builds the sentence from quiz-shaped evidence', () => {
    const text = templateCopy(readingLagQuizFinding, NOW)
    expect(text).toContain('71%')
    expect(text).toContain('90%')
    expect(text).toContain('across 40 reading answers')
  })

  // Finding 3, part 1: detectReadingLag blends both sources weighted by
  // observation count, so the source that actually drives a real finding is
  // whichever has more answers behind it — not always placement.
  //
  // MUTATION CAUGHT: always preferring placement (the old `??` chain).
  // Reproduces the reviewer's worked case: a 13-item placement whose OWN
  // numbers show reading AHEAD of meaning (85%/77%) alongside 200 quiz
  // answers showing a genuine lag (55%/90%) — the old code rendered the
  // placement's 85%/77%, backwards from what the finding is actually about.
  it('prefers the source with the larger answer count when both shapes fire', () => {
    const text = templateCopy(readingLagMixedQuizWinsFinding, NOW)
    expect(text).toContain('55%')
    expect(text).toContain('90%')
    expect(text).toContain('200')
    expect(text).not.toContain('85%')
    expect(text).not.toContain('77%')
  })

  // Finding 3, part 2: POPULATION_PLACEMENT_READING_GAP is negative, so a
  // placement excess can be negative while the weighted blend still clears
  // the floor on quiz strength. A sentence claiming readings trail must not
  // render when the CHOSEN source's own numbers disagree — it must fall back
  // to exactly the same BASE text an evidence-stripped finding would get.
  //
  // MUTATION CAUGHT: removing the `chosen.reading >= chosen.meaning` guard,
  // which would render "your readings are trailing your meanings, 85%
  // against 77%" — readings are AHEAD at 85%, flatly false — instead of
  // falling back to BASE.
  it('falls back to BASE when the chosen source contradicts the claim', () => {
    const fallback = templateCopy({ ...readingLagChosenSourceContradictsFinding, evidence: [] }, NOW)
    const text = templateCopy(readingLagChosenSourceContradictsFinding, NOW)
    expect(text).toBe(fallback)
    expect(text).not.toContain('85%')
    expect(text).not.toContain('77%')
  })

  // MUTATION CAUGHT: removing the `!placement && !quiz` guard, which leaves
  // `chosen` undefined and throws reading `chosen.reading` instead of
  // degrading to BASE.
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
