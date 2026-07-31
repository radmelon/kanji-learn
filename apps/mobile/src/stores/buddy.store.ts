import { create } from 'zustand'
import { api } from '../lib/api'
import type { SessionCommitment, SessionData } from '../lib/buddy-session-state'

interface BuddyState {
  hasLoaded: boolean
  error: string | null
  data: SessionData | null
  load: () => Promise<void>
  commit: (c: SessionCommitment) => Promise<void>
}

export const useBuddyStore = create<BuddyState>((set, get) => ({
  hasLoaded: false,
  error: null,
  data: null,

  load: async () => {
    set({ hasLoaded: false, error: null })
    try {
      const data = await api.get<SessionData>('/v1/buddy/session')
      set({ hasLoaded: true, data, error: null })
    } catch (e) {
      set({ hasLoaded: true, error: e instanceof Error ? e.message : 'Failed to load', data: null })
    }
  },

  commit: async (c) => {
    try {
      await api.post('/v1/buddy/session/commitment', {
        weekStart: c.weekStart,
        daysCommitted: c.daysCommitted,
        minutesPerDay: c.minutesPerDay,
        dayTargets: c.dayTargets,
        focus: c.focus,
      })
      await get().load()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to save' })
    }
  },
}))
