/**
 * Spec §5: the reading question is always asked, even when the meaning answer
 * was wrong. The old flow recorded a fail and skipped straight to the next
 * character, which made the reading offset unmeasurable — you only ever saw
 * reading results for kanji whose meaning was already known.
 *
 * This lives in the PURE lane, not test/components/. The plan (Task 13) placed
 * it in test/components/ as a .tsx using vitest's `vi.mock`, which cannot work
 * here on three counts: mobile has no vitest dependency (both lanes are Jest),
 * test/components/ is matched only by jest.components.config.js, and the task's
 * own verification command runs the pure lane, which explicitly ignores that
 * directory — so the file would never have executed. The plan's *reasoning* was
 * right though: assert the store's state transition rather than render an Expo
 * Router screen, which docs/local-build-and-test-protocol.md lists as a
 * "avoid as a first candidate" surface.
 */
jest.mock('../../src/lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn() },
}))
jest.mock('../../src/lib/storage', () => ({
  storage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}))

import { PlacementEngine } from '@kanji-learn/shared'
import { usePlacementStore } from '../../src/stores/placement.store'

const QUESTION = {
  kanjiId: 1,
  character: '日',
  jlptLevel: 'N5' as const,
  meaningOptions: ['sun', 'moon', 'tree', 'fire'],
  correctMeaningIndex: 0,
  readingOptions: ['ニチ', 'ゲツ', 'モク', 'カ'],
  correctReadingIndex: 0,
  bMeaning: -2,
  bReading: -1.6,
}

function seedStore() {
  usePlacementStore.setState({
    engine: new PlacementEngine({
      floorCharacters: 8,
      capCharacters: 24,
      bandWidth: 1.5,
      readingOffset: 0.4,
      priorMean: 0,
    }),
    questions: [QUESTION],
    currentQuestionIndex: 0,
    phase: 'meaning',
  } as never)
}

describe('placement store — the reading question always follows the meaning question', () => {
  beforeEach(seedStore)

  it('advances to the reading phase when the meaning answer is WRONG (the behaviour change)', async () => {
    await usePlacementStore.getState().answerMeaning(false)
    expect(usePlacementStore.getState().phase).toBe('reading')
  })

  it('advances to the reading phase when the meaning answer is right', async () => {
    await usePlacementStore.getState().answerMeaning(true)
    expect(usePlacementStore.getState().phase).toBe('reading')
  })

  it('records the meaning item against the engine either way, so theta moves on a miss', async () => {
    const engine = usePlacementStore.getState().engine!
    const before = engine.getThetaHat()

    await usePlacementStore.getState().answerMeaning(false)

    expect(engine.getAskedKanjiIds()).toContain(QUESTION.kanjiId)
    // A miss on an easy item (b = -2) must pull the ability estimate down.
    expect(engine.getThetaHat()).toBeLessThan(before)
  })
})
