import type { Finding, FindingKind } from './types'

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
    'Your level comes from a statistical technique called IRT — the test gets harder when you do well, which is how it can say something useful in about a dozen questions. There is a fuller explanation in your Profile.',
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

export function templateCopy(finding: Finding, now?: string): string {
  const base = BASE[finding.kind]

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
