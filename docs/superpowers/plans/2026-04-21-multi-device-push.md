# Multi-Device Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user receive push notifications on every device they're signed in to by replacing the single `user_profiles.push_token` column with a one-to-many `user_push_tokens` table, and add per-study-mate mute control via two new columns on `friendships`.

**Architecture:** Schema migration swaps a single-token column for a dedicated table. API gains `POST`/`DELETE /v1/push-tokens` for token lifecycle and a `PATCH /v1/social/friends/:friendId` for per-mate mute. `NotificationService` gains a `sendToUserTokens` helper that fans out a single Expo batch call across all a user's tokens and synchronously prunes tokens that ticket with `DeviceNotRegistered` / `InvalidCredentials` / `MessageTooBig`. Mobile switches its registration call to the new endpoint, persists the current-device token for logout DELETE, and adds a bell toggle on each accepted friend row in the Study Mates panel.

**Tech Stack:** Drizzle ORM + Supabase (Postgres) + Fastify (API) + Expo SDK (mobile) + Vitest (API tests) + Jest (mobile tests)

**Spec:** [docs/superpowers/specs/2026-04-21-multi-device-push-design.md](../specs/2026-04-21-multi-device-push-design.md)

---

## File Structure

**Created:**
- `packages/db/supabase/migrations/0021_push_tokens_and_mate_mute.sql` — table + friendship columns + drop push_token
- `apps/api/src/routes/push-tokens.ts` — Fastify route plugin for POST/DELETE
- `apps/api/test/integration/push-tokens.test.ts` — route integration tests
- `apps/api/test/unit/services/notification-send-to-user-tokens.test.ts` — unit tests for the new helper + per-mate mute + caller changes
- `apps/api/test/integration/social-mute.test.ts` — PATCH + GET integration tests

**Modified:**
- `packages/db/src/schema.ts` — add `userPushTokens` export, drop `pushToken` from `userProfiles`, add `requesterNotifyOfActivity` + `addresseeNotifyOfActivity` to `friendships`
- `apps/api/src/services/notification.service.ts` — add `sendToUserTokens` method, update `notifyStudyMates`, `sendDailyReminders`, `sendRestDaySummaries` to use it; add per-mate mute check
- `apps/api/src/routes/social.ts` — add `PATCH /v1/social/friends/:friendId`, extend `GET /v1/social/friends` response to include `notifyOfActivity`
- `apps/api/src/services/social.service.ts` — add `setNotifyOfActivity` method; extend friends-list query to project the correct column per caller
- `apps/api/src/routes/user.ts` — remove `pushToken` from the `/v1/user/profile` PATCH accept-list and the `UserProfile` response DTO
- `apps/api/src/server.ts` (or equivalent plugin-registration file) — register `pushTokensRoute`
- `apps/mobile/src/hooks/usePushNotifications.ts` — POST to new endpoint, persist token to storage
- `apps/mobile/src/stores/auth.store.ts` — extend `signOut` to DELETE the stored token
- `apps/mobile/app/(tabs)/profile.tsx` — drop `pushToken` from `UserProfile` interface, add `notifyOfActivity` to the friend row type, add bell toggle UI to each accepted friend
- `packages/shared/src/types/*` (or wherever DTOs live) — drop `pushToken` from `UserProfile`, add `notifyOfActivity` to friend DTO

**Not modified:**
- `apps/lambda/daily-reminders/index.mjs` — the lambda only POSTs to `/internal/daily-reminders`; no token handling there. All swap work happens inside `notification.service.ts`.
- `apps/watch/*` — Watch doesn't register its own Expo token; relies on iOS auto-forwarding.

---

## Task 1: Database migration + schema update

**Files:**
- Create: `packages/db/supabase/migrations/0021_push_tokens_and_mate_mute.sql`
- Modify: `packages/db/src/schema.ts:142-156` (user_profiles — drop pushToken), `packages/db/src/schema.ts:430-445` (friendships — add two columns)
- Modify: `packages/db/src/schema.ts` after the userProfiles table definition (add userPushTokens)

- [ ] **Step 1: Write the migration file**

Create `packages/db/supabase/migrations/0021_push_tokens_and_mate_mute.sql`:

```sql
-- Multi-device push tokens: replaces single user_profiles.push_token column.
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

CREATE POLICY user_push_tokens_self_read
  ON user_push_tokens FOR SELECT USING (user_id = auth.uid());
CREATE POLICY user_push_tokens_self_insert
  ON user_push_tokens FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY user_push_tokens_self_delete
  ON user_push_tokens FOR DELETE USING (user_id = auth.uid());
-- No UPDATE policy: tokens are immutable; rotation creates a new row.

-- Service role bypass for server-side fan-out / pruning.
CREATE POLICY user_push_tokens_service_all
  ON user_push_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Drop the now-unused single-token column.
ALTER TABLE user_profiles DROP COLUMN push_token;

-- Per-friendship mute: each side of a friendship controls their own side.
ALTER TABLE friendships
  ADD COLUMN requester_notify_of_activity boolean NOT NULL DEFAULT true,
  ADD COLUMN addressee_notify_of_activity boolean NOT NULL DEFAULT true;
```

Before proceeding, skim `packages/db/supabase/migrations/0018_rls_placement_tutor_tables.sql` to confirm the existing RLS policy style matches (`auth.uid()` + service_role bypass pattern).

- [ ] **Step 2: Update schema.ts — drop pushToken, add userPushTokens, add friendship columns**

In `packages/db/src/schema.ts`:

Change lines 142-156:

```typescript
export const userProfiles = pgTable('user_profiles', {
  id: uuid('id').primaryKey(),
  displayName: text('display_name'),
  email: text('email'),
  dailyGoal: smallint('daily_goal').notNull().default(20),
  notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
  // pushToken removed — see user_push_tokens table below.
  timezone: text('timezone').notNull().default('UTC'),
  reminderHour: smallint('reminder_hour').notNull().default(20),
  restDay: smallint('rest_day'),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  showPitchAccent: boolean('show_pitch_accent').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

Immediately after the `userProfiles` table (before `user_kanji_progress`), add:

```typescript
// ─── user_push_tokens ─────────────────────────────────────────────────────────
// One row per (user, Expo push token). A user can be signed in on multiple
// devices; every device registers its own token here. Stale tokens are pruned
// synchronously when Expo's send tickets return DeviceNotRegistered.

export const userPushTokens = pgTable(
  'user_push_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: text('platform').notNull(), // 'ios' | 'android', enforced by CHECK constraint
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userTokenUnique: uniqueIndex('user_push_tokens_user_token_idx').on(t.userId, t.token),
    userIdIdx: index('user_push_tokens_user_id_idx').on(t.userId),
  }),
)
```

Update `friendships` table (packages/db/src/schema.ts:430-445):

```typescript
export const friendships = pgTable(
  'friendships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requesterId: uuid('requester_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
    addresseeId: uuid('addressee_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    requesterNotifyOfActivity: boolean('requester_notify_of_activity').notNull().default(true),
    addresseeNotifyOfActivity: boolean('addressee_notify_of_activity').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniquePair: uniqueIndex('friendship_pair_idx').on(t.requesterId, t.addresseeId),
    addresseeIdx: index('friendship_addressee_idx').on(t.addresseeId),
    statusIdx: index('friendship_status_idx').on(t.requesterId, t.status),
  })
)
```

Confirm `userPushTokens` is exported from the package's barrel (check `packages/db/src/index.ts` — if it re-exports `* from './schema'`, no change; otherwise add an export).

- [ ] **Step 3: Apply the migration to TEST_DATABASE**

Run: `psql "$TEST_DATABASE_URL" -f packages/db/supabase/migrations/0021_push_tokens_and_mate_mute.sql`

Expected: three statements succeed, no errors. If `TEST_DATABASE_URL` isn't set, the owner sets it from `packages/db/.env`.

Verify:
```
psql "$TEST_DATABASE_URL" -c "\d user_push_tokens"
psql "$TEST_DATABASE_URL" -c "\d friendships"
psql "$TEST_DATABASE_URL" -c "\d user_profiles"
```
Expected: `user_push_tokens` exists with the five columns; `friendships` shows the two new boolean columns; `user_profiles` no longer has `push_token`.

- [ ] **Step 4: Run the existing API test suite**

Run: `cd apps/api && pnpm test`

Expected: ALL tests pass. If anything fails with `column push_token does not exist`, there's still code referencing the dropped column — find and fix in later tasks (the failures catalogue the places you'll touch in Tasks 2-7). Record the failing tests; they serve as a checklist.

- [ ] **Step 5: Commit**

```bash
git add packages/db/supabase/migrations/0021_push_tokens_and_mate_mute.sql packages/db/src/schema.ts
git commit -m "$(cat <<'EOF'
feat(db): migration 0021 — multi-device push tokens + per-mate mute

Adds user_push_tokens (user_id, token, platform) with RLS self-scoping
and service-role bypass. Adds requester_notify_of_activity and
addressee_notify_of_activity to friendships for directional mute.
Drops user_profiles.push_token; mobile will re-register into the new
table on next launch (coordinated with the mobile + API releases).

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: API — push-tokens endpoints (TDD)

**Files:**
- Create: `apps/api/src/routes/push-tokens.ts`
- Create: `apps/api/test/integration/push-tokens.test.ts`
- Modify: `apps/api/src/server.ts` (or the file that does `server.register(...)` for other routes — look for how `userRoute`, `socialRoute`, `reviewRoute` are registered)

- [ ] **Step 1: Write failing integration tests**

Create `apps/api/test/integration/push-tokens.test.ts`. Follow the pattern in `apps/api/test/integration/user-delete.test.ts` for DB setup, and `apps/api/test/integration/tutor-sharing.test.ts` for authenticated fetch patterns (reads the test JWT helper).

```typescript
// Verifies POST/DELETE /v1/push-tokens register and remove per-device tokens.
// The schema is (user_id, token) unique — duplicate POSTs are idempotent.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { userPushTokens, userProfiles } from '@kanji-learn/db'
import { buildServer } from '../../src/server' // adjust import to match repo
import { signTestJwt } from '../helpers/jwt'    // follow existing helper pattern

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER_A = '00000000-0000-0000-0000-000000000aa1'
const EXPO_IOS = 'ExponentPushToken[test-ios-token-a1]'
const EXPO_ANDROID = 'ExponentPushToken[test-and-token-a2]'

let app: Awaited<ReturnType<typeof buildServer>>
let tokenA: string

beforeAll(async () => {
  app = await buildServer()
  await app.ready()
  tokenA = signTestJwt(USER_A)
})

afterAll(async () => {
  await app.close()
  await client.end()
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM user_push_tokens WHERE user_id = ${USER_A}`)
  await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER_A}`)
  await db.insert(userProfiles).values({ id: USER_A, displayName: 'A', timezone: 'UTC' })
})

describe('POST /v1/push-tokens', () => {
  it('creates a token row on first call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/push-tokens',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { token: EXPO_IOS, platform: 'ios' },
    })
    expect(res.statusCode).toBe(201)
    const rows = await db.select().from(userPushTokens).where(eq(userPushTokens.userId, USER_A))
    expect(rows).toHaveLength(1)
    expect(rows[0].token).toBe(EXPO_IOS)
    expect(rows[0].platform).toBe('ios')
  })

  it('is idempotent — duplicate (user_id, token) returns 200 without duplicating', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/v1/push-tokens',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { token: EXPO_IOS, platform: 'ios' },
    })
    expect(first.statusCode).toBe(201)
    const second = await app.inject({
      method: 'POST',
      url: '/v1/push-tokens',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { token: EXPO_IOS, platform: 'ios' },
    })
    expect(second.statusCode).toBe(200)
    const rows = await db.select().from(userPushTokens).where(eq(userPushTokens.userId, USER_A))
    expect(rows).toHaveLength(1)
  })

  it('allows the same user to register multiple different tokens', async () => {
    await app.inject({ method: 'POST', url: '/v1/push-tokens', headers: { authorization: `Bearer ${tokenA}` }, payload: { token: EXPO_IOS, platform: 'ios' } })
    await app.inject({ method: 'POST', url: '/v1/push-tokens', headers: { authorization: `Bearer ${tokenA}` }, payload: { token: EXPO_ANDROID, platform: 'android' } })
    const rows = await db.select().from(userPushTokens).where(eq(userPushTokens.userId, USER_A))
    expect(rows).toHaveLength(2)
  })

  it('rejects a malformed token with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/push-tokens',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { token: 'not-a-real-token', platform: 'ios' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an unknown platform with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/push-tokens',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { token: EXPO_IOS, platform: 'windows' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 401 without a JWT', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/push-tokens', payload: { token: EXPO_IOS, platform: 'ios' } })
    expect(res.statusCode).toBe(401)
  })
})

describe('DELETE /v1/push-tokens/:token', () => {
  it('removes the row when it exists', async () => {
    await db.insert(userPushTokens).values({ userId: USER_A, token: EXPO_IOS, platform: 'ios' })
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/push-tokens/${encodeURIComponent(EXPO_IOS)}`,
      headers: { authorization: `Bearer ${tokenA}` },
    })
    expect(res.statusCode).toBe(204)
    const rows = await db.select().from(userPushTokens).where(eq(userPushTokens.userId, USER_A))
    expect(rows).toHaveLength(0)
  })

  it('returns 204 when the token does not exist (idempotent)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/push-tokens/${encodeURIComponent(EXPO_IOS)}`,
      headers: { authorization: `Bearer ${tokenA}` },
    })
    expect(res.statusCode).toBe(204)
  })

  it('does not delete another user\'s token', async () => {
    const USER_B = '00000000-0000-0000-0000-000000000bb2'
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER_B}`)
    await db.insert(userProfiles).values({ id: USER_B, displayName: 'B', timezone: 'UTC' })
    await db.insert(userPushTokens).values({ userId: USER_B, token: EXPO_IOS, platform: 'ios' })
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/push-tokens/${encodeURIComponent(EXPO_IOS)}`,
      headers: { authorization: `Bearer ${tokenA}` }, // userA trying to delete userB's token
    })
    expect(res.statusCode).toBe(204)
    const bRows = await db.select().from(userPushTokens).where(eq(userPushTokens.userId, USER_B))
    expect(bRows).toHaveLength(1) // userB's row untouched
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER_B}`)
  })

  it('returns 401 without a JWT', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/v1/push-tokens/${encodeURIComponent(EXPO_IOS)}` })
    expect(res.statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pnpm test push-tokens.test.ts`
Expected: all tests fail with 404 (route not registered) or similar "route not found" error.

- [ ] **Step 3: Implement the route plugin**

Create `apps/api/src/routes/push-tokens.ts`:

```typescript
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { userPushTokens } from '@kanji-learn/db'

const EXPO_TOKEN_RE = /^ExponentPushToken\[.+\]$/
const PLATFORMS = ['ios', 'android'] as const

const RegisterBody = z.object({
  token: z.string().regex(EXPO_TOKEN_RE, 'invalid Expo push token format'),
  platform: z.enum(PLATFORMS),
})

export async function pushTokensRoute(server: FastifyInstance) {
  server.post(
    '/v1/push-tokens',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const parsed = RegisterBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: parsed.error.message, code: 'VALIDATION' })
      }
      const { token, platform } = parsed.data
      const userId = req.userId!

      // Idempotent upsert keyed on (user_id, token). `onConflictDoNothing` leaves
      // the existing row untouched — return 200 to signal "already registered".
      const inserted = await server.db
        .insert(userPushTokens)
        .values({ userId, token, platform })
        .onConflictDoNothing({ target: [userPushTokens.userId, userPushTokens.token] })
        .returning()

      if (inserted.length === 0) {
        return reply.status(200).send({ ok: true, data: { created: false } })
      }
      return reply.status(201).send({ ok: true, data: { created: true } })
    },
  )

  server.delete<{ Params: { token: string } }>(
    '/v1/push-tokens/:token',
    { preHandler: [server.authenticate] },
    async (req, reply) => {
      const token = decodeURIComponent(req.params.token)
      const userId = req.userId!
      await server.db
        .delete(userPushTokens)
        .where(and(eq(userPushTokens.userId, userId), eq(userPushTokens.token, token)))
      return reply.status(204).send()
    },
  )
}
```

Notes to the implementer:
- Match the existing response envelope used by peer routes (`{ ok: true, data: ... }` / `{ ok: false, error, code }`). Open `apps/api/src/routes/user.ts` or `social.ts` to confirm the shape.
- `req.userId` is populated by the `authenticate` pre-handler; mirror the usage in `apps/api/src/routes/review.ts:51`.
- The DELETE is idempotent — even if no row matched, return 204. The ApiClient on mobile already short-circuits 204 responses (see `apps/mobile/src/lib/api.ts:43`).

Register the route alongside existing ones. Find where `userRoute`, `socialRoute`, etc. are registered (search for `server.register(userRoute`) and add:

```typescript
import { pushTokensRoute } from './routes/push-tokens'
// ...
await server.register(pushTokensRoute)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pnpm test push-tokens.test.ts`
Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/push-tokens.ts apps/api/test/integration/push-tokens.test.ts apps/api/src/server.ts
git commit -m "$(cat <<'EOF'
feat(api): POST/DELETE /v1/push-tokens endpoints

Dedicated resource for registering per-device Expo push tokens. POST is
idempotent on (user_id, token). DELETE by URL-encoded token is also
idempotent. Validates Expo token shape and platform enum. Replaces the
prior PATCH /v1/user/profile { pushToken } mechanism.

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: API — sendToUserTokens helper (TDD)

**Files:**
- Modify: `apps/api/src/services/notification.service.ts`
- Create: `apps/api/test/unit/services/notification-send-to-user-tokens.test.ts`

- [ ] **Step 1: Write failing unit tests**

Before writing, skim `apps/api/src/services/notification.service.ts` from the top. Note how `expo` is instantiated — it's an `Expo` SDK singleton used for `sendPushNotificationsAsync`. The tests mock it.

Create `apps/api/test/unit/services/notification-send-to-user-tokens.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { userPushTokens, userProfiles } from '@kanji-learn/db'
import { NotificationService } from '../../../src/services/notification.service'

// Mock the Expo SDK — we want to drive it from the test.
const mockSendPushNotificationsAsync = vi.fn()
vi.mock('expo-server-sdk', () => ({
  Expo: class {
    sendPushNotificationsAsync = mockSendPushNotificationsAsync
    static isExpoPushToken = (t: string) => /^ExponentPushToken\[.+\]$/.test(t)
  },
}))

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const service = new NotificationService(db) // constructor signature may differ — match existing

const USER = '00000000-0000-0000-0000-0000000000f1'
const TOKEN_A = 'ExponentPushToken[aaa]'
const TOKEN_B = 'ExponentPushToken[bbb]'
const TOKEN_C = 'ExponentPushToken[ccc]'

beforeEach(async () => {
  mockSendPushNotificationsAsync.mockReset()
  await db.execute(sql`DELETE FROM user_push_tokens WHERE user_id = ${USER}`)
  await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
  await db.insert(userProfiles).values({ id: USER, displayName: 'F', timezone: 'UTC' })
})

describe('sendToUserTokens', () => {
  it('fans out to every token in a single Expo batch call', async () => {
    await db.insert(userPushTokens).values([
      { userId: USER, token: TOKEN_A, platform: 'ios' },
      { userId: USER, token: TOKEN_B, platform: 'ios' },
      { userId: USER, token: TOKEN_C, platform: 'android' },
    ])
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: 'ok' }, { status: 'ok' }, { status: 'ok' },
    ])

    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b', sound: 'default' })

    expect(mockSendPushNotificationsAsync).toHaveBeenCalledTimes(1)
    const args = mockSendPushNotificationsAsync.mock.calls[0][0]
    expect(args).toHaveLength(3)
    expect(args.map((m: any) => m.to)).toEqual(expect.arrayContaining([TOKEN_A, TOKEN_B, TOKEN_C]))
    expect(args.every((m: any) => m.title === 't' && m.body === 'b')).toBe(true)
    expect(result).toEqual({ sent: 3, pruned: 0 })
  })

  it('returns { sent: 0, pruned: 0 } and skips the Expo call when the user has no tokens', async () => {
    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b' })
    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled()
    expect(result).toEqual({ sent: 0, pruned: 0 })
  })

  it('prunes rows that ticket with DeviceNotRegistered', async () => {
    await db.insert(userPushTokens).values([
      { userId: USER, token: TOKEN_A, platform: 'ios' },
      { userId: USER, token: TOKEN_B, platform: 'ios' },
    ])
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: 'ok' },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
    ])

    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b' })

    expect(result).toEqual({ sent: 2, pruned: 1 })
    const remaining = await db.select().from(userPushTokens).where(eq(userPushTokens.userId, USER))
    expect(remaining).toHaveLength(1)
    expect(remaining[0].token).toBe(TOKEN_A)
  })

  it('prunes rows that ticket with InvalidCredentials or MessageTooBig', async () => {
    await db.insert(userPushTokens).values([
      { userId: USER, token: TOKEN_A, platform: 'ios' },
      { userId: USER, token: TOKEN_B, platform: 'ios' },
    ])
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: 'error', details: { error: 'InvalidCredentials' } },
      { status: 'error', details: { error: 'MessageTooBig' } },
    ])

    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b' })
    expect(result.pruned).toBe(2)
    const remaining = await db.select().from(userPushTokens).where(eq(userPushTokens.userId, USER))
    expect(remaining).toHaveLength(0)
  })

  it('leaves rows intact on other error types (e.g. rate limit)', async () => {
    await db.insert(userPushTokens).values({ userId: USER, token: TOKEN_A, platform: 'ios' })
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: 'error', details: { error: 'MessageRateExceeded' } },
    ])

    const result = await service.sendToUserTokens(USER, { title: 't', body: 'b' })
    expect(result.pruned).toBe(0)
    const remaining = await db.select().from(userPushTokens).where(eq(userPushTokens.userId, USER))
    expect(remaining).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pnpm test notification-send-to-user-tokens`
Expected: all tests fail — `service.sendToUserTokens is not a function`.

- [ ] **Step 3: Implement sendToUserTokens in NotificationService**

Add to `apps/api/src/services/notification.service.ts` near the other service methods (exact location: inside the `NotificationService` class, close to `sendMessages`). Also add the `DEAD_TOKEN_ERRORS` constant at module scope:

```typescript
import { userPushTokens } from '@kanji-learn/db'
import { and, eq, inArray } from 'drizzle-orm'

const DEAD_TOKEN_ERRORS = new Set(['DeviceNotRegistered', 'InvalidCredentials', 'MessageTooBig'])

// ... inside NotificationService class:

async sendToUserTokens(
  userId: string,
  message: Omit<ExpoPushMessage, 'to'>,
): Promise<{ sent: number; pruned: number }> {
  const rows = await this.db
    .select({ token: userPushTokens.token })
    .from(userPushTokens)
    .where(eq(userPushTokens.userId, userId))

  if (rows.length === 0) {
    return { sent: 0, pruned: 0 }
  }

  const messages: ExpoPushMessage[] = rows.map((r) => ({ ...message, to: r.token }))
  const tickets = await this.expo.sendPushNotificationsAsync(messages)

  const dead: string[] = []
  tickets.forEach((ticket, i) => {
    if (ticket.status === 'error' && DEAD_TOKEN_ERRORS.has(ticket.details?.error ?? '')) {
      dead.push(rows[i].token)
    }
  })

  if (dead.length > 0) {
    await this.db
      .delete(userPushTokens)
      .where(and(eq(userPushTokens.userId, userId), inArray(userPushTokens.token, dead)))
  }

  console.log(`[Push] userId=${userId} sent=${tickets.length} pruned=${dead.length}`)
  return { sent: tickets.length, pruned: dead.length }
}
```

Note: `ExpoPushMessage` is the SDK type. Check how it's imported at the top of `notification.service.ts` and reuse. `this.expo` is the existing Expo singleton instance on the class — look for how `this.expo.sendPushNotificationsAsync` is called in the existing `sendMessages` method for the pattern.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pnpm test notification-send-to-user-tokens`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/notification.service.ts apps/api/test/unit/services/notification-send-to-user-tokens.test.ts
git commit -m "$(cat <<'EOF'
feat(api): add sendToUserTokens helper for multi-device fan-out

Reads all of a user's registered tokens, sends a single batched Expo
push call, and synchronously prunes tokens that ticket with
DeviceNotRegistered, InvalidCredentials, or MessageTooBig. Other error
types (rate limit, etc.) leave tokens intact for retry.

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: API — swap notifyStudyMates to fan-out + per-mate mute (TDD)

**Files:**
- Modify: `apps/api/src/services/notification.service.ts:149-196` (the `notifyStudyMates` method)
- Add tests to: `apps/api/test/unit/services/notification-send-to-user-tokens.test.ts` (or a sibling file)

- [ ] **Step 1: Write failing unit tests for per-mate mute + fan-out**

Add to the same test file (or create `apps/api/test/unit/services/notify-study-mates.test.ts` if you prefer isolation):

```typescript
// Append to notification-send-to-user-tokens.test.ts or put in its own file.
// NOTE: this tests the happy + mute paths. It does NOT re-test sendToUserTokens
// internals — those are covered in the previous describe block.

import { friendships } from '@kanji-learn/db'

const SUBMITTER = '00000000-0000-0000-0000-0000000000f2'
const RECIPIENT = '00000000-0000-0000-0000-0000000000f3'

beforeEach(async () => {
  await db.execute(sql`DELETE FROM friendships WHERE requester_id IN (${SUBMITTER}, ${RECIPIENT}) OR addressee_id IN (${SUBMITTER}, ${RECIPIENT})`)
  await db.execute(sql`DELETE FROM user_push_tokens WHERE user_id IN (${SUBMITTER}, ${RECIPIENT})`)
  await db.execute(sql`DELETE FROM user_profiles WHERE id IN (${SUBMITTER}, ${RECIPIENT})`)
  await db.insert(userProfiles).values([
    { id: SUBMITTER, displayName: 'Submitter', timezone: 'UTC', notificationsEnabled: true },
    { id: RECIPIENT, displayName: 'Recipient', timezone: 'UTC', notificationsEnabled: true },
  ])
  await db.insert(userPushTokens).values({ userId: RECIPIENT, token: TOKEN_A, platform: 'ios' })
})

describe('notifyStudyMates — per-friendship mute', () => {
  it('sends to the recipient when they have not muted the submitter', async () => {
    await db.insert(friendships).values({
      requesterId: SUBMITTER,
      addresseeId: RECIPIENT,
      status: 'accepted',
      requesterNotifyOfActivity: true,   // submitter wants to hear about recipient (irrelevant here)
      addresseeNotifyOfActivity: true,   // recipient wants to hear about submitter
    })
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok' }])

    await service.notifyStudyMates(SUBMITTER, 12)

    expect(mockSendPushNotificationsAsync).toHaveBeenCalledTimes(1)
    const args = mockSendPushNotificationsAsync.mock.calls[0][0]
    expect(args).toHaveLength(1)
    expect(args[0].to).toBe(TOKEN_A)
    expect(args[0].title).toContain('Submitter')
  })

  it('suppresses when the recipient has muted on their side (addresseeNotifyOfActivity=false)', async () => {
    await db.insert(friendships).values({
      requesterId: SUBMITTER,
      addresseeId: RECIPIENT,
      status: 'accepted',
      requesterNotifyOfActivity: true,
      addresseeNotifyOfActivity: false,
    })

    await service.notifyStudyMates(SUBMITTER, 12)

    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled()
  })

  it('suppresses when recipient is the requester and has muted (requesterNotifyOfActivity=false)', async () => {
    // Flip the direction — recipient is the requester this time.
    await db.insert(friendships).values({
      requesterId: RECIPIENT,
      addresseeId: SUBMITTER,
      status: 'accepted',
      requesterNotifyOfActivity: false,  // recipient's side
      addresseeNotifyOfActivity: true,
    })

    await service.notifyStudyMates(SUBMITTER, 12)

    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled()
  })

  it('fires for recipient even if submitter\'s side is muted — mute is directional', async () => {
    await db.insert(friendships).values({
      requesterId: SUBMITTER,
      addresseeId: RECIPIENT,
      status: 'accepted',
      requesterNotifyOfActivity: false,  // submitter's own preference — irrelevant when submitter is the one who studied
      addresseeNotifyOfActivity: true,
    })
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok' }])

    await service.notifyStudyMates(SUBMITTER, 12)

    expect(mockSendPushNotificationsAsync).toHaveBeenCalledTimes(1)
  })

  it('still respects notificationsEnabled=false as a master switch', async () => {
    await db.update(userProfiles).set({ notificationsEnabled: false }).where(eq(userProfiles.id, RECIPIENT))
    await db.insert(friendships).values({
      requesterId: SUBMITTER,
      addresseeId: RECIPIENT,
      status: 'accepted',
      requesterNotifyOfActivity: true,
      addresseeNotifyOfActivity: true,
    })

    await service.notifyStudyMates(SUBMITTER, 12)

    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled()
  })

  it('fans out to all of the recipient\'s tokens', async () => {
    await db.insert(userPushTokens).values({ userId: RECIPIENT, token: TOKEN_B, platform: 'android' })
    await db.insert(friendships).values({
      requesterId: SUBMITTER,
      addresseeId: RECIPIENT,
      status: 'accepted',
      requesterNotifyOfActivity: true,
      addresseeNotifyOfActivity: true,
    })
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok' }, { status: 'ok' }])

    await service.notifyStudyMates(SUBMITTER, 12)

    const args = mockSendPushNotificationsAsync.mock.calls[0][0]
    expect(args).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests — they must fail**

Run: `cd apps/api && pnpm test notification-send-to-user-tokens`
Expected: the new describe block fails because the current `notifyStudyMates` still references `friend.pushToken` (dropped) and doesn't yet check per-mate mute. Record the specific failures.

- [ ] **Step 3: Update notifyStudyMates**

Replace [apps/api/src/services/notification.service.ts:149-196](../../../apps/api/src/services/notification.service.ts) with:

```typescript
async notifyStudyMates(submitterId: string, reviewedCount: number): Promise<void> {
  const submitter = await this.db.query.userProfiles.findFirst({
    where: eq(userProfiles.id, submitterId),
    columns: { displayName: true },
  })
  const name = submitter?.displayName ?? 'Your study mate'

  const rows = await this.db.query.friendships.findMany({
    where: and(
      or(
        eq(friendships.requesterId, submitterId),
        eq(friendships.addresseeId, submitterId),
      ),
      eq(friendships.status, 'accepted'),
    ),
    with: { requester: true, addressee: true },
  })

  const now = Date.now()
  const oneDayMs = 24 * 60 * 60 * 1000

  for (const row of rows) {
    const friend = row.requesterId === submitterId ? row.addressee : row.requester

    // Master switch — kills all pushes to this user.
    if (!friend.notificationsEnabled) continue

    // Per-friendship mute — recipient controls their own side. If submitter is
    // the requester, the recipient is the addressee, so read the addressee's column.
    const recipientNotifyOn = row.requesterId === submitterId
      ? row.addresseeNotifyOfActivity
      : row.requesterNotifyOfActivity
    if (!recipientNotifyOn) continue

    // Frequency cap: max 1 alert per submitter–recipient pair per 24 hours.
    // Check AFTER mute — muted sends never enter the cache so unmuting takes
    // effect immediately, not after a 24h cooldown.
    const cacheKey = `${submitterId}:${friend.id}`
    const lastSent = mateNotifyCache.get(cacheKey) ?? 0
    if (now - lastSent < oneDayMs) continue

    await this.sendToUserTokens(friend.id, {
      title: `📚 ${name} just studied!`,
      body: `They reviewed ${reviewedCount} kanji today. Ready to match them?`,
      sound: 'default',
      data: { type: 'mate_activity', friendId: submitterId },
    })
    mateNotifyCache.set(cacheKey, now)
  }
}
```

Key changes from the old implementation:
- No more `if (!friend.pushToken) continue` — token absence is handled inside `sendToUserTokens` (zero-row no-op).
- No more single-message `messages.push({ to: friend.pushToken, ... })` + `sendMessages` at the end — each recipient is its own fan-out call.
- Added the master `notificationsEnabled` check (was implicit via `!friend.pushToken` before; now explicit).
- Added the per-side mute check.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pnpm test notification-send-to-user-tokens`
Expected: all tests pass, including the original `sendToUserTokens` tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/notification.service.ts apps/api/test/unit/services/notification-send-to-user-tokens.test.ts
git commit -m "$(cat <<'EOF'
feat(api): notifyStudyMates uses multi-device fan-out + per-mate mute

Swaps the single-token push for a sendToUserTokens call so every device
gets the mate alert. Adds a directional mute check against the
recipient's side of the friendship row — mute takes effect immediately
without consuming the 24h cap.

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: API — swap sendDailyReminders + sendRestDaySummaries to fan-out

**Files:**
- Modify: `apps/api/src/services/notification.service.ts` — `sendDailyReminders` (~line 86-144) and `sendRestDaySummaries` (~line 201+)
- Add tests: `apps/api/test/unit/services/notification-send-to-user-tokens.test.ts` (or a sibling)

- [ ] **Step 1: Write failing tests for daily reminder fan-out**

Add a new describe block in the test file:

```typescript
describe('sendDailyReminders — multi-device', () => {
  it('fans the reminder out to all of the user\'s tokens', async () => {
    // Arrange: a user whose reminderHour matches "now" in UTC, no reviews today,
    // two registered tokens, notifications enabled.
    const REMINDER_USER = '00000000-0000-0000-0000-0000000000f4'
    const hourNow = new Date().getUTCHours()
    await db.execute(sql`DELETE FROM user_push_tokens WHERE user_id = ${REMINDER_USER}`)
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${REMINDER_USER}`)
    await db.insert(userProfiles).values({
      id: REMINDER_USER,
      displayName: 'R',
      timezone: 'UTC',
      reminderHour: hourNow,
      notificationsEnabled: true,
    })
    await db.insert(userPushTokens).values([
      { userId: REMINDER_USER, token: TOKEN_A, platform: 'ios' },
      { userId: REMINDER_USER, token: TOKEN_B, platform: 'ios' },
    ])
    mockSendPushNotificationsAsync.mockResolvedValue([{ status: 'ok' }, { status: 'ok' }])

    await service.sendDailyReminders()

    // Check that every call collectively covered both tokens.
    const allTos = mockSendPushNotificationsAsync.mock.calls.flatMap((c) => c[0]).map((m: any) => m.to)
    expect(allTos).toEqual(expect.arrayContaining([TOKEN_A, TOKEN_B]))
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${REMINDER_USER}`)
  })
})
```

You should add a parallel test for `sendRestDaySummaries` if the existing suite exercises it. Check `apps/api/test/unit` for an existing one — if none, copy the pattern above, set `restDay` to today's weekday, and assert the fan-out.

- [ ] **Step 2: Run the tests — they fail**

Run: `cd apps/api && pnpm test notification-send-to-user-tokens`
Expected: the new describe block fails; the current `sendDailyReminders` selects `pushToken` from `user_profiles` (column dropped in migration 0021), so it should fail with `column push_token does not exist`.

- [ ] **Step 3: Update sendDailyReminders**

Look at the current implementation around line 86-144. The SELECT reads `pushToken: userProfiles.pushToken` and the send block builds a single-token message per user. Replace with:

```typescript
async sendDailyReminders(): Promise<void> {
  const nowUtc = new Date()

  const users = await this.db
    .select({
      id:           userProfiles.id,
      timezone:     userProfiles.timezone,
      reminderHour: userProfiles.reminderHour,
      restDay:      userProfiles.restDay,
    })
    .from(userProfiles)
    .where(eq(userProfiles.notificationsEnabled, true))

  for (const user of users) {
    // ... keep the existing hour-gate / rest-day / already-reviewed-today filters
    //     exactly as they are today (lines ~115-128 in the original).
    // On pass:
    await this.sendToUserTokens(user.id, {
      title: '📚 Time to study!',
      body:  'Your kanji are waiting. Review time?',
      sound: 'default',
      data:  { type: 'daily_reminder' },
    })
  }
}
```

Important: **preserve the exact filter logic from the current implementation**, including the timezone math at lines ~115-118 and the `NOT IN (daily_stats WHERE date=TODAY AND reviewed > 0)` check at line ~126. This plan changes only the `SELECT` shape (drop `pushToken`) and the send call (fan-out instead of single push). The per-user gating is out of scope for this task.

Do the same for `sendRestDaySummaries` (around line 201+) — drop `pushToken` from the SELECT and swap the send call to `sendToUserTokens`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pnpm test notification-send-to-user-tokens`
Expected: the fan-out tests pass. Run the full api test suite `cd apps/api && pnpm test` — everything passes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/notification.service.ts apps/api/test/unit/services/notification-send-to-user-tokens.test.ts
git commit -m "$(cat <<'EOF'
feat(api): daily reminders + rest-day summaries use multi-device fan-out

Swaps both cron-driven notification paths from single pushToken reads
to sendToUserTokens fan-out. Filter logic (hour-gate, timezone,
rest-day, already-studied-today) is unchanged.

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: API — PATCH friendship mute + GET friends extension (TDD)

**Files:**
- Modify: `apps/api/src/routes/social.ts` — add PATCH route, extend GET /friends response
- Modify: `apps/api/src/services/social.service.ts` — add `setNotifyOfActivity`, extend friends-list projection
- Create: `apps/api/test/integration/social-mute.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `apps/api/test/integration/social-mute.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { userProfiles, friendships } from '@kanji-learn/db'
import { buildServer } from '../../src/server'
import { signTestJwt } from '../helpers/jwt'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const REQUESTER = '00000000-0000-0000-0000-0000000000e1'
const ADDRESSEE = '00000000-0000-0000-0000-0000000000e2'
let app: Awaited<ReturnType<typeof buildServer>>
let reqTok: string
let addTok: string
let friendshipId: string

beforeAll(async () => {
  app = await buildServer(); await app.ready()
  reqTok = signTestJwt(REQUESTER)
  addTok = signTestJwt(ADDRESSEE)
})
afterAll(async () => { await app.close(); await client.end() })

beforeEach(async () => {
  await db.execute(sql`DELETE FROM friendships WHERE requester_id IN (${REQUESTER}, ${ADDRESSEE}) OR addressee_id IN (${REQUESTER}, ${ADDRESSEE})`)
  await db.execute(sql`DELETE FROM user_profiles WHERE id IN (${REQUESTER}, ${ADDRESSEE})`)
  await db.insert(userProfiles).values([
    { id: REQUESTER, displayName: 'Req', timezone: 'UTC' },
    { id: ADDRESSEE, displayName: 'Add', timezone: 'UTC' },
  ])
  const [row] = await db.insert(friendships).values({
    requesterId: REQUESTER, addresseeId: ADDRESSEE, status: 'accepted',
  }).returning({ id: friendships.id })
  friendshipId = row.id
})

describe('PATCH /v1/social/friends/:friendId', () => {
  it('updates the requester\'s side when the caller is the requester', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/social/friends/${ADDRESSEE}`, // path param is the friend's userId, not friendshipId
      headers: { authorization: `Bearer ${reqTok}` },
      payload: { notifyOfActivity: false },
    })
    expect(res.statusCode).toBe(200)
    const [row] = await db.select().from(friendships).where(eq(friendships.id, friendshipId))
    expect(row.requesterNotifyOfActivity).toBe(false)
    expect(row.addresseeNotifyOfActivity).toBe(true)  // other side untouched
  })

  it('updates the addressee\'s side when the caller is the addressee', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/social/friends/${REQUESTER}`,
      headers: { authorization: `Bearer ${addTok}` },
      payload: { notifyOfActivity: false },
    })
    expect(res.statusCode).toBe(200)
    const [row] = await db.select().from(friendships).where(eq(friendships.id, friendshipId))
    expect(row.addresseeNotifyOfActivity).toBe(false)
    expect(row.requesterNotifyOfActivity).toBe(true)
  })

  it('the two sides are independent — each side\'s update does not affect the other', async () => {
    await app.inject({ method: 'PATCH', url: `/v1/social/friends/${ADDRESSEE}`, headers: { authorization: `Bearer ${reqTok}` }, payload: { notifyOfActivity: false } })
    await app.inject({ method: 'PATCH', url: `/v1/social/friends/${REQUESTER}`, headers: { authorization: `Bearer ${addTok}` }, payload: { notifyOfActivity: true } })
    const [row] = await db.select().from(friendships).where(eq(friendships.id, friendshipId))
    expect(row.requesterNotifyOfActivity).toBe(false)
    expect(row.addresseeNotifyOfActivity).toBe(true)
  })

  it('returns 404 when no accepted friendship exists', async () => {
    const STRANGER = '00000000-0000-0000-0000-0000000000e9'
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/social/friends/${STRANGER}`,
      headers: { authorization: `Bearer ${reqTok}` },
      payload: { notifyOfActivity: false },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 when the friendship exists but is pending, not accepted', async () => {
    await db.update(friendships).set({ status: 'pending' }).where(eq(friendships.id, friendshipId))
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/social/friends/${ADDRESSEE}`,
      headers: { authorization: `Bearer ${reqTok}` },
      payload: { notifyOfActivity: false },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 401 without a JWT', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/v1/social/friends/${ADDRESSEE}`, payload: { notifyOfActivity: false } })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /v1/social/friends — notifyOfActivity projection', () => {
  it('returns notifyOfActivity resolved from the caller\'s perspective', async () => {
    await db.update(friendships).set({ requesterNotifyOfActivity: false, addresseeNotifyOfActivity: true }).where(eq(friendships.id, friendshipId))

    const reqRes = await app.inject({ method: 'GET', url: '/v1/social/friends', headers: { authorization: `Bearer ${reqTok}` } })
    expect(reqRes.statusCode).toBe(200)
    const reqBody = reqRes.json().data
    expect(reqBody[0].userId).toBe(ADDRESSEE)
    expect(reqBody[0].notifyOfActivity).toBe(false) // requester's own view

    const addRes = await app.inject({ method: 'GET', url: '/v1/social/friends', headers: { authorization: `Bearer ${addTok}` } })
    const addBody = addRes.json().data
    expect(addBody[0].userId).toBe(REQUESTER)
    expect(addBody[0].notifyOfActivity).toBe(true) // addressee's own view
  })
})
```

- [ ] **Step 2: Run tests — they fail**

Run: `cd apps/api && pnpm test social-mute`
Expected: PATCH tests 404; GET test either misses the field or crashes.

- [ ] **Step 3: Add `setNotifyOfActivity` to SocialService**

In `apps/api/src/services/social.service.ts`, add:

```typescript
async setNotifyOfActivity(
  userId: string,
  friendUserId: string,
  notifyOfActivity: boolean,
): Promise<boolean> {
  // Find the accepted friendship row between userId and friendUserId.
  const row = await this.db.query.friendships.findFirst({
    where: and(
      or(
        and(eq(friendships.requesterId, userId), eq(friendships.addresseeId, friendUserId)),
        and(eq(friendships.addresseeId, userId), eq(friendships.requesterId, friendUserId)),
      ),
      eq(friendships.status, 'accepted'),
    ),
  })
  if (!row) return false

  // Flip the column that represents the caller's preference.
  const patch = row.requesterId === userId
    ? { requesterNotifyOfActivity: notifyOfActivity }
    : { addresseeNotifyOfActivity: notifyOfActivity }

  await this.db.update(friendships).set(patch).where(eq(friendships.id, row.id))
  return true
}
```

Also update the friends-list projection (find the existing `listFriends` or equivalent method — look at how GET /v1/social/friends is currently served). Add a computed `notifyOfActivity` field resolved from the caller's side:

```typescript
async listFriends(userId: string) {
  const rows = await this.db.query.friendships.findMany({
    where: and(
      or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId)),
      eq(friendships.status, 'accepted'),
    ),
    with: { requester: true, addressee: true },
  })
  return rows.map((row) => {
    const friend = row.requesterId === userId ? row.addressee : row.requester
    const notifyOfActivity = row.requesterId === userId
      ? row.requesterNotifyOfActivity
      : row.addresseeNotifyOfActivity
    return {
      userId:           friend.id,
      displayName:      friend.displayName,
      email:            friend.email,
      notifyOfActivity,
    }
  })
}
```

(Preserve any other existing fields the method currently returns — this example shows only the shape.)

- [ ] **Step 4: Add the PATCH route to social.ts**

In `apps/api/src/routes/social.ts`, add near the other `friends/:friendId` route:

```typescript
server.patch<{
  Params: { friendId: string }
  Body: { notifyOfActivity: boolean }
}>(
  '/friends/:friendId',
  { preHandler: [server.authenticate] },
  async (req, reply) => {
    const schema = z.object({ notifyOfActivity: z.boolean() })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: parsed.error.message, code: 'VALIDATION' })
    }
    const ok = await social.setNotifyOfActivity(req.userId!, req.params.friendId, parsed.data.notifyOfActivity)
    if (!ok) return reply.status(404).send({ ok: false, error: 'friendship not found', code: 'NOT_FOUND' })
    return reply.send({ ok: true, data: { friendId: req.params.friendId, notifyOfActivity: parsed.data.notifyOfActivity } })
  },
)
```

- [ ] **Step 5: Run tests — they pass**

Run: `cd apps/api && pnpm test social-mute`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/social.ts apps/api/src/services/social.service.ts apps/api/test/integration/social-mute.test.ts
git commit -m "$(cat <<'EOF'
feat(api): PATCH /v1/social/friends/:friendId sets per-mate mute

Adds per-side notify_of_activity control. Handler detects whether the
caller is the requester or addressee and updates the matching column.
GET /v1/social/friends now returns notifyOfActivity resolved from the
caller's perspective so the client uses a single boolean per friend.

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: API — remove pushToken from /v1/user/profile

**Files:**
- Modify: `apps/api/src/routes/user.ts` — drop pushToken from PATCH body + GET response
- Modify: `apps/api/test/unit/user-profile-patch.test.ts` — remove any existing pushToken-accepting assertion
- Modify: `packages/shared/src/types/*` — drop pushToken from UserProfile DTO (find the right file via `grep -r pushToken packages/shared`)

- [ ] **Step 1: Find and list every `pushToken` reference in the API**

Run: `rg 'pushToken|push_token' apps/api/src packages/shared/src`
List every match. Each one needs to be dealt with. Record the list.

- [ ] **Step 2: Update the PATCH body schema to reject pushToken**

In `apps/api/src/routes/user.ts`, find the Zod schema for `PATCH /v1/user/profile` body. Remove the `pushToken` field. If the test file `apps/api/test/unit/user-profile-patch.test.ts` asserts that `pushToken` is accepted, update it to assert the field is now rejected (or silently ignored if your validation is non-strict — either is acceptable; be explicit).

- [ ] **Step 3: Update the GET response DTO**

Same file — find the SELECT or mapping that projects `pushToken` into the response. Remove it. Make sure the response type (either a Zod response schema or a TS interface) no longer includes the field.

- [ ] **Step 4: Update the shared UserProfile type**

Drop `pushToken` from whichever file in `packages/shared/src` defines `UserProfile`. If the file is re-exported through the mobile's `app/(tabs)/profile.tsx` interface, this becomes visible to the mobile TS compiler in Task 10 — that's expected.

- [ ] **Step 5: Run API tests**

Run: `cd apps/api && pnpm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/user.ts apps/api/test/unit/user-profile-patch.test.ts packages/shared/src
git commit -m "$(cat <<'EOF'
refactor(api): drop pushToken from /v1/user/profile surface

Push tokens now live in the user_push_tokens table and register via
POST /v1/push-tokens. Profile endpoint no longer reads or writes the
column (which is dropped by migration 0021).

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Mobile — push token registration hook

**Files:**
- Modify: `apps/mobile/src/hooks/usePushNotifications.ts`

- [ ] **Step 1: Update the hook to POST to the new endpoint and persist the token**

Replace the body of the `.then` in `usePushNotifications`:

```typescript
// apps/mobile/src/hooks/usePushNotifications.ts
import { useEffect, useRef } from 'react'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { api } from '../lib/api'
import { storage } from '../lib/storage'

// ... (the registerForPushNotifications function above is unchanged — keep it as-is)

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
```

- [ ] **Step 2: Run mobile type-check**

Run: `cd apps/mobile && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/hooks/usePushNotifications.ts
git commit -m "$(cat <<'EOF'
feat(mobile): register push tokens via POST /v1/push-tokens

Replaces the prior PATCH /v1/user/profile mechanism. Persists the
current-device token to kl:last_push_token so signOut can unregister
it.

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Mobile — signOut unregister (best-effort DELETE)

**Files:**
- Modify: `apps/mobile/src/stores/auth.store.ts` — extend `signOut`

- [ ] **Step 1: Extend signOut**

Replace the current `signOut` implementation (around line 173) with:

```typescript
signOut: async () => {
  // Best-effort: unregister this device's token so the server no longer fans
  // pushes to it. Receipt pruning is the safety net if this call fails.
  const lastToken = await storage.getItem<string>('kl:last_push_token')
  if (lastToken) {
    try {
      await api.delete(`/v1/push-tokens/${encodeURIComponent(lastToken)}`)
    } catch {
      // Swallow — token will be pruned server-side on its next failed send.
    }
  }
  await storage.removeItem('kl:last_push_token')
  clearProfileCache()
  clearLearnerProfileCache()
  await supabase.auth.signOut()
  set({ session: null, user: null })
},
```

Note: `deleteAccount` does *not* need a DELETE call — the `ON DELETE CASCADE` on `user_push_tokens.user_id` cleans up automatically when the profile row is removed.

- [ ] **Step 2: Run mobile type-check**

Run: `cd apps/mobile && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/stores/auth.store.ts
git commit -m "$(cat <<'EOF'
feat(mobile): unregister push token on signOut (best-effort)

signOut now DELETEs the current device's token before clearing the
Supabase session. On network failure the call is swallowed; receipt
pruning on the server catches the token when the next push fails.

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Mobile — Study Mates bell toggle + type cleanup

**Files:**
- Modify: `apps/mobile/app/(tabs)/profile.tsx` — drop pushToken from UserProfile, add Friend DTO update, add bell UI
- Modify: wherever the mobile `Friend` DTO lives (search: `rg 'friendshipStatus|friends\b' apps/mobile/src` to find the consumer of GET /v1/social/friends)

- [ ] **Step 1: Drop pushToken from UserProfile interface**

In `apps/mobile/app/(tabs)/profile.tsx:28-40`, remove `pushToken` if present. (If it's imported from `@kanji-learn/shared` it was already removed in Task 7 — just ensure the mobile still compiles.)

- [ ] **Step 2: Find and update the Friend DTO**

Search for the mobile type that shapes the GET /v1/social/friends response (likely in `apps/mobile/src/stores` or `apps/mobile/src/lib` or inline in `profile.tsx`'s Study Mates section). Add `notifyOfActivity: boolean` to it.

- [ ] **Step 3: Add the bell toggle to each accepted friend row**

In the Study Mates section of `profile.tsx` (around line 614), locate the friend-row rendering. Add a bell toggle on the right edge. Example JSX structure (adapt to match the existing row pattern):

```tsx
import { Ionicons } from '@expo/vector-icons' // or whichever icon set the codebase uses

// Inside the friend row mapping:
<View style={styles.friendRow}>
  <Text style={styles.friendName}>{friend.displayName}</Text>
  <TouchableOpacity
    disabled={!notificationsEnabled}
    onPress={() => handleToggleFriendMute(friend)}
    style={[styles.bellButton, !notificationsEnabled && styles.bellButtonDisabled]}
    accessibilityLabel={friend.notifyOfActivity ? `Mute alerts from ${friend.displayName}` : `Unmute alerts from ${friend.displayName}`}
  >
    <Ionicons
      name={friend.notifyOfActivity ? 'notifications' : 'notifications-off'}
      size={20}
      color={notificationsEnabled ? colors.textPrimary : colors.textSecondary}
    />
  </TouchableOpacity>
</View>
```

Implement the handler:

```tsx
const handleToggleFriendMute = useCallback(async (friend: Friend) => {
  const next = !friend.notifyOfActivity
  // Optimistic update
  setFriends((prev) => prev.map((f) => f.userId === friend.userId ? { ...f, notifyOfActivity: next } : f))
  try {
    await api.patch(`/v1/social/friends/${friend.userId}`, { notifyOfActivity: next })
  } catch {
    // Revert on error
    setFriends((prev) => prev.map((f) => f.userId === friend.userId ? { ...f, notifyOfActivity: !next } : f))
    Alert.alert('Update failed', 'Could not update mate alert preference. Please try again.')
  }
}, [])
```

If there's no master `notificationsEnabled` state in scope where friends render, pull it from the `profile` state. When it's off, show a small caption under the Study Mates heading: "Turn on notifications above to control mate alerts per friend." Dim each bell icon in the same render pass.

Accessibility note: follow the color contrast feedback memory — every Text/icon should have an explicit `color` from `theme/colors`, not rely on system defaults.

- [ ] **Step 4: Run mobile type-check and tests**

Run: `cd apps/mobile && pnpm exec tsc --noEmit` and `pnpm exec jest` (per the working-environment note in HANDOFF).
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(tabs\)/profile.tsx apps/mobile/src
git commit -m "$(cat <<'EOF'
feat(mobile): bell toggle on each Study Mate row for per-friend mute

Each accepted friend gets a notifications bell icon. Tap flips
notifyOfActivity via PATCH /v1/social/friends/:friendId with optimistic
UI and revert on error. Disabled + dimmed when the master
notificationsEnabled switch is off, with a caption pointing up.

Co-Authored-By: Robert A. Dennis (Buddy) <buddydennis@gmail.com>
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Full-stack verification + TestFlight build

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test` from the repo root (Turbo runs API + other packages).
Expected: everything green.

- [ ] **Step 2: Run the mobile test suite**

Run: `cd apps/mobile && pnpm exec jest`
Expected: green.

- [ ] **Step 3: Apply migration 0021 to prod**

```bash
psql "$DATABASE_URL" -f packages/db/supabase/migrations/0021_push_tokens_and_mate_mute.sql
```

Expected: three statements succeed. Verify with `\d user_push_tokens` / `\d friendships` / `\d user_profiles` as in Task 1 Step 3.

- [ ] **Step 4: Deploy the API**

Use the existing deploy script per HANDOFF working-environment notes:
```bash
DOCKER_CONTEXT=default ./scripts/deploy-api.sh
```
Verify health: `curl https://73x3fcaaze.us-east-1.awsapprunner.com/health` returns 200.

- [ ] **Step 5: Cut a TestFlight build**

From `apps/mobile`, use the standard EAS build command the project uses (see HANDOFF). Hand-coordinate with Bucky so both users update the app within a short window — pushes are silent for any user who hasn't re-registered.

- [ ] **Step 6: On-device verification checklist**

Run through with the owner on both iPhone and iPad:
- [ ] Launch app on iPhone → `[Push] Token registered:` log appears.
- [ ] Launch app on iPad → same log appears, iPad token also registered (check prod DB: `SELECT token, platform FROM user_push_tokens WHERE user_id = '<owner id>'` returns 2 rows).
- [ ] Have Bucky's account submit a review → both iPhone *and* iPad show the "📚 Bucky just studied!" banner within a few seconds. Watch also shows it (via iOS auto-forward from iPhone).
- [ ] In Study Mates panel on iPhone, tap the bell on Bucky's row → icon flips to off.
- [ ] Have Bucky submit another review (wait ≥24h after the first to bypass the cap, or pause the cap via test hook) → no push arrives.
- [ ] Tap the bell back on → next push arrives.
- [ ] Sign out on iPad → `[Push] Token unregistered:` log, iPad row removed from prod DB.
- [ ] Have Bucky submit a review → only iPhone buzzes.

- [ ] **Step 7: Spawn follow-up task to delete vestigial lambda**

Per the earlier diagnostic: `apps/lambda/daily-reminders/` is not wired to an EventBridge rule and the actual cron runs inside the API process. The code is dead weight. Spawn a separate session to remove the directory (see `mcp__ccd_session__spawn_task` or file manually).

- [ ] **Step 8: Update HANDOFF.md and BUGS.md / ROADMAP**

Record in the appropriate tracker:
- Bug 3 fixed — multi-device push + per-mate mute shipped.
- Per-mate mute available in the Study Mates panel.
- Deferred: async receipt poller, device_id, per-device notification preferences. (Already in the spec's Future Enhancements — cross-reference.)

---

## Self-Review

(Internal check performed after plan draft. Issues fixed inline.)

- **Placeholder scan:** no `TODO` / `TBD` / "appropriate error handling" / "similar to above" — all code blocks are complete.
- **Spec coverage:** migration ✓, push-tokens endpoints ✓, sendToUserTokens ✓, notifyStudyMates fan-out + per-mate mute ✓, daily/rest-day fan-out ✓, PATCH friendship + GET extension ✓, pushToken removal from profile ✓, mobile register ✓, signOut unregister ✓, UI bell + types ✓, rollout + verification ✓.
- **Type consistency:** `notifyOfActivity` used consistently (not `notify_of_activity` in TS land); `sendToUserTokens` signature identical across tasks 3/4/5; `userPushTokens` camelCase in schema.ts, `user_push_tokens` in SQL migration — correct, Drizzle maps the two.
- **Call-site verified:** `api.delete(path)` takes path only (no body support in current `apps/mobile/src/lib/api.ts`); plan uses path-param DELETE URL to accommodate.
- **No out-of-scope refactors:** notification.service.ts timezone math and hour-gate filter are explicitly flagged as preserved-unchanged in Task 5.
- **Tests before implementation:** every test task runs-to-fail before the implementation step.
