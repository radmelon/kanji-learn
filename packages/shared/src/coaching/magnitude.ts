// Shared normalisation. Spec §2: magnitude is normalised PER KIND, not
// globally — there is no scale on which "readings lag by 0.4 logits" and
// "missed the commitment by 20 minutes" are comparable, and pretending
// otherwise silently biases selection toward whichever kind produces larger
// raw numbers. These helpers are the vocabulary each kind uses to state its
// own mapping; they are not a universal scale.

/** Linear ramp: 0 at or below `zeroAt`, 1 at or above `oneAt`. */
export function normaliseLinear(value: number, zeroAt: number, oneAt: number): number {
  if (oneAt <= zeroAt) return value >= oneAt ? 1 : 0
  if (value <= zeroAt) return 0
  if (value >= oneAt) return 1
  return (value - zeroAt) / (oneAt - zeroAt)
}

/**
 * Saturating ramp for unbounded counts: 0 at 0, asymptotic to 1.
 * `scale` is the value at which it reaches ~63%.
 *
 * NEVER RETURNS EXACTLY 1, and the clamp is load-bearing rather than
 * decorative. In IEEE 754 `1 - Math.exp(-100)` evaluates to exactly `1`, so
 * without this any sufficiently large count would claim total certainty. That
 * matters because an exact 1 is meaningful elsewhere: `commitment_gap` sets
 * `confidence: 1` deliberately — a promise and a measurement, nothing to be
 * uncertain about — and a count-derived confidence must stay distinguishable
 * from it. No amount of evidence makes an inference a measurement.
 */
const ASYMPTOTE = 1 - Number.EPSILON

export function normaliseSaturating(value: number, scale: number): number {
  if (value <= 0) return 0
  return Math.min(1 - Math.exp(-value / scale), ASYMPTOTE)
}

/**
 * Confidence from observation count (§2: "a finding from four observations
 * must not be spoken like one from four hundred"). Zero observations returns
 * exactly 0, which is the signal to say nothing at all.
 */
export function confidenceFromCount(n: number, scale: number): number {
  if (n <= 0) return 0
  return normaliseSaturating(n, scale)
}
