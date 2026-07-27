import { useCallback, useEffect, useRef, useState } from 'react'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { AppState, Platform } from 'react-native'
import { api } from '../lib/api'
import { storage } from '../lib/storage'

const LAST_TOKEN_KEY = 'kl:last_push_token'

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

export async function registerForPushNotifications(): Promise<string | null> {
  // Push notifications only work on real devices
  if (!Device.isDevice) {
    console.log('[Push] Skipping — not a physical device')
    return null
  }

  // Android channel setup
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'KanjiLearn',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#6C63FF',
    })
  }

  // Request / check permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }

  if (finalStatus !== 'granted') {
    console.log('[Push] Permission not granted')
    return null
  }

  // Get the Expo push token
  const projectId = Constants.expoConfig?.extra?.eas?.projectId
  if (!projectId) {
    console.warn('[Push] No EAS projectId found in app.json — skipping token registration')
    return null
  }
  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId })
  return tokenData.data
}

export interface PushRegistrationState {
  /** False when this device has no token registered — nothing can be delivered. */
  hasToken: boolean
  /** True once at least one registration attempt has finished. */
  checked: boolean
  /** Re-run registration now (the Profile screen's "Fix" action). */
  retry: () => Promise<boolean>
}

/**
 * Register this device for push, and keep it registered.
 *
 * Root cause B (BUGS.md, 2026-07-26): RAD and the live tester both had
 * notificationsEnabled=true and ZERO rows in user_push_tokens — delivery was
 * structurally impossible while the Profile toggle showed ON. Confirmed still
 * true in production on 2026-07-27, where the daily cron logged
 * "userId=7c707446… has NO registered push tokens — nothing sent".
 *
 * The old hook ran once per mount and latched on a ref. If permission was
 * denied at that moment, or the token was dropped at sign-out, nothing ever
 * tried again for the life of the install. Two things fix that:
 *
 *   1. Re-attempt when the app returns to the foreground and nothing is saved.
 *      Granting permission in iOS Settings backgrounds the app, so the return
 *      trip is exactly when a previously-denied user becomes registerable.
 *   2. Compare the fetched token against the last one we sent. A reinstall
 *      issues a NEW Expo token while the old row lingers server-side, so
 *      "we already registered" is not the same as "this token is registered".
 */
export function usePushNotifications(isAuthenticated: boolean): PushRegistrationState {
  const savedRef = useRef(false)
  const inFlightRef = useRef(false)
  const [hasToken, setHasToken] = useState(false)
  const [checked, setChecked] = useState(false)

  const attempt = useCallback(async (): Promise<boolean> => {
    // Overlapping attempts are easy to trigger now that both a mount and a
    // foreground event can start one.
    if (inFlightRef.current) return savedRef.current
    inFlightRef.current = true
    try {
      const token = await registerForPushNotifications()
      if (!token) {
        setHasToken(false)
        return false
      }

      // Re-POST when the token has changed even if we "already registered" —
      // a reinstall issues a new one and the server's old row is dead.
      const lastToken = await storage.getItem<string>(LAST_TOKEN_KEY)
      if (savedRef.current && lastToken === token) {
        setHasToken(true)
        return true
      }

      const platform = Platform.OS === 'ios' ? 'ios' : 'android'
      await api.post('/v1/push-tokens', { token, platform })
      await storage.setItem(LAST_TOKEN_KEY, token)
      savedRef.current = true
      setHasToken(true)
      console.log(
        `[Push] Token registered${lastToken && lastToken !== token ? ' (changed since last launch)' : ''}:`,
        token.slice(0, 30) + '…',
      )
      return true
    } catch (err) {
      console.warn('[Push] Registration failed:', (err as Error).message)
      return false
    } finally {
      inFlightRef.current = false
      setChecked(true)
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated) {
      // A signed-out device holds no claim to a token; the next sign-in
      // re-registers from scratch.
      savedRef.current = false
      setHasToken(false)
      setChecked(false)
      return
    }

    void attempt()

    const sub = AppState.addEventListener('change', (next) => {
      // Only retry what has not already succeeded. A registered device
      // re-checks nothing on every foreground.
      if (next === 'active' && !savedRef.current) void attempt()
    })
    return () => sub.remove()
  }, [isAuthenticated, attempt])

  return { hasToken, checked, retry: attempt }
}
