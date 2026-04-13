// apps/mobile/src/hooks/useLearnerProfile.ts
//
// Fetches and caches the current user's learner profile.
// Used by onboarding.tsx (to write on completion) and
// profile.tsx (to read + edit).

import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'

export type LearnerProfile = {
  country: string | null
  reasonsForLearning: string[]
  interests: string[]
}

let _cache: LearnerProfile | null = null
let _fetching = false
const _listeners = new Set<(p: LearnerProfile | null) => void>()

function notify(profile: LearnerProfile | null) {
  _listeners.forEach((fn) => fn(profile))
}

export function clearLearnerProfileCache() {
  _cache = null
  notify(null)
}

export function useLearnerProfile() {
  const [learnerProfile, setLearnerProfile] = useState<LearnerProfile | null>(_cache)
  const [isLoading, setIsLoading] = useState(_cache === null)

  useEffect(() => {
    _listeners.add(setLearnerProfile)
    return () => { _listeners.delete(setLearnerProfile) }
  }, [])

  useEffect(() => {
    if (_cache) {
      setLearnerProfile(_cache)
      setIsLoading(false)
      return
    }
    if (_fetching) return

    _fetching = true
    api
      .get<LearnerProfile>('/v1/user/learner-profile')
      .then((data) => {
        _cache = data
        notify(data)
      })
      .catch(() => {})
      .finally(() => {
        _fetching = false
        setIsLoading(false)
      })
  }, [])

  const update = useCallback(async (fields: Partial<LearnerProfile>): Promise<boolean> => {
    try {
      await api.patch<void>('/v1/user/learner-profile', fields)
      const next: LearnerProfile = {
        country: 'country' in fields ? (fields.country ?? null) : (_cache?.country ?? null),
        reasonsForLearning: fields.reasonsForLearning ?? _cache?.reasonsForLearning ?? [],
        interests: fields.interests ?? _cache?.interests ?? [],
      }
      _cache = next
      notify(next)
      return true
    } catch {
      return false
    }
  }, [])

  return { learnerProfile, isLoading, update }
}
