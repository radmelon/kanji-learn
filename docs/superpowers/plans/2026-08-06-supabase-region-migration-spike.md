# Supabase Region Migration — Spike & Rotation Backstop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that Supabase `auth.users` UUIDs and OAuth identities survive a
new-project migration, so the `ap-southeast-2` → `us-east-1` move can be given a
real date — and give the deferred Supabase key rotation a deadline of its own so
it cannot slip indefinitely again.

**Architecture:** Supabase has no in-place region change, so the move means
creating a new project and migrating into it. The binding constraint is **not**
the data volume — it is `auth.users.id`. Eleven RLS policies match `auth.uid()`
against `user_id` columns in the `public` schema, and **no foreign key enforces
that relationship** (verified: 0 FK constraints reference the `auth` schema). A
user who arrives in the new project with a fresh UUID therefore does not get an
error — they get a working account with an empty history, and every row they
own becomes unreachable. This plan does not perform the migration. It runs a
throwaway-project spike that answers the one question the migration date depends
on, and it installs a dated backstop on the rotation deferral.

**Tech Stack:** PostgreSQL (Supabase), `pg_dump` / `psql`, Supabase dashboard +
CLI, AWS SSM Parameter Store, App Runner, EAS / Expo.

## Global Constraints

- **Target region is `us-east-1`.** Decided 2026-08-06. App Runner, ECR, SES and
  Lambda already run there; the migration exists to remove ~200ms of per-query
  cross-region latency, and `API → DB` is paid many times per request
  (`assembleSnapshot` touches seven tables; `/v1/analytics/summary` runs 8–10
  aggregations). A different region does not co-locate and does not deliver the
  goal.
- **No secret value may enter an agent session, a transcript, or a log.** Read
  values from files or pipe them into a decoder; print fingerprints, claims or
  regions only. This is the rule that `docs/secrets-rotation.md` opens with, and
  five of the seven secrets on that list are there because it was broken.
- **The live database is read-only** unless a step says otherwise in the imperative.
  Use `./scripts/with-live-db.sh`.
- **`auth.users.id` must be preserved byte-for-byte.** This is the spike's
  pass/fail condition, not a nice-to-have.
- **Live scale, measured 2026-08-06:** 5 `auth.users`, 6 `auth.identities`
  (`email` ×3, `google` ×2, `apple` ×1), 5 `user_profiles`, 39 public tables,
  2,294 `kanji_difficulty` rows. Every step below is sized for that. **If this
  plan is picked up when the user count is materially larger, stop and re-scope
  — the manual per-user verification in Task 1 does not survive growth.**
- **The spike must not touch the production project.** It reads from live and
  writes only to a throwaway project that is deleted at the end.

---

## File Structure

| Path | Responsibility |
|---|---|
| `scripts/auth-migration-probe.mjs` | **Create.** Compares `auth.users` / `auth.identities` between two projects by id and provider, printing counts and mismatches — never values. The spike's pass/fail instrument. |
| `docs/secrets-rotation.md` | **Modify.** Add the dated backstop to the deferral, and the LLM-key expiry that the migration does *not* cover. |
| `ENHANCEMENTS.md` | **Modify.** Same backstop on the Secrets Management item, so the backlog and the runbook cannot disagree. |
| `docs/superpowers/plans/2026-08-06-supabase-region-migration-spike.md` | This plan. Records the spike result when it is known. |

---

### Task 1: The auth-preservation spike

**Files:**
- Create: `scripts/auth-migration-probe.mjs`
- Read-only against: live project (`aws-1-ap-southeast-2.pooler.supabase.com`)
- Write against: a throwaway `us-east-1` Supabase project, deleted in Step 9

**Interfaces:**
- Consumes: `DATABASE_URL` for the source (via `./scripts/with-live-db.sh`), and
  `TARGET_DATABASE_URL` in the environment for the throwaway project.
- Produces: a printed verdict — `AUTH PRESERVED` or `AUTH BROKEN` with the
  mismatching ids — plus the answer recorded in this plan's Task 1 Result block.

- [ ] **Step 1: Record the source-side truth before touching anything**

```bash
./scripts/with-live-db.sh psql -c "
SELECT u.id, u.email IS NOT NULL AS has_email,
       (SELECT string_agg(i.provider, ',' ORDER BY i.provider)
          FROM auth.identities i WHERE i.user_id = u.id) AS providers,
       (SELECT count(*) FROM user_profiles p WHERE p.id = u.id) AS profile_rows
  FROM auth.users u ORDER BY u.id"
```

Expected: 5 rows. Every row has `profile_rows = 1`. Save this output — it is the
comparison baseline for Step 8. Note the `providers` column: 3 of the 5 users
sign in through Google or Apple and **cannot recover via password reset** if
their identity fails to relink.

- [ ] **Step 2: Write the probe**

Create `scripts/auth-migration-probe.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Compare auth.users and auth.identities between the live project and a
 * migration target. Prints ids, providers and counts — never tokens, never
 * password hashes, never emails.
 *
 * A user arriving in the target with a NEW uuid is the failure this exists to
 * catch: no FK references auth.users (verified 2026-08-06, 0 constraints), so
 * a fresh uuid orphans every row that user owns instead of erroring, and all
 * 11 auth.uid() RLS policies stop matching.
 *
 * Usage:
 *   TARGET_DATABASE_URL='<target uri>' \
 *     ./scripts/with-live-db.sh node \
 *     --import ./packages/db/node_modules/tsx/dist/esm/index.cjs \
 *     scripts/auth-migration-probe.mjs
 */
import { createRequire } from 'node:module'

const require = createRequire(new URL('../packages/db/src/index.ts', import.meta.url))
const postgres = require('postgres')

const SOURCE = process.env.DATABASE_URL
// --self-test compares live against ITSELF, to prove the probe can pass. It
// reads TARGET from the same env var rather than making the operator handle
// the URI: no secret should ever need to be copied to run a check.
const SELF_TEST = process.argv.includes('--self-test')
const TARGET = SELF_TEST ? SOURCE : process.env.TARGET_DATABASE_URL
if (!SOURCE || !TARGET) {
  console.error('DATABASE_URL must be set, and TARGET_DATABASE_URL unless --self-test.')
  process.exit(1)
}

const open = (uri) => postgres(uri, { ssl: 'require', max: 2, prepare: false })

async function snapshot(sql) {
  const users = await sql`SELECT id::text FROM auth.users ORDER BY id`
  const idents = await sql`
    SELECT user_id::text AS user_id, provider FROM auth.identities
     ORDER BY user_id, provider`
  return {
    users: users.map((r) => r.id),
    idents: idents.map((r) => `${r.user_id}:${r.provider}`),
  }
}

// Wrapped, not top-level await: tsx transpiles this to CJS, where top-level
// await is a hard parse error ("Top-level await is currently not supported
// with the cjs output format"). Hit for real on 2026-08-06.
async function main() {
  const src = open(SOURCE)
  const tgt = SELF_TEST ? src : open(TARGET)
  const a = await snapshot(src)
  const b = SELF_TEST ? a : await snapshot(tgt)
  await src.end()
  if (!SELF_TEST) await tgt.end()

  const missing = a.users.filter((id) => !b.users.includes(id))
  const extra = b.users.filter((id) => !a.users.includes(id))
  const identMissing = a.idents.filter((k) => !b.idents.includes(k))

  if (SELF_TEST) console.log('--self-test: comparing live against itself\n')
  console.log(`source users: ${a.users.length}   target users: ${b.users.length}`)
  console.log(`source identities: ${a.idents.length}   target identities: ${b.idents.length}`)
  if (missing.length) console.log(`\nUUIDS MISSING IN TARGET (data would be orphaned):\n  ${missing.join('\n  ')}`)
  if (extra.length) console.log(`\nUNEXPECTED UUIDS IN TARGET:\n  ${extra.join('\n  ')}`)
  if (identMissing.length) console.log(`\nIDENTITIES NOT RELINKED (OAuth sign-in creates a duplicate account):\n  ${identMissing.join('\n  ')}`)

  const ok = missing.length === 0 && extra.length === 0 && identMissing.length === 0
  console.log(`\n${ok ? 'AUTH PRESERVED — migration path is viable' : 'AUTH BROKEN — do not schedule the migration on this method'}`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
```

- [ ] **Step 3: Run the probe against live-vs-live to prove it passes when it should**

```bash
./scripts/with-live-db.sh node \
  --import ./packages/db/node_modules/tsx/dist/esm/index.cjs \
  scripts/auth-migration-probe.mjs --self-test
```

Expected: `AUTH PRESERVED`, 5 users and 6 identities on both sides. **A probe
that cannot pass against a known-identical pair is not evidence of anything** —
this step exists so a later `AUTH PRESERVED` means something.

`--self-test` exists so this check needs no second URI. Do **not** substitute
something like `TARGET_DATABASE_URL="$(... printenv DATABASE_URL)"`: that pulls
the live password into a shell variable and shell history for no benefit, which
is the Global Constraint above and the origin of five of the seven entries in
`docs/secrets-rotation.md`.

- [ ] **Step 4: Commit the probe**

```bash
git add scripts/auth-migration-probe.mjs
git commit -m "feat(scripts): probe auth uuid and identity preservation across projects"
```

- [ ] **Step 5: Create the throwaway target project**

In the Supabase dashboard, create a project named `kanji-learn-spike` in
**us-east-1**. Record its connection string somewhere outside the repo. Do not
paste it into a session.

- [ ] **Step 6: Dump the source, roles and auth included**

```bash
./scripts/with-live-db.sh pg_dump --schema=auth --schema=public \
  --no-owner --no-privileges -Fc -f /tmp/kanji-spike.dump
ls -lh /tmp/kanji-spike.dump
```

Expected: a file of non-trivial size. `--no-owner --no-privileges` matters:
Supabase-managed roles differ between projects and ownership clauses will abort
the restore.

- [ ] **Step 7: Restore into the target**

```bash
pg_restore --no-owner --no-privileges --disable-triggers \
  -d "$TARGET_DATABASE_URL" /tmp/kanji-spike.dump 2>&1 | tail -30
```

Expected: errors on objects Supabase pre-creates (`auth` schema types, some
grants) are normal; **errors mentioning `auth.users` or `auth.identities` are
not** and are the spike's answer. Record them verbatim in the Result block.

- [ ] **Step 8: Run the probe for real**

```bash
TARGET_DATABASE_URL='<target uri>' ./scripts/with-live-db.sh node \
  --import ./packages/db/node_modules/tsx/dist/esm/index.cjs \
  scripts/auth-migration-probe.mjs
```

Expected: `AUTH PRESERVED — migration path is viable`, matching the Step 1
baseline. Anything else is the real result and must be recorded, not retried
until it passes.

Then confirm RLS survived, since the policies are what consume those UUIDs:

```bash
psql "$TARGET_DATABASE_URL" -c "
SELECT count(*) FILTER (WHERE relrowsecurity) || ' of ' || count(*) || ' public tables have RLS'
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r'"
```

Expected: `39 of 39 public tables have RLS` — the same as live after migration
0036.

- [ ] **Step 9: Delete the throwaway project and record the result**

Delete `kanji-learn-spike` from the dashboard. Then fill in the block below in
this file and commit:

```markdown
## Task 1 Result — recorded YYYY-MM-DD

- Probe verdict: AUTH PRESERVED | AUTH BROKEN
- `pg_restore` errors touching auth: <verbatim, or "none">
- RLS on target: N of 39
- **Migration date can now be set: yes | no**
- If no: what breaks, and what method to try next
```

```bash
git add docs/superpowers/plans/2026-08-06-supabase-region-migration-spike.md
git commit -m "docs(plan): record the auth-preservation spike result"
```

---

### Task 2: Give the rotation deferral a deadline

**Files:**
- Modify: `docs/secrets-rotation.md`
- Modify: `ENHANCEMENTS.md` (🔧 Backend & Data → Secrets Management)

**Interfaces:**
- Consumes: nothing from Task 1. **This task is independent and must not wait on
  the spike** — that is the entire point of it.
- Produces: a dated condition that a future session can act on without needing
  this conversation.

**Why this task exists.** Deferring the Supabase rotation until the migration is
sound reasoning — the migration reissues those credentials anyway. But the
deferral currently has no expiry, and that is exactly how credentials exposed on
2026-04-20 were still live on 2026-08-06, verified byte-identical to the leaked
values. Each deferral was individually reasonable; nothing ever forced a
re-decision. A deferral without a date is not a decision, it is a drift.

- [ ] **Step 1: Add the backstop to `docs/secrets-rotation.md`**

Insert immediately after the "Rotate now / Rotated by the region migration"
table:

```markdown
## 🔴 The deferral expires 2026-10-02

Deferring the Supabase four until the region migration is correct reasoning —
that migration reissues them by construction. **But the deferral has a
deadline**, because the exposed values stay live until it happens: verified
2026-08-06, `DATABASE_URL`, `SUPABASE_JWT_SECRET` and
`SUPABASE_SERVICE_ROLE_KEY` are still SSM version 1, byte-identical to the
values leaked on 2026-04-20, and `service_role` bypasses RLS entirely.

**If the migration has not cut over by 2026-10-02, rotate them anyway** — as
part of the LLM-key rotation happening that day. Cost is one
`put-parameter --overwrite` per secret plus one deploy, wasted only if the
migration lands immediately afterwards.

⚠️ **The migration does NOT rotate the three LLM keys.** `ANTHROPIC_API_KEY`,
`GROQ_API_KEY` and `GEMINI_API_KEY` were issued 2026-07-28 and **expire
2026-10-26**, independently of any Supabase work. Their expiry is **silent**:
`/v1/buddy/meet/turn` returns `{fallback:true}` at HTTP 200 on failure, so
Buddy drops to template tier with nothing surfacing. This document schedules
that rotation for 2026-10-26 — the expiry date itself, i.e. **zero margin**.
**Rotate in early October.**
```

- [ ] **Step 2: Mirror the backstop onto the `ENHANCEMENTS.md` item**

Append to the Secrets Management item, after the "What is actually outstanding"
paragraph:

```markdown
  ⏳ **The deferral expires 2026-10-02.** Rotating the Supabase three is deferred to the region migration, which reissues them by construction — but if cutover has not happened by 2026-10-02, rotate them anyway alongside the LLM keys. The exposed values stay live until one or the other occurs, and they have already been live since 2026-04-20. See `docs/secrets-rotation.md`.
```

- [ ] **Step 3: Verify both documents agree**

```bash
grep -c "2026-10-02" docs/secrets-rotation.md ENHANCEMENTS.md
grep -c "2026-10-26" docs/secrets-rotation.md ENHANCEMENTS.md
```

Expected: at least 1 in each file for both dates. A backstop recorded in one
place and not the other is how the two disagreed in the first place.

- [ ] **Step 4: Commit**

```bash
git add docs/secrets-rotation.md ENHANCEMENTS.md
git commit -m "docs(secrets): the rotation deferral now expires 2026-10-02"
```

---

## What this plan deliberately does NOT cover

The migration itself. It cannot be planned honestly until Task 1 returns, because
its two largest steps both depend on the answer:

1. **The mobile release.** `apps/mobile/src/lib/supabase.ts` reads
   `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`, compiled in at
   build time. A new project ref changes both, so every installed build points at
   the old project after cutover. With **5 users** this is coordination, not a
   release gauntlet — but it is still a build (~3h45m per B147–B149), a
   submission, and every user updating before Sydney is decommissioned.
2. **Session invalidation.** A new project means a new JWT secret, so every
   existing session ends and all 5 users sign in again. For the 3 on Google or
   Apple that is only safe if Step 8 returned `AUTH PRESERVED`; otherwise their
   sign-in silently creates a second account and their history is stranded behind
   an unreferenced UUID.

Write the migration plan once the Result block is filled in, not before.
