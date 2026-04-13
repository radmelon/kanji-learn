# OAuth 2.0 Social Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Sign in with Apple and Sign in with Google to the kanji-learn mobile app alongside existing email/password auth.

**Architecture:** `expo-web-browser` opens an in-app browser sheet for OAuth. Supabase's `signInWithOAuth()` with `skipBrowserRedirect: true` returns the provider URL; after the user authenticates, the callback redirects to `kanjilearn://auth/callback` and the app parses `access_token`/`refresh_token` from the URL fragment, then calls `supabase.auth.setSession()` to complete the flow. The existing `onAuthStateChange` listener in the auth store handles session updates and Watch sync automatically.

**Tech Stack:** Expo SDK 54, Supabase JS v2, `expo-web-browser`, `expo-auth-session`, Zustand, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-11-oauth-social-login-design.md`

---

### File Structure

| File | Responsibility |
|------|---------------|
| **Create:** `apps/mobile/src/components/auth/SocialAuthButtons.tsx` | Apple + Google sign-in buttons with ActivityIndicator loading state |
| **Create:** `apps/mobile/src/lib/oauth.ts` | OAuth helper: `startOAuthFlow(provider)` — calls `signInWithOAuth`, opens browser, parses callback, sets session |
| **Create:** `apps/mobile/test/unit/oauth.test.ts` | Unit tests for URL parsing and OAuth flow |
| **Modify:** `apps/mobile/src/stores/auth.store.ts` | Add `signInWithApple()`, `signInWithGoogle()` methods and `socialLoading` state |
| **Modify:** `apps/mobile/app/(auth)/sign-in.tsx` | Social-first layout: SocialAuthButtons above "or" divider, email form below |
| **Modify:** `apps/mobile/app/(auth)/sign-up.tsx` | Mirror sign-in layout with SocialAuthButtons in "sign-up" mode |
| **Modify:** `apps/mobile/app/_layout.tsx` | Add deep link listener for `kanjilearn://auth/callback` URLs |

---

### Task 1: Install Dependencies

**Files:**
- Modify: `apps/mobile/package.json`

- [ ] **Step 1: Install expo-web-browser and expo-auth-session**

```bash
cd apps/mobile && pnpm add expo-web-browser expo-auth-session
```

- [ ] **Step 2: Verify installation**

```bash
cd apps/mobile && pnpm ls expo-web-browser expo-auth-session
```

Expected: Both packages listed with version numbers.

- [ ] **Step 3: Add expo-web-browser to app.json plugins**

In `apps/mobile/app.json`, add `"expo-web-browser"` to the `plugins` array (after `"expo-router"`):

```json
"plugins": [
  "./plugins/withXcode16Fix",
  "./plugins/withWatchApp",
  "./plugins/withWatchConnectivity",
  "expo-router",
  "expo-web-browser",
```

This ensures the native `ASWebAuthenticationSession` entitlement is configured on iOS.

- [ ] **Step 4: Run typecheck**

```bash
cd apps/mobile && pnpm typecheck
```

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/package.json apps/mobile/app.json pnpm-lock.yaml
git commit -m "feat(mobile): add expo-web-browser and expo-auth-session for OAuth"
```

---

### Task 2: Create OAuth Helper (`oauth.ts`)

**Files:**
- Create: `apps/mobile/src/lib/oauth.ts`
- Create: `apps/mobile/test/unit/oauth.test.ts`

This module encapsulates the full OAuth flow: get the URL from Supabase, open the browser, parse the callback, set the session. The auth store methods will be thin wrappers around this.

- [ ] **Step 1: Write the failing test for `parseOAuthCallbackUrl`**

Create `apps/mobile/test/unit/oauth.test.ts`:

```typescript
import { parseOAuthCallbackUrl } from '../../src/lib/oauth'

describe('parseOAuthCallbackUrl', () => {
  it('extracts access_token and refresh_token from hash fragment', () => {
    const url =
      'kanjilearn://auth/callback#access_token=abc123&refresh_token=def456&token_type=bearer&expires_in=3600'
    const result = parseOAuthCallbackUrl(url)
    expect(result).toEqual({ access_token: 'abc123', refresh_token: 'def456' })
  })

  it('returns null when access_token is missing', () => {
    const url = 'kanjilearn://auth/callback#refresh_token=def456&token_type=bearer'
    const result = parseOAuthCallbackUrl(url)
    expect(result).toBeNull()
  })

  it('returns null when refresh_token is missing', () => {
    const url = 'kanjilearn://auth/callback#access_token=abc123&token_type=bearer'
    const result = parseOAuthCallbackUrl(url)
    expect(result).toBeNull()
  })

  it('returns null for URLs without a hash fragment', () => {
    const url = 'kanjilearn://auth/callback?error=access_denied'
    const result = parseOAuthCallbackUrl(url)
    expect(result).toBeNull()
  })

  it('returns null for error callbacks', () => {
    const url =
      'kanjilearn://auth/callback#error=server_error&error_description=Something+went+wrong'
    const result = parseOAuthCallbackUrl(url)
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/rdennis/Documents/projects/kanji-learn-phase-1 && pnpm --filter @kanji-learn/mobile exec jest test/unit/oauth.test.ts --no-cache 2>&1 || true
```

Expected: FAIL — `Cannot find module '../../src/lib/oauth'`

- [ ] **Step 3: Implement `oauth.ts`**

Create `apps/mobile/src/lib/oauth.ts`:

```typescript
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
 * Parse the OAuth callback URL and extract tokens from the hash fragment.
 * Returns null if the URL doesn't contain valid tokens.
 */
export function parseOAuthCallbackUrl(
  url: string,
): { access_token: string; refresh_token: string } | null {
  const hashIndex = url.indexOf('#')
  if (hashIndex === -1) return null

  const fragment = url.substring(hashIndex + 1)
  const params = new URLSearchParams(fragment)

  const access_token = params.get('access_token')
  const refresh_token = params.get('refresh_token')

  if (!access_token || !refresh_token) return null

  return { access_token, refresh_token }
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

  // 4. Parse tokens from callback URL
  const tokens = parseOAuthCallbackUrl(result.url)
  if (!tokens) {
    throw new Error('Failed to parse authentication tokens from callback')
  }

  // 5. Set session in Supabase — triggers onAuthStateChange
  const { error: sessionError } = await supabase.auth.setSession({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  })

  if (sessionError) throw sessionError
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/rdennis/Documents/projects/kanji-learn-phase-1 && pnpm --filter @kanji-learn/mobile exec jest test/unit/oauth.test.ts --no-cache
```

Expected: 5 tests PASS.

- [ ] **Step 5: Run full typecheck**

```bash
cd apps/mobile && pnpm typecheck
```

Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/oauth.ts apps/mobile/test/unit/oauth.test.ts
git commit -m "feat(mobile): add OAuth helper with URL parsing and browser flow"
```

---

### Task 3: Add OAuth Methods to Auth Store

**Files:**
- Modify: `apps/mobile/src/stores/auth.store.ts`

Add `signInWithApple()` and `signInWithGoogle()` methods that wrap `startOAuthFlow()`. Also add a `socialLoading` state field to track OAuth loading separately from email/password loading.

- [ ] **Step 1: Add `socialLoading` to the `AuthState` interface**

In `apps/mobile/src/stores/auth.store.ts`, add the new fields to the `AuthState` interface. Find:

```typescript
interface AuthState {
  session: Session | null
  user: User | null
  isLoading: boolean
  isInitialized: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, displayName: string) => Promise<void>
  signOut: () => Promise<void>
  setSession: (session: Session | null) => void
  initialize: () => Promise<void>
```

Replace with:

```typescript
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
```

- [ ] **Step 2: Add the import for `startOAuthFlow`**

At the top of `auth.store.ts`, after the existing imports, add:

```typescript
import { startOAuthFlow } from '../lib/oauth'
```

- [ ] **Step 3: Initialize `socialLoading` and add the two methods**

In the store implementation, after `isInitialized: false,` add:

```typescript
  socialLoading: false,
```

Then, after the `signUp` method's closing `},`, add the two new methods:

```typescript
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
```

- [ ] **Step 4: Run typecheck**

```bash
cd apps/mobile && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/stores/auth.store.ts
git commit -m "feat(mobile): add signInWithApple and signInWithGoogle to auth store"
```

---

### Task 4: Create SocialAuthButtons Component

**Files:**
- Create: `apps/mobile/src/components/auth/SocialAuthButtons.tsx`

- [ ] **Step 1: Create the component**

Create `apps/mobile/src/components/auth/SocialAuthButtons.tsx`:

```tsx
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '../../stores/auth.store'
import { colors, spacing, radius, typography } from '../../theme'

interface Props {
  mode: 'sign-in' | 'sign-up'
  disabled?: boolean
}

export function SocialAuthButtons({ mode, disabled }: Props) {
  const { signInWithApple, signInWithGoogle, socialLoading } = useAuthStore()

  const appleLabel = mode === 'sign-in' ? 'Continue with Apple' : 'Sign up with Apple'
  const googleLabel = mode === 'sign-in' ? 'Continue with Google' : 'Sign up with Google'

  const isDisabled = disabled || socialLoading

  const handleApple = async () => {
    try {
      await signInWithApple()
    } catch (err: any) {
      // Error toast handled by caller or ignored (user cancelled)
    }
  }

  const handleGoogle = async () => {
    try {
      await signInWithGoogle()
    } catch (err: any) {
      // Error toast handled by caller or ignored (user cancelled)
    }
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.appleButton, isDisabled && styles.buttonDisabled]}
        onPress={handleApple}
        disabled={isDisabled}
      >
        {socialLoading ? (
          <ActivityIndicator color="#000" size="small" />
        ) : (
          <>
            <Ionicons name="logo-apple" size={20} color="#000" style={styles.icon} />
            <Text style={styles.appleText}>{appleLabel}</Text>
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.googleButton, isDisabled && styles.buttonDisabled]}
        onPress={handleGoogle}
        disabled={isDisabled}
      >
        {socialLoading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Text style={styles.googleLogo}>G</Text>
            <Text style={styles.googleText}>{googleLabel}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm + 2,
  },
  appleButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleButton: {
    backgroundColor: '#4285F4',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  icon: {
    marginRight: spacing.sm,
  },
  appleText: {
    ...typography.h3,
    color: '#000000',
  },
  googleLogo: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    marginRight: spacing.sm,
  },
  googleText: {
    ...typography.h3,
    color: '#FFFFFF',
  },
})
```

- [ ] **Step 2: Run typecheck**

```bash
cd apps/mobile && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/auth/SocialAuthButtons.tsx
git commit -m "feat(mobile): add SocialAuthButtons component with Apple and Google"
```

---

### Task 5: Update Sign-In Screen (Social-First Layout)

**Files:**
- Modify: `apps/mobile/app/(auth)/sign-in.tsx`

Rearrange the sign-in screen to show social buttons at the top, an "or" divider, then email/password below. The existing email/password form stays unchanged; we're adding the social buttons above it.

- [ ] **Step 1: Add imports**

In `apps/mobile/app/(auth)/sign-in.tsx`, add these imports after the existing imports:

```typescript
import { SocialAuthButtons } from '../../src/components/auth/SocialAuthButtons'
```

- [ ] **Step 2: Update the store destructuring**

Change:

```typescript
  const { signIn, isLoading } = useAuthStore()
```

To:

```typescript
  const { signIn, isLoading, socialLoading } = useAuthStore()
```

- [ ] **Step 3: Add SocialAuthButtons and divider to the JSX**

In the return statement, insert the social buttons and divider between the subtitle and the first TextInput. Replace the full return statement with:

```tsx
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.kanji}>漢字</Text>
        <Text style={styles.title}>Kanji Learn</Text>
        <Text style={styles.subtitle}>Master 2,136 Jōyō kanji</Text>

        <SocialAuthButtons mode="sign-in" disabled={isLoading} />

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.button, (isLoading || socialLoading) && styles.buttonDisabled]}
          onPress={handleSignIn}
          disabled={isLoading || socialLoading}
        >
          <Text style={styles.buttonText}>{isLoading ? 'Signing in…' : 'Sign in'}</Text>
        </TouchableOpacity>

        <Link href="/(auth)/sign-up" asChild>
          <TouchableOpacity style={styles.link}>
            <Text style={styles.linkText}>No account? Sign up</Text>
          </TouchableOpacity>
        </Link>
      </View>
    </KeyboardAvoidingView>
  )
```

- [ ] **Step 4: Add divider styles**

Add these styles to the `StyleSheet.create` call in `sign-in.tsx`:

```typescript
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    ...typography.caption,
    color: colors.textMuted,
  },
```

- [ ] **Step 5: Run typecheck**

```bash
cd apps/mobile && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/app/\(auth\)/sign-in.tsx
git commit -m "feat(mobile): add social-first layout to sign-in screen"
```

---

### Task 6: Update Sign-Up Screen (Mirror Sign-In)

**Files:**
- Modify: `apps/mobile/app/(auth)/sign-up.tsx`

Add the same social buttons and divider to the sign-up screen, mirroring the sign-in layout. Social buttons use `mode="sign-up"` so button text reads "Sign up with Apple" etc.

- [ ] **Step 1: Add imports**

In `apps/mobile/app/(auth)/sign-up.tsx`, add after the existing imports:

```typescript
import { SocialAuthButtons } from '../../src/components/auth/SocialAuthButtons'
```

- [ ] **Step 2: Update the store destructuring**

Change:

```typescript
  const { signUp, isLoading } = useAuthStore()
```

To:

```typescript
  const { signUp, isLoading, socialLoading } = useAuthStore()
```

- [ ] **Step 3: Replace the return statement JSX**

Replace the full return statement with:

```tsx
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Create account</Text>
        <Text style={styles.subtitle}>Start your kanji journey</Text>

        <SocialAuthButtons mode="sign-up" disabled={isLoading} />

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <TextInput
          style={styles.input}
          placeholder="Display name"
          placeholderTextColor={colors.textMuted}
          value={displayName}
          onChangeText={setDisplayName}
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password (min 8 chars)"
          placeholderTextColor={colors.textMuted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity
          style={[styles.button, (isLoading || socialLoading) && styles.buttonDisabled]}
          onPress={handleSignUp}
          disabled={isLoading || socialLoading}
        >
          <Text style={styles.buttonText}>{isLoading ? 'Creating account…' : 'Sign up'}</Text>
        </TouchableOpacity>

        <Link href="/(auth)/sign-in" asChild>
          <TouchableOpacity style={styles.link}>
            <Text style={styles.linkText}>Already have an account? Sign in</Text>
          </TouchableOpacity>
        </Link>
      </View>
    </KeyboardAvoidingView>
  )
```

- [ ] **Step 4: Add divider styles**

Add these styles to the `StyleSheet.create` call in `sign-up.tsx`:

```typescript
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    ...typography.caption,
    color: colors.textMuted,
  },
```

- [ ] **Step 5: Run typecheck**

```bash
cd apps/mobile && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/app/\(auth\)/sign-up.tsx
git commit -m "feat(mobile): add social auth buttons to sign-up screen"
```

---

### Task 7: Add Deep Link Handler to Root Layout

**Files:**
- Modify: `apps/mobile/app/_layout.tsx`

Add a `Linking.addEventListener('url', ...)` listener to handle OAuth callback redirects. When the app receives a `kanjilearn://auth/callback` URL, parse the tokens and set the session.

- [ ] **Step 1: Add imports**

In `apps/mobile/app/_layout.tsx`, add after the existing `import { supabase } from '../src/lib/supabase'` (which doesn't exist yet — we need to add the import). Actually, `supabase` isn't imported in `_layout.tsx`. Add these imports after the existing imports:

```typescript
import { parseOAuthCallbackUrl } from '../src/lib/oauth'
import { supabase } from '../src/lib/supabase'
```

- [ ] **Step 2: Add the deep link listener useEffect**

In the `RootLayout` component, after the existing `useEffect(() => { initialize() }, [])` block (line 69-71), add:

```typescript
  // Handle OAuth callback deep links
  useEffect(() => {
    const handleUrl = async (event: { url: string }) => {
      if (!event.url.includes('auth/callback')) return

      const tokens = parseOAuthCallbackUrl(event.url)
      if (tokens) {
        await supabase.auth.setSession({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
        })
      }
    }

    // Handle URL that launched the app (cold start)
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url })
    })

    // Handle URL while app is running (warm start)
    const subscription = Linking.addEventListener('url', handleUrl)
    return () => subscription.remove()
  }, [])
```

- [ ] **Step 3: Run typecheck**

```bash
cd apps/mobile && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/_layout.tsx
git commit -m "feat(mobile): add deep link handler for OAuth callbacks"
```

---

### Task 8: Error Handling and Edge Cases

**Files:**
- Modify: `apps/mobile/src/components/auth/SocialAuthButtons.tsx`
- Modify: `apps/mobile/src/lib/oauth.ts`

Add user-facing error handling: show an Alert when OAuth fails (not when the user cancels).

- [ ] **Step 1: Update SocialAuthButtons error handling**

In `apps/mobile/src/components/auth/SocialAuthButtons.tsx`, add the `Alert` import and update the error handlers.

Add `Alert` to the react-native import:

```typescript
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native'
```

Replace the `handleApple` function:

```typescript
  const handleApple = async () => {
    try {
      await signInWithApple()
    } catch (err: any) {
      Alert.alert('Sign in failed', err.message ?? "Couldn't connect. Please try again.")
    }
  }
```

Replace the `handleGoogle` function:

```typescript
  const handleGoogle = async () => {
    try {
      await signInWithGoogle()
    } catch (err: any) {
      Alert.alert('Sign in failed', err.message ?? "Couldn't connect. Please try again.")
    }
  }
```

- [ ] **Step 2: Ensure user cancellation doesn't throw in `oauth.ts`**

Verify in `apps/mobile/src/lib/oauth.ts` that when `result.type !== 'success'` (user cancelled), the function returns silently without throwing. This is already the case — the line `if (result.type !== 'success') return` handles it. No changes needed; just confirm this during review.

- [ ] **Step 3: Run typecheck**

```bash
cd apps/mobile && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/auth/SocialAuthButtons.tsx
git commit -m "feat(mobile): add error alerts for failed OAuth sign-in"
```

---

### Task 9: Run All Tests and Final Typecheck

**Files:**
- No file changes — validation only.

- [ ] **Step 1: Run unit tests**

```bash
cd /Users/rdennis/Documents/projects/kanji-learn-phase-1 && pnpm --filter @kanji-learn/mobile exec jest --no-cache
```

Expected: All tests pass, including the new `oauth.test.ts` tests.

- [ ] **Step 2: Run full typecheck**

```bash
cd apps/mobile && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 3: Run API tests (ensure no backend breakage)**

```bash
cd /Users/rdennis/Documents/projects/kanji-learn-phase-1 && pnpm --filter @kanji-learn/api test
```

Expected: All API tests pass (no backend changes were made).

- [ ] **Step 4: Commit any remaining unstaged files**

```bash
git status
```

If any relevant files are unstaged, stage and commit them.

---

### Manual Testing Checklist (Post-Implementation)

These require Supabase dashboard configuration (Apple + Google providers) and a device/simulator:

1. **Apple Sign In (iOS Simulator or device):**
   - Tap "Continue with Apple" on sign-in screen
   - Verify in-app browser opens with Apple login
   - Sign in with Apple ID
   - Verify redirect back to app and session established
   - Verify user appears in Supabase dashboard with Apple identity

2. **Google Sign In:**
   - Tap "Continue with Google" on sign-in screen
   - Verify in-app browser opens with Google login
   - Sign in with Google account
   - Verify redirect back to app and session established

3. **Cancel flow:**
   - Start Apple sign-in, dismiss the browser
   - Verify no error shown, back on sign-in screen, no loading spinner

4. **Account linking:**
   - Sign up with email
   - Sign out
   - Sign in with Google using the same email
   - Verify single account with both identities in Supabase dashboard

5. **Sign-up screen:**
   - Verify "Sign up with Apple" / "Sign up with Google" text on sign-up screen
   - Verify flow works identically to sign-in

6. **Disabled state:**
   - Start email sign-in (loading state)
   - Verify social buttons are disabled and dimmed
   - Start social sign-in
   - Verify email sign-in button is disabled
