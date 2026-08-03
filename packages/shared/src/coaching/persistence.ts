import type { Finding, PriorFinding } from './types'

/**
 * Finding memory across analyses (spec §4 of the slice 2 design).
 *
 * Pure by design. The DECISION about which prior row to read — including the
 * coalescing window for back-to-back runs — belongs to the caller, because it
 * is a question about database rows. This module only answers "given these
 * priors and this selection, what are the new stamps".
 */

/**
 * TRANSITION-ONLY RESTAMPING, and the reason it is not "restamp everything".
 *
 * Re-stamping every selected finding on every write re-floors its novelty each
 * run: run 1 picks A/B/C and floors them, run 2 sees D/E at novelty 1.0 and
 * displaces them, run 3 flips back. The learner sees different content on every
 * open, and throttling the write rate only slows that down.
 *
 * Keeping the stamp while a finding stays selected lets its novelty RECOVER on
 * display, which is exactly what §4 of the parent spec asks for: "a finding
 * that has been true for six weeks is not less important than a new one — it is
 * more important, and going quiet on it is the coaching failure this policy
 * exists to prevent."
 *
 * `since` carries from the immediately preceding analysis ONLY. A kind that
 * drops out and later returns starts a new episode — more truthful than
 * claiming unbroken continuity, and the full history stays reconstructible by
 * walking the superseded chain.
 */
export function carryForward(
  priors: readonly PriorFinding[],
  selected: readonly Finding[],
  now: string,
): PriorFinding[] {
  return selected.map((f) => {
    const prior = priors.find((p) => p.kind === f.kind)
    return prior
      ? { kind: f.kind, since: prior.since, lastRaisedAt: prior.lastRaisedAt }
      : { kind: f.kind, since: now, lastRaisedAt: now }
  })
}

/**
 * Whether this analysis says the same thing as the stored one.
 *
 * Drives the "update analyzedAt in place rather than superseding" rule: without
 * it the notebook-open path inserts a byte-identical duplicate every staleness
 * window, and the superseded chain that §4 calls the trajectory becomes a run
 * of identical rows.
 */
export function selectionsMatch(
  priors: readonly PriorFinding[],
  selected: readonly Finding[],
): boolean {
  if (priors.length !== selected.length) return false
  const priorKinds = new Set(priors.map((p) => p.kind))
  return selected.every((f) => priorKinds.has(f.kind))
}
