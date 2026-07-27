import { useState, useCallback } from 'react'
import * as Location from 'expo-location'
import type { CoCreationContext } from '@kanji-learn/shared'
import { api } from '../lib/api'
import { storage } from '../lib/storage'

const CACHE_KEY = 'kl:mnemonics_cache'

type MnemonicsCache = Record<number, { cachedAt: number; mnemonics: Mnemonic[] }>

async function readCache(kanjiId: number): Promise<Mnemonic[] | null> {
  const cache = await storage.getItem<MnemonicsCache>(CACHE_KEY)
  return cache?.[kanjiId]?.mnemonics ?? null
}

async function writeCache(kanjiId: number, mnemonics: Mnemonic[]): Promise<void> {
  const cache = (await storage.getItem<MnemonicsCache>(CACHE_KEY)) ?? {}
  await storage.setItem(CACHE_KEY, { ...cache, [kanjiId]: { cachedAt: Date.now(), mnemonics } })
}

export interface Mnemonic {
  id: string
  kanjiId: number
  userId: string | null
  type: 'system' | 'user'
  storyText: string
  imagePrompt: string | null
  imageUrl: string | null
  latitude: number | null
  longitude: number | null
  createdAt: string
  updatedAt: string
  // Present on API responses (mnemonic.service.ts toRecord); optional here so
  // older cached payloads without them still satisfy the type.
  generationMethod?: 'system' | 'user' | 'cocreated'
  /** The hook's whole history — every layer, where it was built, which tier
   *  assembled it. Null for anything not co-created. */
  cocreationContext?: CoCreationContext | null
}

async function getCoords(): Promise<{ latitude: number; longitude: number } | undefined> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') return undefined
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    return { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
  } catch {
    return undefined
  }
}

export function useMnemonics(kanjiId: number) {
  const [mnemonics, setMnemonics] = useState<Mnemonic[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)

    // Show cache immediately
    const cached = await readCache(kanjiId)
    if (cached) setMnemonics(cached)

    try {
      const data = await api.get<Mnemonic[]>(`/v1/mnemonics/${kanjiId}`)
      setMnemonics(data)
      await writeCache(kanjiId, data)
    } catch {
      // Already showing cache if available — silently fail
    } finally {
      setIsLoading(false)
    }
  }, [kanjiId])

  // `generate` is gone — parent spec §10.2 retires the cloud-LLM *auto*-generation
  // UX. The capability is not lost, it moved: the same models now assemble from
  // co-creation slots via `assembleCloud` (cocreationApi.ts), where the learner's
  // own anchor is the raw material. A button that produces a story about a kanji
  // the learner had no hand in is exactly what Phase 5 replaces.

  const save = useCallback(async (storyText: string) => {
    const coords = await getCoords()
    const data = await api.post<Mnemonic>(`/v1/mnemonics/${kanjiId}`, { storyText, ...coords })
    setMnemonics((prev) => {
      const updated = [data, ...prev]
      writeCache(kanjiId, updated)
      return updated
    })
    return data
  }, [kanjiId])

  const update = useCallback(async (mnemonicId: string, storyText: string) => {
    const data = await api.patch<Mnemonic>(`/v1/mnemonics/${mnemonicId}`, { storyText })
    setMnemonics((prev) => prev.map((m) => (m.id === mnemonicId ? data : m)))
  }, [])

  const updatePhoto = useCallback(async (mnemonicId: string, imageUrl: string | null) => {
    const data = await api.patch<Mnemonic>(`/v1/mnemonics/${mnemonicId}`, { imageUrl })
    setMnemonics((prev) => prev.map((m) => (m.id === mnemonicId ? data : m)))
  }, [])

  const remove = useCallback(async (mnemonicId: string) => {
    await api.delete(`/v1/mnemonics/${mnemonicId}`)
    setMnemonics((prev) => prev.filter((m) => m.id !== mnemonicId))
  }, [])

  return { mnemonics, isLoading, load, save, update, updatePhoto, remove }
}
