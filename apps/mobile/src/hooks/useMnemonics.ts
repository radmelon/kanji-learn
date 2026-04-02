import { useState, useCallback } from 'react'
import * as Location from 'expo-location'
import { api } from '../lib/api'

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
  refreshPromptAt: string | null
  createdAt: string
  updatedAt: string
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
  const [isGenerating, setIsGenerating] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await api.get<Mnemonic[]>(`/v1/mnemonics/${kanjiId}`)
      setMnemonics(data)
    } catch {
      // silently fail
    } finally {
      setIsLoading(false)
    }
  }, [kanjiId])

  const generate = useCallback(async (model: 'haiku' | 'sonnet' = 'haiku') => {
    setIsGenerating(true)
    try {
      const coords = await getCoords()
      const data = await api.post<Mnemonic>(`/v1/mnemonics/${kanjiId}/generate`, { model, ...coords })
      setMnemonics((prev) => [data, ...prev])
      return data
    } finally {
      setIsGenerating(false)
    }
  }, [kanjiId])

  const save = useCallback(async (storyText: string) => {
    const coords = await getCoords()
    const data = await api.post<Mnemonic>(`/v1/mnemonics/${kanjiId}`, { storyText, ...coords })
    setMnemonics((prev) => [data, ...prev])
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

  const dismissRefresh = useCallback(async (mnemonicId: string) => {
    await api.post(`/v1/mnemonics/${mnemonicId}/refresh/dismiss`)
    setMnemonics((prev) =>
      prev.map((m) => (m.id === mnemonicId ? { ...m, refreshPromptAt: null } : m))
    )
  }, [])

  return { mnemonics, isLoading, isGenerating, load, generate, save, update, updatePhoto, remove, dismissRefresh }
}

export function useRefreshDue() {
  const [due, setDue] = useState<Mnemonic[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await api.get<Mnemonic[]>('/v1/mnemonics/refresh')
      setDue(data)
    } catch {
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { due, isLoading, load }
}
