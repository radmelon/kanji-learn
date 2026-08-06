import type { Evidence, Finding, LearnerSnapshot } from '../types'
import {
  MEANING_QUESTION_TYPES, READING_QUESTION_TYPES,
  POPULATION_QUIZ_READING_GAP, POPULATION_PLACEMENT_READING_GAP,
  EVIDENCE_LABELS,
} from '../types'
import { confidenceFromCount, normaliseLinear } from '../magnitude'

/**
 * Readings trailing meanings by MORE than the population expects.
 *
 * Readings are harder than meanings for everybody. A learner trailing by the
 * population amount is normal and must produce no finding; only the EXCESS is
 * a finding about them.
 *
 * TWO SOURCES, per spec §3 — `placement_results` and `kl_test_results`. A
 * placement is ~13 items taken once; quizzes accumulate indefinitely. Each has
 * its own population baseline and they are NOT pooled:
 *
 *   placement — POPULATION_PLACEMENT_READING_GAP (probability), measured live
 *   quiz      — POPULATION_QUIZ_READING_GAP (probability), measured live
 *
 * The two excesses are combined weighted by observation count, so whichever
 * source the learner actually has dominates.
 *
 * MAGNITUDE MAPPING (this kind's own scale, per §2): the weighted excess
 * accuracy gap, linear from 0 at LAG_FLOOR to 1 at LAG_CEILING. Below the
 * floor the gap is within noise for a ~13-item placement.
 */
const LAG_FLOOR = 0.1
const LAG_CEILING = 0.6
/** Reaches ~63% confidence at 20 observations, counting both sources. */
const CONFIDENCE_SCALE = 20

interface SourceExcess {
  excess: number
  n: number
}

/** Excess lag from the placement, or null when it cannot be measured. */
function placementExcess(snapshot: LearnerSnapshot): SourceExcess | null {
  const placement = snapshot.placement
  if (!placement) return null

  const asked = placement.items.filter((i) => i.readingCorrect !== null)
  if (asked.length === 0) return null

  const meaningAccuracy = asked.filter((i) => i.meaningCorrect).length / asked.length
  const readingAccuracy = asked.filter((i) => i.readingCorrect === true).length / asked.length

  // Measured probability baseline — NOT the per-item readingOffset, which is a
  // constant 0.4 in logits and made this detector unfirable. See the constant.
  return {
    excess: meaningAccuracy - readingAccuracy - POPULATION_PLACEMENT_READING_GAP,
    n: asked.length,
  }
}

/** Excess lag from quiz history, or null when either side has no answers. */
function quizExcess(snapshot: LearnerSnapshot): SourceExcess | null {
  const rows = snapshot.reviews.quiz
  const reading = rows.filter((r) => READING_QUESTION_TYPES.includes(r.questionType))
  const meaning = rows.filter((r) => MEANING_QUESTION_TYPES.includes(r.questionType))
  // A gap needs both sides. Reading answers alone say nothing about a *lag*.
  if (reading.length === 0 || meaning.length === 0) return null

  const readingAccuracy = reading.filter((r) => r.correct).length / reading.length
  const meaningAccuracy = meaning.filter((r) => r.correct).length / meaning.length

  return {
    excess: meaningAccuracy - readingAccuracy - POPULATION_QUIZ_READING_GAP,
    n: reading.length + meaning.length,
  }
}

export function detectReadingLag(snapshot: LearnerSnapshot): Finding | null {
  const fromPlacement = placementExcess(snapshot)
  const fromQuiz = quizExcess(snapshot)
  const sources = [fromPlacement, fromQuiz].filter((s): s is SourceExcess => s !== null)
  if (sources.length === 0) return null

  const totalN = sources.reduce((sum, s) => sum + s.n, 0)
  const weightedExcess = sources.reduce((sum, s) => sum + s.excess * s.n, 0) / totalN
  if (weightedExcess <= 0) return null

  const magnitude = normaliseLinear(weightedExcess, LAG_FLOOR, LAG_CEILING)
  if (magnitude === 0) return null

  const evidence: Evidence[] = []
  if (fromPlacement) {
    const asked = snapshot.placement!.items.filter((i) => i.readingCorrect !== null)
    evidence.push(
      { label: EVIDENCE_LABELS.MEANING_ACCURACY, value: round2(asked.filter((i) => i.meaningCorrect).length / asked.length) },
      { label: EVIDENCE_LABELS.READING_ACCURACY, value: round2(asked.filter((i) => i.readingCorrect === true).length / asked.length) },
      { label: EVIDENCE_LABELS.EXPECTED_READING_PENALTY, value: POPULATION_PLACEMENT_READING_GAP },
      { label: EVIDENCE_LABELS.ITEMS_WITH_READING_ASKED, value: asked.length },
    )
  }
  if (fromQuiz) {
    const rows = snapshot.reviews.quiz
    const reading = rows.filter((r) => READING_QUESTION_TYPES.includes(r.questionType))
    const meaning = rows.filter((r) => MEANING_QUESTION_TYPES.includes(r.questionType))
    evidence.push(
      { label: EVIDENCE_LABELS.QUIZ_READING_ACCURACY, value: round2(reading.filter((r) => r.correct).length / reading.length) },
      { label: EVIDENCE_LABELS.QUIZ_MEANING_ACCURACY, value: round2(meaning.filter((r) => r.correct).length / meaning.length) },
      { label: EVIDENCE_LABELS.QUIZ_READING_ANSWERS, value: reading.length },
    )
  }

  return {
    kind: 'reading_lag',
    magnitude,
    confidence: confidenceFromCount(totalN, CONFIDENCE_SCALE),
    evidence,
    since: null, // stamped by select() in Task 9
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
