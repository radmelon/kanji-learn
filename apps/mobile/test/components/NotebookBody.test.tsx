import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { NotebookBody } from '../../src/components/notebook/NotebookBody'
import { assembleNotebook } from '@kanji-learn/shared'
import type { NotebookSection, NotebookView } from '@kanji-learn/shared'

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle))
  return (style ?? {}) as Record<string, unknown>
}

function legibleTextNodes() {
  const { Text } = require('react-native')
  return screen.UNSAFE_getAllByType(Text)
    .filter((n: { props: { children?: unknown } }) => typeof n.props.children === 'string')
}

const baseSections: NotebookSection[] = [
  { key: 'observations', title: 'What Buddy notices', live: [], archived: [] },
  { key: 'settled', title: "What we've settled", live: [], archived: [] },
]

const empty: NotebookView = {
  cadence: { intervalWeeks: 1, buddyDay: 0 },
  agreement: null, pastAgreements: [], experiment: null,
  sections: baseSections,
  tutorNotes: [], isEmpty: true,
}

const noop = () => {}

// B146: a screen rendered correctly and was invisible — black default text on
// #0F0F1A. getByText finds text whatever colour it is. Colour is asserted
// explicitly below, across every view state the component can render — a
// fixture that only exercises one branch leaves the rest unguarded.
//
// Each fixture below is named for the branch it is responsible for turning
// on. Between them they cover: the empty state (pendingBody, emptyTitle,
// emptyBody), a pending agreement outside the empty state, an agreement with
// a non-null focus (entryMeta), a live experiment, and a tutor note with a
// non-null translation (entryMeta again, via a different branch).
const colorFixtures: { name: string; view: NotebookView }[] = [
  {
    name: 'empty state',
    view: empty,
  },
  {
    name: 'pending agreement (no agreement yet, not otherwise empty)',
    view: {
      cadence: { intervalWeeks: 1, buddyDay: 0 },
      agreement: null, pastAgreements: [], experiment: null,
      sections: [
        {
          key: 'observations', title: 'What Buddy notices',
          live: [{ id: 'a', body: 'Your hooks are landing', author: 'buddy', createdAt: '2026-08-01T00:00:00Z', editableBy: ['learner'] }],
          archived: [],
        },
        { key: 'settled', title: "What we've settled", live: [], archived: [] },
      ],
      tutorNotes: [], isEmpty: false,
    },
  },
  {
    name: 'agreement with a focus',
    view: {
      cadence: { intervalWeeks: 1, buddyDay: 0 },
      agreement: { weekStart: '2026-08-03', daysCommitted: 4, minutesPerDay: 15, focus: 'Stroke order', source: 'session' },
      pastAgreements: [], experiment: null,
      sections: baseSections,
      tutorNotes: [], isEmpty: false,
    },
  },
  {
    name: 'live experiment',
    view: {
      cadence: { intervalWeeks: 1, buddyDay: 0 },
      agreement: { weekStart: '2026-08-03', daysCommitted: 4, minutesPerDay: 15, focus: null, source: 'session' },
      pastAgreements: [],
      experiment: { weekStart: '2026-08-10', daysCommitted: 5, minutesPerDay: 20, focus: null, source: 'session' },
      sections: baseSections,
      tutorNotes: [], isEmpty: false,
    },
  },
  {
    name: 'tutor note with a translation',
    view: {
      cadence: { intervalWeeks: 1, buddyDay: 0 },
      agreement: { weekStart: '2026-08-03', daysCommitted: 4, minutesPerDay: 15, focus: null, source: 'session' },
      pastAgreements: [], experiment: null,
      sections: baseSections,
      tutorNotes: [
        {
          shareId: 's1', tutorLabel: 'Notes from Tanaka-sensei',
          notes: [
            { id: 't1', body: 'Great pronunciation today', language: 'en', translation: '発音が良かったです', createdAt: '2026-08-01T00:00:00Z' },
          ],
        },
      ],
      isEmpty: false,
    },
  },
]

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

  it.each(colorFixtures)('renders every string in an explicit colour — $name', ({ view }) => {
    render(<NotebookBody view={view} onAdd={noop} onEdit={noop} onDelete={noop} />)
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

  it('marks the entry Pressable as an accessible edit button', () => {
    const view: NotebookView = {
      cadence: { intervalWeeks: 1, buddyDay: 0 },
      agreement: null, pastAgreements: [], experiment: null,
      sections: [
        {
          key: 'observations', title: 'What Buddy notices',
          live: [{ id: 'a', body: 'Your hooks are landing', author: 'buddy', createdAt: '2026-08-01T00:00:00Z', editableBy: ['learner'] }],
          archived: [],
        },
        { key: 'settled', title: "What we've settled", live: [], archived: [] },
      ],
      tutorNotes: [], isEmpty: false,
    }
    render(<NotebookBody view={view} onAdd={noop} onEdit={noop} onDelete={noop} />)
    expect(screen.getByRole('button', { name: 'Edit entry' })).toBeTruthy()
  })

  // Every fixture above hand-builds `sections` in a shape assembleNotebook
  // never actually produces — which is exactly why the tutor-note duplicate
  // bug (a `key: 'tutor'` entry BOTH in `sections` and in `tutorNotes`,
  // wired to the learner-edit PATCH path) went unnoticed. This test goes
  // through the real function instead of a fixture.
  it('renders a tutor note exactly once when fed the literal output of assembleNotebook', () => {
    const view = assembleNotebook({
      cadence: { intervalWeeks: 1, buddyDay: 0 },
      commitments: [],
      entries: [],
      tutorNotes: [
        {
          shareId: 's1',
          tutorLabel: 'Ono Kumiko',
          notes: [
            {
              id: 'n1',
              body: 'Great pronunciation today',
              language: 'en',
              translation: null,
              createdAt: '2026-08-01T00:00:00Z',
            },
          ],
        },
      ],
    })

    render(<NotebookBody view={view} onAdd={noop} onEdit={noop} onDelete={noop} />)

    expect(screen.getAllByText('Great pronunciation today')).toHaveLength(1)
    // A tutor note must never be reachable through the learner-edit path —
    // there must be no "Edit entry" Pressable wrapping it.
    expect(screen.queryAllByRole('button', { name: 'Edit entry' })).toHaveLength(0)
  })

  // notebook-cadence-control had testID/accessibilityRole/accessibilityLabel/
  // hitSlop and no onPress — a dead button. Same discipline as onTranslate in
  // TutorNote: the control renders only when a caller actually supplies a
  // handler, never as a control that does nothing.
  it('omits the cadence control when no onChangeCadence handler is supplied', () => {
    render(<NotebookBody view={empty} onAdd={noop} onEdit={noop} onDelete={noop} />)
    expect(screen.queryByTestId('notebook-cadence-control')).toBeNull()
  })

  it('renders the cadence control and calls the handler when onChangeCadence is supplied', () => {
    const onChangeCadence = jest.fn()
    render(
      <NotebookBody
        view={empty} onAdd={noop} onEdit={noop} onDelete={noop}
        onChangeCadence={onChangeCadence}
      />
    )
    const control = screen.getByTestId('notebook-cadence-control')
    expect(control).toBeTruthy()
    fireEvent.press(control)
    expect(onChangeCadence).toHaveBeenCalledTimes(1)
  })
})
