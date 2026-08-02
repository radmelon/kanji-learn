import { shouldEndStudySession } from '../../src/lib/study-session-exit'

describe('shouldEndStudySession (B-226)', () => {
  it('clears a finished session when the learner asks to start a new one', () => {
    expect(
      shouldEndStudySession({ freshSessionRequested: true, hasSessionSummary: true }),
    ).toBe(true)
  })

  it('leaves an in-progress session alone — the CTA means "take me back to it"', () => {
    expect(
      shouldEndStudySession({ freshSessionRequested: true, hasSessionSummary: false }),
    ).toBe(false)
  })

  /**
   * The B-216 guard. `reset()` fires incidentally (a profile PATCH mid-session,
   * sign-out); only an explicit request may dismiss Session Complete.
   */
  it('never tears down without an explicit request, however stale things look', () => {
    expect(
      shouldEndStudySession({ freshSessionRequested: false, hasSessionSummary: true }),
    ).toBe(false)
    expect(
      shouldEndStudySession({ freshSessionRequested: false, hasSessionSummary: false }),
    ).toBe(false)
  })

  it('is exhaustive over its inputs — no combination is undefined', () => {
    for (const freshSessionRequested of [true, false]) {
      for (const hasSessionSummary of [true, false]) {
        expect(
          typeof shouldEndStudySession({ freshSessionRequested, hasSessionSummary }),
        ).toBe('boolean')
      }
    }
  })
})
