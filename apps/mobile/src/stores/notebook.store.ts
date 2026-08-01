import { create } from 'zustand'
import { api } from '../lib/api'
import type { NotebookView } from '@kanji-learn/shared'

interface NotebookState {
  hasLoaded: boolean
  error: string | null
  view: NotebookView | null
  load: () => Promise<void>
  addEntry: (kind: 'observation' | 'decision', body: string) => Promise<void>
  editEntry: (id: string, body: string) => Promise<void>
  deleteEntry: (id: string) => Promise<void>
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  hasLoaded: false,
  error: null,
  view: null,

  load: async () => {
    set({ hasLoaded: false, error: null })
    try {
      const view = await api.get<NotebookView>('/v1/buddy/notebook')
      set({ hasLoaded: true, view, error: null })
    } catch (e) {
      set({ hasLoaded: true, view: null, error: e instanceof Error ? e.message : 'Failed to load' })
    }
  },

  addEntry: async (kind, body) => {
    try {
      await api.post('/v1/buddy/notebook/entries', { kind, body })
      await get().load()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to save' })
    }
  },

  editEntry: async (id, body) => {
    try {
      await api.patch(`/v1/buddy/notebook/entries/${id}`, { body })
      await get().load()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to save' })
    }
  },

  deleteEntry: async (id) => {
    try {
      await api.delete(`/v1/buddy/notebook/entries/${id}`)
      await get().load()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to save' })
    }
  },
}))
