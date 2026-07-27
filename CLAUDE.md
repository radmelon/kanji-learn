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

## Before judging API test results

Rebuild the local test database first — see
https://github.com/radmelon/kanji-learn/blob/main/docs/local-test-db.md

A stale one reads ~5 extra failures and will send you chasing regressions that
do not exist.

## Mobile testing reality

There is **no** `@testing-library/react-native`; jest runs in a `node`
environment. The established pattern is a **pure reducer beside a thin hook**
(mirror `useCoCreation.reducer`). API integration tests authenticate with a bare
`x-test-user-id` header — there is no `test/helpers/auth.ts`, only
`test-app.ts`.

**Check that test scaffolding exists before trusting a plan that references
it.** Plans in this repo have confidently cited both of the above when neither
was real.
