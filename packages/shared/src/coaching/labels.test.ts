import { describe, it, expect } from 'vitest'
import { EVIDENCE_LABELS } from './types'

describe('EVIDENCE_LABELS', () => {
  // MUTATION CAUGHT: changing any label's string value. Since slice 3,
  // buildCoachingPrompt serialises `${label}: ${value}` into the LLM prompt,
  // so a rename silently changes what the model is told about the learner —
  // and no test in apps/api asserts prompt content, by design (parent §10).
  // These values are a wire contract, not an implementation detail.
  it('pins every label string exactly', () => {
    expect(EVIDENCE_LABELS).toEqual({
      KANJI_GIVING_TROUBLE: 'kanji giving trouble',
      ACTIVE_KANJI: 'active kanji',
      LAPSES: 'lapses',
      MOST_LIKELY_LEVEL: 'most likely level',
      LOWER_BOUND: 'lower bound',
      UPPER_BOUND: 'upper bound',
      ABILITY_ESTIMATE: 'ability estimate',
      STANDARD_ERROR: 'standard error',
      MINUTES_PROMISED: 'minutes promised',
      MINUTES_STUDIED: 'minutes studied',
      HOOKS_BUILT: 'hooks built',
      SUGGESTED_KANJI: 'suggested kanji',
      AVG_LAPSES_WITH_HOOK: 'average lapses with a hook',
      AVG_LAPSES_WITHOUT_HOOK: 'average lapses without one',
      MEANING_ACCURACY: 'meaning accuracy',
      READING_ACCURACY: 'reading accuracy',
      EXPECTED_READING_PENALTY: 'expected reading penalty',
      ITEMS_WITH_READING_ASKED: 'items with a reading asked',
      QUIZ_READING_ACCURACY: 'quiz reading accuracy',
      QUIZ_MEANING_ACCURACY: 'quiz meaning accuracy',
      QUIZ_READING_ANSWERS: 'quiz reading answers',
      PERCENT_FASTER: 'percent faster',
      AVG_SECONDS_BEFORE: 'average seconds before',
      AVG_SECONDS_NOW: 'average seconds now',
      KANJI_MEASURED: 'kanji measured',
      ABILITY_THEN: 'ability then',
      ABILITY_NOW: 'ability now',
      MEASURED_ON: 'measured on',
      PREVIOUSLY_MEASURED_ON: 'previously measured on',
      HARDEST_KANJI_CLEARED: 'hardest kanji cleared',
      ITEM_DIFFICULTY: 'item difficulty',
      CURRENT_UNCERTAINTY: 'current uncertainty',
      UNCERTAINTY_WHEN_MEASURED: 'uncertainty when measured',
      DAYS_SINCE_THE_TEST: 'days since the test',
    })
  })

  // MUTATION CAUGHT: two constants pointing at the same string, which would
  // make a formatter's `find(e => e.label === X)` match another kind's
  // evidence item and render the wrong number.
  it('has no duplicate label values', () => {
    const values = Object.values(EVIDENCE_LABELS)
    expect(new Set(values).size).toBe(values.length)
  })
})
