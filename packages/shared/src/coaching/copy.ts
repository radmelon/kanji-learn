import type { Finding, FindingKind, Evidence } from './types'
import { EVIDENCE_LABELS } from './types'

/**
 * The offline floor (spec §1).
 *
 * "Every finding kind ships with template copy. Non-negotiable: Phase 7's
 * entire HIGH-defect wave was the template floor failing to complete."
 *
 * Offline, or with the LLM down, Buddy still says the true thing — just less
 * warmly. This lives in slice 1 rather than with the LLM surface precisely so
 * it cannot be the thing that gets cut when a later slice runs long.
 *
 * NOTE: these are FRAMES, not final voice. The LLM's job is to say the same
 * true thing warmly; its input is the Finding, never a row (§1).
 */

const BASE: Record<FindingKind, string> = {
  reading_lag:
    'Your readings are trailing your meanings by more than the usual gap.',
  leech:
    'A handful of kanji keep slipping back no matter how often they come round.',
  commitment_gap:
    'You studied less than you promised yourself over the last period.',
  hook_coverage:
    'Building a hook for a kanji you keep missing tends to make it stick. Want to make one together?',
  level_estimate:
    'Your placement puts you around this level, with some room either side.',
  // §3: template, always, never LLM. Buddy must not improvise about his own
  // algorithm, so this string is the whole finding.
  mechanics_explainer:
    'Your level comes from a statistical technique called Item Response Theory, or IRT. The test gets harder when you answer well and easier when you do not, which is how it can say something useful about your level in about a dozen questions.',
  fluency_gain:
    'You are answering faster than you were, without losing accuracy.',
  theta_delta:
    'Your ability estimate has moved up since your last placement.',
  hardest_cleared:
    'You cleared the hardest kanji the test put in front of you.',
  retest_due:
    'Your placement estimate has drifted since it was taken. Repeating the test now would sharpen it — the value of the test goes up when it is repeated.',
}

/** Below this, say it as a suspicion rather than a fact (§2). */
const HEDGE_BELOW = 0.4
/** Above this many days as a live finding, name the persistence (§4). */
const ESCALATE_AFTER_DAYS = 21

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

/**
 * '2026-07-29' or a full ISO timestamp -> '29 July'.
 *
 * Deliberately NOT toLocaleDateString: the analyzer is pure by contract, and a
 * locale- or timezone-dependent sentence would differ between CI and a
 * developer's machine. Parses the date part textually for the same reason —
 * `new Date('2026-07-29')` is UTC midnight and shifts a day west of Greenwich.
 */
export function humanDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso.slice(0, 10)
  return `${d} ${MONTHS[m - 1]}`
}

/**
 * A commitment period, rendered inclusively.
 *
 * ⚠️ `endExclusive` is exactly that. getLastCompletedPeriod computes
 * `periodEnd = addDays(weekStart, periodDays)` (commitment.service.ts:253), so
 * a period starting 20 July has periodEnd 27 July and COVERS 20–26. Rendering
 * the raw value tells the learner about a day they were never measured on.
 */
export function humanDateRange(startIso: string, endExclusiveIso: string): string {
  const start = startIso.slice(0, 10)
  const end = addDaysIso(endExclusiveIso.slice(0, 10), -1)
  const [, startMonth] = start.split('-').map(Number)
  const [, endMonth] = end.split('-').map(Number)
  const startDay = Number(start.split('-')[2])
  return startMonth === endMonth
    ? `${startDay} and ${humanDate(end)}`
    : `${humanDate(start)} and ${humanDate(end)}`
}

/** Calendar-safe ISO date shift, without Date's timezone behaviour. */
function addDaysIso(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00.000Z`) + days * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

/** First evidence value for a label, or undefined. */
function ev(f: Finding, label: string): string | number | undefined {
  return f.evidence.find((e) => e.label === label)?.value
}

/** Every evidence item carrying a label — `leech` emits up to three `lapses`. */
function evAll(f: Finding, label: string): Evidence[] {
  return f.evidence.filter((e) => e.label === label)
}

/** 0.62 -> '62%'. Evidence accuracies are proportions, per the detectors. */
function pct(v: string | number): string {
  return `${Math.round(Number(v) * 100)}%`
}

/**
 * Small counts read better as words in prose: 'three readings', 'Two kanji'.
 * Always lowercase — capitalise at the call site when it starts a sentence, so
 * there is one spelling table rather than a cased and an uncased copy of it.
 */
function spell(n: number): string {
  return ['zero', 'one', 'two', 'three', 'four', 'five'][n] ?? String(n)
}

/** 1 -> 'once', 2 -> 'twice', otherwise 'N times'. */
function lapseCount(n: number): string {
  if (n === 1) return 'once'
  if (n === 2) return 'twice'
  return `${n} times`
}

/** 'two' -> 'Two'. Only for a word that opens a sentence. */
function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

type Formatter = (f: Finding) => string | null

/**
 * One `reading_lag` evidence shape, normalised so both sources compare alike
 * once one is chosen. `unit` differs between them on purpose: placement's
 * count covers the SAME asked set both accuracies are measured over, while
 * the quiz count is reading-answers only — see the formatter's own comment.
 */
interface ReadingLagSource {
  reading: string | number
  meaning: string | number
  count: number
  unit: 'answers' | 'reading answers'
}

/**
 * Per-kind copy. A formatter returns `null` when its evidence is absent, and
 * `templateCopy` substitutes BASE[kind] — never a half-built sentence.
 *
 * Tasks 5 and 6 fill the remaining eight.
 */
const FORMATTERS: Record<FindingKind, Formatter> = {
  level_estimate: (f) => {
    const level = ev(f, EVIDENCE_LABELS.MOST_LIKELY_LEVEL)
    const low = ev(f, EVIDENCE_LABELS.LOWER_BOUND)
    const high = ev(f, EVIDENCE_LABELS.UPPER_BOUND)
    const on = ev(f, EVIDENCE_LABELS.MEASURED_ON)
    if (level === undefined || low === undefined || high === undefined || on === undefined) return null
    const date = humanDate(String(on))
    // Collapse only means the interval doesn't cross a band edge — the
    // outer bands are unbounded (live corpus midpoints run roughly -1.454 /
    // -0.149 / 1.241 / 3.112), so a collapsed interval can still be wider
    // than a bounded band: theta = -3.0, se = 0.55 collapses to N5 but is
    // 1.41 logits wide, more than N4's own 1.31. Don't call that "narrow".
    // Don't assert confidence here either — `finding.confidence` (the hedge
    // below) already owns that claim, and once se exceeds about 0.84 at
    // theta = -3.0 the estimate still collapses to N5 while confidence
    // drops below HEDGE_BELOW, so an independent confidence claim in this
    // sentence would be contradicted by "Early signal" in the same
    // paragraph. State only what's true by construction: the whole interval
    // stays inside one level.
    //
    // Interpolates `low`, not `level`: `level` is the stored
    // placementSessions.inferredLevel from when the test was taken; `low`
    // and `high` are recomputed here from today's corpus. A recalibration
    // between those two moments can leave them disagreeing, the same class
    // of band/ladder mismatch coaching.service.ts already carries a scar
    // comment about (B146). Interpolating `low` keeps the containment claim
    // true by construction instead of asserting it about a band the
    // interval may no longer be in.
    if (low === high) {
      return `Your placement test on ${date} puts you at ${level}. The honest range around that estimate stays entirely within ${low}, rather than reaching into a neighbouring level. Your level estimate is only recalculated when you take the placement test again, rather than from day-to-day studying.`
    }
    return `Your placement test on ${date} puts you at ${level}, and the honest range runs from ${low} to ${high}. That range is wide because a placement test only asks about a dozen questions. It narrows when you take the placement test again, rather than from day-to-day studying, because your level estimate is only recalculated when you sit the test.`
  },

  // Fixed copy by contract (§3): no evidence to read, so no formatter.
  mechanics_explainer: () => null,

  reading_lag: (f) => {
    // Two evidence shapes — placement and quiz. Handle both, or degrade.
    const placementReading = ev(f, EVIDENCE_LABELS.READING_ACCURACY)
    const placementMeaning = ev(f, EVIDENCE_LABELS.MEANING_ACCURACY)
    const placementCount = ev(f, EVIDENCE_LABELS.ITEMS_WITH_READING_ASKED)
    const quizReading = ev(f, EVIDENCE_LABELS.QUIZ_READING_ACCURACY)
    const quizMeaning = ev(f, EVIDENCE_LABELS.QUIZ_MEANING_ACCURACY)
    const quizCount = ev(f, EVIDENCE_LABELS.QUIZ_READING_ANSWERS)

    // Placement's count covers the SAME asked set both accuracies come from,
    // so "across N answers" is true as written. The quiz count is reading
    // answers only — the meaning percentage comes from a different, larger
    // set of rows — so it earns the more specific "reading answers" unit.
    const placement: ReadingLagSource | null =
      placementReading !== undefined && placementMeaning !== undefined && placementCount !== undefined
        ? { reading: placementReading, meaning: placementMeaning, count: Number(placementCount), unit: 'answers' }
        : null
    const quiz: ReadingLagSource | null =
      quizReading !== undefined && quizMeaning !== undefined && quizCount !== undefined
        ? { reading: quizReading, meaning: quizMeaning, count: Number(quizCount), unit: 'reading answers' }
        : null
    if (!placement && !quiz) return null

    // detectReadingLag blends both sources weighted by observation count, so
    // the source actually driving the finding is whichever has more answers
    // behind it — always preferring placement (the old `??` chain) let a
    // ~13-item placement outrank 200 quiz answers that were doing the real
    // work in the detector's own weighted magnitude.
    const chosen = placement && quiz
      ? (placement.count >= quiz.count ? placement : quiz)
      : (placement ?? quiz)!

    // POPULATION_PLACEMENT_READING_GAP is negative, so the placement excess
    // can be negative while the blend still clears the floor on quiz
    // strength (or the reverse) — the CHOSEN source's own numbers can
    // disagree with the sentence the blend would otherwise justify. A
    // sentence claiming readings trail must not render when the numbers it
    // is about to cite say the opposite; fall back to BASE instead.
    if (Number(chosen.reading) >= Number(chosen.meaning)) return null

    return `Your readings are trailing your meanings, ${pct(chosen.reading)} against ${pct(chosen.meaning)} across ${chosen.count} ${chosen.unit}, which is a wider gap than most people have. Next time you study, try saying the reading aloud before you reveal the answer.`
  },

  leech: (f) => {
    // `value > 0` (Finding 5): troubleScore = lapses + regressions, so a card
    // that qualifies purely on regressions has `lapses: 0` and would
    // otherwise render "has lapsed 0 times".
    const named = evAll(f, EVIDENCE_LABELS.LAPSES)
      .filter((e) => e.character && typeof e.value === 'number' && e.value > 0)
    if (named.length === 0) return null
    const [worst, ...rest] = named

    // The learner's TRUE trouble count, not how many we can name — MAX_NAMED
    // caps the detector's evidence at 3, and reading `named.length` renders
    // "Three kanji" for an account with 23 troubled kanji, understating by
    // however many the cap hides. Computed BEFORE every branch below and
    // used by all of them (Finding 1): `named.length` can independently drop
    // to 1 — via the `value > 0` filter above, or a blanked character from
    // fillCharacters's `?? ''` fallback (coaching.service.ts:444) — even
    // while the true count stays far above 1, and the single-kanji branch
    // below must not mistake that coincidence for there being only one
    // troubled kanji. Absent evidence degrades to "as many as we can name"
    // rather than throwing.
    const trueCount = ev(f, EVIDENCE_LABELS.KANJI_GIVING_TROUBLE)
    const count = trueCount === undefined ? named.length : Number(trueCount)

    // Exactly one TRUE troubled kanji gets its own sentence — "The one to
    // work on first" is nonsensical when there is only one. Keyed on `count`,
    // NOT on `named.length` / `rest.length` (Finding 1): a true count above 1
    // with only one survivor falls through to the branches below instead,
    // which name that lone survivor as part of a larger true count.
    if (count === 1) {
      return `One kanji is giving you trouble — ${worst.character}, which has lapsed ${lapseCount(Number(worst.value))}. Look it up and build a hook for it — a small story or image that ties the character to something you already know — because that is what usually stops a kanji from slipping.`
    }

    // First item carries the verb; later items elide it ('語 3 times', not
    // '語 has lapsed 3 times') — repeating it for every item reads like a
    // database dump, not a sentence.
    const items = [
      `${worst.character} has lapsed ${lapseCount(Number(worst.value))}`,
      ...rest.map((e) => `${e.character} ${lapseCount(Number(e.value))}`),
    ]
    // One item: itself, no joiner — reachable when `count` exceeds 1 but
    // only one kanji survived to be named (Finding 1). Two items: 'A and B',
    // no comma. Three or more: Oxford comma before 'and'.
    const list = items.length === 1
      ? items[0]
      : items.length === 2
        ? `${items[0]} and ${items[1]}`
        : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`

    // Finding 2: no "no matter how often" claim — MIN_TROUBLE_SCORE = 1 means
    // a single lapse already qualifies, so a repetition claim can contradict
    // the very count it sits beside. The counts speak for themselves instead.
    if (count > named.length) {
      // Not "the worst" (related finding, same root cause): the detector
      // ranks candidates by lapses + regressions, but `named` above filters
      // on lapses alone, so a higher-troubleScore card can be dropped ahead
      // of a lower-scoring one that survives the filter — the survivors are
      // not guaranteed to be the worst by the detector's own ordering.
      // "The one to work on first" stays: it recommends `worst` (the top
      // survivor) rather than ranking the whole set.
      return `${capitalise(spell(count))} kanji are giving you trouble, and here ${named.length === 1 ? 'is' : 'are'} ${spell(named.length)} of them — ${list}. The one to work on first is ${worst.character}. Look it up and build a hook for it — a small story or image that ties the character to something you already know — because that is what usually stops a kanji from slipping.`
    }

    return `${capitalise(spell(count))} kanji are giving you trouble — ${list}. The one to work on first is ${worst.character}. Look it up and build a hook for it — a small story or image that ties the character to something you already know — because that is what usually stops a kanji from slipping.`
  },

  commitment_gap: (f) => {
    const promised = ev(f, EVIDENCE_LABELS.MINUTES_PROMISED)
    const studied = ev(f, EVIDENCE_LABELS.MINUTES_STUDIED)
    const start = ev(f, EVIDENCE_LABELS.PERIOD_START)
    const end = ev(f, EVIDENCE_LABELS.PERIOD_END)
    if (promised === undefined || studied === undefined) return null
    const when = start !== undefined && end !== undefined
      ? ` between ${humanDateRange(String(start), String(end))}`
      : ''
    return `You promised ${Math.round(Number(promised))} minutes${when} and studied ${Math.round(Number(studied))}. It is worth discussing whether we should try shifting the time of day when you study, or try two short study sessions in a day. Or maybe it was just a busy week.`
  },

  hook_coverage: (f) => {
    const suggested = f.evidence.find((e) => e.label === EVIDENCE_LABELS.SUGGESTED_KANJI)
    if (!suggested?.character) return null
    return `${suggested.character} keeps catching you out. When something new will not stick, it usually helps to connect it to something you already know well: that connection is what we call a hook. It can be a small story, an image, or a resemblance to a word or a thing you are already familiar with, and it works because memory holds on to the familiar far more readily than the unfamiliar. Would you like to build one for ${suggested.character} together?`
  },

  fluency_gain: () => null,
  theta_delta: () => null,
  hardest_cleared: () => null,
  retest_due: () => null,
}

export function templateCopy(finding: Finding, now?: string): string {
  const base = FORMATTERS[finding.kind](finding) ?? BASE[finding.kind]

  // mechanics_explainer is fixed copy by contract — no hedging, no escalation.
  if (finding.kind === 'mechanics_explainer') return base

  let text = base

  if (finding.confidence < HEDGE_BELOW) {
    text = `Early signal, so take it lightly: ${lowerFirst(text)}`
  }

  if (finding.since) {
    const reference = now ? Date.parse(now) : Date.parse(finding.since)
    const days = (reference - Date.parse(finding.since)) / 86_400_000
    if (!now || days >= ESCALATE_AFTER_DAYS) {
      text = `${text} This has been true for a while now — worth trying something different.`
    }
  }

  return text
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

/**
 * The notebook entry body for one analysis.
 *
 * ⚠️ `now` is NOT optional here, deliberately. `templateCopy` treats a missing
 * `now` as "escalate whenever `since` is set" (see its `!now ||` branch), so a
 * caller that drops the argument silently promotes every persistent finding to
 * "this has been true for a while now" regardless of age. Nothing else would
 * fail.
 */
export function analysisBody(findings: readonly Finding[], now: string): string {
  return findings.map((f) => templateCopy(f, now)).join('\n\n')
}
