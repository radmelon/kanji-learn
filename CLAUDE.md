# Project instructions — kanji-learn

Repo-specific conventions. The global `~/.claude/CLAUDE.md` still applies; this
file covers what is specific to **this** repository.

Repo: `radmelon/kanji-learn` (public) · default branch `main`

## Referring to files

**When you point at a repo file the user may open outside this session, hand to
another session, or share — give the full GitHub URL:**

```
https://github.com/radmelon/kanji-learn/blob/main/<path>
```

Bare paths (`` `docs/HANDOFF.md` ``) are for files being edited together *right
now*, where the local path is the useful thing. The moment a file is a
deliverable — a handoff, a spec, a plan, a runbook — give the URL.

This exists because the global rule ("use inline code, not markdown links") is a
**prohibition**: it prevents fake links but never fires to say what to produce
instead. On 2026-07-27 that rule was followed exactly and still produced a
useless answer — "it's in the GitHub repo" alongside a bare local path, leaving
the URL to be reassembled by hand. **When → do beats don't.**

Pin to a commit (`/blob/<sha>/<path>`) only when the point is what the file said
at a moment in time. For anything a next session should act on, link `main`.

## Session handoffs

`docs/HANDOFF.md` is the entry point for a new session, newest section at the
top. It carries its own canonical URL in the header — **keep that line when
writing a new section.** An artifact that states its own address does not depend
on anyone remembering this rule.

Canonical: https://github.com/radmelon/kanji-learn/blob/main/docs/HANDOFF.md

## Open Brain

Defined in `.mcp.json` at the repo root, so it loads for **any session started
in this repo** — not via claude.ai connector settings, which are per-surface and
were the reason it silently went missing on 2026-07-27.

**The access key is never committed.** `.mcp.json` references
`${OPEN_BRAIN_KEY}`; supply it in `.claude/settings.local.json` (gitignored):

```json
{ "env": { "OPEN_BRAIN_KEY": "<key from claude.ai → Settings → Connectors>" } }
```

…or `export OPEN_BRAIN_KEY=…` in your shell.

**If Open Brain tools are absent, say so immediately — do not silently
substitute a file.** On 2026-07-27 a "capture this to OB" request quietly
became an `ENHANCEMENTS.md` entry; the user only learned OB was unreachable
because it was mentioned in passing. A silent fallback is worse than a refusal:
the thought does not land where they expect it and they find out much later.

**Auth:** this server takes EITHER `?key=<key>` in the URL (Claude Desktop,
ChatGPT — clients that cannot send custom headers) OR an **`x-brain-key`**
header (Claude Code, mcp-remote). It is `x-brain-key` — *not*
`Authorization`/`x-api-key`/`apikey`, none of which it recognises. `.mcp.json`
uses the header form.

**The expected key lives in the Supabase secret `MCP_ACCESS_KEY`** on project
`nscgwcepxnalchobgqhx` — not in a keys table. `supabase secrets list` shows it.

**Diagnosing a connection failure** — probe the endpoint before blaming the
client:

```bash
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  "https://nscgwcepxnalchobgqhx.supabase.co/functions/v1/open-brain-mcp?key=$OPEN_BRAIN_KEY"
```

`401 {"error":"Invalid or missing access key"}` means the value does not match
`MCP_ACCESS_KEY`. The Edge Function is healthy and doing its own check.
Verified 2026-07-27: the same 401 for the query-string form, the `x-brain-key`
header, and no key at all — so a 401 is a **key mismatch**, never a placement
problem.

To regenerate: `openssl rand -hex 32` → `supabase secrets set
MCP_ACCESS_KEY=<new> --project-ref nscgwcepxnalchobgqhx` → redeploy
(`supabase functions deploy open-brain-mcp --no-verify-jwt`) → update
`OPEN_BRAIN_KEY` locally and the connector URL in claude.ai. The two must match
character-for-character.

## Verifying deploys — do not trust status codes

`apps/api/src/routes/mnemonics.ts` has parametric `GET/POST /:kanjiId`, which
**swallow** `/refresh`, `/assemble` and `/buddy-moment-context`. Those paths
return `401` on *any* build, including one predating the feature. A rollout was
reported "verified" on that signal while App Runner served a 6-week-old image.

Verify a deploy with **both**:

1. An App Runner operation dated today (`aws apprunner list-operations …`).
2. **Response content** — a field only the new build returns. For Phase 5 the
   canary is `components` on `GET /v1/kanji/:id`.

Full detail in
https://github.com/radmelon/kanji-learn/blob/main/docs/SOP.md

## You DO have live database access — use the wrapper

**Never say "I don't have DB credentials." You do.** They are in
`packages/db/.env` (gitignored), and there is a wrapper that loads them without
printing, echoing, or leaving them in shell history:

```bash
./scripts/with-live-db.sh psql -c "SELECT count(*) FROM mnemonics"
```

`psql`, `pg_dump` and `pg_restore` get the URI appended automatically; anything
else (node scripts) inherits `DATABASE_URL` in its environment. **Never handle
the value yourself** — the live password was once printed to a transcript in
plaintext because a redaction regex missed the `postgresql://` scheme.

🔴 **That leaked password is still live. Verified 2026-08-06.** The exposed
`DATABASE_URL`, `SUPABASE_JWT_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` are
unchanged in production — SSM version 1, untouched since 2026-07-29, and
byte-identical to `packages/db/.env`. The service-role key decodes to `exp`
**2036**-03-26, so it does not lapse on its own.

**Do not record these as rotated.** An owner report on 2026-08-06 said the
Supabase credentials had been rotated with a 2026-10-02 expiry; checking
production found no trace of either. New keys may have been *created* without
the old ones being revoked or production being switched — which leaves the leak
open while looking closed. Full evidence in `ENHANCEMENTS.md` → 🔧 Backend &
Data → Secrets Management.

The four non-Supabase keys (`ANTHROPIC_API_KEY`, `GROQ_API_KEY`,
`GEMINI_API_KEY`, `INTERNAL_SECRET`) **were** rotated — SSM version 2. And the
SSM migration itself is done: App Runner reads all seven by ARN, so the
plaintext-env exposure is closed even though the values are not.

**Default to read-only.** `SELECT` freely to answer a question about real data.
A write, migration, or `pg_restore` against live is a separate decision that
needs the owner's explicit go-ahead in the moment.

**Why this section exists.** On 2026-08-01 a session told the owner it could not
verify a production row "no DB credentials here" — twice — and closed a real bug
investigation on that basis. The capability existed the whole time. It was
documented in eight files, none of which a session opens by default, and the
most relevant one is named **`local-test-db.md`** — a file about the *test*
database, which is exactly where nobody looks for *production* access.

The wrong answer cost a day: 毛's live row is
`["down","feather","fur","hair"]`, so the placement test keys it on **"down"**.
One `SELECT` would have confirmed the owner's report immediately instead of
producing a defence of the wrong conclusion.

**Two databases, do not confuse them:**

| | Connection | Use |
|---|---|---|
| **Live** | `./scripts/with-live-db.sh` | Answering questions about real data. Read-only by default |
| **Local test** | `localhost:5433/kanji_buddy_test`, see below | Running the API suite. Holds the **full kanji corpus** (2,286 as of 2026-08-04) |

## Before judging API test results

Rebuild the local test database first — see
https://github.com/radmelon/kanji-learn/blob/main/docs/local-test-db.md

A stale one reads ~5 extra failures and will send you chasing regressions that
do not exist.

## Mobile testing reality

Mobile now has two Jest lanes:

1. `pnpm --filter @kanji-learn/mobile test -- --runInBand` — the established
   pure logic lane. It still runs in `node` with `ts-jest`, and it deliberately
   excludes `apps/mobile/test/components/`.
2. `pnpm --filter @kanji-learn/mobile test:components` — the component render
   lane. It uses `jest-expo` + `@testing-library/react-native` and currently
   proves focused `.tsx` component rendering with `OfflineBanner`.

Default to the pure reducer / pure helper pattern for decisions that do not need
rendering (mirror `useCoCreation.reducer`). Use the component lane when the
behavior is a visible React Native render state or interaction surface. Full
protocol:
https://github.com/radmelon/kanji-learn/blob/main/docs/local-build-and-test-protocol.md

API integration tests authenticate with a bare `x-test-user-id` header — there
is no `test/helpers/auth.ts`, only `test-app.ts`.

**Check that test scaffolding exists before trusting a plan that references
it.** Plans in this repo have confidently cited missing tools before.
