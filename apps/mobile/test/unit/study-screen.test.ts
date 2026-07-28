import { selectStudyScreen, type StudyScreenInput } from '../../src/lib/study-screen'

/**
 * B-216 — the Study tab locked the learner out with a false "All caught up!".
 *
 * The screen choice used to live as a sequence of early returns inside
 * study.tsx, which made the ordering untestable and hid the actual defect:
 * the empty-queue branch was evaluated BEFORE the Session Complete branch,
 * and Session Complete's `onDone` is the only `setPhase('ready')` in the file.
 * So an empty queue did not merely render wrong copy — it unmounted the sole
 * exit from the 'active' phase, and nothing but a force-quit brought it back.
 *
 * Extracted here as a pure function so the ordering is a fact under test
 * rather than a property of where a return statement happens to sit.
 */

const base: StudyScreenInput = {
  phase: 'active',
  isLoading: false,
  error: null,
  queueLength: 5,
  hasSessionSummary: false,
  queueEverPopulated: true,
  isSaving: false,
  isComplete: false,
}

describe('selectStudyScreen', () => {
  describe('B-216 regressions', () => {
    it('keeps Session Complete when the queue is emptied under it', () => {
      // The exact second report: a session finished, Session Complete was on
      // screen quoting "~241 kanji waiting", then a profile PATCH from the
      // co-creation location ask fired reset() and the queue went to zero.
      // Session Complete must survive — it carries the only way back to 'ready'.
      expect(
        selectStudyScreen({ ...base, hasSessionSummary: true, queueLength: 0 })
      ).toBe('sessionComplete')
    })

    it('offers recovery, not "All caught up!", when a live queue vanishes', () => {
      // The first report: abandonment mid-session. The queue had cards, then
      // did not. That is an unknown state, not a finished one.
      expect(
        selectStudyScreen({ ...base, queueLength: 0, queueEverPopulated: true })
      ).toBe('sessionLost')
    })

    it('still says "All caught up!" when the deck is genuinely exhausted', () => {
      // Begin tapped, load returned nothing. This is the one case where the
      // cheerful copy is true, and it must not regress into a recovery screen.
      expect(
        selectStudyScreen({ ...base, queueLength: 0, queueEverPopulated: false })
      ).toBe('empty')
    })
  })

  describe('ordering', () => {
    it('shows the Ready screen before anything loads', () => {
      expect(selectStudyScreen({ ...base, phase: 'ready', queueLength: 0 })).toBe('ready')
    })

    it('prefers Session Complete over the Ready screen', () => {
      // onDone clears the summary and sets 'ready' in one batched handler, so
      // these never disagree in practice — but if they ever do, a finished
      // session outranks a screen offering to start another one.
      expect(
        selectStudyScreen({ ...base, phase: 'ready', hasSessionSummary: true })
      ).toBe('sessionComplete')
    })

    it('shows the loading spinner while a queue is in flight', () => {
      expect(selectStudyScreen({ ...base, isLoading: true, queueLength: 0 })).toBe('loading')
    })

    it('does not call an in-flight load an empty deck', () => {
      // isLoading must be checked before queueLength, or every Begin tap
      // flashes "All caught up!" for a frame.
      expect(
        selectStudyScreen({ ...base, isLoading: true, queueLength: 0, queueEverPopulated: false })
      ).toBe('loading')
    })

    it('surfaces an error over an empty queue', () => {
      expect(
        selectStudyScreen({ ...base, error: 'network', queueLength: 0 })
      ).toBe('error')
    })

    it('shows the saving spinner while a session is being submitted', () => {
      expect(selectStudyScreen({ ...base, isSaving: true })).toBe('saving')
    })

    it('falls back to "Finishing up…" when complete but no summary yet', () => {
      expect(selectStudyScreen({ ...base, isComplete: true })).toBe('finishing')
    })

    it('renders cards in the ordinary case', () => {
      expect(selectStudyScreen(base)).toBe('cards')
    })
  })
})
