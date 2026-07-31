import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { BuddySessionBody } from '../../src/components/buddy/BuddySessionBody'

describe('BuddySessionBody', () => {
  it('renders a loading state rather than nothing (B-227)', () => {
    render(<BuddySessionBody body={{ kind: 'loading' }} onCommit={() => {}} />)
    expect(screen.getByTestId('buddy-session-loading')).toBeTruthy()
  })

  it('renders the opener and the set card for a due session', () => {
    render(
      <BuddySessionBody
        body={{
          kind: 'cards',
          cards: [
            { kind: 'opener', text: 'Nice — 4 days this week.' },
            {
              kind: 'set',
              proposed: {
                weekStart: '2026-08-10', daysCommitted: 4, dayTargets: null,
                minutesPerDay: 15, focus: null, source: 'rolled_forward',
              },
            },
          ],
        }}
        onCommit={() => {}}
      />
    )
    expect(screen.getByText('Nice — 4 days this week.')).toBeTruthy()
    expect(screen.getByTestId('buddy-session-set')).toBeTruthy()
  })

  it('renders an empty-but-explained state when no appointment is set', () => {
    render(<BuddySessionBody body={{ kind: 'not_scheduled' }} onCommit={() => {}} />)
    expect(screen.getByTestId('buddy-session-not-scheduled')).toBeTruthy()
  })
})
