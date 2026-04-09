import '../src/polyfills'
import { useEffect, useRef } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Audio } from 'expo-av'
import { useAuthStore } from '../src/stores/auth.store'
import { usePushNotifications } from '../src/hooks/usePushNotifications'
import { useNetworkStatus } from '../src/hooks/useNetworkStatus'
import { useReviewStore } from '../src/stores/review.store'
import { colors } from '../src/theme'

// Configure the iOS audio session ONCE at module load time — before React starts.
// This sets playsInSilentModeIOS so expo-speech plays through the ringer switch.
// We call it here (module scope) rather than in a component effect because:
//   - Module scope runs once, ever. No repeat calls that destabilise expo-av v16.
//   - Component effects run on every mount/unmount — KanjiCard mounts repeatedly
//     in weak-spots queues, which was causing expo-av v16 native bridge instability.
Audio.setAudioModeAsync({
  allowsRecordingIOS: false,
  playsInSilentModeIOS: true,
  staysActiveInBackground: false,
  shouldDuckAndroid: true,
  playThroughEarpieceAndroid: false,
}).catch(() => {})

export default function RootLayout() {
  const { isInitialized, session, initialize } = useAuthStore()
  const router = useRouter()
  const segments = useSegments()
  const { isOnline } = useNetworkStatus()
  const wasOfflineRef = useRef(false)

  usePushNotifications(!!session)

  // Drain pending sessions whenever we come back online
  useEffect(() => {
    if (!session) return
    if (!isOnline) {
      wasOfflineRef.current = true
      return
    }
    if (wasOfflineRef.current) {
      wasOfflineRef.current = false
      useReviewStore.getState().syncPendingSessions()
    }
  }, [isOnline, session])

  useEffect(() => {
    initialize()
  }, [])

  useEffect(() => {
    if (!isInitialized) return

    const inAuthGroup = segments[0] === '(auth)'
    if (!session && !inAuthGroup) {
      router.replace('/(auth)/sign-in')
    } else if (session && inAuthGroup) {
      router.replace('/(tabs)')
    }
  }, [isInitialized, session, segments])

  if (!isInitialized) return null

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="kanji/[id]" />
        <Stack.Screen name="browse" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="about" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="placement" options={{ headerShown: false }} />
      </Stack>
    </GestureHandlerRootView>
  )
}
