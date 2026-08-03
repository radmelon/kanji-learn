# Coaching slice 3 — analysis mode: Buddy speaks the findings

> **Canonical URL — hand this to a new session:**
> https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/plans/2026-08-03-coaching-slice3-analysis-mode.md

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Spec:
https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-03-coaching-slice3-design.md

Parent spec:
https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-08-01-buddy-coaching-analysis-design.md

**Goal:** On a due weekly session with findings, the API returns one composed
utterance in Buddy's voice — LLM-authored when possible, template prose when
not — and the mobile session renders it as a single card.

**Architecture:** A pure prompt builder (`coaching-prompt.ts`) mirrors
`meeting-prompt.ts`. A service (`coaching-voice.service.ts`) owns cache-read →
prompt → `buddyLLM.route()` → validate → cache-write, and falls back to today's
template surface on every failure path. The `due` branch of
`GET /v1/buddy/session` calls it and adds an **additive** `voice` field.
`opener` and `reckon` stay in the payload untouched, so an old client is
unaffected. The notebook is not touched at all — §2: the record stays template
prose, only the conversation gets a voice.

**Tech stack:** TypeScript, Fastify, Drizzle/Postgres, Vitest (API + shared),
Jest/`ts-jest` (mobile pure lane), `BuddyLLMRouter` tier 3.

---

## Global Constraints

Every task's requirements implicitly include these. They come from the spec and
from what slice 2's retrospective found.

1. **No test asserts LLM prose.** Parent §10: *"The contract under test is that
   the LLM is handed the right findings and that template output is correct
   without it."* Assert structure, call counts, `source`, and the presence or
   absence of substrings you control — never model wording.
2. **Every test names the mutation it catches.** In a comment on the test.
   Slice 2 shipped tests that could not fail; that is worse than a missing test.
3. **`mechanics_explainer` must never appear in the prompt string.** §4. It is
   filtered out before the prompt is built and appended verbatim afterwards.
4. **`analysisBody(findings, now)` — `now` is mandatory.** `copy.ts:62` reads
   `if (!now || days >= ESCALATE_AFTER_DAYS)`, so omitting it escalates every
   finding that has a `since`, silently, with no other test failing.
5. **The voice layer performs no arithmetic.** `Evidence.label`/`value` are
   already display-safe (parent §1). The prompt must say so explicitly.
6. **Nothing in this slice writes to `notebook_entries.body`.** §2.
7. **`opener` and `reckon` stay in the response.** §8. Additive only.
8. **The `due` GET must never 500 because coaching failed.** The session's
   guaranteed outcome is agreeing the week ahead; a coaching failure is logged,
   never surfaced. Mirrors the existing guard around the notebook write in
   `buddy-session.ts:157-165`.
9. **Rebuild the local test database before judging API results** —
   https://github.com/radmelon/kanji-learn/blob/main/docs/local-test-db.md —
   and it must have migration `0035` applied (Task 3).

### Two decisions this plan makes that the spec left open

Both are called out where they land; recorded here so a reviewer sees them
without reading every task.

- **The `RequestContext` value is `'coaching_utterance'`, not
  `'coaching_analysis'`.** §5 says "register the coaching utterance as a tier-3
  context" without naming it. `'coaching_analysis'` is already taken by
  `COACHING_SOURCE_KIND` (`coaching.service.ts:21`) as a `notebook_entries`
  source key; reusing the string across two namespaces would make a grep for
  either return both.
- **Only successful LLM utterances are cached.** §6 fixes the key and says
  there is no TTL; it does not say whether a template fallback is cached.
  Caching it would freeze a degraded session for the whole remaining period on
  a transient outage — and the template path costs nothing to recompute, so
  there is no call to save. A cache hit therefore always implies `source:
  'llm'`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `apps/api/src/services/llm/types.ts` | Modify | Register `'coaching_utterance'` in `RequestContext` and `TIER3_CONTEXTS`. |
| `apps/api/src/services/buddy/coaching-prompt.ts` | Create | `buildCoachingPrompt` + `partitionForVoice`. Pure — no I/O, no clock, no service deps. Sibling of `meeting-prompt.ts`. |
| `packages/db/supabase/migrations/0035_session_utterances.sql` | Create | `buddy_session_utterances` + unique key + RLS. |
| `packages/db/src/schema.ts` | Modify | `buddySessionUtterances` Drizzle table. |
| `docs/local-test-db.md` | Modify | Add `0035` to the provisioning list. |
| `apps/api/src/services/buddy/coaching-voice.service.ts` | Create | Cache → prompt → route → validate → cache. Owns the fallback. Never throws. |
| `apps/api/src/routes/buddy-session.ts` | Modify | `due` branch only: refresh, get the voice, add `voice` to the payload. |
| `apps/mobile/src/lib/buddy-session-state.ts` | Modify | `voice` card kind, preferred over `opener`/`reckon`. |

**No mobile component change is needed.** `BuddySessionBody.tsx:95-99` already
renders any non-`set` card as `<Text>{card.text}</Text>`, and after narrowing
out `'set'` the union `voice | opener | reckon` all carry `text`, so it
typechecks untouched. Do not edit it.

---

## Task 1: Register the tier-3 context

**Files:**
- Modify: `apps/api/src/services/llm/types.ts:3-15` (the union), `:43-46` (`TIER3_CONTEXTS`)
- Test: `apps/api/test/unit/llm/types.test.ts:39-42`

**Interfaces:**
- Consumes: nothing.
- Produces: `RequestContext` gains the literal `'coaching_utterance'`.
  `classifyTier({context: 'coaching_utterance', …})` returns `3`.

Spec §5: tier 3 means an opted-in learner is served by Claude and everyone else
falls through to tier 2 with no branching in the caller. **Not tier 1** — the
server's tier-1 provider is `AppleFoundationStubProvider`, which always reports
unavailable, so a tier-1 context would silently land on tier 2 while pretending
to be on-device.

- [ ] **Step 1: Write the failing test**

Add to the existing `describe('classifyTier', …)` block in
`apps/api/test/unit/llm/types.test.ts`, immediately after the
`'returns 3 for deep-reasoning contexts'` case:

```ts
  // MUTATION CAUGHT: adding 'coaching_utterance' to the RequestContext union
  // but forgetting TIER3_CONTEXTS. That mutation is invisible at runtime —
  // the router still answers, just from tier 2 — so nothing else fails and
  // the "quality matters most here" decision in §5 is silently reversed.
  it('classifies the coaching utterance as tier 3', () => {
    expect(classifyTier({ ...base, context: 'coaching_utterance' })).toBe(3)
  })
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @kanji-learn/api test -- test/unit/llm/types.test.ts
```

Expected: FAIL. TypeScript rejects `'coaching_utterance'` as not assignable to
`RequestContext`.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/src/services/llm/types.ts`, add to the union (after
`'deep_diagnostic'`):

```ts
  | 'deep_diagnostic'
  | 'coaching_utterance'
  | 'social_nudge'
```

and to `TIER3_CONTEXTS`:

```ts
const TIER3_CONTEXTS: readonly RequestContext[] = [
  'mnemonic_cocreation',
  'deep_diagnostic',
  // The weekly coaching utterance (slice 3 §5). One call per learner per week
  // behind the §6 cache, and it is the moment a learner is told something true
  // about their own progress — the output where quality matters most.
  'coaching_utterance',
]
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @kanji-learn/api test -- test/unit/llm/types.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/llm/types.ts apps/api/test/unit/llm/types.test.ts && git commit -m "feat(llm): register coaching_utterance as a tier-3 context"
```

---

## Task 2: The prompt builder

**Files:**
- Create: `apps/api/src/services/buddy/coaching-prompt.ts`
- Test: `apps/api/test/unit/buddy/coaching-prompt.test.ts`

**Interfaces:**
- Consumes: `Finding`, `FindingKind`, `Evidence` from `@kanji-learn/shared`.
- Produces:
  ```ts
  export interface CoachingPromptInput {
    openerKind: string
    openerText: string
    reckon: string | null
    findings: readonly Finding[]
  }
  export function buildCoachingPrompt(input: CoachingPromptInput): string
  export function partitionForVoice(
    findings: readonly Finding[],
  ): { spoken: Finding[]; mechanics: Finding | null }
  ```

`partitionForVoice` is the single implementation of §4's filter rule.
`buildCoachingPrompt` calls it internally so `mechanics_explainer` cannot reach
the prompt string *even if a caller passes it in* — the invariant holds at the
boundary rather than depending on the caller. Task 4 calls it again to get the
finding it must append.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/unit/buddy/coaching-prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { Finding } from '@kanji-learn/shared'
import {
  buildCoachingPrompt,
  partitionForVoice,
} from '../../../src/services/buddy/coaching-prompt'

const leech: Finding = {
  kind: 'leech',
  magnitude: 0.7,
  confidence: 0.8,
  evidence: [
    { label: 'worst kanji', value: '敗', kanjiId: 1, character: '敗' },
    { label: 'lapses', value: 4 },
  ],
  since: '2026-07-12',
}

const mechanics: Finding = {
  kind: 'mechanics_explainer',
  magnitude: 0.1,
  confidence: 1,
  evidence: [],
  since: null,
}

const base = {
  openerKind: 'strong',
  openerText: 'Four days out of four. That is the whole thing working.',
  reckon: 'You said 4 days and did 4.',
  findings: [leech],
}

describe('partitionForVoice', () => {
  // MUTATION CAUGHT: a filter written as `f.kind !== 'mechanics_explainer'`
  // on the spoken side but never returning the removed finding. Task 4 would
  // then have nothing to append and the explainer would vanish from the
  // session entirely — §4 says it is removed from the prompt AND appended.
  it('separates mechanics_explainer from the findings the LLM may voice', () => {
    const { spoken, mechanics: m } = partitionForVoice([leech, mechanics])
    expect(spoken.map((f) => f.kind)).toEqual(['leech'])
    expect(m?.kind).toBe('mechanics_explainer')
  })

  // MUTATION CAUGHT: returning `findings[0]` or a truthy sentinel for
  // mechanics when the kind never fired, which would make Task 4 append a
  // duplicate of a real finding as if it were the explainer.
  it('reports no mechanics finding when the kind did not fire', () => {
    expect(partitionForVoice([leech]).mechanics).toBeNull()
  })

  // MUTATION CAUGHT: filtering in place with `.splice`/sort, mutating the
  // caller's array. The route reuses `findings` for analysisBody afterwards;
  // a mutated array would silently drop the explainer from the template
  // fallback too.
  it('does not mutate the input array', () => {
    const input = [leech, mechanics]
    partitionForVoice(input)
    expect(input.map((f) => f.kind)).toEqual(['leech', 'mechanics_explainer'])
  })
})

describe('buildCoachingPrompt', () => {
  // MUTATION CAUGHT: the whole point of §4. If a later refactor passes the
  // unfiltered list, or someone "simplifies" buildCoachingPrompt to trust its
  // caller, Buddy starts paraphrasing his own IRT internals and §10 forbids
  // the prose test that would otherwise notice.
  it('never mentions mechanics_explainer, even when handed it directly', () => {
    const prompt = buildCoachingPrompt({ ...base, findings: [leech, mechanics] })
    expect(prompt).not.toContain('mechanics_explainer')
    expect(prompt).not.toContain('IRT')
  })

  // MUTATION CAUGHT: serialising only `kind`, which is exactly the defect the
  // slice 2 retrospective found in templateCopy — the evidence exists and the
  // copy layer never reads it. The model cannot name 敗 if it is not sent 敗.
  it('carries each finding kind and its evidence labels and values', () => {
    const prompt = buildCoachingPrompt(base)
    expect(prompt).toContain('leech')
    expect(prompt).toContain('worst kanji')
    expect(prompt).toContain('敗')
    expect(prompt).toContain('lapses')
    expect(prompt).toContain('4')
  })

  // MUTATION CAUGHT: dropping the opener or reckoning from the input, which
  // would leave the model composing from findings alone and produce an
  // utterance that ignores what the learner actually did last period.
  it('carries the opener and the reckoning', () => {
    const prompt = buildCoachingPrompt(base)
    expect(prompt).toContain(base.openerText)
    expect(prompt).toContain(base.reckon)
  })

  // MUTATION CAUGHT: interpolating a null reckon as the string "null", which
  // a first-ever-session learner would get, telling the model to relay the
  // literal word.
  it('says there is no reckoning rather than printing null', () => {
    const prompt = buildCoachingPrompt({ ...base, reckon: null })
    expect(prompt).not.toContain('null')
    expect(prompt.toLowerCase()).toContain('no previous period')
  })

  // MUTATION CAUGHT: dropping the do-not-calculate instruction. Parent §1
  // makes "the voice layer has nothing left to calculate" load-bearing: a
  // model that recomputes a percentage can contradict the notebook, and no
  // test may assert prose, so this instruction is the only defence.
  it('forbids recomputing numbers', () => {
    const prompt = buildCoachingPrompt(base).toLowerCase()
    expect(prompt).toContain('do not')
    expect(prompt).toContain('calculate')
  })

  // MUTATION CAUGHT: copying meeting-prompt.ts wholesale, JSON envelope and
  // all. §4 asks for plain prose — a JSON wrapper adds a parse-failure mode
  // for nothing, and Task 4 would return a raw `{"reply": …}` blob as Buddy's
  // words.
  it('asks for plain prose, not JSON', () => {
    const prompt = buildCoachingPrompt(base)
    expect(prompt).not.toContain('JSON object')
    expect(prompt.toLowerCase()).toContain('no json')
  })

  // MUTATION CAUGHT: emitting three labelled sections instead of asking for
  // one composed utterance — §3's whole reason for existing.
  it('asks for a single utterance', () => {
    expect(buildCoachingPrompt(base).toLowerCase()).toContain('one thing')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @kanji-learn/api test -- test/unit/buddy/coaching-prompt.test.ts
```

Expected: FAIL — `Cannot find module '../../../src/services/buddy/coaching-prompt'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/services/buddy/coaching-prompt.ts`:

```ts
// apps/api/src/services/buddy/coaching-prompt.ts
//
// The analysis-mode prompt (slice 3 §4). Pure: no I/O, no clock, no service
// dependencies — the same shape as meeting-prompt.ts, deliberately.
//
// What the model receives is fixed by parent §1: findings and their Evidence,
// never a database row. Evidence.label/value are already display-safe, "so the
// voice layer has nothing left to calculate" — the instruction block below is
// the only thing enforcing that, because §10 forbids asserting prose.

import type { Finding } from '@kanji-learn/shared'

export interface CoachingPromptInput {
  openerKind: string
  openerText: string
  /** null when there is no previous period — a first-ever session. */
  reckon: string | null
  findings: readonly Finding[]
}

/**
 * Split the findings into what the LLM may voice and the one kind it may not.
 *
 * §3: mechanics_explainer is "template, always, never LLM. Buddy must not
 * improvise about his own algorithm, so this string is the whole finding."
 * Removing it from the input rather than instructing the model to quote it
 * exactly makes paraphrase structurally impossible instead of
 * instruction-dependent — and §10 forbids the prose assertion that would be
 * the only way to catch a paraphrase.
 *
 * Returns fresh arrays; never mutates the input.
 */
export function partitionForVoice(
  findings: readonly Finding[],
): { spoken: Finding[]; mechanics: Finding | null } {
  const spoken: Finding[] = []
  let mechanics: Finding | null = null
  for (const f of findings) {
    if (f.kind === 'mechanics_explainer') mechanics = f
    else spoken.push(f)
  }
  return { spoken, mechanics }
}

function describe(f: Finding): string {
  const facts = f.evidence.length === 0
    ? 'no specific evidence'
    : f.evidence.map((e) => `${e.label}: ${e.value}`).join('; ')
  const seen = f.since === null ? 'first time' : `first seen ${f.since}`
  return `- ${f.kind} (magnitude ${f.magnitude.toFixed(2)}, confidence ${f.confidence.toFixed(2)}, ${seen}) — ${facts}`
}

export function buildCoachingPrompt(input: CoachingPromptInput): string {
  // Filtered HERE, not by the caller. The invariant then holds regardless of
  // what any future call site passes in.
  const { spoken } = partitionForVoice(input.findings)

  return [
    'You are Buddy, a kanji-learning companion talking to a learner you already know. Honest, warm, brief — four or five sentences, no lists, no headings, no emoji.',
    `Opener (kind: ${input.openerKind}): ${input.openerText}`,
    input.reckon === null
      ? 'Reckoning: none — there is no previous period to look back on.'
      : `Reckoning: ${input.reckon}`,
    'Findings, most important first:',
    spoken.map(describe).join('\n'),
    'Say ONE thing that covers the opener, the reckoning and the findings as a single continuous piece of prose. Not three paragraphs stitched together — one voice.',
    'Every number, level, percentage, date and kanji you use MUST appear verbatim above. Do NOT calculate, re-derive, convert, round or estimate anything, and do not add facts about this learner that are not listed.',
    'Name the specific kanji and the specific next move where the findings give you one — "a handful of kanji" and "this level" are failures.',
    'Reply with the utterance only. No preamble, no quotation marks, no JSON.',
  ].join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @kanji-learn/api test -- test/unit/buddy/coaching-prompt.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/buddy/coaching-prompt.ts apps/api/test/unit/buddy/coaching-prompt.test.ts && git commit -m "feat(coaching): the analysis-mode prompt, with mechanics_explainer filtered at the boundary"
```

---

## Task 3: `buddy_session_utterances` — migration, table, provisioning

**Files:**
- Create: `packages/db/supabase/migrations/0035_session_utterances.sql`
- Modify: `packages/db/src/schema.ts` (after `buddyCommitments`, which ends at `:757`)
- Modify: `docs/local-test-db.md` (the migration list at lines 14-25)
- Test: `apps/api/test/integration/buddy-session-utterances-schema.test.ts`

**Interfaces:**
- Produces: `buddySessionUtterances` exported from `@kanji-learn/db` with
  columns `id`, `userId`, `weekStart`, `text`, `providerName`, `createdAt`, and
  a unique index `buddy_session_utterances_user_week_unique` on
  `(user_id, week_start)`.

**The column is `provider_name`, not `model`.** §6 asks for "the model that
produced it"; the only value actually available is
`CompletionResult.providerName` (`packages/shared/src/llm-types.ts:55`) — there
is no model-id field on the result. A column named `model` holding `"groq"`
would be a lie in the schema.

> 🛑 **`drizzle-kit push` builds the local test DB from `schema.ts`, and RLS
> comes only from the migration.** Adding the Drizzle table without applying
> `0035` to the test database makes `rls-coverage.test.ts` fail with the new
> table named in its output. That test is doing its job — apply the migration,
> do not add the table to `ALLOWED_TABLES_WITHOUT_RLS`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/integration/buddy-session-utterances-schema.test.ts`:

```ts
// Schema guarantees for buddy_session_utterances (slice 3 §6).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER = '00000000-0000-0000-0000-0000000000c1'
const WEEK = '2026-08-03'

beforeAll(async () => {
  await db.insert(schema.userProfiles)
    .values({ id: USER, displayName: 'Utterance Fixture', timezone: 'America/Los_Angeles' })
    .onConflictDoNothing()
})

beforeEach(async () => {
  await db.delete(schema.buddySessionUtterances)
    .where(eq(schema.buddySessionUtterances.userId, USER))
})

afterAll(async () => {
  await db.delete(schema.buddySessionUtterances)
    .where(eq(schema.buddySessionUtterances.userId, USER))
  await db.delete(schema.userProfiles).where(eq(schema.userProfiles.id, USER))
  await client.end()
})

describe('buddy_session_utterances', () => {
  // MUTATION CAUGHT: shipping the table without the unique index. Task 4's
  // cache would then accumulate one row per app open on a Buddy day — the
  // exact "Buddy says something different every time you look" failure §6
  // exists to prevent — and the read would pick an arbitrary row.
  it('permits one utterance per (user, week) and rejects a duplicate', async () => {
    await db.insert(schema.buddySessionUtterances)
      .values({ userId: USER, weekStart: WEEK, text: 'first', providerName: 'groq' })

    await expect(
      db.insert(schema.buddySessionUtterances)
        .values({ userId: USER, weekStart: WEEK, text: 'second', providerName: 'groq' }),
    ).rejects.toThrow()

    const rows = await db.select().from(schema.buddySessionUtterances)
      .where(eq(schema.buddySessionUtterances.userId, USER))
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe('first')
  })

  // MUTATION CAUGHT: a different week_start colliding — proves the unique key
  // is (user_id, week_start) and not user_id alone, which would make the
  // cache hold one utterance ever rather than one per period.
  it('allows a second utterance in a different period', async () => {
    await db.insert(schema.buddySessionUtterances)
      .values({ userId: USER, weekStart: WEEK, text: 'first', providerName: 'groq' })
    await db.insert(schema.buddySessionUtterances)
      .values({ userId: USER, weekStart: '2026-08-10', text: 'next', providerName: 'groq' })

    const rows = await db.select().from(schema.buddySessionUtterances)
      .where(eq(schema.buddySessionUtterances.userId, USER))
    expect(rows).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @kanji-learn/api test -- test/integration/buddy-session-utterances-schema.test.ts
```

Expected: FAIL — `schema.buddySessionUtterances` is undefined.

- [ ] **Step 3a: Write the migration**

Create `packages/db/supabase/migrations/0035_session_utterances.sql`:

```sql
-- Migration 0035: what Buddy said in the weekly session
-- Run order: 35
--
-- Implements docs/superpowers/specs/2026-08-03-coaching-slice3-design.md §6.
--
-- GET /v1/buddy/session is called every time the learner opens the app on
-- their Buddy day. Without a cache Buddy says something DIFFERENT every time
-- they look, and every look costs an LLM call. The codebase already holds this
-- position: pickHookCandidate breaks ties deterministically because "a coach
-- that suggests a different kanji each time you reload is not a coach."
--
-- Its own table rather than buddy_commitments.method (an unused jsonb column
-- whose (user_id, week_start) key is exactly right): `method` means how the
-- commitment was arrived at, so a future reader would find Buddy's spoken
-- analysis under a name meaning something else, and setForWeek's upsert could
-- clobber it. A dedicated table also gives "what Buddy said each week" as a
-- queryable history for free.
--
-- No TTL and no invalidation, deliberately: the key IS the session period, and
-- a third time constant on top of slice 2's staleness and coalescing windows
-- would be three windows to reason about for no behavioural gain.
--
-- provider_name, not model: CompletionResult carries providerName and no model
-- id (packages/shared/src/llm-types.ts). A column called `model` holding
-- "groq" would be wrong in the schema itself.

BEGIN;

CREATE TABLE IF NOT EXISTS buddy_session_utterances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  week_start    date NOT NULL,
  text          text NOT NULL,
  provider_name text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS buddy_session_utterances_user_week_unique
  ON buddy_session_utterances (user_id, week_start);

COMMENT ON TABLE buddy_session_utterances IS
  'One composed utterance per learner per weekly session period. Cache, not record — the durable record is the notebook entry, which stays template prose (slice 3 §2).';

-- RLS: the API connects as postgres (BYPASSRLS); anon/authenticated PostgREST
-- callers are default-deny. rls-coverage.test.ts fails CI for any public table
-- missing either flag.
ALTER TABLE public.buddy_session_utterances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buddy_session_utterances FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='buddy_session_utterances'
                 AND policyname='Users read own buddy_session_utterances') THEN
    CREATE POLICY "Users read own buddy_session_utterances" ON public.buddy_session_utterances
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='buddy_session_utterances'
                 AND policyname='Service role can manage buddy_session_utterances') THEN
    CREATE POLICY "Service role can manage buddy_session_utterances" ON public.buddy_session_utterances
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;
```

- [ ] **Step 3b: Add the Drizzle table**

In `packages/db/src/schema.ts`, immediately after the `buddyCommitments`
definition (which closes at line 757) and before the
`// ─── notebook_entries ───` banner:

```ts
// ─── buddy_session_utterances ────────────────────────────────────────────────
// What Buddy actually said in one weekly session (slice 3 §6). A CACHE keyed on
// the session period, not a record — the durable record is the notebook entry,
// which stays template prose so it never varies with LLM availability.

export const buddySessionUtterances = pgTable(
  'buddy_session_utterances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    weekStart: date('week_start').notNull(),
    text: text('text').notNull(),
    // CompletionResult.providerName — there is no model id on the result.
    providerName: text('provider_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userWeekUnique: uniqueIndex('buddy_session_utterances_user_week_unique')
      .on(t.userId, t.weekStart),
  })
)
```

Every identifier used here (`pgTable`, `uuid`, `date`, `text`, `timestamp`,
`uniqueIndex`) is already imported at `packages/db/src/schema.ts:1-19`. No
import change is needed.

- [ ] **Step 3c: Add 0035 to the test-DB provisioning list**

In `docs/local-test-db.md`, in the `psql … -f` list, add after the
`0034_coaching_analysis_index.sql` line:

```
  -f packages/db/supabase/migrations/0035_session_utterances.sql \
```

- [ ] **Step 4: Apply the migration locally, then run the tests**

Apply just this file to the existing test database — **do not re-run the whole
list**, which is not idempotent and rolls back RLS flags on the way to
failing (`docs/local-test-db.md`, "Re-running that migration list makes things
WORSE"):

```bash
psql "postgresql://kanji:kanji@localhost:5433/kanji_buddy_test?sslmode=disable" -v ON_ERROR_STOP=1 -f packages/db/supabase/migrations/0035_session_utterances.sql
```

```bash
pnpm --filter @kanji-learn/api test -- test/integration/buddy-session-utterances-schema.test.ts test/integration/rls-coverage.test.ts
```

Expected: PASS — 2 schema tests, and `rls-coverage` reporting zero unprotected
tables. If `rls-coverage` names `buddy_session_utterances`, the migration did
not run; re-run the `psql` command and read its output.

- [ ] **Step 5: Commit**

```bash
git add packages/db/supabase/migrations/0035_session_utterances.sql packages/db/src/schema.ts docs/local-test-db.md apps/api/test/integration/buddy-session-utterances-schema.test.ts && git commit -m "feat(db): 0035 buddy_session_utterances, one utterance per session period"
```

---

## Task 4: `CoachingVoiceService`

**Files:**
- Create: `apps/api/src/services/buddy/coaching-voice.service.ts`
- Test: `apps/api/test/integration/coaching-voice.test.ts`

**Interfaces:**
- Consumes: `buildCoachingPrompt`, `partitionForVoice` (Task 2);
  `buddySessionUtterances` (Task 3); `'coaching_utterance'` (Task 1);
  `analysisBody`, `templateCopy`, `Finding` from `@kanji-learn/shared`.
- Produces:
  ```ts
  export interface CoachingVoice { text: string; source: 'llm' | 'template' }
  export const MAX_UTTERANCE_CHARS = 1500
  export class CoachingVoiceService {
    constructor(db: Db, llm: Pick<BuddyLLMRouter, 'route'>)
    utteranceFor(input: {
      userId: string
      weekStart: string
      openerKind: string
      openerText: string
      reckon: string | null
      findings: readonly Finding[]
      now: string
      log?: { error: (obj: object, msg: string) => void }
    }): Promise<CoachingVoice | null>
  }
  ```
  Returns `null` when there are no findings — §2's common case, where no LLM
  call is made and no `voice` field is returned. Never throws.

**Do not set `userOptedInPremium: true`.** `tutor-analysis.service.ts:74` does,
with a comment about bypassing the premium gate for a system-initiated
analysis. §5 asks for the opposite here: *"an opted-in learner is served by
Claude, and everyone else falls through to tier 2 automatically."* There is no
premium flag in the schema today, so leaving the field unset is what produces
that behaviour.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/integration/coaching-voice.test.ts`:

```ts
// CoachingVoiceService — cache, fallback, and the mechanics_explainer seam.
// Per parent §10, no test here asserts LLM prose: the stub returns a sentinel
// string this file controls, so every assertion is about routing and
// structure, never about wording.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import type { Finding } from '@kanji-learn/shared'
import { CoachingVoiceService } from '../../src/services/buddy/coaching-voice.service'
import { BuddyLLMError } from '../../src/services/llm/types'
import type { BuddyLLMRouter } from '../../src/services/llm/router'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER = '00000000-0000-0000-0000-0000000000c2'
const WEEK = '2026-08-03'
const NOW = '2026-08-03T17:00:00.000Z'
const SENTINEL = 'SENTINEL_UTTERANCE'

const leech: Finding = {
  kind: 'leech',
  magnitude: 0.7,
  confidence: 0.8,
  evidence: [{ label: 'worst kanji', value: '敗', kanjiId: 1, character: '敗' }],
  since: '2026-07-12',
}
const mechanics: Finding = {
  kind: 'mechanics_explainer',
  magnitude: 0.1, confidence: 1, evidence: [], since: null,
}

function stubRouter(impl: (req: unknown) => Promise<unknown>) {
  const route = vi.fn(impl)
  return { router: { route } as unknown as Pick<BuddyLLMRouter, 'route'>, route }
}

function ok(content: string) {
  return async () => ({
    content, finishReason: 'stop', inputTokens: 100, outputTokens: 50,
    providerName: 'groq', latencyMs: 12,
  })
}

const base = {
  userId: USER,
  weekStart: WEEK,
  openerKind: 'strong',
  openerText: 'OPENER_TEXT',
  reckon: 'RECKON_TEXT',
  now: NOW,
}

beforeAll(async () => {
  await db.insert(schema.userProfiles)
    .values({ id: USER, displayName: 'Voice Fixture', timezone: 'America/Los_Angeles' })
    .onConflictDoNothing()
})

beforeEach(async () => {
  await db.delete(schema.buddySessionUtterances)
    .where(eq(schema.buddySessionUtterances.userId, USER))
})

afterAll(async () => {
  await db.delete(schema.buddySessionUtterances)
    .where(eq(schema.buddySessionUtterances.userId, USER))
  await db.delete(schema.userProfiles).where(eq(schema.userProfiles.id, USER))
  await client.end()
})

describe('CoachingVoiceService', () => {
  // MUTATION CAUGHT: calling the LLM to say "nothing much this week". §2 is
  // explicit that no findings is the COMMON case; a call here would spend a
  // tier-3 slot per learner per week producing filler, and put prose in front
  // of a learner exactly when there is nothing to report.
  it('returns null and makes no call when there are no findings', async () => {
    const { router, route } = stubRouter(ok(SENTINEL))
    const svc = new CoachingVoiceService(db, router)
    const result = await svc.utteranceFor({ ...base, findings: [] })
    expect(result).toBeNull()
    expect(route).not.toHaveBeenCalled()
  })

  // MUTATION CAUGHT: reporting source:'llm' unconditionally, which would make
  // §8's observable-fallback guarantee a lie and remove the only signal an
  // integration test can assert without touching prose.
  it('reports source llm and caches the utterance on success', async () => {
    const { router, route } = stubRouter(ok(SENTINEL))
    const svc = new CoachingVoiceService(db, router)
    const result = await svc.utteranceFor({ ...base, findings: [leech] })

    expect(result?.source).toBe('llm')
    expect(result?.text).toContain(SENTINEL)
    expect(route).toHaveBeenCalledTimes(1)

    const rows = await db.select().from(schema.buddySessionUtterances)
      .where(eq(schema.buddySessionUtterances.userId, USER))
    expect(rows).toHaveLength(1)
    expect(rows[0].providerName).toBe('groq')
  })

  // MUTATION CAUGHT: reading the cache but never consulting it before routing
  // — the "Buddy says something different every time you look" defect §6
  // exists to prevent, and the one that makes the cost claim (one call per
  // learner per week) false.
  it('serves the second call from cache without routing again', async () => {
    const { router, route } = stubRouter(ok(SENTINEL))
    const svc = new CoachingVoiceService(db, router)
    const first = await svc.utteranceFor({ ...base, findings: [leech] })
    const second = await svc.utteranceFor({ ...base, findings: [leech] })

    expect(second?.text).toBe(first?.text)
    expect(second?.source).toBe('llm')
    expect(route).toHaveBeenCalledTimes(1)
  })

  // MUTATION CAUGHT: letting BuddyLLMError escape. §9 requires every failure
  // to land on the template — the property that slice 3 cannot regress the
  // weekly session, because its worst case is today's session plus slice 2's
  // findings.
  it('falls back to the template when the router throws', async () => {
    const { router } = stubRouter(async () => { throw new BuddyLLMError('capped') })
    const svc = new CoachingVoiceService(db, router)
    const result = await svc.utteranceFor({ ...base, findings: [leech] })

    expect(result?.source).toBe('template')
    expect(result?.text).toContain('OPENER_TEXT')
    expect(result?.text).toContain('RECKON_TEXT')
  })

  // MUTATION CAUGHT: caching the fallback. A transient outage would then
  // freeze a degraded session for the rest of the period, and the next open
  // would never retry.
  it('does not cache a template fallback', async () => {
    const { router } = stubRouter(async () => { throw new BuddyLLMError('capped') })
    const svc = new CoachingVoiceService(db, router)
    await svc.utteranceFor({ ...base, findings: [leech] })

    const rows = await db.select().from(schema.buddySessionUtterances)
      .where(eq(schema.buddySessionUtterances.userId, USER))
    expect(rows).toHaveLength(0)
  })

  // MUTATION CAUGHT: treating an empty or whitespace-only completion as
  // success. §9 lists it as a failure mode; without this the learner gets a
  // blank session card and every other test still passes.
  it('falls back when the model returns nothing usable', async () => {
    for (const content of ['', '   \n  ']) {
      await db.delete(schema.buddySessionUtterances)
        .where(eq(schema.buddySessionUtterances.userId, USER))
      const { router } = stubRouter(ok(content))
      const svc = new CoachingVoiceService(db, router)
      const result = await svc.utteranceFor({ ...base, findings: [leech] })
      expect(result?.source).toBe('template')
    }
  })

  // MUTATION CAUGHT: dropping the length bound, letting a runaway completion
  // become the whole session screen.
  it('falls back when the model runs long', async () => {
    const { router } = stubRouter(ok('x'.repeat(5000)))
    const svc = new CoachingVoiceService(db, router)
    const result = await svc.utteranceFor({ ...base, findings: [leech] })
    expect(result?.source).toBe('template')
  })

  // MUTATION CAUGHT: filtering mechanics_explainer out of the prompt (Task 2)
  // and then forgetting to append it, which would delete the one finding whose
  // purpose is building trust.
  it('appends the mechanics explainer verbatim after the composed utterance', async () => {
    const { router } = stubRouter(ok(SENTINEL))
    const svc = new CoachingVoiceService(db, router)
    const result = await svc.utteranceFor({ ...base, findings: [leech, mechanics] })

    expect(result?.source).toBe('llm')
    expect(result?.text.startsWith(SENTINEL)).toBe(true)
    expect(result?.text).toContain('statistical technique called IRT')
  })

  // MUTATION CAUGHT: calling the router when the ONLY finding is the one kind
  // it may never voice — a paid call with an empty finding list.
  it('does not route when mechanics_explainer is the only finding', async () => {
    const { router, route } = stubRouter(ok(SENTINEL))
    const svc = new CoachingVoiceService(db, router)
    const result = await svc.utteranceFor({ ...base, findings: [mechanics] })

    expect(route).not.toHaveBeenCalled()
    expect(result?.source).toBe('template')
    expect(result?.text).toContain('statistical technique called IRT')
  })

  // MUTATION CAUGHT: requesting tier 3 by forcing userOptedInPremium, or
  // landing on the wrong context string, either of which reverses §5's
  // routing without changing any visible output.
  it('routes on the coaching_utterance context and does not force premium', async () => {
    const { router, route } = stubRouter(ok(SENTINEL))
    const svc = new CoachingVoiceService(db, router)
    await svc.utteranceFor({ ...base, findings: [leech] })

    const request = route.mock.calls[0][0] as Record<string, unknown>
    expect(request.context).toBe('coaching_utterance')
    expect(request.userId).toBe(USER)
    expect(request.userOptedInPremium).toBeUndefined()
  })

  // MUTATION CAUGHT: passing the unfiltered findings into buildCoachingPrompt
  // at the call site. Task 2 also filters internally, so this asserts the
  // property end to end from the service the route actually uses.
  it('never sends the mechanics explainer to the router', async () => {
    const { router, route } = stubRouter(ok(SENTINEL))
    const svc = new CoachingVoiceService(db, router)
    await svc.utteranceFor({ ...base, findings: [leech, mechanics] })

    const sent = JSON.stringify(route.mock.calls[0][0])
    expect(sent).not.toContain('mechanics_explainer')
    expect(sent).not.toContain('IRT')
  })

  // MUTATION CAUGHT: letting a cache-write failure escape. §9's last row says
  // "return the utterance anyway; log" — a lost write costs one extra call on
  // the next open, while a thrown error costs the whole coaching surface. The
  // unknown user id makes the FK to user_profiles reject the insert for real,
  // rather than mocking the failure the assertion is about.
  it('returns the utterance even when the cache write fails', async () => {
    const { router } = stubRouter(ok(SENTINEL))
    const svc = new CoachingVoiceService(db, router)
    const result = await svc.utteranceFor({
      ...base,
      userId: '00000000-0000-0000-0000-0000000000ff', // no such profile
      findings: [leech],
    })

    expect(result?.source).toBe('llm')
    expect(result?.text).toContain(SENTINEL)
  })

  // MUTATION CAUGHT: calling analysisBody(findings) without `now`. copy.ts:62
  // reads `if (!now || days >= ESCALATE_AFTER_DAYS)`, so dropping the argument
  // appends "this has been true for a while now" to EVERY finding carrying a
  // `since`, however recent — silently, with no other test failing. `leech`
  // was first seen 2026-07-12 and NOW is 2026-08-03: 22 days, so pick a
  // finding inside the 21-day window to make the two paths differ.
  it('does not escalate a recent finding in the template fallback', async () => {
    const { router } = stubRouter(async () => { throw new BuddyLLMError('capped') })
    const svc = new CoachingVoiceService(db, router)
    const recent: Finding = { ...leech, since: '2026-08-01' }
    const result = await svc.utteranceFor({ ...base, findings: [recent] })

    expect(result?.source).toBe('template')
    expect(result?.text).not.toContain('been true for a while now')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @kanji-learn/api test -- test/integration/coaching-voice.test.ts
```

Expected: FAIL — `Cannot find module '../../src/services/buddy/coaching-voice.service'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/services/buddy/coaching-voice.service.ts`:

```ts
// apps/api/src/services/buddy/coaching-voice.service.ts
//
// Analysis mode's one moving part (slice 3 §§6, 9). Cache read → prompt →
// route → validate → cache write, with the template as the floor under every
// failure.
//
// THE PROPERTY WORTH PROTECTING: this can never regress the weekly session,
// because its worst case is exactly the session as it ships today with slice
// 2's findings appended. An LLM outage degrades the conversation and never the
// record — the notebook entry is written by CoachingService and is not touched
// here (§2).
//
// It never throws. The caller's job is to render a session; a coaching failure
// is not a reason to fail that.

import { and, eq } from 'drizzle-orm'
import { buddySessionUtterances } from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import { analysisBody, templateCopy, type Finding } from '@kanji-learn/shared'
import type { BuddyLLMRouter } from '../llm/router'
import { buildCoachingPrompt, partitionForVoice } from './coaching-prompt'

export interface CoachingVoice {
  text: string
  /** Part of the response, not logs only (§8): it makes the fallback
   *  observable from the client, and it is what an integration test asserts to
   *  prove the template path ran without asserting any prose. */
  source: 'llm' | 'template'
}

/**
 * Sanity bound on model output (§9). Four or five sentences is ~400 chars; this
 * is generous headroom that still stops a runaway completion becoming the whole
 * session screen.
 */
export const MAX_UTTERANCE_CHARS = 1500

/** Enough for four or five sentences, not enough for an essay. */
const MAX_TOKENS = 400

/**
 * Lower than meeting-prompt's 0.7. The learner is being told true things about
 * their own progress, and the failure mode that matters is an invented number,
 * not a flat sentence.
 */
const TEMPERATURE = 0.4

export class CoachingVoiceService {
  constructor(
    private readonly db: Db,
    private readonly llm: Pick<BuddyLLMRouter, 'route'>,
  ) {}

  async utteranceFor(input: {
    userId: string
    weekStart: string
    openerKind: string
    openerText: string
    reckon: string | null
    findings: readonly Finding[]
    now: string
    log?: { error: (obj: object, msg: string) => void }
  }): Promise<CoachingVoice | null> {
    // §2's common case, stated explicitly because it is the COMMON one: most
    // weeks have no materially new finding. No call, no voice field, and the
    // client renders opener + reckon exactly as it does today.
    if (input.findings.length === 0) return null

    const cached = await this.readCache(input.userId, input.weekStart)
    // A cache hit always implies 'llm' — fallbacks are deliberately not cached,
    // so a transient outage cannot freeze a degraded session for the period.
    if (cached !== null) return { text: cached, source: 'llm' }

    const { spoken, mechanics } = partitionForVoice(input.findings)
    const template = this.templateText(input)

    // Nothing the LLM is permitted to voice. Routing would spend a call on an
    // empty finding list.
    if (spoken.length === 0) return { text: template, source: 'template' }

    let content: string
    let providerName: string
    try {
      const result = await this.llm.route({
        context: 'coaching_utterance',
        userId: input.userId,
        // userOptedInPremium is deliberately UNSET. tutor-analysis.service.ts
        // forces it true to bypass the premium gate; §5 wants the opposite
        // here — opted-in learners get Claude, everyone else falls through to
        // tier 2 with no branching at this call site.
        messages: [{ role: 'user', content: buildCoachingPrompt({
          openerKind: input.openerKind,
          openerText: input.openerText,
          reckon: input.reckon,
          findings: spoken,
        }) }],
        maxTokens: MAX_TOKENS,
        temperature: TEMPERATURE,
      })
      content = (result.content ?? '').trim()
      providerName = result.providerName
    } catch (err) {
      // BuddyLLMError (tier-2 cap, both tier-2 providers down) and anything
      // else land in the same place, by design (§9).
      input.log?.error({ err, userId: input.userId }, '[CoachingVoice] router failed; using template')
      return { text: template, source: 'template' }
    }

    if (content === '' || content.length > MAX_UTTERANCE_CHARS) {
      input.log?.error(
        { userId: input.userId, length: content.length },
        '[CoachingVoice] unusable completion; using template',
      )
      return { text: template, source: 'template' }
    }

    // §4: the explainer is appended AFTER the composed utterance, never sent
    // to the model. The visible seam between warm prose and fixed copy is the
    // accepted cost — it IS a different kind of statement.
    const text = mechanics === null
      ? content
      : `${content}\n\n${templateCopy(mechanics, input.now)}`

    // Cache the COMPOSED text, so a hit returns byte-for-byte what the first
    // open returned.
    try {
      await this.db.insert(buddySessionUtterances).values({
        userId: input.userId,
        weekStart: input.weekStart,
        text,
        providerName,
      })
    } catch (err) {
      // §9: return the utterance anyway. A lost cache write costs one extra
      // call on the next open; failing the session costs the session.
      input.log?.error({ err, userId: input.userId }, '[CoachingVoice] cache write failed')
    }

    return { text, source: 'llm' }
  }

  /**
   * §9's floor: today's surface plus slice 2's prose.
   *
   * ⚠️ `now` is passed to analysisBody deliberately. copy.ts:62 reads
   * `if (!now || days >= ESCALATE_AFTER_DAYS)`, so dropping it escalates every
   * finding that carries a `since` regardless of age — silently, with nothing
   * else failing.
   */
  private templateText(input: {
    openerText: string
    reckon: string | null
    findings: readonly Finding[]
    now: string
  }): string {
    return [input.openerText, input.reckon, analysisBody(input.findings, input.now)]
      .filter((part): part is string => part !== null && part !== '')
      .join('\n\n')
  }

  private async readCache(userId: string, weekStart: string): Promise<string | null> {
    const rows = await this.db
      .select({ text: buddySessionUtterances.text })
      .from(buddySessionUtterances)
      .where(and(
        eq(buddySessionUtterances.userId, userId),
        eq(buddySessionUtterances.weekStart, weekStart),
      ))
      .limit(1)
    return rows[0]?.text ?? null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @kanji-learn/api test -- test/integration/coaching-voice.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/buddy/coaching-voice.service.ts apps/api/test/integration/coaching-voice.test.ts && git commit -m "feat(coaching): CoachingVoiceService — cached utterance, template floor under every failure"
```

---

## Task 5: Wire the voice into the `due` branch

**Files:**
- Modify: `apps/api/src/routes/buddy-session.ts:105-120`
- Test: `apps/api/test/integration/buddy-session-voice.test.ts`

**Interfaces:**
- Consumes: `CoachingVoiceService` (Task 4); `CoachingService.refresh` (already
  imported at `buddy-session.ts:24`).
- Produces: `GET /v1/buddy/session` on `state: 'due'` returns
  `voice?: { text: string; source: 'llm' | 'template' }` — **present only when
  there are findings**, absent otherwise. `opener`, `reckon`,
  `currentCommitment` and `proposedCommitment` are unchanged.

**`force: true` is not optional here.** `RefreshResult.written: 'skipped'` is
overloaded across three outcomes, and the staleness-gated path returns
`findings: []` while a live entry full of findings sits in the database (§7). An
unforced read would render an empty coaching state on every gated call.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/integration/buddy-session-voice.test.ts`:

```ts
// GET /v1/buddy/session — the additive `voice` field (slice 3 §§7, 8).
//
// This learner has no placement, no reviews and no commitment history, so
// analyze() yields nothing: the assertion is that the route stays exactly as it
// was, which is §2's common case and the backward-compatibility guarantee of §8.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { buildTestAppWith } from '../helpers/test-app'
import { buddySessionRoutes } from '../../src/routes/buddy-session'
import { BuddyLLMError } from '../../src/services/llm/types'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })

const USER = '00000000-0000-0000-0000-0000000000c3'
let app: Awaited<ReturnType<typeof buildTestAppWith>>

beforeAll(async () => {
  // The default test app's buddyLLM throws BuddyLLMError on every route() —
  // exactly the outage §9 must survive. Stated explicitly rather than relied
  // on implicitly, so this file still means what it says if the helper's
  // default changes.
  app = await buildTestAppWith(
    { buddyLLM: { route: async () => { throw new BuddyLLMError('stubbed outage') } } },
    { plugin: buddySessionRoutes, opts: { prefix: '/v1/buddy/session' } },
  )
  await db.insert(schema.userProfiles)
    .values({ id: USER, displayName: 'Voice Route Fixture', timezone: 'America/Los_Angeles' })
    .onConflictDoUpdate({
      target: schema.userProfiles.id,
      set: { timezone: 'America/Los_Angeles' },
    })
})

beforeEach(async () => {
  await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, USER))
  await db.delete(schema.notebookEntries).where(eq(schema.notebookEntries.userId, USER))
  await db.delete(schema.buddySessionUtterances)
    .where(eq(schema.buddySessionUtterances.userId, USER))
  const weekday = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
  ).getDay()
  await db.update(schema.userProfiles)
    .set({ buddyDay: weekday, buddyIntervalWeeks: 1 })
    .where(eq(schema.userProfiles.id, USER))
})

afterAll(async () => {
  await db.delete(schema.buddyCommitments).where(eq(schema.buddyCommitments.userId, USER))
  await db.delete(schema.notebookEntries).where(eq(schema.notebookEntries.userId, USER))
  await db.delete(schema.buddySessionUtterances)
    .where(eq(schema.buddySessionUtterances.userId, USER))
  await db.delete(schema.userProfiles).where(eq(schema.userProfiles.id, USER))
  await app.close()
  await client.end()
})

function get() {
  return app.inject({
    method: 'GET',
    url: '/v1/buddy/session',
    headers: { 'x-test-user-id': USER },
  })
}

describe('GET /v1/buddy/session — voice', () => {
  // MUTATION CAUGHT: replacing opener/reckon with `voice` instead of adding
  // alongside them. §8 requires an old client to keep working; a shipped
  // surface would break on deploy, before anyone rebuilt the app.
  it('keeps opener and proposedCommitment in the payload', async () => {
    const res = await get()
    const data = res.json().data
    expect(res.statusCode).toBe(200)
    expect(data.state).toBe('due')
    expect(typeof data.opener.text).toBe('string')
    expect(data.proposedCommitment).toBeDefined()
  })

  // MUTATION CAUGHT: emitting `voice: null` or an empty-text voice when there
  // is nothing to say. §2 requires the field to be ABSENT — the client's
  // preference rule keys off its presence, and a null would spend a tier-3
  // call per learner per week to produce filler if the guard were dropped
  // upstream.
  it('omits voice entirely when the analyzer finds nothing', async () => {
    const data = (await get()).json().data
    expect(data.voice).toBeUndefined()
  })

  // MUTATION CAUGHT: letting a coaching failure escape the try/catch and 500
  // the session. Agreeing the week ahead is the session's one guaranteed
  // outcome; this route must degrade, never fail. Also proves the LLM outage
  // stubbed above does not reach the client as an error.
  it('still serves a due session with the LLM stubbed to throw', async () => {
    const res = await get()
    expect(res.statusCode).toBe(200)
    expect(res.json().data.state).toBe('due')
  })
})
```

> **Note for the implementer — a deliberate deviation from §10.** The spec's
> API-integration row asks for *"a second `due` GET returns identical text with
> no second router call"*. This fixture cannot reach it honestly: a learner
> rich enough for `analyze()` to fire needs placement sessions, difficulty rows
> and review logs, so at route level `voice` is correctly absent and there is
> no text to compare. **Task 4 proves exactly that property** — `serves the
> second call from cache without routing again` — against the service the route
> calls, one layer down. Do **not** fake a finding by stubbing
> `CoachingService` here; that would test the stub. The three cases above cover
> what this level genuinely owns: the additive payload, the absent field, and
> never-500.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @kanji-learn/api test -- test/integration/buddy-session-voice.test.ts
```

Expected: FAIL on `omits voice entirely` only if the field is wrongly added;
initially the first two pass and the third passes — **this file is a
regression net, so confirm it goes red by temporarily returning
`voice: null` unconditionally in the route, seeing case 2 fail, then reverting.**
Record that you did this.

- [ ] **Step 3: Write the implementation**

In `apps/api/src/routes/buddy-session.ts`, add the import alongside the existing
service imports (after line 24):

```ts
import { CoachingVoiceService } from '../services/buddy/coaching-voice.service.js'
```

and instantiate it beside the others at the top of `buddySessionRoutes`
(after line 52, `const notebook = new NotebookService(server.db)`):

```ts
  const coaching = new CoachingService(server.db)
  const voiceService = new CoachingVoiceService(server.db, server.buddyLLM)
```

Then replace the block from `const proposed = …` (line 108) through the closing
`})` of the reply (line 120) with:

```ts
    const proposed = await service.ensureForWeek(req.userId!, state.weekStart)

    // Computed once and reused by both the voice input and the reply — the
    // two must be the same string, and openerCopy reads `check`, so calling it
    // twice invites them to drift if either call site is edited later.
    const openerText = openerCopy(openerKind, check)

    // Analysis mode (slice 3). `force: true` is required, not defensive:
    // RefreshResult.written 'skipped' is overloaded across three outcomes, and
    // the staleness-gated path returns findings: [] while a live entry full of
    // findings sits in the database — an unforced read would render an empty
    // coaching state on every gated call (§7).
    //
    // refresh() also WRITES. Under slice 2's rules an unchanged selection
    // updates the row in place (only analyzedAt moves), so repeated opens on
    // the same Buddy day do not grow the superseded chain.
    //
    // Everything here is best-effort: agreeing the week ahead is the session's
    // one guaranteed outcome and must not be lost to a coaching failure. Same
    // guard as the notebook write below.
    let voice: { text: string; source: 'llm' | 'template' } | null = null
    try {
      const { findings } = await coaching.refresh(req.userId!, {
        force: true,
        now: now.toISOString(),
      })
      voice = await voiceService.utteranceFor({
        userId: req.userId!,
        weekStart: state.weekStart,
        openerKind,
        openerText,
        reckon,
        findings,
        // The SAME clock the refresh ran on, so the template floor's escalation
        // window and the analysis agree.
        now: now.toISOString(),
        log: req.log,
      })
    } catch (err) {
      req.log.error({ err, userId: req.userId }, '[BuddySession] coaching voice failed')
    }

    return reply.send({
      ok: true,
      data: {
        state: 'due',
        weekStart: state.weekStart,
        opener: { kind: openerKind, text: openerText },
        reckon,
        currentCommitment: previous,
        proposedCommitment: proposed,
        // Additive and CONDITIONAL (§§2, 8). Absent — not null — when there is
        // nothing to say: the client's preference rule keys off presence.
        ...(voice ? { voice } : {}),
      },
    })
```

Also replace the existing `new CoachingService(server.db).refresh(...)` call in
the POST handler (line 168) with the hoisted instance:

```ts
      await coaching.refresh(req.userId!, { force: true })
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @kanji-learn/api test -- test/integration/buddy-session-voice.test.ts test/integration/buddy-session-route.test.ts test/integration/coaching-triggers.test.ts
```

Expected: PASS. `buddy-session-route.test.ts` and `coaching-triggers.test.ts`
must stay green — they cover the surface this task modifies.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/buddy-session.ts apps/api/test/integration/buddy-session-voice.test.ts && git commit -m "feat(coaching): the due session carries Buddy's composed utterance"
```

---

## Task 6: The mobile card reducer

**Files:**
- Modify: `apps/mobile/src/lib/buddy-session-state.ts:10-25` (`SessionData`),
  `:27-30` (`SessionCard`), `:56-72` (the `due` case)
- Test: `apps/mobile/test/unit/buddy-session-state.test.ts` (append)

**Interfaces:**
- Consumes: the `voice` field from Task 5.
- Produces: `SessionCard` gains `{ kind: 'voice'; text: string }`.
  `SessionData`'s `due` variant gains
  `voice?: { text: string; source: 'llm' | 'template' } | null`.

**Do not touch `BuddySessionBody.tsx`.** Its `renderBody` narrows out `'set'`
and renders `<Text>{card.text}</Text>` for everything else
(`BuddySessionBody.tsx:95-99`); `voice` carries `text`, so it renders and
typechecks with no change.

This is the reducer the pure lane owns — mirror `useCoCreation.reducer`, run it
with `--runInBand`, and note that **the visual result still needs an EAS build
to be seen**, even though the logic does not.

- [ ] **Step 1: Write the failing test**

Append to `apps/mobile/test/unit/buddy-session-state.test.ts`:

```ts
const dueBase = {
  state: 'due' as const,
  weekStart: '2026-08-03',
  opener: { kind: 'strong', text: 'OPENER' },
  reckon: 'RECKON',
  proposedCommitment: proposed,
}

describe('selectSessionBody — the composed utterance', () => {
  // MUTATION CAUGHT: appending the voice card to opener/reckon instead of
  // replacing them. §3's whole point is one voice, not three stitched
  // fragments — and the learner would read the same content twice.
  it('renders one voice card instead of opener and reckon', () => {
    const body = selectSessionBody({
      hasLoaded: true,
      error: null,
      data: { ...dueBase, voice: { text: 'COMPOSED', source: 'llm' } },
    })
    expect(body.kind).toBe('cards')
    const kinds = body.kind === 'cards' ? body.cards.map((c) => c.kind) : []
    expect(kinds).toEqual(['voice', 'set'])
  })

  // MUTATION CAUGHT: keying the preference off `'voice' in data` rather than a
  // usable value, so an old server (no field) or a null would render a session
  // with no prose at all — the B-227 blank-screen shape this file already
  // guards elsewhere.
  it('falls back to opener and reckon when there is no voice', () => {
    for (const data of [dueBase, { ...dueBase, voice: null }]) {
      const body = selectSessionBody({ hasLoaded: true, error: null, data })
      const kinds = body.kind === 'cards' ? body.cards.map((c) => c.kind) : []
      expect(kinds).toEqual(['opener', 'reckon', 'set'])
    }
  })

  // MUTATION CAUGHT: trusting a present-but-empty voice.text, which would
  // render a blank card and suppress the template prose that was available
  // the whole time.
  it('falls back when the voice text is blank', () => {
    const body = selectSessionBody({
      hasLoaded: true,
      error: null,
      data: { ...dueBase, voice: { text: '   ', source: 'llm' } },
    })
    const kinds = body.kind === 'cards' ? body.cards.map((c) => c.kind) : []
    expect(kinds).toEqual(['opener', 'reckon', 'set'])
  })

  // MUTATION CAUGHT: dropping the 'set' card on the voice path. Agreeing the
  // week ahead is the session's one guaranteed outcome and is unconditional
  // and always last, whatever precedes it.
  it('keeps the set card last on the voice path', () => {
    const body = selectSessionBody({
      hasLoaded: true,
      error: null,
      data: { ...dueBase, voice: { text: 'COMPOSED', source: 'llm' } },
    })
    const cards = body.kind === 'cards' ? body.cards : []
    expect(cards[cards.length - 1].kind).toBe('set')
  })

  // MUTATION CAUGHT: rendering `source` into the card, leaking an internal
  // observability field onto the learner's screen.
  it('carries only the text on the voice card', () => {
    const body = selectSessionBody({
      hasLoaded: true,
      error: null,
      data: { ...dueBase, voice: { text: 'COMPOSED', source: 'template' } },
    })
    const card = body.kind === 'cards' ? body.cards[0] : null
    expect(card).toEqual({ kind: 'voice', text: 'COMPOSED' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @kanji-learn/mobile test -- --runInBand -t "composed utterance"
```

Expected: FAIL — TypeScript rejects `voice` on the `due` variant.

- [ ] **Step 3: Write minimal implementation**

In `apps/mobile/src/lib/buddy-session-state.ts`, add to the `due` variant of
`SessionData` (after `reckon: string | null`, line 15):

```ts
      // Slice 3 §8: additive and optional. Absent on an older server, and
      // absent by design on the common week where the analyzer found nothing.
      voice?: { text: string; source: 'llm' | 'template' } | null
```

Add the card kind:

```ts
export type SessionCard =
  | { kind: 'voice'; text: string }
  | { kind: 'opener'; text: string }
  | { kind: 'reckon'; text: string }
  | { kind: 'set'; proposed: SessionCommitment }
```

Replace the body of `case 'due':` (lines 58-71) with:

```ts
    case 'due': {
      const cards: SessionCard[] = []

      // Slice 3 §3: ONE utterance, not three. The server composes opener,
      // reckoning and findings into a single thing Buddy says, so the voice
      // card REPLACES opener/reckon rather than joining them.
      //
      // Guarded on usable text, not on the key's presence: an older server
      // omits it, a null is a valid payload, and a blank string would render
      // an empty card while suppressing prose that was available all along —
      // the B-227 shape this file already guards above.
      const voice = input.data.voice
      if (voice && voice.text.trim() !== '') {
        cards.push({ kind: 'voice', text: voice.text })
      } else {
        cards.push({ kind: 'opener', text: input.data.opener.text })
        if (input.data.reckon !== null) {
          cards.push({ kind: 'reckon', text: input.data.reckon })
        }
      }

      // The 'set' card is unconditional and always last: agreeing the coming
      // week is the session's one guaranteed outcome, so it survives a learner
      // who bails early and is never displaced by anything above it.
      cards.push({ kind: 'set', proposed: input.data.proposedCommitment })

      return { kind: 'cards', cards }
    }
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @kanji-learn/mobile test -- --runInBand
```

Expected: PASS — the whole pure lane, including the pre-existing
`selectSessionBody` cases, which must stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/buddy-session-state.ts apps/mobile/test/unit/buddy-session-state.test.ts && git commit -m "feat(mobile): render Buddy's composed utterance as one session card"
```

---

## Final verification

- [ ] **Rebuild the local test database**, then run the API suite in full. A
      stale one reads ~5 extra failures and sends you chasing regressions that
      do not exist —
      https://github.com/radmelon/kanji-learn/blob/main/docs/local-build-and-test-protocol.md

```bash
pnpm --filter @kanji-learn/api test
```

- [ ] **Shared lane** — unchanged by this slice, so this is a regression check:

```bash
pnpm --filter @kanji-learn/shared test
```

- [ ] **Mobile, both lanes:**

```bash
pnpm --filter @kanji-learn/mobile test -- --runInBand && pnpm --filter @kanji-learn/mobile test:components
```

- [ ] **Typecheck and build the API** — the route and service cross package
      boundaries and `@kanji-learn/db` must re-export the new table:

```bash
pnpm --filter @kanji-learn/api build
```

## Deploy — and how to verify it, for real

Two things are required, per
https://github.com/radmelon/kanji-learn/blob/main/docs/SOP.md. A status code is
not one of them.

1. **Migration 0035 applied to live** before the API rolls out. The route reads
   `buddy_session_utterances` on every due session; without the table the read
   throws, the try/catch swallows it, and every learner silently gets the
   template forever — a failure with no symptom.
2. **An App Runner operation dated today**, and **response content**:

   **The canary is `data.voice` on `GET /v1/buddy/session`** for a learner whose
   session is due and who has findings. It cannot be checked unauthenticated,
   exactly as slice 2's content check could not — have learner
   `b8503589-1695-4659-b69d-b9e77d1cf655` open the session on their Buddy day
   and confirm one composed card rather than two.

   A cheaper independent signal, once anyone has hit it:

```bash
./scripts/with-live-db.sh psql -c "SELECT provider_name, left(text, 80), created_at FROM buddy_session_utterances ORDER BY created_at DESC LIMIT 5"
```

## The cost measurement §11 asks for

Spec §11 lists "the §11.3 cap number" as out of scope but says **this slice
produces the measurement it needs**. No extra instrumentation is required —
`BuddyLLMRouter.callProvider` already writes token counts per request context:

```bash
./scripts/with-live-db.sh psql -c "SELECT tier, provider_name, count(*) AS calls, round(avg(input_tokens)) AS in_avg, round(avg(output_tokens)) AS out_avg, round(avg(latency_ms)) AS ms FROM buddy_llm_telemetry WHERE request_context = 'coaching_utterance' GROUP BY 1, 2 ORDER BY 1, 2"
```

Read it a fortnight after rollout, not on day one — one call per learner per
week means the sample builds slowly, which is the point.

---

## Notes for whoever picks this up

**The copy floor and this slice overlap on `Evidence`, and neither blocks the
other.** The 2026-08-03 handoff sequences the coaching copy floor before slice
3. That ordering is about output quality, not compilation: this slice consumes
`Evidence` generically (Task 2 serialises `label: value` for whatever is there)
and its fallback calls `analysisBody`, so it builds and passes against today's
copy layer.

Two consequences worth holding onto:

- **The template fallback inherits the copy floor's quality, whenever it
  lands.** Until then, §9's floor is the copy the owner called *"less than zero
  value"*. The LLM path is better than the fallback from day one — because
  unlike `templateCopy`, the prompt actually reads `finding.evidence`.
- **The dead Profile pointer fixes itself here.** Task 4 appends
  `templateCopy(mechanics, now)` verbatim, so when the copy floor removes the
  *"There is a fuller explanation in your Profile"* sentence — currently live
  and pointing at a page scheduled for slice 5 — this slice picks up the fix
  with no change.

If the copy floor lands first, nothing in this plan changes. If this lands
first, the copy floor's per-kind formatters improve the fallback without
touching any file listed above.
