/**
 * What a learner may grade after pulling the mnemonic hint (design spec §8.2).
 */

/** Named HintGrade, not Grade — `Grade` is already taken by ./milestones and a
 *  duplicate export from the barrel is a build error, not just a nuisance. */
export type HintGrade = 'again' | 'hard' | 'good' | 'easy'

/**
 * How long the learner must sit with the card before the hint appears.
 *
 * The delay IS the mechanism: it structurally enforces an unaided retrieval
 * attempt without any nagging copy. A tuning parameter by design — named here
 * so it can be adjusted after the on-device walkthrough without hunting
 * through the component.
 */
export const HINT_REVEAL_DELAY_MS = 5_000

const UNAIDED: HintGrade[] = ['again', 'hard', 'good', 'easy']
const AFTER_HINT: HintGrade[] = ['again', 'hard']

/**
 * A hinted recall IS "recalled with difficulty", which is what Hard means in
 * FSRS — so the cap is the honest classification of what happened, not a
 * penalty bolted on top.
 *
 * Without it there is a real data-integrity problem: a learner could take the
 * hint, grade Easy, and push a card they could not actually recall out three
 * weeks, quietly corrupting their own schedule. It also makes hint reliance
 * self-correcting — a hint costs a shorter interval, so there is an incentive
 * to try unaided, with no lockout and no guilt copy.
 */
export function allowedGradesAfterHint(hintUsed: boolean): HintGrade[] {
  return hintUsed ? AFTER_HINT : UNAIDED
}

/** Convenience for the grade controls, which ask about one button at a time. */
export function isGradeAllowedAfterHint(grade: HintGrade, hintUsed: boolean): boolean {
  return allowedGradesAfterHint(hintUsed).includes(grade)
}
