# OAuth 2.0 Social Login (Apple + Google) — Design Spec

## Goal

Add Sign in with Apple and Sign in with Google to the kanji-learn mobile app, keeping email/password as an equal option. Lowest-friction onboarding for new users while preserving existing auth for current users.

## Decisions

- **Providers:** Apple + Google. Both on iOS; both on Android (Apple via web).
- **Coexistence:** Email/password stays. Social login is additive, not a replacement.
- **Account linking:** Auto-link by email. A user who signs up with email and later uses Google (same email) gets merged into one account via Supabase identities.
- **Layout:** Social-first — Apple and Google buttons at top, "or" divider, email/password below. Sign-up mirrors sign-in.
- **OAuth flow:** `expo-auth-session` + `expo-web-browser` (ASWebAuthenticationSession on iOS). Supabase handles token exchange and redirects to `kanjilearn://` deep link scheme.
- **Backend:** No Fastify API changes. The API verifies Supabase JWTs regardless of auth provider.

## Architecture

```
User taps "Continue with Apple"
  -> auth.store.signInWithApple()
  -> supabase.auth.signInWithOAuth({ provider: 'apple' })
  -> expo-web-browser opens ASWebAuthenticationSession
  -> Apple login page in in-app browser sheet
  -> User authenticates
  -> Apple redirects to Supabase callback
  -> Supabase exchanges code, creates/links identity
  -> Supabase redirects to kanjilearn:// with session
  -> _layout.tsx deep link handler fires
  -> Supabase client extracts session from URL
  -> auth.store session updates -> navigate to (tabs)
```

## Supabase Dashboard Configuration (Manual)

These steps are performed by the developer in the Supabase dashboard, not in code:

1. **Apple provider** — Auth > Providers > Apple
   - Requires: Apple Developer Service ID, Key ID, private key file (.p8)
   - Callback URL from Supabase must be registered in Apple Developer Console
   - Enable "Sign in with Apple" capability in App ID

2. **Google provider** — Auth > Providers > Google
   - Requires: Google Cloud Console OAuth 2.0 Client ID + client secret
   - Authorized redirect URI = Supabase's callback URL
   - For iOS: additional iOS client ID via Google Cloud Console (type: iOS)

3. **Auth settings** — Auth > Settings
   - Site URL: `kanjilearn://` (deep link scheme)
   - Additional redirect URLs: `kanjilearn://auth/callback`
   - Auto-confirm users: enabled (social login users are pre-verified)

4. **Account linking** — Auth > Settings > Security
   - Enable "Automatically link accounts with the same email"

## File Changes

### New files

| File | Responsibility |
|------|---------------|
| `apps/mobile/src/components/auth/SocialAuthButtons.tsx` | Apple + Google sign-in buttons with onPress handlers |

### Modified files

| File | Change |
|------|--------|
| `apps/mobile/src/stores/auth.store.ts` | Add `signInWithApple()`, `signInWithGoogle()` methods using `supabase.auth.signInWithOAuth()` |
| `apps/mobile/app/(auth)/sign-in.tsx` | Social-first layout: SocialAuthButtons above divider, email form below |
| `apps/mobile/app/(auth)/sign-up.tsx` | Mirror sign-in layout with SocialAuthButtons |
| `apps/mobile/app/_layout.tsx` | Add deep link listener for `kanjilearn://` OAuth callbacks, pass URL to `supabase.auth.getSessionFromUrl()` |
| `apps/mobile/app.json` | Verify `scheme: "kanjilearn"` is set (already present) |

### New dependencies

| Package | Purpose |
|---------|---------|
| `expo-web-browser` | Opens in-app browser for OAuth (ASWebAuthenticationSession on iOS) |
| `expo-auth-session` | Handles OAuth redirect flow with Expo's deep linking |

## Component: SocialAuthButtons

```tsx
interface Props {
  mode: 'sign-in' | 'sign-up'
  disabled?: boolean
}
```

Renders two full-width buttons:
1. **Continue with Apple** — white background, black text, Apple logo
2. **Continue with Google** — Google blue (#4285F4) background, white text, G logo

Each button calls the corresponding `auth.store` method. Shows `ActivityIndicator` while loading. Disabled during any auth operation.

The `mode` prop controls button text: "Continue with Apple" vs "Sign up with Apple".

## Auth Store Changes

Add two new methods to the Zustand auth store:

```typescript
signInWithApple: () => Promise<void>
signInWithGoogle: () => Promise<void>
```

Both follow the same pattern:
1. Set loading state
2. Call `supabase.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: false } })`
3. `expo-web-browser` opens automatically via the Supabase client's URL
4. On success, the deep link handler in `_layout.tsx` picks up the session
5. On cancel/error, clear loading state and optionally show error

## Deep Link Handler

In `_layout.tsx`, add a `useEffect` that listens for incoming URLs:

```typescript
useEffect(() => {
  const handleUrl = async (event: { url: string }) => {
    if (!event.url.includes('auth/callback')) return
    const tokens = parseOAuthCallbackUrl(event.url)
    if (tokens) {
      const { error } = await supabase.auth.setSession({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      })
      if (error) console.warn('[OAuth] setSession failed:', error.message)
    }
  }

  Linking.getInitialURL()
    .then((url) => { if (url) handleUrl({ url }) })
    .catch((e) => console.warn('[OAuth] getInitialURL failed:', e))

  const subscription = Linking.addEventListener('url', handleUrl)
  return () => subscription.remove()
}, [])
```

This handles the redirect after OAuth completes for both cold start (`getInitialURL`) and warm start (`addEventListener`). The `parseOAuthCallbackUrl` helper extracts `access_token` and `refresh_token` from the URL hash fragment, then `setSession` updates the Supabase client, triggering the auth store's `onAuthStateChange` listener.

## Sign-In / Sign-Up Screen Layout

```
┌─────────────────────────┐
│         漢字              │
│      Kanji Buddy         │
│                          │
│  ┌─────────────────────┐ │
│  │  Continue with Apple │ │
│  └─────────────────────┘ │
│  ┌─────────────────────┐ │
│  │ G Continue with Google│ │
│  └─────────────────────┘ │
│                          │
│  ─────── or ───────      │
│                          │
│  ┌─────────────────────┐ │
│  │ Email address        │ │
│  └─────────────────────┘ │
│  ┌─────────────────────┐ │
│  │ Password             │ │
│  └─────────────────────┘ │
│  ┌─────────────────────┐ │
│  │      Sign In         │ │
│  └─────────────────────┘ │
│                          │
│  Don't have an account?  │
│  Sign Up                 │
└─────────────────────────┘
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| User cancels browser | `expo-web-browser` returns `cancel` result. Clear loading state. No error shown. |
| Network error | Show toast: "Couldn't connect. Please try again." |
| Provider unavailable | Both buttons shown on both platforms. Apple Sign In works on Android via web flow. |
| Account linking conflict | Handled by Supabase auto-link setting. No app-side logic needed. |
| Supabase callback error | Parse error from redirect URL, show toast with message. |

## Testing

- **Unit:** Mock `supabase.auth.signInWithOAuth()` in auth store tests. Verify loading states and error handling.
- **Manual (required):** Full OAuth flow on iOS device/simulator for Apple, physical device for Google.
- **Edge case:** Sign up with email, sign out, sign in with Google (same email) — verify single account with both identities.

## Out of Scope

- Password reset flow (already exists, unchanged)
- Profile screen showing linked providers (future enhancement)
- Revoking linked providers (future enhancement)
- Apple Sign In on Apple Watch (Watch uses token sync from phone, not independent auth)
