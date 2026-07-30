import { journalListState } from '../../src/lib/journal-list-state'

describe('journalListState (B-227)', () => {
  it('shows a spinner on a cold start — the regression test', () => {
    // The exact state that rendered nothing: no selection, nothing loaded,
    // no cache. Previously this produced neither list nor empty state.
    expect(journalListState({ hasSelectedKanji: false, hooksLoaded: false, hookCount: 0 })).toBe(
      'loading',
    )
  })

  it('never renders an empty body — every input lands on a real state', () => {
    for (const hasSelectedKanji of [true, false]) {
      for (const hooksLoaded of [true, false]) {
        for (const hookCount of [0, 3]) {
          const state = journalListState({ hasSelectedKanji, hooksLoaded, hookCount })
          expect(['loading', 'empty', 'list']).toContain(state)
        }
      }
    }
  })

  it('paints cached hooks immediately rather than showing a spinner over them', () => {
    // useUserHooks fills `hooks` from storage before the network resolves, so
    // hooksLoaded is still false while there is already content to show.
    expect(journalListState({ hasSelectedKanji: false, hooksLoaded: false, hookCount: 4 })).toBe(
      'list',
    )
  })

  it('only claims "no hooks yet" once a load has actually completed', () => {
    expect(journalListState({ hasSelectedKanji: false, hooksLoaded: true, hookCount: 0 })).toBe(
      'empty',
    )
  })

  it('defers to the kanji-detail list when a kanji is selected', () => {
    expect(journalListState({ hasSelectedKanji: true, hooksLoaded: false, hookCount: 0 })).toBe(
      'list',
    )
  })
})
