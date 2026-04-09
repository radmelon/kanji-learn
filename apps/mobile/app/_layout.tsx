import '../src/polyfills'
import { useEffect, useRef } from 'react'
import { Alert, Linking } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Audio } from 'expo-av'
import * as Speech from 'expo-speech'
import { useAuthStore } from '../src/stores/auth.store'
import { usePushNotifications } from '../src/hooks/usePushNotifications'
import { useNetworkStatus } from '../src/hooks/useNetworkStatus'
import { useReviewStore } from '../src/stores/review.store'
import { colors } from '../src/theme'

export default function RootLayout() {
  const { isInitialized, session, initialize } = useAuthStore()
  const router = useRouter()
  const segments = useSegments()
  const { isOnline } = useNetworkStatus()
  const wasOfflineRef = useRef(false)

  // Configure audio session + check Japanese TTS voice availability on first mount.
  useEffect(() => {
    // 1. Set playsInSilentModeIOS so expo-speech plays through the ringer switch.
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    }).catch((e) => console.error('[Audio] setAudioModeAsync failed:', e))

    // 2. Check whether a Japanese TTS voice is installed on this device.
    //    If not, expo-speech silently fires onError and no audio plays —
    //    the user never gets any feedback about why the speaker icons don't work.
    Speech.getAvailableVoicesAsync()
      .then((voices) => {
        console.log('[TTS] Available voices:', voices.map((v) => `${v.language} — ${v.name}`).join(', '))
        const hasJapanese = voices.some((v) => v.language.startsWith('ja'))
        if (!hasJapanese) {
          Alert.alert(
            'Japanese Voice Not Installed',
            'Kanji pronunciations require a Japanese text-to-speech voice.\n\nTo install one:\nSettings → Accessibility → Spoken Content → Voices → Japanese\n\nDownload any Japanese voice, then reopen the app.',
            [
              { text: 'Open Settings', onPress: () => Linking.openURL('app-settings:') },
              { text: 'Later' },
            ]
          )
        }
      })
      .catch((e) => console.error('[TTS] getAvailableVoicesAsync failed:', e))
  }, [])

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
