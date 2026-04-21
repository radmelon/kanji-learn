import { useEffect, useRef } from 'react'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { api } from '../lib/api'
import { storage } from '../lib/storage'

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

async function registerForPushNotifications(): Promise<string | null> {
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

export function usePushNotifications(isAuthenticated: boolean): void {
  const savedRef = useRef(false)

  useEffect(() => {
    if (!isAuthenticated || savedRef.current) return

    registerForPushNotifications()
      .then(async (token) => {
        if (!token) return
        savedRef.current = true
        const platform = Platform.OS === 'ios' ? 'ios' : 'android'
        await api.post('/v1/push-tokens', { token, platform })
        await storage.setItem('kl:last_push_token', token)
        console.log('[Push] Token registered:', token.slice(0, 30) + '…')
      })
      .catch((err) => {
        console.warn('[Push] Registration failed:', err.message)
      })
  }, [isAuthenticated])
}
