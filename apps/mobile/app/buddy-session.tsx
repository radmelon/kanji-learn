import React, { useEffect } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useBuddyStore } from '../src/stores/buddy.store'
import { selectSessionBody } from '../src/lib/buddy-session-state'
import { BuddySessionBody } from '../src/components/buddy/BuddySessionBody'
import { colors } from '../src/theme'

export default function BuddySessionScreen() {
  const { hasLoaded, error, data, load, commit } = useBuddyStore()

  useEffect(() => { void load() }, [load])

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <BuddySessionBody
        body={selectSessionBody({ hasLoaded, error, data })}
        onCommit={(c) => { void commit(c) }}
      />
    </SafeAreaView>
  )
}
