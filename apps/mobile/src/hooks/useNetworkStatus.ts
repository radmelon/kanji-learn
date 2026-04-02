import { useState, useEffect, useCallback } from 'react'
import { AppState } from 'react-native'

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? ''
const HEALTH_URL = `${API_BASE}/health`
const TIMEOUT_MS = 3000

async function probe(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const res = await fetch(HEALTH_URL, { method: 'GET', signal: controller.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true)

  const check = useCallback(async () => {
    const online = await probe()
    setIsOnline(online)
    return online
  }, [])

  useEffect(() => {
    check()
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check()
    })
    return () => sub.remove()
  }, [check])

  return { isOnline, check }
}
