import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { BuddySessionBody } from '../../src/components/buddy/BuddySessionBody'
import { colors } from '../../src/theme'

/** Flattens RN's style prop, which may be an object, an array, or nested arrays. */
function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle))
  return (style ?? {}) as Record<string, unknown>
}

/**
 * Every Text node that actually renders a string.
 *
 * Icon components render a Text with no children — colour reaches them by prop,
 * and an empty node has nothing to be illegible. Filtering them out would let
 * this assert nothing at all if a state rendered no copy, so callers also assert
 * the list is non-empty.
 */
function legibleTextNodes() {
  const { Text } = require('react-native')
  return screen
    .UNSAFE_getAllByType(Text)
    .filter((n: { props: { children?: unknown } }) => typeof n.props.children === 'string')
}

describe('BuddySessionBody', () => {
  it('renders a loading state rather than nothing (B-227)', () => {
    render(<BuddySessionBody body={{ kind: 'loading' }} onCommit={() => {}} />)
    expect(screen.getByTestId('buddy-session-loading')).toBeTruthy()
  })

  it('pressing confirm calls onCommit with the proposed commitment plus source: session', () => {
    const onCommit = jest.fn()
    const proposed = {
      weekStart: '2026-08-10', daysCommitted: 4, dayTargets: null,
      minutesPerDay: 15, focus: null, source: 'rolled_forward' as const,
    }

    render(
      <BuddySessionBody
        body={{
          kind: 'cards',
          cards: [
            { kind: 'opener', text: 'Nice — 4 days this week.' },
            { kind: 'set', proposed },
          ],
        }}
        onCommit={onCommit}
      />
    )

    fireEvent.press(screen.getByTestId('buddy-session-confirm'))

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith({ ...proposed, source: 'session' })
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

  it('renders an error state when Buddy is unreachable', () => {
    render(<BuddySessionBody body={{ kind: 'error' }} onCommit={() => {}} />)
    expect(screen.getByTestId('buddy-session-error')).toBeTruthy()
  })

  it('renders waiting state and displays the next due date', () => {
    render(
      <BuddySessionBody body={{ kind: 'waiting', nextDue: '2026-08-10' }} onCommit={() => {}} />
    )
    expect(screen.getByTestId('buddy-session-waiting')).toBeTruthy()
    expect(screen.getByText('Next catch-up: 2026-08-10')).toBeTruthy()
  })

  // ── Visibility ────────────────────────────────────────────────────────────
  //
  // B146, found on device: this component carried no styling at all. React
  // Native defaults <Text> to BLACK, and colors.bg is #0F0F1A — so the screen
  // rendered correctly and was completely invisible, which reads as a blank
  // dead end.
  //
  // Every test above passed throughout, because getByText finds text whatever
  // colour it is. A test that queries by text can never fail on invisible text.
  // These assert the one property the existing lane structurally cannot see.

  it.each([
    ['not_scheduled', { kind: 'not_scheduled' as const }],
    ['error', { kind: 'error' as const }],
    ['waiting', { kind: 'waiting' as const, nextDue: '2026-08-10' }],
  ])('renders %s text in a colour that is legible on the app background', (_name, body) => {
    render(<BuddySessionBody body={body} onCommit={() => {}} />)

    const texts = legibleTextNodes()
    expect(texts.length).toBeGreaterThan(0)
    for (const node of texts) {
      const style = flattenStyle(node.props.style)
      expect(style.color).toBeDefined()
      expect(style.color).not.toBe('#000')
      expect(style.color).not.toBe('black')
      expect(style.color).not.toBe(colors.bg)
    }
  })

  it('renders every card in a due session in a legible colour', () => {
    render(
      <BuddySessionBody
        body={{
          kind: 'cards',
          cards: [
            { kind: 'opener', text: 'Nice — 4 days this week.' },
            { kind: 'reckon', text: 'We said 4 days, and you got 4.' },
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

    const texts = legibleTextNodes()
    expect(texts.length).toBeGreaterThan(0)
    for (const node of texts) {
      const style = flattenStyle(node.props.style)
      expect(style.color).toBeDefined()
      expect(style.color).not.toBe('#000')
    }
  })

  // ── Escape ────────────────────────────────────────────────────────────────
  //
  // The route is registered with headerShown: false, so there is no system back
  // control. Without an in-screen exit the only way out is force-quitting the
  // app — which is what happened on device.

  it('offers a way out, and pressing it calls onClose', () => {
    const onClose = jest.fn()
    render(
      <BuddySessionBody body={{ kind: 'not_scheduled' }} onCommit={() => {}} onClose={onClose} />
    )

    fireEvent.press(screen.getByTestId('buddy-session-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
