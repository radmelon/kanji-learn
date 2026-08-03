import React, { useEffect } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
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
        // The route sets headerShown: false, so this is the only way out. A push
        // notification can open this screen from a killed app, where there is no
        // back stack to swipe to — dismiss to the tabs rather than to nothing.
        onClose={() => {
          if (router.canGoBack()) router.back()
          else router.replace('/(tabs)')
        }}
      />
    </SafeAreaView>
  )
}
