import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { TutorNote } from '../../src/components/notebook/TutorNote'

const jaNote = {
  id: 'n1', body: '説明をもう一度', language: 'ja',
  translation: null, createdAt: '2026-08-01T00:00:00Z',
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle))
  return (style ?? {}) as Record<string, unknown>
}

function legibleTextNodes() {
  const { Text } = require('react-native')
  return screen.UNSAFE_getAllByType(Text)
    .filter((n: { props: { children?: unknown } }) => typeof n.props.children === 'string')
}

describe('TutorNote', () => {
  // Spec decision #8: a tutor may write in Japanese deliberately, to be read.
  it('renders the note as written, untranslated', () => {
    render(<TutorNote note={jaNote} onLookupKanji={() => {}} onSpeak={() => {}} onTranslate={() => {}} />)
    expect(screen.getByText('説明をもう一度')).toBeTruthy()
    expect(screen.queryByTestId('tutor-note-translation')).toBeNull()
  })

  it('makes each kanji tappable for lookup', () => {
    const onLookupKanji = jest.fn()
    render(<TutorNote note={jaNote} onLookupKanji={onLookupKanji} onSpeak={() => {}} onTranslate={() => {}} />)
    fireEvent.press(screen.getByTestId('tutor-note-kanji-説'))
    expect(onLookupKanji).toHaveBeenCalledWith('説')
  })

  it('offers translation as a deliberate action, not a default', () => {
    const onTranslate = jest.fn()
    render(<TutorNote note={jaNote} onLookupKanji={() => {}} onSpeak={() => {}} onTranslate={onTranslate} />)
    fireEvent.press(screen.getByTestId('tutor-note-translate'))
    expect(onTranslate).toHaveBeenCalledWith('n1')
  })

  it('records that translation was used once it is present', () => {
    render(
      <TutorNote note={{ ...jaNote, translation: 'Explain it once more' }}
        onLookupKanji={() => {}} onSpeak={() => {}} onTranslate={() => {}} />
    )
    expect(screen.getByTestId('tutor-note-translation')).toBeTruthy()
    expect(screen.getByTestId('tutor-note-translated-marker')).toBeTruthy()
  })

  // Task 9 Step 5: there is no translation endpoint, and the plan never
  // specified one. A control that does nothing is worse than a control that
  // is not there, so the translate affordance must not appear unless a
  // caller actually supplies a handler for it.
  it('omits the translate control when onTranslate is not supplied', () => {
    render(<TutorNote note={jaNote} onLookupKanji={() => {}} onSpeak={() => {}} />)
    expect(screen.queryByTestId('tutor-note-translate')).toBeNull()
  })

  // B146: a screen rendered correctly and was invisible — black default text
  // on #0F0F1A. getByText finds text whatever colour it is, and the tests
  // above would all pass on an all-black render. Assert colour explicitly,
  // and assert the node list is non-empty so this cannot pass vacuously.
  it('renders every string in an explicit colour, including a translation', () => {
    render(
      <TutorNote note={{ ...jaNote, translation: 'Explain it once more' }}
        onLookupKanji={() => {}} onSpeak={() => {}} onTranslate={() => {}} />
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
