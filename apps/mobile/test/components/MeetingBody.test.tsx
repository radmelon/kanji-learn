import React from 'react'
import { render, fireEvent } from '@testing-library/react-native'
import { MeetingBody } from '../../src/components/meeting/MeetingBody'
import { initMeeting, meetingReducer, type MeetingUiState } from '../../src/lib/meeting-state'
import type { CollectedState, ExtractedPatch } from '@kanji-learn/shared'

const emptyCollected: CollectedState = {
  reasons: [], interests: [], explicitRuler: null, dailyGoal: null,
  buddyDay: null, buddyIntervalWeeks: null, timezone: 'UTC', hadPriorData: false,
}
const noop = { onAnswer: jest.fn(), onSendText: jest.fn(), onFinish: jest.fn(), onSkipToForm: jest.fn(), onSkipOutright: jest.fn() }

function at(beatKind: string): MeetingUiState {
  let s = initMeeting({ collected: emptyCollected, restDay: null, tier: 'template' })
  // The why-answer routes the walk: ambiguous reasons (both frame groups)
  // when frame_ask is the target, unambiguous otherwise.
  const whyPatch =
    beatKind === 'frame_ask'
      ? { reasons: ['JLPT exam', 'Heritage'], interests: ['cooking'] }
      : { reasons: ['JLPT exam'], interests: ['cooking'] }
  const walk: Array<Parameters<typeof meetingReducer>[1]> = [
    { type: 'answered', patch: {} },                                    // intro → orientation
    { type: 'answered', patch: {} },                                    // orientation → why
    { type: 'answered', patch: whyPatch },                              // → frame_ask | meaning
    { type: 'answered', patch: { explicitRuler: 'jlpt' } },             // frame_ask → meaning (no-op patch otherwise)
    { type: 'answered', patch: { dailyGoal: 20 } },                     // → meet
    { type: 'answered', patch: { buddyDay: 0, buddyIntervalWeeks: 1 } }, // → ask
    // F2 (whole-branch review, HIGH): 'done' is reachable on cloud tier when
    // the learner sends free text at 'ask' instead of pressing a finish CTA —
    // the composer stays live through every beat. Drive it with the same
    // action the store's sendText path produces on a successful cloud turn.
    { type: 'cloud_replied', reply: 'Good luck!', patch: {} },          // ask → done
  ]
  for (const a of walk) {
    if (s.beat.kind === beatKind) return s
    s = meetingReducer(s, a)
  }
  if (s.beat.kind !== beatKind) throw new Error(`walk never reached ${beatKind}`)
  return s
}

// Every beat surface, enumerated. Deleting a branch's render must fail here.
const SURFACES = ['intro', 'orientation', 'why', 'frame_ask', 'meaning', 'meet', 'ask', 'done'] as const

describe('MeetingBody — every beat surface renders visibly', () => {
  it.each(SURFACES)('%s renders its transcript and an answer surface', (kind) => {
    const ui = at(kind)
    const { getByTestId } = render(<MeetingBody ui={ui} {...noop} />)
    getByTestId('meeting-transcript')
    getByTestId(`answer-${kind}`)
  })

  it('every transcript bubble Text carries an explicit color (B146)', () => {
    const ui = at('why')
    const { getByTestId } = render(<MeetingBody ui={ui} {...noop} />)
    const first = getByTestId('bubble-m0')
    const flat = Object.assign({}, ...[].concat(first.props.style ?? []))
    expect(flat.color).toBeTruthy()
  })

  it('why chips answer with a reasons patch', () => {
    const { getByText } = render(<MeetingBody ui={at('why')} {...noop} />)
    fireEvent.press(getByText('JLPT exam'))
    fireEvent.press(getByText('Done'))
    expect(noop.onAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ reasons: expect.arrayContaining(['JLPT exam']) }),
    )
  })

  it('meet renders all seven day pills and answers with the chosen day', () => {
    const { getByText } = render(<MeetingBody ui={at('meet')} {...noop} />)
    for (const d of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) getByText(d)
    fireEvent.press(getByText('Wed'))
    fireEvent.press(getByText('Sounds good'))
    expect(noop.onAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ buddyDay: 3, buddyIntervalWeeks: 1 }),
    )
  })

  it('ask offers both closes and routes them', () => {
    const { getByText } = render(<MeetingBody ui={at('ask')} {...noop} />)
    fireEvent.press(getByText('Take it now'))
    expect(noop.onFinish).toHaveBeenCalledWith('placement')
    fireEvent.press(getByText('Before our first meeting'))
    expect(noop.onFinish).toHaveBeenCalledWith('home')
  })

  it('done offers the same two closes as ask, and hides the composer even on cloud tier', () => {
    const cloudDone = { ...at('done'), tier: 'cloud' as const }
    const { getByText, queryByTestId } = render(<MeetingBody ui={cloudDone} {...noop} />)
    expect(queryByTestId('meeting-composer')).toBeNull()
    fireEvent.press(getByText('Take it now'))
    expect(noop.onFinish).toHaveBeenCalledWith('placement')
    fireEvent.press(getByText('Before our first meeting'))
    expect(noop.onFinish).toHaveBeenCalledWith('home')
  })

  it('new learner skip goes to the form; prior learner skip goes outright', () => {
    const fresh = at('intro')
    const { getByText, rerender } = render(<MeetingBody ui={fresh} {...noop} />)
    fireEvent.press(getByText('Skip for now'))
    expect(noop.onSkipToForm).toHaveBeenCalled()

    const prior = { ...fresh, collected: { ...fresh.collected, hadPriorData: true } }
    rerender(<MeetingBody ui={prior} {...noop} />)
    fireEvent.press(getByText('Skip for now'))
    expect(noop.onSkipOutright).toHaveBeenCalled()
  })

  it('cloud tier shows the free-text composer; template tier hides it', () => {
    const cloud = { ...at('why'), tier: 'cloud' as const }
    const { queryByTestId, rerender } = render(<MeetingBody ui={cloud} {...noop} />)
    expect(queryByTestId('meeting-composer')).toBeTruthy()
    rerender(<MeetingBody ui={{ ...cloud, tier: 'template' }} {...noop} />)
    expect(queryByTestId('meeting-composer')).toBeNull()
  })

  // F4(b) (whole-branch review, HIGH): the composer had no maxLength, so a
  // learner could type a message longer than the API's z.string().max(2000)
  // transcript-item cap. buildCompletePayload now clamps it (F4c), but the
  // input itself should not invite the problem in the first place.
  it('composer caps input length so a message cannot exceed the API cap', () => {
    const cloud = { ...at('why'), tier: 'cloud' as const }
    const { getByPlaceholderText } = render(<MeetingBody ui={cloud} {...noop} />)
    expect(getByPlaceholderText('Or just tell Buddy…').props.maxLength).toBe(1000)
  })

  it('busy shows a typing indicator', () => {
    const busy = { ...at('why'), tier: 'cloud' as const, busy: true }
    const { getByTestId } = render(<MeetingBody ui={busy} {...noop} />)
    getByTestId('meeting-busy')
  })

  it('Done with no interests typed shows an inline hint, not a silent stall', () => {
    const { getByText, getByTestId, queryByTestId } = render(<MeetingBody ui={at('why')} {...noop} />)
    expect(queryByTestId('why-hint')).toBeNull()
    fireEvent.press(getByText('JLPT exam'))
    fireEvent.press(getByText('Done'))
    getByTestId('why-hint')
  })
})

// F1 (whole-branch review, HIGH): template tier had no way to satisfy the
// interests requirement — the free-text row was gated `tier === 'cloud'`, so
// a learner offline (or after a permanent cloud_failed) could select reasons
// but never produce a non-empty `interests` array, and the why beat could
// never advance. This is a real state-driven walk (reducer wired through
// React state, exactly like the store), interacting ONLY with surfaces the
// template tier renders — chips, pills, and Done/primary buttons — and
// explicitly asserting the composer never appears. It must reach 'ask'.
function TemplateWalkHarness() {
  const [ui, setUi] = React.useState<MeetingUiState>(() =>
    initMeeting({ collected: emptyCollected, restDay: null, tier: 'template' }),
  )
  const onAnswer = (patch: ExtractedPatch) =>
    setUi((s) => meetingReducer(s, { type: 'answered', patch }))
  return (
    <MeetingBody
      ui={ui}
      onAnswer={onAnswer}
      onSendText={jest.fn()}
      onFinish={jest.fn()}
      onSkipToForm={jest.fn()}
      onSkipOutright={jest.fn()}
    />
  )
}

describe('MeetingBody — template tier can complete the whole walk without the cloud (F1)', () => {
  it('reaches ask using only chips, pills and buttons — the composer never renders', () => {
    const { getByTestId, getByText, getByPlaceholderText, queryByTestId } = render(
      <TemplateWalkHarness />,
    )

    getByTestId('answer-intro')
    expect(queryByTestId('meeting-composer')).toBeNull()
    fireEvent.press(getByText('Got it')) // intro -> orientation

    getByTestId('answer-orientation')
    fireEvent.press(getByText('Got it')) // orientation -> why

    getByTestId('answer-why')
    expect(queryByTestId('meeting-composer')).toBeNull()
    fireEvent.press(getByText('JLPT exam')) // reasons chip — unambiguous, skips frame_ask
    fireEvent.changeText(
      getByPlaceholderText('What are you into? (comma-separated)'),
      'cooking',
    )
    fireEvent.press(getByText('Done'))

    getByTestId('answer-meaning')
    fireEvent.press(getByText('15'))
    fireEvent.press(getByText('Sounds good'))

    getByTestId('answer-meet')
    fireEvent.press(getByText('Sun'))
    fireEvent.press(getByText('Weekly'))
    fireEvent.press(getByText('Sounds good'))

    getByTestId('answer-ask')
    expect(queryByTestId('meeting-composer')).toBeNull()
  })
})
