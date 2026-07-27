import {
  reinforceReducer,
  initialReinforce,
} from '../../src/mnemonics/useReinforce.reducer'

describe('reinforceReducer — two-step recall (parent spec §4.3)', () => {
  it('starts at the scene step', () => {
    expect(initialReinforce().step).toBe('scene')
  })

  it('REVEAL walks scene → reading → self_report', () => {
    let s = initialReinforce()
    s = reinforceReducer(s, { type: 'REVEAL' })
    expect(s.step).toBe('reading')
    s = reinforceReducer(s, { type: 'REVEAL' })
    expect(s.step).toBe('self_report')
  })

  it('REVEAL at self_report is a no-op — only an outcome advances past it', () => {
    let s = initialReinforce()
    s = reinforceReducer(s, { type: 'REVEAL' })
    s = reinforceReducer(s, { type: 'REVEAL' })
    const before = s
    s = reinforceReducer(s, { type: 'REVEAL' })
    expect(s.step).toBe('self_report')
    expect(s).toEqual(before)
  })
})

describe('reinforceReducer — outcome and the deepen gate (parent spec §6.2)', () => {
  const atSelfReport = () => {
    let s = initialReinforce()
    s = reinforceReducer(s, { type: 'REVEAL' })
    return reinforceReducer(s, { type: 'REVEAL' })
  }

  it('offers deepen when the gate trips: count >= 2 AND score < 0.35', () => {
    // Two 👎 from the 0.5 default walks the EMA to 0.18.
    const s = reinforceReducer(atSelfReport(), {
      type: 'OUTCOME_RECORDED',
      reinforcementCount: 2,
      effectivenessScore: 0.18,
    })
    expect(s.step).toBe('done')
    expect(s.shouldOfferDeepen).toBe(true)
  })

  it('does NOT offer deepen while the hook is still working', () => {
    const s = reinforceReducer(atSelfReport(), {
      type: 'OUTCOME_RECORDED',
      reinforcementCount: 3,
      effectivenessScore: 0.68,
    })
    expect(s.step).toBe('done')
    expect(s.shouldOfferDeepen).toBe(false)
  })

  it('does NOT offer deepen on a bad first outcome — one slip is not a failing hook', () => {
    const s = reinforceReducer(atSelfReport(), {
      type: 'OUTCOME_RECORDED',
      reinforcementCount: 1,
      effectivenessScore: 0.3,
    })
    expect(s.shouldOfferDeepen).toBe(false)
  })

  it('treats the score floor as exclusive: exactly 0.35 does not trip the gate', () => {
    const s = reinforceReducer(atSelfReport(), {
      type: 'OUTCOME_RECORDED',
      reinforcementCount: 2,
      effectivenessScore: 0.35,
    })
    expect(s.shouldOfferDeepen).toBe(false)
  })

  it('clears isSubmitting when the outcome lands', () => {
    let s = reinforceReducer(atSelfReport(), { type: 'SUBMITTING' })
    expect(s.isSubmitting).toBe(true)
    s = reinforceReducer(s, {
      type: 'OUTCOME_RECORDED',
      reinforcementCount: 2,
      effectivenessScore: 0.18,
    })
    expect(s.isSubmitting).toBe(false)
  })

  it('SUBMIT_FAILED returns to self_report so the learner can retry', () => {
    let s = reinforceReducer(atSelfReport(), { type: 'SUBMITTING' })
    s = reinforceReducer(s, { type: 'SUBMIT_FAILED' })
    expect(s.step).toBe('self_report')
    expect(s.isSubmitting).toBe(false)
    expect(s.shouldOfferDeepen).toBe(false)
  })
})
