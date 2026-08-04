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
    'Your level comes from a statistical technique called IRT. The test gets harder when you answer well and easier when you do not, which is how it can say something useful about your level in about a dozen questions.',
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

type Formatter = (f: Finding) => string | null

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
    return `Your placement test on ${humanDate(String(on))} puts you at ${level}, and the honest range runs from ${low} to ${high}. That range is wide because a placement test only asks about a dozen questions. It narrows when you take the placement test again, rather than from day-to-day studying, because your level estimate is only recalculated when you sit the test.`
  },

  // Fixed copy by contract (§3): no evidence to read, so no formatter.
  mechanics_explainer: () => null,

  reading_lag: () => null,
  leech: () => null,
  commitment_gap: () => null,
  hook_coverage: () => null,
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
