// Imports the pure module directly, not the store: the store transitively
// pulls in react-native (via ../lib/api -> ../stores/auth.store), which this
// lane (node env, no RN mocks) cannot parse. buildCompletePayload is
// re-exported from meet-buddy.store.ts too, so callers elsewhere are
// unaffected — see meeting-payload.ts and task-11-report.md for the full
// story.
import { buildCompletePayload } from '../../src/lib/meeting-payload'
import type { CollectedState } from '@kanji-learn/shared'

const collected: CollectedState = {
  reasons: ['JLPT exam'], interests: ['cooking'], explicitRuler: null,
  dailyGoal: 20, buddyDay: 0, buddyIntervalWeeks: 1,
  timezone: 'America/Los_Angeles', hadPriorData: false,
}

describe('buildCompletePayload', () => {
  it('carries every collected field, the resolved ruler, and the transcript', () => {
    const p = buildCompletePayload(collected, [{ id: 'm0', who: 'buddy', text: 'Hi' }], 'conversation')
    expect(p).toEqual({
      outcome: 'conversation',
      reasons: ['JLPT exam'],
      interests: ['cooking'],
      ruler: 'jlpt',
      dailyGoal: 20,
      buddyDay: 0,
      buddyIntervalWeeks: 1,
      transcript: [{ role: 'assistant', content: 'Hi' }],
    })
  })
  it('unresolved frame → ruler null; skipped outcome → no transcript', () => {
    const p = buildCompletePayload({ ...collected, reasons: ['Travel'] }, [], 'skipped')
    expect(p.ruler).toBeNull()
    expect(p.transcript).toBeNull()
  })

  // F4(c) (whole-branch review, HIGH): a composer message with no maxLength
  // could produce a transcript item longer than the API's
  // z.string().max(2000) on /v1/buddy/meet/complete. A learner who typed one
  // gets stashed offline (finish() catches the failed POST), and the stash
  // is replayed byte-for-byte on every future begin() — a >2000-char item
  // 400s forever, permanently locking that device out of completing
  // onboarding. Clamp at the source so a stashed payload can never
  // reproduce a validation failure it cannot recover from.
  it('clamps every transcript item to 2000 chars so a stashed payload can never permanently 400', () => {
    const longText = 'x'.repeat(2500)
    const p = buildCompletePayload(
      collected,
      [{ id: 'm0', who: 'learner', text: longText }],
      'conversation',
    )
    expect(p.transcript).toHaveLength(1)
    expect(p.transcript![0]!.content).toHaveLength(2000)
    expect(p.transcript![0]!.content).toBe('x'.repeat(2000))
  })
})
