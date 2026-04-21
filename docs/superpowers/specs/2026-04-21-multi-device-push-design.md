# Multi-Device Push Notifications — Design

**Date:** 2026-04-21
**Status:** Approved, ready for implementation planning

## Problem

The current push architecture stores exactly one Expo push token per user (`user_profiles.push_token`, a single nullable column). Each device that signs in overwrites the prior device's token. A user signed in on multiple devices therefore receives notifications on whichever device registered most recently — all earlier devices go silent.

**Incident that surfaced this:** 2026-04-21. Owner is logged into the same account on both iPhone and iPad. A "study-mate just studied" notification reached the iPad but not the iPhone. The Watch (paired to the iPhone) also did not receive it. Investigation confirmed the iPad's token had overwritten the iPhone's in `user_profiles.push_token`.

## Root cause

- **Schema:** `user_profiles.push_token` is a single nullable `text` column. [`packages/db/src/schema.ts:148`](../../../packages/db/src/schema.ts).
- **Write path:** mobile app calls `PATCH /v1/user/profile` with `{ pushToken }` on every launch. [`apps/mobile/src/hooks/usePushNotifications.ts:70`](../../../apps/mobile/src/hooks/usePushNotifications.ts). Each call replaces the prior value.
- **Send path:** notification service reads the single column and sends one push per recipient. [`apps/api/src/services/notification.service.ts:175-184`](../../../apps/api/src/services/notification.service.ts). No fan-out.

## Goals

- A user signed in on any number of devices receives notifications on all of them.
- Stale tokens (app reinstall, user signed out, device reset) are pruned without manual intervention.
- Design supports iOS today and Android without rework when we ship Android.

## Non-goals

- Per-device notification preferences (e.g. "Watch-only mate alerts"). Future enhancement.
- Async receipt polling worker for tokens that are silently unregistered. Future enhancement.
- Stable `device_id` identity across token rotations. Future enhancement (YAGNI at 2-user scale).
- Apple Watch receiving push independently of its paired iPhone. Out of scope — iOS auto-forwards iPhone notifications to the Watch.

## Decisions

| # | Question | Choice |
|---|---|---|
| 1 | Expected behavior on multiple devices? | **Fan out to all; let iOS collapse cross-device banners.** Android receives independent banners per device — accepted. |
| 2 | Data model for tokens? | **Simple `(user_id, token)` schema.** Prune via Expo ticket errors (`DeviceNotRegistered`, `InvalidCredentials`, `MessageTooBig`). Add `device_id` later if scale demands. |
| 3 | Handling sign-out on a device? | **Both active DELETE and receipt pruning.** Explicit logout calls the API best-effort; receipt pruning is the safety net. |
| 4 | API shape? | **Dedicated `POST /v1/push-tokens` + `DELETE /v1/push-tokens`.** `PATCH /v1/user/profile` no longer accepts `pushToken`. |
| 5 | Per-category notification preferences? | **Per-study-mate mute, not a global category toggle.** Each accepted friendship carries a "notify me when they study" flag the owning user controls from their Study Mates list (bell-icon toggle on each row). Scales cleanly as the mate count grows. The master `notificationsEnabled` remains the all-or-nothing master switch; daily reminders and rest-day summaries continue honoring only the master. |

## Architecture

### Database (migration `0021_push_tokens_and_mate_mute.sql`)

```sql
CREATE TABLE user_push_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  token       text NOT NULL,
  platform    text NOT NULL CHECK (platform IN ('ios','android')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);
CREATE INDEX user_push_tokens_user_id_idx ON user_push_tokens(user_id);

ALTER TABLE user_push_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_push_tokens_self_read   ON user_push_tokens FOR SELECT USING (user_id = auth.uid());
CREATE POLICY user_push_tokens_self_insert ON user_push_tokens FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY user_push_tokens_self_delete ON user_push_tokens FOR DELETE USING (user_id = auth.uid());
-- No UPDATE policy: tokens are immutable; rotation creates a new row.

ALTER TABLE user_profiles DROP COLUMN push_token;

-- Per-side mate-alert mute, stored on the existing directed friendship row.
-- `requester_notify_of_activity` is the requester's preference ("notify me when
-- the addressee studies"); `addressee_notify_of_activity` mirrors it for the
-- addressee. Two columns avoid reshaping friendships into an undirected model
-- and keep the per-side toggle a single join-less UPDATE.
ALTER TABLE friendships
  ADD COLUMN requester_notify_of_activity boolean NOT NULL DEFAULT true,
  ADD COLUMN addressee_notify_of_activity boolean NOT NULL DEFAULT true;
```

Notes:
- `ON DELETE CASCADE` on `user_id` means account deletion automatically removes all tokens (no explicit cleanup needed in `deleteAccount`).
- RLS policies mirror the self-scoping pattern established in migration 0018 (35/35 coverage).
- `platform` is populated from `Platform.OS` in the mobile registration call. Enables future per-platform behavior (e.g. Expo `collapseId` on Android) without another migration.

### API

**New file:** `apps/api/src/routes/push-tokens.ts`

| Verb | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/v1/push-tokens` | `server.authenticate` | `{ token: string, platform: 'ios' \| 'android' }` | 201 on insert, 200 if row already existed |
| DELETE | `/v1/push-tokens` | `server.authenticate` | `{ token: string }` | 204 (idempotent; 204 also when row missing) |

Validation:
- `token` must start with `ExponentPushToken[` and be non-empty (matches Expo's format).
- `platform` must be one of `ios` | `android`.
- Write operations dedupe on `UNIQUE (user_id, token)`.

**Removed behavior:** `PATCH /v1/user/profile` no longer accepts `pushToken`. The field is dropped from the `UserProfile` DTO in both API and `@kanji-learn/shared`. If an older mobile client still sends it, the server silently drops the field (defensive — but we ship mobile in lockstep, so this won't happen in practice).

**New endpoint for per-mate mute** on the existing `apps/api/src/routes/social.ts`:

| Verb | Path | Auth | Body | Response |
|---|---|---|---|---|
| PATCH | `/v1/social/friends/:friendId` | `server.authenticate` | `{ notifyOfActivity: boolean }` | 200 with updated friend record |

Handler logic:
- Look up the friendship row by `(requesterId = currentUser AND addresseeId = :friendId) OR (addresseeId = currentUser AND requesterId = :friendId)` with `status = 'accepted'`.
- If the caller is the requester, UPDATE `requester_notify_of_activity`; otherwise UPDATE `addressee_notify_of_activity`.
- 404 if no accepted friendship exists.

`GET /v1/social/friends` is extended to return each row's `notifyOfActivity` — resolved server-side from the caller's perspective, so the client just consumes a single boolean per friend.

### Notification send path

**New helper in `apps/api/src/services/notification.service.ts`:**

```ts
const DEAD_TOKEN_ERRORS = new Set(['DeviceNotRegistered', 'InvalidCredentials', 'MessageTooBig'])

async function sendToUserTokens(userId: string, message: Omit<ExpoPushMessage, 'to'>) {
  const rows = await db
    .select({ token: userPushTokens.token })
    .from(userPushTokens)
    .where(eq(userPushTokens.userId, userId))

  if (rows.length === 0) return { sent: 0, pruned: 0 }

  const messages = rows.map((r) => ({ ...message, to: r.token }))
  const tickets = await expo.sendPushNotificationsAsync(messages)

  const dead: string[] = []
  tickets.forEach((t, i) => {
    if (t.status === 'error' && DEAD_TOKEN_ERRORS.has(t.details?.error ?? '')) {
      dead.push(rows[i].token)
    }
  })
  if (dead.length > 0) {
    await db.delete(userPushTokens)
      .where(and(eq(userPushTokens.userId, userId), inArray(userPushTokens.token, dead)))
  }
  console.log(`[Push] userId=${userId} sent=${tickets.length} pruned=${dead.length}`)
  return { sent: tickets.length, pruned: dead.length }
}
```

- **Single batched Expo call** per recipient (Expo accepts arrays; respects their rate limits).
- **Synchronous ticket pruning only.** Async receipt polling is future work.
- **Observability:** logs `{ userId, sent, pruned }` per call.

**Callers that change:**

1. `notifyStudyMates` (mate-alert) — replace the single-token push at [notification.service.ts:183-190](../../../apps/api/src/services/notification.service.ts) with `sendToUserTokens(friend.id, { title, body, sound, data })`. The 24h `mateNotifyCache` frequency cap is keyed on `(submitterId, friend.id)` and stays unchanged. Add a **per-side mute check** before the cap lookup:
   ```ts
   const recipientNotifyOn = row.requesterId === submitterId
     ? row.addresseeNotifyOfActivity
     : row.requesterNotifyOfActivity
   if (!recipientNotifyOn) continue
   ```
   Short-circuits earliest (no cache entry consumed, no send, no prune). The existing `notificationsEnabled` master check stays as the first guard.
2. `sendDailyReminders` / `sendRestDaySummaries` — replace per-user `pushToken` reads with `sendToUserTokens(user.id, ...)`. Hourly-gate and restDay filters stay unchanged.
3. `apps/lambda/daily-reminders` — same swap pattern. The lambda stops selecting `pushToken` and instead joins `user_push_tokens` by `user_id`, fanning out per user.

### Mobile app

**File:** `apps/mobile/src/hooks/usePushNotifications.ts`

Replace the PATCH call with:
```ts
await api.post('/v1/push-tokens', {
  token,
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
})
await storage.setItem('kl:last_push_token', token)
```
- `savedRef.current` gate remains — prevents re-registering in the same session.
- If Expo rotates the token on a later launch (reinstall, OS update), the hook re-runs fresh and POSTs the new one. The old token prunes naturally on the next failed send.
- Storing `kl:last_push_token` lets logout target the correct row for DELETE.

**File:** `apps/mobile/src/stores/auth.store.ts`

Extend `signOut`:
```ts
signOut: async () => {
  const lastToken = await storage.getItem<string>('kl:last_push_token')
  if (lastToken) {
    try { await api.delete('/v1/push-tokens', { body: { token: lastToken } }) }
    catch { /* swallow — receipt pruning is the safety net */ }
  }
  await storage.removeItem('kl:last_push_token')
  clearProfileCache()
  clearLearnerProfileCache()
  await supabase.auth.signOut()
  set({ session: null, user: null })
},
```

`deleteAccount` requires no explicit DELETE call — `ON DELETE CASCADE` removes all the user's tokens when the profile row is deleted.

**Types cleanup:** drop `pushToken` from the `UserProfile` interface in [`apps/mobile/app/(tabs)/profile.tsx`](../../../apps/mobile/app/(tabs)/profile.tsx) and from `@kanji-learn/shared`. The `Friend` / friendship DTO gains `notifyOfActivity: boolean` (resolved server-side from the caller's perspective).

**Per-mate mute UI in the Study Mates panel** (already inside the Profile screen at [profile.tsx:614](../../../apps/mobile/app/(tabs)/profile.tsx:614)): each accepted friend row gets a bell-icon toggle on the right edge. Tap flips `notifyOfActivity` via `PATCH /v1/social/friends/:friendId`. Optimistic UI update; revert on error. When the master `notificationsEnabled` is off, the bell renders in a dimmed/disabled state with a caption explaining that all notifications are off (tapping the row reveals "Turn on notifications in the Notifications section above"). Pending friend requests don't show the bell — only accepted friendships.

**No Notifications-panel changes** for this feature beyond the existing master toggle. All mate-alert control lives in the Study Mates panel.

**Watch app:** unchanged. The Watch doesn't register its own Expo token; it relies on iOS auto-forwarding from the iPhone. Since iPhone now receives reliably, Watch inherits.

## Rollout order

1. Apply migration 0021 to prod (table created + `push_token` column dropped atomically).
2. Deploy API with the new routes + `sendToUserTokens` helper (references to `user_profiles.pushToken` removed in the same deploy).
3. Cut a mobile TestFlight build with the new register/unregister calls and updated `UserProfile` type.
4. Both testers launch the app → mobile auto-registers the device's token → mate-alerts resume.

**Downtime window:** pushes are silent between step 1 and step 4 for any user who hasn't re-registered. At 2 users with coordination, this is seconds/minutes. Existing `push_token` values are intentionally dropped — they'd be stale any time the other device had last logged in.

**Rollback plan:** forward-fix only. Restoring the old column from backup would lose newly-registered tokens. At 2 users the blast radius is trivial.

**Deploy ordering risk:** if migration 0021 succeeds but API deploy (step 2) fails, the running (old) API still references the now-dropped `user_profiles.push_token` column on profile PATCH and will 500. Mitigation: the API build + integration tests run against the new schema in CI *before* the migration ships to prod. For extra safety, prepare the rollout as a single PR containing both the migration and the API changes so they're reviewed together; merge and deploy in tight sequence.

## Testing

| Layer | Test | Location |
|---|---|---|
| API integration | `POST /v1/push-tokens` inserts a row; duplicate `(user_id, token)` returns 200 no-op | `apps/api/src/routes/push-tokens.integration.test.ts` |
| API integration | `DELETE /v1/push-tokens` removes the row; missing token returns 204 | same file |
| API auth | Both endpoints 401 without JWT | same file |
| API validation | Malformed token / unknown platform returns 400 | same file |
| API integration | `PATCH /v1/social/friends/:friendId` with `{ notifyOfActivity: false }` updates the caller's side of the friendship row | `apps/api/src/routes/social.integration.test.ts` |
| API integration | `PATCH` from the other side of the same friendship updates the opposite column — the two sides are independent | same file |
| API integration | `PATCH` against a non-accepted or non-existent friendship returns 404 | same file |
| API integration | `GET /v1/social/friends` returns `notifyOfActivity` resolved from the caller's perspective | same file |
| Service unit | `notifyStudyMates` short-circuits without touching the 24h cache when the recipient has muted the submitter on their side of the friendship | `apps/api/src/services/notification.service.test.ts` |
| Service unit | Recipient muting submitter does not affect the submitter's own alerts when the recipient studies | same file |
| Service unit | Daily reminders + rest-day summaries fire regardless of any per-mate mute state (master `notificationsEnabled` still on) | same file |
| Service unit | `sendToUserTokens` fans out to N tokens in a single Expo batch | `apps/api/src/services/notification.service.test.ts` |
| Service unit | Tickets with `DeviceNotRegistered` / `InvalidCredentials` / `MessageTooBig` prune those specific rows; success tickets leave rows intact | same file |
| Service unit | `sendToUserTokens(userId)` with zero tokens is a safe no-op | same file |
| Manual (pre-merge, on-device) | Sign in on iPhone + iPad as same user; partner account submits a review; both devices banner | on-device |
| Manual (pre-merge, on-device) | Sign out on iPhone; partner submits again; only iPad banners | on-device |
| Manual (pre-merge, on-device) | Sign in on iPhone fresh install; prior token for that user survives (other device unaffected) | on-device |
| Not tested | Async receipt pruning — requires real expired tokens; verified in production as tokens naturally expire | — |

## Preserved invariants

- **24h mate-alert cap** keyed on `(submitterId, recipientId)` at [notification.service.ts:178-181](../../../apps/api/src/services/notification.service.ts) — unchanged. Fan-out does not re-trigger the cap; it replaces a single-token send with a multi-token send for the same logical alert.
- **`notificationsEnabled=false`** still suppresses *all* pushes to that user — master switch, checked before `sendToUserTokens` in every send path.
- **Per-friendship mute** (recipient's `*_notify_of_activity = false`) suppresses *only* mate alerts from that specific submitter to that specific recipient. Daily reminders and rest-day summaries continue. Checked inside `notifyStudyMates` before the 24h cap so cache entries aren't consumed by suppressed alerts. Mute is directional: each side of the friendship toggles their own preference independently.
- **Daily-reminder hour-gate** (user's local `reminderHour`) — unchanged.
- **Rest-day filter** on `sendRestDaySummaries` — unchanged.

## Future enhancements (deferred)

- **Async receipt poller.** Catches tokens that are valid-format but silently unregistered at APNs/FCM level. Currently one wasted send per such token before the next ticket prunes it. At 2 users, negligible.
- **`device_id` column.** Stable client-generated UUID per install; lets us `UPSERT (user_id, device_id)` and replace tokens in-place on rotation. Cleaner identity model; defer until we see real churn.
- **Per-device notification preferences.** E.g. "don't buzz Watch for mate alerts after 10pm". Adds UI surface; not needed at current scale.
- **Server-side `todayReviewed` on `/v1/review/status`.** Separate follow-up already filed; lets the Watch hero show true daily progress instead of remaining-due capped at goal.
