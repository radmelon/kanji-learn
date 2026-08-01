import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { NotebookBody } from '../../src/components/notebook/NotebookBody'
import type { NotebookView } from '@kanji-learn/shared'

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle))
  return (style ?? {}) as Record<string, unknown>
}

function legibleTextNodes() {
  const { Text } = require('react-native')
  return screen.UNSAFE_getAllByType(Text)
    .filter((n: { props: { children?: unknown } }) => typeof n.props.children === 'string')
}

const empty: NotebookView = {
  cadence: { intervalWeeks: 1, buddyDay: 0 },
  agreement: null, pastAgreements: [], experiment: null,
  sections: [
    { key: 'observations', title: 'What Buddy notices', live: [], archived: [] },
    { key: 'settled', title: "What we've settled", live: [], archived: [] },
  ],
  tutorNotes: [], isEmpty: true,
}

const noop = () => {}

describe('NotebookBody', () => {
  it('renders a dignified empty state rather than empty panels', () => {
    render(<NotebookBody view={empty} onAdd={noop} onEdit={noop} onDelete={noop} />)
    expect(screen.getByTestId('notebook-empty')).toBeTruthy()
  })

  it('shows the cadence as state and control, with no miss tally', () => {
    render(<NotebookBody view={empty} onAdd={noop} onEdit={noop} onDelete={noop} />)
    const text = legibleTextNodes().map((n: { props: { children: string } }) => n.props.children).join(' ')
    expect(text).toMatch(/weekly/i)
    expect(text).not.toMatch(/missed/i)
    expect(text).not.toMatch(/\d+ of \d+/)
  })

  // B146: a screen rendered correctly and was invisible — black default text on
  // #0F0F1A. getByText finds text whatever colour it is.
  it('renders every string in an explicit colour', () => {
    render(
      <NotebookBody
        view={{
          ...empty, isEmpty: false,
          agreement: { weekStart: '2026-08-03', daysCommitted: 4, minutesPerDay: 15, focus: null, source: 'session' },
          sections: [
            { key: 'observations', title: 'What Buddy notices',
              live: [{ id: 'a', body: 'Your hooks are landing', author: 'buddy', createdAt: '2026-08-01T00:00:00Z', editableBy: ['learner'] }],
              archived: [] },
          ],
        }}
        onAdd={noop} onEdit={noop} onDelete={noop}
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

  it('shows the agreement section as anticipated, not missing, when there is none', () => {
    render(<NotebookBody view={empty} onAdd={noop} onEdit={noop} onDelete={noop} />)
    expect(screen.getByTestId('notebook-agreement-pending')).toBeTruthy()
  })

  it('omits the tutor section when there is no share', () => {
    render(<NotebookBody view={empty} onAdd={noop} onEdit={noop} onDelete={noop} />)
    expect(screen.queryByTestId('notebook-section-tutor')).toBeNull()
  })
})
