import { FINDING_PRIORITY, type Finding, type FindingKind, type PriorFinding } from './types'

/**
 * Selection: severity x novelty, with decay (spec §4).
 *
 * Rank by `magnitude x confidence x novelty(kind, since)` and take the top N.
 *
 * TWO PROPERTIES ARE THE TESTABLE CONTRACT, and both exist because of what
 * they rule out:
 *
 *   1. MONOTONICALLY DECREASING in how recently the kind was raised.
 *   2. NEVER REACHES ZERO. "A finding that has been true for six weeks is not
 *      less important than a new one — it is more important, and going quiet
 *      on it is the coaching failure this policy exists to prevent."
 *
 * §4 explicitly REJECTS a hard novelty gate (goes silent on the most important
 * problem precisely because it is persistent) and fixed lens rotation
 * (arbitrary; reports whatever the lens sees rather than what matters).
 * Neither may be reintroduced here.
 */

/** Novelty of a kind raised moments ago. Above zero, by contract. */
export const NOVELTY_FLOOR = 0.25
/** Days at which a raised kind recovers ~63% of the way back to full novelty. */
export const NOVELTY_HALFLIFE_DAYS = 14

/**
 * Default findings per surface. §14.1: the owner accepted 2–3 "as a dial we
 * can tune later on", so this is a DEFAULT for a parameter, never an inlined
 * constant. Changing the number must not require touching detector code.
 */
export const DEFAULT_FINDING_COUNT = 3

export function novelty(
  kind: FindingKind,
  priors: readonly PriorFinding[],
  now: string,
): number {
  const prior = priors.find((p) => p.kind === kind)
  if (!prior) return 1

  const daysSince = Math.max(
    0,
    (Date.parse(now) - Date.parse(prior.lastRaisedAt)) / 86_400_000,
  )
  // Floor at NOVELTY_FLOOR when just raised, rising asymptotically to 1.
  return NOVELTY_FLOOR + (1 - NOVELTY_FLOOR) * (1 - Math.exp(-daysSince / NOVELTY_HALFLIFE_DAYS))
}

export function select(
  findings: readonly Finding[],
  priors: readonly PriorFinding[],
  now: string,
  count: number = DEFAULT_FINDING_COUNT,
): Finding[] {
  const scored = findings
    // Zero confidence means absent data. It must never speak.
    .filter((f) => f.confidence > 0)
    .map((f) => {
      const prior = priors.find((p) => p.kind === f.kind)
      return {
        // `since` carries how long this has been true, which is what lets the
        // voice escalate: "readings again — let's try something different".
        finding: { ...f, since: prior?.since ?? null },
        score: f.magnitude * f.confidence * novelty(f.kind, priors, now),
      }
    })

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      FINDING_PRIORITY[a.finding.kind] - FINDING_PRIORITY[b.finding.kind] ||
      a.finding.kind.localeCompare(b.finding.kind),
  )

  return scored.slice(0, Math.max(0, count)).map((s) => s.finding)
}
