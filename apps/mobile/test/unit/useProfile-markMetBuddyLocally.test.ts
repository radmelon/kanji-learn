// useProfile.ts imports useAuthStore directly (not gated behind api.ts), and
// auth.store.ts imports 'react-native' (NativeModules, Platform) — mock it
// so this module is importable in the pure node lane without ever calling
// the useProfile() hook itself (only the plain functions below are used).
jest.mock('../../src/lib/api', () => ({ api: { get: jest.fn(), patch: jest.fn() } }))
jest.mock('../../src/stores/auth.store', () => ({ useAuthStore: jest.fn() }))

import { api } from '../../src/lib/api'
import { refreshProfile, markMetBuddyLocally, getCachedProfile, clearProfileCache } from '../../src/hooks/useProfile'

describe('markMetBuddyLocally (F4a, whole-branch review HIGH)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clearProfileCache()
  })

  it('does nothing when there is no cached profile yet', () => {
    markMetBuddyLocally()
    expect(getCachedProfile()).toBeNull()
  })

  it('stamps metBuddyAt on the cached profile WITHOUT a network call, so a failed stash flush stops the gate bouncing', async () => {
    ;(api.get as jest.Mock).mockResolvedValue({ id: 'u1', metBuddyAt: null })
    await refreshProfile()
    expect(getCachedProfile()?.metBuddyAt).toBeNull()

    markMetBuddyLocally()

    expect(getCachedProfile()?.metBuddyAt).toBeTruthy()
    expect(api.get).toHaveBeenCalledTimes(1) // only refreshProfile's fetch — no network call from the stamp itself
  })
})
