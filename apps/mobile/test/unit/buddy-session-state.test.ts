import { selectSessionBody } from '../../src/lib/buddy-session-state'

const proposed = {
  weekStart: '2026-08-10',
  daysCommitted: 4,
  dayTargets: null,
  minutesPerDay: 15,
  focus: null,
  source: 'rolled_forward' as const,
}

describe('selectSessionBody', () => {
  it('shows a loader before anything has arrived', () => {
    expect(selectSessionBody({ hasLoaded: false, error: null, data: null }).kind).toBe('loading')
  })

  it('shows an error state when the fetch failed', () => {
    expect(selectSessionBody({ hasLoaded: true, error: 'offline', data: null }).kind).toBe('error')
  })

  it('loaded with no data and no error is still an error, never a blank screen', () => {
    // B-227: the Journal rendered nothing on a cold load and the owner
    // concluded the feature was unbuilt. Every state must be enumerated.
    expect(selectSessionBody({ hasLoaded: true, error: null, data: null }).kind).toBe('error')
  })

  it('shows the not-scheduled state', () => {
    expect(selectSessionBody({
      hasLoaded: true, error: null, data: { state: 'not_scheduled' },
    }).kind).toBe('not_scheduled')
  })

  it('shows when the next session is due', () => {
    const body = selectSessionBody({
      hasLoaded: true, error: null, data: { state: 'waiting', nextDue: '2026-08-10' },
    })
    expect(body.kind).toBe('waiting')
    expect(body.kind === 'waiting' && body.nextDue).toBe('2026-08-10')
  })

  it('builds the card sequence for a due session, opener first and set last', () => {
    const body = selectSessionBody({
      hasLoaded: true,
      error: null,
      data: {
        state: 'due',
        weekStart: '2026-08-10',
        opener: { kind: 'strong', text: 'Nice — 4 days this week.' },
        reckon: 'We said 4 days, and you got 4.',
        isFirstSession: false,
        proposedCommitment: proposed,
      },
    })

    expect(body.kind).toBe('cards')
    if (body.kind !== 'cards') throw new Error('expected cards')
    expect(body.cards.map((c) => c.kind)).toEqual(['opener', 'reckon', 'set'])
    expect(body.cards[0].kind === 'opener' && body.cards[0].text).toBe('Nice — 4 days this week.')
  })

  it('omits the reckon card when there is nothing honest to report', () => {
    const body = selectSessionBody({
      hasLoaded: true,
      error: null,
      data: {
        state: 'due',
        weekStart: '2026-08-10',
        opener: { kind: 'first_ever', text: "Hi — I'm Buddy." },
        reckon: null,
        isFirstSession: true,
        proposedCommitment: { ...proposed, source: 'default' },
      },
    })

    if (body.kind !== 'cards') throw new Error('expected cards')
    expect(body.cards.map((c) => c.kind)).toEqual(['opener', 'set'])
  })

  it('always ends on the set card — the session has one guaranteed outcome', () => {
    for (const reckon of [null, 'We said 4 days.']) {
      const body = selectSessionBody({
        hasLoaded: true,
        error: null,
        data: {
          state: 'due',
          weekStart: '2026-08-10',
          opener: { kind: 'steady', text: 'Good to see you.' },
          reckon,
          isFirstSession: false,
          proposedCommitment: proposed,
        },
      })
      if (body.kind !== 'cards') throw new Error('expected cards')
      expect(body.cards[body.cards.length - 1].kind).toBe('set')
    }
  })

  it('carries the proposed commitment through to the set card unchanged', () => {
    const body = selectSessionBody({
      hasLoaded: true,
      error: null,
      data: {
        state: 'due',
        weekStart: '2026-08-10',
        opener: { kind: 'steady', text: 'Good to see you.' },
        reckon: null,
        isFirstSession: false,
        proposedCommitment: proposed,
      },
    })

    if (body.kind !== 'cards') throw new Error('expected cards')
    const set = body.cards[body.cards.length - 1]
    expect(set.kind === 'set' && set.proposed.daysCommitted).toBe(4)
    expect(set.kind === 'set' && set.proposed.minutesPerDay).toBe(15)
    expect(set.kind === 'set' && set.proposed.weekStart).toBe('2026-08-10')
  })
})
