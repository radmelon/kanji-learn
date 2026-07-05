import '../src/polyfills'
import { useEffect, useRef } from 'react'
import { Alert, Linking } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Audio } from 'expo-av'
import * as Speech from 'expo-speech'
import * as SplashScreen from 'expo-splash-screen'
import { useAuthStore } from '../src/stores/auth.store'
import { usePushNotifications } from '../src/hooks/usePushNotifications'
import { useNetworkStatus } from '../src/hooks/useNetworkStatus'
import { useReviewStore } from '../src/stores/review.store'
import { colors } from '../src/theme'
import { parseOAuthCallbackUrl } from '../src/lib/oauth'
import { supabase } from '../src/lib/supabase'
import { useProfile } from '../src/hooks/useProfile'

// Hold the native splash until auth has initialized AND a minimum display
// window has passed — without this it vanishes the instant the JS bundle
// loads, too brief to register. Failsafe below guarantees it always hides.
// catch(): on dev clients built before expo-splash-screen was added, the
// native module is absent — degrade to the old instant-hide behavior.
SplashScreen.preventAutoHideAsync().catch(() => {})
try {
  SplashScreen.setOptions({ fade: true, duration: 400 })
} catch {
  // native module absent on pre-B142 dev clients
}
const SPLASH_SHOWN_AT = Date.now()
const MIN_SPLASH_VISIBLE_MS = 1800
const SPLASH_FAILSAFE_MS = 8000

export default function RootLayout() {
  const { isInitialized, session, initialize } = useAuthStore()
  const { profile, isLoading: profileLoading } = useProfile()
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

  // Release the splash once auth init has settled and the minimum window has
  // passed. The failsafe hides it unconditionally so a hung initialize() can
  // never strand the user on the splash.
  useEffect(() => {
    const failsafe = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {})
    }, SPLASH_FAILSAFE_MS)
    return () => clearTimeout(failsafe)
  }, [])

  useEffect(() => {
    if (!isInitialized) return
    const remaining = Math.max(0, MIN_SPLASH_VISIBLE_MS - (Date.now() - SPLASH_SHOWN_AT))
    const t = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {})
    }, remaining)
    return () => clearTimeout(t)
  }, [isInitialized])

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

  // Handle OAuth callback deep links
  useEffect(() => {
    const handleUrl = async (event: { url: string }) => {
      if (!event.url.includes('auth/callback')) return

      const parsed = parseOAuthCallbackUrl(event.url)
      if (!parsed) return

      if ('code' in parsed) {
        const { error } = await supabase.auth.exchangeCodeForSession(parsed.code)
        if (error) console.warn('[OAuth] exchangeCodeForSession failed:', error.message)
      } else {
        const { error } = await supabase.auth.setSession({
          access_token: parsed.access_token,
          refresh_token: parsed.refresh_token,
        })
        if (error) console.warn('[OAuth] setSession failed:', error.message)
      }
    }

    // Handle URL that launched the app (cold start)
    Linking.getInitialURL()
      .then((url) => { if (url) handleUrl({ url }) })
      .catch((e) => console.warn('[OAuth] getInitialURL failed:', e))

    // Handle URL while app is running (warm start)
    const subscription = Linking.addEventListener('url', handleUrl)
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (!isInitialized) return

    const inAuthGroup = segments[0] === '(auth)'

    // Not logged in → send to sign-in
    if (!session && !inAuthGroup && segments[0] !== 'deleted') {
      router.replace('/(auth)/sign-in')
      return
    }

    // Logged in, in auth group — decide where to go (wait for profile first)
    if (session && inAuthGroup) {
      if (profileLoading || profile === null) return  // wait for load or hold on fetch error
      if (profile && !profile.onboardingCompletedAt) {
        router.replace('/onboarding')
      } else {
        router.replace('/(tabs)')
      }
      return
    }

    // Logged in, NOT in auth group — check onboarding gate
    if (session && !inAuthGroup) {
      if (profileLoading || profile === null) return
      if (profile && !profile.onboardingCompletedAt) {
        const inOnboarding = segments[0] === 'onboarding'
        if (!inOnboarding) router.replace('/onboarding')
      }
    }
  }, [isInitialized, session, segments, profile, profileLoading])

  if (!isInitialized) return null

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="kanji/[id]" />
        <Stack.Screen name="about" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="placement" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="deleted" options={{ headerShown: false, gestureEnabled: false }} />
      </Stack>
    </GestureHandlerRootView>
  )
}
