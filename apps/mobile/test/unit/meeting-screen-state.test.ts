import { selectMeetingScreen } from '../../src/lib/meeting-screen-state'

const base = { settled: false, hasUi: false, pendingOffline: false, leaving: false }

describe('selectMeetingScreen', () => {
  it('shows a loader while begin() is still in flight', () => {
    expect(selectMeetingScreen(base).kind).toBe('loading')
  })

  it('shows the meeting once the UI exists', () => {
    expect(selectMeetingScreen({ ...base, settled: true, hasUi: true }).kind).toBe('meeting')
  })

  it('shows the pending-offline surface, even before begin() settles', () => {
    expect(selectMeetingScreen({ ...base, pendingOffline: true }).kind).toBe('pending_offline')
  })

  it('keeps the loader up while navigating away after already_done', () => {
    // begin() resolved 'already_done' and never set ui — the screen is about to
    // router.replace to the tabs. A spinner covers that gap; blank does not.
    expect(selectMeetingScreen({ ...base, settled: true, leaving: true }).kind).toBe('loading')
  })

  // The defect this file exists for. onboarding.tsx rendered
  // `<SafeAreaView style={styles.root} />` — an EMPTY view — whenever ui was
  // null. That covered the whole of begin()'s network round-trip with no
  // spinner, and covered it FOREVER when the request hung, because the API
  // client passed no AbortSignal so a stalled fetch never rejects.
  //
  // Same shape as B-227, which selectSessionBody was hardened against with the
  // note "surfacing an error beats falling through to a blank screen". The
  // meeting screen had the identical hole. Settled, no UI, nothing else to
  // explain it, is a real state and must say so.
  it('surfaces an error when begin() settled without producing a UI', () => {
    expect(selectMeetingScreen({ ...base, settled: true }).kind).toBe('error')
  })

  it('never returns a state that renders nothing', () => {
    const KNOWN = ['loading', 'meeting', 'pending_offline', 'error']
    for (const settled of [true, false]) {
      for (const hasUi of [true, false]) {
        for (const pendingOffline of [true, false]) {
          for (const leaving of [true, false]) {
            const got = selectMeetingScreen({ settled, hasUi, pendingOffline, leaving })
            expect(KNOWN).toContain(got.kind)
          }
        }
      }
    }
  })
})
