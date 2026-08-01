import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { NotebookEntryModal } from '../../src/components/notebook/NotebookEntryModal'
import type { NotebookEntry } from '@kanji-learn/shared'

// B146: a screen rendered correctly and was invisible — black default text on
// #0F0F1A. getByText finds text whatever colour it is. Colour is asserted
// explicitly below (mirrors NotebookBody.test.tsx) — do not defeat it.
function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle))
  return (style ?? {}) as Record<string, unknown>
}

function legibleTextNodes() {
  const { Text } = require('react-native')
  return screen.UNSAFE_getAllByType(Text)
    .filter((n: { props: { children?: unknown } }) => typeof n.props.children === 'string')
}

const existingEntry: NotebookEntry = {
  id: 'e1',
  body: 'Noticed 食 sticking better after the radio drama story',
  author: 'learner',
  createdAt: '2026-08-01T00:00:00Z',
  editableBy: ['learner'],
}

const noop = () => {}

describe('NotebookEntryModal', () => {
  it('renders nothing when not visible', () => {
    render(
      <NotebookEntryModal visible={false} entry={null} onSubmit={noop} onDelete={noop} onCancel={noop} />
    )
    expect(screen.queryByText('Add a note')).toBeNull()
    expect(screen.queryByText('Edit note')).toBeNull()
  })

  it('shows the existing body when editing an entry', () => {
    render(
      <NotebookEntryModal visible entry={existingEntry} onSubmit={noop} onDelete={noop} onCancel={noop} />
    )
    expect(screen.getByText('Edit note')).toBeTruthy()
    expect(screen.getByDisplayValue(existingEntry.body)).toBeTruthy()
  })

  it('shows an empty field when adding', () => {
    render(
      <NotebookEntryModal visible entry={null} onSubmit={noop} onDelete={noop} onCancel={noop} />
    )
    expect(screen.getByText('Add a note')).toBeTruthy()
    expect(screen.getByPlaceholderText('What did you notice, or what did you decide?').props.value).toBe('')
  })

  it('calls onSubmit with the typed text', () => {
    const onSubmit = jest.fn()
    render(
      <NotebookEntryModal visible entry={null} onSubmit={onSubmit} onDelete={noop} onCancel={noop} />
    )
    const input = screen.getByPlaceholderText('What did you notice, or what did you decide?')
    fireEvent.changeText(input, 'A brand new observation')
    fireEvent.press(screen.getByText('Save note'))
    expect(onSubmit).toHaveBeenCalledWith('A brand new observation')
  })

  it('shows the delete control only when editing, never when adding', () => {
    const { rerender } = render(
      <NotebookEntryModal visible entry={existingEntry} onSubmit={noop} onDelete={noop} onCancel={noop} />
    )
    expect(screen.getByTestId('notebook-entry-modal-delete')).toBeTruthy()

    rerender(
      <NotebookEntryModal visible entry={null} onSubmit={noop} onDelete={noop} onCancel={noop} />
    )
    expect(screen.queryByTestId('notebook-entry-modal-delete')).toBeNull()
  })

  it('calls onDelete with the entry being edited when the delete control is pressed', () => {
    const onDelete = jest.fn()
    render(
      <NotebookEntryModal visible entry={existingEntry} onSubmit={noop} onDelete={onDelete} onCancel={noop} />
    )
    fireEvent.press(screen.getByTestId('notebook-entry-modal-delete'))
    expect(onDelete).toHaveBeenCalledWith(existingEntry)
  })

  it('renders every string in an explicit colour that is not #000', () => {
    render(
      <NotebookEntryModal visible entry={existingEntry} onSubmit={noop} onDelete={noop} onCancel={noop} />
    )
    const texts = legibleTextNodes()
    expect(texts.length).toBeGreaterThan(0)
    for (const node of texts) {
      const style = flattenStyle(node.props.style)
      expect(style.color).toBeDefined()
      expect(style.color).not.toBe('#000')
    }
  })
})
