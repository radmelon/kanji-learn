# Delete Account — Design Spec

**Date:** 2026-04-17
**Status:** Design approved, ready for implementation plan
**Priority:** High — App Store Review Guideline 5.1.1 launch blocker
**Estimated effort:** M

## Context

App Store Review Guideline 5.1.1 requires apps that support account creation to offer in-app account deletion. Kanji Learn cannot ship publicly without this.

This spec defines an immediate hard-delete flow: one user tap + typed-word confirmation permanently removes the account and all associated data.

## Decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Delete semantics | Immediate hard delete | Simpler to build and reason about; no retention obligation; matches peer apps (Duolingo, Anki). |
| Confirmation friction | Typed `DELETE` (exact, uppercase) | Zero-accident industry pattern (GitHub, Stripe, Linear). Re-auth adds complexity for modest additional safety. |
| Post-delete UX | Farewell screen → sign-in | Respectful tone, signals success. No SES email (SES still in sandbox). |
| Tutor share revocation | Silent 404 + modal warning | Tutors are recipients, not customers. Warning gives the student informed consent. |
| Watch cleanup | Rely on existing 401 handling | Out-of-scope here; generalized fix belongs in Watch app if broken. |
| Audit trail | Fastify log line only (userId + timestamp) | No compliance requirement; standard log is enough for support cases. |

## User Flow

1. **Entry:** Profile tab → scroll to bottom → destructive "Danger zone" section with a red "Delete account" button.
2. **Confirmation modal:** explains what will be deleted, warns about tutor shares, shows a text field.
3. **Gating:** destructive button enabled only when input equals exactly `DELETE` (uppercase).
4. **Submit:** spinner → API call → success.
5. **Farewell:** full-screen "Your account has been deleted. We're sorry to see you go." + single OK button.
6. **Return:** tap OK → local auth cleared → routes to `/(auth)/sign-in`.

## Architecture

### Backend — `DELETE /v1/user/me`

One new route in `apps/api/src/routes/user.ts` using a new Supabase admin client.

**New file: `apps/api/src/lib/supabase-admin.ts`**

```ts
import { createClient } from '@supabase/supabase-js'
import { env } from './env'

export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)
```

Isolated from the RLS-aware query client so elevated-privilege call sites are greppable.

**Route handler (appended to `user.ts`):**

```ts
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

**Why `/me` and not `/:id`:** REST idiom for "the authenticated user," impossible to misuse by sending someone else's ID.

**Cascade propagation:**
1. Admin call deletes the `auth.users` row.
2. `user_profiles.id REFERENCES auth.users(id) ON DELETE CASCADE` fires → profile row dies.
3. Every other user-keyed table has `ON DELETE CASCADE` on `user_profiles.id` (71 declarations across 10 files). All downstream rows die in the same transaction.

No manual table-by-table cleanup needed.

### Mobile — new routes and components

**New component: `apps/mobile/src/components/profile/DeleteAccountModal.tsx`**

Responsibilities:
- Render modal (explanation + tutor warning + input field + Cancel/Delete buttons).
- Enable destructive button only when `input === 'DELETE'`.
- On confirm: call `useAuthStore().deleteAccount()`.
- On success: `router.replace('/deleted')`.
- On error: `Alert.alert('Deletion failed', ...)`, keep modal open.

Local state: `input: string`, `isDeleting: boolean`. No other state.

**New route: `apps/mobile/app/deleted.tsx`**

Full-screen farewell, outside `(auth)` and `(tabs)` groups. Single OK button → `router.replace('/(auth)/sign-in')`. Registered in root `<Stack>` with `gestureEnabled: false` so the user can't swipe back to a session-gated screen.

**Edit: `apps/mobile/app/_layout.tsx`**

1. Register the new stack screen.
2. Update the sign-in redirect to exempt `/deleted`:

```ts
if (!session && !inAuthGroup && segments[0] !== 'deleted') {
  router.replace('/(auth)/sign-in')
}
```

**Edit: `apps/mobile/app/(tabs)/profile.tsx`**

Append destructive section after existing settings. Uses `colors.danger` (add to theme if missing):

```tsx
<View style={styles.dangerSection}>
  <Text style={styles.dangerLabel}>Danger zone</Text>
  <TouchableOpacity style={styles.dangerButton} onPress={() => setShowDeleteModal(true)}>
    <Ionicons name="trash-outline" size={18} color={colors.danger} />
    <Text style={styles.dangerText}>Delete account</Text>
  </TouchableOpacity>
</View>
<DeleteAccountModal visible={showDeleteModal} onDismiss={() => setShowDeleteModal(false)} />
```

**Edit: `apps/mobile/src/stores/auth.store.ts`**

New `deleteAccount` method:

```ts
deleteAccount: async () => {
  await api.delete('/v1/user/me')
  clearProfileCache()
  clearLearnerProfileCache()
  set({ session: null, user: null })
},
```

Deliberately does **not** call `supabase.auth.signOut()` — the server-side session is already invalid. Clearing local state is sufficient; SecureStore will re-hydrate empty on next launch.

**Edit: `apps/mobile/src/theme/index.ts`** (if missing)

Add `danger: '#DC2F3C'` (or similar) to the colors object.

## Failure Modes

| Scenario | Behavior |
|---|---|
| Network error | `api.delete` throws → modal catches → Alert, modal stays open. |
| Server 500 (admin call failed) | Same as above — Alert, modal stays open. No partial state, because the cascade is a single SQL transaction. |
| User backgrounds app mid-delete | API call completes or fails independently. On foreground, either still valid (retry) or already deleted (next API call 401s → existing 401 handling signs out). |
| Double-tap "Delete" | `isDeleting` flag disables the button; second tap is a no-op. |

## Testing

**API unit test** (`apps/api/test/unit/user.test.ts` or similar):
- Stub `supabaseAdmin.auth.admin.deleteUser` → assert response shape for success and failure.

**API integration test** (optional but recommended):
- Create a test user, seed downstream rows (progress, review_logs, tutor_shares).
- Call `DELETE /v1/user/me`.
- Assert all rows gone from every user-keyed table.
- Catches future cascade regressions.

**Mobile manual test** (TestFlight):
1. Sign up a throwaway account.
2. Complete onboarding, add some kanji progress, share with a fake tutor.
3. Tap Delete Account → type `DELETE` → confirm.
4. See farewell → tap OK → lands on sign-in.
5. Sign up again with the same email → confirm fresh account with no leftover state.
6. (Optional) check Supabase dashboard — confirm `auth.users` row is gone and no orphaned rows in any user-keyed table.

## File Summary

| File | Change |
|---|---|
| `apps/api/src/lib/supabase-admin.ts` | New |
| `apps/api/src/routes/user.ts` | Add `DELETE /me` |
| `apps/api/test/integration/user-delete.test.ts` | New (optional) |
| `apps/mobile/src/stores/auth.store.ts` | Add `deleteAccount()` |
| `apps/mobile/src/components/profile/DeleteAccountModal.tsx` | New |
| `apps/mobile/app/deleted.tsx` | New |
| `apps/mobile/app/_layout.tsx` | Register stack screen + routing skip |
| `apps/mobile/app/(tabs)/profile.tsx` | Append destructive section |
| `apps/mobile/src/theme/index.ts` | Add `colors.danger` if missing |

## Out of Scope

- SES email notification of deletion (blocked on SES production access).
- Tutor email notification of share revocation (same).
- Watch app 401 recovery (separate generalized fix).
- Soft-delete / grace period (explicitly rejected; hard delete only).
- Audit table beyond Fastify log line.
