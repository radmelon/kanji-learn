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
