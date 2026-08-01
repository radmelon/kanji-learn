# Buddy's Home — the shared notebook: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Journal tab into Buddy's home — a living document holding the agreement, experiments, observations, settled decisions, tutor notes and hooks, jointly authored by learner and Buddy.

**Architecture:** The notebook is mostly a **projection** over tables that already exist (`buddy_commitments`, `mnemonics`, `tutor_notes`), plus one new table `notebook_entries` for prose. Assembly is a pure function in `packages/shared` with no database in it. Editing is superseding, matching `buddy_commitments`' existing current-plus-archive model.

**Tech Stack:** Postgres/Supabase + drizzle-orm, Fastify + Zod (API), Expo/React Native + zustand (mobile), vitest (shared/API), jest + jest-expo (mobile).

**Spec:** https://github.com/radmelon/kanji-learn/blob/main/docs/superpowers/specs/2026-07-31-buddy-home-notebook-design.md

## Global Constraints

Every task's requirements implicitly include this section.

- **Every `<Text>` must carry an explicit `color`.** B146 shipped a screen that rendered correctly and was invisible — black default text on `colors.bg` (`#0F0F1A`). Component tests assert colour on every Text rendering a string, using the `legibleTextNodes()` helper already in `apps/mobile/test/components/BuddySessionBody.test.tsx`.
- **Any screen reachable from a push must have an in-screen exit.** Routes are registered `headerShown: false`. Use `router.canGoBack() ? router.back() : router.replace('/(tabs)')` — a push opens a screen from a killed app with no back stack.
- **`z.object()` strips unknown keys.** Every request schema enumerates every field the client sends, and every write test must **read the value back**, never assert only on a 200. This has cost this project four inert features once and recurred as Task 11 on the weekly-review branch.
- **New tables get `ENABLE` *and* `FORCE` row level security** plus both the authenticated-user and service-role policies. `apps/api/test/integration/rls-coverage.test.ts` asserts both.
- **Every guard is demonstrated red** by running the test against the removed rule, not merely by carrying a control assertion.
- **Any threshold or fallback needs a test proving the non-default branch executes.** On 2026-07-31 a placement scale bug reached production because the fitted branch was unreachable from the test database (10 rows against a 300 minimum).
- **Integration fixtures clean up in `afterAll`.** Residue is counted by suites that ask "every user with progress" — `backfill.test.ts` flipped to failing on exactly that.
- **Mobile has two lanes.** Pure: `pnpm --filter @kanji-learn/mobile test -- --runInBand`. Component: `pnpm --filter @kanji-learn/mobile test:components`. Pure logic goes in `src/lib/` with a test in `test/unit/`.
- **API integration tests authenticate with a bare `x-test-user-id` header** via `test/helpers/test-app.ts`. There is no `auth.ts` helper.
- **Rebuild the local test DB before judging API results:** https://github.com/radmelon/kanji-learn/blob/main/docs/local-test-db.md
- **Known-failure baseline is 2, enumerated:** `learner-state-refresh` (intermittent `setImmediate`/50ms race) and `rls-coverage` (seven legacy tables). Never report a count without the names.

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/supabase/migrations/0032_notebook.sql` | new table, tutor columns, drops dead Study Log |
| `packages/db/src/schema.ts` | drizzle definitions |
| `packages/shared/src/notebook/types.ts` | `NotebookView`, `NotebookSection`, `NotebookEntry` |
| `packages/shared/src/notebook/assemble.ts` | `assembleNotebook` — pure, no DB |
| `packages/shared/src/buddy/tutor-constraint.ts` | `checkTutorConstraint` — pure, no model call |
| `apps/api/src/services/notebook.service.ts` | projection + entry CRUD |
| `apps/api/src/routes/notebook.ts` | `/v1/buddy/notebook` routes |
| `apps/mobile/src/stores/notebook.store.ts` | fetch/edit state |
| `apps/mobile/src/components/notebook/NotebookBody.tsx` | the whole visual surface |
| `apps/mobile/src/components/notebook/TutorNote.tsx` | study surface for a tutor note |
| `apps/mobile/app/(tabs)/journal.tsx` | screen shell, renders NotebookBody |

---

### Task 1: Migration and schema

**Files:**
- Create: `packages/db/supabase/migrations/0032_notebook.sql`
- Modify: `packages/db/src/schema.ts`

**Interfaces:**
- Produces: table `notebook_entries`; `tutor_shares.language`, `tutor_notes.language`, `tutor_notes.body_translations`; drizzle exports `notebookEntries`.

- [ ] **Step 1: Write the migration**

```sql
-- Migration 0032: Buddy's home — the shared notebook
-- Run order: 32
--
-- Implements docs/superpowers/specs/2026-07-31-buddy-home-notebook-design.md.
-- Constraints live in DO blocks because Postgres has no ADD CONSTRAINT IF NOT
-- EXISTS; re-running on a partially-migrated database is normal during local
-- provisioning (mirrors migration 0030's header).

BEGIN;

CREATE TABLE IF NOT EXISTS notebook_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  kind           text NOT NULL,
  body           text NOT NULL,
  author         text NOT NULL,
  week_start     date,
  source         jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  superseded_at  timestamptz,
  superseded_by  uuid REFERENCES notebook_entries(id) ON DELETE SET NULL,
  CONSTRAINT notebook_entries_kind_check CHECK (kind IN ('observation', 'decision')),
  CONSTRAINT notebook_entries_author_check CHECK (author IN ('buddy', 'learner'))
);

COMMENT ON TABLE notebook_entries IS
  'Prose sections of the notebook. The agreement, experiments and hooks are PROJECTIONS over buddy_commitments and mnemonics — deliberately not copied here, so one fact has one home (spec §5.1).';
COMMENT ON COLUMN notebook_entries.superseded_by IS
  'Editing is superseding. A learner-authored row superseding a buddy-authored row IS the correction signal slice 2 reads (spec decision #4).';

CREATE INDEX IF NOT EXISTS notebook_entries_user_live_idx
  ON notebook_entries (user_id, kind) WHERE superseded_at IS NULL;

ALTER TABLE public.notebook_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notebook_entries FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notebook_entries'
                 AND policyname='Users manage own notebook_entries') THEN
    CREATE POLICY "Users manage own notebook_entries" ON public.notebook_entries
      FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notebook_entries'
                 AND policyname='Service role can manage notebook_entries') THEN
    CREATE POLICY "Service role can manage notebook_entries" ON public.notebook_entries
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Tutor language. Drives the OUTBOUND report only; notes are never translated
-- by default (spec decision #8).
ALTER TABLE tutor_shares ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
ALTER TABLE tutor_notes  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
ALTER TABLE tutor_notes  ADD COLUMN IF NOT EXISTS body_translations jsonb;

COMMENT ON COLUMN tutor_notes.body_translations IS
  'Cache, populated ONLY when a learner explicitly asks. Never on write, never on read — a tutor may write in Japanese deliberately, to be read.';

-- The old Phase 6 (photo/audio/mood scrapbook) is replaced, not revised.
-- Zero rows and zero consumers on 2026-07-31.
DROP TABLE IF EXISTS study_log_entries;
DROP TYPE IF EXISTS study_log_mood;

COMMIT;
```

- [ ] **Step 2: Apply it to the local test database**

Run:
```bash
psql "postgresql://kanji:kanji@localhost:5433/kanji_buddy_test?sslmode=disable" -v ON_ERROR_STOP=1 -f packages/db/supabase/migrations/0032_notebook.sql
```
Expected: `BEGIN … CREATE TABLE … COMMIT`, no errors.

- [ ] **Step 3: Add the drizzle definitions**

In `packages/db/src/schema.ts`, **delete** the `studyLogEntries` table and `studyLogMoodEnum`, then add:

```ts
export const notebookEntries = pgTable(
  'notebook_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    body: text('body').notNull(),
    author: text('author').notNull(),
    weekStart: date('week_start'),
    source: jsonb('source'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    supersededBy: uuid('superseded_by'),
  },
  (t) => ({ userLiveIdx: index('notebook_entries_user_live_idx').on(t.userId, t.kind) })
)
```

Add to `tutorShares`: `language: text('language').notNull().default('en')`.
Add to `tutorNotes`: `language: text('language').notNull().default('en')`, `bodyTranslations: jsonb('body_translations')`.

- [ ] **Step 4: Verify the schema compiles and nothing referenced the dropped table**

Run: `pnpm -r typecheck`
Expected: all four packages `Done`, 0 errors. If `studyLogEntries` is referenced anywhere, the build fails here — the spec asserts zero consumers, so any hit is a surprise worth reporting before continuing.

- [ ] **Step 5: Confirm RLS coverage did not regress**

Run: `pnpm --filter @kanji-learn/api test -- rls-coverage`
Expected: still exactly the 7 known legacy tables. If `notebook_entries` appears in the list, `FORCE` was missed — fix before continuing. This is the failure migration `0030` shipped with.

- [ ] **Step 6: Commit**

```bash
git add packages/db/supabase/migrations/0032_notebook.sql packages/db/src/schema.ts
git commit -m "feat(db): notebook_entries, tutor language columns, drop dead Study Log"
```

---

### Task 2: `assembleNotebook` — the pure assembly

**Files:**
- Create: `packages/shared/src/notebook/types.ts`
- Create: `packages/shared/src/notebook/assemble.ts`
- Test: `packages/shared/src/notebook/assemble.test.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './notebook/assemble'` and `'./notebook/types'`)

**Interfaces:**
- Consumes: nothing.
- Produces: `assembleNotebook(input: NotebookInput): NotebookView`, types `NotebookView`, `NotebookSection`, `NotebookEntry`, `TutorNoteView`.

- [ ] **Step 1: Write the types**

```ts
// packages/shared/src/notebook/types.ts
export type EntryAuthor = 'buddy' | 'learner' | 'tutor'

export interface NotebookEntry {
  id: string
  body: string
  author: EntryAuthor
  createdAt: string
  /** Tutor entries are unsupersedable by anyone else (spec §4). */
  editableBy: EntryAuthor[]
}

export interface CommitmentView {
  weekStart: string
  daysCommitted: number
  minutesPerDay: number
  focus: string | null
  source: 'session' | 'rolled_forward' | 'default'
}

export interface TutorNoteView {
  id: string
  body: string
  language: string
  /** Present only if the learner explicitly asked for one. */
  translation: string | null
  createdAt: string
}

export interface NotebookSection {
  key: 'agreement' | 'experiment' | 'observations' | 'settled' | 'tutor' | 'hooks'
  title: string
  /** Per-share for tutor sections; undefined elsewhere. */
  shareId?: string
  live: NotebookEntry[]
  archived: NotebookEntry[]
}

export interface NotebookView {
  cadence: { intervalWeeks: number; buddyDay: number | null }
  agreement: CommitmentView | null
  pastAgreements: CommitmentView[]
  experiment: CommitmentView | null
  sections: NotebookSection[]
  tutorNotes: { shareId: string; tutorLabel: string; notes: TutorNoteView[] }[]
  isEmpty: boolean
}

export interface NotebookInput {
  cadence: { intervalWeeks: number; buddyDay: number | null }
  commitments: (CommitmentView & { supersededAt: string | null; experimentUntil: string | null })[]
  entries: (NotebookEntry & { kind: 'observation' | 'decision'; supersededAt: string | null })[]
  tutorNotes: { shareId: string; tutorLabel: string; notes: TutorNoteView[] }[]
}
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/shared/src/notebook/assemble.test.ts
import { describe, it, expect } from 'vitest'
import { assembleNotebook } from './assemble'
import type { NotebookInput } from './types'

const base: NotebookInput = {
  cadence: { intervalWeeks: 1, buddyDay: 0 },
  commitments: [], entries: [], tutorNotes: [],
}

const commitment = (weekStart: string, supersededAt: string | null, experimentUntil: string | null = null) => ({
  weekStart, daysCommitted: 4, minutesPerDay: 15, focus: null,
  source: 'session' as const, supersededAt, experimentUntil,
})

const entry = (id: string, kind: 'observation' | 'decision', supersededAt: string | null) => ({
  id, kind, body: `body ${id}`, author: 'buddy' as const,
  createdAt: '2026-08-01T00:00:00Z', editableBy: [] as never[], supersededAt,
})

describe('assembleNotebook', () => {
  it('is empty when nothing has happened yet', () => {
    expect(assembleNotebook(base).isEmpty).toBe(true)
  })

  it('takes the one unsuperseded commitment as the agreement and archives the rest', () => {
    const view = assembleNotebook({
      ...base,
      commitments: [
        commitment('2026-07-20', '2026-07-27T00:00:00Z'),
        commitment('2026-07-27', null),
      ],
    })
    expect(view.agreement?.weekStart).toBe('2026-07-27')
    expect(view.pastAgreements.map((c) => c.weekStart)).toEqual(['2026-07-20'])
  })

  it('surfaces a commitment carrying experimentUntil as the live experiment', () => {
    const view = assembleNotebook({
      ...base,
      commitments: [commitment('2026-07-27', null, '2026-08-03')],
    })
    expect(view.experiment?.weekStart).toBe('2026-07-27')
  })

  it('splits entries into live and archived by section', () => {
    const view = assembleNotebook({
      ...base,
      entries: [
        entry('a', 'observation', null),
        entry('b', 'observation', '2026-07-30T00:00:00Z'),
        entry('c', 'decision', null),
      ],
    })
    const obs = view.sections.find((s) => s.key === 'observations')!
    const settled = view.sections.find((s) => s.key === 'settled')!
    expect(obs.live.map((e) => e.id)).toEqual(['a'])
    expect(obs.archived.map((e) => e.id)).toEqual(['b'])
    expect(settled.live.map((e) => e.id)).toEqual(['c'])
  })

  it('marks buddy entries learner-editable and tutor notes editable by nobody else', () => {
    const view = assembleNotebook({
      ...base,
      entries: [entry('a', 'observation', null)],
      tutorNotes: [{
        shareId: 's1', tutorLabel: 'Ono Kumiko',
        notes: [{ id: 'n1', body: 'がんばって', language: 'ja', translation: null, createdAt: '2026-08-01T00:00:00Z' }],
      }],
    })
    const obs = view.sections.find((s) => s.key === 'observations')!
    expect(obs.live[0].editableBy).toContain('learner')

    const tutor = view.sections.find((s) => s.key === 'tutor')!
    expect(tutor.shareId).toBe('s1')
    expect(tutor.live[0].editableBy).toEqual(['tutor'])
  })

  it('omits the tutor section entirely when there is no accepted share', () => {
    const view = assembleNotebook(base)
    expect(view.sections.find((s) => s.key === 'tutor')).toBeUndefined()
  })

  it('emits one tutor section per share so two tutors never merge', () => {
    const view = assembleNotebook({
      ...base,
      tutorNotes: [
        { shareId: 's1', tutorLabel: 'Ono Kumiko', notes: [] },
        { shareId: 's2', tutorLabel: 'Alex', notes: [] },
      ],
    })
    expect(view.sections.filter((s) => s.key === 'tutor').map((s) => s.shareId)).toEqual(['s1', 's2'])
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @kanji-learn/shared test -- notebook`
Expected: FAIL — `Cannot find module './assemble'`.

- [ ] **Step 4: Implement**

```ts
// packages/shared/src/notebook/assemble.ts
import type { NotebookInput, NotebookSection, NotebookView } from './types'

const TITLES = {
  observations: 'What Buddy notices',
  settled: "What we've settled",
} as const

export function assembleNotebook(input: NotebookInput): NotebookView {
  const live = input.commitments.filter((c) => c.supersededAt === null)
  const agreement = live[0] ?? null
  const pastAgreements = input.commitments.filter((c) => c.supersededAt !== null)
  const experiment = live.find((c) => c.experimentUntil !== null) ?? null

  const section = (
    key: 'observations' | 'settled',
    kind: 'observation' | 'decision',
  ): NotebookSection => {
    const mine = input.entries.filter((e) => e.kind === kind)
    const withRights = mine.map((e) => ({
      id: e.id, body: e.body, author: e.author,
      createdAt: e.createdAt,
      // Joint authorship: the learner may supersede anything Buddy wrote.
      editableBy: e.author === 'buddy' ? (['learner', 'buddy'] as const).slice() : ['learner'],
    }))
    return {
      key, title: TITLES[key],
      live: withRights.filter((_, i) => mine[i].supersededAt === null),
      archived: withRights.filter((_, i) => mine[i].supersededAt !== null),
    }
  }

  const sections: NotebookSection[] = [section('observations', 'observation'), section('settled', 'decision')]

  // One section per share — spec §3. Absent, not empty, when there is no share.
  for (const share of input.tutorNotes) {
    sections.push({
      key: 'tutor', title: `From ${share.tutorLabel}`, shareId: share.shareId,
      live: share.notes.map((n) => ({
        id: n.id, body: n.body, author: 'tutor' as const,
        createdAt: n.createdAt, editableBy: ['tutor' as const],
      })),
      archived: [],
    })
  }

  const isEmpty =
    agreement === null &&
    experiment === null &&
    input.entries.length === 0 &&
    input.tutorNotes.every((s) => s.notes.length === 0)

  return {
    cadence: input.cadence,
    agreement: agreement ? stripMeta(agreement) : null,
    pastAgreements: pastAgreements.map(stripMeta),
    experiment: experiment ? stripMeta(experiment) : null,
    sections,
    tutorNotes: input.tutorNotes,
    isEmpty,
  }
}

function stripMeta<T extends { supersededAt: string | null; experimentUntil: string | null }>(c: T) {
  const { supersededAt: _s, experimentUntil: _e, ...rest } = c
  return rest
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @kanji-learn/shared test -- notebook`
Expected: PASS, 7 tests.

- [ ] **Step 6: Export and typecheck**

Add to `packages/shared/src/index.ts`:
```ts
export * from './notebook/types'
export * from './notebook/assemble'
```
Run: `pnpm -r typecheck` — expected all `Done`.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/notebook packages/shared/src/index.ts
git commit -m "feat(shared): assembleNotebook — pure projection of the notebook view"
```

---

### Task 3: `checkTutorConstraint` — deference without a model

**Files:**
- Create: `packages/shared/src/buddy/tutor-constraint.ts`
- Test: `packages/shared/src/buddy/tutor-constraint.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `checkTutorConstraint(input: { liveTutorNoteCount: number }): 'propose' | 'ask'`

> **This task ships a function with no caller, deliberately — and that is a
> smell worth naming rather than hiding.** Spec §6.3's deference rule applies
> when Buddy *proposes an experiment*, and nothing proposes experiments yet:
> that is slice 2 of the weekly review, unbuilt. The function is built here
> because the rule belongs to this spec and is cheap to get right while the
> reasoning is fresh.
>
> **If you would rather not carry dead code, skip this task entirely** and
> implement it with its caller in slice 2. Nothing else in this plan depends on
> it. What must not happen is shipping it and forgetting it exists, so that
> slice 2 quietly re-invents a second deference rule.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/buddy/tutor-constraint.test.ts
import { describe, it, expect } from 'vitest'
import { checkTutorConstraint } from './tutor-constraint'

// Deliberately blunt: ANY live tutor note downgrades a proposal to a question.
// Detecting semantic contradiction needs a model call — non-deterministic,
// untestable, and it fails in the worst direction by silently concluding there
// is no conflict (spec decision #10).
describe('checkTutorConstraint', () => {
  it('proposes freely when no tutor note is live', () => {
    expect(checkTutorConstraint({ liveTutorNoteCount: 0 })).toBe('propose')
  })

  it('downgrades to a question when any tutor note is live', () => {
    expect(checkTutorConstraint({ liveTutorNoteCount: 1 })).toBe('ask')
  })

  it('stays a question for many notes', () => {
    expect(checkTutorConstraint({ liveTutorNoteCount: 9 })).toBe('ask')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kanji-learn/shared test -- tutor-constraint`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/buddy/tutor-constraint.ts

/**
 * Whether Buddy may propose an experiment outright, or must raise it as a
 * question for the tutor.
 *
 * Contains no model call by design. See spec decision #10 — if this proves too
 * blunt once real notes exist (one row across three shares on 2026-07-31),
 * tightening it is a later slice with evidence behind it.
 */
export function checkTutorConstraint(input: { liveTutorNoteCount: number }): 'propose' | 'ask' {
  return input.liveTutorNoteCount > 0 ? 'ask' : 'propose'
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @kanji-learn/shared test -- tutor-constraint`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/buddy/tutor-constraint.ts packages/shared/src/buddy/tutor-constraint.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): checkTutorConstraint — defer to a live tutor note"
```

---

### Task 4: Notebook service — projection and entry writes

**Files:**
- Create: `apps/api/src/services/notebook.service.ts`
- Test: `apps/api/test/integration/notebook-service.test.ts`

**Interfaces:**
- Consumes: `assembleNotebook`, `notebookEntries`, `buddyCommitments`, `tutorNotes`, `tutorShares`.
- Produces: class `NotebookService` with `getNotebook(userId): Promise<NotebookView>`, `createEntry(userId, {kind, body, author, weekStart?, source?}): Promise<{id: string}>`, `supersedeEntry(userId, id, replacementBody: string | null): Promise<{id: string | null}>`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/integration/notebook-service.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql, eq } from 'drizzle-orm'
import * as schema from '@kanji-learn/db'
import { NotebookService } from '../../src/services/notebook.service'

const client = postgres(process.env.TEST_DATABASE_URL!)
const db = drizzle(client, { schema })
const USER = '00000000-0000-0000-0000-0000000000e1'

describe('NotebookService', () => {
  const service = new NotebookService(db)

  beforeAll(async () => {
    await db.execute(sql`INSERT INTO user_profiles (id, display_name, timezone)
      VALUES (${USER}, 'NotebookFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`)
  })

  const wipe = async () => {
    await db.execute(sql`DELETE FROM notebook_entries WHERE user_id = ${USER}`)
    await db.execute(sql`DELETE FROM buddy_commitments WHERE user_id = ${USER}`)
  }
  beforeEach(wipe)
  afterAll(async () => {
    await wipe()
    await db.execute(sql`DELETE FROM user_profiles WHERE id = ${USER}`)
  })

  it('returns an empty notebook for a learner with no history', async () => {
    const view = await service.getNotebook(USER)
    expect(view.isEmpty).toBe(true)
    expect(view.agreement).toBeNull()
  })

  it('round-trips an entry body — not just a 200', async () => {
    const { id } = await service.createEntry(USER, {
      kind: 'decision', body: 'Writing is the priority', author: 'learner',
    })
    const view = await service.getNotebook(USER)
    const settled = view.sections.find((s) => s.key === 'settled')!
    expect(settled.live.map((e) => e.id)).toContain(id)
    expect(settled.live.find((e) => e.id === id)!.body).toBe('Writing is the priority')
  })

  it('superseding stamps the old row and links the replacement', async () => {
    const { id } = await service.createEntry(USER, {
      kind: 'observation', body: 'Hooks are landing', author: 'buddy',
    })
    const { id: replacement } = await service.supersedeEntry(USER, id, 'Hooks are not landing')

    const rows = await db.select().from(schema.notebookEntries).where(eq(schema.notebookEntries.userId, USER))
    const old = rows.find((r) => r.id === id)!
    expect(old.supersededAt).not.toBeNull()
    expect(old.supersededBy).toBe(replacement)

    const view = await service.getNotebook(USER)
    const obs = view.sections.find((s) => s.key === 'observations')!
    expect(obs.live.map((e) => e.body)).toEqual(['Hooks are not landing'])
    expect(obs.archived.map((e) => e.body)).toEqual(['Hooks are landing'])
  })

  it('deleting supersedes with no replacement', async () => {
    const { id } = await service.createEntry(USER, {
      kind: 'observation', body: 'gone', author: 'buddy',
    })
    const { id: replacement } = await service.supersedeEntry(USER, id, null)
    expect(replacement).toBeNull()

    const view = await service.getNotebook(USER)
    expect(view.sections.find((s) => s.key === 'observations')!.live).toHaveLength(0)
  })

  it("refuses to supersede another learner's entry", async () => {
    const { id } = await service.createEntry(USER, {
      kind: 'observation', body: 'mine', author: 'buddy',
    })
    const other = '00000000-0000-0000-0000-0000000000e2'
    await expect(service.supersedeEntry(other, id, 'theirs')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- notebook-service`
Expected: FAIL — cannot find `../../src/services/notebook.service`.

- [ ] **Step 3: Implement the service**

```ts
// apps/api/src/services/notebook.service.ts
import { and, desc, eq, isNull } from 'drizzle-orm'
import {
  notebookEntries, buddyCommitments, userProfiles, tutorNotes, tutorShares,
} from '@kanji-learn/db'
import type { Db } from '@kanji-learn/db'
import { assembleNotebook, type NotebookView } from '@kanji-learn/shared'

export class NotebookService {
  constructor(private db: Db) {}

  async getNotebook(userId: string): Promise<NotebookView> {
    const [profile, commitments, entries, shares] = await Promise.all([
      this.db.query.userProfiles.findFirst({ where: eq(userProfiles.id, userId) }),
      this.db.select().from(buddyCommitments)
        .where(eq(buddyCommitments.userId, userId))
        .orderBy(desc(buddyCommitments.weekStart)),
      this.db.select().from(notebookEntries)
        .where(eq(notebookEntries.userId, userId))
        .orderBy(desc(notebookEntries.createdAt)),
      this.db.select().from(tutorShares).where(eq(tutorShares.userId, userId)),
    ])

    const accepted = shares.filter((s) => s.status === 'accepted')
    const noteRows = accepted.length === 0 ? [] : await this.db.select().from(tutorNotes)
    const byShare = accepted.map((s) => ({
      shareId: s.id,
      tutorLabel: s.teacherEmail,
      notes: noteRows
        .filter((n) => n.shareId === s.id)
        .map((n) => ({
          id: n.id, body: n.noteText, language: n.language,
          translation: null, createdAt: n.createdAt.toISOString(),
        })),
    }))

    return assembleNotebook({
      cadence: {
        intervalWeeks: profile?.buddyIntervalWeeks ?? 1,
        buddyDay: profile?.buddyDay ?? null,
      },
      commitments: commitments.map((c) => ({
        weekStart: c.weekStart, daysCommitted: c.daysCommitted,
        minutesPerDay: c.minutesPerDay, focus: c.focus,
        source: c.source as 'session' | 'rolled_forward' | 'default',
        supersededAt: c.supersededAt?.toISOString() ?? null,
        experimentUntil: c.experimentUntil ?? null,
      })),
      entries: entries.map((e) => ({
        id: e.id, kind: e.kind as 'observation' | 'decision', body: e.body,
        author: e.author as 'buddy' | 'learner',
        createdAt: e.createdAt.toISOString(), editableBy: [],
        supersededAt: e.supersededAt?.toISOString() ?? null,
      })),
      tutorNotes: byShare,
    })
  }

  async createEntry(
    userId: string,
    input: {
      kind: 'observation' | 'decision'
      body: string
      author: 'buddy' | 'learner'
      weekStart?: string | null
      source?: unknown
    },
  ): Promise<{ id: string }> {
    const [row] = await this.db.insert(notebookEntries).values({
      userId, kind: input.kind, body: input.body, author: input.author,
      weekStart: input.weekStart ?? null, source: input.source ?? null,
    }).returning({ id: notebookEntries.id })
    return { id: row.id }
  }

  /** Editing IS superseding. `replacementBody: null` is a delete. */
  async supersedeEntry(
    userId: string,
    id: string,
    replacementBody: string | null,
  ): Promise<{ id: string | null }> {
    const existing = await this.db.query.notebookEntries.findFirst({
      where: and(eq(notebookEntries.id, id), eq(notebookEntries.userId, userId)),
    })
    if (!existing) throw new Error('NOT_FOUND')
    if (existing.supersededAt !== null) throw new Error('ALREADY_SUPERSEDED')

    let replacementId: string | null = null
    if (replacementBody !== null) {
      const [row] = await this.db.insert(notebookEntries).values({
        userId, kind: existing.kind, body: replacementBody,
        author: 'learner', weekStart: existing.weekStart, source: existing.source,
      }).returning({ id: notebookEntries.id })
      replacementId = row.id
    }

    await this.db.update(notebookEntries)
      .set({ supersededAt: new Date(), supersededBy: replacementId })
      .where(and(eq(notebookEntries.id, id), isNull(notebookEntries.supersededAt)))

    return { id: replacementId }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @kanji-learn/api test -- notebook-service`
Expected: PASS, 5 tests.

- [ ] **Step 5: Prove the ownership guard is real**

Temporarily delete the `eq(notebookEntries.userId, userId)` clause in `supersedeEntry`'s lookup, re-run.
Expected: the "refuses to supersede another learner's entry" test FAILS. Restore the clause and confirm it passes again. A guard that has not been seen failing is not a guard.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/notebook.service.ts apps/api/test/integration/notebook-service.test.ts
git commit -m "feat(api): NotebookService — projection, entry writes, supersede-as-edit"
```

---

### Task 5: Notebook routes

**Files:**
- Create: `apps/api/src/routes/notebook.ts`
- Test: `apps/api/test/integration/notebook-route.test.ts`
- Modify: `apps/api/src/index.ts` (register at `/v1/buddy/notebook`)

**Interfaces:**
- Consumes: `NotebookService`.
- Produces: `GET /v1/buddy/notebook`, `POST /v1/buddy/notebook/entries`, `PATCH /v1/buddy/notebook/entries/:id`, `DELETE /v1/buddy/notebook/entries/:id`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/integration/notebook-route.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildTestApp } from '../helpers/test-app'
import type { FastifyInstance } from 'fastify'

const USER = '00000000-0000-0000-0000-0000000000e3'
let app: FastifyInstance

describe('notebook routes', () => {
  beforeAll(async () => {
    app = await buildTestApp()
    await app.db.execute(
      app.db.$client.unsafe(
        `INSERT INTO user_profiles (id, display_name, timezone)
         VALUES ('${USER}', 'RouteFixture', 'America/Los_Angeles') ON CONFLICT DO NOTHING`,
      ) as never,
    )
  })

  afterAll(async () => {
    await app.db.$client.unsafe(`DELETE FROM notebook_entries WHERE user_id = '${USER}'`)
    await app.db.$client.unsafe(`DELETE FROM user_profiles WHERE id = '${USER}'`)
    await app.close()
  })

  it('GET returns a notebook view', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/buddy/notebook', headers: { 'x-test-user-id': USER },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveProperty('sections')
  })

  it('POST stores EVERY field it accepts and reads them back', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/buddy/notebook/entries',
      headers: { 'x-test-user-id': USER },
      payload: {
        kind: 'decision',
        body: 'No Japanese before coffee',
        weekStart: '2026-08-03',
        source: { kind: 'manual' },
      },
    })
    expect(res.statusCode).toBe(200)
    const id = res.json().data.id

    // z.object() STRIPS unknown keys and still returns 200. Asserting the status
    // is what missed this twice before — read the values back.
    const rows = await app.db.$client.unsafe(
      `SELECT body, week_start, source FROM notebook_entries WHERE id = '${id}'`,
    )
    expect(rows[0].body).toBe('No Japanese before coffee')
    expect(String(rows[0].week_start)).toContain('2026-08-03')
    expect(rows[0].source).toEqual({ kind: 'manual' })
  })

  it('PATCH supersedes and returns the replacement id', async () => {
    const created = await app.inject({
      method: 'POST', url: '/v1/buddy/notebook/entries',
      headers: { 'x-test-user-id': USER },
      payload: { kind: 'observation', body: 'first' },
    })
    const id = created.json().data.id

    const res = await app.inject({
      method: 'PATCH', url: `/v1/buddy/notebook/entries/${id}`,
      headers: { 'x-test-user-id': USER },
      payload: { body: 'second' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.id).not.toBe(id)
  })

  it('rejects an unknown kind rather than silently coercing it', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/buddy/notebook/entries',
      headers: { 'x-test-user-id': USER },
      payload: { kind: 'nonsense', body: 'x' },
    })
    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- notebook-route`
Expected: FAIL — 404 on every route.

- [ ] **Step 3: Implement the routes**

```ts
// apps/api/src/routes/notebook.ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { NotebookService } from '../services/notebook.service.js'

// Every field the client sends is listed. z.object() strips what is not here
// and still returns 200 — that is how four features shipped inert (docs/SOP.md).
const createSchema = z.object({
  kind: z.enum(['observation', 'decision']),
  body: z.string().min(1).max(2000),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  source: z.record(z.unknown()).nullable().optional(),
})

const patchSchema = z.object({ body: z.string().min(1).max(2000) })

export async function notebookRoutes(server: FastifyInstance) {
  const service = new NotebookService(server.db)

  server.get('/', { preHandler: [server.authenticate] }, async (req, reply) => {
    return reply.send({ ok: true, data: await service.getNotebook(req.userId!) })
  })

  server.post('/entries', { preHandler: [server.authenticate] }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
    }
    const created = await service.createEntry(req.userId!, {
      ...parsed.data, author: 'learner',
    })
    return reply.send({ ok: true, data: created })
  })

  server.patch<{ Params: { id: string } }>(
    '/entries/:id', { preHandler: [server.authenticate] },
    async (req, reply) => {
      const parsed = patchSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ ok: false, error: 'Invalid body', code: 'VALIDATION_ERROR' })
      }
      try {
        const result = await service.supersedeEntry(req.userId!, req.params.id, parsed.data.body)
        return reply.send({ ok: true, data: result })
      } catch {
        return reply.code(404).send({ ok: false, error: 'Not found', code: 'NOT_FOUND' })
      }
    },
  )

  server.delete<{ Params: { id: string } }>(
    '/entries/:id', { preHandler: [server.authenticate] },
    async (req, reply) => {
      try {
        await service.supersedeEntry(req.userId!, req.params.id, null)
        return reply.send({ ok: true, data: { id: null } })
      } catch {
        return reply.code(404).send({ ok: false, error: 'Not found', code: 'NOT_FOUND' })
      }
    },
  )
}
```

Register in `apps/api/src/index.ts` alongside the other `/v1/buddy` routes:
```ts
await server.register(notebookRoutes, { prefix: '/v1/buddy/notebook' })
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @kanji-learn/api test -- notebook-route`
Expected: PASS, 4 tests.

- [ ] **Step 5: Prove the read-back test can fail**

Temporarily remove `weekStart` from `createSchema`, re-run.
Expected: the POST test FAILS on `week_start`, not on the status code. Restore.
This is the exact defect that shipped four inert features and recurred as Task 11 — the test must be seen catching it.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/notebook.ts apps/api/test/integration/notebook-route.test.ts apps/api/src/index.ts
git commit -m "feat(api): notebook routes with enumerated schema and read-back tests"
```

---

### Task 6: Mobile store

**Files:**
- Create: `apps/mobile/src/stores/notebook.store.ts`
- Test: `apps/mobile/test/unit/notebook-store.test.ts`

**Interfaces:**
- Produces: `useNotebookStore` with `{ hasLoaded, error, view, load, addEntry, editEntry, deleteEntry }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/test/unit/notebook-store.test.ts
import { useNotebookStore } from '../../src/stores/notebook.store'
import { api } from '../../src/lib/api'

jest.mock('../../src/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }))

describe('useNotebookStore', () => {
  beforeEach(() => {
    useNotebookStore.setState({ hasLoaded: false, error: null, view: null })
    jest.clearAllMocks()
  })

  it('sets hasLoaded and view on success', async () => {
    ;(api.get as jest.Mock).mockResolvedValue({ sections: [], isEmpty: true })
    await useNotebookStore.getState().load()
    expect(useNotebookStore.getState().hasLoaded).toBe(true)
    expect(useNotebookStore.getState().view).toEqual({ sections: [], isEmpty: true })
  })

  // The store must never leave hasLoaded false on failure — that renders a
  // permanent spinner, which is the shape of the B-227 blank Journal.
  it('sets hasLoaded AND an error on failure, never a permanent spinner', async () => {
    ;(api.get as jest.Mock).mockRejectedValue(new Error('offline'))
    await useNotebookStore.getState().load()
    expect(useNotebookStore.getState().hasLoaded).toBe(true)
    expect(useNotebookStore.getState().error).toBe('offline')
    expect(useNotebookStore.getState().view).toBeNull()
  })

  it('reloads after an edit so the archive reflects the supersede', async () => {
    ;(api.patch as jest.Mock).mockResolvedValue({ id: 'new' })
    ;(api.get as jest.Mock).mockResolvedValue({ sections: [], isEmpty: false })
    await useNotebookStore.getState().editEntry('old', 'revised')
    expect(api.get).toHaveBeenCalledWith('/v1/buddy/notebook')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kanji-learn/mobile test -- --runInBand notebook-store`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/mobile/src/stores/notebook.store.ts
import { create } from 'zustand'
import { api } from '../lib/api'
import type { NotebookView } from '@kanji-learn/shared'

interface NotebookState {
  hasLoaded: boolean
  error: string | null
  view: NotebookView | null
  load: () => Promise<void>
  addEntry: (kind: 'observation' | 'decision', body: string) => Promise<void>
  editEntry: (id: string, body: string) => Promise<void>
  deleteEntry: (id: string) => Promise<void>
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  hasLoaded: false,
  error: null,
  view: null,

  load: async () => {
    set({ hasLoaded: false, error: null })
    try {
      const view = await api.get<NotebookView>('/v1/buddy/notebook')
      set({ hasLoaded: true, view, error: null })
    } catch (e) {
      set({ hasLoaded: true, view: null, error: e instanceof Error ? e.message : 'Failed to load' })
    }
  },

  addEntry: async (kind, body) => {
    await api.post('/v1/buddy/notebook/entries', { kind, body })
    await get().load()
  },

  editEntry: async (id, body) => {
    await api.patch(`/v1/buddy/notebook/entries/${id}`, { body })
    await get().load()
  },

  deleteEntry: async (id) => {
    await api.delete(`/v1/buddy/notebook/entries/${id}`)
    await get().load()
  },
}))
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @kanji-learn/mobile test -- --runInBand notebook-store`
Expected: PASS, 3 tests.

- [ ] **Step 5: Refuse edits offline rather than queueing them**

Spec §11: the notebook is read-only offline. A sync queue for a weekly-cadence
document is machinery for a problem that does not exist, and a half-built one
loses edits silently.

Add the failing test first:

```ts
it('refuses an edit while offline instead of pretending it saved', async () => {
  ;(api.patch as jest.Mock).mockRejectedValue(new Error('Network request failed'))
  await useNotebookStore.getState().editEntry('id', 'revised')
  expect(useNotebookStore.getState().error).toMatch(/offline|network/i)
})
```

Run it — expected FAIL, because `editEntry` currently lets the rejection escape
and the caller sees an unhandled promise rejection rather than an error state.
Then wrap `addEntry` / `editEntry` / `deleteEntry` bodies in try/catch setting
`error` and returning without reloading.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/stores/notebook.store.ts apps/mobile/test/unit/notebook-store.test.ts
git commit -m "feat(mobile): notebook store, read-only when offline"
```

---

### Task 7: `NotebookBody` — the visual surface

**Files:**
- Create: `apps/mobile/src/components/notebook/NotebookBody.tsx`
- Test: `apps/mobile/test/components/NotebookBody.test.tsx`

**Interfaces:**
- Consumes: `NotebookView` from `@kanji-learn/shared`.
- Produces: `<NotebookBody view onAdd onEdit onDelete />`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/mobile/test/components/NotebookBody.test.tsx
import React from 'react'
import { render, screen } from '@testing-library/react-native'
import { NotebookBody } from '../../src/components/notebook/NotebookBody'
import type { NotebookView } from '@kanji-learn/shared'

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle))
  return (style ?? {}) as Record<string, unknown>
}

function legibleTextNodes() {
  const { Text } = require('react-native')
  return screen.UNSAFE_getAllByType(Text)
    .filter((n: { props: { children?: unknown } }) => typeof n.props.children === 'string')
}

const empty: NotebookView = {
  cadence: { intervalWeeks: 1, buddyDay: 0 },
  agreement: null, pastAgreements: [], experiment: null,
  sections: [
    { key: 'observations', title: 'What Buddy notices', live: [], archived: [] },
    { key: 'settled', title: "What we've settled", live: [], archived: [] },
  ],
  tutorNotes: [], isEmpty: true,
}

const noop = () => {}

describe('NotebookBody', () => {
  it('renders a dignified empty state rather than empty panels', () => {
    render(<NotebookBody view={empty} onAdd={noop} onEdit={noop} onDelete={noop} />)
    expect(screen.getByTestId('notebook-empty')).toBeTruthy()
  })

  it('shows the cadence as state and control, with no miss tally', () => {
    render(<NotebookBody view={empty} onAdd={noop} onEdit={noop} onDelete={noop} />)
    const text = legibleTextNodes().map((n: { props: { children: string } }) => n.props.children).join(' ')
    expect(text).toMatch(/weekly/i)
    expect(text).not.toMatch(/missed/i)
    expect(text).not.toMatch(/\d+ of \d+/)
  })

  // B146: a screen rendered correctly and was invisible — black default text on
  // #0F0F1A. getByText finds text whatever colour it is.
  it('renders every string in an explicit colour', () => {
    render(
      <NotebookBody
        view={{
          ...empty, isEmpty: false,
          agreement: { weekStart: '2026-08-03', daysCommitted: 4, minutesPerDay: 15, focus: null, source: 'session' },
          sections: [
            { key: 'observations', title: 'What Buddy notices',
              live: [{ id: 'a', body: 'Your hooks are landing', author: 'buddy', createdAt: '2026-08-01T00:00:00Z', editableBy: ['learner'] }],
              archived: [] },
          ],
        }}
        onAdd={noop} onEdit={noop} onDelete={noop}
      />
    )
    const texts = legibleTextNodes()
    expect(texts.length).toBeGreaterThan(0)
    for (const node of texts) {
      const style = flattenStyle(node.props.style)
      expect(style.color).toBeDefined()
      expect(style.color).not.toBe('#000')
    }
  })

  it('shows the agreement section as anticipated, not missing, when there is none', () => {
    render(<NotebookBody view={empty} onAdd={noop} onEdit={noop} onDelete={noop} />)
    expect(screen.getByTestId('notebook-agreement-pending')).toBeTruthy()
  })

  it('omits the tutor section when there is no share', () => {
    render(<NotebookBody view={empty} onAdd={noop} onEdit={noop} onDelete={noop} />)
    expect(screen.queryByTestId('notebook-section-tutor')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kanji-learn/mobile test:components`
Expected: FAIL — cannot resolve `NotebookBody`.

- [ ] **Step 3: Implement**

Build `NotebookBody.tsx` rendering, in order: a header with the cadence line (`Buddy checks in weekly, on Sundays` from `view.cadence`, with a `notebook-cadence-control` Pressable), the agreement (or a `notebook-agreement-pending` block reading *"Once you've done the placement test, Buddy will set the first week here."*), the experiment if present, then `view.sections.map(...)` with `testID={`notebook-section-${section.key}`}`, and a `notebook-empty` block when `view.isEmpty`.

**Every `Text` takes a style from a `StyleSheet.create` block with an explicit `color` drawn from `colors.textPrimary` / `colors.textSecondary` / `colors.textMuted`.** Model the structure on `apps/mobile/src/components/buddy/BuddySessionBody.tsx`, which was fixed for exactly this in `1817efb`.

Day names come from a local `const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']` indexed by `view.cadence.buddyDay`; when `buddyDay` is null the line reads *"Buddy checks in when you ask."*

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @kanji-learn/mobile test:components`
Expected: PASS — 5 new tests plus the existing 12.

- [ ] **Step 5: Prove the colour assertion still bites**

Temporarily delete the `color` key from one style in `NotebookBody.tsx`, re-run.
Expected: the colour test FAILS. Restore.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/notebook apps/mobile/test/components/NotebookBody.test.tsx
git commit -m "feat(mobile): NotebookBody — sections, cadence line, dignified empty state"
```

---

### Task 8: Replace the Journal screen

**Files:**
- Modify: `apps/mobile/app/(tabs)/journal.tsx`

**Interfaces:**
- Consumes: `useNotebookStore`, `NotebookBody`.

- [ ] **Step 1: Rewrite the screen shell**

Replace the body of `journal.tsx` with a shell that calls `useNotebookStore().load()` in an effect and renders `<NotebookBody />`, keeping the existing hook search/compose modal mounted **below** the notebook sections as the "Your hooks" section. Title becomes `Buddy`.

> **"Your hooks" stays in the screen, not in `NotebookView`.** The spec lists it
> as the sixth section, and it is — visually. But it already has a working
> implementation with search, lookup and a compose modal, and pulling all of
> that through the assembly function would mean rebuilding it to gain nothing:
> hooks have no live/archive split and no supersede chain. `assembleNotebook`
> stays responsible for the sections that need partitioning. If hook efficacy
> later needs to appear *as an observation*, that arrives as a `notebook_entries`
> row from Task 10's write-back, which is the right seam for it.

Keep `SafeAreaView` and `InfoButton`. The screen is a tab, so it needs no close control.

- [ ] **Step 2: Typecheck and run both mobile lanes**

Run:
```bash
pnpm --filter @kanji-learn/mobile typecheck
pnpm --filter @kanji-learn/mobile test -- --runInBand
pnpm --filter @kanji-learn/mobile test:components
```
Expected: typecheck `Done`; pure lane ≥ 159 passing; component lane ≥ 17 passing.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/\(tabs\)/journal.tsx
git commit -m "feat(mobile): the Journal tab becomes Buddy's home"
```

---

### Task 9: Tutor notes as a study surface

**Files:**
- Create: `apps/mobile/src/components/notebook/TutorNote.tsx`
- Test: `apps/mobile/test/components/TutorNote.test.tsx`

**Interfaces:**
- Consumes: `TutorNoteView`.
- Produces: `<TutorNote note onLookupKanji onSpeak onTranslate />`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/mobile/test/components/TutorNote.test.tsx
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react-native'
import { TutorNote } from '../../src/components/notebook/TutorNote'

const jaNote = {
  id: 'n1', body: '説明をもう一度', language: 'ja',
  translation: null, createdAt: '2026-08-01T00:00:00Z',
}

describe('TutorNote', () => {
  // Spec decision #8: a tutor may write in Japanese deliberately, to be read.
  it('renders the note as written, untranslated', () => {
    render(<TutorNote note={jaNote} onLookupKanji={() => {}} onSpeak={() => {}} onTranslate={() => {}} />)
    expect(screen.getByText('説明をもう一度')).toBeTruthy()
    expect(screen.queryByTestId('tutor-note-translation')).toBeNull()
  })

  it('makes each kanji tappable for lookup', () => {
    const onLookupKanji = jest.fn()
    render(<TutorNote note={jaNote} onLookupKanji={onLookupKanji} onSpeak={() => {}} onTranslate={() => {}} />)
    fireEvent.press(screen.getByTestId('tutor-note-kanji-説'))
    expect(onLookupKanji).toHaveBeenCalledWith('説')
  })

  it('offers translation as a deliberate action, not a default', () => {
    const onTranslate = jest.fn()
    render(<TutorNote note={jaNote} onLookupKanji={() => {}} onSpeak={() => {}} onTranslate={onTranslate} />)
    fireEvent.press(screen.getByTestId('tutor-note-translate'))
    expect(onTranslate).toHaveBeenCalledWith('n1')
  })

  it('records that translation was used once it is present', () => {
    render(
      <TutorNote note={{ ...jaNote, translation: 'Explain it once more' }}
        onLookupKanji={() => {}} onSpeak={() => {}} onTranslate={() => {}} />
    )
    expect(screen.getByTestId('tutor-note-translation')).toBeTruthy()
    expect(screen.getByTestId('tutor-note-translated-marker')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kanji-learn/mobile test:components`
Expected: FAIL — cannot resolve `TutorNote`.

- [ ] **Step 3: Implement**

Render `note.body` split into characters; any character matching `/[一-鿿]/` becomes a `Pressable` with `testID={`tutor-note-kanji-${char}`}` calling `onLookupKanji(char)`. Non-kanji characters render as plain styled `Text`. Add a speaker control calling `onSpeak(note.body)` and a `tutor-note-translate` control calling `onTranslate(note.id)`. When `note.translation` is non-null, render it under `tutor-note-translation` with a `tutor-note-translated-marker` label reading *"You asked for a translation."*

All text takes explicit colours, as Task 7.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @kanji-learn/mobile test:components`
Expected: PASS, 4 new tests.

- [ ] **Step 5: Wire it into `NotebookBody`** for sections with `key === 'tutor'`, with `onSpeak` calling `Speech.speak(body, { language: 'ja-JP' })` from `expo-speech` and `onLookupKanji` routing to `/kanji/[id]` via the existing `/v1/kanji/lookup?character=` endpoint.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/notebook/TutorNote.tsx apps/mobile/test/components/TutorNote.test.tsx apps/mobile/src/components/notebook/NotebookBody.tsx
git commit -m "feat(mobile): tutor notes render as a study surface, never auto-translated"
```

---

### Task 10: Session write-back and the first-open seed

**Files:**
- Modify: `apps/api/src/routes/buddy-session.ts`
- Modify: `apps/api/src/services/notebook.service.ts`
- Test: `apps/api/test/integration/notebook-writeback.test.ts`

**Interfaces:**
- Consumes: `NotebookService.createEntry`.
- Produces: `NotebookService.ensureFirstOpen(userId): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/integration/notebook-writeback.test.ts
// (fixture setup identical to notebook-service.test.ts, USER = ...e4)

it('writes a Buddy introduction on first open and never a second time', async () => {
  await service.ensureFirstOpen(USER)
  await service.ensureFirstOpen(USER)

  const view = await service.getNotebook(USER)
  const settled = view.sections.find((s) => s.key === 'settled')!
  const intros = settled.live.filter((e) => e.author === 'buddy')
  expect(intros).toHaveLength(1)
})

it('writes an observation when a commitment is agreed', async () => {
  await service.createEntry(USER, {
    kind: 'observation', body: 'Agreed 4 days, 15 minutes.', author: 'buddy',
    weekStart: '2026-08-03', source: { kind: 'commitment' },
  })
  const view = await service.getNotebook(USER)
  expect(view.sections.find((s) => s.key === 'observations')!.live).toHaveLength(1)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kanji-learn/api test -- notebook-writeback`
Expected: FAIL — `service.ensureFirstOpen is not a function`.

- [ ] **Step 3: Implement `ensureFirstOpen`**

```ts
/**
 * Spec §8. Phase 7 writes page one during onboarding, but if Phase 6 ships
 * first — or for any learner who onboarded before it — the notebook would open
 * blank. Idempotent: keyed on the existence of any buddy-authored decision.
 */
async ensureFirstOpen(userId: string): Promise<void> {
  const existing = await this.db.query.notebookEntries.findFirst({
    where: and(
      eq(notebookEntries.userId, userId),
      eq(notebookEntries.author, 'buddy'),
      eq(notebookEntries.kind, 'decision'),
    ),
  })
  if (existing) return

  await this.createEntry(userId, {
    kind: 'decision', author: 'buddy',
    body: "This is where we'll keep track of what we decide together — what you're working on, what we're trying, and what's actually helping.",
    source: { kind: 'first_open' },
  })
}
```

Call it at the top of the notebook `GET` route, before `getNotebook`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @kanji-learn/api test -- notebook-writeback`
Expected: PASS, 2 tests.

- [ ] **Step 5: Prove idempotence is real**

Temporarily delete the `if (existing) return` line, re-run.
Expected: the first test FAILS with 2 intros. Restore.

- [ ] **Step 6: Add the commitment write-back** in `POST /v1/buddy/session/commitment`: after a successful commit, `createEntry(userId, { kind: 'observation', author: 'buddy', weekStart, body: `Agreed ${daysCommitted} days, ${minutesPerDay} minutes.`, source: { kind: 'commitment' } })`. Template copy only — the notebook must render on the template tier (spec decision #11).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/notebook.service.ts apps/api/src/routes/notebook.ts apps/api/src/routes/buddy-session.ts apps/api/test/integration/notebook-writeback.test.ts
git commit -m "feat(api): first-open seed and session write-back into the notebook"
```

---

### Task 11: Retire Quiz Weak Spots

**Files:**
- Modify: `apps/mobile/app/(tabs)/progress.tsx`

- [ ] **Step 1: Remove the panel**

Delete the `Quiz Weak Spots` `Section` block (around `progress.tsx:381`) and its `INFO_QUIZ_WEAK` info panel entry.

Rationale to keep in the commit message, not a code comment: the panel names specific kanji and offers no action, and it reports quiz-only weakness under a name that claims all of it — while Writing Practice and Speaking Practice panels sit alongside proving the other dimensions are tracked. Spec §9.1.

- [ ] **Step 2: Verify nothing else referenced it**

Run: `grep -rn "quizWeak\|weakestKanji" apps/mobile/src apps/mobile/app`
Expected: no hits outside the deleted block, or only the `useQuizAnalytics` hook field, which stays (it is still fetched, just not rendered).

- [ ] **Step 3: Typecheck and run the lanes**

Run:
```bash
pnpm --filter @kanji-learn/mobile typecheck
pnpm --filter @kanji-learn/mobile test -- --runInBand
```
Expected: typecheck `Done`, pure lane green.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/\(tabs\)/progress.tsx
git commit -m "refactor(mobile): retire Quiz Weak Spots — a weakness list with no action is a guilt list"
```

---

### Task 12: Full verification

- [ ] **Step 1: Rebuild the local test database**

Follow https://github.com/radmelon/kanji-learn/blob/main/docs/local-test-db.md, **adding `0032` to the hand-applied list**. A stale database reads extra failures and sends you chasing regressions that do not exist.

- [ ] **Step 2: Run everything**

```bash
pnpm -r typecheck
pnpm --filter @kanji-learn/shared test
pnpm --filter @kanji-learn/api test
pnpm --filter @kanji-learn/mobile test -- --runInBand
pnpm --filter @kanji-learn/mobile test:components
```

Expected: typecheck clean; shared ≥ 280; API **≥ 410 passing with exactly 2 failures — `learner-state-refresh` and `rls-coverage`, by name**; mobile pure ≥ 162; components ≥ 21.

**If a third API failure appears, name it and find out whether it is fixture residue before treating it as pre-existing.** `backfill.test.ts` flipped to failing on 2026-07-31 from exactly that and was mistaken for a baseline failure.

- [ ] **Step 3: Update `docs/local-test-db.md`** to list `0032` in the hand-applied migrations.

- [ ] **Step 4: Commit**

```bash
git add docs/local-test-db.md
git commit -m "docs: add migration 0032 to the local test DB provisioning list"
```

---

## Deploy notes

The forced sequence, unchanged in shape from 2026-07-31:

1. Apply `0032` to live — the API reads `notebook_entries`; deploying first means 500s.
2. `./scripts/deploy-api.sh` — **the only deploy path.** App Runner pulls from ECR; `git push` reaches nothing.
3. **Verify by content:** capture the pre-state first (`GET /v1/buddy/notebook` should 404 before, 401 after) and confirm a control route still 404s.
4. EAS build with `EXPO_NO_CAPABILITY_SYNC=1`.

**`2cab737` is already unshipped on `main`** — the placement seeding fix. It must deploy before any build, or seeding will be inert in the new binary, which is the B144 failure exactly.
