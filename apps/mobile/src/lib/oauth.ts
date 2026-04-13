import * as WebBrowser from 'expo-web-browser'
import { makeRedirectUri } from 'expo-auth-session'
import { supabase } from './supabase'
import type { Provider } from '@supabase/supabase-js'

/** The redirect URI that Supabase will redirect to after OAuth completes. */
export const OAUTH_REDIRECT_URI = makeRedirectUri({
  scheme: 'kanjilearn',
  path: 'auth/callback',
})

/**
 * Parse the OAuth callback URL and extract tokens.
 *
 * Supports two flows:
 * - **Implicit grant:** tokens in hash fragment (`#access_token=...&refresh_token=...`)
 * - **PKCE:** authorization code in query params (`?code=...`)
 *
 * Returns null if the URL doesn't contain valid tokens or a code.
 */
export function parseOAuthCallbackUrl(
  url: string,
): { access_token: string; refresh_token: string } | { code: string } | null {
  // Try hash fragment first (implicit grant — used by Google)
  const hashIndex = url.indexOf('#')
  if (hashIndex !== -1) {
    const fragment = url.substring(hashIndex + 1)
    const params = new URLSearchParams(fragment)
    const access_token = params.get('access_token')
    const refresh_token = params.get('refresh_token')
    if (access_token && refresh_token) {
      return { access_token, refresh_token }
    }
  }

  // Try query params (PKCE flow — used by Apple)
  const queryIndex = url.indexOf('?')
  if (queryIndex !== -1) {
    const query = url.substring(queryIndex + 1)
    const params = new URLSearchParams(query)
    const code = params.get('code')
    if (code) {
      return { code }
    }
  }

  console.warn('[OAuth] Could not parse callback URL:', url)
  return null
}

/**
 * Start the full OAuth flow for a given provider.
 *
 * 1. Get the OAuth URL from Supabase (skipBrowserRedirect: true)
 * 2. Open the URL in an in-app browser sheet (ASWebAuthenticationSession on iOS)
 * 3. Wait for the callback redirect to kanjilearn://auth/callback
 * 4. Parse tokens from the URL fragment
 * 5. Set the session in Supabase (triggers onAuthStateChange)
 *
 * Throws on network errors or Supabase errors.
 * Returns silently if the user cancels.
 */
export async function startOAuthFlow(provider: Provider): Promise<void> {
  // 1. Get the OAuth URL from Supabase
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: OAUTH_REDIRECT_URI,
      skipBrowserRedirect: true,
    },
  })

  if (error) throw error
  if (!data.url) throw new Error('No OAuth URL returned from Supabase')

  // 2. Open in-app browser and wait for redirect
  const result = await WebBrowser.openAuthSessionAsync(data.url, OAUTH_REDIRECT_URI)

  // 3. Handle cancel
  if (result.type !== 'success') return

  // 4. Parse tokens or auth code from callback URL
  const parsed = parseOAuthCallbackUrl(result.url)
  if (!parsed) {
    throw new Error('Failed to parse authentication tokens from callback')
  }

  // 5. Complete the auth flow
  if ('code' in parsed) {
    // PKCE flow (Apple): exchange the authorization code for a session
    const { error: codeError } = await supabase.auth.exchangeCodeForSession(parsed.code)
    if (codeError) throw codeError
  } else {
    // Implicit flow (Google): set session directly from tokens
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
    })
    if (sessionError) throw sessionError
  }
}
