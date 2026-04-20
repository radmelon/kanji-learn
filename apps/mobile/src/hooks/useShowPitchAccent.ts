/**
 * useShowPitchAccent.ts
 *
 * Ergonomic [value, setValue] wrapper around useProfile() for the
 * showPitchAccent preference. The canonical source is the server-side
 * user_profiles.show_pitch_accent column (migration 0020); this hook
 * just surfaces it as a tuple and forwards toggles through the
 * existing PATCH /v1/user/profile flow.
 *
 * Defaults to true when profile is unresolved (matches the SQL-level
 * default — opt-in by default, user can toggle off). Consumers that
 * need a "loading" state should use useProfile() directly.
 */

import { useCallback } from 'react'
import { useProfile } from './useProfile'

export function useShowPitchAccent(): [boolean, (v: boolean) => Promise<boolean>] {
  const { profile, update } = useProfile()
  const value = profile?.showPitchAccent ?? true

  const set = useCallback(
    (v: boolean) => update({ showPitchAccent: v }),
    [update],
  )

  return [value, set]
}
