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

// Configure audio session once at startup so TTS plays through silent mode (iOS)
// and respects Android audio focus. Done here rather than per-button-press to
// avoid race conditions between setAudioModeAsync and Speech.speak().
Audio.setAudioModeAsync({
  allowsRecordingIOS: false,
  playsInSilentModeIOS: true,
  staysActiveInBackground: false,
  shouldDuckAndroid: true,
  playThroughEarpieceAndroid: false,
}).catch(() => {
  // Non-fatal — device will use default audio mode
})

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
