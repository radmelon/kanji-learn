# Delete Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app "Delete Account" flow that permanently removes the user and all associated data — required by App Store Review Guideline 5.1.1 before public launch.

**Architecture:** Mobile profile-tab destructive button → typed-`DELETE` confirmation modal → `DELETE /v1/user/me` API call → Supabase admin `deleteUser()` → DB FK cascades wipe everything → farewell screen → sign-in.

**Tech Stack:** Fastify + drizzle (API), `@supabase/supabase-js` admin client (deletion), Expo Router + zustand (mobile), React Native Modal (confirmation UI), vitest (tests).

**Spec reference:** [docs/superpowers/specs/2026-04-17-delete-account-design.md](docs/superpowers/specs/2026-04-17-delete-account-design.md)

---

## Pre-flight Notes

- The codebase pattern for API tests is **direct DB / drizzle tests in `apps/api/test/integration/`** — most routes are not exercised via Fastify `inject()`. The spec marked the integration test as "optional"; this plan includes it as a final task you can skip or run.
- The Watch app's 401 handling is **out of scope** for this plan (per spec). If TestFlight verification reveals the Watch keeps its stale tokens, address it as a separate generalized fix.
- The Profile tab's existing "Sign out" button at [apps/mobile/app/(tabs)/profile.tsx:868](apps/mobile/app/(tabs)/profile.tsx:868) uses `signOutBtn` styles and `colors.error`. Reuse `colors.error` for the destructive button — no new theme color needed.

---

## Task 1: Add `SUPABASE_URL` to API env schema

The admin client needs the Supabase project URL. Currently `SUPABASE_URL` is only read raw from `process.env` in `apps/api/src/plugins/auth.ts:12`. Promote it into the validated env schema so it's checked at boot.

**Files:**
- Modify: `apps/api/src/lib/env.ts`
- Modify: `apps/api/.env.example`

- [ ] **Step 1: Add `SUPABASE_URL` to env schema**

In `apps/api/src/lib/env.ts`, after the `DATABASE_URL` line, add:

```ts
  SUPABASE_URL: z.string().url(),
```

Final `envSchema` head should look like:

```ts
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_JWT_SECRET: z.string().min(32),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),
  // ... rest unchanged
```

- [ ] **Step 2: Update `apps/api/.env.example`**

Add `SUPABASE_URL=https://[REF].supabase.co` next to the other Supabase vars (or wherever the file groups them). If the file already has `SUPABASE_URL`, leave as-is.

- [ ] **Step 3: Refactor `apps/api/src/plugins/auth.ts` to use the typed env**

Currently:
```ts
const supabaseUrl = process.env.SUPABASE_URL
if (!supabaseUrl) {
  throw new Error('SUPABASE_URL environment variable is required')
}
```

Replace with:
```ts
import { env } from '../lib/env'
const supabaseUrl = env.SUPABASE_URL
```

(Adjust the import path if `auth.ts` already imports from `../lib/env` — just reuse the existing import.)

- [ ] **Step 4: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/env.ts apps/api/.env.example apps/api/src/plugins/auth.ts
git commit -m "chore(api): promote SUPABASE_URL into validated env schema"
```

---

## Task 2: Create the Supabase admin client

A separate client instance using the service-role key, isolated so elevated-privilege call sites are greppable.

**Files:**
- Create: `apps/api/src/lib/supabase-admin.ts`

- [ ] **Step 1: Create the file**

```ts
// apps/api/src/lib/supabase-admin.ts
//
// Service-role Supabase client for elevated-privilege operations
// (account deletion, etc.). Isolated from the RLS-aware query path so
// any route reaching for admin powers is obvious at grep time.
//
// NEVER use this client to satisfy normal route reads/writes — those
// must continue going through the JWT-bound drizzle path so RLS holds.

import { createClient } from '@supabase/supabase-js'
import { env } from './env'

export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
)
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/supabase-admin.ts
git commit -m "feat(api): add isolated Supabase admin client for privileged ops"
```

---

## Task 3: Add `DELETE /v1/user/me` route

The actual deletion endpoint. Calls `supabaseAdmin.auth.admin.deleteUser()` which removes `auth.users.id`, triggering the FK cascade chain.

**Files:**
- Modify: `apps/api/src/routes/user.ts`

- [ ] **Step 1: Import the admin client**

At the top of `apps/api/src/routes/user.ts`, add to existing imports:

```ts
import { supabaseAdmin } from '../lib/supabase-admin'
```

- [ ] **Step 2: Add the route handler**

Append inside `userRoutes(server: FastifyInstance)`, after the existing `PATCH /profile`:

```ts
  // DELETE /v1/user/me — permanently delete account + all associated data.
  // Cascades from auth.users -> user_profiles -> every user-keyed table.
  server.delete('/me', { preHandler: [server.authenticate] }, async (req, reply) => {
    const userId = req.userId!
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (error) {
      server.log.error({ userId, err: error }, 'account_delete_failed')
      return reply.code(500).send({ ok: false, error: 'Deletion failed', code: 'DELETE_FAILED' })
    }
    server.log.info({ userId }, 'account_deleted')
    return reply.send({ ok: true })
  })
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/user.ts
git commit -m "feat(api): add DELETE /v1/user/me for account deletion"
```

---

## Task 4: Add `deleteAccount()` to the mobile auth store

Bridge from the UI to the API. Clears local caches and session state on success. Deliberately does **not** call `supabase.auth.signOut()` because the server session is already gone after the admin delete.

**Files:**
- Modify: `apps/mobile/src/stores/auth.store.ts`

- [ ] **Step 1: Add `deleteAccount` to the `AuthState` interface**

Inside the `interface AuthState { ... }` block, add (alongside `signOut`):

```ts
  deleteAccount: () => Promise<void>
```

- [ ] **Step 2: Implement the method in the store**

Inside the `create<AuthState>(...)` body, after the existing `signOut` implementation, add:

```ts
  deleteAccount: async () => {
    // The server-side Supabase session is invalidated by the admin delete,
    // so we deliberately skip supabase.auth.signOut() (which would 401).
    // Local cache + session state cleanup is sufficient.
    await api.delete('/v1/user/me')
    clearProfileCache()
    clearLearnerProfileCache()
    set({ session: null, user: null })
  },
```

- [ ] **Step 3: Verify the `api` import already exists**

Look near the top of `apps/mobile/src/stores/auth.store.ts`. If `api` is not yet imported (the existing store may use only `supabase` directly), add:

```ts
import { api } from '../lib/api'
```

If `clearProfileCache` and `clearLearnerProfileCache` are not yet imported in this file, add them too — but they should already be there because the existing `signOut` method calls them.

- [ ] **Step 4: Typecheck**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/stores/auth.store.ts
git commit -m "feat(mobile): add deleteAccount() to auth store"
```

---

## Task 5: Create the `DeleteAccountModal` component

The confirmation UI. Modal with explanation, tutor-share warning, typed-`DELETE` gate, and Cancel/Delete buttons.

**Files:**
- Create: `apps/mobile/src/components/profile/DeleteAccountModal.tsx`

- [ ] **Step 1: Create the component file**

```tsx
// apps/mobile/src/components/profile/DeleteAccountModal.tsx
//
// Two-state modal for confirming account deletion.
// - Idle: explanation + warning + input field. Destructive button disabled
//   until input === 'DELETE' (exact match, uppercase).
// - Submitting: spinner; both buttons disabled.
// On success: caller is responsible for routing (typically replace('/deleted')).
// On failure: Alert + modal stays open.

import { useState } from 'react'
import {
  View, Text, Modal, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useAuthStore } from '../../stores/auth.store'
import { colors, spacing, radius, typography } from '../../theme'

const CONFIRM_WORD = 'DELETE'

interface Props {
  visible: boolean
  onDismiss: () => void
}

export function DeleteAccountModal({ visible, onDismiss }: Props) {
  const router = useRouter()
  const { deleteAccount } = useAuthStore()
  const [input, setInput] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  const canConfirm = input === CONFIRM_WORD && !isDeleting

  const handleConfirm = async () => {
    setIsDeleting(true)
    try {
      await deleteAccount()
      // Route BEFORE state clears propagate so the user sees the farewell.
      router.replace('/deleted')
    } catch (err: any) {
      Alert.alert(
        'Deletion failed',
        err?.message ?? 'Please try again or contact support.',
      )
      setIsDeleting(false)
    }
    // On success we navigated away — no need to reset isDeleting.
  }

  const handleCancel = () => {
    if (isDeleting) return
    setInput('')
    onDismiss()
  }

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={handleCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Delete account</Text>
          <Text style={styles.body}>
            This will permanently delete your account, kanji progress,
            mnemonics, and any active tutor shares. This cannot be undone.
          </Text>
          <Text style={styles.warning}>
            Any active tutor shares will be revoked.
          </Text>
          <Text style={styles.prompt}>
            Type <Text style={styles.confirmWord}>{CONFIRM_WORD}</Text> to confirm:
          </Text>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!isDeleting}
            placeholder={CONFIRM_WORD}
            placeholderTextColor={colors.textMuted}
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.cancelButton, isDeleting && styles.disabled]}
              onPress={handleCancel}
              disabled={isDeleting}
              activeOpacity={0.8}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmButton, !canConfirm && styles.confirmDisabled]}
              onPress={handleConfirm}
              disabled={!canConfirm}
              activeOpacity={0.8}
            >
              {isDeleting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.confirmText}>Delete account</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { ...typography.h2, color: colors.error },
  body: { ...typography.body, color: colors.textPrimary, lineHeight: 22 },
  warning: { ...typography.bodySmall, color: colors.warning, lineHeight: 20 },
  prompt: { ...typography.bodySmall, color: colors.textSecondary },
  confirmWord: { color: colors.error, fontWeight: '700' },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.textPrimary,
    ...typography.body,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  cancelText: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  confirmButton: {
    flex: 1,
    backgroundColor: colors.error,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  confirmDisabled: { opacity: 0.4 },
  confirmText: { ...typography.body, color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.5 },
})
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/profile/DeleteAccountModal.tsx
git commit -m "feat(mobile): add DeleteAccountModal with typed-DELETE confirmation"
```

---

## Task 6: Create the farewell screen + register the route

After deletion, the user lands on `/deleted` — a single-purpose screen that says goodbye and routes them to sign-in on tap.

**Files:**
- Create: `apps/mobile/app/deleted.tsx`
- Modify: `apps/mobile/app/_layout.tsx`

- [ ] **Step 1: Create `apps/mobile/app/deleted.tsx`**

```tsx
// apps/mobile/app/deleted.tsx
//
// Post-deletion farewell screen. Reached only via router.replace('/deleted')
// from the DeleteAccountModal after the API call succeeds. Lives outside the
// (auth) and (tabs) groups so it's not gated by either.

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { colors, spacing, radius, typography } from '../src/theme'

export default function DeletedScreen() {
  const router = useRouter()

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.container}>
        <Text style={styles.headline}>Your account has been deleted</Text>
        <Text style={styles.body}>
          We're sorry to see you go. All your data has been permanently removed.
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.replace('/(auth)/sign-in')}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>OK</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  headline: {
    ...typography.h1,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    marginTop: spacing.lg,
  },
  buttonText: { ...typography.h3, color: '#fff' },
})
```

- [ ] **Step 2: Register the route in `_layout.tsx`**

In `apps/mobile/app/_layout.tsx`, find the `<Stack>` block (around line 144). Add a `<Stack.Screen>` for `deleted`:

```tsx
        <Stack.Screen name="deleted" options={{ headerShown: false, gestureEnabled: false }} />
```

Place it next to the other `<Stack.Screen>` entries. `gestureEnabled: false` prevents swipe-back to a now-session-less screen.

- [ ] **Step 3: Update the routing effect to skip `/deleted`**

Still in `apps/mobile/app/_layout.tsx`, find the routing effect (around line 107). The first guard currently reads:

```tsx
    if (!session && !inAuthGroup) {
      router.replace('/(auth)/sign-in')
      return
    }
```

Replace with:

```tsx
    if (!session && !inAuthGroup && segments[0] !== 'deleted') {
      router.replace('/(auth)/sign-in')
      return
    }
```

This lets the farewell screen render briefly after `session` becomes null. The user then taps OK to navigate manually.

- [ ] **Step 4: Typecheck**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/deleted.tsx apps/mobile/app/_layout.tsx
git commit -m "feat(mobile): add post-deletion farewell screen + route guard"
```

---

## Task 7: Wire the destructive section into the Profile tab

Append the "Danger zone" section at the bottom of the Profile screen, below the existing Sign out button.

**Files:**
- Modify: `apps/mobile/app/(tabs)/profile.tsx`

- [ ] **Step 1: Import the modal at the top of the file**

Near the other component imports in `apps/mobile/app/(tabs)/profile.tsx`:

```tsx
import { DeleteAccountModal } from '../../src/components/profile/DeleteAccountModal'
```

- [ ] **Step 2: Add modal-visibility state**

Inside the `ProfileScreen` function body, alongside the other `useState` declarations (around line 46-60):

```tsx
  const [showDeleteModal, setShowDeleteModal] = useState(false)
```

- [ ] **Step 3: Append the destructive section to the JSX**

Find the existing Sign out button (around line 868) — `<TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} ...>`. Immediately after that `</TouchableOpacity>`, add:

```tsx
        <View style={styles.dangerZone}>
          <Text style={styles.dangerLabel}>Danger zone</Text>
          <TouchableOpacity
            style={styles.deleteAccountBtn}
            onPress={() => setShowDeleteModal(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="trash-outline" size={18} color={colors.error} />
            <Text style={styles.deleteAccountText}>Delete account</Text>
          </TouchableOpacity>
        </View>

        <DeleteAccountModal
          visible={showDeleteModal}
          onDismiss={() => setShowDeleteModal(false)}
        />
```

- [ ] **Step 4: Add the styles**

Find the `StyleSheet.create({` block. Near the existing `signOutBtn`/`signOutText` entries (around line 1267), add:

```tsx
  dangerZone: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  dangerLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  deleteAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  deleteAccountText: {
    ...typography.body,
    color: colors.error,
    fontWeight: '600',
  },
```

(`StyleSheet` is already imported at the top of profile.tsx.)

- [ ] **Step 5: Typecheck**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/app/\(tabs\)/profile.tsx
git commit -m "feat(mobile): add Danger zone with Delete account to Profile tab"
```

---

## Task 8: Optional — integration test for the cascade

The spec marked this as optional. Skip if you want to ship faster; include if you want a regression net for the FK cascade.

This test inserts a fake user_profiles row plus downstream rows directly via drizzle, then deletes the user_profiles row (simulating what the cascade does after `auth.users` deletion), and verifies all downstream rows are gone. We can't easily test the `auth.users` delete itself in unit tests because the test DB doesn't usually have a real Supabase auth schema.

**Files:**
- Create: `apps/api/test/integration/user-delete.test.ts`

- [ ] **Step 1: Create the test file**

```ts
// apps/api/test/integration/user-delete.test.ts
//
// Verifies that deleting a user_profiles row cascades through every
// user-keyed table. Mirrors what supabaseAdmin.auth.admin.deleteUser()
// triggers in production via the auth.users -> user_profiles FK chain.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import {
  userProfiles,
  learnerProfiles,
  userKanjiProgress,
} from '@kanji-learn/db'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const TEST_USER = '00000000-0000-0000-0000-000000000777'

beforeAll(async () => {
  // Clean slate
  await db.execute(sql`DELETE FROM user_profiles WHERE id = ${TEST_USER}`)
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM user_profiles WHERE id = ${TEST_USER}`)
  await client.end()
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM user_profiles WHERE id = ${TEST_USER}`)
})

describe('user_profiles delete cascade', () => {
  it('removes downstream rows when user_profiles is deleted', async () => {
    // Seed: profile + learner_profile + a progress row
    await db.insert(userProfiles).values({
      id: TEST_USER,
      displayName: 'CascadeTest',
      timezone: 'UTC',
    })
    await db.insert(learnerProfiles).values({
      userId: TEST_USER,
      country: 'AU',
      reasonsForLearning: ['Travel'],
      interests: [],
    })
    await db.insert(userKanjiProgress).values({
      userId: TEST_USER,
      kanjiId: 1,
    })

    // Sanity: rows exist
    const learnerBefore = await db.query.learnerProfiles.findFirst({
      where: eq(learnerProfiles.userId, TEST_USER),
    })
    expect(learnerBefore).toBeTruthy()

    // Delete user_profiles
    await db.delete(userProfiles).where(eq(userProfiles.id, TEST_USER))

    // All downstream rows should be gone
    const learnerAfter = await db.query.learnerProfiles.findFirst({
      where: eq(learnerProfiles.userId, TEST_USER),
    })
    const progressAfter = await db.query.userKanjiProgress.findFirst({
      where: eq(userKanjiProgress.userId, TEST_USER),
    })
    expect(learnerAfter).toBeUndefined()
    expect(progressAfter).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test**

```bash
cd apps/api && npm test -- user-delete
```

Expected: the test passes. If it fails because a downstream FK lacks `ON DELETE CASCADE`, that's the test catching a real bug — fix the schema and re-run.

If your test DB doesn't have `userKanjiProgress`'s `kanji_id` FK target (the kanji table) populated, drop the `userKanjiProgress` insert — the cascade test still works with just `learnerProfiles`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/integration/user-delete.test.ts
git commit -m "test(api): verify user_profiles delete cascade"
```

---

## Task 9: Manual TestFlight verification

Code is shipped to TestFlight via EAS (your existing flow). This task confirms the feature works end-to-end on a real device.

- [ ] **Step 1: Deploy the API**

```bash
DOCKER_CONTEXT=default ./scripts/deploy-api.sh
```

Wait for "App Runner deployment triggered" + 3-5 min for it to finish (check the App Runner console).

- [ ] **Step 2: Build + submit the mobile app**

```bash
cd apps/mobile
eas build --platform ios --profile production --non-interactive --auto-submit
```

Wait for build (~10-15 min) + submission + Apple processing (~15-30 min).

- [ ] **Step 3: TestFlight test on device**

Once the new build appears in TestFlight:

1. Sign up a throwaway account (Google or email/password).
2. Complete onboarding, decline placement.
3. Add some kanji progress (mark a few reviews).
4. (Optional) Set up a tutor share to verify the warning appears.
5. Profile tab → scroll to bottom → "Danger zone" → "Delete account".
6. Verify: the destructive button is disabled until you type `DELETE` (uppercase).
7. Tap "Delete account" → spinner → farewell screen renders.
8. Tap OK → land on sign-in screen.
9. Sign up again with the same email → confirm fresh account, no leftover progress, kanji counts at zero.

- [ ] **Step 4: Verify in Supabase dashboard**

Open Supabase SQL editor and run (replace email with your throwaway):

```sql
-- Confirm auth.users row is gone
SELECT id, email FROM auth.users WHERE email = 'throwaway@example.com';
-- Expected: 0 rows

-- Confirm no orphans in user-keyed tables (using a recently deleted user_id):
-- (Track the user_id from before deletion if you want a precise check.
--  Otherwise, scan for any row whose user_id no longer matches an auth.users row.)
SELECT COUNT(*) FROM user_profiles up
LEFT JOIN auth.users au ON au.id = up.id
WHERE au.id IS NULL;
-- Expected: 0 (cascade should have cleaned everything)
```

- [ ] **Step 5: Mark feature complete**

If all checks pass, append a one-line entry to the BUGS / ENHANCEMENTS tracker noting that App Store 5.1.1 is now satisfied.

---

## Self-Review Notes

The plan covers every section of the spec:

- ✅ Backend route + admin client (Tasks 1-3)
- ✅ Mobile auth-store method (Task 4)
- ✅ Confirmation modal (Task 5)
- ✅ Farewell screen + routing (Task 6)
- ✅ Profile tab integration (Task 7)
- ✅ Optional integration test (Task 8)
- ✅ Manual TestFlight verification (Task 9)

Things deferred per spec:
- SES email confirmation (blocked on SES production access)
- Tutor revocation email (same)
- Watch app 401 recovery (separate generalized fix)
- Soft delete / grace period (rejected in design)
