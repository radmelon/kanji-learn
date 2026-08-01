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
})
