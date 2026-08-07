import type { Finding, FindingKind, Evidence } from './types'
import { EVIDENCE_LABELS, POPULATION_PLACEMENT_READING_GAP, POPULATION_QUIZ_READING_GAP } from './types'
import { JLPT_LEVELS } from '../milestones/constants'
import type { JlptLevel } from '../types'

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

/**
 * The rule that decides when a formatter may use the analyzer's own
 * vocabulary — words that are also literally how an Evidence label reads,
 * like "uncertainty" (CURRENT_UNCERTAINTY, UNCERTAINTY_WHEN_MEASURED below).
 *
 * That word may appear in generated copy ONLY when the sentence glosses it in
 * the same breath. `theta_delta` earns it: "...larger than the uncertainty in
 * both measurements combined" explains what the word means as it uses it.
 * `retest_due` does not use it at all, because there was never a clause in
 * that sentence prepared to explain it — it would have been a bare technical
 * term the learner has to interpret alone. copy.test.ts pins both sides of
 * this — `toContain('uncertainty')` for theta_delta, `not.toContain
 * ('uncertainty')` for retest_due — which is the rule holding in two
 * directions at once, not a contradiction between the tests.
 */

const BASE: Record<FindingKind, string> = {
  reading_lag:
    'Your readings are trailing your meanings by more than the usual gap.',
  leech:
    'Some of your kanji are giving you more trouble than the rest.',
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
  // Finding 2 (CRITICAL, coaching-copy-floor final review): the removed
  // "hardest item the test put in front of you" claim (see the formatter's
  // own comment) must not survive here either — the owner's precedent on
  // BASE.leech is explicit that a claim removed from the formatter must not
  // reappear in the fallback nothing-to-say string.
  hardest_cleared:
    'You cleared the hardest kanji you got right on the test.',
  // Finding 4 (Important, coaching-copy-floor final review): "has drifted
  // since it was taken" is false the moment detectRetestDue can fire —
  // it triggers on standard error alone, and live SEs already exceed the
  // floor on their own, so a learner who finished a test TODAY could be told
  // it "has drifted since it was taken". The formatter's own sentence was
  // already fixed to avoid this (see its comment); this is the string that
  // renders when there is no evidence at all, and it must not say the thing
  // the formatter was fixed to stop saying.
  retest_due:
    'Taking your placement test again would sharpen your level estimate rather than simply repeat what you already know.',
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
 * JLPT_LEVELS' ascending ABILITY index (N5=0 .. N1=4), or -1 for anything
 * else. Ability runs the OPPOSITE direction from JLPT numbering — N5 is the
 * least advanced band — so this is "rank by ability", the order
 * `low <= level <= high` must hold in for level_estimate's containment guard
 * (Finding 1, coaching-copy-floor final review).
 */
function jlptRank(value: string | number): number {
  return JLPT_LEVELS.indexOf(String(value) as JlptLevel)
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
  /**
   * This source's OWN population baseline gap (Finding 3, coaching-copy-floor
   * final review) — POPULATION_PLACEMENT_READING_GAP for placement,
   * POPULATION_QUIZ_READING_GAP for quiz. Readings trail meanings by this
   * much for EVERYONE on this source (reading-lag.ts's own comment), so only
   * a gap that EXCEEDS it is a finding about this particular learner.
   */
  baseline: number
}

/**
 * Per-kind copy. A formatter returns `null` when its evidence is absent, and
 * `templateCopy` substitutes BASE[kind] — never a half-built sentence.
 *
 * All ten kinds are filled as of Task 6. `mechanics_explainer` is the one
 * exception by contract (§3): it has no evidence to read, so its formatter is
 * `() => null` permanently, not a placeholder.
 */
const FORMATTERS: Record<FindingKind, Formatter> = {
  level_estimate: (f) => {
    const level = ev(f, EVIDENCE_LABELS.MOST_LIKELY_LEVEL)
    const low = ev(f, EVIDENCE_LABELS.LOWER_BOUND)
    const high = ev(f, EVIDENCE_LABELS.UPPER_BOUND)
    const on = ev(f, EVIDENCE_LABELS.MEASURED_ON)
    if (level === undefined || low === undefined || high === undefined || on === undefined) return null

    // Finding 1 (CRITICAL, coaching-copy-floor final review): `level` and
    // `low`/`high` can be assembled at different moments. `level` used to be
    // `placementSessions.inferredLevel`, stored at TEST time; `low`/`high`
    // are recomputed by coaching.service.ts's levelInterval() from TODAY's
    // corpus. A recalibration between those two moments left live rows
    // written before commit 504b1ea with a stored level outside its own
    // recomputed bounds — verified live, session 21c54a5e (theta=1.1453,
    // se=0.3511, stored inferred_level='N4'): today's bands put low=N3,
    // high=N2, and N4 sits outside N3..N2. coaching.service.ts now derives
    // `level` from the SAME bands as `low`/`high` in the same call, which
    // makes containment true by construction for anything assembled from
    // here on — but this formatter must not trust that forever. A future
    // source of disagreement (a bug, a hand-built caller, a stale cache)
    // must not put a self-contradicting sentence in front of a learner, so
    // refuse to render unless low <= level <= high on the JLPT ladder.
    const lowRank = jlptRank(low)
    const highRank = jlptRank(high)
    const midRank = jlptRank(level)
    if (lowRank === -1 || highRank === -1 || midRank === -1 || midRank < lowRank || midRank > highRank) return null

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
    // Interpolates `low`, not `level`, in the collapsed sentence below.
    // Before Finding 1's fix this was load-bearing: `level` was the stored
    // placementSessions.inferredLevel from test time, `low`/`high` were
    // recomputed from today's corpus, and the two could disagree — the same
    // class of band/ladder mismatch coaching.service.ts's B146 scar comment
    // describes. The guard above now closes that gap at the source (`level`
    // comes from the same bands as `low`/`high`), so when low === high,
    // level === low is guaranteed rather than merely likely. `low` stays the
    // interpolated value anyway — it reads identically either way now, and
    // this sentence has one fewer name to track.
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
        ? { reading: placementReading, meaning: placementMeaning, count: Number(placementCount), unit: 'answers', baseline: POPULATION_PLACEMENT_READING_GAP }
        : null
    const quiz: ReadingLagSource | null =
      quizReading !== undefined && quizMeaning !== undefined && quizCount !== undefined
        ? { reading: quizReading, meaning: quizMeaning, count: Number(quizCount), unit: 'reading answers', baseline: POPULATION_QUIZ_READING_GAP }
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

    // Finding 3 (Important, coaching-copy-floor final review): the guard
    // above only rejects a chosen source whose numbers run backwards. It says
    // nothing about whether the gap is UNUSUAL — readings trail meanings by
    // `chosen.baseline` for everybody on that source, so "a wider gap than
    // most people have" is true only when the chosen source's OWN gap
    // exceeds its OWN baseline. Reachable: placement asks 13 (100%/25%,
    // excess 0.783 over its -0.033 baseline) alongside quiz answering 20
    // reading / 20 meaning (86%/88%, excess -0.053 under its 0.073 baseline)
    // — the weighted blend clears LAG_FLOOR on placement's strength, quiz
    // wins the count comparison (20 >= 13) and becomes `chosen`, and quiz's
    // own 2-point gap is narrower than what is normal for quiz. Placement's
    // baseline is negative, so this can never fire for a chosen placement
    // source beyond what the raw guard above already catches — quiz's
    // positive baseline is the one that needs it. Same shape as the guard
    // above: refuse to render rather than cite numbers that contradict the
    // sentence.
    if (Number(chosen.meaning) - Number(chosen.reading) <= chosen.baseline) return null

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

  fluency_gain: (f) => {
    const faster = ev(f, EVIDENCE_LABELS.PERCENT_FASTER)
    const measured = ev(f, EVIDENCE_LABELS.KANJI_MEASURED)
    const window = ev(f, EVIDENCE_LABELS.WINDOW_DAYS)
    if (faster === undefined || measured === undefined || window === undefined) return null
    // Finding 4: coaching.service.ts splits the window at its MIDPOINT —
    // early is 30-15 days ago, late is the last 15 days — so the comparison
    // is the second half of the window against the first, a ~15-day step, not
    // a 30-day lookback. windowDays is the window's LENGTH; reusing it as a
    // distance ("30 days ago") claims a lookback the detector doesn't do.
    // "earlier in the last N days" states what is actually measured.
    //
    // "has held up on those" (not "has not slipped while doing it"):
    // accuracyHeld permits a fall of up to ACCURACY_SLACK (0.05) per card, and
    // the cited kanji are precisely the subset that satisfied it — the old
    // global phrasing overstated a claim that is actually scoped to them.
    //
    // Not reachable at coaching.service.ts's own REVIEW_WINDOW_DAYS = 30, but
    // ReviewSnapshot.windowDays is carried here rather than inlined precisely
    // because it may change (see that field's own comment in types.ts) —
    // pluralised the same way retest_due's elapsed-days clause two formatters
    // down already is, so a future 1-day window does not read "last 1 days".
    const windowDays = Number(window)
    const dayWord = windowDays === 1 ? 'day' : 'days'
    return `You are answering about ${faster}% faster than you were earlier in the last ${windowDays} ${dayWord}, across ${measured} kanji, and your accuracy has held up on those. Speed usually improves before anything else does, so this is a sign that recalling these characters is becoming automatic rather than effortful.`
  },

  theta_delta: (f) => {
    const then = ev(f, EVIDENCE_LABELS.ABILITY_THEN)
    const now = ev(f, EVIDENCE_LABELS.ABILITY_NOW)
    const thenOn = ev(f, EVIDENCE_LABELS.PREVIOUSLY_MEASURED_ON)
    const nowOn = ev(f, EVIDENCE_LABELS.MEASURED_ON)
    // `then`/`now` are still read here — their absence still means the
    // finding is malformed and must degrade to BASE — but Finding 5 drops
    // them from the rendered sentence: θ is centred near zero, so `then` can
    // be negative, and a negative "ability estimate" printed as praise reads
    // as an insult in the one band meant to motivate. "Has risen" plus the
    // uncertainty basis carries the full meaning without the raw logits.
    if (then === undefined || now === undefined || thenOn === undefined || nowOn === undefined) return null
    const thenLabel = humanDate(String(thenOn))
    const nowLabel = humanDate(String(nowOn))
    // B-232: this shipped reading "on 1 August and 1 August" for a learner who
    // sat three placements in one day. detectThetaDelta now requires a 7-day
    // gap, so this cannot be reached — it stays as the contract's own backstop,
    // because a sentence naming one date twice has failed to build, and the
    // rule in this file is that a formatter which cannot build its sentence
    // returns null rather than emitting a broken one.
    if (thenLabel === nowLabel) return null
    return `Your ability estimate has risen between your placement tests on ${thenLabel} and ${nowLabel}, and the rise is larger than the uncertainty in both measurements combined — so it is real progress rather than the test landing differently on the day.`
  },

  hardest_cleared: (f) => {
    const kanji = f.evidence.find((e) => e.label === EVIDENCE_LABELS.HARDEST_KANJI_CLEARED)
    const strokes = ev(f, EVIDENCE_LABELS.STROKE_COUNT)
    const readings = ev(f, EVIDENCE_LABELS.READING_COUNT)
    if (!kanji?.character || strokes === undefined || readings === undefined) return null
    // Finding 2 (Important, prior pass): spell(1) is 'one', and a hard-coded
    // plural renders 'one readings' — 344 of 2,294 live kanji have exactly
    // one reading.
    //
    // Finding 5 (Minor, this pass): spell() has since been dropped from this
    // clause entirely. It rendered "19 strokes and three readings" beside
    // "8 strokes and 7 readings" — strokes were always numerals, readings
    // were spelled below six — so 206 of 2,294 live kanji (more than five
    // readings) flipped style mid-sentence. Both halves are numerals now;
    // spell() stays in leech's sentence-opening count, where a word is right.
    const readingCount = Number(readings)
    const readingWord = readingCount === 1 ? 'reading' : 'readings'
    // The identical defect lived in the same clause on the stroke side: a
    // hard-coded plural rendered 'it has 1 strokes'. Only two live kanji have
    // exactly one stroke (一, 乙 — id-verified 2026-08-06), far less reachable
    // than the reading case above, but it is the same bug fixed the same way.
    const strokeCount = Number(strokes)
    const strokeWord = strokeCount === 1 ? 'stroke' : 'strokes'
    // Finding 2 (CRITICAL, this pass): detectHardestCleared filters to
    // meaningCorrect FIRST, then takes the max difficulty among survivors —
    // it knows the hardest item the learner GOT RIGHT, never the hardest
    // item the test ASKED. The opening clause used to claim the latter
    // ("which was the hardest item the test put in front of you"); verified
    // false on 2 of 4 live sessions (session 01eba1c0: hardest asked
    // difficulty 2.00354, hardest cleared 1.21478; session cf02c508: hardest
    // asked 0.444002, hardest cleared 0.442778). The evidence carries
    // nothing about un-cleared items, so this formatter cannot check a claim
    // about them — state only what the detector actually knows.
    //
    // Finding 1 (CRITICAL, prior pass): the CLOSING clause used to claim a
    // specific comparison ("counted as harder than some kanji at an easier
    // JLPT level") this evidence cannot carry either, and which is false on
    // two of live's four sessions (the owner's own 願 session had nine
    // items, none below N3). States the mechanism instead — true regardless
    // of what else was on the test.
    return `You cleared ${kanji.character}, the hardest item you got right: it has ${strokeCount} ${strokeWord} and ${readingCount} ${readingWord}. Difficulty here weighs stroke count and number of readings alongside JLPT level, so the hardest item is not always the one from the highest level you saw.`
  },

  retest_due: (f) => {
    const days = ev(f, EVIDENCE_LABELS.DAYS_SINCE_THE_TEST)
    if (days === undefined) return null
    // An earlier pass (Finding 3) established two things this still keeps:
    // detectRetestDue fires on widenForStaleness(se, days) clearing
    // RETEST_FLOOR (0.5) — driven by the SE term, not elapsed time, so a
    // learner can hit this finding at 0 elapsed days (live ability_se already
    // exceeds 0.5 on its own: verified 0.585, 0.546). That is why the elapsed
    // clause below is omitted at 0 and, even when shown, is stated as an
    // added fact rather than as the reason the finding fired.
    //
    // What that pass got wrong (this task's Important finding — a
    // contradiction the fix below removes): it had this sentence lead with
    // "The range around your level is wider than it needs to be" and close
    // with "...would narrow THAT range" — reusing level_estimate's own
    // "range" vocabulary so the two findings would "read as one voice".
    // Rendered together they contradicted instead. level_estimate calls its
    // interval's width inherent to a twelve-question instrument ("that range
    // is wide because a placement test only asks about a dozen questions");
    // this finding called the same-sounding quantity excess that should not
    // be there ("wider than it needs to be") — and "that range" asserted an
    // identity between two DIFFERENT numbers. detectLevelEstimate's bounds
    // are recomputed from the SE stored at test time; this finding's spread
    // is widenForStaleness(se, days) — a WIDER figure the learner is never
    // shown. See "level_estimate and retest_due together" in copy.test.ts,
    // which renders the pair and pins the absence of that contradiction.
    //
    // The fix: give this finding a referent of its own instead of describing
    // a spread at all — it states what retaking buys, not why the finding
    // fired. That also keeps this clear of "uncertainty" (the analyzer's own
    // word for the concept: CURRENT_UNCERTAINTY / UNCERTAINTY_WHEN_MEASURED
    // below), since there is no spread claim left for that word to attach to.
    // See the rule above BASE: the analyzer's vocabulary may appear only when
    // a sentence explains it in the same breath, and this sentence has
    // nothing left to explain.
    const n = Number(days)
    const elapsed = n >= 1 ? `, and it has been ${n} ${n === 1 ? 'day' : 'days'} since the last one` : ''
    return `Retaking your placement test would sharpen your level estimate rather than simply repeat what you already know${elapsed}. You can start it from your Profile.`
  },
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
