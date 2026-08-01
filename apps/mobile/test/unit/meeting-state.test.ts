import {
  initMeeting, meetingReducer, initialCollected, transcriptToMessages, collectedRuler,
} from '../../src/lib/meeting-state'
import type { CollectedState } from '@kanji-learn/shared'

const emptyCollected: CollectedState = {
  reasons: [], interests: [], explicitRuler: null, dailyGoal: null,
  buddyDay: null, buddyIntervalWeeks: null, timezone: 'America/Los_Angeles',
  hadPriorData: false,
}

describe('initMeeting', () => {
  it('opens on intro with one buddy bubble, not busy', () => {
    const s = initMeeting({ collected: emptyCollected, restDay: null, tier: 'cloud' })
    expect(s.beat.kind).toBe('intro')
    expect(s.seen).toEqual(['intro'])
    expect(s.transcript).toHaveLength(1)
    expect(s.transcript[0]!.who).toBe('buddy')
    expect(s.transcript[0]!.text.length).toBeGreaterThan(20)
    expect(s.busy).toBe(false)
  })
})

describe('meetingReducer', () => {
  const start = initMeeting({ collected: emptyCollected, restDay: null, tier: 'template' })

  it('answered merges the patch and advances the beat with a new buddy bubble', () => {
    // intro answered (empty patch acknowledges) → orientation
    const s1 = meetingReducer(start, { type: 'answered', patch: {} })
    expect(s1.beat.kind).toBe('orientation')
    expect(s1.transcript.at(-1)!.who).toBe('buddy')

    const s2 = meetingReducer(s1, { type: 'answered', patch: {} }) // → why
    expect(s2.beat.kind).toBe('why')

    const s3 = meetingReducer(s2, {
      type: 'answered', patch: { reasons: ['Travel'], interests: ['cooking'] },
    })
    // Travel matches neither frame group → frame_ask comes next
    expect(s3.beat.kind).toBe('frame_ask')

    const s4 = meetingReducer(s3, { type: 'answered', patch: { explicitRuler: 'grade' } })
    expect(s4.beat.kind).toBe('meaning')

    const s5 = meetingReducer(s4, { type: 'answered', patch: { dailyGoal: 15 } })
    expect(s5.beat.kind).toBe('meet')

    const s6 = meetingReducer(s5, { type: 'answered', patch: { buddyDay: 3, buddyIntervalWeeks: 1 } })
    expect(s6.beat.kind).toBe('ask')

    // one buddy bubble per transition, no duplicates:
    // intro, orientation, why, frame_ask, meaning, meet, ask = 7
    const buddyBubbles = s6.transcript.filter((t) => t.who === 'buddy')
    expect(buddyBubbles).toHaveLength(7)
  })

  it('an unproductive answer does not duplicate the prompt bubble', () => {
    const s1 = meetingReducer(start, { type: 'answered', patch: {} }) // orientation
    const s2 = meetingReducer(s1, { type: 'answered', patch: {} })    // why
    const len = s2.transcript.length
    const s3 = meetingReducer(s2, { type: 'answered', patch: {} })    // still why
    expect(s3.beat.kind).toBe('why')
    expect(s3.transcript).toHaveLength(len)
  })

  it('learner_said appends the learner bubble and sets busy (cloud)', () => {
    const cloud = initMeeting({ collected: emptyCollected, restDay: null, tier: 'cloud' })
    const s = meetingReducer(cloud, { type: 'learner_said', text: 'Hi!' })
    expect(s.transcript.at(-1)).toMatchObject({ who: 'learner', text: 'Hi!' })
    expect(s.busy).toBe(true)
  })

  it('cloud_replied appends the reply, merges the patch, advances, clears busy', () => {
    const cloud = initMeeting({ collected: emptyCollected, restDay: null, tier: 'cloud' })
    const said = meetingReducer(cloud, { type: 'learner_said', text: 'hello' })
    const s = meetingReducer(said, { type: 'cloud_replied', reply: 'Hey!', patch: {} })
    expect(s.busy).toBe(false)
    // reply bubble + next-beat bubble (intro → orientation)
    expect(s.transcript.at(-2)!.text).toBe('Hey!')
    expect(s.beat.kind).toBe('orientation')
  })

  it('cloud_failed flips the tier to template permanently and re-prompts', () => {
    const cloud = initMeeting({ collected: emptyCollected, restDay: null, tier: 'cloud' })
    const said = meetingReducer(cloud, { type: 'learner_said', text: 'hello' })
    const s = meetingReducer(said, { type: 'cloud_failed' })
    expect(s.tier).toBe('template')
    expect(s.busy).toBe(false)
    expect(s.transcript.at(-1)!.who).toBe('buddy') // re-prompt bubble so the learner is never stranded
  })

  it('IDs are unique across the transcript', () => {
    let s = initMeeting({ collected: emptyCollected, restDay: null, tier: 'template' })
    s = meetingReducer(s, { type: 'answered', patch: {} })
    s = meetingReducer(s, { type: 'answered', patch: {} })
    const ids = s.transcript.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('initialCollected', () => {
  const learner = { reasonsForLearning: ['Travel'], interests: ['games'] }
  it('a NEW user starts empty even though dailyGoal has a DB default', () => {
    const c = initialCollected(
      { onboardingCompletedAt: null, dailyGoal: 15, timezone: 'UTC', buddyDay: null, buddyIntervalWeeks: 1 },
      learner,
    )
    expect(c.hadPriorData).toBe(false)
    expect(c.reasons).toEqual([])
    expect(c.dailyGoal).toBeNull() // the default is not an answer
  })
  it('a PRIOR user carries reasons, interests, goal — and is never re-asked (spec §5)', () => {
    const c = initialCollected(
      { onboardingCompletedAt: '2026-05-01T00:00:00Z', dailyGoal: 30, timezone: 'Asia/Tokyo', buddyDay: 2, buddyIntervalWeeks: 1 },
      learner,
    )
    expect(c.hadPriorData).toBe(true)
    expect(c.reasons).toEqual(['Travel'])
    expect(c.dailyGoal).toBe(30)
    expect(c.buddyDay).toBe(2)
  })
})

describe('transcriptToMessages', () => {
  it('maps who→role and keeps only the last N', () => {
    const items = Array.from({ length: 30 }, (_, i) => {
      const who = i % 2 === 0 ? ('buddy' as const) : ('learner' as const)
      return { id: `m${i}`, who, text: `t${i}` }
    })
    const msgs = transcriptToMessages(items, 24)
    expect(msgs).toHaveLength(24)
    expect(msgs[0]).toEqual({ role: 'buddy' === items[6]!.who ? 'assistant' : 'user', content: 't6' })
    expect(msgs.at(-1)).toEqual({ role: 'learner' === items[29]!.who ? 'user' : 'assistant', content: 't29' })
  })
})

describe('collectedRuler', () => {
  it('returns the resolved ruler, or null while the frame still asks', () => {
    expect(collectedRuler({ ...emptyCollected, reasons: ['JLPT exam'] })).toBe('jlpt')
    expect(collectedRuler(emptyCollected)).toBeNull()
  })
})
