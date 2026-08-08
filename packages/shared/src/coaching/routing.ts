import type { Finding, FindingKind } from './types'

/**
 * WHERE a finding may be said, and to WHOM (spec 2026-08-07 §3, §4).
 *
 * This file exists because nobody owned placement. The coaching design's §12
 * slices the work six ways and none of them asks whether the notebook is the
 * right destination for a given finding, so everything landed in one tab on one
 * cadence by default. A literal table is the artifact that fixes that: greppable,
 * diffable, reviewable in one screen.
 *
 * Kept separate from `selection.ts` on purpose. Selection answers "which findings
 * are most worth saying"; routing answers "where may this kind be said, and to
 * whom". Merging them would put the thing this project could not previously point
 * at back inside a file that already does something else.
 */

/**
 * Opened on purpose by someone who wants the complete picture. Uncapped, does not
 * rotate, and NEVER burns novelty (§8). Capping or rotating one is a category
 * error.
 */
export const RECORD_SURFACES = ['journal', 'tutor_report'] as const
export type RecordSurface = (typeof RECORD_SURFACES)[number]

/**
 * Interrupts a moment. Shows few things, rotates so the same sentence does not
 * follow the learner around, and speaks a given finding at most once per analysis
 * cycle (§6).
 */
export const EVENT_SURFACES = ['placement', 'session_complete', 'progress', 'weekly'] as const
export type EventSurface = (typeof EVENT_SURFACES)[number]

export type Surface = RecordSurface | EventSurface

/** Who is reading. The tutor report is the only non-learner reader (§3.2). */
export type Audience = 'learner' | 'tutor'

export interface RoutingRule {
  /**
   * WHY this row is set the way it is. Not read by any code. It exists so that
   * changing a row means arguing with the reason it was set (spec §4).
   */
  anchor: string
  /** Event surfaces this kind may be spoken on. The Journal is not listed —
   *  every finding goes to every record surface its audience allows. */
  events: readonly EventSurface[]
  audiences: readonly Audience[]
}

const LEARNER_AND_TUTOR = ['learner', 'tutor'] as const
const LEARNER_ONLY = ['learner'] as const

/**
 * Exhaustive by construction: `Record<FindingKind, …>` means a new finding kind
 * will not compile until somebody decides where it goes. That is the single most
 * valuable guarantee in this file, because the failure it exists to fix is a kind
 * quietly having no home.
 */
export const ROUTING: Record<FindingKind, RoutingRule> = {
  level_estimate: {
    anchor: 'event — the test just taken; stays true until the next one',
    // Progress carries the Velocity panel, which projects trajectory and ETA, so
    // a current level is progress-adjacent. "Where am I" and "how long until X"
    // are one question currently answered on two screens (spec §12.1).
    events: ['placement', 'progress'],
    audiences: LEARNER_AND_TUTOR,
  },
  hardest_cleared: {
    anchor: 'event — worthless a week later',
    events: ['placement'],
    audiences: LEARNER_AND_TUTOR,
  },
  mechanics_explainer: {
    anchor: 'event — explains the test you just took',
    // Moving this to placement fixes something live. On 2026-08-07 it WON a
    // Journal slot against leech — a static explainer that never changes
    // displacing a diagnostic naming 23 struggling kanji — because it had never
    // been raised so its novelty was 1.0. It explains the placement test; it
    // belongs at the placement test, not competing with live diagnostics.
    events: ['placement'],
    // LEARNER-ONLY because its SUBJECT is the app rather than the learner. A
    // tutor does not need Buddy explaining the tool to them. This is NOT the
    // same reason as commitment_gap below — do not collapse the two.
    audiences: LEARNER_ONLY,
  },
  theta_delta: {
    anchor: 'event — only new at the second test',
    events: ['placement'],
    audiences: LEARNER_AND_TUTOR,
  },
  retest_due: {
    anchor: 'record — a standing drift',
    events: ['progress'],
    audiences: LEARNER_AND_TUTOR,
  },
  reading_lag: {
    anchor: 'record — a standing imbalance',
    events: ['progress'],
    audiences: LEARNER_AND_TUTOR,
  },
  leech: {
    anchor: 'record — but actionable right after a lapse',
    events: ['session_complete', 'progress'],
    audiences: LEARNER_AND_TUTOR,
  },
  hook_coverage: {
    anchor: 'event — you just missed it',
    // NOT an invention: study.tsx records that the co-creation offer was
    // deliberately moved out of mid-card and to Session Complete (parent spec
    // §4.1), because interrupting retrieval to offer a hook damages the
    // retrieval. Routing the finding that MOTIVATES a hook to the same place the
    // offer already lands is consistency with a decision already paid for.
    events: ['session_complete'],
    audiences: LEARNER_AND_TUTOR,
  },
  fluency_gain: {
    anchor: 'event — praise about the session just finished',
    events: ['session_complete'],
    audiences: LEARNER_AND_TUTOR,
  },
  commitment_gap: {
    anchor: 'record — a period, not a moment',
    // Barred from session_complete ON PURPOSE. Telling someone who has just
    // finished studying that they studied less than they promised is the wrong
    // instrument at the wrong moment. It is period-anchored: the weekly session
    // is where the period is reviewed.
    events: ['weekly', 'progress'],
    // LEARNER-ONLY on CONSENT grounds, not subject grounds. A learner sharing
    // progress with a tutor did not obviously authorise Buddy reporting on their
    // diligence. If that call is ever revisited, THIS row moves and
    // mechanics_explainer does not.
    audiences: LEARNER_ONLY,
  },
}

/**
 * Replaces the global DEFAULT_FINDING_COUNT as the answer to "how many".
 *
 * That constant was never a content decision — it was a PLACEMENT decision made
 * by default, because one entry in one tab was the only surface that existed. On
 * 2026-08-07 a live render showed 7 of 10 kinds firing and 3 reaching the
 * learner: reading_lag and retest_due had been shipped-but-unread for weeks.
 *
 * Consume via `array.slice(0, cap)` — this map must not be serialized to JSON
 * and must not be used to allocate an array or bound a counting loop.
 */
export const SURFACE_CAP: Record<Surface, number> = {
  // The ledger. Uncapping this is what ends the silent 7-of-10 loss.
  journal: Infinity,
  // A record surface; a tutor wants the complete picture.
  tutor_report: Infinity,
  // Four kinds are eligible, but theta_delta only fires on a retest.
  placement: 3,
  // The learner is leaving. One sentence or none.
  session_complete: 1,
  // Browsing, not transiting. A guess, to be tuned against real sessions.
  progress: 2,
  // Eligibility-filtered, not cap-limited: the table constrains WHICH findings
  // the weekly session may speak, and slice 3's analysis mode keeps owning how
  // many it speaks and how it words them (spec §7.1).
  weekly: Infinity,
}

function isRecordSurface(s: Surface): s is RecordSurface {
  return (RECORD_SURFACES as readonly string[]).includes(s)
}

/**
 * Findings this surface may show this audience. Order is preserved — `select()`
 * has already ranked them and this must not reorder that.
 *
 * Does NOT apply SURFACE_CAP. Slicing is the caller's job, because the caller is
 * the one that knows whether it is writing a record (uncapped) or speaking on an
 * event surface (capped, and subject to the once-per-cycle rule).
 */
export function routableTo(
  findings: readonly Finding[],
  surface: Surface,
  audience: Audience,
): Finding[] {
  return findings.filter((f) => {
    const rule = ROUTING[f.kind]
    if (!rule.audiences.includes(audience)) return false
    // Every finding goes to every record surface its audience allows; the table
    // enumerates event surfaces only.
    if (isRecordSurface(surface)) return true
    return (rule.events as readonly string[]).includes(surface)
  })
}
