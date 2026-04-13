import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { NativeModules, Platform } from 'react-native'
import { supabase } from '../lib/supabase'
import { storage } from '../lib/storage'
import { startOAuthFlow } from '../lib/oauth'
import { clearProfileCache } from '../hooks/useProfile'
import { clearLearnerProfileCache } from '../hooks/useLearnerProfile'

// ─── WatchConnectivity native bridge ─────────────────────────────────────────

const WatchConnectivity: {
  pushTokensToWatch: (
    accessToken: string,
    refreshToken: string,
    expiresAt: number,
    supabaseURL: string,
    apiBaseURL: string,
    dailyGoal: number,
    reminderHour: number,
    restDay: number,
  ) => Promise<{ sent: boolean; reason?: string }>
  getConnectionStatus: () => Promise<{
    supported: boolean
    paired?: boolean
    watchAppInstalled?: boolean
    reachable?: boolean
  }>
} | null = Platform.OS === 'ios' ? NativeModules.WatchConnectivity ?? null : null

const WATCH_ENABLED_KEY = 'kl:watch_enabled'

type PushResult = { sent: boolean; reason?: string }

async function pushToWatch(session: Session, force = false): Promise<PushResult | null> {
  if (!WatchConnectivity) return null

  try {
    const watchEnabled = (await storage.getItem<boolean>(WATCH_ENABLED_KEY)) ?? false
    if (!force && !watchEnabled) return null

    // Read cached profile for settings needed by Watch encouragement messages
    const profile = await storage.getItem<{
      dailyGoal?: number
      reminderHour?: number
      restDay?: number | null
    }>('kl:profile_cache')

    const supabaseURL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''
    const apiBaseURL  = process.env.EXPO_PUBLIC_API_URL ?? ''

    // expiresAt is a Unix timestamp in seconds (Supabase standard)
    const expiresAt = session.expires_at ?? Math.floor(Date.now() / 1000) + 3600

    console.log('[Watch] pushToWatch called, supabaseURL:', supabaseURL ? 'set' : 'EMPTY', 'apiBaseURL:', apiBaseURL ? 'set' : 'EMPTY')

    const result = await WatchConnectivity.pushTokensToWatch(
      session.access_token,
      session.refresh_token ?? '',
      expiresAt,
      supabaseURL,
      apiBaseURL,
      watchEnabled,
      profile?.dailyGoal ?? 20,
      profile?.reminderHour ?? 20,
      profile?.restDay ?? -1,  // -1 = no rest day
    )

    console.log('[Watch] pushTokensToWatch result:', JSON.stringify(result))
    return result
  } catch (err) {
    console.warn('[Watch] pushTokensToWatch threw:', err)
    return { sent: false, reason: String(err) }
  }
}

interface AuthState {
  session: Session | null
  user: User | null
  isLoading: boolean
  socialLoading: boolean
  isInitialized: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, displayName: string) => Promise<void>
  signInWithApple: () => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  setSession: (session: Session | null) => void
  initialize: () => Promise<void>
  // Watch connectivity
  setWatchEnabled: (enabled: boolean) => Promise<PushResult | null>
  forceSyncToWatch: () => Promise<PushResult | null>
  getWatchConnectionStatus: () => Promise<{ supported: boolean; paired?: boolean; watchAppInstalled?: boolean; reachable?: boolean }>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  isLoading: false,
  socialLoading: false,
  isInitialized: false,

  initialize: async () => {
    const { data } = await supabase.auth.getSession()
    set({
      session: data.session,
      user: data.session?.user ?? null,
      isInitialized: true,
    })

    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null })
      // Push fresh tokens to Watch whenever auth state changes (sign in, token refresh, sign out)
      if (session) void pushToWatch(session)
    })
  },

  setSession: (session) => {
    set({ session, user: session?.user ?? null })
  },

  signIn: async (email, password) => {
    set({ isLoading: true })
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      set({ session: data.session, user: data.user })
      if (data.session) void pushToWatch(data.session)
    } finally {
      set({ isLoading: false })
    }
  },

  signUp: async (email, password, displayName) => {
    set({ isLoading: true })
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
      })
      if (error) throw error
      set({ session: data.session, user: data.user })
    } finally {
      set({ isLoading: false })
    }
  },

  signInWithApple: async () => {
    set({ socialLoading: true })
    try {
      await startOAuthFlow('apple')
      // Session is set via onAuthStateChange listener in initialize()
    } finally {
      set({ socialLoading: false })
    }
  },

  signInWithGoogle: async () => {
    set({ socialLoading: true })
    try {
      await startOAuthFlow('google')
      // Session is set via onAuthStateChange listener in initialize()
    } finally {
      set({ socialLoading: false })
    }
  },

  signOut: async () => {
    clearProfileCache()
    clearLearnerProfileCache()
    await supabase.auth.signOut()
    set({ session: null, user: null })
  },

  setWatchEnabled: async (enabled: boolean) => {
    await storage.setItem(WATCH_ENABLED_KEY, enabled)
    // If enabling, immediately push current session if available
    const { session } = get()
    if (enabled && session) return pushToWatch(session)
    return null
  },

  forceSyncToWatch: async () => {
    const { session } = get()
    if (!session) return { sent: false, reason: 'no_session' }
    return pushToWatch(session, true)
  },

  getWatchConnectionStatus: async () => {
    if (!WatchConnectivity) return { supported: false }
    try {
      return await WatchConnectivity.getConnectionStatus()
    } catch {
      return { supported: false }
    }
  },
}))
