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
        proposedCommitment: { ...proposed, source: 'default' },
      },
    })

    if (body.kind !== 'cards') throw new Error('expected cards')
    expect(body.cards.map((c) => c.kind)).toEqual(['opener', 'set'])
  })

  it('accepts currentCommitment when the server sends what the reckoning is about', () => {
    // Contract check for currentCommitment: it may be null (first-ever
    // session, nothing preceded it) or omitted entirely — either must
    // typecheck and neither should disturb the card sequence, since nothing
    // reads this field yet.
    const withCurrent = selectSessionBody({
      hasLoaded: true,
      error: null,
      data: {
        state: 'due',
        weekStart: '2026-08-10',
        opener: { kind: 'steady', text: 'Good to see you.' },
        reckon: 'We said 4 days, and you got 4.',
        currentCommitment: proposed,
        proposedCommitment: proposed,
      },
    })
    expect(withCurrent.kind).toBe('cards')

    const withNullCurrent = selectSessionBody({
      hasLoaded: true,
      error: null,
      data: {
        state: 'due',
        weekStart: '2026-08-10',
        opener: { kind: 'first_ever', text: "Hi — I'm Buddy." },
        reckon: null,
        currentCommitment: null,
        proposedCommitment: proposed,
      },
    })
    expect(withNullCurrent.kind).toBe('cards')
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

const dueBase = {
  state: 'due' as const,
  weekStart: '2026-08-03',
  opener: { kind: 'strong', text: 'OPENER' },
  reckon: 'RECKON',
  proposedCommitment: proposed,
}

describe('selectSessionBody — the composed utterance', () => {
  // MUTATION CAUGHT: appending the voice card to opener/reckon instead of
  // replacing them. §3's whole point is one voice, not three stitched
  // fragments — and the learner would read the same content twice.
  it('renders one voice card instead of opener and reckon', () => {
    const body = selectSessionBody({
      hasLoaded: true,
      error: null,
      data: { ...dueBase, voice: { text: 'COMPOSED', source: 'llm' } },
    })
    expect(body.kind).toBe('cards')
    const kinds = body.kind === 'cards' ? body.cards.map((c) => c.kind) : []
    expect(kinds).toEqual(['voice', 'set'])
  })

  // MUTATION CAUGHT: keying the preference off `'voice' in data` rather than a
  // usable value, so an old server (no field) or a null would render a session
  // with no prose at all — the B-227 blank-screen shape this file already
  // guards elsewhere.
  it('falls back to opener and reckon when there is no voice', () => {
    for (const data of [dueBase, { ...dueBase, voice: null }]) {
      const body = selectSessionBody({ hasLoaded: true, error: null, data })
      const kinds = body.kind === 'cards' ? body.cards.map((c) => c.kind) : []
      expect(kinds).toEqual(['opener', 'reckon', 'set'])
    }
  })

  // MUTATION CAUGHT: trusting a present-but-empty voice.text, which would
  // render a blank card and suppress the template prose that was available
  // the whole time.
  it('falls back when the voice text is blank', () => {
    const body = selectSessionBody({
      hasLoaded: true,
      error: null,
      data: { ...dueBase, voice: { text: '   ', source: 'llm' } },
    })
    const kinds = body.kind === 'cards' ? body.cards.map((c) => c.kind) : []
    expect(kinds).toEqual(['opener', 'reckon', 'set'])
  })

  // MUTATION CAUGHT: dropping the 'set' card on the voice path. Agreeing the
  // week ahead is the session's one guaranteed outcome and is unconditional
  // and always last, whatever precedes it.
  it('keeps the set card last on the voice path', () => {
    const body = selectSessionBody({
      hasLoaded: true,
      error: null,
      data: { ...dueBase, voice: { text: 'COMPOSED', source: 'llm' } },
    })
    const cards = body.kind === 'cards' ? body.cards : []
    expect(cards[cards.length - 1].kind).toBe('set')
  })

  // MUTATION CAUGHT: rendering `source` into the card, leaking an internal
  // observability field onto the learner's screen.
  it('carries only the text on the voice card', () => {
    const body = selectSessionBody({
      hasLoaded: true,
      error: null,
      data: { ...dueBase, voice: { text: 'COMPOSED', source: 'template' } },
    })
    const card = body.kind === 'cards' ? body.cards[0] : null
    expect(card).toEqual({ kind: 'voice', text: 'COMPOSED' })
  })
})
