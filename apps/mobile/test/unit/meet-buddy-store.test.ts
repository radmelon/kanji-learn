// The store transitively imports react-native (AsyncStorage directly, and
// api.ts -> auth.store.ts -> react-native) — see meeting-payload.ts's header
// comment for the fuller story. Mocking those three boundary modules keeps
// the real store's own logic (begin/finish/skip) importable and testable in
// the pure node lane, the same pattern notebook-store.test.ts established.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}))
jest.mock('../../src/lib/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}))
jest.mock('../../src/hooks/useProfile', () => ({ refreshProfile: jest.fn() }))

import AsyncStorage from '@react-native-async-storage/async-storage'
import { api } from '../../src/lib/api'
import { useMeetBuddyStore, KEY_PENDING_MEET } from '../../src/stores/meet-buddy.store'

const PROFILE_BASE = {
  onboardingCompletedAt: null as string | null,
  dailyGoal: 15,
  timezone: 'America/Los_Angeles',
  restDay: null as number | null,
  buddyDay: 2,
  buddyIntervalWeeks: 1,
  metBuddyAt: '2026-01-01T00:00:00Z',
}
const LEARNER = { reasonsForLearning: ['Travel'], interests: ['cooking'] }

describe('useMeetBuddyStore.begin — re-entry (F3, whole-branch review HIGH)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useMeetBuddyStore.setState({ ui: null, error: null })
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValue(null) // no pending stash by default
  })

  it('bails already_done on a normal (non-revisit) launch once already met — control', async () => {
    ;(api.get as jest.Mock).mockResolvedValueOnce(PROFILE_BASE).mockResolvedValueOnce(LEARNER)
    const result = await useMeetBuddyStore.getState().begin()
    expect(result).toBe('already_done')
    expect(useMeetBuddyStore.getState().ui).toBeNull()
  })

  it('a revisit does NOT bail even though metBuddyAt is already set — the Profile row was otherwise inert', async () => {
    ;(api.get as jest.Mock).mockResolvedValueOnce(PROFILE_BASE).mockResolvedValueOnce(LEARNER)
    const result = await useMeetBuddyStore.getState().begin({ revisit: true })
    expect(result).toBe('ready')
    expect(useMeetBuddyStore.getState().ui).not.toBeNull()
  })

  it('a revisit derives hadPriorData from metBuddyAt even when onboardingCompletedAt was never stamped', async () => {
    ;(api.get as jest.Mock).mockResolvedValueOnce(PROFILE_BASE).mockResolvedValueOnce(LEARNER)
    await useMeetBuddyStore.getState().begin({ revisit: true })
    const ui = useMeetBuddyStore.getState().ui!
    expect(ui.collected.hadPriorData).toBe(true)
    expect(ui.collected.reasons).toEqual(['Travel'])
    expect(ui.collected.interests).toEqual(['cooking'])
    expect(ui.collected.buddyDay).toBe(2)
  })

  it('a revisit still flushes any pending stash first, but does not bounce away afterwards', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({
        profilePatch: {},
        learnerPatch: null,
        completePayload: {
          outcome: 'skipped', reasons: [], interests: [], ruler: null,
          dailyGoal: null, buddyDay: null, buddyIntervalWeeks: 1, transcript: null,
        },
      }),
    )
    ;(api.patch as jest.Mock).mockResolvedValue({})
    ;(api.post as jest.Mock).mockResolvedValue({})
    ;(api.get as jest.Mock).mockResolvedValueOnce(PROFILE_BASE).mockResolvedValueOnce(LEARNER)

    const result = await useMeetBuddyStore.getState().begin({ revisit: true })

    expect(api.post).toHaveBeenCalledWith('/v1/buddy/meet/complete', expect.anything())
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(KEY_PENDING_MEET)
    expect(result).toBe('ready')
  })
})

const STASH_JSON = JSON.stringify({
  profilePatch: {},
  learnerPatch: null,
  completePayload: {
    outcome: 'skipped', reasons: [], interests: [], ruler: null,
    dailyGoal: null, buddyDay: null, buddyIntervalWeeks: 1, transcript: null,
  },
})

// F4(a) (whole-branch review, HIGH): a non-revisit begin() with a pending
// stash always returned 'already_done', which the screen treats as "go to
// tabs" — regardless of whether flushPendingMeetBuddy actually succeeded.
// A learner still offline got bounced to tabs every launch with no visible
// notice and no way to retry: the queue was invisible and the redirect gate
// (_layout.tsx checks !profile.metBuddyAt) would keep sending them right
// back to /onboarding, since the server was never told. Infinite loop.
describe('useMeetBuddyStore.begin — a failed stash flush must not bounce silently (F4a)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useMeetBuddyStore.setState({ ui: null, error: null })
  })

  it('returns pending_offline, not already_done, when a stash exists and the flush fails', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValue(STASH_JSON)
    ;(api.patch as jest.Mock).mockRejectedValue(new Error('offline'))
    const result = await useMeetBuddyStore.getState().begin()
    expect(result).toBe('pending_offline')
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled()
  })

  it('still returns already_done when the stash exists and the flush succeeds — control', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValue(STASH_JSON)
    ;(api.patch as jest.Mock).mockResolvedValue({})
    ;(api.post as jest.Mock).mockResolvedValue({})
    const result = await useMeetBuddyStore.getState().begin()
    expect(result).toBe('already_done')
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(KEY_PENDING_MEET)
  })
})
